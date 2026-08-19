/**
 * Mini HTTP server: health + OAuth Octorate + Admin UI config.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginOAuthLogin,
  exchangeAuthorizationCode,
  forceRefreshOctorateToken,
  getOctorateTokenStatus,
  getRedirectUri,
  takeOAuthState,
} from "./octorate-auth.js";
import {
  buildSystemPrompt,
  getAccommodationsConfig,
  getBoardsConfig,
  getTurniConfig,
  invalidateRuntimeCache,
  listRules,
  readRule,
  secretsStatus,
  writeConfigJson,
  writeRule,
} from "./runtime-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function html(title, body) {
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5}
.ok{color:#0a0}.err{color:#a00}</style></head><body>${body}</body></html>`;
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("JSON non valido"));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function requireAdmin(req, res) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !String(expected).trim()) {
    sendJson(res, 503, {
      error: "ADMIN_TOKEN non configurato nel .env del server",
    });
    return false;
  }
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const cookies = parseCookies(req.headers.cookie);
  const token = bearer || cookies.admin_token || "";
  if (token !== expected) {
    sendJson(res, 401, { error: "Non autorizzato" });
    return false;
  }
  return true;
}

function serveStatic(urlPath, res) {
  let rel = urlPath.replace(/^\/admin\/?/, "");
  if (!rel || rel.endsWith("/")) rel += "index.html";
  const filePath = join(publicDir, "admin", rel);
  if (!filePath.startsWith(join(publicDir, "admin")) || !existsSync(filePath)) {
    return false;
  }
  const ext = extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  res.end(readFileSync(filePath));
  return true;
}

/**
 * @param {{ onOAuthSuccess?: () => void | Promise<void> }} [opts]
 */
export function startPublicHttpServer(opts = {}) {
  const port = Number(process.env.PUBLIC_HTTP_PORT || 8787);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      const { pathname } = url;
      const method = (req.method || "GET").toUpperCase();

      if (pathname === "/health") {
        sendJson(res, 200, { ok: true, service: "trelloai" });
        return;
      }

      if (pathname === "/oauth/login") {
        let login;
        try {
          login = beginOAuthLogin();
        } catch (e) {
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            html(
              "Errore",
              `<h1 class="err">Config OAuth incompleta</h1><p>${e.message}</p>`
            )
          );
          return;
        }
        res.writeHead(302, { Location: login.authorizeUrl });
        res.end();
        return;
      }

      if (pathname === "/oauth/callback") {
        const err = url.searchParams.get("error");
        if (err) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            html("OAuth error", `<h1 class="err">Errore OAuth</h1><pre>${err}</pre>`)
          );
          return;
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state || !takeOAuthState(state)) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            html(
              "Callback non valido",
              `<h1 class="err">Callback non valido</h1><p>Ricomincia da <a href="/oauth/login">/oauth/login</a></p>`
            )
          );
          return;
        }
        await exchangeAuthorizationCode(code, getRedirectUri());
        if (opts.onOAuthSuccess) await opts.onOAuthSuccess();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          html(
            "Octorate OK",
            `<h1 class="ok">Octorate collegato</h1><p>Token salvati. Puoi chiudere questa finestra e usare il bot Telegram.</p>`
          )
        );
        return;
      }

      if (pathname === "/admin") {
        res.writeHead(302, { Location: "/admin/" });
        res.end();
        return;
      }
      if (pathname.startsWith("/admin/")) {
        if (serveStatic(pathname, res)) return;
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      // --- Admin API ---
      if (pathname.startsWith("/api/admin/")) {
        if (!requireAdmin(req, res)) return;

        if (pathname === "/api/admin/status" && method === "GET") {
          sendJson(res, 200, {
            ok: true,
            secrets: secretsStatus(),
            octorateAuth: getOctorateTokenStatus(),
            rules: listRules(),
            systemPromptChars: buildSystemPrompt().length,
          });
          return;
        }

        if (pathname === "/api/admin/octorate/refresh" && method === "POST") {
          try {
            await forceRefreshOctorateToken();
            if (opts.onOAuthSuccess) await opts.onOAuthSuccess();
            sendJson(res, 200, {
              ok: true,
              octorateAuth: getOctorateTokenStatus(),
            });
          } catch (e) {
            sendJson(res, 400, {
              ok: false,
              error: e.message,
              loginPath: "/oauth/login",
              octorateAuth: getOctorateTokenStatus(),
            });
          }
          return;
        }

        if (pathname === "/api/admin/reload" && method === "POST") {
          invalidateRuntimeCache();
          sendJson(res, 200, { ok: true });
          return;
        }

        if (pathname === "/api/admin/rules" && method === "GET") {
          sendJson(res, 200, { rules: listRules() });
          return;
        }

        const ruleMatch = pathname.match(/^\/api\/admin\/rules\/([a-z0-9-]+)$/);
        if (ruleMatch) {
          const id = ruleMatch[1];
          if (method === "GET") {
            sendJson(res, 200, { id, markdown: readRule(id) });
            return;
          }
          if (method === "PUT") {
            const body = await readBody(req);
            writeRule(id, body?.markdown ?? "");
            sendJson(res, 200, { ok: true, id });
            return;
          }
        }

        if (pathname === "/api/admin/config/accommodations") {
          if (method === "GET") {
            sendJson(res, 200, getAccommodationsConfig());
            return;
          }
          if (method === "PUT") {
            const body = await readBody(req);
            if (!body?.accommodations) {
              sendJson(res, 400, { error: "accommodations richiesto" });
              return;
            }
            writeConfigJson("accommodations", body);
            sendJson(res, 200, { ok: true });
            return;
          }
        }

        if (pathname === "/api/admin/config/turni") {
          if (method === "GET") {
            sendJson(res, 200, getTurniConfig());
            return;
          }
          if (method === "PUT") {
            const body = await readBody(req);
            writeConfigJson("turni", body);
            sendJson(res, 200, { ok: true });
            return;
          }
        }

        if (pathname === "/api/admin/config/boards") {
          if (method === "GET") {
            sendJson(res, 200, getBoardsConfig());
            return;
          }
          if (method === "PUT") {
            const body = await readBody(req);
            writeConfigJson("boards", body);
            sendJson(res, 200, { ok: true });
            return;
          }
        }

        sendJson(res, 404, { error: "API non trovata" });
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (e) {
      console.error("[http]", e.message);
      if (req.url?.startsWith("/api/")) {
        sendJson(res, 500, { error: e.message });
        return;
      }
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        html("Errore", `<h1 class="err">Errore</h1><pre>${e.message}</pre>`)
      );
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`HTTP pubblico (dietro Caddy): 127.0.0.1:${port}`);
    try {
      const base = getRedirectUri().replace("/oauth/callback", "");
      console.log(`OAuth login: ${base}/oauth/login`);
      console.log(`Admin UI: ${base}/admin/`);
    } catch {
      console.log("OAuth/Admin: imposta PUBLIC_BASE_URL o OCTORATE_OAUTH_REDIRECT_URI");
    }
  });

  return server;
}

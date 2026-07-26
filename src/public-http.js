/**
 * Mini HTTP server: health + OAuth Octorate callback (dietro Caddy HTTPS).
 */
import { createServer } from "node:http";
import {
  beginOAuthLogin,
  exchangeAuthorizationCode,
  getRedirectUri,
  takeOAuthState,
} from "./octorate-auth.js";

function html(title, body) {
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5}
.ok{color:#0a0}.err{color:#a00}</style></head><body>${body}</body></html>`;
}

/**
 * @param {{ onOAuthSuccess?: () => void | Promise<void> }} [opts]
 */
export function startPublicHttpServer(opts = {}) {
  const port = Number(process.env.PUBLIC_HTTP_PORT || 8787);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, service: "trelloai" }));
        return;
      }

      if (url.pathname === "/oauth/login") {
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

      if (url.pathname === "/oauth/callback") {
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

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (e) {
      console.error("[http]", e.message);
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        html("Errore", `<h1 class="err">Errore</h1><pre>${e.message}</pre>`)
      );
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`HTTP pubblico (dietro Caddy): 127.0.0.1:${port}`);
    try {
      console.log(`OAuth login: ${getRedirectUri().replace("/oauth/callback", "/oauth/login")}`);
    } catch {
      console.log("OAuth: imposta PUBLIC_BASE_URL o OCTORATE_OAUTH_REDIRECT_URI");
    }
  });

  return server;
}

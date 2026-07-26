/**
 * Login OAuth Octorate (una tantum).
 *
 * Le credenziali MCP generate in Settings › Advanced › API accettano tipicamente
 * solo il redirect Claude (non localhost né sslip.io). Flusso:
 *   1. Apri authorize con redirect Claude
 *   2. Autorizza in Octorate
 *   3. Copia l'URL completo da claude.ai/...auth_callback?code=...
 *   4. npm run octorate-login -- --code="URL_O_CODE"
 *
 * Opzionale: --ship copia .octorate-tokens.json sul server Scaleway.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import {
  exchangeAuthorizationCode,
  buildAuthorizeUrl,
} from "./octorate-auth.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
config({ path: join(projectRoot, ".env") });

/** Redirect già whitelistato per le credenziali MCP Octorate. */
export const CLAUDE_REDIRECT_URI =
  process.env.OCTORATE_OAUTH_REDIRECT_URI_LOGIN ||
  "https://claude.ai/api/mcp/auth_callback";

function parseArgs(argv) {
  const out = { code: null, ship: false, open: true };
  for (const a of argv) {
    if (a === "--ship") out.ship = true;
    else if (a === "--no-open") out.open = false;
    else if (a.startsWith("--code=")) out.code = a.slice("--code=".length);
    else if (a === "--code") out.code = null; // next?
  }
  const codeIdx = argv.indexOf("--code");
  if (codeIdx >= 0 && argv[codeIdx + 1] && !argv[codeIdx + 1].startsWith("--")) {
    out.code = argv[codeIdx + 1];
  }
  return out;
}

function extractCode(raw) {
  if (!raw) return null;
  const s = raw.trim().replace(/^["']|["']$/g, "");
  try {
    const u = new URL(s);
    return u.searchParams.get("code") || s;
  } catch {
    const m = s.match(/[?&]code=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : s;
  }
}

async function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      await execFileAsync("powershell", [
        "-NoProfile",
        "-Command",
        `Start-Process '${url.replace(/'/g, "''")}'`,
      ]);
    } else if (process.platform === "darwin") {
      await execFileAsync("open", [url]);
    } else {
      await execFileAsync("xdg-open", [url]);
    }
  } catch {
    console.log("(Apri manualmente l'URL se il browser non si apre)");
  }
}

async function shipTokens() {
  const localCfg = join(projectRoot, "deploy/ship.local.json");
  const baseCfg = join(projectRoot, "deploy/ship.config.json");
  const cfg = {
    ...(existsSync(baseCfg) ? JSON.parse(readFileSync(baseCfg, "utf8")) : {}),
    ...(existsSync(localCfg) ? JSON.parse(readFileSync(localCfg, "utf8")) : {}),
  };
  if (!cfg.host) throw new Error("Manca host in deploy/ship.local.json");
  const remote = cfg.remotePath || "/opt/trelloai";
  const target = `${cfg.user || "root"}@${cfg.host}`;
  const tokens = join(projectRoot, ".octorate-tokens.json");
  if (!existsSync(tokens)) throw new Error("Manca .octorate-tokens.json");
  console.log(`→ scp tokens → ${target}:${remote}/`);
  await execFileAsync("scp", [
    "-o",
    "StrictHostKeyChecking=accept-new",
    tokens,
    `${target}:${remote}/.octorate-tokens.json`,
  ]);
  await execFileAsync("ssh", [
    "-o",
    "StrictHostKeyChecking=accept-new",
    target,
    `cd ${remote} && pm2 restart trelloai --update-env`,
  ]);
  console.log("✓ tokens sul server + pm2 restart");
}

const args = parseArgs(process.argv.slice(2));
const state = randomBytes(8).toString("hex");
const authorizeUrl = buildAuthorizeUrl(state, CLAUDE_REDIRECT_URI);

if (!args.code) {
  console.log(`
OAuth Octorate — redirect whitelistato: ${CLAUDE_REDIRECT_URI}

1) Autorizza nel browser (si apre ora)
2) Finirai su claude.ai/...auth_callback?code=... (anche se Claude mostra errore)
3) Copia l'URL intero dalla barra indirizzi ed esegui:

   npm run octorate-login -- --code="INCOLLA_URL" --ship

Authorize URL:
${authorizeUrl}
`);
  if (args.open) await openBrowser(authorizeUrl);
  process.exit(0);
}

const code = extractCode(args.code);
if (!code) {
  console.error("Code non trovato. Passa --code=URL_O_CODE");
  process.exit(1);
}

console.log("Scambio code → token…");
await exchangeAuthorizationCode(code, CLAUDE_REDIRECT_URI);
console.log("✓ Token salvati in .octorate-tokens.json");

if (args.ship) {
  await shipTokens();
} else {
  console.log("Poi: npm run octorate-login -- --ship   (se i token ci sono già)");
  console.log("oppure riesegui con --ship insieme a --code");
}

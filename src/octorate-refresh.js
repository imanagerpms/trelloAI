/**
 * Rinnova l'access token Octorate usando il refresh_token salvato.
 *
 *   npm run octorate-refresh
 *   npm run octorate-refresh -- --ship   # copia token sul server + pm2 restart
 *
 * Se il refresh fallisce (token revocato), apri /oauth/login sul server
 * oppure: npm run octorate-capture
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "dotenv";
import {
  forceRefreshOctorateToken,
  getOctorateTokenStatus,
  getRedirectUri,
} from "./octorate-auth.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
config({ path: join(projectRoot, ".env") });

const wantShip = process.argv.includes("--ship");

function loginHint() {
  try {
    return getRedirectUri().replace("/oauth/callback", "/oauth/login");
  } catch {
    return "/oauth/login (imposta PUBLIC_BASE_URL)";
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

const before = getOctorateTokenStatus();
console.log("Stato attuale:", JSON.stringify(before, null, 2));

try {
  const tokens = await forceRefreshOctorateToken();
  const after = getOctorateTokenStatus();
  console.log("✓ Token rinnovato");
  console.log(
    `  expires_at: ${after.expiresAt || new Date(tokens.expires_at).toISOString()}`
  );
  console.log(`  obtained_at: ${after.obtainedAt || tokens.obtained_at}`);
  if (wantShip) {
    await shipTokens();
  } else {
    console.log("Suggerimento: npm run octorate-refresh -- --ship  (per aggiornare il server)");
  }
} catch (err) {
  console.error("✗ Refresh fallito:", err.message);
  console.error(`  Rifai login: ${loginHint()}`);
  console.error("  Oppure in locale: npm run octorate-capture");
  process.exitCode = 1;
}

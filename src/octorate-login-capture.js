/**
 * Login OAuth Octorate: usa Chrome di sistema e intercetta ?code=
 * prima che Cloudflare/Claude lo consumino.
 *
 *   npm run octorate-capture
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { chromium } from "playwright";
import {
  exchangeAuthorizationCode,
  buildAuthorizeUrl,
} from "./octorate-auth.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
config({ path: join(projectRoot, ".env") });

const CLAUDE_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

function extractCodeFromUrl(raw) {
  try {
    const u = new URL(raw);
    return u.searchParams.get("code");
  } catch {
    const m = String(raw).match(/[?&]code=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
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

const state = randomBytes(8).toString("hex");
const authorizeUrl = buildAuthorizeUrl(state, CLAUDE_REDIRECT_URI);

console.log(`
Apro Chrome (sistema). Nella finestra:
  1) Login Octorate (se chiesto)
  2) Autorizza l'accesso
NON serve passare Cloudflare di Claude — intercettiamo il code prima.
`);

let capturedCode = null;
const markCode = (url, source) => {
  if (capturedCode) return;
  const code = extractCodeFromUrl(url);
  if (code) {
    capturedCode = code;
    console.log(`✓ Code intercettato (${source})`);
  }
};

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--disable-blink-features=AutomationControlled"],
});
const context = await browser.newContext();
const page = await context.newPage();

// Qualsiasi URL con code= (redirect OAuth)
await page.route("**/*", async (route) => {
  const reqUrl = route.request().url();
  markCode(reqUrl, "route");
  if (capturedCode && /claude\.ai/i.test(reqUrl)) {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><body style="font-family:system-ui;padding:2rem">
        <h1>Code catturato</h1>
        <p>Puoi chiudere questa finestra e tornare in Cursor.</p>
      </body></html>`,
    });
    return;
  }
  await route.continue();
});

page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) markCode(frame.url(), "navigate");
});

page.on("response", (response) => {
  const loc = response.headers()["location"];
  if (loc) markCode(loc, "Location header");
});

await page.goto(authorizeUrl, { waitUntil: "domcontentloaded" });

const deadline = Date.now() + 5 * 60 * 1000;
while (!capturedCode && Date.now() < deadline) {
  await page.waitForTimeout(300);
  try {
    markCode(page.url(), "poll");
  } catch {
    /* ignore */
  }
}

await browser.close();

if (!capturedCode) {
  console.error(
    "Timeout: nessun code. Completa login+autorizza su Octorate entro 5 minuti."
  );
  process.exit(1);
}

console.log("Scambio code → token…");
await exchangeAuthorizationCode(capturedCode, CLAUDE_REDIRECT_URI);
console.log("✓ Token salvati in .octorate-tokens.json");
await shipTokens();

/**
 * OAuth per Octorate MCP (access token utente).
 * Redirect pubblico (Scaleway HTTPS), non localhost.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const tokensPath = join(projectRoot, ".octorate-tokens.json");

const ISSUER = "https://mcp.octorate.com";
const DEFAULT_SCOPES = [
  "api_read_accommodation",
  "api_write_accommodation",
  "api_read_reservation",
  "api_write_reservation",
  "api_card_read",
].join(" ");

export function getRedirectUri() {
  if (process.env.OCTORATE_OAUTH_REDIRECT_URI) {
    return process.env.OCTORATE_OAUTH_REDIRECT_URI;
  }
  const publicBase = process.env.PUBLIC_BASE_URL;
  if (publicBase) {
    return `${publicBase.replace(/\/$/, "")}/oauth/callback`;
  }
  throw new Error(
    "Imposta OCTORATE_OAUTH_REDIRECT_URI o PUBLIC_BASE_URL (es. https://51-15-x-x.sslip.io)"
  );
}

export function getOctorateCredentials() {
  const clientId = process.env.OCTORATE_MCP_PUBLIC;
  const clientSecret = process.env.OCTORATE_MCP_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Mancano OCTORATE_MCP_PUBLIC e/o OCTORATE_MCP_SECRET nel .env"
    );
  }
  return { clientId, clientSecret };
}

function loadTokens() {
  if (!existsSync(tokensPath)) return null;
  try {
    return JSON.parse(readFileSync(tokensPath, "utf8"));
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), "utf8");
}

async function fetchOAuthMeta() {
  const res = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`);
  if (!res.ok) throw new Error(`OAuth metadata ${res.status}`);
  return res.json();
}

export async function exchangeToken(body) {
  const meta = await fetchOAuthMeta();
  const { clientId, clientSecret } = getOctorateCredentials();
  const params = new URLSearchParams({
    ...body,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Autenticazione Octorate fallita: risposta token non valida. Rifai /oauth/login sul server."
    );
  }
  if (!res.ok) {
    throw new Error(
      `Autenticazione Octorate fallita (HTTP ${res.status}). Rifai /oauth/login; se persiste verifica PUBLIC/SECRET e redirect URI.`
    );
  }
  const access = data.access_token || data.accessToken;
  const refresh = data.refresh_token || data.refreshToken;
  if (!access) {
    throw new Error(
      "Autenticazione Octorate fallita: manca access_token. Rifai /oauth/login sul server."
    );
  }
  const expiresIn = Number(data.expires_in || 3600);
  const saved = {
    access_token: access,
    refresh_token: refresh || loadTokens()?.refresh_token || null,
    expires_at: Date.now() + expiresIn * 1000 - 60_000,
    obtained_at: new Date().toISOString(),
  };
  saveTokens(saved);
  return saved;
}

export async function exchangeAuthorizationCode(
  code,
  redirectUri = getRedirectUri()
) {
  try {
    return await exchangeToken({
      grant_type: "code",
      code,
      redirect_uri: redirectUri,
    });
  } catch (firstErr) {
    try {
      return await exchangeToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      });
    } catch {
      throw firstErr;
    }
  }
}

export async function getOctorateAccessToken() {
  const envTok = process.env.OCTORATE_MCP_ACCESS_TOKEN;
  if (envTok) return envTok;

  let tokens = loadTokens();
  if (!tokens?.access_token && !tokens?.refresh_token) {
    throw new Error(
      "Octorate non autenticato. Apri /oauth/login sul server pubblico."
    );
  }

  if (
    tokens.access_token &&
    tokens.expires_at &&
    Date.now() < tokens.expires_at
  ) {
    return tokens.access_token;
  }

  if (!tokens.refresh_token) {
    throw new Error(
      "Access token scaduto senza refresh. Rifai /oauth/login"
    );
  }

  tokens = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
  return tokens.access_token;
}

export function buildAuthorizeUrl(state, redirectUri = getRedirectUri()) {
  const { clientId } = getOctorateCredentials();
  const u = new URL(`${ISSUER}/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set(
    "scope",
    process.env.OCTORATE_MCP_SCOPES || DEFAULT_SCOPES
  );
  u.searchParams.set("state", state);
  return u.toString();
}

/** Stato OAuth in memoria (login web sul server). */
const pendingStates = new Map();

export function beginOAuthLogin() {
  const state = randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now());
  // cleanup vecchi
  for (const [k, t] of pendingStates) {
    if (Date.now() - t > 10 * 60 * 1000) pendingStates.delete(k);
  }
  return {
    state,
    authorizeUrl: buildAuthorizeUrl(state),
    redirectUri: getRedirectUri(),
  };
}

export function takeOAuthState(state) {
  if (!pendingStates.has(state)) return false;
  pendingStates.delete(state);
  return true;
}

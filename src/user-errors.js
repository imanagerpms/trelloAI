/**
 * Converte errori tecnici (API, rete, MCP) in messaggi comprensibili in italiano.
 */

function detectService(raw, explicit) {
  if (explicit) return explicit;
  const s = String(raw || "").toLowerCase();
  if (s.includes("octorate") || s.includes("oauth")) return "octorate";
  if (s.includes("trello")) return "trello";
  if (s.includes("openai") || s.includes("anthropic")) return "llm";
  return null;
}

function serviceLabel(service) {
  switch (service) {
    case "octorate":
      return "Octorate";
    case "trello":
      return "Trello";
    case "llm":
      return "Il modello AI";
    default:
      return "Il servizio";
  }
}

/** Messaggi già scritti da noi in italiano: non riscrivere. */
function alreadyHumanItalian(msg) {
  const m = String(msg || "").trim();
  if (!m || m.length > 400) return false;
  // Evita di passare inglese grezzo tipo "unauthorized permission requested"
  if (
    /\b(unauthorized|forbidden|not found|internal server|bad gateway|ECONN|ENOTFOUND|fetch failed|Token exchange|API error)\b/i.test(
      m
    )
  ) {
    return false;
  }
  return /[àèéìòù]|\b(non |mancant|imposta |apri |controlla |riprova|scadut|collegat|indica |orario|credenzial|struttura|token)\b/i.test(
    m
  );
}

/**
 * @param {unknown} err
 * @param {{ service?: 'octorate'|'trello'|'llm'|null, status?: number }} [opts]
 * @returns {string}
 */
export function humanizeError(err, opts = {}) {
  const raw = String(err?.message || err || "errore sconosciuto").trim();
  const status = opts.status ?? err?.status ?? null;
  const service = detectService(raw, opts.service);
  const label = serviceLabel(service);
  const lower = raw.toLowerCase();

  if (alreadyHumanItalian(raw)) return raw;

  const code = status || (lower.match(/\b(401|403|404|429|50[0-9])\b/) || [])[1];

  // Auth / permessi (prima dei timeout: "exceeded" compare anche nei rate limit)
  if (code === "401" || code === 401 || /unauthoriz|invalid.?token|expired.?token/i.test(lower)) {
    if (service === "octorate") {
      return "Accesso Octorate non valido o scaduto. Apri /oauth/login sul server e rifai il login.";
    }
    if (service === "trello") {
      return "Accesso Trello non autorizzato. Controlla TRELLO_API_KEY e TRELLO_TOKEN nel .env.";
    }
    return "Accesso non autorizzato. Controlla le credenziali del servizio.";
  }

  if (code === "403" || code === 403 || /\bforbidden\b/i.test(lower)) {
    return `${label}: operazione non consentita (permessi insufficienti).`;
  }

  if (code === "404" || code === 404 || /\bnot found\b/i.test(lower)) {
    return `Risorsa non trovata su ${label}. Controlla ID o nome e riprova.`;
  }

  if (code === "429" || code === 429 || /rate.?limit|too many requests/i.test(lower)) {
    return `${label} ha limitato le richieste (troppe chiamate). Attendi un minuto e riprova.`;
  }

  if (
    (typeof code === "string" && /^50\d$/.test(code)) ||
    (typeof code === "number" && code >= 500) ||
    /internal server|bad gateway|service unavailable|gateway timeout/i.test(lower)
  ) {
    return `${label} ha un problema temporaneo lato server. Riprova tra poco.`;
  }

  // Timeout / abort
  if (
    err?.name === "AbortError" ||
    /abort(?:ed)?|etimedout|timed?\s*out|timeout/i.test(lower)
  ) {
    return `${label} non risponde in tempo (timeout). Riprova tra poco.`;
  }

  // Rete
  if (
    /econnrefused|enotfound|eai_again|econnreset|fetch failed|network|socket|getaddrinfo/i.test(
      lower
    )
  ) {
    return `${label} non è raggiungibile (problema di rete). Verifica connessione o stato del servizio, poi riprova.`;
  }

  // Server MCP assente
  if (/server mcp sconosciuto:\s*octorate/i.test(lower)) {
    return "Octorate non è collegato al bot (login assente o scaduto). Apri /oauth/login sul server pubblico e autorizza di nuovo.";
  }
  if (/server mcp sconosciuto:\s*trello/i.test(lower)) {
    return "Trello non è collegato al bot. Controlla TRELLO_API_KEY e TRELLO_TOKEN nel .env, poi riavvia il bot.";
  }
  if (/server mcp sconosciuto/i.test(lower)) {
    return `Servizio non disponibile al momento (${raw.replace(/^Server MCP sconosciuto:\s*/i, "")}). Riprova o verifica la configurazione.`;
  }

  if (/token exchange|token endpoint|access_token/i.test(lower)) {
    return "Autenticazione Octorate fallita (scambio token). Rifai /oauth/login sul server; se persiste, verifica PUBLIC/SECRET e redirect URI.";
  }

  if (/credenziali trello mancanti|trello_api_key/i.test(lower)) {
    return "Credenziali Trello mancanti. Imposta TRELLO_API_KEY e TRELLO_TOKEN nel file .env.";
  }

  // Fallback: messaggio chiaro + dettaglio tecnico corto
  const tech = raw.replace(/\s+/g, " ").slice(0, 140);
  return `${label} non è riuscito a completare l'operazione. Dettaglio: ${tech}`;
}

/**
 * @param {unknown} err
 * @param {{ service?: string, status?: number }} [opts]
 * @returns {Error}
 */
export function toUserFacingError(err, opts = {}) {
  const message = humanizeError(err, opts);
  const e = new Error(message);
  e.cause = err instanceof Error ? err : undefined;
  e.technical = String(err?.message || err || "");
  if (opts.status != null) e.status = opts.status;
  if (opts.service) e.service = opts.service;
  return e;
}

/** Indovina il servizio dal nome tool agent/MCP. */
export function serviceFromToolName(name, args = {}) {
  const n = String(name || "");
  if (n.startsWith("octorate_") || n.includes("octorate")) return "octorate";
  if (n.startsWith("trello_") || n === "schedula_moduli") return "trello";
  if (n === "mcp_call_tool" && args?.server) {
    const s = String(args.server).toLowerCase();
    if (s === "octorate" || s === "trello") return s;
  }
  return null;
}

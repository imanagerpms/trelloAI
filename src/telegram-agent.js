import { schedulaModuli } from "./schedula-moduli.js";
import {
  buildMcpToolDefinitions,
  executeMcpTool,
} from "./mcp-hub.js";
import {
  buildSystemPrompt,
  getAccommodationMap,
  getMasterAccommodationIds,
  getSpazioComunePesi,
  getStaffDefaults,
  getTurniMaxCarico,
  getTurniWeights,
} from "./runtime-config.js";
import {
  DEFAULT_FINESTRA_TIME,
  normalizeArrivalTime,
  pmsNameToModuleSigla,
  romeLocalToUtcIso,
  shortRoomCode,
} from "./module-sigla.js";
import { humanizeError, serviceFromToolName, toUserFacingError } from "./user-errors.js";

function getLlmConfig() {
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    };
  }
  return null;
}

export function hasLlmConfigured() {
  return Boolean(getLlmConfig());
}

function localToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "octorate_arrivi",
        description:
          "Elenco prenotazioni in arrivo da Octorate. Restituisce SOLO prenotazioni attive (esclude cancellate e proposte).",
        parameters: {
          type: "object",
          properties: {
            when: {
              type: "string",
              description: "TODAYARRIVALS | TOMORROWARRIVALS | NEXT3ARRIVALS | NEXT7ARRIVALS",
              enum: [
                "TODAYARRIVALS",
                "TOMORROWARRIVALS",
                "NEXT3ARRIVALS",
                "NEXT7ARRIVALS",
              ],
            },
            accommodationId: {
              type: "string",
              description: "Opzionale: ID struttura Octorate. Se assente, cerca su tutte.",
            },
            accommodationName: {
              type: "string",
              description: "Opzionale: filtro nome struttura (contains).",
            },
            limitPerProperty: {
              type: "number",
              description: "Max risultati per struttura (default 30)",
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "octorate_camere",
        description:
          "Stato camere per una struttura in una data/range. LIBERA = availability>0 tutte le notti; FINESTRA = checkout+checkin lo stesso giorno (manutenzione tra ospiti, scadenza=arrivalTime); OCCUPATA = altrimenti non disponibile. Espone libere[] e finestre[] con sigla Manutenzioni.",
        parameters: {
          type: "object",
          properties: {
            accommodationId: {
              type: "string",
              description: "ID struttura Octorate",
            },
            accommodationName: {
              type: "string",
              description: "Nome struttura (contains), es. In the center you too",
            },
            date: {
              type: "string",
              description:
                "Giorno da controllare yyyy-MM-dd (timezone Roma). Default: oggi.",
            },
            nights: {
              type: "number",
              description:
                "Notti da coprire a partire da date (default 1). Es. 1 notte = solo quella data.",
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "octorate_pulizie",
        description:
          "Lista camere da pulire in una data, divisa tra PARTENZE (checkout) e FERMATE, con numero persone e note. Attribuisce alla camera FISICA del PMS Tableau (segue gli spostamenti di rete). Ritorna partenzeConEntrata/entrate (ROOM Np), partenzeSenzaEntrata (ROOM, pulizia completa come entrata ma senza Np), fermateConCambio (ROOM*, solo affittacamere: niente fermate negli appartamenti), aprireEControllare (fermate semplici e vuote). Default: oggi, tutte le strutture (escluso account master).",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description:
                "Giorno del check-in yyyy-MM-dd (timezone Roma). Default: oggi.",
            },
            accommodationId: {
              type: "string",
              description: "Opzionale: ID struttura Octorate. Se assente, tutte.",
            },
            accommodationName: {
              type: "string",
              description: "Opzionale: filtro nome struttura (contains).",
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "octorate_turni",
        description:
          "Proposta turni pulizie del giorno: assegna camere + spazi comuni alle cameriere bilanciando il carico. Pool Roma (centro + Domus Turno con +0.3 tragitto, preferita a chi ha già altre strutture) e Tenerife (default Lala/Mario). Spazi comuni SEMPRE ogni giorno. Overflow → manutentore del cluster. Solo proposta testuale. Estrai lo staff dal messaggio utente.",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Giorno yyyy-MM-dd (timezone Roma). Default: oggi.",
            },
            cameriere: {
              type: "number",
              description:
                "Numero cameriere pool Roma/centro (default 2). Se conosci i nomi, passa anche cameriereNomi.",
            },
            cameriereNomi: {
              type: "array",
              items: { type: "string" },
              description:
                "Nomi cameriere pool Roma/centro (se presente, ha priorità su cameriere). Domus Turno può essere assegnata a una di queste.",
            },
            cameriereTurno: {
              type: "number",
              description:
                "Staff dedicato Domus Turno: passa SOLO se l'utente lo chiede esplicitamente (default: nessuno; DT va a una cameriera Roma).",
            },
            cameriereTurnoNomi: {
              type: "array",
              items: { type: "string" },
              description:
                "Nomi staff dedicato Domus Turno (solo se richiesto esplicitamente; altrimenti lascia vuoto).",
            },
            cameriereTenerife: {
              type: "number",
              description: "Numero cameriere Tenerife (default 1 = Lala).",
            },
            cameriereTenerifeNomi: {
              type: "array",
              items: { type: "string" },
              description:
                "Nomi cameriere Tenerife (default [\"Lala\"]).",
            },
            manutentoreDisponibile: {
              type: "boolean",
              description:
                "Manutentore Roma (pool centro + Domus Turno). Default true.",
            },
            manutentoreTenerifeDisponibile: {
              type: "boolean",
              description:
                "Manutentore Tenerife (Mario). Default true.",
            },
            manutentoreTenerifeNome: {
              type: "string",
              description: "Nome manutentore Tenerife (default Mario).",
            },
            assenze: {
              type: "array",
              items: { type: "string" },
              description: "Nomi assenti da escludere dallo staff.",
            },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "schedula_moduli",
        description:
          "Schedula task Manutenzioni per moduli liberi/finestra (IN ESECUZIONE / Periodici / Settimana). moduleDues: scadenze per-modulo HH:MM (finestre turnover).",
        parameters: {
          type: "object",
          properties: {
            modules: { type: "array", items: { type: "string" } },
            due: { type: "string" },
            moduleDues: {
              type: "object",
              additionalProperties: { type: "string" },
              description: 'Es. {"NR3":"15:00","ITC301":"14:30"} — orario Europe/Rome sul giorno di due',
            },
            dryRun: { type: "boolean" },
          },
          required: ["modules", "due"],
          additionalProperties: false,
        },
      },
    },
  ];
}

function allToolDefinitions() {
  return [...buildMcpToolDefinitions(), ...localToolDefinitions()];
}

async function callOpenAI(messages, { apiKey, model, baseUrl }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      tools: allToolDefinitions(),
      tool_choice: "auto",
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json();
  if (!res.ok) {
    throw toUserFacingError(
      new Error(data.error?.message || `OpenAI error ${res.status}`),
      { service: "llm", status: res.status }
    );
  }
  return data.choices?.[0]?.message;
}

function toAnthropicTools() {
  return allToolDefinitions().map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

async function callAnthropic(messages, { apiKey, model }) {
  const system = messages.find((m) => m.role === "system")?.content || "";
  const converted = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "assistant" && m.tool_calls?.length) {
      converted.push({
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.tool_calls.map((tc) => ({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || "{}"),
          })),
        ],
      });
      continue;
    }
    if (m.role === "tool") {
      const prev = converted[converted.length - 1];
      const block = {
        type: "tool_result",
        tool_use_id: m.tool_call_id,
        content: m.content,
      };
      if (prev?.role === "user" && Array.isArray(prev.content)) {
        prev.content.push(block);
      } else {
        converted.push({ role: "user", content: [block] });
      }
      continue;
    }
    converted.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content || "",
    });
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      tools: toAnthropicTools(),
      messages: converted,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json();
  if (!res.ok) {
    throw toUserFacingError(
      new Error(data.error?.message || `Anthropic error ${res.status}`),
      { service: "llm", status: res.status }
    );
  }

  const text = (data.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
  const toolUses = (data.content || []).filter((c) => c.type === "tool_use");

  if (!toolUses.length) {
    return { role: "assistant", content: text };
  }

  return {
    role: "assistant",
    content: text || null,
    tool_calls: toolUses.map((t) => ({
      id: t.id,
      type: "function",
      function: {
        name: t.name,
        arguments: JSON.stringify(t.input || {}),
      },
    })),
  };
}

async function callLlm(messages) {
  const cfg = getLlmConfig();
  if (!cfg) {
    throw new Error(
      "Manca una API LLM. Aggiungi OPENAI_API_KEY o ANTHROPIC_API_KEY nel .env"
    );
  }
  if (cfg.provider === "openai") return callOpenAI(messages, cfg);
  return callAnthropic(messages, cfg);
}

/** Stati prenotazione considerati "attivi" per gli arrivi. */
const ACTIVE_ARRIVAL_STATUSES = new Set([
  "CONFIRMED",
  "ACTIVE",
  "WAITING",
  "NOROOM",
  "NOCOMPLETED",
  "NOT_INVOICED",
  "DEPOSIT_NOT_MANAGED",
  "DEPOSIT_IN_WAITING",
  "TO_REVIEW",
  "NEWMESSAGE",
  "EXPIREDMESSAGE",
]);

/**
 * Strutture da ignorare: account "master" che vedono l'intera rete e
 * duplicherebbero i risultati (es. "local domus" 538465).
 */
function isMasterAccommodation(id) {
  return getMasterAccommodationIds().has(String(id));
}

/**
 * Config operativa strutture: da config/accommodations.json (UI Admin).
 */
function getAccConfig(accId) {
  const map = getAccommodationMap();
  return (
    map[String(accId)] || {
      code: String(accId),
      cluster: "centro",
      tipo: "affittacamere",
      bagnoInCamera: true,
      appartamentoPeso: 1,
      spaziComuni: [],
    }
  );
}

function turniWeights() {
  return getTurniWeights();
}

function spazioComunePesi() {
  return getSpazioComunePesi();
}

function turniMaxCarico() {
  return getTurniMaxCarico();
}

function isAppartamentoUnit(cameraName = "") {
  const n = String(cameraName).toLowerCase();
  return (
    n.includes("appartamento") ||
    n.includes("by local domus") ||
    n.includes("intero appartamento")
  );
}

/** Appartamento intero (struttura o unità): niente fermate. */
function isAppartamentoContext(cfg, cameraName = "") {
  return cfg?.tipo === "appartamento" || isAppartamentoUnit(cameraName);
}

function fullCleanRoomWeight(cfg) {
  return cfg.bagnoInCamera
    ? turniWeights().CAMERA_BAGNO_IN_CAMERA
    : turniWeights().CAMERA_BAGNO_CONDIVISO;
}

function spaziComuniWeighted(cfg) {
  if (cfg.tipo !== "affittacamere" || !cfg.spaziComuni?.length) return null;
  const items = cfg.spaziComuni.map((x) => ({
    nome: `${cfg.code} ${x}`,
    tipo: x,
    peso: spazioComunePesi()[x] ?? 0.1,
  }));
  return {
    items: items.map((i) => i.nome),
    dettaglio: items,
    peso: items.reduce((s, i) => s + i.peso, 0),
  };
}

function isActiveArrival(res) {
  const status = String(res?.status || "").toUpperCase();
  if (!status) return false;
  if (status === "CANCELLED" || status.startsWith("PROPOSAL")) return false;
  return ACTIVE_ARRIVAL_STATUSES.has(status);
}

function guestName(res) {
  const guests = res.guests || [];
  const booker = guests.find((g) => g.type === "BOOKER") || guests[0];
  return (
    [res.firstName, res.lastName].filter(Boolean).join(" ") ||
    booker?.customerName ||
    booker?.name ||
    "—"
  );
}

/**
 * ID struttura (accommodation) reale della prenotazione.
 * findReservations restituisce l'intera RETE: ogni riga porta il suo accommodation.
 */
function reservationAccId(res) {
  const a = res?.accommodation;
  if (a && typeof a === "object" && a.id != null) return String(a.id);
  if (res?.accommodationId != null) return String(res.accommodationId);
  if (a != null && typeof a !== "object") return String(a);
  return null;
}

function reservationAccName(res, nameById) {
  const a = res?.accommodation;
  if (a && typeof a === "object" && a.name) return a.name;
  const id = reservationAccId(res);
  if (id && nameById?.get(id)) return nameById.get(id);
  return id ? `id:${id}` : "—";
}

/**
 * Riepilogo prenotazione sui 3 livelli Octorate:
 *  - struttura   (accommodation: codice numerico + nome)
 *  - derivata    (product = tipo/derivata logica, pmsProduct = camera fisica, roomName)
 *  - tipologia   (stato prenotazione)
 */
function summarizeReservation(res, nameById) {
  const accId = reservationAccId(res);
  return {
    id: res.id,
    struttura: { id: accId, name: reservationAccName(res, nameById) },
    derivata: {
      pmsProduct: res.pmsProduct ?? null,
      product: res.product ?? null,
      roomName: res.roomName || null,
    },
    tipologia: res.status,
    checkin: res.checkin,
    checkout: res.checkout,
    guest: guestName(res),
    source: res.source || res.channelName || res.portal || undefined,
    refer: res.refer || undefined,
  };
}

/**
 * Arrivi Octorate su una o più strutture (solo prenotazioni attive).
 * @param {import('./mcp-hub.js').McpHub} hub
 */
async function octorateArrivi(hub, args = {}) {
  const when = args.when || "TODAYARRIVALS";
  const limitPerProperty = Math.min(Number(args.limitPerProperty) || 50, 200);

  let allAcc = await hub.callTool("octorate", "retrieveAccommodations", {});
  if (!Array.isArray(allAcc)) {
    allAcc = allAcc?.data || allAcc?.content || [];
  }
  // Escludi gli account master (es. "local domus" 538465): vedono l'intera rete e duplicano
  allAcc = allAcc.filter((a) => !isMasterAccommodation(a.id));
  const nameById = new Map(
    allAcc.map((a) => [String(a.id), a.name || a.internalName || String(a.id)])
  );

  // Strutture richieste (default: tutte)
  let targets = allAcc;
  if (args.accommodationId) {
    targets = allAcc.filter((a) => String(a.id) === String(args.accommodationId));
    if (!targets.length) targets = [{ id: args.accommodationId }];
  } else if (args.accommodationName) {
    const q = args.accommodationName.toLowerCase();
    targets = allAcc.filter((a) =>
      (a.name || a.internalName || "").toLowerCase().includes(q)
    );
  }
  const targetIds = new Set(targets.map((a) => String(a.id)));

  const seen = new Map(); // reservation id → summary (dedup: la rete torna righe condivise)
  const errors = [];
  let rawCount = 0;
  let skippedInactive = 0;
  let skippedOtherStructure = 0;

  const slice = targets.slice(0, 100);
  const concurrency = 5;
  for (let i = 0; i < slice.length; i += concurrency) {
    const batch = slice.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (acc) => {
        const id = String(acc.id);
        try {
          const raw = await hub.callTool("octorate", "findReservations", {
            accommodation: id,
            type: when,
            size: limitPerProperty,
          });
          const rows = Array.isArray(raw) ? raw : raw?.data || raw?.content || [];
          return { ok: true, rows };
        } catch (e) {
          return {
            ok: false,
            id,
            name: nameById.get(id) || id,
            error: humanizeError(e, { service: "octorate" }),
          };
        }
      })
    );
    for (const r of results) {
      if (!r.ok) {
        errors.push({ accommodation: r.name, id: r.id, error: r.error });
        continue;
      }
      rawCount += r.rows.length;
      for (const row of r.rows) {
        if (!isActiveArrival(row)) {
          skippedInactive += 1;
          continue;
        }
        const accId = reservationAccId(row);
        // Ignora le righe dell'account master (local domus): duplicano la rete
        if (isMasterAccommodation(accId)) {
          skippedOtherStructure += 1;
          continue;
        }
        // Attribuisci alla struttura REALE della prenotazione; scarta il leak di rete
        if (accId && targetIds.size && !targetIds.has(accId)) {
          skippedOtherStructure += 1;
          continue;
        }
        const rid = String(row.id);
        if (seen.has(rid)) continue;
        seen.set(rid, summarizeReservation(row, nameById));
      }
    }
  }

  const arrivals = [...seen.values()].sort((a, b) =>
    String(a.checkin).localeCompare(String(b.checkin))
  );

  // Raggruppa per struttura per una lettura chiara
  const byStruttura = {};
  for (const a of arrivals) {
    const key = a.struttura?.name || a.struttura?.id || "—";
    (byStruttura[key] ||= []).push(a);
  }

  return {
    when,
    onlyActive: true,
    structuresQueried: slice.length,
    count: arrivals.length,
    skippedInactive,
    skippedOtherStructure,
    rawFetched: rawCount,
    byStruttura,
    arrivals,
    errors: errors.length ? errors : undefined,
  };
}

function romeDateISO(offsetDays = 0) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year").value);
  const m = Number(parts.find((p) => p.type === "month").value);
  const d = Number(parts.find((p) => p.type === "day").value);
  const utc = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return utc.toISOString().slice(0, 10);
}

function addDaysISO(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

/**
 * Contesto data/ora attuale (Europe/Rome) da iniettare nel system prompt,
 * così l'agente sa sempre com'è "oggi", "domani", giorno della settimana e ora.
 */
function buildNowContext() {
  const now = new Date();
  const human = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  const oggi = romeDateISO(0);
  const domani = romeDateISO(1);
  const dopodomani = romeDateISO(2);
  return `## Data e ora attuali (Europe/Rome)
Adesso è: ${human}.
oggi = ${oggi} | domani = ${domani} | dopodomani = ${dopodomani} (formato yyyy-MM-dd).
Usa SEMPRE questi valori per interpretare "oggi", "domani", "questa settimana", ecc. Non dedurre la data da altre fonti.`;
}

/**
 * Legge tutto il calendario (paginato) di una struttura e ritorna
 * una mappa productId -> array di giorni { date, availability, bookable, stopSells, price, minStay }.
 * @param {import('./mcp-hub.js').McpHub} hub
 */
async function readCalendarAll(hub, accId, dateFrom, dateTo) {
  /** @type {Map<string, object[]>} */
  const byProduct = new Map();
  const size = 50;
  for (let page = 0; page <= 20; page += 1) {
    const raw = await hub.callTool("octorate", "readCalendar", {
      accommodation: accId,
      dateFrom,
      dateTo,
      size,
      page,
    });
    const data = Array.isArray(raw) ? raw : raw?.data || [];
    for (const prod of data) {
      byProduct.set(String(prod.id), prod.days || []);
    }
    if (data.length < size) break;
  }
  return byProduct;
}

/**
 * Camere PMS libere/occupate/finestra per una struttura, basate sulla disponibilità reale.
 *  - Fonte disponibilità: readCalendar (availability per prodotto/giorno).
 *  - Nomi camere fisiche: findPmsRoom (mappate via parentId -> id prodotto calendario).
 *  - findReservations: motivo occupazione + rilevamento FINESTRA (checkout+checkin lo stesso giorno).
 * Regola: LIBERA = availability > 0 per tutte le notti; FINESTRA = non libera ma checkout+checkin su `date`;
 *         OCCUPATA = altrimenti non disponibile.
 * @param {import('./mcp-hub.js').McpHub} hub
 */
async function octorateCamere(hub, args = {}) {
  const date = args.date || romeDateISO(0);
  const nights = Math.max(1, Math.min(Number(args.nights) || 1, 14));
  const endDate = addDaysISO(date, nights - 1);
  // Il range di notti copre le date [date .. endDate] (una notte = una data).
  const rangeDates = [];
  for (let i = 0; i < nights; i += 1) rangeDates.push(addDaysISO(date, i));
  const inRange = (d) => d >= date && d <= endDate;

  let accommodations = await hub.callTool("octorate", "retrieveAccommodations", {
    ...(args.accommodationName ? { name: args.accommodationName } : {}),
  });
  if (!Array.isArray(accommodations)) {
    accommodations = accommodations?.data || accommodations?.content || [];
  }
  // Escludi gli account master (es. "local domus" 538465): duplicherebbero le camere
  accommodations = accommodations.filter((a) => !isMasterAccommodation(a.id));
  if (args.accommodationId && isMasterAccommodation(args.accommodationId)) {
    throw new Error(
      `La struttura ${args.accommodationId} è un account master (local domus) che aggrega l'intera rete: indica una struttura specifica.`
    );
  }
  if (args.accommodationId) {
    accommodations = accommodations.filter(
      (a) => String(a.id) === String(args.accommodationId)
    );
    if (!accommodations.length) {
      accommodations = [
        { id: args.accommodationId, name: `id:${args.accommodationId}` },
      ];
    }
  }
  if (!accommodations.length) {
    throw new Error(
      "Nessuna struttura trovata. Specifica accommodationName o accommodationId."
    );
  }
  if (!args.accommodationId && !args.accommodationName && accommodations.length > 1) {
    return {
      needChoice: true,
      message:
        "Più strutture disponibili: indica il nome o l'ID, poi richiamo octorate_camere.",
      accommodations: accommodations.map((a) => ({
        id: a.id,
        name: a.name || a.internalName,
      })),
    };
  }

  const acc = accommodations[0];
  const accId = String(acc.id);
  const accName = acc.name || acc.internalName || accId;

  const roomsRaw = await hub.callTool("octorate", "findPmsRoom", {
    accommodation: accId,
  });
  const rooms = Array.isArray(roomsRaw) ? roomsRaw : roomsRaw?.data || [];

  // Disponibilità reale dal calendario (fonte autorevole)
  const calByProduct = await readCalendarAll(hub, accId, date, endDate);

  // Prenotazioni attive di QUESTA struttura (motivo + finestre turnover)
  const stayRaw = await hub.callTool("octorate", "findReservations", {
    accommodation: accId,
    type: "STAY",
    startDate: date,
    endDate,
    size: 200,
  });
  const stayRows = Array.isArray(stayRaw) ? stayRaw : stayRaw?.data || [];
  const active = stayRows.filter(
    (r) => isActiveArrival(r) && reservationAccId(r) === accId
  );
  /** @type {Map<string, object[]>} pmsProduct -> prenotazioni */
  const resByRoom = new Map();
  const unassigned = [];
  for (const r of active) {
    const roomId = r.pmsProduct != null ? String(r.pmsProduct) : null;
    const brief = {
      id: r.id,
      tipologia: r.status,
      guest: guestName(r),
      derivata: {
        pmsProduct: r.pmsProduct ?? null,
        product: r.product ?? null,
        roomName: r.roomName || null,
      },
      checkin: r.checkin,
      checkout: r.checkout,
      arrivalTime: r.arrivalTime || "",
      channel: r.channelName,
      isCheckout: dateOnly(r.checkout) === date,
      isCheckin: dateOnly(r.checkin) === date,
    };
    if (!roomId) {
      unassigned.push(brief);
      continue;
    }
    if (!resByRoom.has(roomId)) resByRoom.set(roomId, []);
    resByRoom.get(roomId).push(brief);
  }

  const camere = rooms.map((room) => {
    const productId = room.parentId != null ? String(room.parentId) : null;
    const days = (productId ? calByProduct.get(productId) : null) || [];
    const availabilityByDay = days
      .filter((d) => inRange(d.date))
      .map((d) => ({
        date: d.date,
        availability: d.availability,
        bookable: d.bookable,
        stopSells: d.stopSells,
      }));
    const hasCalendar = availabilityByDay.length > 0;
    const availAllNights =
      hasCalendar && availabilityByDay.every((d) => (d.availability || 0) > 0);
    const availSomeNights =
      hasCalendar && availabilityByDay.some((d) => (d.availability || 0) > 0);
    const anyStopSell = availabilityByDay.some((d) => d.stopSells);
    const disponibile = availAllNights;

    const reservations = resByRoom.get(String(room.id)) || [];
    const checkoutRes = reservations.find((r) => r.isCheckout);
    const checkinRes = reservations.find((r) => r.isCheckin);
    const isFinestra = !disponibile && Boolean(checkoutRes && checkinRes);

    let motivo;
    if (isFinestra) {
      motivo = "finestra turnover (checkout + checkin)";
    } else if (!disponibile) {
      if (reservations.length) motivo = "prenotazione";
      else if (anyStopSell) motivo = "stop-sell";
      else if (hasCalendar) motivo = "chiusa / restrizione";
      else motivo = "nessun dato calendario";
    }

    const arrivalTime =
      normalizeArrivalTime(checkinRes?.arrivalTime) ||
      (isFinestra ? DEFAULT_FINESTRA_TIME : null);
    const scadenzaSuggerita =
      isFinestra && arrivalTime ? romeLocalToUtcIso(date, arrivalTime) : null;
    const sigla = pmsNameToModuleSigla(room.name);

    let stato = "OCCUPATA";
    if (disponibile) stato = "LIBERA";
    else if (isFinestra) stato = "FINESTRA";

    return {
      id: room.id,
      name: room.name,
      sigla,
      parentId: room.parentId,
      stato,
      disponibile,
      finestra: isFinestra,
      arrivalTime: isFinestra ? arrivalTime : undefined,
      ospiteInUscita: isFinestra ? checkoutRes?.guest : undefined,
      ospiteInEntrata: isFinestra ? checkinRes?.guest : undefined,
      scadenzaSuggerita: scadenzaSuggerita || undefined,
      availAllNights,
      availSomeNights,
      motivo,
      availabilityByDay,
      reservationCount: reservations.length,
      reservations,
    };
  });

  // Prenotazioni su pmsProduct non presenti in findPmsRoom (altre unità / rete)
  const known = new Set(rooms.map((r) => String(r.id)));
  const orphanRoomIds = [...resByRoom.keys()].filter((id) => !known.has(id));
  const orphanRooms = orphanRoomIds.map((id) => ({
    id: Number(id) || id,
    name: resByRoom.get(id)?.[0]?.derivata?.roomName || `pmsProduct ${id}`,
    stato: "OCCUPATA",
    disponibile: false,
    motivo: "prenotazione",
    reservationCount: resByRoom.get(id).length,
    reservations: resByRoom.get(id),
    note: "Unità non in findPmsRoom di questa struttura",
  }));

  const libere = camere.filter((c) => c.stato === "LIBERA");
  const finestre = camere.filter((c) => c.stato === "FINESTRA");
  const occupate = camere.filter((c) => c.stato === "OCCUPATA");

  return {
    rule: "LIBERA = availability>0 tutte le notti; FINESTRA = checkout+checkin su date (scadenza=arrivalTime o 14:00 Roma); OCCUPATA = altrimenti non disponibile",
    source: "readCalendar + findReservations",
    accommodation: { id: accId, name: accName },
    date,
    endDate,
    nights,
    totals: {
      rooms: camere.length,
      libere: libere.length,
      finestre: finestre.length,
      occupate: occupate.length,
      unassignedReservations: unassigned.length,
    },
    libere: libere.map((c) => ({ id: c.id, name: c.name, sigla: c.sigla })),
    finestre: finestre.map((c) => ({
      id: c.id,
      name: c.name,
      sigla: c.sigla,
      arrivalTime: c.arrivalTime,
      ospiteInUscita: c.ospiteInUscita,
      ospiteInEntrata: c.ospiteInEntrata,
      scadenzaSuggerita: c.scadenzaSuggerita,
    })),
    occupate: occupate.map((c) => ({
      id: c.id,
      name: c.name,
      sigla: c.sigla,
      motivo: c.motivo,
      guests: c.reservations.map((r) => r.guest),
    })),
    camere,
    orphanRooms: orphanRooms.length ? orphanRooms : undefined,
    unassignedReservations: unassigned.length ? unassigned : undefined,
  };
}

function dateOnly(s) {
  return s == null ? "" : String(s).slice(0, 10);
}

/** Differenza in giorni tra due date (anche in formato ISO con orario). */
function daysBetweenISO(fromISO, toISO) {
  const [y1, m1, d1] = dateOnly(fromISO).split("-").map(Number);
  const [y2, m2, d2] = dateOnly(toISO).split("-").map(Number);
  if (!y1 || !y2) return NaN;
  return Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000
  );
}

/**
 * Giorni (offset dal check-in) in cui va fatto il CAMBIO biancheria.
 * Obiettivo: mai più di 3 notti senza pulizia. N = notti totali del soggiorno.
 * Divide N in ceil(N/3) segmenti il più uniformi possibile (<=3 notti); i tagli
 * cumulativi interni sono i giorni di cambio. Es: N=4 -> {2} (3° giorno);
 * N=6 -> {3} (4°); N=9 -> {3,6} (4° e 7°).
 */
function linenChangeCutDays(N) {
  const cuts = new Set();
  if (!Number.isFinite(N) || N <= 3) return cuts;
  const segments = Math.ceil(N / 3);
  const base = Math.floor(N / segments);
  let rem = N - base * segments;
  let cum = 0;
  for (let i = 0; i < segments - 1; i += 1) {
    const size = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
    cum += size;
    cuts.add(cum);
  }
  return cuts;
}

/** Candidati note/richieste speciali da campi strutturati (senza scandire le chat). */
function noteCandidates(res) {
  const notes = [];
  if (res?.arrivalTime && String(res.arrivalTime).trim()) {
    notes.push(`arrivo previsto h${String(res.arrivalTime).trim()}`);
  }
  const extras = Array.isArray(res?.extraIncluded) ? res.extraIncluded : [];
  for (const e of extras) {
    const n = e?.name || e?.title || e?.product?.name;
    if (n) notes.push(`extra: ${n}`);
  }
  const cn = res?.channelNotes ? String(res.channelNotes).trim() : "";
  if (cn) notes.push(cn);
  return notes;
}

/**
 * Lista pulizie del giorno per struttura, secondo la leggenda operativa.
 * Usata da octorate_pulizie e octorate_turni.
 *
 * Fonte = PMS Tableau (assegnazione fisica), NON la roomRate. Le strutture sono in RETE:
 * una prenotazione può essere SPOSTATA sul tableau di un'altra struttura. Segnale dello
 * spostamento: la prenotazione compare anche nella query di un'ALTRA struttura della rete.
 *
 * Classificazione per camera fisica nel giorno:
 *  - checkout oggi + checkin oggi        -> PARTENZA CON ENTRATA  (ROOM Np)
 *  - checkout oggi senza entrata         -> PARTENZA SENZA ENTRATA (ROOM, pulizia come entrata senza Np)
 *  - checkin oggi su camera prima libera -> ENTRATA / prep arrivo  (ROOM Np)
 *  - soggiorno in corso, giorno di cambio-> FERMATA CON CAMBIO      (ROOM*) — solo affittacamere
 *  - soggiorno in corso, no cambio       -> FERMATA semplice (aprire e controllare) — solo affittacamere
 *  - appartamento in soggiorno           -> nessuna fermata
 *  - nessuna prenotazione                -> vuota (aprire e controllare)
 * @param {import('./mcp-hub.js').McpHub} hub
 */
async function computePulizie(hub, args = {}) {
  const date = args.date || romeDateISO(0);

  let allAcc = await hub.callTool("octorate", "retrieveAccommodations", {});
  if (!Array.isArray(allAcc)) {
    allAcc = allAcc?.data || allAcc?.content || [];
  }
  allAcc = allAcc.filter((a) => !isMasterAccommodation(a.id));
  const nameById = new Map(
    allAcc.map((a) => [String(a.id), a.name || a.internalName || String(a.id)])
  );

  if (args.accommodationId && isMasterAccommodation(args.accommodationId)) {
    throw new Error(
      `La struttura ${args.accommodationId} è un account master (local domus): indica una struttura specifica.`
    );
  }

  const errors = [];
  const resById = new Map(); // reservation id -> dati prenotazione
  const appearsIn = new Map(); // reservation id -> Set(accId che l'hanno restituita)

  // Interroga SEMPRE tutta la rete su 3 tipi: serve sia per lo stato camera sia per
  // rilevare gli spostamenti sul tableau.
  const types = ["CHECKOUT", "CHECKIN", "IN_HOUSE"];
  const tasks = [];
  for (const acc of allAcc.slice(0, 100)) {
    for (const type of types) tasks.push({ id: String(acc.id), type });
  }
  const concurrency = 6;
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          const raw = await hub.callTool("octorate", "findReservations", {
            accommodation: t.id,
            type: t.type,
            startDate: date,
            endDate: date,
            size: 200,
          });
          const rows = Array.isArray(raw) ? raw : raw?.data || raw?.content || [];
          return { ok: true, queryAcc: t.id, rows };
        } catch (e) {
          return {
            ok: false,
            queryAcc: t.id,
            name: nameById.get(t.id) || t.id,
            type: t.type,
            error: humanizeError(e, { service: "octorate" }),
          };
        }
      })
    );
    for (const r of results) {
      if (!r.ok) {
        errors.push({
          accommodation: r.name,
          id: r.queryAcc,
          type: r.type,
          error: r.error,
        });
        continue;
      }
      for (const row of r.rows) {
        if (!isActiveArrival(row)) continue;
        const accId = reservationAccId(row);
        if (isMasterAccommodation(accId)) continue;
        const ci = dateOnly(row.checkin);
        const co = dateOnly(row.checkout);
        // La prenotazione deve toccare il giorno: checkout oggi, checkin oggi o in-house stanotte
        const touchesDay =
          co === date || ci === date || (ci && co && ci < date && date < co);
        if (!touchesDay) continue;
        const rid = String(row.id);
        if (!resById.has(rid)) {
          resById.set(rid, {
            reservationId: row.id,
            bookingAcc: accId,
            pmsProduct: row.pmsProduct != null ? String(row.pmsProduct) : null,
            roomName: row.roomName || null,
            guest: guestName(row),
            checkin: row.checkin,
            checkout: row.checkout,
            pax: row.totalGuest ?? null,
            tipologia: row.status,
            channel: row.channelName || row.source || undefined,
            arrivalTime: row.arrivalTime || "",
            note: noteCandidates(row),
          });
        }
        if (!appearsIn.has(rid)) appearsIn.set(rid, new Set());
        appearsIn.get(rid).add(r.queryAcc);
      }
    }
  }

  // Attribuzione fisica (tableau) + ruoli rispetto alla data
  const enriched = [...resById.values()].map((a) => {
    const seenAt = [...(appearsIn.get(String(a.reservationId)) || [])];
    const moved = seenAt.filter((x) => x !== a.bookingAcc);
    const physicalAcc = moved.length ? moved[0] : a.bookingAcc;
    const ciDate = dateOnly(a.checkin);
    const coDate = dateOnly(a.checkout);
    return {
      ...a,
      physicalAcc,
      moved: moved.length > 0,
      ciDate,
      coDate,
      isCheckout: coDate === date,
      isCheckin: ciDate === date,
      isStayOver: ciDate && coDate && ciDate < date && date < coDate,
      nights: daysBetweenISO(a.checkin, a.checkout),
    };
  });

  // Strutture da riportare (fisiche)
  let scope = allAcc;
  if (args.accommodationId) {
    scope = allAcc.filter((a) => String(a.id) === String(args.accommodationId));
    if (!scope.length) scope = [{ id: args.accommodationId, name: `id:${args.accommodationId}` }];
  } else if (args.accommodationName) {
    const q = args.accommodationName.toLowerCase();
    scope = allAcc.filter((a) =>
      (a.name || a.internalName || "").toLowerCase().includes(q)
    );
  }
  const scopeIds = scope.map((a) => String(a.id));

  // findPmsRoom per tutte le strutture coinvolte (scope + fisiche + prenotazione)
  const accInvolved = new Set(scopeIds);
  for (const a of enriched) {
    accInvolved.add(a.physicalAcc);
    accInvolved.add(a.bookingAcc);
  }
  const roomsByAcc = new Map(); // accId -> [{id,name}]
  const roomNameByAcc = new Map(); // accId -> Map(id->name)
  await Promise.all(
    [...accInvolved].map(async (accId) => {
      try {
        const rr = await hub.callTool("octorate", "findPmsRoom", {
          accommodation: accId,
        });
        const rooms = (Array.isArray(rr) ? rr : rr?.data || []).map((x) => ({
          id: String(x.id),
          name: x.name,
        }));
        roomsByAcc.set(accId, rooms);
        roomNameByAcc.set(accId, new Map(rooms.map((x) => [x.id, x.name])));
      } catch {
        roomsByAcc.set(accId, []);
        roomNameByAcc.set(accId, new Map());
      }
    })
  );

  const entryFrom = (tipo, code, camera, res, extra = {}) => ({
    tipo,
    codifica: code,
    camera,
    guest: res?.guest,
    pax: res?.pax ?? null,
    checkin: res?.checkin,
    checkout: res?.checkout,
    arrivalTime: res?.arrivalTime || undefined,
    note: res?.note && res.note.length ? res.note : undefined,
    ...extra,
  });

  const byStruttura = {};
  const totali = {
    partenzeConEntrata: 0,
    partenzeSenzaEntrata: 0,
    entrate: 0,
    fermateConCambio: 0,
    fermateSemplici: 0,
    vuote: 0,
    spostate: 0,
  };

  for (const accId of scopeIds) {
    const sName = nameById.get(accId) || accId;
    const cfgAcc = getAccConfig(accId);
    const rooms = roomsByAcc.get(accId) || [];
    const here = enriched.filter((a) => a.physicalAcc === accId);

    const partenzeConEntrata = [];
    const partenzeSenzaEntrata = [];
    const entrate = [];
    const fermateConCambio = [];
    const aprireEControllare = []; // fermate semplici + camere vuote
    const spostate = []; // moved-in: camera fisica ignota
    const matchedReservations = new Set();

    // Camere fisiche note (include moved con pmsProduct assegnato sulla struttura destinazione)
    for (const room of rooms) {
      const resHere = here.filter(
        (a) => a.pmsProduct === room.id && (!a.moved || a.physicalAcc === accId)
      );
      for (const r of resHere) matchedReservations.add(String(r.reservationId));
      const checkoutRes = resHere.find((a) => a.isCheckout);
      const checkinRes = resHere.find((a) => a.isCheckin);
      const stayRes = resHere.find((a) => a.isStayOver);
      const code = shortRoomCode(room.name);
      const isApt = isAppartamentoContext(cfgAcc, room.name);

      if (checkoutRes) {
        if (checkinRes) {
          partenzeConEntrata.push(
            entryFrom("PARTENZA_CON_ENTRATA", `${code} ${checkinRes.pax}p`, room.name, checkinRes, {
              ospiteInUscita: checkoutRes.guest,
            })
          );
          totali.partenzeConEntrata += 1;
        } else {
          // Pulizia completa come entrata, senza numero persone
          partenzeSenzaEntrata.push(
            entryFrom("PARTENZA_SENZA_ENTRATA", `${code}`, room.name, checkoutRes, {
              pax: null,
            })
          );
          totali.partenzeSenzaEntrata += 1;
        }
      } else if (checkinRes) {
        entrate.push(
          entryFrom("ENTRATA", `${code} ${checkinRes.pax}p`, room.name, checkinRes)
        );
        totali.entrate += 1;
      } else if (stayRes) {
        // Appartamenti: nessuna fermata (né con cambio né semplice)
        if (isApt) continue;
        const cuts = linenChangeCutDays(stayRes.nights);
        const dayOffset = daysBetweenISO(stayRes.checkin, date);
        if (cuts.has(dayOffset)) {
          fermateConCambio.push(
            entryFrom("FERMATA_CON_CAMBIO", `${code}*`, room.name, stayRes, {
              notte: dayOffset + 1,
              nottiTotali: stayRes.nights,
            })
          );
          totali.fermateConCambio += 1;
        } else {
          aprireEControllare.push(
            entryFrom("FERMATA_SEMPLICE", `${code}`, room.name, stayRes)
          );
          totali.fermateSemplici += 1;
        }
      } else {
        aprireEControllare.push({
          tipo: "VUOTA",
          codifica: code,
          camera: room.name,
        });
        totali.vuote += 1;
      }
    }

    // Prenotazioni spostate fisicamente qui senza camera assegnata sulla destinazione
    for (const a of here.filter((x) => x.moved && !matchedReservations.has(String(x.reservationId)))) {
      const origRoom =
        (a.pmsProduct && roomNameByAcc.get(a.bookingAcc)?.get(a.pmsProduct)) ||
        a.roomName ||
        null;
      const ruolo = a.isCheckout
        ? a.isCheckin
          ? "PARTENZA_CON_ENTRATA"
          : "PARTENZA_SENZA_ENTRATA"
        : a.isCheckin
          ? "ENTRATA"
          : "FERMATA";
      // Appartamenti: niente fermate anche se spostate
      if (
        ruolo === "FERMATA" &&
        isAppartamentoContext(cfgAcc, origRoom || a.roomName || "")
      ) {
        continue;
      }
      let tipo = "SPOSTATA";
      let code = "(da assegnare)";
      if (a.isCheckout && a.isCheckin) code = `(da assegnare) ${a.pax}p`;
      else if (a.isCheckin) code = `(da assegnare) ${a.pax}p`;
      else if (ruolo === "PARTENZA_SENZA_ENTRATA") code = "(da assegnare)";
      spostate.push(
        entryFrom(tipo, code, "(camera da assegnare)", a, {
          pax: ruolo === "PARTENZA_SENZA_ENTRATA" ? null : a.pax,
          origine: { struttura: nameById.get(a.bookingAcc) || a.bookingAcc, camera: origRoom },
          ruolo,
        })
      );
      totali.spostate += 1;
    }

    const numericCmp = (a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true });
    const byTime = (x, y) =>
      String(x.arrivalTime || "99").localeCompare(String(y.arrivalTime || "99")) ||
      numericCmp(x.codifica, y.codifica);
    partenzeConEntrata.sort(byTime);
    entrate.sort(byTime);
    partenzeSenzaEntrata.sort((x, y) => numericCmp(x.codifica, y.codifica));
    fermateConCambio.sort((x, y) => numericCmp(x.codifica, y.codifica));
    aprireEControllare.sort((x, y) => numericCmp(x.codifica, y.codifica));
    spostate.sort((x, y) => numericCmp(x.codifica, y.codifica));

    byStruttura[sName] = {
      id: accId,
      // Ordine di esecuzione: prima partenze/entrate con preparazione (per orario arrivo),
      // poi partenze senza entrata, poi fermate con cambio; infine aprire e controllare.
      partenzeConEntrata,
      entrate,
      partenzeSenzaEntrata,
      fermateConCambio,
      spostate,
      aprireEControllare,
    };
  }

  return {
    rule:
      "Lista pulizie del giorno per camera FISICA (PMS Tableau). PARTENZA=checkout; con entrata 'ROOM Np', senza entrata 'ROOM' (pulizia completa come entrata, senza Np). FERMATA CON CAMBIO='ROOM*' solo affittacamere (niente fermate negli appartamenti). Fermate semplici/vuote: aprire e controllare.",
    legenda: {
      "ROOM Np": "PARTENZA con entrata o ENTRATA: preparare la stanza per N persone (ordine per orario check-in)",
      ROOM: "PARTENZA senza entrata: pulizia completa come entrata, senza numero persone (anche appartamenti)",
      "ROOM*": "FERMATA CON CAMBIO: cambio biancheria bagno e letto (solo affittacamere; appartamenti: nessuna fermata)",
      "(non scritta)": "FERMATA semplice / camera vuota: aprire e controllare (appartamenti: niente fermate)",
    },
    date,
    scope: scopeIds.map((id) => ({ id, name: nameById.get(id) || id })),
    totali,
    byStruttura,
    errors: errors.length ? errors : undefined,
  };
}

async function octoratePulizie(hub, args = {}) {
  return computePulizie(hub, args);
}

function weightForRoomEntry(entry, cfg) {
  const tipo = entry.tipo === "SPOSTATA" ? entry.ruolo || "FERMATA" : entry.tipo;
  const isApt = isAppartamentoContext(cfg, entry.camera);
  if (tipo === "VUOTA") return turniWeights().VUOTA;
  // Appartamenti: nessuna fermata
  if (
    isApt &&
    (tipo === "FERMATA_SEMPLICE" ||
      tipo === "FERMATA" ||
      tipo === "FERMATA_CON_CAMBIO")
  ) {
    return turniWeights().VUOTA;
  }
  if (tipo === "FERMATA_SEMPLICE" || tipo === "FERMATA") {
    return turniWeights().FERMATA_SEMPLICE;
  }

  if (isApt) return cfg.appartamentoPeso ?? 1;

  const full = fullCleanRoomWeight(cfg);
  if (tipo === "FERMATA_CON_CAMBIO") {
    return full * turniWeights().FERMATA_CON_CAMBIO_FACTOR;
  }
  // PARTENZA_* (anche senza entrata), ENTRATA → pulizia completa
  return full;
}

function normalizeStaffNames(input, defaultPrefix, defaultCount) {
  if (Array.isArray(input) && input.length) {
    return input.map((n, i) => String(n || `${defaultPrefix} ${i + 1}`).trim()).filter(Boolean);
  }
  const n = Number(input);
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultCount;
  return Array.from({ length: count }, (_, i) => `${defaultPrefix} ${i + 1}`);
}

/**
 * Costruisce i moduli (camere + spazi comuni) per struttura a partire da computePulizie.
 * Spazi comuni: SEMPRE inclusi ogni giorno per gli affittacamere (pesi per voce).
 * Una struttura = un blocco unico (non spezzabile).
 */
function buildTurniModuli(pulizie) {
  const moduli = [];
  for (const [sName, sData] of Object.entries(pulizie.byStruttura || {})) {
    const cfg = getAccConfig(sData.id);
    const rooms = [];
    const pushRoom = (entry) => {
      // Vuote: peso 0, non le elenchiamo nei turni (non contano)
      if (entry.tipo === "VUOTA") return;
      const tipo = entry.tipo === "SPOSTATA" ? entry.ruolo || "FERMATA" : entry.tipo;
      // Appartamenti: niente fermate nei turni
      if (
        isAppartamentoContext(cfg, entry.camera) &&
        (tipo === "FERMATA_SEMPLICE" ||
          tipo === "FERMATA" ||
          tipo === "FERMATA_CON_CAMBIO")
      ) {
        return;
      }
      rooms.push({
        codifica: entry.codifica,
        camera: entry.camera,
        tipo: entry.tipo,
        peso: weightForRoomEntry(entry, cfg),
        guest: entry.guest,
        note: entry.note,
        arrivalTime: entry.arrivalTime,
        ruolo: entry.ruolo,
        origine: entry.origine,
      });
    };

    for (const e of sData.partenzeConEntrata || []) pushRoom(e);
    for (const e of sData.entrate || []) pushRoom(e);
    for (const e of sData.partenzeSenzaEntrata || []) pushRoom(e);
    for (const e of sData.fermateConCambio || []) pushRoom(e);
    for (const e of sData.spostate || []) pushRoom(e);
    for (const e of sData.aprireEControllare || []) pushRoom(e);

    const spaziComuni = spaziComuniWeighted(cfg);
    const caricoRooms = rooms.reduce((s, r) => s + r.peso, 0);
    const caricoSpazi = spaziComuni ? spaziComuni.peso : 0;
    const tragitto =
      cfg.tragittoPeso != null
        ? cfg.tragittoPeso
        : cfg.code === "DT"
          ? turniWeights().TRAGITTO_DOMUS_TURNO
          : 0;
    moduli.push({
      accId: String(sData.id),
      name: sName,
      code: cfg.code,
      cluster: cfg.cluster,
      tipo: cfg.tipo,
      rooms,
      spaziComuni,
      tragitto: tragitto || undefined,
      tragittoNota: tragitto
        ? `tragitto Domus Turno +${tragitto}`
        : undefined,
      carico: Math.round((caricoRooms + caricoSpazi + tragitto) * 100) / 100,
    });
  }

  // Assicura che tutte le strutture affittacamere in config abbiano almeno gli spazi comuni
  for (const [accId, cfg] of Object.entries(getAccommodationMap())) {
    if (cfg.tipo !== "affittacamere" || !cfg.spaziComuni?.length) continue;
    if (moduli.some((m) => m.accId === accId)) continue;
    const scopeHit = (pulizie.scope || []).find((s) => String(s.id) === accId);
    const name = scopeHit?.name || cfg.code;
    const spaziComuni = spaziComuniWeighted(cfg);
    const tragitto =
      cfg.tragittoPeso != null
        ? cfg.tragittoPeso
        : cfg.code === "DT"
          ? turniWeights().TRAGITTO_DOMUS_TURNO
          : 0;
    moduli.push({
      accId,
      name,
      code: cfg.code,
      cluster: cfg.cluster,
      tipo: cfg.tipo,
      rooms: [],
      spaziComuni,
      tragitto: tragitto || undefined,
      tragittoNota: tragitto
        ? `tragitto Domus Turno +${tragitto}`
        : undefined,
      carico:
        Math.round(((spaziComuni ? spaziComuni.peso : 0) + tragitto) * 100) / 100,
    });
  }

  return moduli;
}

/**
 * Bilancia i moduli di un cluster sulle cameriere.
 * REGOLA: una struttura resta SEMPRE intera (camere + spazi comuni) sotto la stessa persona.
 * Se non entra nel cap di nessuna cameriera → tutta al manutentore del cluster.
 */
function balanceCluster(
  moduli,
  workerNames,
  manutentoreDisponibile,
  manutentoreNome = "Manutentore"
) {
  const workers = workerNames.map((name) => ({
    name,
    carico: 0,
    strutture: [],
  }));
  const manutentore = { name: manutentoreNome, carico: 0, strutture: [] };
  const avvisi = [];

  if (!workers.length) {
    for (const m of moduli) {
      if (manutentoreDisponibile) {
        manutentore.strutture.push(m);
        manutentore.carico += m.carico;
      } else {
        avvisi.push(`Nessuna cameriera disponibile per ${m.name}: carico non assegnato`);
      }
    }
    return { workers, manutentore, avvisi };
  }

  const sorted = [
    ...moduli.filter((m) => !m.tragitto).sort((a, b) => b.carico - a.carico),
    // Domus Turno (con tragitto) dopo le altre: così può andare a chi ha già lavorato altrove
    ...moduli.filter((m) => m.tragitto).sort((a, b) => b.carico - a.carico),
  ];
  for (const m of sorted) {
    workers.sort((a, b) => a.carico - b.carico);
    let fit;
    if (m.tragitto) {
      // Preferisci una cameriera che ha già altre strutture nel turno
      fit = workers.find(
        (w) => w.strutture.length > 0 && w.carico + m.carico <= turniMaxCarico()
      );
    }
    if (!fit) {
      fit = workers.find((w) => w.carico + m.carico <= turniMaxCarico());
    }
    if (fit) {
      fit.strutture.push(m);
      fit.carico += m.carico;
      continue;
    }
    // Nessuna cameriera ha spazio per la struttura INTERA → manutentore (non spezzare)
    if (manutentoreDisponibile) {
      manutentore.strutture.push(m);
      manutentore.carico += m.carico;
      avvisi.push(
        `Overflow ${m.name} (carico ${m.carico}) → ${manutentoreNome}: struttura tenuta intera (cap ${turniMaxCarico()})`
      );
    } else {
      const least = workers[0];
      least.strutture.push(m);
      least.carico += m.carico;
      avvisi.push(
        `Cap superato su ${least.name} per ${m.name} (struttura intera); ${manutentoreNome} non disponibile`
      );
    }
  }

  return { workers, manutentore, avvisi };
}

/**
 * Proposta turni pulizie del giorno: bilancia camere + spazi comuni sulle cameriere.
 * Staff indicato di volta in volta (cameriere Roma / manutentore; DT nel pool Roma).
 * @param {import('./mcp-hub.js').McpHub} hub
 */
export async function octorateTurni(hub, args = {}) {
  const date = args.date || romeDateISO(0);
  const pulizie = await computePulizie(hub, { date });
  const moduli = buildTurniModuli(pulizie);

  const assenze = new Set(
    (Array.isArray(args.assenze) ? args.assenze : [])
      .map((n) => String(n).trim().toLowerCase())
      .filter(Boolean)
  );

  const staff = getStaffDefaults();
  let centroNames = normalizeStaffNames(
    args.cameriereNomi?.length ? args.cameriereNomi : args.cameriere,
    "Cameriera",
    staff.cameriereCentro ?? 2
  );
  // Domus Turno è nel pool Roma (+0.3 tragitto). Staff dedicato Turno solo se esplicitamente passato.
  let turnoDedicated = [];
  if (args.cameriereTurnoNomi?.length || (args.cameriereTurno != null && Number(args.cameriereTurno) > 0)) {
    turnoDedicated = normalizeStaffNames(
      args.cameriereTurnoNomi?.length ? args.cameriereTurnoNomi : args.cameriereTurno,
      "Cameriera Turno",
      0
    );
  }
  // Tenerife: team locale default da config
  let tenerifeNames = normalizeStaffNames(
    args.cameriereTenerifeNomi?.length
      ? args.cameriereTenerifeNomi
      : args.cameriereTenerife != null
        ? args.cameriereTenerife
        : staff.tenerifeNomi || ["Lala"],
    staff.tenerifeNomi?.[0] || "Lala",
    1
  );
  const marioDisponibile =
    args.manutentoreTenerifeDisponibile == null
      ? true
      : Boolean(args.manutentoreTenerifeDisponibile);
  const marioNome = args.manutentoreTenerifeNome || staff.manutentoreTenerifeNome || "Mario";

  if (assenze.size) {
    centroNames = centroNames.filter((n) => !assenze.has(n.toLowerCase()));
    turnoDedicated = turnoDedicated.filter((n) => !assenze.has(n.toLowerCase()));
    tenerifeNames = tenerifeNames.filter((n) => !assenze.has(n.toLowerCase()));
  }

  const manutentoreDisponibile =
    args.manutentoreDisponibile == null ? true : Boolean(args.manutentoreDisponibile);

  const romaNames = [...centroNames, ...turnoDedicated];
  const romaModuli = moduli.filter((m) => m.cluster === "centro");
  const tenerifeModuli = moduli.filter((m) => m.cluster === "tenerife");

  const roma = balanceCluster(
    romaModuli,
    romaNames,
    manutentoreDisponibile,
    staff.manutentoreRomaNome || "Manutentore"
  );
  const tenerife = balanceCluster(
    tenerifeModuli,
    tenerifeNames,
    marioDisponibile,
    marioNome
  );

  const avvisi = [...roma.avvisi, ...tenerife.avvisi];
  if (!romaNames.length) {
    avvisi.push("Nessuna cameriera disponibile per Roma (centro + Domus Turno)");
  }
  if (tenerifeModuli.length && !tenerifeNames.length) {
    avvisi.push("Nessuna cameriera disponibile per Tenerife (default: Lala)");
  }
  if (assenze.size) {
    avvisi.push(`Assenze indicate: ${[...assenze].join(", ")}`);
  }

  const formatWorker = (w, cluster) => ({
    nome: w.name,
    cluster,
    carico: Math.round(w.carico * 100) / 100,
    strutture: w.strutture.map((s) => ({
      struttura: s.name,
      code: s.code,
      carico: Math.round(s.carico * 100) / 100,
      camere: s.rooms.map((r) => ({
        codifica: r.codifica,
        tipo: r.tipo,
        peso: r.peso,
        note: r.note,
        arrivalTime: r.arrivalTime,
      })),
      spaziComuni: s.spaziComuni?.items || [],
      spaziComuniDettaglio: s.spaziComuni?.dettaglio || undefined,
      tragitto: s.tragitto || undefined,
      tragittoNota: s.tragittoNota || undefined,
    })),
  });

  const formatManutentore = (man, cluster) => {
    if (!man?.strutture?.length) return null;
    return {
      nome: man.name,
      cluster,
      carico: Math.round(man.carico * 100) / 100,
      strutture: man.strutture.map((s) => ({
        struttura: s.name,
        code: s.code,
        carico: Math.round(s.carico * 100) / 100,
        camere: s.rooms.map((r) => ({
          codifica: r.codifica,
          tipo: r.tipo,
          peso: r.peso,
          note: r.note,
        })),
        spaziComuni: s.spaziComuni?.items || [],
        spaziComuniDettaglio: s.spaziComuni?.dettaglio || undefined,
        tragitto: s.tragitto || undefined,
        tragittoNota: s.tragittoNota || undefined,
      })),
    };
  };

  const perCameriera = [
    ...roma.workers.map((w) => formatWorker(w, "centro")),
    ...tenerife.workers.map((w) => formatWorker(w, "tenerife")),
  ];

  const manutentori = [
    formatManutentore(manutentoreDisponibile ? roma.manutentore : null, "centro"),
    formatManutentore(marioDisponibile ? tenerife.manutentore : null, "tenerife"),
  ].filter(Boolean);

  const manutentore =
    manutentoreDisponibile && roma.manutentore.strutture.length
      ? formatManutentore(roma.manutentore, "centro")
      : null;

  return {
    rule:
      "Proposta turni: struttura sempre intera. Domus Turno nel pool Roma (+0.3 tragitto, preferita a chi ha già altre strutture). Tenerife: Lala/Mario. Overflow → manutentore del cluster.",
    date,
    pesi: {
      ...turniWeights(),
      spaziComuni: spazioComunePesi(),
      appartamenti: Object.fromEntries(
        Object.values(getAccommodationMap()).map((c) => [c.code, c.appartamentoPeso])
      ),
      cameraBagnoInCamera: turniWeights().CAMERA_BAGNO_IN_CAMERA,
      cameraBagnoCondiviso: turniWeights().CAMERA_BAGNO_CONDIVISO,
      tragittoDomusTurno: turniWeights().TRAGITTO_DOMUS_TURNO,
    },
    maxCarico: turniMaxCarico(),
    staff: {
      centro: romaNames,
      tenerife: tenerifeNames,
      manutentoreDisponibile,
      manutentoreTenerife: marioDisponibile ? marioNome : null,
      assenze: [...assenze],
    },
    carichi: {
      centro: Math.round(romaModuli.reduce((s, m) => s + m.carico, 0) * 100) / 100,
      tenerife:
        Math.round(tenerifeModuli.reduce((s, m) => s + m.carico, 0) * 100) / 100,
      totale: Math.round(moduli.reduce((s, m) => s + m.carico, 0) * 100) / 100,
    },
    perCameriera,
    manutentore,
    manutentori,
    avvisi: avvisi.length ? avvisi : undefined,
    pulizieTotali: pulizie.totali,
  };
}

async function runLocalOrMcp(hub, name, args) {
  if (name === "schedula_moduli") {
    return schedulaModuli(args.modules, {
      dueDate: args.due,
      moduleDues: args.moduleDues || undefined,
      dryRun: Boolean(args.dryRun),
    });
  }
  if (name === "octorate_arrivi") {
    return octorateArrivi(hub, args);
  }
  if (name === "octorate_camere") {
    return octorateCamere(hub, args);
  }
  if (name === "octorate_pulizie") {
    return octoratePulizie(hub, args);
  }
  if (name === "octorate_turni") {
    return octorateTurni(hub, args);
  }
  return executeMcpTool(hub, name, args);
}

/**
 * @param {import('./mcp-hub.js').McpHub} hub
 * @param {Array<{role:string,content:string}>} history
 * @param {string} userMessage
 */
export async function runIManager(hub, history, userMessage) {
  const messages = [
    { role: "system", content: `${buildSystemPrompt()}\n\n${buildNowContext()}` },
    ...history.filter((m) => m.role === "user" || m.role === "assistant"),
    { role: "user", content: userMessage },
  ];

  const actions = [];
  const maxRounds = 12;

  for (let round = 0; round < maxRounds; round++) {
    const assistant = await callLlm(messages);
    messages.push(assistant);

    const toolCalls = assistant.tool_calls || [];
    if (!toolCalls.length) {
      const reply = (assistant.content || "").trim() || "Ok.";
      const newHistory = [
        ...history,
        { role: "user", content: userMessage },
        { role: "assistant", content: reply },
      ].slice(-16);
      return { reply, history: newHistory, actions };
    }

    for (const tc of toolCalls) {
      const name = tc.function.name;
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        args = {};
      }

      let result;
      try {
        result = await runLocalOrMcp(hub, name, args);
        actions.push({ name, args, ok: true });
      } catch (err) {
        const userMessage = humanizeError(err, {
          service: serviceFromToolName(name, args),
        });
        console.error(`[tool:${name}] ${err.message}`);
        result = {
          error: userMessage,
          ok: false,
          technical: err.technical || err.message,
        };
        actions.push({ name, args, ok: false, error: userMessage });
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  const fallback =
    "Ho raggiunto il limite di passaggi tool. Riprova con una richiesta più specifica.";
  return {
    reply: fallback,
    history: [
      ...history,
      { role: "user", content: userMessage },
      { role: "assistant", content: fallback },
    ].slice(-16),
    actions,
  };
}

export function shouldIntervene(text, { mentioned, isReplyToBot, isPrivate }) {
  if (isPrivate || mentioned || isReplyToBot) return true;
  return false;
}

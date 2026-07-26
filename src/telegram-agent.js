import { BOARD_IDS } from "./telegram-tools.js";
import { schedulaModuli } from "./schedula-moduli.js";
import {
  buildMcpToolDefinitions,
  executeMcpTool,
} from "./mcp-hub.js";

const SYSTEM_PROMPT = `Sei Super Manager (@manager_888_bot), property manager AI di un portafoglio di circa 500 appartamenti.

Ruolo:
- Supervisioni operazioni: manutenzioni (Trello), prenotazioni/disponibilità/messaggi ospiti (Octorate), gestione operativa.
- Agisci tramite i SERVER MCP collegati — non inventare dati.
- I messaggi che ricevi sono già filtrati: in gruppo arrivano solo se ti hanno taggato @manager_888_bot o in reply a te. Quindi rispondi SEMPRE al contenuto, senza rifiutare per "mancanza di tag".
- Italiano, concreto, breve.

## MCP disponibili

1) server **trello** — board/card/liste/commenti/etichette.
2) server **octorate** — PMS (~200 tool).

## Scorciatoie (preferisci queste)

- Prenotazioni in arrivo oggi/domani/prossimi giorni → tool **octorate_arrivi** (NON fare loop di mcp_search_tools). Mostra SOLO prenotazioni attive (mai CANCELLED / PROPOSAL).
- Camere libere / occupate / disponibilità → tool **octorate_camere** (fonte: readCalendar. Regola: LIBERA = availability>0 per tutte le notti richieste; OCCUPATA = availability 0 in almeno una notte, con motivo prenotazione o stop-sell). NON usare findPmsRoom né Availability_Check per la disponibilità.
- Camere da pulire in una data → tool **octorate_pulizie** (fonte PMS Tableau, non la roomRate). Presenta la lista secondo la LEGGENDA PULIZIE qui sotto. Se una camera risulta "da assegnare", segnalalo.
- Turni pulizie del giorno → tool **octorate_turni** (proposta di assegnazione cameriere; non scrive su Trello). Estrai lo staff dal messaggio.
- Schedula moduli Manutenzioni → **schedula_moduli**.

## Modello dati Octorate (3 livelli)

Ogni prenotazione va letta su 3 livelli:
1. **Struttura** = accommodation: codice numerico + nome (es. 18972 "In the center you too"). Le strutture sono in RETE: una query ne restituisce anche di altre, quindi conta sempre l'accommodation.id reale della singola prenotazione.
2. **Derivata/camera** = product (tipo/derivata logica) + pmsProduct (camera fisica) + roomName.
3. **Tipologia** = stato prenotazione (CONFIRMED, ACTIVE, …).

Quando elenchi prenotazioni o camere, raggruppa per struttura e indica la derivata (roomName) e lo stato.

## Leggenda pulizie (per octorate_pulizie)

Presenta la lista raggruppata per struttura, in QUESTO ordine di esecuzione:
1. **PARTENZA CON ENTRATA** e **ENTRATA** → codifica \`ROOM Np\` (es. \`ITC#1 2p\`). Preparare la stanza per N persone, seguendo l'ordine per orario di check-in. (campo partenzeConEntrata + entrate)
2. **PARTENZA SENZA ENTRATA** → codifica \`ROOM\` (es. \`ITC#1\`). Camera non riaffittata: preparare tutti i letti con le lenzuola, ma lasciare asciugamani e cuscini solo sul letto matrimoniale; gli altri letti coperti con la trapuntina e i cuscini (con federa) lasciati nell'armadio. Da fare DOPO le partenze con entrata. (campo partenzeSenzaEntrata)
3. **FERMATA CON CAMBIO** → codifica \`ROOM*\` (es. \`ITC#1*\`). Cambiare biancheria bagno e letto, rassettare, pulire a terra, svuotare cestino, rabboccare sapone/carta. (campo fermateConCambio)
4. **FERMATA semplice** e **camere vuote** → NON si scrivono nella lista. Vanno comunque aperte e controllate (rassettare, pulizia veloce, cestino, sapone/carta). Menzionale solo se richiesto. (campo aprireEControllare)

Note e richieste speciali: se una camera ha \`note\` con info utili alle cameriere (late/early check-in, orario arrivo, letti separati, rose/vino/transfer/colazione/deposito bagagli...), aggiungile tra parentesi quadre dopo la codifica, sintetizzate: es. \`DC#201 2p [arrivo h20, letti separati]\`. Ignora il testo standard non rilevante (es. clausole di cancellazione).

## Turni pulizie (per octorate_turni)

Quando chiedono i turni / chi fa cosa oggi:
1. Estrai lo staff dal messaggio: numero o nomi cameriere (centro), cameriere Domus Turno (default 2), assenze, se il manutentore è disponibile.
2. Chiama **octorate_turni** con quei parametri (NON inventare lo staff se non indicato: chiedi o usa default 2+2).
3. Presenta la proposta per cameriera:
   - cluster (centro / Domus Turno)
   - per ogni struttura assegnata: camere con codifica leggenda + spazi comuni (es. NR CUCINA, NR CORRIDOIO, NR BAGNO CONDIVISO)
   - note speciali tra [ ] se presenti
   - carico stimato
4. Sezione **Manutentore** se ha overflow.
5. Riporta eventuali avvisi (assenze, overflow, cap carico).

Regole operative già applicate dal tool:
- chi pulisce camere di un affittacamere fa anche gli spazi comuni di quella struttura;
- spazi comuni SEMPRE ogni giorno (anche senza arrivi): NR/DF/DC = cucina+corridoio+bagno; ITC = cucina+corridoio; DT = area comune;
- Domus Turno = cluster separato (30 min);
- overflow oltre cap o assenza → manutentore.

## Altri tool MCP

1. mcp_search_tools UNA volta con query mirata (es. reservation, availability, message)
2. mcp_describe_tool se serve lo schema
3. mcp_call_tool per eseguire
NON ripetere mcp_search_tools più di 2 volte sulla stessa richiesta.

Board Trello: manutenzioni ${BOARD_IDS.manutenzioni}, gestione ${BOARD_IDS.gestione}, amministrazione ${BOARD_IDS.amministrazione}.
Persone: Costache, Daniele, Meri.

Regole:
- Non inventare ID.
- Delete → conferma esplicita.
- Date: oggi | domani | GG/MM/AAAA.
- Dopo un'azione: riassumi in modo leggibile (ospite, struttura, check-in/out, stato).`;

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
          "Stato camere (libere/occupate) per una struttura in una data o range. Fonte: readCalendar. LIBERA = availability>0 per tutte le notti; OCCUPATA = availability 0 in almeno una notte (motivo: prenotazione o stop-sell). Non usa findPmsRoom né Availability_Check per la disponibilità.",
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
          "Lista camere da pulire in una data, divisa tra PARTENZE (checkout) e FERMATE, con numero persone e note. Attribuisce alla camera FISICA del PMS Tableau (segue gli spostamenti di rete). Ritorna partenzeConEntrata/entrate (ROOM Np), partenzeSenzaEntrata (ROOM), fermateConCambio (ROOM*), aprireEControllare (fermate semplici e vuote). Default: oggi, tutte le strutture (escluso account master).",
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
          "Proposta turni pulizie del giorno: assegna camere + spazi comuni alle cameriere bilanciando il carico. Cluster centro vs Domus Turno (separata). Spazi comuni SEMPRE ogni giorno. Overflow/assenze → manutentore. Solo proposta testuale (non scrive su Trello). Estrai lo staff dal messaggio utente (numero/nomi cameriere, cameriereTurno, assenze, manutentoreDisponibile).",
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
                "Numero cameriere cluster centro (default 2). Se conosci i nomi, passa anche cameriereNomi.",
            },
            cameriereNomi: {
              type: "array",
              items: { type: "string" },
              description:
                "Nomi cameriere cluster centro (se presente, ha priorità su cameriere).",
            },
            cameriereTurno: {
              type: "number",
              description: "Numero cameriere Domus Turno (default 2).",
            },
            cameriereTurnoNomi: {
              type: "array",
              items: { type: "string" },
              description:
                "Nomi cameriere Domus Turno (se presente, ha priorità su cameriereTurno).",
            },
            manutentoreDisponibile: {
              type: "boolean",
              description:
                "Se true (default), il manutentore riceve l'overflow / sostituisce assenze.",
            },
            assenze: {
              type: "array",
              items: { type: "string" },
              description: "Nomi cameriere assenti da escludere dallo staff.",
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
          "Schedula task Manutenzioni per moduli liberi (IN ESECUZIONE / Periodici / Settimana)",
        parameters: {
          type: "object",
          properties: {
            modules: { type: "array", items: { type: "string" } },
            due: { type: "string" },
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
    throw new Error(data.error?.message || `OpenAI error ${res.status}`);
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
    throw new Error(data.error?.message || `Anthropic error ${res.status}`);
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
const MASTER_ACCOMMODATION_IDS = new Set(["538465"]);

function isMasterAccommodation(id) {
  return MASTER_ACCOMMODATION_IDS.has(String(id));
}

/**
 * Config operativa strutture: cluster, tipo, spazi comuni (puliti TUTTI I GIORNI).
 * Cluster "turno" = Domus Turno (30 min a piedi, 2 cameriere dedicate).
 */
const ACCOMMODATION_CONFIG = {
  "18972": {
    code: "ITC",
    cluster: "centro",
    tipo: "affittacamere",
    spaziComuni: ["CUCINA", "CORRIDOIO"],
  },
  "43174": {
    code: "DF",
    cluster: "centro",
    tipo: "affittacamere",
    spaziComuni: ["CUCINA", "CORRIDOIO", "BAGNO CONDIVISO"],
  },
  "502641": {
    code: "NR",
    cluster: "centro",
    tipo: "affittacamere",
    spaziComuni: ["CUCINA", "CORRIDOIO", "BAGNO CONDIVISO"],
  },
  "352348": {
    code: "DC",
    cluster: "centro",
    tipo: "affittacamere",
    spaziComuni: ["CUCINA", "CORRIDOIO", "BAGNO CONDIVISO"],
  },
  "302412": {
    code: "DT",
    cluster: "turno",
    tipo: "affittacamere",
    spaziComuni: ["AREA COMUNE"],
  },
  "737786": {
    code: "TEN109",
    cluster: "centro",
    tipo: "appartamento",
    spaziComuni: [],
  },
};

const TURNI_WEIGHTS = {
  PARTENZA_CON_ENTRATA: 1.0,
  PARTENZA_SENZA_ENTRATA: 1.0,
  ENTRATA: 1.0,
  FERMATA_CON_CAMBIO: 0.75,
  APPARTAMENTO: 1.0,
  SPOSTATA: 1.0,
  FERMATA_SEMPLICE: 0.25,
  VUOTA: 0.25,
  SPAZI_COMUNI_BUNDLE: 0.5,
};
const TURNI_MAX_CARICO = 6;

function getAccConfig(accId) {
  return (
    ACCOMMODATION_CONFIG[String(accId)] || {
      code: String(accId),
      cluster: "centro",
      tipo: "affittacamere",
      spaziComuni: [],
    }
  );
}

function isAppartamentoUnit(cameraName = "") {
  const n = String(cameraName).toLowerCase();
  return (
    n.includes("appartamento") ||
    n.includes("by local domus") ||
    n.includes("intero appartamento")
  );
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
          return { ok: false, id, name: nameById.get(id) || id, error: e.message };
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
 * Camere PMS libere/occupate per una struttura, basate sulla disponibilità reale.
 *  - Fonte disponibilità: readCalendar (availability per prodotto/giorno).
 *  - Nomi camere fisiche: findPmsRoom (mappate via parentId -> id prodotto calendario).
 *  - findReservations serve solo ad annotare il MOTIVO dell'occupazione (ospite vs stop-sell).
 * Regola: LIBERA = availability > 0 per tutte le notti del range; OCCUPATA = availability 0 in almeno una notte.
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

  // Prenotazioni attive di QUESTA struttura, per annotare il motivo dell'occupazione
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
      channel: r.channelName,
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
    let motivo;
    if (!disponibile) {
      if (reservations.length) motivo = "prenotazione";
      else if (anyStopSell) motivo = "stop-sell";
      else if (hasCalendar) motivo = "chiusa / restrizione";
      else motivo = "nessun dato calendario";
    }

    return {
      id: room.id,
      name: room.name,
      parentId: room.parentId,
      stato: disponibile ? "LIBERA" : "OCCUPATA",
      disponibile,
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

  const libere = camere.filter((c) => c.disponibile);
  const occupate = camere.filter((c) => !c.disponibile);

  return {
    rule: "LIBERA = readCalendar availability>0 per tutte le notti del range; OCCUPATA = availability 0 in almeno una notte (prenotazione o stop-sell)",
    source: "readCalendar",
    accommodation: { id: accId, name: accName },
    date,
    endDate,
    nights,
    totals: {
      rooms: camere.length,
      libere: libere.length,
      occupate: occupate.length,
      unassignedReservations: unassigned.length,
    },
    libere: libere.map((c) => ({ id: c.id, name: c.name })),
    occupate: occupate.map((c) => ({
      id: c.id,
      name: c.name,
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

/** Codice camera compatto per la comunicazione pulizie (es. "ITC #1 (Tripla BP)" -> "ITC#1"). */
function shortRoomCode(name) {
  if (!name) return "?";
  const base = String(name).split("(")[0].trim();
  const compact = base.replace(/\s*#\s*/, "#").replace(/\s+/g, "");
  return compact || base;
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
 *  - checkout oggi senza entrata         -> PARTENZA SENZA ENTRATA (ROOM)
 *  - checkin oggi su camera prima libera -> ENTRATA / prep arrivo  (ROOM Np)
 *  - soggiorno in corso, giorno di cambio-> FERMATA CON CAMBIO      (ROOM*)
 *  - soggiorno in corso, no cambio       -> FERMATA semplice (aprire e controllare)
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
            error: e.message,
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
    const rooms = roomsByAcc.get(accId) || [];
    const here = enriched.filter((a) => a.physicalAcc === accId);

    const partenzeConEntrata = [];
    const partenzeSenzaEntrata = [];
    const entrate = [];
    const fermateConCambio = [];
    const aprireEControllare = []; // fermate semplici + camere vuote
    const spostate = []; // moved-in: camera fisica ignota

    // Camere fisiche note (non spostate)
    for (const room of rooms) {
      const resHere = here.filter((a) => !a.moved && a.pmsProduct === room.id);
      const checkoutRes = resHere.find((a) => a.isCheckout);
      const checkinRes = resHere.find((a) => a.isCheckin);
      const stayRes = resHere.find((a) => a.isStayOver);
      const code = shortRoomCode(room.name);

      if (checkoutRes) {
        if (checkinRes) {
          partenzeConEntrata.push(
            entryFrom("PARTENZA_CON_ENTRATA", `${code} ${checkinRes.pax}p`, room.name, checkinRes, {
              ospiteInUscita: checkoutRes.guest,
            })
          );
          totali.partenzeConEntrata += 1;
        } else {
          partenzeSenzaEntrata.push(
            entryFrom("PARTENZA_SENZA_ENTRATA", `${code}`, room.name, checkoutRes)
          );
          totali.partenzeSenzaEntrata += 1;
        }
      } else if (checkinRes) {
        entrate.push(
          entryFrom("ENTRATA", `${code} ${checkinRes.pax}p`, room.name, checkinRes)
        );
        totali.entrate += 1;
      } else if (stayRes) {
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

    // Prenotazioni spostate fisicamente qui: camera di destinazione ignota sul tableau
    for (const a of here.filter((x) => x.moved)) {
      const origRoom =
        (a.pmsProduct && roomNameByAcc.get(a.bookingAcc)?.get(a.pmsProduct)) ||
        a.roomName ||
        null;
      let tipo = "SPOSTATA";
      let code = "(da assegnare)";
      if (a.isCheckout && a.isCheckin) code = `(da assegnare) ${a.pax}p`;
      else if (a.isCheckin) code = `(da assegnare) ${a.pax}p`;
      spostate.push(
        entryFrom(tipo, code, "(camera da assegnare)", a, {
          origine: { struttura: nameById.get(a.bookingAcc) || a.bookingAcc, camera: origRoom },
          ruolo: a.isCheckout
            ? a.isCheckin
              ? "PARTENZA_CON_ENTRATA"
              : "PARTENZA_SENZA_ENTRATA"
            : a.isCheckin
              ? "ENTRATA"
              : "FERMATA",
        })
      );
      totali.spostate += 1;
    }

    const byTime = (x, y) =>
      String(x.arrivalTime || "99").localeCompare(String(y.arrivalTime || "99")) ||
      String(x.codifica).localeCompare(String(y.codifica));
    partenzeConEntrata.sort(byTime);
    entrate.sort(byTime);
    partenzeSenzaEntrata.sort((x, y) => String(x.codifica).localeCompare(String(y.codifica)));
    fermateConCambio.sort((x, y) => String(x.codifica).localeCompare(String(y.codifica)));

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
      "Lista pulizie del giorno per camera FISICA (PMS Tableau). PARTENZA=checkout; con entrata mostra 'ROOM Np', senza entrata 'ROOM'; FERMATA CON CAMBIO='ROOM*'; fermate semplici e vuote vanno solo aperte e controllate.",
    legenda: {
      "ROOM Np": "PARTENZA con entrata o ENTRATA: preparare la stanza per N persone (ordine per orario check-in)",
      ROOM: "PARTENZA senza entrata: camera non riaffittata, preparare i letti come da procedura",
      "ROOM*": "FERMATA CON CAMBIO: cambio biancheria bagno e letto",
      "(non scritta)": "FERMATA semplice / camera vuota: aprire e controllare la pulizia",
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

function weightForRoomEntry(entry) {
  if (isAppartamentoUnit(entry.camera)) return TURNI_WEIGHTS.APPARTAMENTO;
  if (entry.tipo === "SPOSTATA") {
    const ruolo = entry.ruolo || "";
    if (ruolo.includes("PARTENZA") || ruolo === "ENTRATA") return TURNI_WEIGHTS.PARTENZA_CON_ENTRATA;
    if (ruolo === "FERMATA") return TURNI_WEIGHTS.FERMATA_CON_CAMBIO;
    return TURNI_WEIGHTS.SPOSTATA;
  }
  return TURNI_WEIGHTS[entry.tipo] ?? TURNI_WEIGHTS.FERMATA_SEMPLICE;
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
 * Spazi comuni: SEMPRE inclusi ogni giorno per gli affittacamere.
 */
function buildTurniModuli(pulizie) {
  const moduli = [];
  for (const [sName, sData] of Object.entries(pulizie.byStruttura || {})) {
    const cfg = getAccConfig(sData.id);
    const rooms = [];
    const pushRoom = (entry, includeLight = false) => {
      if (!includeLight && (entry.tipo === "FERMATA_SEMPLICE" || entry.tipo === "VUOTA")) return;
      rooms.push({
        codifica: entry.codifica,
        camera: entry.camera,
        tipo: entry.tipo,
        peso: weightForRoomEntry(entry),
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
    // Fermate semplici / vuote: peso basso, solo "aprire e controllare"
    for (const e of sData.aprireEControllare || []) pushRoom(e, true);

    const spaziComuni =
      cfg.tipo === "affittacamere" && cfg.spaziComuni?.length
        ? {
            items: cfg.spaziComuni.map((x) => `${cfg.code} ${x}`),
            peso: TURNI_WEIGHTS.SPAZI_COMUNI_BUNDLE,
          }
        : null;

    const caricoRooms = rooms.reduce((s, r) => s + r.peso, 0);
    const caricoSpazi = spaziComuni ? spaziComuni.peso : 0;
    moduli.push({
      accId: String(sData.id),
      name: sName,
      code: cfg.code,
      cluster: cfg.cluster,
      tipo: cfg.tipo,
      rooms,
      spaziComuni,
      carico: caricoRooms + caricoSpazi,
      caricoPesante: rooms
        .filter((r) => r.peso >= 0.75)
        .reduce((s, r) => s + r.peso, 0) + caricoSpazi,
    });
  }

  // Assicura che tutte le strutture affittacamere in config abbiano almeno gli spazi comuni
  for (const [accId, cfg] of Object.entries(ACCOMMODATION_CONFIG)) {
    if (cfg.tipo !== "affittacamere" || !cfg.spaziComuni?.length) continue;
    if (moduli.some((m) => m.accId === accId)) continue;
    const scopeHit = (pulizie.scope || []).find((s) => String(s.id) === accId);
    const name = scopeHit?.name || cfg.code;
    moduli.push({
      accId,
      name,
      code: cfg.code,
      cluster: cfg.cluster,
      tipo: cfg.tipo,
      rooms: [],
      spaziComuni: {
        items: cfg.spaziComuni.map((x) => `${cfg.code} ${x}`),
        peso: TURNI_WEIGHTS.SPAZI_COMUNI_BUNDLE,
      },
      carico: TURNI_WEIGHTS.SPAZI_COMUNI_BUNDLE,
      caricoPesante: TURNI_WEIGHTS.SPAZI_COMUNI_BUNDLE,
    });
  }

  return moduli;
}

/**
 * Bilancia i moduli di un cluster sulle cameriere (greedy per struttura).
 * Overflow oltre MAX_CARICO → manutentore.
 */
function balanceCluster(moduli, workerNames, manutentoreDisponibile) {
  const workers = workerNames.map((name) => ({
    name,
    carico: 0,
    strutture: [],
  }));
  const manutentore = { name: "Manutentore", carico: 0, strutture: [] };
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

  const sorted = [...moduli].sort((a, b) => b.carico - a.carico);
  for (const m of sorted) {
    workers.sort((a, b) => a.carico - b.carico);
    const least = workers[0];
    const fits = least.carico + m.carico <= TURNI_MAX_CARICO;
    if (fits) {
      least.strutture.push(m);
      least.carico += m.carico;
      continue;
    }
    // Non entra intera: spezza le camere se possibile (spazi comuni a una sola persona)
    if (m.rooms.length > 1) {
      const roomChunks = [...m.rooms].sort((a, b) => b.peso - a.peso);
      const assignedRooms = [];
      const overflowRooms = [];
      let localLoad = least.carico;
      const spaziW = m.spaziComuni ? m.spaziComuni.peso : 0;
      // Prova a mettere spazi comuni sulla meno carica se c'è spazio
      let takeSpazi = false;
      if (m.spaziComuni && localLoad + spaziW <= TURNI_MAX_CARICO) {
        takeSpazi = true;
        localLoad += spaziW;
      }
      for (const room of roomChunks) {
        if (localLoad + room.peso <= TURNI_MAX_CARICO) {
          assignedRooms.push(room);
          localLoad += room.peso;
        } else {
          overflowRooms.push(room);
        }
      }
      if (assignedRooms.length || takeSpazi) {
        const part = {
          ...m,
          rooms: assignedRooms,
          spaziComuni: takeSpazi ? m.spaziComuni : null,
          carico:
            assignedRooms.reduce((s, r) => s + r.peso, 0) +
            (takeSpazi ? spaziW : 0),
          split: true,
        };
        least.strutture.push(part);
        least.carico += part.carico;
      }
      const restSpazi = !takeSpazi && m.spaziComuni ? m.spaziComuni : null;
      if (overflowRooms.length || restSpazi) {
        const overflowPart = {
          ...m,
          rooms: overflowRooms,
          spaziComuni: restSpazi,
          carico:
            overflowRooms.reduce((s, r) => s + r.peso, 0) +
            (restSpazi ? restSpazi.peso : 0),
          split: true,
          noteSplit: "eccesso carico",
        };
        // Prova altre cameriere prima del manutentore
        workers.sort((a, b) => a.carico - b.carico);
        const next = workers.find(
          (w) => w.carico + overflowPart.carico <= TURNI_MAX_CARICO
        );
        if (next) {
          next.strutture.push(overflowPart);
          next.carico += overflowPart.carico;
        } else if (manutentoreDisponibile) {
          manutentore.strutture.push(overflowPart);
          manutentore.carico += overflowPart.carico;
          avvisi.push(
            `Overflow ${m.name}: parte al manutentore (cap ${TURNI_MAX_CARICO})`
          );
        } else {
          least.strutture.push(overflowPart);
          least.carico += overflowPart.carico;
          avvisi.push(
            `Overflow ${m.name} ma manutentore non disponibile: carico forzato su ${least.name}`
          );
        }
      }
      continue;
    }

    if (manutentoreDisponibile) {
      manutentore.strutture.push(m);
      manutentore.carico += m.carico;
      avvisi.push(`Overflow ${m.name} → manutentore (cap ${TURNI_MAX_CARICO})`);
    } else {
      least.strutture.push(m);
      least.carico += m.carico;
      avvisi.push(
        `Cap superato su ${least.name} per ${m.name}; manutentore non disponibile`
      );
    }
  }

  return { workers, manutentore, avvisi };
}

/**
 * Proposta turni pulizie del giorno: bilancia camere + spazi comuni sulle cameriere.
 * Staff indicato di volta in volta (cameriere centro / Domus Turno / manutentore).
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

  let centroNames = normalizeStaffNames(
    args.cameriereNomi?.length ? args.cameriereNomi : args.cameriere,
    "Cameriera",
    2
  );
  let turnoNames = normalizeStaffNames(
    args.cameriereTurnoNomi?.length
      ? args.cameriereTurnoNomi
      : args.cameriereTurno != null
        ? args.cameriereTurno
        : 2,
    "Cameriera Turno",
    2
  );
  if (assenze.size) {
    centroNames = centroNames.filter((n) => !assenze.has(n.toLowerCase()));
    turnoNames = turnoNames.filter((n) => !assenze.has(n.toLowerCase()));
  }

  const manutentoreDisponibile =
    args.manutentoreDisponibile == null ? true : Boolean(args.manutentoreDisponibile);

  const centroModuli = moduli.filter((m) => m.cluster === "centro");
  const turnoModuli = moduli.filter((m) => m.cluster === "turno");

  const centro = balanceCluster(centroModuli, centroNames, manutentoreDisponibile);
  const turno = balanceCluster(turnoModuli, turnoNames, manutentoreDisponibile);

  const avvisi = [...centro.avvisi, ...turno.avvisi];
  if (!centroNames.length) {
    avvisi.push("Nessuna cameriera disponibile per il cluster centro");
  }
  if (turnoModuli.length && !turnoNames.length) {
    avvisi.push("Nessuna cameriera disponibile per Domus Turno");
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
        note: r.note,
        arrivalTime: r.arrivalTime,
      })),
      spaziComuni: s.spaziComuni?.items || [],
      split: s.split || undefined,
    })),
  });

  const perCameriera = [
    ...centro.workers.map((w) => formatWorker(w, "centro")),
    ...turno.workers.map((w) => formatWorker(w, "turno")),
  ];

  const manutentoreParts = [];
  if (centro.manutentore.strutture.length) manutentoreParts.push(...centro.manutentore.strutture);
  if (turno.manutentore.strutture.length) manutentoreParts.push(...turno.manutentore.strutture);
  const manutentore =
    manutentoreParts.length && manutentoreDisponibile
      ? {
          nome: "Manutentore",
          carico:
            Math.round(
              (centro.manutentore.carico + turno.manutentore.carico) * 100
            ) / 100,
          strutture: manutentoreParts.map((s) => ({
            struttura: s.name,
            code: s.code,
            carico: Math.round(s.carico * 100) / 100,
            camere: s.rooms.map((r) => ({
              codifica: r.codifica,
              tipo: r.tipo,
              note: r.note,
            })),
            spaziComuni: s.spaziComuni?.items || [],
          })),
        }
      : null;

  return {
    rule:
      "Proposta turni: chi pulisce una camera di affittacamere fa anche gli spazi comuni. Spazi comuni SEMPRE ogni giorno. Domus Turno = cluster separato. Overflow / assenze → manutentore.",
    date,
    pesi: TURNI_WEIGHTS,
    maxCarico: TURNI_MAX_CARICO,
    staff: {
      centro: centroNames,
      turno: turnoNames,
      manutentoreDisponibile,
      assenze: [...assenze],
    },
    carichi: {
      centro: Math.round(centroModuli.reduce((s, m) => s + m.carico, 0) * 100) / 100,
      turno: Math.round(turnoModuli.reduce((s, m) => s + m.carico, 0) * 100) / 100,
      totale: Math.round(moduli.reduce((s, m) => s + m.carico, 0) * 100) / 100,
    },
    perCameriera,
    manutentore,
    avvisi: avvisi.length ? avvisi : undefined,
    pulizieTotali: pulizie.totali,
  };
}

async function runLocalOrMcp(hub, name, args) {
  if (name === "schedula_moduli") {
    return schedulaModuli(args.modules, {
      dueDate: args.due,
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
export async function runSuperManager(hub, history, userMessage) {
  const messages = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${buildNowContext()}` },
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
        result = { error: err.message };
        actions.push({ name, args, ok: false, error: err.message });
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

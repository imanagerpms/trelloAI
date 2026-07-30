import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TrelloClient } from "./trello-client.js";
import {
  collectModulesFromCards,
  extractModule,
  hasLabel,
  normalizeModule,
  normalizeModuleList,
  targetListForCard,
} from "./module-utils.js";
import {
  DEFAULT_FINESTRA_TIME,
  normalizeArrivalTime,
  romeLocalToUtcIso,
} from "./module-sigla.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

const BOARD_ID = process.env.TRELLO_MANUTENZIONI_BOARD_ID || "618e372daa42cb68df7d7485";
const PERIODIC_LABEL = "Task Periodico";
const DEFAULT_MEMBER = process.env.TRELLO_MANUTENTORE_ID || "69bb36372d40c70721754e53"; // Costache Ciurar

const MANAGED_LISTS = ["periodici", "in esecuzione", "cose da fare", "settimana"];
const SKIP_LISTS = ["template", "terminati"];

/** @returns {{ ymd: string, dueIso: string }} giorno calendario + due di default (06:00 UTC) */
function parseDueDate(input) {
  if (!input?.trim()) {
    throw new Error("Data di scadenza obbligatoria. Es: 16/07/2026 o 2026-07-16");
  }

  const value = input.trim().toLowerCase();

  if (value === "domani" || value === "tomorrow") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setUTCHours(6, 0, 0, 0);
    return { ymd: d.toISOString().slice(0, 10), dueIso: d.toISOString() };
  }

  const itMatch = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (itMatch) {
    const [, day, month, year] = itMatch;
    const ymd = `${year}-${String(+month).padStart(2, "0")}-${String(+day).padStart(2, "0")}`;
    const due = new Date(Date.UTC(+year, +month - 1, +day, 6, 0, 0));
    if (Number.isNaN(due.getTime())) throw new Error(`Data non valida: ${input}`);
    return { ymd, dueIso: due.toISOString() };
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const ymd = `${year}-${month}-${day}`;
    const due = new Date(Date.UTC(+year, +month - 1, +day, 6, 0, 0));
    if (Number.isNaN(due.getTime())) throw new Error(`Data non valida: ${input}`);
    return { ymd, dueIso: due.toISOString() };
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Data non valida: ${input}. Usa GG/MM/AAAA o AAAA-MM-GG`);
  }
  parsed.setUTCHours(6, 0, 0, 0);
  return { ymd: parsed.toISOString().slice(0, 10), dueIso: parsed.toISOString() };
}

function formatDueDate(iso, { withTime = false } = {}) {
  const d = new Date(iso);
  if (!withTime) {
    return d.toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return d.toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function findList(lists, ...names) {
  for (const name of names) {
    const found = lists.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (found) return found;
  }
  return null;
}

/**
 * Normalizza moduleDues: chiavi = sigle, valori = HH:MM o ISO completo.
 * @param {Record<string, string>|undefined} raw
 * @param {string} ymd
 * @returns {Map<string, string>} sigla → due ISO
 */
function resolveModuleDues(raw, ymd) {
  const map = new Map();
  if (!raw || typeof raw !== "object") return map;

  for (const [sigla, value] of Object.entries(raw)) {
    const key = normalizeModule(sigla);
    if (!key || value == null || !String(value).trim()) continue;
    const v = String(value).trim();

    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new Error(`Scadenza modulo non valida per ${key}: ${v}`);
      map.set(key, d.toISOString());
      continue;
    }

    const hhmm = normalizeArrivalTime(v) || (v === "default" ? DEFAULT_FINESTRA_TIME : null);
    if (!hhmm) throw new Error(`Orario non valido per ${key}: ${v} (usa HH:MM)`);
    map.set(key, romeLocalToUtcIso(ymd, hhmm));
  }
  return map;
}

function dueEquals(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return new Date(a).getTime() === new Date(b).getTime();
}

export async function schedulaModuli(freeModulesInput, options = {}) {
  const {
    assignMember = true,
    setDueDate = true,
    dueDate,
    moduleDues: moduleDuesRaw,
    dryRun = false,
  } = options;

  const parsedDue = dueDate ? parseDueDate(dueDate) : null;
  if (setDueDate && !parsedDue) {
    throw new Error("Indica la data di scadenza con --scadenza GG/MM/AAAA");
  }
  const dueIso = parsedDue?.dueIso || null;
  const ymd = parsedDue?.ymd;
  const moduleDueMap = ymd ? resolveModuleDues(moduleDuesRaw, ymd) : new Map();

  const client = new TrelloClient(process.env.TRELLO_API_KEY, process.env.TRELLO_TOKEN);
  const freeModules = normalizeModuleList(
    Array.isArray(freeModulesInput) ? freeModulesInput : freeModulesInput.split(/[,;\n]+/)
  );

  const lists = await client.listLists(BOARD_ID);
  const listById = Object.fromEntries(lists.map((l) => [l.id, l.name]));
  const listNames = {
    periodici: findList(lists, "Periodici")?.id,
    inEsecuzione: findList(lists, "IN ESECUZIONE")?.id,
    coseDaFare: findList(lists, "Cose Da fare", "COSE DA FARE")?.id,
    settimana: findList(lists, "Settimana")?.id,
  };

  const skipListIds = new Set(
    lists.filter((l) => SKIP_LISTS.some((s) => l.name.toLowerCase().includes(s))).map((l) => l.id)
  );
  const managedListIds = new Set(
    lists
      .filter((l) => MANAGED_LISTS.some((m) => l.name.toLowerCase() === m))
      .map((l) => l.id)
  );

  const cards = await client.listCards({ boardId: BOARD_ID, filter: "open" });
  const allModules = collectModulesFromCards(cards);
  const knownModules = [...new Set([...allModules, ...freeModules])];

  const moves = [];
  const dueUpdates = [];
  const skipped = [];

  for (const card of cards) {
    if (skipListIds.has(card.idList)) continue;
    if (!managedListIds.has(card.idList)) continue;

    const module = extractModule(card.name, knownModules);
    if (!module) {
      skipped.push({ name: card.name, list: listById[card.idList], reason: "modulo non riconosciuto" });
      continue;
    }

    const moduleNorm = normalizeModule(module);
    const isFree = freeModules.includes(moduleNorm);
    const isPeriodic = hasLabel(card, PERIODIC_LABEL);
    const targetId = targetListForCard({
      module: moduleNorm,
      isFree,
      isPeriodic,
      listNames,
    });

    const cardDueForModule = moduleDueMap.has(moduleNorm)
      ? moduleDueMap.get(moduleNorm)
      : dueIso;
    const alreadyInTarget = targetId && card.idList === targetId;
    const onInEsecuzione = card.idList === listNames.inEsecuzione;
    const targetIsInEsecuzione = targetId === listNames.inEsecuzione;

    // Refresh due su card già in IN ESECUZIONE con override finestra diverso
    if (
      alreadyInTarget &&
      onInEsecuzione &&
      setDueDate &&
      moduleDueMap.has(moduleNorm) &&
      !dueEquals(card.due, cardDueForModule)
    ) {
      const update = {
        id: card.id,
        name: card.name,
        module: moduleNorm,
        from: listById[card.idList],
        to: listById[card.idList],
        dueDate: formatDueDate(cardDueForModule, { withTime: true }),
        dueOnly: true,
      };
      if (!dryRun) {
        await client.updateCard(card.id, { due: cardDueForModule });
      }
      dueUpdates.push(update);
      continue;
    }

    if (!targetId || alreadyInTarget) continue;

    const move = {
      id: card.id,
      name: card.name,
      module: moduleNorm,
      from: listById[card.idList],
      to: listById[targetId],
      isPeriodic,
      isFree,
      finestra: moduleDueMap.has(moduleNorm),
    };

    if (!dryRun) {
      const fields = { idList: targetId };
      const leavingInEsecuzione = onInEsecuzione;
      const enteringInEsecuzione = targetIsInEsecuzione;

      if (enteringInEsecuzione) {
        if (assignMember) fields.idMembers = DEFAULT_MEMBER;
        if (setDueDate) fields.due = cardDueForModule;
        move.dueDate = formatDueDate(cardDueForModule, {
          withTime: moduleDueMap.has(moduleNorm),
        });
      } else if (leavingInEsecuzione) {
        fields.due = "";
        move.dueDate = "rimossa";
      }

      await client.updateCard(card.id, fields);
    } else {
      if (targetIsInEsecuzione) {
        move.dueDate = formatDueDate(cardDueForModule, {
          withTime: moduleDueMap.has(moduleNorm),
        });
      } else if (onInEsecuzione) move.dueDate = "rimossa";
    }
    moves.push(move);
  }

  const finestraModules = [...moduleDueMap.keys()].filter((m) => freeModules.includes(m));

  return {
    freeModules,
    finestraModules,
    moduleDues: Object.fromEntries(
      [...moduleDueMap.entries()].map(([k, v]) => [k, formatDueDate(v, { withTime: true })])
    ),
    moves,
    dueUpdates,
    skipped,
    dryRun,
    dueDate: dueIso ? formatDueDate(dueIso) : null,
  };
}

function parseFinestraArg(raw) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!raw?.trim()) return out;
  for (const part of raw.split(/[,;]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Formato --finestra non valido: "${trimmed}" (usa SIGLA=HH:MM)`);
    }
    const sigla = trimmed.slice(0, eq).trim();
    const time = trimmed.slice(eq + 1).trim();
    out[sigla] = time;
  }
  return out;
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  let dueDate;
  let finestraRaw;
  const modules = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--scadenza" || argv[i] === "--due") {
      dueDate = argv[++i];
    } else if (argv[i] === "--finestra") {
      finestraRaw = argv[++i];
    } else if (!argv[i].startsWith("--")) {
      modules.push(argv[i]);
    }
  }

  return { dryRun, dueDate, modules, moduleDues: parseFinestraArg(finestraRaw) };
}

async function main() {
  const { dryRun, dueDate, modules, moduleDues } = parseArgs(process.argv.slice(2));

  if (modules.length === 0) {
    console.error(
      'Uso: npm run schedula -- NR1 NR2 --scadenza 16/07/2026 [--finestra NR3=15:00,ITC301=14:30] [--dry-run]'
    );
    process.exit(1);
  }

  if (!dueDate) {
    console.error("Errore: indica la scadenza con --scadenza GG/MM/AAAA");
    process.exit(1);
  }

  const hasFinestra = Object.keys(moduleDues).length > 0;
  const result = await schedulaModuli(modules, {
    dryRun,
    dueDate,
    moduleDues: hasFinestra ? moduleDues : undefined,
  });
  console.log(`Moduli liberi/finestra: ${result.freeModules.join(", ")}`);
  console.log(`Scadenza default: ${result.dueDate}`);
  if (result.finestraModules?.length) {
    console.log(
      `Finestre: ${result.finestraModules.map((m) => `${m}=${result.moduleDues[m]}`).join(", ")}`
    );
  }
  console.log(`${dryRun ? "[DRY RUN] " : ""}Spostati ${result.moves.length} task:\n`);
  for (const m of result.moves) {
    console.log(`  ${m.name}`);
    console.log(
      `    ${m.from} → ${m.to} (${m.module})${m.dueDate ? " | scadenza: " + m.dueDate : ""}${m.finestra ? " [finestra]" : ""}`
    );
  }
  if (result.dueUpdates?.length) {
    console.log(`\nAggiornate scadenze (già IN ESECUZIONE): ${result.dueUpdates.length}`);
    for (const u of result.dueUpdates) {
      console.log(`  ${u.name} → scadenza: ${u.dueDate}`);
    }
  }
  if (result.skipped.length) {
    console.log(`\nSaltati ${result.skipped.length} task (modulo non riconosciuto)`);
  }
}

if (process.argv[1]?.endsWith("schedula-moduli.js")) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

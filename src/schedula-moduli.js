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

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

const BOARD_ID = process.env.TRELLO_MANUTENZIONI_BOARD_ID || "618e372daa42cb68df7d7485";
const PERIODIC_LABEL = "Task Periodico";
const DEFAULT_MEMBER = process.env.TRELLO_MANUTENTORE_ID || "69bb36372d40c70721754e53"; // Costache Ciurar

const MANAGED_LISTS = ["periodici", "in esecuzione", "cose da fare", "settimana"];
const SKIP_LISTS = ["template", "terminati"];

function parseDueDate(input) {
  if (!input?.trim()) {
    throw new Error("Data di scadenza obbligatoria. Es: 16/07/2026 o 2026-07-16");
  }

  const value = input.trim().toLowerCase();

  if (value === "domani" || value === "tomorrow") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setUTCHours(6, 0, 0, 0);
    return d.toISOString();
  }

  const itMatch = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (itMatch) {
    const [, day, month, year] = itMatch;
    const d = new Date(Date.UTC(+year, +month - 1, +day, 6, 0, 0));
    if (Number.isNaN(d.getTime())) throw new Error(`Data non valida: ${input}`);
    return d.toISOString();
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const d = new Date(Date.UTC(+year, +month - 1, +day, 6, 0, 0));
    if (Number.isNaN(d.getTime())) throw new Error(`Data non valida: ${input}`);
    return d.toISOString();
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Data non valida: ${input}. Usa GG/MM/AAAA o AAAA-MM-GG`);
  }
  parsed.setUTCHours(6, 0, 0, 0);
  return parsed.toISOString();
}

function formatDueDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function findList(lists, ...names) {
  for (const name of names) {
    const found = lists.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (found) return found;
  }
  return null;
}

export async function schedulaModuli(freeModulesInput, options = {}) {
  const {
    assignMember = true,
    setDueDate = true,
    dueDate,
    dryRun = false,
  } = options;

  const dueIso = dueDate ? parseDueDate(dueDate) : null;
  if (setDueDate && !dueIso) {
    throw new Error("Indica la data di scadenza con --scadenza GG/MM/AAAA");
  }

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

    if (!targetId || card.idList === targetId) continue;

    const move = {
      id: card.id,
      name: card.name,
      module: moduleNorm,
      from: listById[card.idList],
      to: listById[targetId],
      isPeriodic,
      isFree,
    };

    if (!dryRun) {
      const fields = { idList: targetId };
      const leavingInEsecuzione = card.idList === listNames.inEsecuzione;
      const enteringInEsecuzione = targetId === listNames.inEsecuzione;

      if (enteringInEsecuzione) {
        if (assignMember) fields.idMembers = DEFAULT_MEMBER;
        if (setDueDate) fields.due = dueIso;
        move.dueDate = formatDueDate(dueIso);
      } else if (leavingInEsecuzione) {
        fields.due = "";
        move.dueDate = "rimossa";
      }

      await client.updateCard(card.id, fields);
    } else {
      if (targetId === listNames.inEsecuzione) move.dueDate = formatDueDate(dueIso);
      else if (card.idList === listNames.inEsecuzione) move.dueDate = "rimossa";
    }
    moves.push(move);
  }

  return { freeModules, moves, skipped, dryRun, dueDate: dueIso ? formatDueDate(dueIso) : null };
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  let dueDate;
  const modules = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--scadenza" || argv[i] === "--due") {
      dueDate = argv[++i];
    } else if (!argv[i].startsWith("--")) {
      modules.push(argv[i]);
    }
  }

  return { dryRun, dueDate, modules };
}

async function main() {
  const { dryRun, dueDate, modules } = parseArgs(process.argv.slice(2));

  if (modules.length === 0) {
    console.error("Uso: npm run schedula -- NR1 NR2 --scadenza 16/07/2026 [--dry-run]");
    process.exit(1);
  }

  if (!dueDate) {
    console.error("Errore: indica la scadenza con --scadenza GG/MM/AAAA");
    process.exit(1);
  }

  const result = await schedulaModuli(modules, { dryRun, dueDate });
  console.log(`Moduli liberi: ${result.freeModules.join(", ")}`);
  console.log(`Scadenza: ${result.dueDate}`);
  console.log(`${dryRun ? "[DRY RUN] " : ""}Spostati ${result.moves.length} task:\n`);
  for (const m of result.moves) {
    console.log(`  ${m.name}`);
    console.log(`    ${m.from} → ${m.to} (${m.module})${m.dueDate ? " | scadenza: " + m.dueDate : ""}`);
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

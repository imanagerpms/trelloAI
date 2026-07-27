/**
 * Config runtime: JSON in config/ + markdown in rules/.
 * Hot-reload su mtime / invalidate dopo save dalla UI admin.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(__dirname, "..");
export const configDir = join(projectRoot, "config");
export const rulesDir = join(projectRoot, "rules");

const cache = {
  accommodations: { mtime: 0, data: null },
  turni: { mtime: 0, data: null },
  boards: { mtime: 0, data: null },
  meta: { mtime: 0, data: null },
  rulesText: { key: "", data: null },
};

function readJsonCached(name, file) {
  const path = join(configDir, file);
  if (!existsSync(path)) {
    throw new Error(`Config mancante: ${path}`);
  }
  const mtime = statSync(path).mtimeMs;
  const slot = cache[name];
  if (slot.data && slot.mtime === mtime) return slot.data;
  const data = JSON.parse(readFileSync(path, "utf8"));
  slot.mtime = mtime;
  slot.data = data;
  return data;
}

export function invalidateRuntimeCache() {
  for (const k of Object.keys(cache)) {
    cache[k].mtime = 0;
    cache[k].data = null;
    if (cache[k].key != null) cache[k].key = "";
  }
}

export function getAccommodationsConfig() {
  return readJsonCached("accommodations", "accommodations.json");
}

export function getTurniConfig() {
  return readJsonCached("turni", "turni.json");
}

export function getBoardsConfig() {
  return readJsonCached("boards", "boards.json");
}

export function getMetaConfig() {
  return readJsonCached("meta", "meta.json");
}

/** Map id → cfg come l’ex ACCOMMODATION_CONFIG. */
export function getAccommodationMap() {
  return getAccommodationsConfig().accommodations || {};
}

export function getMasterAccommodationIds() {
  const ids = getAccommodationsConfig().masterAccommodationIds || [];
  return new Set(ids.map(String));
}

export function getTurniWeights() {
  return getTurniConfig().weights || {};
}

export function getSpazioComunePesi() {
  return getTurniConfig().spaziComuniPesi || {};
}

export function getTurniMaxCarico() {
  const n = Number(getTurniConfig().maxCarico);
  return Number.isFinite(n) && n > 0 ? n : 6;
}

export function getStaffDefaults() {
  return (
    getTurniConfig().staffDefaults || {
      cameriereCentro: 2,
      tenerifeNomi: ["Lala"],
      manutentoreTenerifeNome: "Mario",
      manutentoreRomaNome: "Manutentore",
    }
  );
}

/**
 * Board IDs: env override > config/boards.json.
 */
export function resolveBoardIds() {
  const cfg = getBoardsConfig();
  const out = {};
  for (const [key, b] of Object.entries(cfg.boards || {})) {
    out[key] = process.env[b.envKey] || b.id;
  }
  return out;
}

export function resolvePeople() {
  const cfg = getBoardsConfig();
  const out = {};
  for (const [key, p] of Object.entries(cfg.people || {})) {
    out[key] = {
      id: process.env[p.envKey] || p.id,
      name: p.name,
    };
  }
  return out;
}

export function listRules() {
  return getMetaConfig().rules || [];
}

export function rulesFilePath(id) {
  const entry = listRules().find((r) => r.id === id);
  if (!entry) return null;
  return join(rulesDir, entry.file);
}

export function readRule(id) {
  const path = rulesFilePath(id);
  if (!path || !existsSync(path)) {
    throw new Error(`Regola non trovata: ${id}`);
  }
  return readFileSync(path, "utf8");
}

export function writeRule(id, markdown) {
  const path = rulesFilePath(id);
  if (!path) throw new Error(`Regola non trovata: ${id}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(markdown ?? ""), "utf8");
  invalidateRuntimeCache();
}

export function writeConfigJson(name, data) {
  const files = {
    accommodations: "accommodations.json",
    turni: "turni.json",
    boards: "boards.json",
    meta: "meta.json",
  };
  const file = files[name];
  if (!file) throw new Error(`Config sconosciuta: ${name}`);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, file), JSON.stringify(data, null, 2) + "\n", "utf8");
  invalidateRuntimeCache();
}

/**
 * System prompt assemblato dalle regole includeInSystemPrompt + board IDs.
 */
export function buildSystemPrompt() {
  const boardIds = resolveBoardIds();
  const people = resolvePeople();
  const parts = [];
  for (const r of listRules()) {
    if (!r.includeInSystemPrompt) continue;
    try {
      parts.push(readRule(r.id).trim());
    } catch {
      /* skip missing */
    }
  }
  const peopleLine = Object.values(people)
    .map((p) => p.name)
    .filter(Boolean)
    .join(", ");
  const footer = `

## Board Trello (runtime)
- Manutenzioni: ${boardIds.manutenzioni || "?"}
- Gestione: ${boardIds.gestione || "?"}
- Amministrazione: ${boardIds.amministrazione || "?"}
Persone: ${peopleLine || "Costache, Daniele, Meri"}.
`;
  return parts.join("\n\n---\n\n") + footer;
}

/** Leggi un file markdown da rules/ (path relativo). */
export function readRulesMarkdown(rulesRelative) {
  const primary = join(rulesDir, rulesRelative);
  if (existsSync(primary)) return readFileSync(primary, "utf8");
  return null;
}

export function secretsStatus() {
  const present = (k) => Boolean(process.env[k] && String(process.env[k]).trim());
  return {
    adminToken: present("ADMIN_TOKEN"),
    trello: present("TRELLO_API_KEY") && present("TRELLO_TOKEN"),
    telegram: present("TELEGRAM_BOT_TOKEN"),
    openai: present("OPENAI_API_KEY"),
    anthropic: present("ANTHROPIC_API_KEY"),
    octorate: present("OCTORATE_MCP_PUBLIC") || present("OCTORATE_MCP_ACCESS_TOKEN"),
    aibridge: present("AIBRIDGE_API_URL") || present("AIBRIDGE_API_KEY"),
  };
}

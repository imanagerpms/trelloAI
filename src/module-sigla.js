import { renameItcRoom } from "./rename-itc.js";
import { normalizeModule } from "./module-utils.js";

/**
 * Codice camera compatto da nome PMS (es. "ITC #1 (Tripla BP)" → "ITC#1").
 * Stessa logica usata per le pulizie.
 */
export function shortRoomCode(name) {
  if (!name) return "?";
  const base = String(name).split("(")[0].trim();
  const compact = base.replace(/\s*#\s*/, "#").replace(/\s+/g, "");
  return compact || base;
}

/**
 * Converte un nome camera PMS Tableau nella sigla Manutenzioni Trello.
 * Es. "ITC #1 (Tripla BP)" → "ITC301", "NR 3" → "NR3", "DF#2" → "DF2".
 */
export function pmsNameToModuleSigla(name) {
  if (!name) return null;
  let s = shortRoomCode(name);
  if (s === "?") return null;

  // ITC#1 / ITC1 → ITC301 (notazione board Manutenzioni)
  s = renameItcRoom(s.replace(/#/g, ""));

  // Altre strutture: "NR#3" / "NR 3" / "DF#2" → "NR3" / "DF2"
  s = s.replace(/#/g, "");
  s = s.replace(/\b(NR|DT|DF|DC|ITC)\s+(\d+)\b/gi, (_, code, num) => `${code}${num}`);

  // Solo codice+numero o già normalizzato
  const m = s.match(/\b((?:NR|ITC|DT|DF|DC)\d+)\b/i);
  if (m) return normalizeModule(m[1]);

  const common = s.match(/\b((?:NR|ITC|DT|DF|DC)\s*(?:CORRIDOIO|CUCINA|AREA COMUNE))\b/i);
  if (common) return normalizeModule(common[1]);

  return normalizeModule(s);
}

/**
 * Instant ISO per una data+ora in Europe/Rome.
 * @param {string} ymd - yyyy-MM-dd
 * @param {string} [hhmm] - HH:MM (default 14:00)
 */
export function romeLocalToUtcIso(ymd, hhmm = "14:00") {
  const dateMatch = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) throw new Error(`Data non valida: ${ymd}`);
  const timeMatch = String(hhmm).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) throw new Error(`Orario non valido: ${hhmm}`);

  const y = +dateMatch[1];
  const mo = +dateMatch[2];
  const d = +dateMatch[3];
  const hh = +timeMatch[1];
  const mm = +timeMatch[2];
  if (hh > 23 || mm > 59) throw new Error(`Orario non valido: ${hhmm}`);

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const asUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const partsMs = (ms) => {
    const parts = Object.fromEntries(
      dtf
        .formatToParts(new Date(ms))
        .filter((x) => x.type !== "literal")
        .map((x) => [x.type, x.value])
    );
    return Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour === 24 ? 0 : +parts.hour,
      +parts.minute,
      +parts.second
    );
  };
  // asUtc interpretato come se i componenti locali fossero UTC; correggi con l'offset Roma
  const offset = partsMs(asUtc) - asUtc;
  return new Date(asUtc - offset).toISOString();
}

/** Normalizza arrivalTime Octorate ("15:00", "15", "3:30 PM") → "HH:MM" o null. */
export function normalizeArrivalTime(raw) {
  if (raw == null || !String(raw).trim()) return null;
  const s = String(raw).trim();
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const h = +hm[1];
    const m = +hm[2];
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const onlyH = s.match(/^(\d{1,2})$/);
  if (onlyH) {
    const h = +onlyH[1];
    if (h > 23) return null;
    return `${String(h).padStart(2, "0")}:00`;
  }
  return null;
}

export const DEFAULT_FINESTRA_TIME = "14:00";

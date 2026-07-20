/** Estrae la sigla modulo dal titolo di una card (es. "NR1 [MENSILE]" → "NR1"). */
export function extractModule(cardName, knownModules = []) {
  const sorted = [...knownModules]
    .map((m) => m.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const mod of sorted) {
    const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\s)${escaped}(\\s|\\[|-|$)`, "i");
    if (re.test(cardName)) return mod;
  }
  return null;
}

/** Raccoglie tutte le sigle modulo uniche dalla board (per matching). */
export function collectModulesFromCards(cards) {
  const modules = new Set();
  const pattern =
    /\b((?:NR|ITC|DT|DF|DC)\s*(?:CORRIDOIO|CUCINA|AREA COMUNE|\d+)|(?:NR|ITC|DT|DF|DC)\d+)\b/gi;

  for (const card of cards) {
    let match;
    while ((match = pattern.exec(card.name)) !== null) {
      modules.add(normalizeModule(match[1]));
    }
    // Sigle composte tipo "NR CORRIDOIO"
    for (const m of card.name.match(/\b(NR|ITC|DT|DF|DC)\s+(CORRIDOIO|CUCINA|AREA COMUNE)\b/gi) || []) {
      modules.add(normalizeModule(m));
    }
  }
  return [...modules];
}

export function normalizeModule(sigla) {
  return sigla.trim().replace(/\s+/g, " ").toUpperCase();
}

export function normalizeModuleList(list) {
  return list.map(normalizeModule);
}

export function hasLabel(card, labelName) {
  return (card.labels || []).some(
    (l) => (l.name || "").toLowerCase() === labelName.toLowerCase()
  );
}

/** Destinazione lista in base a modulo libero e tipo task. */
export function targetListForCard({ module, isFree, isPeriodic, listNames }) {
  if (isFree) return listNames.inEsecuzione;
  if (isPeriodic) return listNames.periodici;
  return listNames.settimana;
}

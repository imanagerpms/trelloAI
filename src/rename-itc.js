/** Rinomina sigle camera ITC1-5 → ITC301-305 (solo formato, non tocca ITC CUCINA/CORRIDOIO). */

const ROOM_MAP = { 1: "301", 2: "302", 3: "303", 4: "304", 5: "305" };

function roomCode(n) {
  return `ITC30${n}`;
}

/** ITC#1, ITC #5, ITC#301, ITC#301CAMERA → ITC301 */
function fixHashNotation(name) {
  return name.replace(
    /\bITC\s*#\s*(?:30([1-5])|([1-5]))(?!\d)/gi,
    (_, g1, g2) => roomCode(g1 || g2)
  );
}

/** ITC1, ITC 3 (non già ITC301) → ITC301 */
function fixPlainNotation(name) {
  return name.replace(/\bITC\s*([1-5])\b/gi, (match, n, offset, str) => {
    const after = str.slice(offset + match.length);
    if (/^\d/.test(after)) return match; // già ITC301...
    return roomCode(n);
  });
}

/** ITC303,2 oppure ITC301,4,5 → ITC303,302 / ITC301,304,305 */
function fixCommaNotation(name) {
  return name.replace(/,(\s*)([1-5])\b/g, (_, sp, n) => `,${sp}${ROOM_MAP[n]}`);
}

export function renameItcRoom(name) {
  let result = name;
  result = fixHashNotation(result);
  result = fixPlainNotation(result);
  result = fixCommaNotation(result);
  return result;
}

export function needsItcRename(name) {
  return renameItcRoom(name) !== name;
}

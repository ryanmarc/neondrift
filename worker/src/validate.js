// Pure checks on everything the client sends. Anything that fails here gets a
// 400 before any database or replay work happens.

export const NAME_MAX = 16;
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const NAME_RE = /^[A-Za-z0-9 _.\-'!?]+$/;
const BLOCKED = ["admin", "moderator"];   // extend as needed; matched case-insensitively as whole names

/** Trim, collapse spaces, enforce the character set and length. Returns null if unusable. */
export function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > NAME_MAX || !NAME_RE.test(name)) return null;
  if (BLOCKED.includes(name.toLowerCase())) return null;
  return name;
}

export function validSecret(s) { return typeof s === "string" && /^[0-9a-f]{32}$/.test(s); }
/** A pairing token: the new device's 128-bit collection capability, same shape as a secret. */
export function validToken(s) { return typeof s === "string" && /^[0-9a-f]{32}$/.test(s); }
export function validSeed(s) { return typeof s === "string" && s.length >= 1 && s.length <= 64 && /^[\x21-\x7e]+$/.test(s); }
export function validTrackId(s) { return typeof s === "string" && /^[0-9a-z]{1,8}$/.test(s); }
export function validTime(t) { return typeof t === "number" && Number.isFinite(t) && t > 0 && t <= 75; }
export function validCode(c) { return typeof c === "string" && c.length === 6 && [...c].every(ch => CODE_ALPHABET.includes(ch)); }

export function validInputs(a) {
  if (!Array.isArray(a) || a.length % 2 !== 0 || a.length > 4000) return false;
  let last = -1;
  for (let i = 0; i < a.length; i += 2) {
    const s = a[i], inp = a[i + 1];
    if (!Number.isInteger(s) || s <= last) return false;
    if (inp !== -1 && inp !== 0 && inp !== 1) return false;
    last = s;
  }
  return true;
}

export function validGhost(a) {
  if (!Array.isArray(a) || a.length % 4 !== 0 || a.length > 9000) return false;
  return a.every(x => typeof x === "number" && Number.isFinite(x));
}

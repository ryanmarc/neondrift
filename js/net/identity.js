// Who this browser is on the leaderboard: a random secret and a display name,
// both in localStorage. The server only ever sees sha256(secret); the first
// four characters of that hash are the tag shown after the name.

import * as storage from "../core/storage.js";

const SECRET_KEY = "neondrift:player";
const NAME_KEY = "neondrift:name";

let cachedId = null, cachedFor = null;

export function getSecret() { return storage.read(SECRET_KEY); }

export function setSecret(secret) { storage.write(SECRET_KEY, secret); cachedId = null; }

/** The secret, creating one on first use. */
export function ensureSecret() {
  let s = getSecret();
  if (!s) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    s = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
    setSecret(s);
  }
  return s;
}

export function getName() { return storage.read(NAME_KEY); }
export function setName(name) { storage.write(NAME_KEY, name); }
export function hasIdentity() { return !!getSecret() && !!getName(); }

/** sha256 of the secret as hex — the id the server keys rows on. */
export async function playerId() {
  const s = getSecret();
  if (!s) return null;
  if (cachedId && cachedFor === s) return cachedId;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  cachedId = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  cachedFor = s;
  return cachedId;
}

export async function tag() { const id = await playerId(); return id ? id.slice(0, 4) : ""; }

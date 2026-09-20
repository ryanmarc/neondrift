// localStorage that never throws. Private windows, blocked site data and
// file:// quirks all surface as "nothing stored", and the game renders fine
// with nothing stored.

export function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function remove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

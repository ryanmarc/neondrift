// sha256 as lowercase hex: the player id is sha256(secret). Shared by the
// HTTP routes and the live room.
export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

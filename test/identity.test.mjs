import { test } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, val) => store.set(k, String(val)),
  removeItem: k => store.delete(k),
};
const id = await import(new URL("../js/net/identity.js", import.meta.url));

test("ensureSecret makes a 32-hex secret once and keeps it", () => {
  assert.equal(id.getSecret(), null);
  const s = id.ensureSecret();
  assert.match(s, /^[0-9a-f]{32}$/);
  assert.equal(id.ensureSecret(), s);
  assert.equal(store.get("neondrift:player"), s);
});

test("playerId is sha256 of the secret and tag is its first four chars", async () => {
  id.setSecret("0123456789abcdef0123456789abcdef");
  const pid = await id.playerId();
  assert.match(pid, /^[0-9a-f]{64}$/);
  // the worker's smoke test showed this secret's tag as 3eb1
  assert.equal(pid.slice(0, 4), "3eb1");
  assert.equal(await id.tag(), "3eb1");
});

test("name round-trips through storage", () => {
  assert.equal(id.getName(), null);
  id.setName("Ryan");
  assert.equal(id.getName(), "Ryan");
  assert.equal(id.hasIdentity(), true);
});

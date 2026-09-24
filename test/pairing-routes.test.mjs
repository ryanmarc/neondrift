// Device pairing, reversed: the new device shows a code and holds a token; the
// device that has the secret types the code to approve; the new device polls
// with its token to collect the secret. A code alone never retrieves anything.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { fakeD1 } from "./d1.mjs";

const worker = (await import("../worker/src/index.js")).default;

const SECRET = "0123456789abcdef0123456789abcdef";
const post = (env, path, body) =>
  worker.fetch(new Request("https://api.test" + path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), env);
const json = async (res) => ({ status: res.status, body: await res.json() });
const freshEnv = () => ({ DB: fakeD1(), ALLOWED_ORIGINS: "" });

test("start mints a typeable code and a long token, with an expiry", async () => {
  const { status, body } = await json(await post(freshEnv(), "/pair/start", {}));
  assert.equal(status, 200);
  assert.match(body.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.match(body.token, /^[0-9a-f]{32}$/);
  assert.ok(body.expires > Date.now());
});

test("polling before approval is pending", async () => {
  const env = freshEnv();
  const { body: p } = await json(await post(env, "/pair/start", {}));
  const { status, body } = await json(await post(env, "/pair/poll", { token: p.token }));
  assert.equal(status, 200);
  assert.deepEqual(body, { status: "pending" });
});

test("approving with the code delivers the secret and name to the token, once", async () => {
  const env = freshEnv();
  await post(env, "/name", { secret: SECRET, name: "Ryan" });
  const { body: p } = await json(await post(env, "/pair/start", {}));

  const ok = await json(await post(env, "/pair/approve", { code: p.code, secret: SECRET }));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });

  const ready = await json(await post(env, "/pair/poll", { token: p.token }));
  assert.equal(ready.status, 200);
  assert.deepEqual(ready.body, { status: "ready", secret: SECRET, name: "Ryan" });

  const again = await json(await post(env, "/pair/poll", { token: p.token }));
  assert.equal(again.status, 404, "delivery consumes the pairing");
  assert.equal(again.body.error, "unknown-token");
});

test("a code that was never started, or already approved, cannot be approved", async () => {
  const env = freshEnv();
  const nobody = await json(await post(env, "/pair/approve", { code: "ABCDEF", secret: SECRET }));
  assert.equal(nobody.status, 404);
  assert.equal(nobody.body.error, "unknown-code");

  const { body: p } = await json(await post(env, "/pair/start", {}));
  await post(env, "/pair/approve", { code: p.code, secret: SECRET });
  const twice = await json(await post(env, "/pair/approve", { code: p.code, secret: "f".repeat(32) }));
  assert.equal(twice.status, 404, "a second approval can't swap in another secret");
  const ready = await json(await post(env, "/pair/poll", { token: p.token }));
  assert.equal(ready.body.secret, SECRET, "the first approval is the one delivered");
});

test("an expired pairing can be neither approved nor collected", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  try {
    const env = freshEnv();
    const { body: p } = await json(await post(env, "/pair/start", {}));
    assert.equal((await post(env, "/pair/poll", { token: p.token })).status, 200, "live before expiry");
    mock.timers.setTime(p.expires + 1);
    const late = await json(await post(env, "/pair/approve", { code: p.code, secret: SECRET }));
    assert.equal(late.status, 404);
    const poll = await json(await post(env, "/pair/poll", { token: p.token }));
    assert.equal(poll.status, 404);
  } finally { mock.timers.reset(); }
});

test("the human code is not a retrieval capability", async () => {
  const env = freshEnv();
  await post(env, "/name", { secret: SECRET, name: "Ryan" });
  const { body: p } = await json(await post(env, "/pair/start", {}));
  await post(env, "/pair/approve", { code: p.code, secret: SECRET });
  const byCode = await json(await post(env, "/pair/poll", { token: p.code }));
  assert.equal(byCode.status, 400, "a code has the wrong shape for a token");
  const claim = await json(await post(env, "/pair/claim", { code: p.code }));
  assert.equal(claim.status, 404, "the old claim route is gone");
});

test("malformed bodies are rejected before any database work", async () => {
  const env = freshEnv();
  assert.equal((await post(env, "/pair/approve", { code: "abc", secret: SECRET })).status, 400);
  assert.equal((await post(env, "/pair/approve", { code: "ABCDEF", secret: "nope" })).status, 400);
  assert.equal((await post(env, "/pair/poll", {})).status, 400);
  assert.equal((await post(env, "/pair/poll", { token: "ZZ" })).status, 400);
});

test("polling has its own rate budget, separate from the write limit", async () => {
  const exhausted = { limit: async () => ({ success: false }) }, open = { limit: async () => ({ success: true }) };
  const env = { ...freshEnv(), POST_LIMIT: exhausted, CLAIM_LIMIT: exhausted, POLL_LIMIT: open };
  assert.equal((await post(env, "/pair/start", {})).status, 429, "start counts as a write");
  assert.equal((await post(env, "/pair/approve", { code: "ABCDEF", secret: SECRET })).status, 429, "approve is the guessable surface");
  const poll = await json(await post(env, "/pair/poll", { token: "a".repeat(32) }));
  assert.notEqual(poll.status, 429, "a 2s poll would blow through the 20/min write limit");
  env.POLL_LIMIT = exhausted;
  assert.equal((await post(env, "/pair/poll", { token: "a".repeat(32) })).status, 429);
});

// Peer ghosts (js/game/peers.js): drawn DELAY_MS behind the newest pose,
// interpolated between the two poses around that moment, snapped on a
// restart, faded out when a peer goes quiet.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const P = await import(new URL("../js/game/peers.js", import.meta.url));
const near = (a, b) => Math.abs(a - b) < 1e-9;

beforeEach(() => { P.clearPeers(); P.setPeer({ id: "x", name: "Ex", tag: "xxxx" }); });

test("a pose for an unknown peer is ignored", () => {
  P.addPose("nobody", [0, 0, 0, 0], 0);
  assert.equal(P.peers.has("nobody"), false);
});

test("drawn DELAY_MS behind, interpolated between the bracketing poses", () => {
  P.addPose("x", [0, 0, 0, 0.1], 1000);
  P.addPose("x", [100, 50, 1, 0.2], 1100);
  const q = P.peerPose(P.peers.get("x"), 1050 + P.DELAY_MS);
  assert.ok(near(q.x, 50) && near(q.y, 25) && near(q.a, 0.5), JSON.stringify(q));
  assert.equal(q.alpha, 1);
});

test("before the first pose's time it holds the first; after the last it holds the last", () => {
  P.addPose("x", [0, 0, 0, 0.1], 1000);
  P.addPose("x", [100, 0, 0, 0.2], 1100);
  assert.equal(P.peerPose(P.peers.get("x"), 1000).x, 0);
  assert.equal(P.peerPose(P.peers.get("x"), 1100 + P.DELAY_MS + 50).x, 100);
});

test("the angle takes the short way round", () => {
  P.addPose("x", [0, 0, 3.0, 0.1], 1000);
  P.addPose("x", [0, 0, -3.0, 0.2], 1100);
  const a = P.peerPose(P.peers.get("x"), 1050 + P.DELAY_MS).a;
  assert.ok(Math.abs(Math.abs(a) - Math.PI) < 0.01, "midway is ±π, not 0: " + a);
});

test("a restart (progress drops by over half a lap) snaps instead of sliding back", () => {
  P.addPose("x", [500, 500, 0, 0.95], 1000);
  P.addPose("x", [0, 0, 0, 0.0], 1100);
  const q = P.peerPose(P.peers.get("x"), 1050 + P.DELAY_MS);
  assert.equal(q.x, 0);
});

test("silent for SILENT_MS it fades over FADE_MS, then disappears", () => {
  P.addPose("x", [0, 0, 0, 0.1], 1000);
  const p = P.peers.get("x");
  assert.equal(P.peerPose(p, 1000 + P.SILENT_MS).alpha, 1);
  assert.ok(near(P.peerPose(p, 1000 + P.SILENT_MS + P.FADE_MS / 2).alpha, 0.5));
  assert.equal(P.peerPose(p, 1000 + P.SILENT_MS + P.FADE_MS + 1), null);
});

test("old poses are trimmed but at least two are kept", () => {
  for (let i = 0; i < 100; i++) P.addPose("x", [i, 0, 0, i / 1000], 1000 + i * 100);
  const buf = P.peers.get("x").buf;
  assert.ok(buf.length <= 12, "kept " + buf.length);
  assert.ok(buf.length >= 2);
});

test("clearPoses empties buffers but keeps who is here", () => {
  P.addPose("x", [0, 0, 0, 0.1], 1000);
  P.clearPoses();
  assert.equal(P.peers.get("x").buf.length, 0);
  assert.equal(P.peerPose(P.peers.get("x"), 1200), null);
});

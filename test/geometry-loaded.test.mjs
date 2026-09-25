// loadTrackGeometry announces every geometry load — daily track or run stage —
// so the music can follow the track without importing it.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.location = { search: "", hostname: "localhost" };
globalThis.document = { addEventListener() {}, hidden: false };

const root = new URL("../js/", import.meta.url);
const { on } = await import(new URL("core/events.js", root));
const { track, loadTrackGeometry } = await import(new URL("track/track.js", root));

test("loadTrackGeometry emits geometry-loaded with the seed and the new id", () => {
  const got = [];
  const off = on("geometry-loaded", p => got.push({ ...p, idAtEmit: track.id, seedAtEmit: track.seed }));
  loadTrackGeometry("2026-09-22");
  loadTrackGeometry("2026-09-22#run3", { minR: 185, corners: 5 });
  off();
  assert.equal(got.length, 2);
  assert.equal(got[0].seed, "2026-09-22");
  assert.equal(got[1].seed, "2026-09-22#run3");
  for (const g of got) {
    assert.equal(g.id, g.idAtEmit, "track.id is already set when the event fires");
    assert.equal(g.seed, g.seedAtEmit, "track.seed is already set when the event fires");
    assert.ok(typeof g.id === "string" && g.id.length > 0);
  }
  assert.notEqual(got[0].id, got[1].id);
});

import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const { orderPrims } = await import(new URL("render/cockpit.js", root));

// The road is a plane under an eye above it, so it can never hide anything
// standing on it: ground paints first (road, then markings on it), and only
// upright prims are sorted far to near. Sorting everything by distance let the
// road under a ghost's tail paint over the ghost.
test("ground prims paint first, road before markings, then upright far to near", () => {
  const prims = [
    { id: "ghost", k: 97, layer: 2 },
    { id: "road-under-tail", k: 80, layer: 0 },
    { id: "road-far", k: 400, layer: 0 },
    { id: "startline", k: 98, layer: 1 },
    { id: "rail-far", k: 399, layer: 2 },
    { id: "rail-near", k: 79, layer: 2 },
  ];
  assert.deepEqual(orderPrims(prims).map(p => p.id),
    ["road-under-tail", "road-far", "startline", "rail-far", "ghost", "rail-near"]);
});

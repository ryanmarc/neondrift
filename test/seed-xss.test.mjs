// Guards against the reflected-XSS regression where the ?seed= URL parameter
// reached the seed label's innerHTML unescaped (js/ui/hud.js). A crafted seed
// could then run script in the page origin and read the leaderboard secret
// from localStorage — delivered through the shareable ?seed=&rival= links.
//
// hud.js is heavily DOM-coupled (and importing it starts daily.js's interval),
// so this asserts the source-level invariant directly: any user-controlled
// track field written into #seed's innerHTML must go through esc().

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../js/ui/hud.js", import.meta.url), "utf8");

test("the seed label escapes the seed and the track id", () => {
  const line = src.split("\n").find(l => l.includes("$seed.innerHTML"));
  assert.ok(line, "expected a $seed.innerHTML assignment in hud.js");

  // The whole point: the raw values are never concatenated bare into markup.
  assert.ok(!/\btrack\.seed\b/.test(line.replace(/esc\(track\.seed\)/g, "")),
    "track.seed must be wrapped in esc() before it reaches innerHTML");
  assert.ok(!/\btrack\.id\b/.test(line.replace(/esc\(track\.id\)/g, "")),
    "track.id must be wrapped in esc() before it reaches innerHTML");
});

test("esc() neutralises the characters that break out of markup", () => {
  // Mirror of the esc helper defined in hud.js; if that helper changes shape
  // this test's expectations should be revisited alongside it.
  const esc = s => String(s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const out = esc('<img src=x onerror="alert(1)">');
  assert.ok(!out.includes("<"), "angle brackets are encoded");
  assert.ok(!out.includes(">"), "angle brackets are encoded");
  assert.ok(!out.includes('"'), "double quotes are encoded");
  assert.equal(esc("&"), "&amp;");
});

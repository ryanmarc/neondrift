// Guards the end-screen copy for a practice run (?weather override): commitRun
// never saves or posts one (see test/ghost.test.mjs, test/posting.test.mjs), so
// showResult() in js/ui/hud.js must not render "First run on this track. Your
// ghost is saved." or a PB badge for it — see task-3-report.md fix round 1.
//
// hud.js is heavily DOM-coupled (importing it wires up real elements and
// starts daily.js's interval) with no test harness for it yet, so — same
// pattern as test/seed-xss.test.mjs — this checks the source directly rather
// than executing showResult().

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../js/ui/hud.js", import.meta.url), "utf8");

function extractFn(name) {
  const start = src.indexOf("function " + name);
  assert.ok(start >= 0, "expected function " + name + " in hud.js");
  // skip past the parameter list (which may itself destructure with braces)
  // by balancing parens from the "(" right after the name, then brace-match
  // the body from the first "{" after that.
  let p = src.indexOf("(", start), depth = 0, j = p;
  for (; j < src.length; j++) {
    if (src[j] === "(") depth++;
    else if (src[j] === ")" && --depth === 0) break;
  }
  let i = src.indexOf("{", j);
  let d2 = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") d2++;
    else if (src[i] === "}" && --d2 === 0) break;
  }
  return src.slice(start, i + 1);
}

const body = extractFn("showResult");

test("showResult destructures practice from the race-finish payload", () => {
  assert.match(body, /function showResult\(\{[^}]*\bpractice\b[^}]*\}\)/);
});

test("a practice run's branch is checked first and doesn't claim a save or a PB", () => {
  const ifs = [...body.matchAll(/\b(if|else if)\s*\(([^)]*)\)/g)];
  assert.ok(ifs.length > 0, "expected an if/else chain in showResult");
  assert.equal(ifs[0][1], "if", "the practice check must be the first branch, ahead of rival/prevBest copy");
  assert.match(ifs[0][2], /\bpractice\b/, "the first condition must test practice");

  // find that branch's body (up to the next else/end) and check its copy
  const branchStart = body.indexOf(ifs[0][0]);
  const nextElse = body.indexOf("else", branchStart);
  const practiceBranch = body.slice(branchStart, nextElse >= 0 ? nextElse : undefined);
  assert.match(practiceBranch, /not saved/i);
  assert.match(practiceBranch, /not posted/i);
  assert.doesNotMatch(practiceBranch, /ghost is saved/i);
  assert.doesNotMatch(practiceBranch, /personal best/i);
});

test("the PB badge class is never applied on a practice run", () => {
  const pbClass = body.match(/\(isPB[^)]*\?\s*'\s*pb'\s*:\s*''\)/);
  assert.ok(pbClass, "expected the isPB ? ' pb' : '' class expression in showResult");
  assert.match(pbClass[0], /!practice/, "isPB alone isn't enough documentation that a practice run never gets the pb badge");
});

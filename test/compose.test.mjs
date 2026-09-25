// The composer is pure and seeded; its constraints hold across hundreds of seeds.
import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("../js/", import.meta.url);
const C = await import(new URL("audio/compose.js", root));
const { compose, MODES, BARS, BPM_MIN, BPM_MAX, ROOT_LO, ROOT_HI, HOME, TURN, triad } = C;

// 356 daily seeds plus 12 days × 12 run stages = 500.
const SEEDS = [];
{
  const d = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i < 356; i++) { SEEDS.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
}
for (let day = 1; day <= 12; day++) for (let n = 1; n <= 12; n++) SEEDS.push(`2026-09-${String(day).padStart(2, "0")}#run${n}`);

const pc = (m, ref) => ((m - ref) % 12 + 12) % 12;
const inScale = (m, key) => key.scale.includes(pc(m, key.tonicMidi));
const chordTone = (m, tones) => tones.some(t => pc(m, t) === 0);

test("seed count is 500", () => assert.equal(SEEDS.length, 500));

test("compose is deterministic and seeds differ", () => {
  assert.deepEqual(compose("2026-09-24"), compose("2026-09-24"));
  const twenty = SEEDS.slice(0, 20).map(s => JSON.stringify(compose(s).bars));
  assert.equal(new Set(twenty).size, 20);
  const modes = new Set(SEEDS.slice(0, 40).map(s => compose(s).key.mode));
  assert.ok(modes.size >= 3, "modes seen: " + [...modes]);
});

test("triads: minor-V raises the third of V, dorian borrows aeolian's VI, nothing is diminished", () => {
  assert.deepEqual(triad("aeolian", 4), [7, 10, 14]);
  assert.deepEqual(triad("minorV", 4), [7, 11, 14]);
  assert.deepEqual(triad("dorian", 3), [5, 9, 12]);      // dorian's major IV
  assert.deepEqual(triad("dorian", 5), [8, 12, 15]);     // bVI, not the diminished vi
  for (const mode of Object.keys(MODES)) for (const p of [...HOME, ...TURN]) for (const d of p) {
    const [r, t, f] = triad(mode, d);
    assert.notEqual(f - r, 6, `${mode} degree ${d} is diminished`);
  }
});

test("500 seeds: shape, tempo, register, harmony", () => {
  for (const seed of SEEDS) {
    const s = compose(seed);
    assert.equal(s.bars.length, BARS, seed);
    assert.ok(s.bpm >= BPM_MIN && s.bpm <= BPM_MAX, seed + " bpm " + s.bpm);
    assert.ok(Math.abs(s.step - 60 / s.bpm / 4) < 1e-12, seed);
    assert.ok(s.key.tonicMidi >= ROOT_LO && s.key.tonicMidi <= ROOT_HI, seed);
    assert.equal(pc(s.key.tonicMidi, 0), s.key.tonic, seed);
    s.bars.forEach((b, i) => {
      assert.ok(b.tones[0] >= ROOT_LO && b.tones[0] <= ROOT_HI, `${seed} bar ${i} root ${b.tones[0]}`);
      assert.ok(b.tones[1] > b.tones[0] && b.tones[2] > b.tones[1], `${seed} bar ${i} voicing`);
      assert.equal(b.fill, i === 7 || i === 11 || i === 15, `${seed} bar ${i} fill`);
      assert.equal(pc(b.tones[0], s.key.tonicMidi), triad(s.key.mode, b.degree)[0] % 12, `${seed} bar ${i} root matches degree`);
    });
    // phrases 1 and 2 share a progression; phrase 3 is a turn; phrase 4 is a different home not ending on the tonic
    const degs = s.bars.map(b => b.degree);
    assert.deepEqual(degs.slice(0, 4), degs.slice(4, 8), seed);
    assert.ok(TURN.some(p => p.join() === degs.slice(8, 12).join()), seed + " phrase 3");
    assert.notDeepEqual(degs.slice(12), degs.slice(0, 4), seed + " phrase 4 repeats phrase 1");
    assert.notEqual(degs[15], 0, seed + " ends on the tonic");
  }
});

test("voicing follows brightness and stays in the kit", () => {
  for (const seed of SEEDS.slice(0, 100)) {
    const s = compose(seed);
    assert.ok(["sawtooth", "square"].includes(s.voice.arp), seed);
    assert.ok(["square", "triangle"].includes(s.voice.lead), seed);
    assert.ok(s.voice.detune >= 5 && s.voice.detune <= 10, seed);
    assert.ok(s.voice.q >= 0.8 && s.voice.q <= 1.6, seed);
    assert.ok(s.swing >= 0 && s.swing <= 0.12, seed);
    for (const k of ["tempo", "density", "brightness", "dark"]) assert.ok(s.mood[k] >= 0 && s.mood[k] < 1, seed + " " + k);
    assert.ok([2, 4].includes(s.mood.leadPhrases[s.mood.leadPhrases.length - 1]) && s.mood.leadPhrases.includes(4), seed);
  }
});

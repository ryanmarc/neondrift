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

test("500 seeds: figures, bass, hats follow the mood", () => {
  const { FIGURES, BASS_PUSH } = C;
  assert.deepEqual(BASS_PUSH, [0, 3, 6, 8, 11, 14]);
  const shapes = Object.values(FIGURES).map(f => f.join());
  for (const seed of SEEDS) {
    const s = compose(seed), m = s.mood;
    s.bars.forEach((b, i) => {
      const p = Math.floor(i / 4);
      assert.equal(b.fig.length, 8, seed);
      assert.equal(b.fig.filter(x => x === -1).length <= 1, true, `${seed} bar ${i} more than one rest`);
      for (const x of b.fig) assert.ok(x === -1 || (x >= 0 && x <= 5), `${seed} bar ${i} slot ${x}`);
      assert.equal(b.arpEighths, m.density < 0.4 && (p === 0 || p === 2), `${seed} bar ${i} arpEighths`);
      assert.ok([0, 1, 2].includes(b.bass), seed);
      if (p === 0) assert.equal(b.bass, 0, `${seed} phrase 1 bass`);
      assert.equal(b.open, m.density > 0.7 && (p === 1 || p === 3), `${seed} bar ${i} open`);
    });
    // one figure per phrase; phrase 4 reuses phrase 2's
    for (let p = 0; p < 4; p++) for (let k = 1; k < 4; k++) assert.deepEqual(s.bars[p * 4 + k].fig, s.bars[p * 4].fig, seed);
    assert.deepEqual(s.bars[12].fig, s.bars[4].fig, seed);
    // a figure is a pool figure with at most one swap and one rest
    for (const p of [0, 4, 8]) {
      const f = s.bars[p].fig;
      const diff = shapes.map(sh => sh.split(",").map(Number)).map(base => f.filter((x, j) => x !== base[j]).length);
      assert.ok(Math.min(...diff) <= 3, `${seed} bar ${p} figure ${f} is not from the pool`);
    }
    // phrases 2 and 4 share the song's bass style; phrase 3 takes it only when dense
    assert.equal(s.bars[4].bass, s.bars[12].bass, seed);
    assert.equal(s.bars[8].bass, m.density > 0.65 ? s.bars[4].bass : 0, seed);
    assert.ok(["eighths", "sixteenths"].includes(s.drums.hats), seed);
    assert.equal(s.drums.hats === "eighths", m.density < 0.35, seed);
  }
});

test("rhythm pool: eight templates, exactly two close with a silent last beat", () => {
  const { RHYTHMS } = C;
  assert.equal(RHYTHMS.length, 8);
  for (const r of RHYTHMS) { assert.equal(r.length, 16); assert.ok(r.includes(1)); }
  assert.equal(RHYTHMS.filter(r => !r.slice(12).includes(1)).length, 2);
});

test("500 seeds: the lead", () => {
  const { LEAD_LO, LEAD_HI } = C;
  let withPhrase2 = 0;
  for (const seed of SEEDS) {
    const s = compose(seed), key = s.key;
    const tonicOrFifth = m => [0, 7].includes(pc(m, key.tonicMidi));
    s.bars.forEach((b, i) => {
      const p = Math.floor(i / 4);
      const expect = p === 3 || (p === 1 && s.mood.leadPhrases.includes(2));
      assert.equal(!!b.lead, expect, `${seed} bar ${i} lead presence`);
      if (!b.lead) return;
      assert.equal(b.lead.length, 16, seed);
      assert.ok(b.lead.some(n => n > 0), `${seed} bar ${i} lead is all rests`);
      for (const n of b.lead) {
        if (!n) continue;
        assert.ok(n >= LEAD_LO && n <= LEAD_HI, `${seed} bar ${i} pitch ${n} out of range`);
        assert.ok(inScale(n, key) || chordTone(n, b.tones), `${seed} bar ${i} pitch ${n} outside scale and chord`);
      }
    });
    if (s.mood.leadPhrases.includes(2)) withPhrase2++;
    for (const p of [1, 3]) {
      if (!s.bars[p * 4].lead) continue;
      const notes = [];
      for (let k = 0; k < 4; k++) s.bars[p * 4 + k].lead.forEach(n => { if (n) notes.push({ n, tones: s.bars[p * 4 + k].tones }); });
      assert.ok(chordTone(notes[0].n, notes[0].tones), `${seed} phrase ${p + 1} opens off the chord`);
      assert.ok(tonicOrFifth(notes[notes.length - 1].n), `${seed} phrase ${p + 1} ends on ${notes[notes.length - 1].n}`);
      for (let j = 2; j < notes.length; j++) assert.ok(!(notes[j].n === notes[j - 1].n && notes[j].n === notes[j - 2].n), `${seed} phrase ${p + 1} repeats a pitch three times`);
      assert.ok(!s.bars[p * 4 + 3].lead.slice(12).some(n => n > 0), `${seed} phrase ${p + 1} last beat is not silent`);
    }
  }
  assert.ok(withPhrase2 > 100 && withPhrase2 < 300, "phrase-2 leads: " + withPhrase2);
});

test("advance is gone: a track change never waits for a bar line", () => {
  assert.equal(C.advance, undefined);
});

test("500 seeds: lead notes on beats 1 and 3 are chord tones", () => {
  for (const seed of SEEDS) {
    const s = compose(seed);
    for (const p of [1, 3]) {
      if (!s.bars[p * 4].lead) continue;
      let last = null;
      for (let k = 0; k < 4; k++) s.bars[p * 4 + k].lead.forEach((n, slot) => { if (n) last = [k, slot]; });
      for (let k = 0; k < 4; k++) for (const slot of [0, 8]) {
        const n = s.bars[p * 4 + k].lead[slot];
        if (!n || (last[0] === k && last[1] === slot)) continue;
        assert.ok(chordTone(n, s.bars[p * 4 + k].tones), `${seed} phrase ${p + 1} bar ${k} beat ${slot / 4 + 1} pitch ${n} is off the chord`);
      }
    }
  }
});

test("resume takes a pending song at once, from its bar 1", () => {
  const { resume } = C;
  const a = compose("a"), b = compose("b"), a2 = compose("a");
  assert.deepEqual(resume({ song: a, step: 37 }, b), { song: b, step: 0 });
  assert.deepEqual(resume({ song: a, step: 37 }, null), { song: a, step: 37 });
  assert.deepEqual(resume({ song: a, step: 37 }, a2), { song: a, step: 37 }, "same seed keeps its place");
  assert.deepEqual(resume({ song: null, step: 0 }, b), { song: b, step: 0 });
  for (const step of [1, 7, 15, 16, 200]) assert.deepEqual(resume({ song: a, step }, b), { song: b, step: 0 }, "mid-bar step " + step);
  assert.notEqual(a2, a, "compose returns a fresh object each time");
});

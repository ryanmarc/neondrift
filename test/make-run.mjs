// Produces a genuine run for the current daily track (or the seed given as
// the first argument) in the exact shape the client posts to /runs, and writes
// it to the path given as the second argument (default /tmp/run.json).
// Usage: node test/make-run.mjs [seed] [out.json] [name]
globalThis.window = globalThis; globalThis.location = { search: "" };
const L = {}; globalThis.addEventListener = (n, f) => (L[n] ||= []).push(f);
const el = () => ({ addEventListener() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } });
globalThis.document = { getElementById: el, addEventListener() {} };
import { writeFileSync } from "node:fs";
const root = new URL("../js/", import.meta.url);
const { track, loadTrackGeometry } = await import(new URL("track/track.js", root));
const { todayUtc } = await import(new URL("config/params.js", root));
const { car, race, resetRace } = await import(new URL("game/state.js", root));
const { step } = await import(new URL("game/physics.js", root));
const { PHYSICS_DT, LAPS } = await import(new URL("config/tuning.js", root));
const { bootstrap } = await import(new URL("sim/simulate.js", root));
const { createInput } = await import(new URL("sim/schedule.js", root));
const seed = process.argv[2] || todayUtc(), out = process.argv[3] || "/tmp/run.json", name = process.argv[4] || "Tester";
loadTrackGeometry(seed);
const input = createInput(bootstrap({ hold: 18, horizon: 120, edge: 6, speed: 120 }).schedule);
resetRace(track.samples[0]);
let held = 0; const key = (t, k) => (L[t] || []).forEach(f => f({ key: k }));
while (car.lap <= LAPS && race.steps < 9000) {
  const w = input(car.lap - 1 + car.prog);
  if (w !== held) { key("keyup", "ArrowLeft"); key("keyup", "ArrowRight"); if (w === -1) key("keydown", "ArrowLeft"); if (w === 1) key("keydown", "ArrowRight"); held = w; }
  step(PHYSICS_DT);
}
const body = { secret: "0123456789abcdef0123456789abcdef", name, seed, trackId: track.id, inputs: race.inputs, ghost: race.rec, time: race.time };
writeFileSync(out, JSON.stringify(body));
console.log(JSON.stringify({ seed, trackId: track.id, time: +race.time.toFixed(3), finished: car.lap > LAPS, inputs: race.inputs.length, ghost: race.rec.length, out }));

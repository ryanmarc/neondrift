// Manual check of the live room against `npm run dev` in worker/ (wrangler
// dev runs Durable Objects locally). Two clients join, one sends poses and a
// genuine one-lap attempt; prints what each receives.
// Usage: node test/live-smoke.mjs [http://localhost:8787]
globalThis.window = globalThis; globalThis.location = { search: "" };
const L = {}; globalThis.addEventListener = (n, f) => (L[n] ||= []).push(f);
const el = () => ({ addEventListener() {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } });
globalThis.document = { getElementById: el, addEventListener() {} };
const root = new URL("../js/", import.meta.url);
const { track, loadTrackGeometry } = await import(new URL("track/track.js", root));
const { car, race, resetRace } = await import(new URL("game/state.js", root));
const { step } = await import(new URL("game/physics.js", root));
const { PHYSICS_DT } = await import(new URL("config/tuning.js", root));
const { bootstrap } = await import(new URL("sim/simulate.js", root));
const { createInput } = await import(new URL("sim/schedule.js", root));
const { roundAt, seedFor } = await import(new URL("live/clock.js", root));

const api = process.argv[2] || "http://localhost:8787";
const origin = "http://localhost:8000";
const round = roundAt(Date.now());
loadTrackGeometry(seedFor(round));
const input = createInput(bootstrap({ hold: 18, horizon: 120, edge: 6, speed: 120, laps: 1 }).schedule);
resetRace(track.samples[0]);
let held = 0; const key = (t, k) => (L[t] || []).forEach(f => f({ key: k }));
while (car.lap <= 1 && race.steps < 120 * 60) {
  const w = input(car.prog);
  if (w !== held) { key("keyup", "ArrowLeft"); key("keyup", "ArrowRight"); if (w === -1) key("keydown", "ArrowLeft"); if (w === 1) key("keydown", "ArrowRight"); held = w; }
  step(PHYSICS_DT);
}
console.log("recorded", seedFor(round), race.time.toFixed(3));

async function client(label, secret) {
  const { room } = await (await fetch(api + "/live/join", { headers: { origin } })).json();
  const ws = new WebSocket(api.replace(/^http/, "ws") + "/live/room/" + room, { headers: { origin } });
  ws.onmessage = e => console.log(label, "←", e.data.slice(0, 160));
  ws.onclose = e => console.log(label, "closed", e.code, e.reason);
  await new Promise(r => { ws.onopen = r; });
  ws.send(JSON.stringify({ t: "hello", secret, name: label }));
  return ws;
}
const a = await client("Alpha", "a".repeat(32));
const b = await client("Bravo", "b".repeat(32));
await new Promise(r => setTimeout(r, 300));
a.send(JSON.stringify({ t: "pose", p: [1, 2, 0.1, 0.05] }));
a.send(JSON.stringify({ t: "attempt", round, inputs: race.inputs, time: race.time }));
await new Promise(r => setTimeout(r, 1500));
const a2 = await client("Alpha-2", "a".repeat(32));   // same player, second tab: Alpha should close with 4000
await new Promise(r => setTimeout(r, 800));
a2.close(); b.close();

// Measures the rain bed's level against the engine's steady-cruise level,
// both through a phone-speaker-ish weighting filter, using OfflineAudioContext.
//
// NOT a node --test file: OfflineAudioContext only exists in a browser, so
// this can't run under `node --test`. Serve the repo (`python3 serve.py`)
// and, from the page's console (or any page on that origin), run:
//
//   const m = await import("/test/measure-rain-level.mjs");
//   await m.measure();
//
// It builds two throwaway OfflineAudioContexts — one with just the rain bed
// (createRainBed, setWet(true), rendered after its 0.6s ramp settles) and one
// with just the engine driven at a steady cruise (constant speed, no boost,
// no slide, so load settles at ENGINE.cruise) — each through the same
// weighting chain, and reports RMS in dB and the BED that would put the bed
// ~8dB under the engine. It touches no live audio graph, storage or DOM.

import { createRainBed } from "../js/audio/rain.js";
import { createEngine } from "../js/audio/engine.js";
import { T } from "../js/config/tuning.js";

const SR = 44100, DUR = 3, TAIL = 2;   // render 3s, measure the settled last 1s

function whiteNoiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// Stand-in for A-weighting through a phone speaker's rolloff: a highpass
// under the model's own ~140Hz floor plus a bit more (400Hz, 2nd order via
// two cascaded biquads) then a gentle top-end lowpass, per CLAUDE.md's own
// "A-weighted through a 400Hz phone-speaker rolloff" method.
function weightingChain(ctx, dest) {
  const hp1 = ctx.createBiquadFilter(); hp1.type = "highpass"; hp1.frequency.value = 400; hp1.Q.value = 0.707;
  const hp2 = ctx.createBiquadFilter(); hp2.type = "highpass"; hp2.frequency.value = 500; hp2.Q.value = 0.707;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 6000; lp.Q.value = 0.707;
  hp1.connect(hp2); hp2.connect(lp); lp.connect(dest);
  return hp1;   // feed the source into this
}

function rms(float32) {
  let s = 0;
  for (let i = 0; i < float32.length; i++) s += float32[i] * float32[i];
  return Math.sqrt(s / float32.length);
}

// Lets code that schedules nodes via `ctx.currentTime` (engine.js's update())
// be driven on a virtual clock we advance ourselves, so a whole simulated
// run can be scheduled before rendering starts.
function timeControlled(ctx) {
  let t = 0;
  const proxy = new Proxy(ctx, {
    get(target, prop) {
      if (prop === "currentTime") return t;
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { proxy, set: (v) => { t = v; } };
}

async function renderRainBed() {
  const ctx = new OfflineAudioContext(1, SR * DUR, SR);
  const input = weightingChain(ctx, ctx.destination);
  const noiseBuf = whiteNoiseBuffer(ctx, 2);
  const rain = createRainBed(ctx, input, noiseBuf);
  rain.setWet(true);
  const rendered = await ctx.startRendering();
  return rms(rendered.getChannelData(0).subarray(SR * TAIL));
}

async function renderEngineCruise() {
  const ctx = new OfflineAudioContext(1, SR * DUR, SR);
  const input = weightingChain(ctx, ctx.destination);
  const { proxy, set } = timeControlled(ctx);
  const engine = createEngine(proxy, input);
  const dt = 1 / 60;
  const CRUISE_SPEED = 500;   // steady, ~72% of T.maxSpeed(690): a straight, not flat out
  for (let t = 0; t < DUR; t += dt) {
    set(t);
    engine.update({ speed: CRUISE_SPEED, boosting: false, drift: 0 }, true, T, dt);
  }
  const rendered = await ctx.startRendering();
  return rms(rendered.getChannelData(0).subarray(SR * TAIL));
}

// `currentBED` must match whatever `BED` is currently set to in rain.js — the
// render reflects that live value, and the suggestion scales from it, so a
// stale guess here just makes the suggestion wrong, not the measurement.
export async function measure(currentBED = 0.015) {
  const [rainRms, engineRms] = await Promise.all([renderRainBed(), renderEngineCruise()]);
  const rainDb = 20 * Math.log10(rainRms || 1e-12);
  const engineDb = 20 * Math.log10(engineRms || 1e-12);
  const gap = engineDb - rainDb;             // positive: engine louder
  const desiredRainDb = engineDb - 8;        // target: bed 8dB under the engine
  const suggestedBED = currentBED * Math.pow(10, (desiredRainDb - rainDb) / 20);
  const result = { rainRms, engineRms, rainDb, engineDb, gap, suggestedBED };
  console.log("rain level measurement", result);
  return result;
}

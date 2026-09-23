// The engine: a small model (gear, revs, load) driving a pulse-train synth.
// Persistent nodes nudged with setTargetAtTime, never rebuilt. The model is a
// pure function of its state, the car and dt so Node can test it; the node
// graph is built once onto whatever bus it is given (sfx.js hands it the
// effects bus, so the effects mute switch covers it).
//
// Three cues make it read as an engine rather than a synth pad, and each was
// added because the pad version was "a constant high whine":
//   gears  – revs climb through four speed bands and fall at every shift, with
//            a brief throttle lift, so the pitch contour keeps moving even at a
//            steady speed. Thrust is always on in this game, so the gears are
//            fiction; they are the most engine-defining cue there is.
//   load   – loud and bright while working (boost, pulling away), a low burble
//            at cruise, near-silent on overrun. A slide is a lift-off, so the
//            engine recedes exactly when you're concentrating on the drift,
//            and pops once as it starts.
//   pulses – the tone is a narrow pulse train at the firing rate (a four-
//            cylinder fires at rpm/30 Hz) with noise gated by the same pulses:
//            a "brrr", not an "eeee". The firing fundamental sits under the
//            ~140Hz phone-speaker floor, so a 110Hz highpass drops it and the
//            harmonics carry the roughness — the missing-fundamental effect,
//            which is also how a real engine sounds through a phone.

import { clamp } from "../core/math.js";
import { T } from "../config/tuning.js";

export const ENGINE = {
  gears: [0.22, 0.44, 0.75, 1.42], // each gear's redline speed as a fraction of maxSpeed; top gear never redlines
  downAt: 0.85,      // downshift when speed drops under this fraction of the lower gear's redline (hysteresis)
  idle: 0.15,        // revs (0..1 of redline) at a standstill
  rpmLag: 0.05,      // s for revs to follow speed — a shift is a quick fall, not a jump
  liftTime: 0.12,    // s of closed throttle on each upshift
  liftLag: 0.03,     // s for the throttle to close on a lift: abrupt, like a foot coming off
  fireIdle: 28, fireRed: 190,   // firing pulses per second at idle / redline
  loadRise: 0.12, loadFall: 0.25,   // s for load to open / close
  cruise: 0.35,      // load at a steady speed with no boost
  overrun: 0.05,     // load while sliding
  throttleAccel: 0.25,          // acceleration (as a fraction of P.accel) that counts as full throttle
  cutoffLow: 320, cutoffHigh: 1200, // lowpass at closed / open throttle (× revs)
  gainFloor: 0.35,   // fraction of peak level at closed throttle
  popRpm: 0.5,       // a slide starting above these revs pops
  gain: 0.075,       // peak level. Measured, not eyeballed: A-weighted through a
                     // 400Hz phone-speaker rolloff, full load at the redline sits
                     // ~4dB under the full squeal and level with the boost whoosh.
                     // 0.034 (11dB under) was inaudible under boost plus music
  duty: 0.15,        // pulse width as a fraction of the firing period
  detune: 7,         // cents between the two pulse oscillators — a slow beat
  noiseMix: 2.5,     // gated-noise level; the exhaust bandpass passes little, so this is ~12dB under the tone
};

/** Fresh model state: first gear, idling, throttle at cruise. */
export function createModel() {
  return { gear: 1, rpm: ENGINE.idle, load: ENGINE.cruise, lift: 0, prevSpeed: 0, sliding: false };
}

const follow = (v, target, dt, tau) => v + (target - v) * (1 - Math.exp(-dt / tau));

/**
 * Advance the model by dt with the car's { speed, boosting, drift }; returns
 * { fireHz, cutoff, gain, noise, load, pop }. `P` is the live physics table.
 */
export function stepEngine(m, input, dt, P = T) {
  const speed = Math.max(0, input.speed);
  const redline = g => ENGINE.gears[g - 1] * P.maxSpeed;

  // gears: up at the redline, down only well below the lower gear's redline
  while (m.gear < ENGINE.gears.length && speed >= redline(m.gear)) { m.gear++; m.lift = ENGINE.liftTime; }
  while (m.gear > 1 && speed < redline(m.gear - 1) * ENGINE.downAt) m.gear--;
  m.rpm = follow(m.rpm, Math.max(ENGINE.idle, speed / redline(m.gear)), dt, ENGINE.rpmLag);

  // load: what the engine is being asked for
  const accel = (speed - m.prevSpeed) / dt; m.prevSpeed = speed;
  const throttle = clamp(accel / (ENGINE.throttleAccel * P.accel), 0, 1);
  const sliding = input.drift > P.driftMin;
  let want = input.boosting ? 1 : sliding ? ENGINE.overrun : Math.max(ENGINE.cruise, throttle);
  let tau = want > m.load ? ENGINE.loadRise : ENGINE.loadFall;
  if (m.lift > 0) { want = 0; tau = ENGINE.liftLag; m.lift -= dt; }
  m.load = follow(m.load, want, dt, tau);

  const pop = sliding && !m.sliding && m.rpm > ENGINE.popRpm;
  m.sliding = sliding;

  const r = clamp((m.rpm - ENGINE.idle) / (1 - ENGINE.idle), 0, 1);
  const body = 0.6 + 0.4 * m.rpm;   // revs brighten and lift it a little on their own
  return {
    fireHz: ENGINE.fireIdle + (ENGINE.fireRed - ENGINE.fireIdle) * r,
    cutoff: ENGINE.cutoffLow + (ENGINE.cutoffHigh - ENGINE.cutoffLow) * m.load * body,
    gain: ENGINE.gain * (ENGINE.gainFloor + (1 - ENGINE.gainFloor) * m.load) * (0.7 + 0.3 * m.rpm),
    noise: ENGINE.noiseMix * (0.3 + 0.7 * m.load),
    load: m.load,
    pop,
  };
}

/** A narrow pulse: cosine series of a rectangular pulse of width `duty`. */
function pulseWave(ctx, duty, n = 48) {
  const real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return ctx.createPeriodicWave(real, imag);   // normalised: the peak is 1, the floor about -duty/(1-duty)
}

/** Build the nodes onto `bus`; returns { update }. Call once per context. */
export function createEngine(ctx, bus) {
  const m = createModel();
  const wave = pulseWave(ctx, ENGINE.duty);

  const out = ctx.createGain(); out.gain.value = 0; out.connect(bus);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = ENGINE.cutoffLow; lp.Q.value = 0.7;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 110; hp.Q.value = 0.7;
  hp.connect(lp); lp.connect(out);

  // the tone: two pulse trains a few cents apart
  const oscs = [-0.5, 0.5].map(d => {
    const o = ctx.createOscillator(); o.setPeriodicWave(wave);
    o.frequency.value = ENGINE.fireIdle; o.detune.value = d * ENGINE.detune;
    const g = ctx.createGain(); g.gain.value = 0.5;
    o.connect(g); g.connect(hp); o.start();
    return o;
  });

  // the rasp: noise gated by the same pulses (gain floor lifts the pulse's
  // negative half to zero, so the gate is shut between firings), through an
  // exhaust resonance
  const len = Math.floor(ctx.sampleRate * 1);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
  const gate = ctx.createGain(); gate.gain.value = ENGINE.duty / (1 - ENGINE.duty);
  oscs[0].connect(gate.gain);
  const exhaust = ctx.createBiquadFilter(); exhaust.type = "bandpass"; exhaust.frequency.value = 260; exhaust.Q.value = 0.8;
  const noiseG = ctx.createGain(); noiseG.gain.value = 0;
  noise.connect(gate); gate.connect(exhaust); exhaust.connect(noiseG); noiseG.connect(hp);
  noise.start();

  function pop() {                          // the lift-off pop as a slide starts: one burst out of the exhaust
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 220; f.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t); s.stop(t + 0.08);
  }

  return {
    /** Per frame. `running` false fades it out (title screen, after the finish). */
    update(input, running, P, dt) {
      const t = ctx.currentTime;
      const o = stepEngine(m, input, Math.max(dt, 1e-3), P);
      for (const osc of oscs) osc.frequency.setTargetAtTime(o.fireHz, t, 0.02);
      lp.frequency.setTargetAtTime(o.cutoff, t, 0.02);
      noiseG.gain.setTargetAtTime(o.noise, t, 0.02);
      out.gain.setTargetAtTime(running ? o.gain : 0, t, running ? 0.02 : 0.12);
      if (o.pop && running) pop();
    },
  };
}

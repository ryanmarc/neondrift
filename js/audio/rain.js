// Rain, synthesized: the effects' shared noise buffer through filters, no
// files. The bed is a band of hiss around 3–5kHz with a slow wander (two
// detuned slow LFOs on its centre, so it never sits still — static filtered
// noise reads as a fan) over a quieter low patter above the ~140Hz phone
// floor. Built once; setWet() only ramps gains, never builds nodes.

/**
 * Skid voicing for a slide amount 0..1. Dry is the tuned squeal (Q 12, gain
 * 0.377 at full slide). A wet tire hisses more than it rings: lower Q, a
 * quieter squeal, and a hiss layer under it.
 */
export function wetSkid(slide, wet) {
  if (!wet) return { q: 12, squeal: slide * 0.377, hiss: 0 };
  return { q: 5, squeal: slide * 0.22, hiss: slide * 0.09 };
}

export function createRainBed(ctx, bus, noiseBuf) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  src.playbackRate.value = 0.93;   // decorrelated from the effects' own noise source

  const hissF = ctx.createBiquadFilter(); hissF.type = "bandpass"; hissF.frequency.value = 4000; hissF.Q.value = 0.8;
  const patterF = ctx.createBiquadFilter(); patterF.type = "bandpass"; patterF.frequency.value = 420; patterF.Q.value = 1.2;
  const hissG = ctx.createGain(), patterG = ctx.createGain(), bed = ctx.createGain();
  hissG.gain.value = 1; patterG.gain.value = 0.5; bed.gain.value = 0;
  src.connect(hissF); hissF.connect(hissG); hissG.connect(bed);
  src.connect(patterF); patterF.connect(patterG); patterG.connect(bed);
  bed.connect(bus);

  for (const [f, depth] of [[0.13, 600], [0.37, 350]]) {   // the wander
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f; g.gain.value = depth;
    o.connect(g); g.connect(hissF.frequency); o.start();
  }

  // the wet skid's hiss: its own band, driven per frame by sfx.update()
  const skidF = ctx.createBiquadFilter(); skidF.type = "highpass"; skidF.frequency.value = 2400;
  const skidG = ctx.createGain(); skidG.gain.value = 0;
  src.connect(skidF); skidF.connect(skidG); skidG.connect(bus);

  src.start();
  const BED = 0.015;   // A-weighted through the phone rolloff, ~8dB under the engine's cruise level — see Step 6
  return {
    setWet(wet) { bed.gain.setTargetAtTime(wet ? BED : 0, ctx.currentTime, 0.6); },
    hiss(gain) { skidG.gain.setTargetAtTime(gain, ctx.currentTime, 0.05); },
  };
}

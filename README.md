# Neon Drift

A one-button drift racer for the browser. Hold to turn. Hold longer and the
back steps out. Sliding costs speed but fills the boost meter, and the moment
you let go the car straightens up and spends whatever boost you earned.

Three laps against your own ghost on a track that changes every day. No build
step, no dependencies, no downloaded assets: every sound, including the music,
is synthesized at runtime, and every pixel is drawn on a canvas.

## Play it

Serve the folder with any static file server and open `index.html`:

```
python3 -m http.server 8000
```

Then go to http://localhost:8000/index.html. Serve it rather than opening the
file from disk, because module scripts and `localStorage` both misbehave under
`file://`. After editing a module, hard-reload (Cmd+Shift+R): the Python server
sends no cache headers and Chrome will happily run a stale module otherwise.

**Controls**

| Input | Does |
|---|---|
| Left / right arrow, `A` / `D` | Turn (hold to break traction and drift) |
| Either half of the screen | Same, for touch |
| `R` | Restart |

Boost has no button. It fires by itself whenever you stop steering with charge
in the meter. Drifting cleanly builds a chain multiplier up to ×4 that speeds
up how fast the meter fills; touching the edge of the road resets it.

**URL parameters**

| Parameter | Effect |
|---|---|
| `?seed=2026-12-25` | Play that day's track (dates are UTC). Any string works as a seed. |
| `?seed=random` | A fresh track every load. |

## Features

- **A new track every day.** Tracks are generated from the UTC date, so everyone
  gets the same layout on the same day, and the title screen says how long
  until it changes. If you leave the page open past midnight UTC, the new
  track loads itself between races.
- **Ghost.** Your best run on each track is recorded and replays as a ghost,
  with a live delta that compares you at the same point on the track rather
  than the same moment in time.
- **Leaderboard.** Top times per track, verified: the game records when you
  pressed and released, and the server replays that through the same physics
  before it believes the time. Your identity is a secret in your browser;
  "Play on another device" moves it with a six-letter code.
- **Race the leaders.** Tap a time on the board to race that player's ghost
  instead of your own, with the live delta against them.
- **Adaptive music.** A synthesized synthwave loop that plays quietly on the
  menu, opens up when the race starts, and lifts while you boost. Effects and
  music have separate toggles.
- **Phones first.** Safe-area aware, touch controls, and a camera that shows
  more of the world on bigger screens instead of just magnifying it.

## Game mechanics

- **One input.** Hold either screen half, or an arrow key, to turn.
- **Holding breaks traction.** `chargeUp` seconds of holding drops the lateral
  grip ceiling from `gripMax` to `gripSlide` and the back steps out. Releasing
  restores the ceiling over `chargeDown`, but the sideways momentum already in
  the car still has to bleed off. That is what makes a slide persist.
- **Sliding trades speed for boost.** Top speed scales down with slip angle
  (`slipCost`); drifting fills the boost meter.
- **Boost has no separate button.** It fires whenever you stop steering and
  have any charge. There is deliberately no activation threshold: a minimum
  charge gate was tried and removed because it let sub-threshold charge bank
  up, which rewarded tap-spamming.
- **Chain multiplier.** Drifting cleanly builds a multiplier to ×4 that
  multiplies the boost fill rate. Touching the track edge resets it to ×1.
  Breaks above ×1.4 show a "LOST" readout and play a cue; below that they are
  silent on purpose, so minor scrapes aren't noisy.
- **Off-track** costs drag and top speed and kills the multiplier, but never
  resets your position. Punish flow, not progress.
- **Three laps**, about 35 to 55 seconds. A 1.8 second countdown during which
  physics, the clock and ghost playback are all frozen, so it costs no lap time.
- **Ghost** recordings are `[x, y, angle, progress]` at 30Hz. Progress is stored
  so the live delta can compare times at the same point on track.

## Project layout

```
index.html, style.css     markup and styles
js/main.js                entry point
js/core/     math.js      clamp, lerp, TAU, wrapAngle
             random.js    mulberry32 PRNG, string hash
             events.js    on(name, fn) / emit(name, payload)
             storage.js   localStorage that never throws
js/config/   params.js    URL params, today's date, initial seed
             tuning.js    every tuning constant
js/track/    generator.js sine-harmonic track generator (pure)
             track.js     the current track: samples, geometry id, nearest()
js/game/     daily.js     UTC daily seed, time to rollover, and the rollover itself
             dynamics.js  the pure car model: integrate(car, input, dt)
             physics.js   the live car's step: dynamics plus marks, plume, recording, events
             state.js     car and race state
             ghost.js     best run per track
             race.js      loadTrack, start, tick(now), run
js/input/    input.js     pointer halves and arrow keys folded into steer()
js/render/   camera.js    chase camera
             renderer.js  canvas drawing
js/audio/    context.js   the one AudioContext, unlock, hidden-tab suspend
             sfx.js       synthesized effects
             music.js     synthesized music and its race-aware mix
js/net/      identity.js  the player's secret and name
             api.js       fetch wrappers for the leaderboard API
             leaderboard.js board state, submitting personal bests, pairing
js/ui/       hud.js       readouts, control hint, end screen
             controls.js  buttons and shortcuts
             board.js     the leaderboard panel
worker/                   the leaderboard API: a Cloudflare Worker with D1 that
                          verifies runs by replaying them through js/game/dynamics.js
test/                     Node tests (node --test "test/*.test.mjs")
```

## Architecture

Plain ES modules, no bundler. Dependencies point one way, `ui` → `game` →
`track`/`render`/`audio` → `config`/`core`, and the game layer never imports
the DOM or audio code: it emits events on a tiny bus and the HUD and sound
modules subscribe. That keeps the module graph free of cycles.

Shared mutable state lives in a handful of exported objects (`car`, `race`,
`track`, `ghost`, `camera`) that are mutated in place. Module bindings are
read-only across files, so nothing exports a bare `let` expecting another
module to assign it.

`dynamics.js` is the only physics. It has no DOM, no randomness and no
module-level game state, which is what lets the same code drive the player's
car and a Node harness. Cosmetics such as tire marks, the exhaust plume and
the ghost recording live in `physics.js`.

`tick(now)` is the whole frame and is exported, so a run can be driven with
synthetic timestamps from a console or a test.

**Events emitted by the game layer**

| Event | When |
|---|---|
| `boost` | boost ignited |
| `chain-break` | chain multiplier lost above the ×1.4 threshold |
| `off-track` | car crossed the edge (payload: speed fraction) |
| `countdown` | 3, 2, 1, then 0 for GO |
| `race-start`, `race-finish` | run began / ended (finish carries time, previous best, PB flag) |
| `track-loaded` | a new track is in place |
| `board-updated` | leaderboard state changed |
| `input-mode` | the player used pointer or keys |

### Invariants

- **Physics is fixed 120Hz; rendering interpolates.** The car keeps its
  previous pose and the renderer lerps by the accumulator fraction. Without
  this the car visibly stutters on any display that isn't a multiple of 120Hz.
- **Ghosts are keyed to track geometry, not the date.** The track id is a hash
  of the sampled centreline. Change the generator and every seed produces a
  new id, so a stale ghost can never appear on the wrong track.
- **Camera smoothing is framerate independent.** Every lag is
  `1 - exp(-dt / tau)`, never a fixed per-frame lerp constant.
- **Audio never creates nodes per frame.** Continuous sounds are persistent
  nodes updated via `setTargetAtTime`. Per-frame node creation crackles.
- **Audio unlocks inside a real tap handler.** iOS refuses to start an
  `AudioContext` otherwise, and deferring it even one frame fails. Title-screen
  music is best-effort: the context is created at boot and resumed on the first
  click, tap or key anywhere. Browsers refuse to start audio before any
  interaction, so a first-time visitor's title screen is silent until they
  touch something.
- **Effects and music are separate switches** on separate buses under one
  master, each with a button in the HUD and on the overlay.
- **Feed the audio silence when not racing.** The physics stops at the finish,
  so the car's drift and velocity freeze at their last values. Passing those
  to the effects would leave the skid playing forever.
- **Respect the safe-area insets.** The root element carries the
  `env(safe-area-inset-*)` padding and the viewport uses `viewport-fit=cover`.
- **Capture the previous best before overwriting it.** The end screen's delta
  needs the old value.

## Tuning constants

All in `js/config/tuning.js`.

### `T` — car physics

| Knob | Does what |
|---|---|
| `gripMax` / `gripSlide` | Lateral grip ceiling with traction / once it breaks. Lower `gripSlide` = looser back end. |
| `stiffness` | How fast small slip angles are corrected while the tires still bite. |
| `chargeUp` / `chargeDown` | Seconds for traction to break while holding / for the ceiling to return after release. |
| `align` | Self-aligning torque gain. Sets the settled drift angle (about 50°). |
| `alignFall` / `alignFloor` | Where the aligning force peaks and how much survives at big slip. The falloff is what lets a drift hold. |
| `zeta` | Yaw damping ratio. Only affects how the car settles, not the drift angle. Lower = more overshoot. |
| `turn` | Steering rate (rad/s). |
| `slipCost` | How much top speed a sideways car loses. |
| `slipLagIn` / `slipLagOut` | Seconds to bleed speed off entering a slide / regain it on exit. Asymmetric on purpose. |
| `scrub` | Extra forward drag proportional to sideways velocity. |
| `driftMin` | Slip angle below which you aren't considered drifting. |
| `accel` / `maxSpeed` | Base thrust and top speed. |
| `boostAccel` / `boostSpeed` | Thrust and top speed while boosting. |
| `boostFill` / `boostDrain` / `boostCap` | Boost economy. |
| `offDrag` | Drag while off-track. |
| `zoomRange` / `zoomLag` | How far the view pulls back at speed, and seconds to follow a speed change. |

### `CAM` — camera feel

| Knob | Does what |
|---|---|
| `face` | 0 = follow direction of travel, 1 = follow the nose. Low values stop drifts whipping the view. |
| `freq` / `zeta` | Chase spring stiffness and damping. |
| `leadLag` | Smooths the look-ahead vector. Without it the camera stalls on every steering tap. |
| `followLag` | Seconds for the camera position to catch up to its target. |
| `spanFixed` / `spanChase` | World pixels across the short viewport edge, per camera mode. |
| `leadFixed` / `leadChase` | Look-ahead distance in seconds of velocity, per camera mode. |

The world span scales with viewport size (clamped to 1.85×), so a desktop sees
about 3.4× the track area a phone does.

## Audio

Everything is synthesized with Web Audio: oscillators, a generated noise
buffer and biquad filters. There are no sound files.

- **Levels were solved, not eyeballed.** Effect gains are balanced by
  A-weighted loudness through a phone-speaker rolloff. Raw gain numbers are
  misleading: a Q=12 bandpass passes about 75Hz of bandwidth, so `0.4` of
  that is far quieter than `0.1` of a square wave.
- **Low sounds stay above about 140Hz.** Phone speakers distort trying to
  reproduce lower, and that distortion is heard as rasp. The kick and bass in
  the music follow the same rule.
- **The skid is a resonance, not a hiss.** A real tire squeals because the
  tread grabs and releases. It is a high-Q bandpass plus a harmonic plus a low
  scrubbing roar, with an LFO wavering the centre frequency. Dead-steady pitch
  is the clearest tell that a sound is synthetic.
- **Swept filters read as motion; static filters read as noise.** The boost
  burst sweeps its bandpass 2600→700Hz, which sounds like air moving past.
- **Music never restarts; the race changes its mix.** One sequencer runs from
  the first tap through a sixteen-bar form and ramps gains and a lowpass
  between menu, race and boost states. Notes are scheduled 1.5 seconds ahead
  on the audio clock from a 250ms timer, far enough that a background tab's
  timer throttling can't starve it. The song is a table in `music.js`, one row
  per bar, so chords, figures, fills and the melody are data.

## Design decisions

- **Grip is a friction ceiling, not an exponential decay.** The original model
  tied grip to whether the button was held, so releasing snapped the slide
  away instantly. Now grip limits how much lateral velocity can be corrected
  per second, so a slide persists and bleeds off naturally.
- **Aligning force peaks then fades.** Linear-in-slip-angle meant the car
  yanked itself straight harder the more sideways it got, which is backwards
  from real tires.
- **Track generator uses sine harmonics, not radial control points.** Points
  at monotonically increasing angles almost guarantee same-direction corners.
  The generator rejects layouts with a minimum radius under 185px or fewer
  than four direction changes.
- **The boost plume is real position history.** Exhaust puffs are dropped in
  world space at the tailpipe and left there, so the trail curves along the
  path actually travelled instead of swinging like a searchlight during a
  drift.
- **The chain multiplier sits beside the boost bar, not screen centre.** It is
  a fill-rate multiplier, so showing it next to the bar it affects explains
  itself without a tutorial.
- **Control hints come from a capability query, not the user agent.** They
  start from `(pointer: coarse)` and correct themselves the moment the player
  uses a key or touches the screen. User-agent sniffing gets touchscreen
  laptops and keyboard tablets wrong.

## Storage

Everything is in `localStorage`, wrapped so that a blocked or empty store just
means nothing saved.

| Key | Holds |
|---|---|
| `neondrift:t<id>:best` | best time for that track geometry |
| `neondrift:t<id>:ghost` | ghost recording for that geometry |
| `neondrift:t<id>:inputs` | the best run's input changes, what the leaderboard verifies |
| `neondrift:t<id>:rival` | which leaderboard ghost you chose to race on that track |
| `neondrift:player` | the leaderboard secret; the server only sees its hash |
| `neondrift:name` | the display name |
| `neondrift:mute` | sound effects on/off |
| `neondrift:music` | music on/off |

## Constraints

- **No external assets.** Audio is built from nodes; graphics are canvas
  drawing. The one outside dependency is the Google Fonts stylesheet, which
  has a real fallback stack.
- **No libraries, no bundler, no package.json.** Edit a file, reload.

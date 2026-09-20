# Neon Drift

A one-button drift racer. No build, no dependencies, no package.json. Edit a
file, reload. Markup in `index.html`, styles in `style.css`, script split by
responsibility as ES modules under `js/`.

## Running it

Serve it:

    python3 -m http.server 8000

Then open http://localhost:8000/index.html

Serve it rather than opening the file from disk — `localStorage` (used for ghosts
and best times) behaves inconsistently under `file://` in some browsers.

**After editing a module, hard-reload (Cmd+Shift+R).** `http.server` sends no
`Cache-Control`, so Chrome keeps module scripts for a while under its heuristic
freshness rule and a plain reload can run stale code. "The change didn't take"
has meant exactly this twice.

## URL params

- `?seed=2026-12-25` — force a specific track (the daily seed is the UTC date).
  Any string works; it is only ever hashed into the PRNG seed.
- `?seed=random` — a new track every load.
- `?dev` — show the dev panel (seed loader, guides checkbox) on the start
  screen. Hidden by default; `DEV_FLAG` in `config/params.js`.
- `?guides` — show the drift guide markers. Turning guides on also computes
  the optimal line for the track (see below) and switches the markers to it.

## Constraints — keep these

**No external assets.** Everything ships inside the project:

- **Audio is synthesized at runtime** via Web Audio — oscillators, a generated
  noise buffer, biquad filters. There are no `.wav`/`.mp3` files and there should
  not be. If you want a new sound, build it from nodes.
- **Graphics are drawn, not loaded.** Everything visual is canvas drawing. No
  image files, no sprite sheets, no remote images.
- **No JS libraries.** No bundler, no `package.json`, no `node_modules`.
- **One exception:** the Google Fonts `<link>` for Chakra Petch. It has a real
  fallback stack, so the game still works if it fails to load.

Two reasons this rule holds:

1. **Restrictive hosts block remote assets silently.** Behind a strict content
   security policy, remote images, audio files and scripts from other hosts are
   refused with no error — the feature just quietly doesn't work. A sample-based
   sound would play fine locally and be dead on such a page.
2. **Portability.** The folder can be dropped on any static host with nothing
   else alongside it.

If you genuinely need an asset, put the file in the repo and reference it
relatively, or inline it as a `data:` URI.

## Game mechanics

- **One input.** Hold either screen half (or left/right arrow) to turn. That's it.
- **Holding breaks traction.** `chargeUp` seconds of holding drops the lateral
  grip ceiling from `gripMax` to `gripSlide` and the back steps out. Releasing
  restores the ceiling over `chargeDown`, but the sideways momentum already in
  the car still has to bleed off — that's what makes the slide persist.
- **Sliding trades speed for boost.** Top speed scales down with slip angle
  (`slipCost`); drifting fills the boost meter.
- **Boost has no separate button.** It fires automatically whenever you stop
  steering and have any charge. There is deliberately no activation threshold.
- **Chain multiplier.** Drifting cleanly builds a multiplier to ×4 which
  multiplies the boost *fill rate*. Touching the track edge resets it to ×1.
  Breaks above ×1.4 show a "LOST" readout and play a cue; below that they're
  silent on purpose, so minor scrapes aren't noisy.
- **Off-track** costs drag and top speed and kills the multiplier, but never
  resets your position — punish flow, not progress.
- **3 laps**, ~45–55s total. 1.8s countdown (`T_TICK`), during which physics, the
  clock and ghost playback are all frozen, so the countdown costs no lap time.
- **Ghost** is your best run on this exact track, recorded as `[x, y, angle,
  progress]` at 30Hz into `localStorage`. Progress is stored so the live delta
  can compare times at the same point on track rather than the same timestamp.

## Architecture

### Module layout

ES modules, loaded from `<script type="module" src="js/main.js">`. Dependencies
point one way — `ui` → `game` → `track`/`render`/`audio` → `config`/`core` —
and the game layer never imports the DOM or audio code: it emits events on a
tiny bus (`core/events.js`) and `ui/hud.js` and `audio/sfx.js` subscribe.
That is what keeps the graph acyclic; keep it that way when adding features.

```
js/main.js              entry: loadTrack, resize, run
js/core/    math.js     clamp, lerp, TAU, wrapAngle
            random.js   mulberry32, hashStr
            events.js   on(name, fn) / emit(name, payload) — event list at top of file
            storage.js  localStorage that never throws
            dom.js      $(id)
js/config/  params.js   URL params, TODAY, INITIAL_SEED, GUIDES_FLAG
            tuning.js   T, CAM, GUIDE, LAPS, PHYSICS_DT, GHOST_HZ, T_TICK, T_GO, road size
js/track/   generator.js  trackFromAmps, buildTrack(rng) — pure
            track.js      `track` {seed, id, samples}, loadTrackGeometry, nearest
            guides.js     `guides` {flag, visible, list}, rebuildGuides
js/game/    state.js    `car`, `race`, resetRace
            daily.js    UTC daily seed, time to rollover, and the rollover itself
            dynamics.js integrate(car, inp, dt) — the pure car model; createCar, placeCar
            ghost.js    `ghost` {data, bestTime}, loadGhost, commitRun, clearGhost, ghostAt…
            physics.js  step(dt) — integrate() on the live car + marks, plume, recording, events
            race.js     loadTrack, start, tick(now), run — the per-frame orchestration
js/sim/     schedule.js input schedules keyed on track progress; createInput, normalize, mutate
            simulate.js simulate(schedule) and the predictive bootstrap() controller
            search.js   optimize() (annealing) and polish() (coordinate descent)
            optimizer.js findLine() — the whole pipeline; LINE_VERSION
            worker.js   module worker: seed in, markers out
            line.js     main-thread `line` state, cache, ensureLine()
js/input/   input.js    steer() from pointer halves + arrow keys; emits input-mode
js/render/  camera.js   `camera`, resetCamera, updateCamera
            renderer.js resize, draw(dt, alpha)
js/audio/   context.js  the one AudioContext + master gain: unlock, mute, hidden-tab suspend
            sfx.js      effects: update(); subscribes to game events; re-exports the context API
            music.js    synthesized synthwave loop; update(live, boosting) picks the mix
js/ui/      hud.js      per-frame readouts + end screen; subscribes to game events
            controls.js buttons and the R key
            devpanel.js dev panel; also puts `window.neon` up for console poking
```

Conventions:

- **Shared mutable state lives in a handful of exported objects** (`car`,
  `race`, `track`, `ghost`, `guides`, `camera`) that are mutated in place.
  Module bindings are read-only across files, so don't export a bare `let`
  expecting another module to assign it.
- **Physics and the loop don't know about the DOM or audio.** Add a new
  reaction (a particle burst, a new sound) by subscribing to an event, not by
  importing the UI or SFX module into the game layer.
- **`tick(now)` is the whole frame** and is exported so a run can be driven
  with synthetic timestamps. Chrome pauses `requestAnimationFrame` in hidden
  tabs; from the console, `neon.start(); neon.tick(t)` in a loop still works.
  Only do that in a hidden tab: if real frames are also running, a synthetic
  timestamp ahead of the clock gives the next real frame a negative dt.
- **`dynamics.js` is the only physics.** It has no DOM, no randomness and no
  module-level game state, which is what lets the same code run the player's
  car, the optimiser in a worker, and a Node harness. Keep cosmetics (marks,
  plume, recording) in `physics.js`, not in `integrate()`.
- The dev panel is one import line in `main.js` plus the marked blocks in
  `index.html` and `style.css`.

### Boot order

`main.js` imports everything, then runs, in this order:

1. **`loadTrack(seed)`** — seeded PRNG (mulberry32) → sum of sine harmonics →
   closed loop → arc-length resampled to a 12px-spaced centreline; then the
   geometry hash, the ghost for that hash, and the car on the start line.
   Called again by the dev panel whenever a new seed is entered.
2. **`resize()`** — canvas to viewport.
3. **`armAutoplay()`** — audio context, resumed on the first interaction.
4. **`run()`** — the `requestAnimationFrame` loop: fixed 120Hz physics via an
   accumulator, then render (interpolated between steps), then HUD.

### Key invariants

- **Physics is fixed 120Hz; rendering interpolates.** `car.px/py/pa` hold the
  previous step's pose and `draw()` lerps by `acc/(1/120)`. Remove this and the
  car visibly stutters on any display that isn't a multiple of 120Hz.
- **Ghosts are keyed to track geometry, not the date.** `hashTrack()` hashes the
  sampled centerline. Change the generator and every seed produces a new id, so
  stale ghosts can never appear on a track they weren't set on. Don't "simplify"
  this back to a date key.
- **Camera smoothing must be framerate-independent.** Use
  `1-Math.exp(-frameDt/tau)`, never a fixed per-frame lerp constant.
- **Audio: never create nodes per frame.** Continuous sounds are persistent nodes
  updated via `setTargetAtTime`. Per-frame node creation causes crackling.
- **Music never restarts; the race changes its mix.** `audio/music.js` keeps
  one sequencer running from the first tap and ramps gains and a lowpass
  between menu / race / boost states. Notes are scheduled 1.5s ahead on the
  audio clock from a 250ms timer — far enough that a background tab's 1Hz
  timer throttling can't starve it; nodes are made per note, not per frame. Kick
  and bass stay above ~140Hz for the same phone-speaker reason as the boost thump.
- **Title-screen music is best-effort.** `armAutoplay()` creates the context at
  boot and resumes it on the first click, tap or key anywhere. Browsers refuse
  to start audio before any interaction, so a fresh visitor's title screen is
  silent until they touch something; returning visitors usually get it at once.
- **Effects and music are separate switches** on separate buses under one
  master: `neondrift:mute` is the effects bus, `neondrift:music` the music bus.
  Every audio button (HUD and overlay) goes through `syncAudioButtons()`.
- **Audio must unlock inside a real tap handler.** iOS refuses to start an
  `AudioContext` otherwise, and deferring it even one frame fails. `SFX.unlock()`
  (really `audio/context.js`) is called from the play, restart, mute and music
  click handlers; both the effects and the music build their nodes on it.
- **Feed the audio silence when not racing.** `step()` stops at the finish, so
  `car.drift` and velocity freeze at their last values. Passing those stale
  numbers to `SFX.update()` leaves the skid playing forever. `draw()`'s caller
  gates on `running && cd<=0`.
- **Respect the safe-area insets.** `:root` carries
  `padding-top/bottom: env(safe-area-inset-*)` and the viewport tag uses
  `viewport-fit=cover`. Phones draw edge-to-edge under translucent system bars;
  without this the HUD slides under the notch and the home indicator.
- **Capture `prevBest` before overwriting `bestTime`.** The end screen's delta
  needs the old value; overwriting first silently loses it.

## Tuning constants

### `T` — car physics

| Knob | Does what |
|---|---|
| `gripMax` / `gripSlide` | Lateral grip ceiling with traction / once it breaks. Lower `gripSlide` = looser back end. |
| `stiffness` | How fast small slip angles are corrected while the tires still bite. |
| `chargeUp` / `chargeDown` | Seconds for traction to break while holding / for the ceiling to return after release. |
| `align` | Self-aligning torque gain. Sets the *settled* drift angle (~50°). |
| `alignFall` / `alignFloor` | Where the aligning force peaks and how much survives at big slip. The falloff is what lets a drift hold. |
| `zeta` | Yaw damping ratio. **Only affects how the car settles**, not the drift angle — natural frequency is derived from `align` and `zeta` together so equilibrium is invariant. Lower = more overshoot. |
| `turn` | Steering rate (rad/s). |
| `slipCost` | How much top speed a sideways car loses. |
| `slipLagIn` / `slipLagOut` | Seconds to bleed speed off entering a slide / regain it on exit. Asymmetric on purpose. |
| `scrub` | Extra forward drag proportional to sideways velocity. |
| `driftMin` | Slip angle below which you aren't considered drifting (no boost fill, no skid sound). |
| `accel` / `maxSpeed` | Base thrust and top speed. |
| `boostAccel` / `boostSpeed` | Thrust and top speed while boosting. |
| `boostFill` / `boostDrain` / `boostCap` | Boost economy. |
| `offDrag` | Drag while off-track. |
| `zoomRange` / `zoomLag` | How far the view pulls back at speed, and seconds to follow a speed change. Set `zoomRange` to 0 to lock the zoom. |

### `CAM` — camera feel

| Knob | Does what |
|---|---|
| `face` | 0 = follow direction of travel, 1 = follow the nose. Low values stop drifts whipping the view. |
| `freq` / `zeta` | Chase spring stiffness and damping. |
| `leadLag` | Smooths the look-ahead vector. Without it the camera stalls on every steering tap, because look-ahead is `velocity × lead` and velocity drops when a slide starts. |
| `followLag` | Seconds for the camera position to catch up to its target. |
| `spanFixed` / `spanChase` | World pixels across the short viewport edge, per camera mode. |
| `leadFixed` / `leadChase` | Look-ahead distance in seconds of velocity, per camera mode. |

The fixed camera's world span scales with viewport size (clamped to 1.85×), so a
desktop sees ~3.4× the track area a phone does. Without that, a bigger screen
just magnified everything instead of showing more.

### `GUIDE` — drift marker heuristic (behind `?guides`)

Green line = start holding, dashed white = release. **The heuristic is only the
placeholder** shown while the optimal line is being computed — see the next
section. Each corner is treated independently and it ignores the gentle bends
between corners entirely, so a car driven by it alone leaves the road within
seconds.

| Knob | Does what |
|---|---|
| `minRadius` | Corner-detection threshold. Physics says `v²/a` ≈ 414px, but curvature smoothing flattens peaks, so this is calibrated to 520. Across 40 tracks that yields ~6 corners each. |
| `lead` / `trail` | Seconds before the corner to commit / before its end to release. Derived from `chargeUp` and `slipLagOut`. |
| `minCorner` | Ignore wiggles shorter than this (px). |

## Optimal line (`js/sim/`)

The physics is deterministic and one-dimensional in input, so the ideal
markers are found by search rather than guessed: a run is an **input schedule**
(hold left/right between two track-progress values), and the search minimises
the simulated three-lap time subject to never leaving the road.

1. **Bootstrap.** A predictive controller drives the track through the real
   dynamics: every 6 steps it rolls each input forward 120 steps (held, and
   released after `hold`), scores distance from the centreline plus a big
   off-road penalty minus progress, and commits to the best. Twelve variants
   (cost exponent, progress weight, hold length, horizon) are tried and the
   best one that stays on the road wins. This does most of the work.
2. **Anneal** (1000 evaluations, seeded from the track id so results are
   reproducible) then **polish** (coordinate descent on every endpoint).
3. Replay the winner with tracing; every press/release becomes a marker.

Facts that the design depends on:

- **Schedules are keyed on continuous track progress**, not time, so a change
  at one corner doesn't misalign every corner after it. Progress is
  `(sample index + fraction along the sample) / N`, carried in `car.prog`; the
  quantised version stalled at low speed and made replays diverge.
- **Replay is stateful** (`createInput`): once a segment is entered it stays
  active until progress passes its end, because the nearest-sample index can
  step back by one mid-slide.
- **The simulator uses a ±6 nearest-point window** where the game uses ±45.
  They are provably identical for a car on the road (road half-width 132px is
  inside the tightest corner radius 185px), and ±6 is ~5× faster. Off-road runs
  are rejected anyway.
- **Objective = time + 100 × seconds off-road (+200 if unfinished).** The
  penalty is proportional so the search has a gradient toward the road; the
  UI reports `feasible` only when off-road time is exactly zero.
- **Horizon 120 steps (1s) beat both shorter and longer.** Longer horizons
  score the released rollout over so many steps that every option looks bad.
- **A long hold is one ≥ `chargeUp`** — that's when traction breaks. Only those
  are drawn, as the entry/exit marker pair. Shorter steering taps are still in
  the marker data (`long: false`) but not drawn; they cluttered the corners.
- **The whole search takes ~7s** on a laptop and runs in a module worker; the
  result is cached in localStorage under `neondrift:t<id>:line:v<LINE_VERSION>-<physics hash>`,
  so changing any `T` constant or bumping `LINE_VERSION` recomputes it.
  Markers are drawn only for the lap being driven.

Benchmarks live outside the repo; the pipeline runs in Node with a two-line
`location`/`document` stub, since nothing under `sim/` touches the DOM.

## Input detection

Control hints adapt via `matchMedia("(pointer: coarse)")`, then correct
themselves the moment the player actually uses a key or touches the screen.
Deliberately not user-agent sniffing — that gets touchscreen laptops and
keyboard tablets wrong.

## localStorage keys

- `neondrift:t<trackId>:best` — best time for that track geometry
- `neondrift:t<trackId>:ghost` — ghost recording for that track geometry
- `neondrift:t<trackId>:line:v<n>-<hash>` — optimal line markers for that geometry + physics
- `neondrift:mute` — sound effects on/off, global
- `neondrift:music` — music on/off, global

Wrap every read in try/catch and render correctly when storage is empty.

## Decisions worth not re-litigating

- **Grip is a friction ceiling, not an exponential decay.** The original model
  tied grip to whether the button was held, so releasing snapped the slide away
  instantly. Now grip limits how much lateral velocity can be corrected per
  second, so a slide persists and bleeds off naturally.
- **Aligning force peaks then fades.** Linear-in-slip-angle meant the car yanked
  itself straight harder the more sideways it got — backwards from real tires.
- **No boost activation threshold.** A minimum charge gate was tried and removed:
  it let sub-threshold charge bank up, which *rewarded* tap-spamming.
- **Track generator uses sine harmonics, not radial control points.** Points at
  monotonically increasing angles almost guarantee same-direction corners only.
  Generator rejects layouts with min radius < 185px or fewer than 4 direction
  changes.
- **Audio levels were solved, not eyeballed.** Gains are balanced by A-weighted
  loudness through a phone-speaker rolloff. Raw gain numbers are misleading: a
  Q=12 bandpass passes ~75Hz of bandwidth, so `0.4` of that is far quieter than
  `0.1` of a square wave. Rebalance by measuring, not by ear alone.
- **Keep low sounds above ~140Hz.** Phone speakers distort trying to reproduce
  lower, and that distortion is heard as rasp. The boost thump was lowered twice
  chasing "more subtle" and got worse each time; raising it fixed it.
- **The skid is a resonance, not a hiss.** A real tire squeals because the tread
  grabs and releases — stick-slip. It's a high-Q bandpass (pitched, rings) plus a
  harmonic plus a low scrubbing roar, with an LFO wavering the centre frequency.
  Dead-steady pitch is the clearest tell that a sound is synthetic. A wide, low-Q
  bandpass is just filtered noise and sounds like wind.
- **Swept filters read as motion; static filters read as noise.** The boost burst
  sweeps its bandpass 2600→700Hz, which sounds like air moving past. The same
  noise through a fixed highpass sounded like rasp.
- **The boost plume is real position history.** Exhaust puffs are dropped in
  world space at the tailpipe and left there, so the trail curves along the path
  actually travelled. Don't "simplify" it back to a line drawn along the heading —
  that swings like a searchlight during a drift.
- **The chain multiplier lives next to the boost bar, not screen centre.** It was
  centred and flashing; it's a boost fill-rate multiplier, so showing it beside
  the bar it affects explains itself without a tutorial.

## Dev panel (temporary)

Hidden unless `?dev` is on the URL (or `DEV_FLAG` is flipped in
`config/params.js`); the module still loads so `window.neon` is always there.
It is the `DEV PANEL START/END` block in `index.html`, the
`DEV PANEL CSS START/END` block in `style.css`, and `js/ui/devpanel.js` plus
its import line in `js/main.js`. Deleting them is clean — nothing else
references them.

## Not built yet

- **Daily leaderboard.** Needs shared storage. The geometry hash is the natural
  key; the daily seed is already UTC.
- **Engine sound.** Deliberately skipped; it's more work than everything else in
  the audio module combined. Detuned sawtooths with a speed-driven lowpass.
  (Music now exists — see `audio/music.js` — but engine noise still doesn't.)
- **Track selection / multiple tracks.** `loadTrack(seed)` already supports it.

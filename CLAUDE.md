# Neon Drift

A one-button drift racer. No build, no dependencies, no package.json. Edit a
file, reload. Markup in `index.html`, styles in `style.css`, script split by
responsibility as ES modules under `js/`.

## Running it

Serve it:

    python3 serve.py

Then open http://localhost:8000/index.html (`serve.py [port]` for another port).

Serve it rather than opening the file from disk — `localStorage` (used for ghosts
and best times) behaves inconsistently under `file://` in some browsers.

**Use `serve.py`, not `python3 -m http.server`.** It is the same stdlib server
with `Cache-Control: no-store` on every response. Without that header Chrome
keeps module scripts for a while under its heuristic freshness rule and a
plain reload can run stale code — "the change didn't take" has meant exactly
this twice. If you do use a bare `http.server`, hard-reload (Cmd+Shift+R)
after every edit. `serve.py` binds all interfaces, so the LAN phone test
below works with it unchanged.

## URL params

- `?seed=2026-12-25` — force a specific track (the daily seed is the UTC date).
  Any string works; it is only ever hashed into the PRNG seed. The title
  screen's day picker (‹ › around the track label) also sets and clears this
  param via `replaceState`, so a past day's URL is shareable.
- `?seed=random` — a new track every load.
- `?rival=<player id>` — a challenge link: race that player's posted run on
  the linked seed. Consumed once on load, stored as the track's remembered
  rival, then stripped from the URL. Made by "Challenge a friend" in the
  leaderboard panel, which appears once you have a posted time.
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

- **One input.** Hold either screen half, a left/right arrow key, or a
  gamepad's stick or d-pad to turn. That's it. The stick is read as -1/0/1
  past a deadzone, never analog: any nonzero input breaks traction and forbids
  boost at the same rate, and the leaderboard's validator only replays those
  three values, so an analog steer would be both a different mechanic and an
  unpostable run.
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
- **Day browser.** The arrows around the track label step to earlier days'
  tracks, back to `FIRST_DAY` (`config/params.js`, the leaderboard's launch
  day). A past day is a full track: its board loads, its ghosts race, and new
  times still post — boards never freeze. The label says "yesterday" / "3 days
  ago"; a non-date seed (`?seed=random` or a custom string) says "override". The midnight
  rollover only pulls the *daily* track forward, so browsing yesterday at
  23:59 UTC doesn't yank you to the new day.
- **Rival ghost.** Tapping a leaderboard row fetches that run's recording and
  races it *instead of* your own ghost (drawn in rose, no label — the HUD names them); the
  live delta, the "vs" line and the end-screen comparison follow it. Your own
  best still saves as usual. Remembered per track in `neondrift:t<id>:rival`.
- **Challenge links.** "Challenge a friend" shares `?seed=…&rival=<your id>`
  via the system share sheet, else the clipboard, else the URL shown
  selectable. Opening one sets that rival and shows "NAME#tag challenges you
  to beat 39.97." above the race button (the `challenge` event). Your own id
  is ignored. Only your own posted run can be shared — one meaning per link.

### Run mode

A gauntlet of one-lap tracks, each seeded `<day>#run<n>` — a different
geometry from the daily track and from every other stage. A clock replaces
the lap timer: it starts at 20s and can hold up to 30s, draining every step at
a rate that ramps steeply over the first stages, knees at about 1.6× by stage
8, then creeps upward without bound (`drainMax`, `rampK`, `creep`, `knee` in
`TIMER`). The knee is what keeps one wall survivable; the creep is what makes
every run end — a capped drain let a chain-keeping build refill forever. It is
refilled only while sliding on the
road, scaled by speed and the chain multiplier — so drifting well is what
keeps you alive, not just finishing laps. Clearing a stage pays `TIMER.bonus`
seconds, scaled by the build's bonus multiplier. **The chain carries across
stages**: a run is one continuous drive, so the multiplier you cross the line
with is the one the next stage starts on (`run.chain`). It has to — the chain
builds at 0.30/s and a one-lap stage has a second or so of sliding per corner,
so even the ideal line peaks near ×1.9 inside a single stage; only a chain
built over several stages can out-earn the ramped drain.
Off-track never kills a run directly: a wall keeps half the chain you built
(`multOffKeep` 0.5 in the run's base build, versus the daily race's full
reset), and some mods charge seconds instead; the run ends only when the clock
reaches zero (once, if Second wind is held, zero refills to 8s instead). `TIMER` in
`js/run/timer.js` is every one of these numbers in one place — the ramp,
refill gain, and the low-clock and Skip amounts aren't reproduced here.

Between stages you pick one of three mods (plus an always-present Skip, worth
a few seconds and nothing else). The catalogue is 30 cards in `js/run/mods.js`,
each with a `kind`: car, character, clock, road, rules or pure. A car card
changes a handling knob by enough to feel in the first corner and pays for it
in a *different* currency — steering rate, a ceiling, heavier mistakes, less
information, a longer lap, a lump sum now, a threshold — never the drain rate.
A character card is a different car (Fishtail, Ice, Boat, Twitch, Rocket,
Glide, Afterburner, Snowball) and carries no cost line: its trade is emergent
from the physics. Pure cards (Kickstart, Insurance, Breather) have no cost and
half the offer weight. Picks fold into a *build* — a copy of `T` plus the run's
own knobs — via `buildFrom(picks)`; that file is the source of every
percentage. Four keys on the build's `T` (`slideSpeed`, `boostSteer`,
`multSpeed`, `offFree`) are read by `integrate()` with stock fallbacks, so `T`
itself never gains them and the line cache key is unchanged. Offers are seeded
from the day and stage (`offerFor` in `js/run/offer.js`): slot one is always a
car or character card, held mods and unheld character cards are weighted
double, pure cards half. `test/mod-feel.test.mjs` is the bar: every car and
character card at level 1 must move a handling metric by 15% against the base
build, measured by driving a fixed stage with the bootstrap controller (Long
tank and Snowball are measured with a full meter / a carried chain, the state
they act in).

**The track ramps with the stage.** Each stage asks the generator for a
minimum number of *corners* — the drift guides' count, a stretch of smoothed
curvature tighter than `GUIDE.minRadius` — rising from 4 at stage 1 to 9 at
the timer's knee and holding there (`RAMP`, `stageShape(n)` in
`js/run/stages.js`). More corners, never tighter ones: the 185px minimum
radius is what the road width, the physics and the simulator's nearest-point
window assume. The floor was chosen by measurement — the daily generator's
median is about 5, it finds 9 on almost every seed with its existing
harmonics, and 11 is where it starts failing; across 280 stage seeds the
fallback never fires and the median climbs from 6 to 10. The raw
direction-change count (`flips`) was the first candidate and is useless as a
ramp: it counts gentle wiggles, so most tracks already have eight.

**Track difficulty was measured before becoming a cost.** Across 600 seeds the
tightest radius already sits within 30px of the 185 floor (asking for tighter
misses seeds and isn't felt), opposing-corner gaps are already under the
traction-recovery time by stage 8 (the ramp delivers transitions), and long
corners can't be asked for reliably. Lap length is the one track cost (Wide
road): the accepted layout is rebuilt at a larger radius after the search
(`shape.lapScale`), which never fails and makes every corner gentler by the
same factor. Scaling before the search lost seeds even at ×1.1.

Score is stages cleared, then progress into the stage that ended it — not
time. Bests are local only, per day and all-time, in `localStorage`; there is
no board, no ghost and no optimal line for a stage. The run has three sounds
of its own — stage clear, low clock, run over — on its events in `audio/sfx.js`.

## Architecture

### Module layout

ES modules, loaded from `<script type="module" src="js/main.js">`. Dependencies
point one way — `ui` → `run` → `game` → `track`/`render`/`audio` → `config`/`core` —
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
js/config/  params.js   URL params, TODAY, FIRST_DAY, date-seed helpers, INITIAL_SEED, GUIDES_FLAG
            tuning.js   T, CAM, GUIDE, LAPS, PHYSICS_DT, GHOST_HZ, T_TICK, T_GO, road size
js/track/   generator.js  trackFromAmps, cornerCount, buildTrack(rng, shape?) — pure
            track.js      `track` {seed, id, samples}, loadTrackGeometry(seed, shape?), nearest
            guides.js     `guides` {flag, visible, list}, rebuildGuides
js/game/    state.js    `car`, `race`, resetRace
            daily.js    the daily rollover, and the day browser (gotoDay, gotoToday, canGoDay)
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
js/run/     mods.js     the mod catalogue; buildFrom(picks) folds picks into a build (T copy + run knobs)
            offer.js    offerFor(day, stage, picks) — seeded, held-weighted, pure
            timer.js    TIMER constants; tickTimer() runs the clock inside physics steps
            stages.js   stageSeed, stageShape (the track ramp), beats (score order), parseBest, storage keys
            state.js    the mutable `run` object (leaf, so the HUD can read it)
            run.js      startRun, pick, restart, abandon; the run's rules object; loadStage
js/input/   input.js    steer() from pointer halves + arrow keys + gamepad; emits input-mode
            gamepad.js  pure: padState(gp) → digital x/y + A/B/LB/RB, risingEdges, firstPad, stepIndex
js/render/  camera.js   `camera`, resetCamera, updateCamera
            renderer.js resize, draw(dt, alpha)
js/audio/   context.js  the one AudioContext + master gain: unlock, mute, hidden-tab suspend
            sfx.js      effects: update(), engineUpdate(); subscribes to game events; re-exports the context API
            engine.js   the engine: stepEngine(model, input, dt, P) is pure (gears, revs, load); createEngine(ctx, bus) builds the nodes
            music.js    the sequencer: plays a composed song on the audio clock; update(live, boosting) picks the mix
            compose.js  compose(seed) → song: pure, seeded; the pools, the mood, advance() for the bar-line swap
js/net/     identity.js secret + name in storage; playerId() = sha256(secret); tag = first 4 hex
            api.js      fetch wrappers for the leaderboard API; every failure resolves to null
            leaderboard.js `board` state; posts runs that beat your posted time; rename; pairing; challenge links; emits board-updated, challenge
js/ui/      hud.js      per-frame readouts + end screen; subscribes to game events
            board.js    the leaderboard panel: top 10, own row, name prompt, pairing links
            controls.js buttons and the R key
            runhud.js   per-frame run readouts (stage, clock, time bar)
            runui.js    the run button's best line, the offer screen, the run-over screen
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
- `main.js` puts `window.neon` up (car, race, track, ghost, guides, camera,
  line, loadTrack, start, tick, ensureLine, run, startRun, pick, restartRun,
  abandon) for poking at live state from the browser console. It is the only
  debug affordance; everything else is a URL param.

### Boot order

`main.js` imports everything, then runs, in this order:

1. **`loadTrack(seed)`** — seeded PRNG (mulberry32) → sum of sine harmonics →
   closed loop → arc-length resampled to a 12px-spaced centreline; then the
   geometry hash, the ghost for that hash, and the car on the start line.
   Called again by the day browser and when leaving a run.
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
- **The generator's default path is pinned.** `buildTrack(rng, shape)` with no
  shape must draw the same rng values and accept the same candidate as it
  always has, or every stored track id, ghost and leaderboard time is orphaned.
  `test/run-ramp.test.mjs` pins one daily id; only the run passes a shape.
- **Camera smoothing must be framerate-independent.** Use
  `1-Math.exp(-frameDt/tau)`, never a fixed per-frame lerp constant.
- **Audio: never create nodes per frame.** Continuous sounds are persistent nodes
  updated via `setTargetAtTime`. Per-frame node creation causes crackling.
- **Music never restarts; the track changes the tune, the race changes its mix.**
  `audio/music.js` keeps one sequencer running from the first tap and ramps
  gains and a lowpass between menu / race / boost states. The tune itself is
  composed per track by `audio/compose.js` from `track.seed` (not the geometry
  id: Wide road rebuilds a stage's geometry mid-run and the tune must not
  flip with it) on the `geometry-loaded` event, which `loadTrackGeometry`
  emits for the daily track and every run stage alike. A new song is parked
  as pending and taken by `advance()` on the next bar line, so the day browser
  and a run's stage changes land as a bar change with the drums running
  through it. Notes are scheduled 1.5s ahead on the audio clock from a 250ms
  timer — far enough that a background tab's 1Hz timer throttling can't
  starve it; nodes are made per note, not per frame. Every chord root is
  voiced into MIDI 50..61, so kick and bass stay above ~140Hz for the same
  phone-speaker reason as the boost thump.
- **A run is posted when it beats your posted time, not your local ghost.**
  The two can differ (a best set before naming yourself, or offline). With no
  board loaded the local personal-best rule applies. The server still only
  replaces a row with a faster replayed time.
- **Times are verified by replay, never trusted.** The physics wrapper records
  the step at which the input changed; the worker replays that through the
  same `integrate()`. Anything that changes `dynamics.js` changes what replays
  to, so old stored inputs will no longer verify — that is expected.
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
- **`integrate()` takes the physics table as a parameter** (`P`, default `T`).
  The live step passes `race.params`; a run swaps in its build's copy. The
  optimiser and the worker never pass it. `resetRace` never touches
  `race.params`; `setRules(null)` restores `T`.
- **Road width is `track.halfW`**, reset to `HALF_W` on every geometry load; a
  run's road mods scale it. The physics, the renderer and the simulator all
  read it.
- **The loop runs under a `rules` object** (`laps`, `onStep`, `onFinish`)
  whose default is the daily race. `race.js` never imports `js/run/`; the run
  installs its rules and hands back null. Keep it that way: it is the seam a
  future mode abstraction widens.
- **The run never calls `loadTrack`** for a stage (no ghost, no board, no
  `track-loaded`); it calls `loadTrackGeometry` directly and restores the
  daily track with `loadTrack(day)` on abandon. A run's stages have no ghost
  either way: `loadStage` calls `unloadGhost()` to clear the daily one without
  touching storage, and `abandon`'s `loadTrack` brings it back.
- **A run's fallback ranks drivable first.** When a shape asks for corners,
  `buildTrack` prefers a fallback that clears the radius floor over one with
  more corners; two stage seeds in 720 used to ship an 85px corner. The
  default path's ranking is untouched.
- **`camera.spanScale` and `car.offUsed` belong to the run.** The camera
  span multiplier is set on stage load and pick, reset to 1 on leaving; the
  free-excursion counter resets in `placeCar`, so Insurance is per stage.
- **Skip is always pickable, even on an empty offer.** `pick()`'s offer check
  only applies to a mod id; a fully-capped catalogue (every mod held to its
  max) still leaves Skip standing, so a run can never strand a player with no
  legal move.

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
| `multRise` / `multFall` / `multCap` | Chain multiplier build rate while sliding, decay rate, ceiling. |
| `multOffKeep` | Fraction of the chain above ×1 that survives leaving the road. 0 in the daily race (a full reset); a run's build uses 0.5, and its Off-road tax mod 1. |
| `slideSpeed` / `boostSteer` / `multSpeed` / `offFree` | Not in `T`: optional keys a run's build sets, read by `integrate()` with stock fallbacks (210, false, 0, 0). Slide speed gate; boost fires while steering; top speed per ×1 of chain; free excursions per stage. |
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

## Gamepad

Standard-mapping pads work without configuration. The Gamepad API has no
events for sticks, so it is polled: `steer()` reads the first connected pad
every physics step (a cheap snapshot, and the only place steering is read),
and `ui/controls.js` polls at 60Hz for the menus. A focus ring
(`.padfocus`) moves between the visible screen's primary buttons — those
marked `data-pad`: the two title buttons, race again, the mod cards and
Skip, the run-over pair — with the stick or d-pad in any direction; A
presses the focused one, B is the R key, LB/RB are the day arrows. Every
action goes through the button's own click handler, so the audio unlock,
the line-computing guard and the run's Skip rule apply unchanged. The ring
is drawn only once the pad has been used, so mouse and touch players never
see it; secondary links (rename, pairing, toggles, clear ghost) stay
mouse-only so the race button is never a five-press trip. Chrome and Safari
hide a pad until a button is pressed, which doubles as the handshake.
`test/gamepad.test.mjs` covers the pure reading; the DOM half was checked
by stubbing `navigator.getGamepads`.

## localStorage keys

- `neondrift:t<trackId>:best` — best time for that track geometry
- `neondrift:t<trackId>:ghost` — ghost recording for that track geometry
- `neondrift:t<trackId>:line:v<n>-<hash>` — optimal line markers for that geometry + physics
- `neondrift:t<trackId>:inputs` — the best run's input changes (what the leaderboard replays)
- `neondrift:t<trackId>:rival` — player id of the leaderboard ghost chosen for that track
- `neondrift:player` — the leaderboard secret; `sha256` of it is the player id
- `neondrift:name` — the display name
- `neondrift:mute` — sound effects on/off, global
- `neondrift:music` — music on/off, global
- `neondrift:run:<day>:best` — best run for that day, `{ stages, prog, picks }`
- `neondrift:run:best` — best run ever, the same shape plus `day`

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
  changes; a run's stages add a corner floor on top (see the track ramp).
- **Audio levels were solved, not eyeballed.** Gains are balanced by A-weighted
  loudness through a phone-speaker rolloff. Raw gain numbers are misleading: a
  Q=12 bandpass passes ~75Hz of bandwidth, so `0.4` of that is far quieter than
  `0.1` of a square wave. Rebalance by measuring, not by ear alone.
- **Keep low sounds above ~140Hz.** Phone speakers distort trying to reproduce
  lower, and that distortion is heard as rasp. The boost thump was lowered twice
  chasing "more subtle" and got worse each time; raising it fixed it.
- **The engine is gears, load and pulses, not a pitch that tracks speed.**
  The first version was two sawtooths pitched by speed through a lowpass: a
  synth pad following a number, and it read as a constant high whine even
  after being pitched down. `audio/engine.js` is now a small model. Four
  fictional gears (thrust is always on, so they express nothing physical)
  make revs climb and fall so the contour keeps moving at a steady speed,
  with a throttle lift at each shift. Load — boost or hard acceleration —
  opens the filter and lifts the level; cruise is a low burble ~11dB under
  that, and a slide is overrun ~20dB under, with one pop as it starts, so the
  engine gets out of the way exactly while you drift. The tone is a narrow
  pulse train at the firing rate (a four-cylinder fires at rpm/30 Hz) plus
  noise gated by the same pulses: a brrr, not an eeee. The firing fundamental
  sits under the ~140Hz floor, so a 110Hz highpass drops it and the
  harmonics carry the roughness (the missing-fundamental effect, which is
  also how a real engine sounds through a phone). Level was set like the
  rest: A-weighted through a 400Hz phone-speaker rolloff, full load at the
  redline sits ~4dB under the full squeal and level with the boost whoosh,
  which gave up 3dB to make room. The first balance, 11dB under, was
  inaudible under boost and music together. It runs from the countdown
  (motor on, car on the line) to the finish; `race.running` is that window.
- **The skid is a resonance, not a hiss.** A real tire squeals because the tread
  grabs and releases — stick-slip. It's a high-Q bandpass (pitched, rings) plus a
  harmonic plus a low scrubbing roar, with an LFO wavering the centre frequency.
  Dead-steady pitch is the clearest tell that a sound is synthetic. A wide, low-Q
  bandpass is just filtered noise and sounds like wind.
- **The music is a grammar over pools, not a fixed tune and not free rules.**
  One hand-written loop was the same on every track. Functional-harmony rules
  were considered and rejected: more variety, far more listening to tune, and
  every tuning pass changes every track. `compose.js` keeps the composed
  *shape* (four phrases, the turn, the lead, the fills) and draws the content
  from pools conditioned on a mood vector drawn first — drawing the parts
  independently gave random mixtures. Dorian's own vi is diminished, so its
  VI chord borrows aeolian's; minor-V is aeolian with a major dominant. Lead
  notes may be chord tones outside the scale for exactly those two chords.
  `test/compose.test.mjs` checks the register, range and phrase rules across
  500 seeds; change a pool there and the test tells you what broke.
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

## Leaderboard worker (`worker/`)

A Cloudflare Worker with D1. It imports the game's `dynamics.js`, `track.js`
and `tuning.js` by relative path and verifies every submitted run by replaying
its recorded inputs; the replayed time is what gets stored. Routes are in
`worker/src/index.js`: `POST /runs`, `GET /board`, `POST /name`,
`POST /pair/start`, `POST /pair/approve`, `POST /pair/poll`, and `GET /ghost`
(a stored run's recording, for racing a leaderboard ghost). CORS is limited to `ALLOWED_ORIGINS`
in `wrangler.toml`: the GitHub Pages origin in production, localhost only
under `wrangler dev --env dev`. Writes are rate limited per IP.

**Pairing never hands a secret to whoever types a code.** It is the device-
authorization shape (RFC 8628): the *new* device calls `/pair/start`, shows
the six-character code and keeps a private 128-bit token; the device that
already has the name types the code into `/pair/approve` with its secret; the
new device collects with `/pair/poll` by token, which deletes the row in the
same statement (`DELETE … RETURNING`). Guessing a code can only push your
own secret onto a stranger's device, never pull one. Polling is 2s for the
first minute then 5s, skipped while the tab is hidden, on its own rate-limit
binding (`POLL_LIMIT`) so it can't exhaust the write limit. Don't reverse
this back to "code returns secret" for a simpler UI.

Run it locally: `cd worker && npm install && npm run db:init:local && npm run dev`.
A game served from localhost talks to it automatically (`API_URL` in
`config/params.js` picks the local worker by hostname); the local worker uses
a simulated D1 under `worker/.wrangler/`, never production.

**Testing from a phone on the same wifi:** open `http://<your Mac's LAN
IP>:8000/index.html` (`ipconfig getifaddr en0`). Private addresses count as
local too, the game calls the worker at that same address on port 8787, the dev
script binds wrangler to all interfaces (`--ip 0.0.0.0`), and the dev env sets
`ALLOW_LAN=1` so the worker grants CORS to any private-network origin. None of
this applies to production: it lists only the GitHub Pages origin.
`node test/make-run.mjs <seed>` writes a genuine run to `/tmp/run.json` for
`curl` tests.

**Deploys are automatic and only automatic.** The repo is connected to
Cloudflare (Workers & Pages → Connect GitHub, root `worker/`), so a push to
`main` deploys the worker. Never run `wrangler deploy` by hand; there is no
deploy script on purpose. Schema changes are the exception: apply them with
`npm run db:init` (idempotent `schema.sql`) when asked.

Tests: `node --test "test/*.test.mjs"` covers the input recording, the replay (a genuine
run replays to the identical time; tampering, wrong claims and unfinished runs
are rejected), validation, and the client identity.

## Not built yet

- **Optimal ghost.** The line worker already has the full trace; playing it
  back as a second ghost is the natural next step.
- **Turnstile.** If the leaderboard gets abused from scripts, Cloudflare
  Turnstile (invisible mode) bound to the Pages hostname is the free fix.
- **Track selection / multiple tracks.** `loadTrack(seed)` already supports it.
- **Run leaderboard.** Picks plus per-stage inputs would replay the same way
  the daily leaderboard does; nothing about a run's recording stops it.
- **Route choice.** Offers are a single set of three cards plus Skip; there is
  no branching path through a stage.
- **Longer laps for later stages.** The ramp adds corners; the base radius
  (lap length) is the same at every stage and would be a second knob.
- **Run ghost.** No stage records or replays a run's own line, unlike the
  daily race's ghost.

// Canvas rendering. draw() is called once per animation frame with the frame
// time and an interpolation factor between the last two physics steps.

import { $ } from "../core/dom.js";
import { clamp, lerp, wrapAngle } from "../core/math.js";
import { LAPS, CAR_SCALE } from "../config/tuning.js";
import { track } from "../track/track.js";
import { guides } from "../track/guides.js";
import { line } from "../sim/line.js";
import { car, race } from "../game/state.js";
import { ghost, ghostAt } from "../game/ghost.js";
import { peers, peerPose } from "../game/peers.js";
import { camera, updateCamera } from "./camera.js";
import { carById, drawCarShape, garage } from "./cars.js";
import { createRain, rainCount, stepRain, drawRain } from "./rain.js";

const COLOR = {
  void: "#05060b", grid: "#101a2e", road: "#0a0d18",
  ice: "#2fe3ff", rose: "#ff2f9e", amber: "#ffc53d", paper: "#e8f0ff",
  guideEntry: "#49ff9e",
  tireMark: "rgba(165,190,245,.16)",
  startLine: "rgba(232,240,255,.16)",
  ghostBody: "rgba(47,227,255,.30)", ghostGlow: "rgba(47,227,255,.07)",
  rivalBody: "rgba(255,47,158,.45)", rivalGlow: "rgba(255,47,158,.10)",
  peerBody: "rgba(255,197,61,.28)", peerGlow: "rgba(255,197,61,.06)", peerLabel: "rgba(232,240,255,.55)",
  offTint: "rgba(255,47,158,.10)",
  roadWet: "#070914", tireMarkWet: "rgba(165,190,245,.07)", spray: "232,240,255",
};
const EDGES = [[1, COLOR.ice], [-1, COLOR.rose]];   // [side, colour]
const GRID = 260;

const stage = $("stage");
const canvas = $("c");
const cx = canvas.getContext("2d");
let W = 0, H = 0, DPR = 1;
let rain = null; let camPX = 0, camPY = 0;

/** Match the canvas to the stage size and device pixel ratio (capped at 2). */
export function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = stage.clientWidth; H = stage.clientHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
addEventListener("resize", resize);

/**
 * Render one frame.
 * @param dt     frame time in seconds
 * @param alpha  0..1 interpolation between the car's previous and current pose.
 *               Physics runs at a fixed 120Hz but the display may not be a multiple
 *               of that; without this, a 144Hz screen shows 0.83 steps per frame and
 *               the car visibly stutters.
 */
export function draw(dt, alpha) {
  const rx = lerp(car.px, car.x, alpha), ry = lerp(car.py, car.y, alpha);
  const ra = car.pa + wrapAngle(car.a - car.pa) * alpha;

  updateCamera(car, rx, ry, ra, W, H, dt);

  cx.fillStyle = COLOR.void; cx.fillRect(0, 0, W, H);

  cx.save();
  const sx = (Math.random() - 0.5) * race.shake * 14, sy = (Math.random() - 0.5) * race.shake * 14;
  cx.translate(W / 2 + sx, camera.chase ? H * 0.66 + sy : H / 2 + sy);
  cx.rotate(camera.a); cx.scale(camera.z, camera.z); cx.translate(-camera.x, -camera.y);

  // visible bounds in world space
  const r = Math.hypot(W, H) / camera.z / 2 + 260;
  const bx0 = camera.x - r, bx1 = camera.x + r, by0 = camera.y - r, by1 = camera.y + r;
  const inView = (x, y) => x > bx0 && x < bx1 && y > by0 && y < by1;

  drawGrid(bx0, bx1, by0, by1);

  // visible runs of track — each run is a contiguous stretch of samples in view,
  // plus one sample past each end so the road doesn't stop at the viewport edge
  const S = track.samples, N = S.length;
  const runs = []; let cur = null;
  for (let i = 0; i <= N; i++) {
    const s = S[i % N];
    if (inView(s.x, s.y)) { if (!cur) { cur = []; runs.push(cur); } cur.push(s); }
    else if (cur) { cur.push(s); cur = null; }
  }

  drawRoad(runs);
  drawTireMarks(inView);
  drawEdges(runs);

  // drift guides, drawn on the road under everything else: the optimal line's
  // markers for the lap being driven once they exist, the heuristic until then
  if (guides.visible) {
    if (line.status === "ready" && line.markers.length) drawLineMarkers(S, inView);
    else {
      for (const g of guides.list) {
        const sa = S[g.a], sb = S[g.b];
        if (inView(sa.x, sa.y)) drawGuide(sa, COLOR.guideEntry, false);
        if (inView(sb.x, sb.y)) drawGuide(sb, COLOR.paper, true);
      }
    }
  }

  drawStartLine(S[0]);

  // live mode's other players: fainter than your own ghost, each with a label
  // that stays upright and screen-sized whatever the camera does
  if (peers.size) {
    const now = performance.now();
    cx.font = "600 11px 'Chakra Petch', system-ui, sans-serif"; cx.textAlign = "center";
    for (const p of peers.values()) {
      const q = peerPose(p, now);
      if (!q || !inView(q.x, q.y)) continue;
      cx.globalAlpha = q.alpha;
      drawCar(q.x, q.y, q.a, COLOR.peerBody, COLOR.peerGlow, true, NEON);
      cx.save();
      cx.translate(q.x, q.y); cx.rotate(-camera.a); cx.scale(1 / camera.z, 1 / camera.z);
      cx.fillStyle = COLOR.peerLabel;
      cx.fillText(p.name + "#" + p.tag, 0, -26 * CAR_SCALE);
      cx.restore();
      cx.globalAlpha = 1;
    }
  }

  const gp = ghostAt(race.time);
  if (gp) {
    const rival = ghost.rival;
    // a rival is rose, your own ghost ice; the HUD's "vs" line carries the name
    drawCar(gp.x, gp.y, gp.a, rival ? COLOR.rivalBody : COLOR.ghostBody, rival ? COLOR.rivalGlow : COLOR.ghostGlow, true,
      rival ? NEON : carById(garage.car));
  }

  if (track.wet) {   // the underglow on wet asphalt: a soft pool under the car
    cx.fillStyle = car.boosting ? "rgba(255,197,61,.10)" : "rgba(47,227,255,.08)";
    cx.beginPath(); cx.ellipse(rx, ry, 34 * CAR_SCALE, 22 * CAR_SCALE, ra, 0, Math.PI * 2); cx.fill();
  }
  drawPlume();
  drawSpray();
  drawCar(rx, ry, ra, COLOR.paper, car.boosting ? COLOR.amber : COLOR.ice, false, carById(garage.car));
  cx.restore();

  if (track.wet) {
    const n = rainCount(W, H);
    if (!rain || rain.drops.length !== n * 3) rain = createRain(n);
    // camera velocity in screen px/s, so the drops drift against the motion
    const vx = dt > 0 ? (camera.x - camPX) * camera.z / dt : 0, vy = dt > 0 ? (camera.y - camPY) * camera.z / dt : 0;
    stepRain(rain, W, H, Math.min(dt, 0.05), vx, vy);
    drawRain(cx, rain);
  }
  camPX = camera.x; camPY = camera.y;

  if (car.off) { cx.fillStyle = COLOR.offTint; cx.fillRect(0, 0, W, H); }
}

function drawGrid(bx0, bx1, by0, by1) {
  cx.lineWidth = 1 / camera.z; cx.strokeStyle = COLOR.grid; cx.beginPath();
  for (let gx = Math.floor(bx0 / GRID) * GRID; gx < bx1; gx += GRID) { cx.moveTo(gx, by0); cx.lineTo(gx, by1); }
  for (let gy = Math.floor(by0 / GRID) * GRID; gy < by1; gy += GRID) { cx.moveTo(bx0, gy); cx.lineTo(bx1, gy); }
  cx.stroke();
}

function drawRoad(runs) {
  cx.lineCap = "round"; cx.lineJoin = "round";
  cx.strokeStyle = track.wet ? COLOR.roadWet : COLOR.road; cx.lineWidth = track.halfW * 2;
  for (const run of runs) {
    if (run.length < 2) continue;
    cx.beginPath(); cx.moveTo(run[0].x, run[0].y);
    for (let i = 1; i < run.length; i++) cx.lineTo(run[i].x, run[i].y);
    cx.stroke();
  }
}

function drawTireMarks(inView) {
  const marks = race.marks;
  if (!marks.length) return;
  cx.lineWidth = 8 * CAR_SCALE; cx.strokeStyle = track.wet ? COLOR.tireMarkWet : COLOR.tireMark; cx.beginPath();
  for (const m of marks) {
    if (!inView(m.x, m.y)) continue;
    const nx = -Math.sin(m.a) * 11 * CAR_SCALE, ny = Math.cos(m.a) * 11 * CAR_SCALE;
    cx.moveTo(m.x + nx, m.y + ny); cx.lineTo(m.x + nx * 0.2, m.y + ny * 0.2);
    cx.moveTo(m.x - nx, m.y - ny); cx.lineTo(m.x - nx * 0.2, m.y - ny * 0.2);
  }
  cx.stroke();
}

function drawEdges(runs) {
  if (track.wet) {
    cx.globalAlpha = 0.07; cx.lineWidth = 46;
    for (const [sign, col] of EDGES) {
      cx.strokeStyle = col;
      for (const run of runs) {
        if (run.length < 2) continue;
        cx.beginPath();
        for (let i = 0; i < run.length; i++) {
          const s = run[i], o = (track.halfW - 20) * sign, X = s.x + s.nx * o, Y = s.y + s.ny * o;
          i ? cx.lineTo(X, Y) : cx.moveTo(X, Y);
        }
        cx.stroke();
      }
    }
    cx.globalAlpha = 1;
  }
  cx.lineWidth = 4;
  for (const [sign, col] of EDGES) {
    cx.strokeStyle = col; cx.shadowColor = col; cx.shadowBlur = 18;
    for (const run of runs) {
      if (run.length < 2) continue;
      cx.beginPath();
      for (let i = 0; i < run.length; i++) {
        const s = run[i], X = s.x + s.nx * track.halfW * sign, Y = s.y + s.ny * track.halfW * sign;
        i ? cx.lineTo(X, Y) : cx.moveTo(X, Y);
      }
      cx.stroke();
    }
  }
  cx.shadowBlur = 0;
}

function drawGuide(s, col, dashed) {
  cx.save();
  cx.strokeStyle = col; cx.lineWidth = 4; cx.shadowColor = col; cx.shadowBlur = 14;
  if (dashed) cx.setLineDash([15, 11]);
  cx.beginPath();
  cx.moveTo(s.x + s.nx * track.halfW, s.y + s.ny * track.halfW);
  cx.lineTo(s.x - s.nx * track.halfW, s.y - s.ny * track.halfW);
  cx.stroke();
  cx.restore();
}

// Optimal-line markers. Only holds long enough to break traction (a real
// drift) are shown: a line across the road plus a dot where the car was, green
// to press, white dashed to release. Short steering taps are in the data too
// but deliberately not drawn — they cluttered the corners.
function drawLineMarkers(S, inView) {
  const lap = clamp(car.lap, 1, LAPS);
  for (const m of line.markers) {
    if (!m.long || m.lap !== lap || !inView(m.x, m.y)) continue;
    const col = m.type === "press" ? COLOR.guideEntry : COLOR.paper;
    drawGuide(S[m.idx], col, m.type === "release");
    cx.fillStyle = col; cx.shadowColor = col; cx.shadowBlur = 12;
    cx.beginPath(); cx.arc(m.x, m.y, 7, 0, Math.PI * 2); cx.fill();
    cx.shadowBlur = 0;
  }
}

function drawStartLine(s0) {
  cx.save(); cx.translate(s0.x, s0.y); cx.rotate(Math.atan2(s0.ty, s0.tx));
  cx.fillStyle = COLOR.startLine; cx.fillRect(-5, -track.halfW, 10, track.halfW * 2);
  cx.restore();
}

// Tapered exhaust plume along the path actually travelled (see physics.js).
function drawPlume() {
  const trail = race.trail;
  if (trail.length < 2) return;
  cx.lineCap = "round"; cx.lineJoin = "round";
  for (let pass = 0; pass < 2; pass++) {           // wide soft pass, then a tight bright core
    const wide = pass === 0;
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      if (!b.hot) continue;
      const t = i / (trail.length - 1);            // 0 at the tail, 1 at the tailpipe
      const life = clamp(b.l, 0, 1);
      const op = (wide ? 0.16 : 0.5) * life * life * t;
      if (op < 0.01) continue;
      cx.strokeStyle = "rgba(255,197,61," + op.toFixed(3) + ")";
      cx.lineWidth = (3 + 16 * t) * (wide ? 2.4 : 1) * CAR_SCALE;
      cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke();
    }
  }
}

// Wet-road mist from the rear wheels (see physics.js): soft pale puffs that grow as they fade.
function drawSpray() {
  for (const s of race.spray) {
    const life = Math.max(0, s.l);
    cx.fillStyle = "rgba(" + COLOR.spray + "," + (0.10 * life).toFixed(3) + ")";
    cx.beginPath(); cx.arc(s.x, s.y, (8 + 22 * (1 - life)) * CAR_SCALE, 0, Math.PI * 2); cx.fill();
  }
}

// Every car goes through the garage's catalogue at CAR_SCALE. A ghost is its
// outline only, in its tint; your car gets the details (glass, lights).
const NEON = carById("neon");
function drawCar(x, y, a, body, glow, isGhost, shape) {
  cx.save(); cx.translate(x, y); cx.rotate(a); cx.scale(CAR_SCALE, CAR_SCALE);
  drawCarShape(cx, shape, { body, glow, blur: isGhost ? 10 : 26, details: !isGhost });
  cx.restore();
}

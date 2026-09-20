// Canvas rendering. draw() is called once per animation frame with the frame
// time and an interpolation factor between the last two physics steps.

import { $ } from "../core/dom.js";
import { clamp, lerp, wrapAngle } from "../core/math.js";
import { ROAD_W, HALF_W, LAPS } from "../config/tuning.js";
import { track } from "../track/track.js";
import { guides } from "../track/guides.js";
import { line } from "../sim/line.js";
import { car, race } from "../game/state.js";
import { ghostAt } from "../game/ghost.js";
import { camera, updateCamera } from "./camera.js";

const COLOR = {
  void: "#05060b", grid: "#101a2e", road: "#0a0d18",
  ice: "#2fe3ff", rose: "#ff2f9e", amber: "#ffc53d", paper: "#e8f0ff",
  guideEntry: "#49ff9e",
  tireMark: "rgba(165,190,245,.16)",
  startLine: "rgba(232,240,255,.16)",
  ghostBody: "rgba(47,227,255,.30)", ghostGlow: "rgba(47,227,255,.07)",
  offTint: "rgba(255,47,158,.10)",
};
const EDGES = [[1, COLOR.ice], [-1, COLOR.rose]];   // [side, colour]
const GRID = 260;

const stage = $("stage");
const canvas = $("c");
const cx = canvas.getContext("2d");
let W = 0, H = 0, DPR = 1;

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

  const gp = ghostAt(race.time);
  if (gp) drawCar(gp.x, gp.y, gp.a, COLOR.ghostBody, COLOR.ghostGlow, true);

  drawPlume();
  drawCar(rx, ry, ra, COLOR.paper, car.boosting ? COLOR.amber : COLOR.ice, false);
  cx.restore();

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
  cx.strokeStyle = COLOR.road; cx.lineWidth = ROAD_W;
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
  cx.lineWidth = 8; cx.strokeStyle = COLOR.tireMark; cx.beginPath();
  for (const m of marks) {
    if (!inView(m.x, m.y)) continue;
    const nx = -Math.sin(m.a) * 11, ny = Math.cos(m.a) * 11;
    cx.moveTo(m.x + nx, m.y + ny); cx.lineTo(m.x + nx * 0.2, m.y + ny * 0.2);
    cx.moveTo(m.x - nx, m.y - ny); cx.lineTo(m.x - nx * 0.2, m.y - ny * 0.2);
  }
  cx.stroke();
}

function drawEdges(runs) {
  cx.lineWidth = 4;
  for (const [sign, col] of EDGES) {
    cx.strokeStyle = col; cx.shadowColor = col; cx.shadowBlur = 18;
    for (const run of runs) {
      if (run.length < 2) continue;
      cx.beginPath();
      for (let i = 0; i < run.length; i++) {
        const s = run[i], X = s.x + s.nx * HALF_W * sign, Y = s.y + s.ny * HALF_W * sign;
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
  cx.moveTo(s.x + s.nx * HALF_W, s.y + s.ny * HALF_W);
  cx.lineTo(s.x - s.nx * HALF_W, s.y - s.ny * HALF_W);
  cx.stroke();
  cx.restore();
}

// Optimal-line markers. A long hold (a real drift) gets a line across the road
// plus a dot where the car was: green to press, white dashed to release. Short
// steering taps are just small dots so they don't drown the corners out.
function drawLineMarkers(S, inView) {
  const lap = clamp(car.lap, 1, LAPS);
  for (const m of line.markers) {
    if (m.lap !== lap || !inView(m.x, m.y)) continue;
    const col = m.type === "press" ? COLOR.guideEntry : COLOR.paper;
    if (m.long) {
      drawGuide(S[m.idx], col, m.type === "release");
      cx.fillStyle = col; cx.shadowColor = col; cx.shadowBlur = 12;
      cx.beginPath(); cx.arc(m.x, m.y, 7, 0, Math.PI * 2); cx.fill();
      cx.shadowBlur = 0;
    } else {
      cx.globalAlpha = 0.55; cx.fillStyle = col;
      cx.beginPath(); cx.arc(m.x, m.y, 3.5, 0, Math.PI * 2); cx.fill();
      cx.globalAlpha = 1;
    }
  }
}

function drawStartLine(s0) {
  cx.save(); cx.translate(s0.x, s0.y); cx.rotate(Math.atan2(s0.ty, s0.tx));
  cx.fillStyle = COLOR.startLine; cx.fillRect(-5, -HALF_W, 10, ROAD_W);
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
      cx.lineWidth = (3 + 16 * t) * (wide ? 2.4 : 1);
      cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke();
    }
  }
}

function drawCar(x, y, a, body, glow, isGhost) {
  cx.save(); cx.translate(x, y); cx.rotate(a);
  cx.shadowColor = glow; cx.shadowBlur = isGhost ? 10 : 26;
  cx.fillStyle = body;
  cx.beginPath();
  cx.moveTo(24, 0); cx.lineTo(4, 11); cx.lineTo(-20, 9);
  cx.lineTo(-20, -9); cx.lineTo(4, -11); cx.closePath(); cx.fill();
  cx.shadowBlur = 0;
  if (!isGhost) { cx.fillStyle = "rgba(5,6,11,.65)"; cx.fillRect(-6, -6, 11, 12); }
  cx.restore();
}

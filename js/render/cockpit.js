// The race from the driver's seat. Every world primitive is a polygon in world
// space (x, y on the ground, z up), turned into camera space, clipped to the near
// plane, projected, and painted far to near. Painting by distance is safe here
// because drift layouts reject any two stretches of road closer than 420px, so the
// road never passes over itself.

import { clamp } from "../core/math.js";
import { COCKPIT, CAR_SCALE } from "../config/tuning.js";
import { track } from "../track/track.js";
import { car, race } from "../game/state.js";
import { ghost, ghostAt } from "../game/ghost.js";
import { peers, peerPose } from "../game/peers.js";
import { makeCam, toCam, clipPoly, clipSeg, project, NEAR } from "./project.js";
import { head } from "./head.js";
import { carById, garage } from "./cars.js";
import { drawInterior } from "./interior.js";

const COLOR = {
  void: "#05060b", ground: "#070912", grid: "#1a2a4a",
  road: "#0c1020", roadWet: "#080a16",
  dash: "rgba(232,240,255,.16)", startLine: "rgba(232,240,255,.22)",
  ghost: "rgba(47,227,255,.30)", rival: "rgba(255,47,158,.45)", peer: "255,197,61", label: "232,240,255",
};
// side → [bright top edge, translucent face]; the same sides as the top-down edges
const EDGE = { 1: ["#2fe3ff", "rgba(47,227,255,.22)"], [-1]: ["#ff2f9e", "rgba(255,47,158,.22)"] };
const GRID = 260;

export function drawCockpit(cx, W, H, rx, ry, ra) {
  const shake = race.shake * 10;
  const cam = makeCam(head.ex, head.ey, head.h, COCKPIT.eye, head.focal,
    W / 2 + (Math.random() - 0.5) * shake, head.hy + (Math.random() - 0.5) * shake);

  drawSky(cx, W, H, cam);
  drawGrid(cx, cam);
  const prims = [];
  addTrack(prims, cam, W);
  addStartLine(prims, cam);
  addCars(prims, cam);
  paint(cx, cam, prims);
  drawLabels(cx, cam);

  // The car: the world stays level while the car (bonnet and cabin) tilts and
  // sways with the sideways force, about the bottom centre of the screen — the
  // seat. Turning right pushes the body out to the left: its left side drops
  // (an anticlockwise tilt) and the cabin slides right under the eye.
  cx.save();
  cx.translate(cam.cx, H);
  cx.rotate(-head.g * COCKPIT.roll * Math.PI / 180);
  cx.translate(-cam.cx + head.g * COCKPIT.sway * W, -H);
  drawBonnet(cx, cam, rx, ry, head.carA);
  drawInterior(cx, W, H, cam, ra);
  cx.restore();
}

function drawSky(cx, W, H, cam) {
  cx.fillStyle = COLOR.void; cx.fillRect(0, 0, W, H);
  const top = cam.hy - H * 0.25;
  const g = cx.createLinearGradient(0, top, 0, cam.hy + 2);
  g.addColorStop(0, "rgba(47,227,255,0)"); g.addColorStop(1, "rgba(47,227,255,.10)");
  cx.fillStyle = g; cx.fillRect(0, top, W, H * 0.25);
  cx.fillStyle = COLOR.ground; cx.fillRect(0, cam.hy, W, H - cam.hy);
}

function drawGrid(cx, cam) {
  const R = COCKPIT.range * 0.8;
  cx.strokeStyle = COLOR.grid; cx.lineWidth = 1; cx.beginPath();
  const seg = (ax, ay, bx, by) => {
    const s = clipSeg(toCam(cam, ax, ay, 0), toCam(cam, bx, by, 0));
    if (!s) return;
    const a = project(cam, s[0]), b = project(cam, s[1]);
    cx.moveTo(a[0], a[1]); cx.lineTo(b[0], b[1]);
  };
  for (let gx = Math.floor((cam.x - R) / GRID) * GRID; gx < cam.x + R; gx += GRID) seg(gx, cam.y - R, gx, cam.y + R);
  for (let gy = Math.floor((cam.y - R) / GRID) * GRID; gy < cam.y + R; gy += GRID) seg(cam.x - R, gy, cam.x + R, gy);
  cx.stroke();
}

// Road, rails and centre dashes: one road quad and two rail quads per step along
// the centreline. Steps are one sample (12px) near the car and coarser further
// out; anything past the draw distance, behind the eye, or well outside the view
// is skipped.
function addTrack(prims, cam, W) {
  const S = track.samples, N = S.length, hw = track.halfW, R2 = COCKPIT.range ** 2;
  const half = (W / 2) / cam.focal, margin = hw + 60;
  const d2 = s => (s.x - cam.x) ** 2 + (s.y - cam.y) ** 2;
  const road = track.wet ? COLOR.roadWet : COLOR.road;
  const L = (s, side, z) => toCam(cam, s.x + s.nx * hw * side, s.y + s.ny * hw * side, z);
  for (let i = 0; i < N;) {
    const s = S[i], near = d2(s);
    const step = near < 900 * 900 ? 1 : near < 2200 * 2200 ? 2 : 4;
    const j = Math.min(i + step, N), t = S[j % N];
    const first = i;
    i = j;
    if (near > R2 && d2(t) > R2) continue;
    const cs = toCam(cam, s.x, s.y, 0), ct = toCam(cam, t.x, t.y, 0);
    if (cs[1] < NEAR && ct[1] < NEAR) continue;
    if (cs[1] > 0 && ct[1] > 0 && Math.sign(cs[0]) === Math.sign(ct[0])
      && Math.abs(cs[0]) > cs[1] * half + margin && Math.abs(ct[0]) > ct[1] * half + margin) continue;
    const k = Math.hypot((cs[0] + ct[0]) / 2, (cs[1] + ct[1]) / 2);
    prims.push({ k, poly: [L(s, 1, 0), L(t, 1, 0), L(t, -1, 0), L(s, -1, 0)], fill: road });
    if (first % 24 < 3) {   // a centre dash every ~290px: something to rush past
      const C = (p, o) => toCam(cam, p.x + p.nx * o, p.y + p.ny * o, 0.2);
      prims.push({ k: k - 0.5, poly: [C(s, 5), C(t, 5), C(t, -5), C(s, -5)], fill: COLOR.dash });
    }
    for (const side of [1, -1]) {
      prims.push({ k: k - 1, poly: [L(s, side, 0), L(t, side, 0), L(t, side, COCKPIT.rail), L(s, side, COCKPIT.rail)],
        fill: EDGE[side][1], top: EDGE[side][0] });
    }
  }
}

function addStartLine(prims, cam) {
  const s0 = track.samples[0], hw = track.halfW;
  const d = Math.hypot(s0.x - cam.x, s0.y - cam.y);
  if (d > COCKPIT.range) return;
  const a = Math.atan2(s0.ty, s0.tx), ca = Math.cos(a), sa = Math.sin(a);
  const P = (u, v) => toCam(cam, s0.x + ca * u - sa * v, s0.y + sa * u + ca * v, 0.1);
  prims.push({ k: d - 2, poly: [P(-5, -hw), P(5, -hw), P(5, hw), P(-5, hw)], fill: COLOR.startLine });
}

function paint(cx, cam, prims) {
  prims.sort((a, b) => b.k - a.k);
  cx.lineJoin = "round";
  for (const p of prims) {
    const poly = clipPoly(p.poly);
    if (!poly) continue;
    cx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      const q = project(cam, poly[i]);
      i ? cx.lineTo(q[0], q[1]) : cx.moveTo(q[0], q[1]);
    }
    cx.closePath();
    if (p.fill) { cx.fillStyle = p.fill; cx.fill(); }
    if (p.stroke) { cx.strokeStyle = p.stroke; cx.lineWidth = 1; cx.stroke(); }
    if (p.top) {   // a rail's bright top edge: its last two vertices, clipped on their own
      const s = clipSeg(p.poly[3], p.poly[2]);
      if (s) {
        const a = project(cam, s[0]), b = project(cam, s[1]);
        cx.strokeStyle = p.top; cx.lineWidth = clamp(900 / Math.max(p.k, 40), 1, 6);
        cx.beginPath(); cx.moveTo(a[0], a[1]); cx.lineTo(b[0], b[1]); cx.stroke();
      }
    }
  }
}

const NEON = carById("neon");

// A car as a low wedge: length from the garage shape's nose and tail, 30px wide,
// the nose narrower and lower. Translucent faces and a glowing outline, in the
// same tint the top-down view uses. Rivals and peers are Neon, as top-down.
function addCar(prims, cam, x, y, a, shape, col) {
  const c = toCam(cam, x, y, 0);
  if (c[1] < NEAR || c[1] > COCKPIT.range) return;
  const ca = Math.cos(a), sa = Math.sin(a);
  const P = (u, v, z) => toCam(cam, x + ca * u - sa * v, y + sa * u + ca * v, z);
  const f = shape.front * CAR_SCALE, r = shape.rear * CAR_SCALE;   // rear is negative
  const wr = 15, wf = 9, hr = 16, hf = 10;                          // half-widths and heights, tail and nose
  const k = Math.hypot(c[0], c[1]) - 3;
  const faces = [
    [P(r, -wr, 0), P(r, wr, 0), P(r, wr, hr), P(r, -wr, hr)],       // tail
    [P(r, wr, 0), P(f, wf, 0), P(f, wf, hf), P(r, wr, hr)],         // right side
    [P(r, -wr, 0), P(f, -wf, 0), P(f, -wf, hf), P(r, -wr, hr)],     // left side
    [P(f, -wf, 0), P(f, wf, 0), P(f, wf, hf), P(f, -wf, hf)],       // nose
    [P(r, -wr, hr), P(f, -wf, hf), P(f, wf, hf), P(r, wr, hr)],     // roof
  ];
  for (const poly of faces) prims.push({ k, poly, fill: col, stroke: col });
}

function addCars(prims, cam) {
  const gp = ghostAt(race.time);
  if (gp) {
    if (ghost.rival) addCar(prims, cam, gp.x, gp.y, gp.a, NEON, COLOR.rival);
    else addCar(prims, cam, gp.x, gp.y, gp.a, carById(garage.car), COLOR.ghost);
  }
  if (!peers.size) return;
  const now = performance.now();
  for (const p of peers.values()) {
    const q = peerPose(p, now);
    if (q) addCar(prims, cam, q.x, q.y, q.a, NEON, "rgba(" + COLOR.peer + "," + (0.28 * q.alpha).toFixed(3) + ")");
  }
}

// Live name labels: above each peer, a fixed screen size, fading with distance
// and with the peer's own fade.
function drawLabels(cx, cam) {
  if (!peers.size) return;
  const now = performance.now();
  cx.font = "600 11px 'Chakra Petch', system-ui, sans-serif"; cx.textAlign = "center"; cx.textBaseline = "alphabetic";
  for (const p of peers.values()) {
    const q = peerPose(p, now);
    if (!q) continue;
    const c = toCam(cam, q.x, q.y, 34);
    if (c[1] < NEAR * 4 || c[1] > COCKPIT.range) continue;
    const s = project(cam, c);
    const a = q.alpha * clamp(1 - c[1] / COCKPIT.range, 0.2, 1) * 0.55;
    cx.fillStyle = "rgba(" + COLOR.label + "," + a.toFixed(3) + ")";
    cx.fillText(p.name + "#" + p.tag, s[0], s[1]);
  }
}

// The bonnet, in 3D and fixed to the car at its drawn angle, so it points where
// the nose points while the head looks down the road. Car-local u (forward), v
// (right), z (up) from the car's centre; the nose is at u ≈ 37.5 (24 × CAR_SCALE).
// Its rear sits under the dash, drawn over it. A rounded nose, two creases, and a
// stripe along the driver's line (v = seat), so it runs parallel to the view.
const BONNET = [[4, -18, 15], [26, -15.5, 13], [33, -13, 12.4], [36, -9, 12.1], [37.5, -3, 12],
  [37.5, 3, 12], [36, 9, 12.1], [33, 13, 12.4], [26, 15.5, 13], [4, 18, 15]];

function drawBonnet(cx, cam, rx, ry, a) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const B = ([u, v, z]) => toCam(cam, rx + ca * u - sa * v, ry + sa * u + ca * v, z);
  const poly = clipPoly(BONNET.map(B));
  if (!poly) return;
  const pts = poly.map(p => project(cam, p));
  let top = Infinity, bot = -Infinity;
  for (const p of pts) { top = Math.min(top, p[1]); bot = Math.max(bot, p[1]); }
  cx.beginPath();
  pts.forEach((p, i) => i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1]));
  cx.closePath();
  const g = cx.createLinearGradient(0, top, 0, bot);
  g.addColorStop(0, "#2a3456"); g.addColorStop(1, "#161c30");   // lit toward the nose
  cx.fillStyle = g; cx.fill();
  cx.lineJoin = "round";
  cx.strokeStyle = car.boosting ? "#ffc53d" : "#2fe3ff"; cx.globalAlpha = 0.6; cx.lineWidth = 2; cx.stroke();
  cx.globalAlpha = 1;
  const line = (a3, b3, col, w) => {
    const s = clipSeg(B(a3), B(b3));
    if (!s) return;
    const p = project(cam, s[0]), q = project(cam, s[1]);
    cx.strokeStyle = col; cx.lineWidth = w;
    cx.beginPath(); cx.moveTo(p[0], p[1]); cx.lineTo(q[0], q[1]); cx.stroke();
  };
  for (const v of [-10, 10]) line([4, v * 1.15, 15.3], [34, v * 0.8, 12.6], "rgba(232,240,255,.16)", 1.5);
  line([4, COCKPIT.seat, 15.4], [36.8, COCKPIT.seat, 12.2], "#ff2f9e", 3);
}

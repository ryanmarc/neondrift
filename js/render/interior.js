// The cabin, in screen space: roof header, mirror, A-pillars, dash, instrument
// hood and cluster, gauges, wheel. Sculpted neon: curved forms, slate gradients,
// thin lit edges in the boost colour. Everything fixed to the car is placed by its
// angle from the car's drawn nose, at cam.cx + tan(angle − d) · focal, where d is
// the view's turn off the drawn car (render/head.js) — so the whole cabin moves
// as one body. The caller (cockpit.js) has already applied body roll.

import { clamp, wrapAngle } from "../core/math.js";
import { COCKPIT } from "../config/tuning.js";
import { car, race } from "../game/state.js";
import { chainReadout } from "../game/chain.js";
import { head } from "./head.js";

const SLATE = "#232b46", SLATE_LO = "#161c30", SLATE_HI = "#2e3857", WHEEL = "#2c3558";
const FACE = "#0c1122", VENT = "#0e1324";
const ICE = "#2fe3ff", AMBER = "#ffc53d", ROSE = "#ff2f9e", PAPER = "#e8f0ff";
const FONT = "px 'Chakra Petch', system-ui, sans-serif";

export function drawInterior(cx, W, H, cam, raTrue) {
  const d = wrapAngle(head.h - head.carA);
  const at = ang => { const q = ang - d; return Math.abs(q) < 1.4 ? cam.cx + Math.tan(q) * cam.focal : (q > 0 ? W * 3 : -W * 2); };
  const noseX = at(0);                   // straight ahead of the seat: the wheel and cluster sit here
  const glow = car.boosting ? AMBER : ICE;
  const wr = head.wr;                    // wheel radius: the unit the dash is laid out in
  let g;

  // --- roof header: an arc that dips toward the corners, lit along its lower edge
  const roofMid = H * 0.035, roofEdge = H * 0.12, roofCtl = roofMid * 2 - roofEdge * 0.35;
  const roofAt = x => { const t = (x - cam.cx) / (W * 0.6); return roofMid + (roofEdge - roofMid) * Math.min(1, t * t); };
  cx.beginPath();
  cx.moveTo(-W, -H); cx.lineTo(W * 2, -H); cx.lineTo(W * 2, roofEdge);
  cx.quadraticCurveTo(cam.cx, roofCtl, -W, roofEdge);
  cx.closePath();
  g = cx.createLinearGradient(0, 0, 0, roofEdge);
  g.addColorStop(0, SLATE_LO); g.addColorStop(1, SLATE);
  cx.fillStyle = g; cx.fill();
  cx.strokeStyle = glow; cx.globalAlpha = 0.35; cx.lineWidth = 1.5;
  cx.beginPath(); cx.moveTo(W * 2, roofEdge); cx.quadraticCurveTo(cam.cx, roofCtl, -W, roofEdge); cx.stroke();
  cx.globalAlpha = 1;

  // --- rear-view mirror: on the car's centreline, so right of a left-hand seat. Shape only in v1.
  {
    const mx = at(Math.atan2(-COCKPIT.seat, 18)), my = H * 0.075, mw = Math.min(W, H) * 0.30, mh = H * 0.055;
    cx.strokeStyle = SLATE_LO; cx.lineWidth = 5;
    cx.beginPath(); cx.moveTo(mx, roofAt(mx) - 4); cx.lineTo(mx, my); cx.stroke();
    cx.beginPath(); cx.roundRect(mx - mw / 2, my, mw, mh, mh / 2);
    cx.fillStyle = SLATE_LO; cx.fill();
    cx.strokeStyle = "rgba(232,240,255,.18)"; cx.lineWidth = 1.5; cx.stroke();
    cx.beginPath(); cx.roundRect(mx - mw / 2 + 4, my + 4, mw - 8, mh - 8, (mh - 8) / 2);
    g = cx.createLinearGradient(mx - mw / 2, my, mx + mw / 2, my + mh);
    g.addColorStop(0, "#0b1022"); g.addColorStop(0.55, "#141d38"); g.addColorStop(1, "#0b1022");
    cx.fillStyle = g; cx.fill();
  }

  // --- the dash's cowl line: the base of the windscreen
  const cowlY = H * 0.80;
  const cowlAt = x => cowlY + H * 0.03 * Math.min(1, ((x - noseX) / (W * 0.9)) ** 2);

  // --- A-pillars: each a windscreen corner (±15px, `pillar`° off the nose from a
  // centred seat) seen from the actual seat, so the near one sits wider and looks
  // thicker; tapered, bowed outward, shaded across, lit on the glass-facing edge
  const PHW = 15, pu = PHW / Math.tan(COCKPIT.pillar * Math.PI / 180), d0 = Math.hypot(PHW, pu);
  for (const sg of [-1, 1]) {
    const pv = sg * PHW - COCKPIT.seat, pAng = Math.atan2(pv, pu), near = d0 / Math.hypot(pv, pu);
    const xt = at(pAng), xb = at(pAng + sg * 0.20);
    const wt = H * 0.03 * near, wb = H * 0.075 * near;
    const yt = roofAt(xt) - 6, yb = cowlAt(xb) + 6, ym = (yt + yb) / 2;
    const bow = sg * wb * 0.35;
    const inner = [xt - sg * wt / 2, xb - sg * wb / 2], outer = [xt + sg * wt / 2, xb + sg * wb / 2];
    cx.beginPath();
    cx.moveTo(inner[0], yt);
    cx.quadraticCurveTo((inner[0] + inner[1]) / 2 + bow, ym, inner[1], yb);
    cx.lineTo(outer[1], yb);
    cx.quadraticCurveTo((outer[0] + outer[1]) / 2 + bow, ym, outer[0], yt);
    cx.closePath();
    g = cx.createLinearGradient(inner[1], 0, outer[1], 0);
    g.addColorStop(0, SLATE_HI); g.addColorStop(1, SLATE_LO);
    cx.fillStyle = g; cx.fill();
    cx.strokeStyle = glow; cx.globalAlpha = 0.35; cx.lineWidth = 1.5;
    cx.beginPath(); cx.moveTo(inner[0], yt);
    cx.quadraticCurveTo((inner[0] + inner[1]) / 2 + bow, ym, inner[1], yb); cx.stroke();
    cx.globalAlpha = 1;
  }

  // --- dash: the cowl surface (drawn past the screen's bottom and sides, so body
  // roll never lifts a gap), a console crease toward the passenger side, two vents
  const cowlPath = () => { for (let x = -W; x <= W * 2; x += W / 16) x === -W ? cx.moveTo(x, cowlAt(x)) : cx.lineTo(x, cowlAt(x)); };
  cx.beginPath(); cowlPath(); cx.lineTo(W * 2, H * 2); cx.lineTo(-W, H * 2); cx.closePath();
  g = cx.createLinearGradient(0, cowlY, 0, H);
  g.addColorStop(0, SLATE); g.addColorStop(1, SLATE_LO);
  cx.fillStyle = g; cx.fill();
  cx.strokeStyle = glow; cx.globalAlpha = 0.6; cx.lineWidth = 2;
  cx.beginPath(); cowlPath(); cx.stroke();
  cx.globalAlpha = 1;
  cx.strokeStyle = "rgba(232,240,255,.12)"; cx.lineWidth = 1.5;
  cx.beginPath(); cx.moveTo(noseX + wr * 1.25, cowlY + H * 0.05);
  cx.quadraticCurveTo(noseX + wr * 2.2, cowlY + H * 0.06, W * 1.3, H * 1.02); cx.stroke();
  for (const k of [1.6, 2.05]) {
    const vx = noseX + wr * k, vy = cowlY + H * 0.085, vw = wr * 0.32, vh = H * 0.028;
    cx.beginPath(); cx.roundRect(vx - vw / 2, vy, vw, vh, vh / 2);
    cx.fillStyle = VENT; cx.fill();
    cx.strokeStyle = "rgba(47,227,255,.20)"; cx.lineWidth = 1; cx.stroke();
    for (let i = 1; i < 4; i++) {
      const yy = vy + vh * i / 4;
      cx.beginPath(); cx.moveTo(vx - vw / 2 + 5, yy); cx.lineTo(vx + vw / 2 - 5, yy); cx.stroke();
    }
  }

  // --- the instrument hood: an arch in front of the driver, and the cluster's
  // recessed face under it, running down behind the wheel
  const hoodW = wr * 1.25, hoodTop = cowlY - H * 0.10, hoodBase = cowlAt(noseX) + H * 0.005;
  const hoodPath = () => {
    cx.moveTo(noseX - hoodW, hoodBase);
    cx.bezierCurveTo(noseX - hoodW * 0.85, hoodTop, noseX + hoodW * 0.85, hoodTop, noseX + hoodW, hoodBase);
  };
  cx.beginPath(); hoodPath(); cx.closePath();
  g = cx.createLinearGradient(0, hoodTop, 0, hoodBase);
  g.addColorStop(0, SLATE_HI); g.addColorStop(1, SLATE);
  cx.fillStyle = g; cx.fill();
  cx.strokeStyle = glow; cx.globalAlpha = 0.6; cx.lineWidth = 2;
  cx.beginPath(); hoodPath(); cx.stroke();
  cx.globalAlpha = 1;
  cx.beginPath(); cx.roundRect(noseX - hoodW * 0.92, hoodBase - H * 0.005, hoodW * 1.84, H * 2, H * 0.03);
  cx.fillStyle = FACE; cx.fill();

  // --- gauges, in the wheel's open upper half and clear of the rim: centres 0.69
  // wr from the hub, 0.2 wr across, inside the rim's ~0.91 wr inner edge
  const wy = H + wr * 0.22;
  const P = race.params, gr = wr * 0.2, gy = wy - wr * 0.55;
  drawBoostGauge(cx, noseX - wr * 0.42, gy, gr, clamp(car.boost / P.boostCap, 0, 1), car.boosting);
  drawChainGauge(cx, noseX + wr * 0.42, gy, gr, P.multCap);
  {
    // slip: the true angle between travel and nose, whatever the drawn car shows
    const slip = wrapAngle(Math.atan2(car.vy, car.vx) - raTrue);
    const sx = noseX, sy = wy - wr * 0.72, sr = wr * 0.11;
    cx.strokeStyle = "rgba(232,240,255,.25)"; cx.lineWidth = 2;
    cx.beginPath(); cx.arc(sx, sy, sr, Math.PI, 0); cx.stroke();
    const na = -Math.PI / 2 + clamp(Math.hypot(car.vx, car.vy) > 60 ? slip : 0, -1.4, 1.4);
    cx.strokeStyle = glow; cx.lineWidth = 2.5;
    cx.beginPath(); cx.moveTo(sx, sy); cx.lineTo(sx + Math.cos(na) * sr, sy + Math.sin(na) * sr); cx.stroke();
  }

  drawWheel(cx, noseX, wy, wr, glow);
}

// A thick D (flat along the bottom), three spokes, a hub with a rose emblem, a
// rose top-dead-centre marker. Turned by head.wheel.
function drawWheel(cx, wx, wy, wr, glow) {
  const flat = 0.62;                     // half-angle of the flat bottom (rad)
  const rimPath = r => {
    cx.beginPath();
    cx.arc(0, 0, r, Math.PI / 2 + flat, Math.PI / 2 - flat + Math.PI * 2);
    cx.closePath();                      // the chord is the flat bottom
  };
  cx.save(); cx.translate(wx, wy); cx.rotate(head.wheel);
  cx.strokeStyle = WHEEL; cx.lineCap = "round"; cx.lineWidth = wr * 0.15;
  cx.beginPath();
  cx.moveTo(-wr * 0.92, wr * 0.05); cx.lineTo(-wr * 0.2, wr * 0.12);
  cx.moveTo(wr * 0.92, wr * 0.05); cx.lineTo(wr * 0.2, wr * 0.12);
  cx.moveTo(0, wr * 0.3); cx.lineTo(0, wr * 0.75);
  cx.stroke();
  cx.beginPath(); cx.roundRect(-wr * 0.26, -wr * 0.08, wr * 0.52, wr * 0.4, wr * 0.12);
  const g = cx.createLinearGradient(0, -wr * 0.08, 0, wr * 0.32);
  g.addColorStop(0, SLATE_HI); g.addColorStop(1, SLATE_LO);
  cx.fillStyle = g; cx.fill();
  cx.strokeStyle = "rgba(232,240,255,.18)"; cx.lineWidth = 1.5; cx.stroke();
  cx.fillStyle = ROSE; cx.beginPath(); cx.arc(0, wr * 0.1, wr * 0.045, 0, Math.PI * 2); cx.fill();
  cx.lineCap = "butt";
  rimPath(wr); cx.strokeStyle = WHEEL; cx.lineWidth = wr * 0.17; cx.stroke();
  rimPath(wr * 0.94); cx.strokeStyle = SLATE_LO; cx.lineWidth = wr * 0.04; cx.stroke();
  rimPath(wr * 1.085); cx.strokeStyle = glow; cx.globalAlpha = 0.55; cx.lineWidth = 1.5; cx.stroke();
  cx.globalAlpha = 1;
  cx.fillStyle = ROSE; cx.fillRect(-3.5, -wr * 1.085, 7, wr * 0.17);
  cx.restore();
}

// Boost: a 270° ring filling with charge against this race's tank (a run's Long
// tank raises it); ice while filling, amber with a glow while firing.
function drawBoostGauge(cx, x, y, r, frac, firing) {
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  cx.lineCap = "round";
  cx.strokeStyle = "rgba(232,240,255,.10)"; cx.lineWidth = r * 0.2;
  cx.beginPath(); cx.arc(x, y, r, a0, a1); cx.stroke();
  if (frac > 0.004) {
    const col = firing ? AMBER : ICE;
    cx.strokeStyle = col; cx.shadowColor = col; cx.shadowBlur = firing ? 14 : 6;
    cx.beginPath(); cx.arc(x, y, r, a0, a0 + (a1 - a0) * frac); cx.stroke();
    cx.shadowBlur = 0;
  }
  cx.lineCap = "butt";
  cx.fillStyle = "rgba(232,240,255,.45)"; cx.textAlign = "center"; cx.textBaseline = "middle";
  cx.font = "600 " + Math.round(r * 0.32) + FONT;
  cx.fillText("BOOST", x, y + r * 0.62);
}

// Chain: the multiplier figure inside a four-segment arc up to this race's cap
// (Hot chain lowers it), from the same readout as the DOM chain. At ×1 the
// figure stays faintly visible (the DOM one hides): the gauge is always there.
function drawChainGauge(cx, x, y, r, cap) {
  const rd = chainReadout(race, car);
  const broke = rd.state === "broke";
  const t = clamp((rd.mult - 1) / (cap - 1), 0, 1);
  if (broke) { x += (Math.random() - 0.5) * 6 * race.breakT; y += (Math.random() - 0.5) * 6 * race.breakT; }
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, seg = 4, gap = 0.06;
  cx.lineWidth = r * 0.2;
  for (let i = 0; i < seg; i++) {
    const s0 = a0 + (a1 - a0) * i / seg + gap, s1 = a0 + (a1 - a0) * (i + 1) / seg - gap;
    cx.strokeStyle = "rgba(232,240,255,.10)";
    cx.beginPath(); cx.arc(x, y, r, s0, s1); cx.stroke();
    const f = clamp(t * seg - i, 0, 1);
    if (f > 0) {
      cx.strokeStyle = broke ? ROSE : ICE;
      cx.globalAlpha = broke ? rd.alpha : 0.4 + 0.6 * t;
      cx.beginPath(); cx.arc(x, y, r, s0, s0 + (s1 - s0) * f); cx.stroke();
      cx.globalAlpha = 1;
    }
  }
  cx.textAlign = "center"; cx.textBaseline = "middle";
  cx.font = "700 " + Math.round(r * 0.62) + FONT;
  cx.fillStyle = broke ? ROSE : PAPER;
  cx.globalAlpha = rd.state === "idle" ? 0.3 : rd.alpha;
  cx.fillText(rd.text, x, y - r * 0.05);
  cx.font = "600 " + Math.round(r * (broke ? 0.3 : 0.32)) + FONT;
  if (!broke) { cx.globalAlpha = 1; cx.fillStyle = "rgba(232,240,255,.45)"; }
  cx.fillText(broke ? rd.note : "CHAIN", x, y + r * 0.62);
  cx.globalAlpha = 1;
}

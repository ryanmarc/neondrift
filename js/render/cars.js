// The garage's cars: each one drawn from canvas paths in its own frame (x forward,
// y to the right, units of the original 44px arrow), never loaded from a file.
// No DOM and no game state, so the renderer, the garage panel and a Node test all
// use the same shapes. The renderer scales every car by CAR_SCALE (config/tuning.js).

// the game's palette (render/renderer.js COLOR): glass and trim are the void, tinted
const PAPER = "#e8f0ff", ROSE = "#ff2f9e";
const GLASS = "rgba(5,6,11,.74)", LINE = "rgba(5,6,11,.40)";

// A symmetric outline: nodes run from the nose (y = 0) down the right side to the
// tail (y = 0); [x, y] is a straight segment, [x, y, cx, cy] a curve arriving through
// (cx, cy). The left side is the same list walked back with y mirrored.
function sym(c, n) {
  c.moveTo(n[0][0], n[0][1]);
  for (let i = 1; i < n.length; i++) { const p = n[i]; p.length > 2 ? c.quadraticCurveTo(p[2], p[3], p[0], p[1]) : c.lineTo(p[0], p[1]); }
  for (let i = n.length - 1; i > 0; i--) { const via = n[i], to = n[i - 1]; via.length > 2 ? c.quadraticCurveTo(via[2], -via[3], to[0], -to[1]) : c.lineTo(to[0], -to[1]); }
  c.closePath();
}
function fillSym(c, col, n) { c.fillStyle = col; c.beginPath(); sym(c, n); c.fill(); }
function rr(c, col, x0, y0, x1, y1, r) { c.fillStyle = col; c.beginPath(); c.roundRect(x0, y0, x1 - x0, y1 - y0, r); c.fill(); }
function mrect(c, col, x, y, w, h) { c.fillStyle = col; c.fillRect(x, y, w, h); c.fillRect(x, -y - h, w, h); }
function mdot(c, col, x, y, r) { c.fillStyle = col; for (const s of [1, -1]) { c.beginPath(); c.arc(x, y * s, r, 0, 7); c.fill(); } }
function mbox(c, x, y, w, h) { c.strokeStyle = LINE; c.lineWidth = 0.45; c.strokeRect(x, y, w, h); c.strokeRect(x, -y - h, w, h); }
function mirrors(c, x, y) { c.rect(x, y, 1.9, 1.5); c.rect(x, -y - 1.5, 1.9, 1.5); }
function wing(c, x0, x1, half) { rr(c, GLASS, x0 - 0.5, -half - 0.4, x1 + 0.5, half + 0.4, 0.8); rr(c, PAPER, x0, -half, x1, half, 0.6); }

// Lineup order: Neon, the original arrow and the default, first.
export const CARS = [
  { id: "neon", name: "Neon", chassis: "The current car", front: 24, rear: -20,
    body(c) { c.moveTo(24, 0); c.lineTo(4, 11); c.lineTo(-20, 9); c.lineTo(-20, -9); c.lineTo(4, -11); c.closePath(); },
    detail(c) { c.fillStyle = "rgba(5,6,11,.65)"; c.fillRect(-6, -6, 11, 12); } },

  { id: "e30", name: "BMW E30", chassis: "1982–94 · coupe", front: 25, rear: -23,
    body(c) { sym(c, [[25,0],[25,7.5],[23.3,9.5,25,9.5],[21,9.5],[20.2,10.8],[10.3,10.8],[9.5,9.5],[-8.5,9.5],[-9.3,10.8],[-19.5,10.8],[-20.3,9.5],[-21.3,9.5],[-23,7.8,-23,9.5],[-23,0]]); mirrors(c, 6.5, 9.5); },
    detail(c) {
      fillSym(c, GLASS, [[10,0],[9,7.3],[-9.5,7.3],[-10.5,6.3],[-10.5,0]]);
      rr(c, PAPER, -6.5, -6.1, 3.5, 6.1, 1.2);
      c.strokeStyle = LINE; c.lineWidth = 0.4; c.beginPath(); c.moveTo(11, 4.3); c.lineTo(23.5, 4.3); c.moveTo(11, -4.3); c.lineTo(23.5, -4.3); c.stroke();
      mrect(c, GLASS, 24, 0.6, 1, 2.4); mdot(c, LINE, 24, 5.3, 0.9); mdot(c, LINE, 24, 7.5, 0.9);
      mrect(c, ROSE, -23, 3, 0.9, 5.8);
    } },

  { id: "ae86", name: "Toyota AE86", chassis: "1983–87 · Trueno hatch", front: 22, rear: -21,
    body(c) { sym(c, [[22,0],[21.8,6.2],[20,8.8,21.8,8.6],[13,8.8],[12.5,9.3],[8,9.3],[7.5,8.8],[-11,8.8],[-11.5,9.3],[-17,9.3],[-17.5,8.8],[-20,8.8],[-21,7,-21,8.8],[-21,0]]); mirrors(c, 4.5, 8.8); },
    detail(c) {
      fillSym(c, GLASS, [[7,0],[6,7],[-16.5,7],[-18,5.8],[-18,0]]);
      rr(c, PAPER, -9, -6, 1.5, 6, 1);
      mbox(c, 15.5, 3.2, 4.5, 4); c.fillStyle = GLASS; c.fillRect(21.2, -2.6, 0.7, 5.2);
      mrect(c, ROSE, -21, 3.8, 0.9, 4.6);
    } },

  { id: "s13", name: "Nissan 180SX", chassis: "1989–98 · S13 hatch", front: 25, rear: -22,
    body(c) { sym(c, [[25,0],[24.2,6.2,25,4.5],[20.5,9.3,23.6,9],[-18.8,9.3],[-22,7.2,-22,9.3],[-22,0]]); mirrors(c, 5, 9.3); },
    detail(c) {
      fillSym(c, GLASS, [[7,0],[5.8,7.4],[-14.5,7.4],[-16.5,6],[-16.5,0]]);
      rr(c, PAPER, -8, -6.2, 2.6, 6.2, 1.2);
      mbox(c, 16.5, 3.6, 4.8, 4.2);
      wing(c, -20.9, -19.4, 8.3);
      c.fillStyle = ROSE; c.fillRect(-22, -7.8, 0.8, 15.6);
    } },

  { id: "fd", name: "Mazda RX-7", chassis: "1992–2002 · FD3S", front: 24, rear: -22,
    body(c) { sym(c, [[24,0],[21.5,7,24,6],[14,10,18,10],[6,9,10,10],[-4,8.8,1,8.6],[-13,10.2,-8,10.2],[-20,8,-18,10],[-22,0,-22.5,6]]); mirrors(c, 2.5, 8.6); },
    detail(c) {
      c.fillStyle = GLASS; c.beginPath(); c.ellipse(-2.5, 0, 10.5, 7, 0, 0, 7); c.fill();
      c.fillStyle = PAPER; c.beginPath(); c.ellipse(-6.5, 0, 4.6, 5.9, 0, 0, 7); c.fill();
      c.strokeStyle = LINE; c.lineWidth = 0.4; c.beginPath(); c.ellipse(15, 0, 6.5, 3.2, 0, 0, 7); c.stroke();
      mdot(c, ROSE, -21.2, 4.2, 1); mdot(c, ROSE, -20.4, 6.6, 1);
    } },

  { id: "jzx", name: "Toyota Chaser", chassis: "1996–2001 · JZX100", front: 26, rear: -26,
    body(c) { sym(c, [[26,0],[26,7],[24.3,9.6,26,9.6],[-24,9.6],[-26,7.5,-26,9.6],[-26,0]]); mirrors(c, 9.5, 9.6); },
    detail(c) {
      fillSym(c, GLASS, [[11,0],[10,7.4],[-12.5,7.4],[-13.8,6.4],[-13.8,0]]);
      rr(c, PAPER, -9.5, -6.3, 6.5, 6.3, 1.2);
      mrect(c, PAPER, -1.8, 6.1, 1.2, 1.4);
      c.fillStyle = GLASS; c.fillRect(-24.8, -8.2, 0.6, 16.4);
      mbox(c, 23.6, 4, 1.7, 4.4);
      mrect(c, ROSE, -26, 4.5, 1, 4.8);
    } },

  { id: "miata", name: "Mazda Miata", chassis: "1989–97 · NA roadster", front: 21, rear: -19,
    body(c) { sym(c, [[21,0],[20,6,21.4,4],[15,8.8,18.8,8.7],[-13.5,8.8],[-18.6,6.2,-18.6,8.8],[-19.2,0,-19.4,3.2]]); mirrors(c, 3, 8.8); },
    detail(c) {
      fillSym(c, GLASS, [[5,0],[4.4,7.4],[2.4,7.4],[2.4,0]]);
      rr(c, GLASS, -9.5, -7, 2.2, 7, 2.2);
      rr(c, "rgba(232,240,255,.55)", -7.4, -6, -1.4, -1.2, 1.5); rr(c, "rgba(232,240,255,.55)", -7.4, 1.2, -1.4, 6, 1.5);
      c.strokeStyle = LINE; c.lineWidth = 0.45; c.beginPath(); c.roundRect(-12.4, -7.2, 2.2, 14.4, 0.8); c.stroke();
      mbox(c, 12.5, 3.2, 4.2, 3.8);
      c.fillStyle = ROSE; for (const s of [1, -1]) { c.beginPath(); c.ellipse(-18.6, 5.2 * s, 0.6, 1.8, 0, 0, 7); c.fill(); }
    } },

  { id: "supra", name: "Toyota Supra", chassis: "1993–2002 · A80 / MK4", front: 24, rear: -23,
    body(c) { sym(c, [[24,0],[23,6.5,24.5,5],[17,9.6,21,9.6],[5,9.4],[-8,9.9,-2,9.6],[-19,10],[-23,6.5,-23,10],[-23,0]]); mirrors(c, 4, 9.4); },
    detail(c) {
      fillSym(c, GLASS, [[8,0],[6.5,7.3],[-11,7.3],[-13,5,-12.5,7.3],[-13.5,0]]);
      rr(c, PAPER, -7.5, -6, 2.5, 6, 2.5);
      wing(c, -19.4, -17.4, 9.6);
      mdot(c, ROSE, -22.4, 5, 1.05); mdot(c, ROSE, -22, 7.8, 1.05);
    } },

  { id: "mustang", name: "Ford Mustang", chassis: "2015–23 · S550 fastback", front: 26, rear: -23,
    body(c) { sym(c, [[26,0],[25.5,6.5,26.5,5],[21,9.8,24.5,9.8],[-19,10],[-23,7,-23,10],[-23,0]]); mirrors(c, 1.5, 9.8); },
    detail(c) {
      fillSym(c, GLASS, [[3,0],[2,7.4],[-15,7.4],[-17,5.5],[-17,0]]);
      rr(c, PAPER, -10, -6.2, -1, 6.2, 1.5);
      c.fillStyle = "rgba(5,6,11,.5)"; c.fillRect(3.5, 1.2, 22, 2); c.fillRect(3.5, -3.2, 22, 2); c.fillRect(-10, 1.2, 9, 2); c.fillRect(-10, -3.2, 9, 2); c.fillRect(-22.6, 1.2, 5.4, 2); c.fillRect(-22.6, -3.2, 5.4, 2);
      mrect(c, GLASS, 13, 5.2, 4, 0.8);
      c.fillStyle = GLASS; c.fillRect(-21.6, -8.6, 0.6, 17.2);
      for (const y of [4, 5.8, 7.6]) mrect(c, ROSE, -23, y, 0.9, 1.2);
    } },
];

/** The car with this id, or Neon (the default) for an unknown or missing one. */
export function carById(id) {
  return CARS.find(k => k.id === id) || CARS[0];
}

/**
 * Draw one car in its own frame: the caller has already translated, rotated and
 * scaled. The body takes the glow; the details are drawn with the shadow off.
 */
export function drawCarShape(c, car, { body, glow, blur, details }) {
  c.shadowColor = glow; c.shadowBlur = blur; c.fillStyle = body;
  c.beginPath(); car.body(c); c.fill();
  c.shadowBlur = 0;
  if (details) car.detail(c);
}

// The player's choice. ui/garage.js sets it from storage and the panel; the renderer reads it.
export const garage = { car: "neon" };

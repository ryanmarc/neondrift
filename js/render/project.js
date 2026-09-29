// Perspective projection for the cockpit view. World: x, y on the ground in
// canvas axes (y down), z up. Camera space: [lateral (right of the heading +),
// depth (ahead +), z]. Pure: no canvas, no game state, so Node tests it.

export const NEAR = 3;   // world px: anything nearer than this is behind the eye

/** A camera at (x, y) looking along heading h, eye px above the road. (cx, hy)
 *  is where straight ahead lands on screen; focal is px per unit of lateral/depth. */
export function makeCam(x, y, h, eye, focal, cx, hy) {
  return { x, y, fx: Math.cos(h), fy: Math.sin(h), eye, focal, cx, hy };
}

export function toCam(c, x, y, z) {
  const dx = x - c.x, dy = y - c.y;
  return [-dx * c.fy + dy * c.fx, dx * c.fx + dy * c.fy, z];
}

/** A camera-space point in front of the eye to screen px. */
export function project(c, p) {
  return [c.cx + p[0] / p[1] * c.focal, c.hy + (c.eye - p[2]) / p[1] * c.focal];
}

function cut(a, b, near) {
  const t = (near - a[1]) / (b[1] - a[1]);
  return [a[0] + (b[0] - a[0]) * t, near, a[2] + (b[2] - a[2]) * t];
}

/** Sutherland–Hodgman against depth >= near. */
export function clipPoly(poly, near = NEAR) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ain = a[1] >= near, bin = b[1] >= near;
    if (ain) out.push(a);
    if (ain !== bin) out.push(cut(a, b, near));
  }
  return out.length >= 3 ? out : null;
}

export function clipSeg(a, b, near = NEAR) {
  const ain = a[1] >= near, bin = b[1] >= near;
  if (!ain && !bin) return null;
  if (!ain) return [cut(a, b, near), b];
  if (!bin) return [a, cut(a, b, near)];
  return [a, b];
}

export function projectPoly(c, poly) {
  const q = clipPoly(poly);
  return q && q.map(p => project(c, p));
}

// Other players in a live room, drawn as ghosts. Poses arrive at ~10Hz with
// network jitter; each is stamped with its local arrival time and the ghost
// is drawn DELAY_MS behind the present, interpolated between the two poses
// around that moment, so it moves smoothly instead of stepping. Pure data:
// the live layer feeds it, the renderer reads it.

import { lerp, wrapAngle } from "../core/math.js";

export const DELAY_MS = 150;    // render this far behind: absorbs jitter at 10Hz
export const SILENT_MS = 2000;  // a peer this quiet starts to fade
export const FADE_MS = 500;
const KEEP_MS = 1000;           // pose history kept per peer

/** id → { id, name, tag, buf: [{ t, x, y, a, prog }], last } */
export const peers = new Map();

export function setPeer({ id, name, tag }) {
  const p = peers.get(id);
  if (p) { p.name = name; p.tag = tag; }
  else peers.set(id, { id, name, tag, buf: [], last: -Infinity });
}
export function removePeer(id) { peers.delete(id); }
export function clearPeers() { peers.clear(); }
/** A new map: everyone is still here, but their old positions mean nothing. */
export function clearPoses() { for (const p of peers.values()) { p.buf = []; p.last = -Infinity; } }

export function addPose(id, pose, t) {
  const p = peers.get(id);
  if (!p) return;
  const [x, y, a, prog] = pose;
  const prev = p.buf[p.buf.length - 1];
  if (prev && prev.prog - prog > 0.5) p.buf = [];   // restarted on the line: snap, don't slide back
  p.buf.push({ t, x, y, a, prog });
  p.last = t;
  while (p.buf.length > 2 && p.buf[1].t < t - KEEP_MS) p.buf.shift();
}

/** Where to draw a peer at local time `now`, with its opacity, or null to skip it. */
export function peerPose(p, now) {
  const b = p.buf;
  if (!b.length) return null;
  const quiet = now - p.last;
  if (quiet > SILENT_MS + FADE_MS) return null;
  const alpha = quiet > SILENT_MS ? 1 - (quiet - SILENT_MS) / FADE_MS : 1;
  const rt = now - DELAY_MS;
  if (rt <= b[0].t) return { x: b[0].x, y: b[0].y, a: b[0].a, alpha };
  for (let k = b.length - 2; k >= 0; k--) {
    if (b[k].t <= rt) {
      const A = b[k], B = b[k + 1], f = Math.min(1, (rt - A.t) / ((B.t - A.t) || 1));   // past the newest pose: hold it, never extrapolate
      return { x: lerp(A.x, B.x, f), y: lerp(A.y, B.y, f), a: A.a + wrapAngle(B.a - A.a) * f, alpha };
    }
  }
  const z = b[b.length - 1];
  return { x: z.x, y: z.y, a: z.a, alpha };
}

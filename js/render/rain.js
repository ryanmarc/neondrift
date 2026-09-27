// Rain: a fixed pool of short slanted streaks in screen space, sized once from
// the viewport and recycled as they fall off it — never allocated per frame.
// Each drop is [x, y, depth] in a Float32Array; depth (0.4..1) sets speed,
// length and alpha, so near drops streak fast and bright and far ones hang back.

const FALL = 1500, SLANT = 0.22;   // px/s at depth 1; sideways per unit of fall

/** How many drops for a viewport: ~one per 5,000 px², between 80 and 250. */
export function rainCount(W, H) {
  return Math.max(80, Math.min(250, Math.round(W * H / 5000)));
}

export function createRain(count) {
  const drops = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    drops[i * 3] = Math.random() * 2000; drops[i * 3 + 1] = Math.random() * 2000; drops[i * 3 + 2] = 0.4 + Math.random() * 0.6;
  }
  return { drops, W: 0, H: 0 };
}

/**
 * Advance the drops by dt. (vx, vy) is the camera's screen-space velocity:
 * drops drift slightly against it, which reads as depth.
 */
export function stepRain(rain, W, H, dt, vx, vy) {
  const d = rain.drops, n = d.length / 3;
  if (rain.W !== W || rain.H !== H) {           // first frame or a resize: scatter across the view
    for (let i = 0; i < n; i++) { d[i * 3] = Math.random() * W; d[i * 3 + 1] = Math.random() * H; }
    rain.W = W; rain.H = H;
  }
  for (let i = 0; i < n; i++) {
    const z = d[i * 3 + 2], fall = FALL * z * dt;
    let x = d[i * 3] + fall * SLANT - vx * 0.15 * z * dt;
    let y = d[i * 3 + 1] + fall - vy * 0.15 * z * dt;
    if (y > H + 40) { y = -40; x = Math.random() * W; }
    else if (y < -40) { y = H + 40; x = Math.random() * W; }
    if (x > W + 40) x -= W + 80;
    else if (x < -40) x += W + 80;
    d[i * 3] = x; d[i * 3 + 1] = y;
  }
}

/** Draw the streaks in screen space (call with an identity-ish transform). */
export function drawRain(cx, rain) {
  const d = rain.drops, n = d.length / 3;
  cx.lineCap = "round";
  for (let pass = 0; pass < 2; pass++) {        // far drops dim and thin, near ones bright
    cx.strokeStyle = pass ? "rgba(200,220,255,.30)" : "rgba(150,175,230,.14)";
    cx.lineWidth = pass ? 1.4 : 1;
    cx.beginPath();
    for (let i = 0; i < n; i++) {
      const z = d[i * 3 + 2];
      if ((z > 0.7) !== (pass === 1)) continue;
      const len = 10 + 22 * z, x = d[i * 3], y = d[i * 3 + 1];
      cx.moveTo(x, y); cx.lineTo(x - len * SLANT, y - len);
    }
    cx.stroke();
  }
}

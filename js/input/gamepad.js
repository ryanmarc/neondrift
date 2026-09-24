// Pure reading of a Gamepad-shaped object (standard mapping). No DOM, no
// navigator: the callers poll `navigator.getGamepads()` and hand a pad in, so
// this is testable in Node and the game's one input stays digital — the stick
// is read as -1 / 0 / 1 past a deadzone, exactly like a key or a screen half.
// Anything finer would break traction and forbid boost at the same rate anyway,
// and the leaderboard's validator only replays those three values.

export const DEADZONE = 0.35;

// Standard-mapping button indices.
export const BTN = { A: 0, B: 1, LB: 4, RB: 5, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const IDLE = { x: 0, y: 0, a: false, b: false, lb: false, rb: false };

/** Reduce a pad to what the game reads: a digital x/y and four buttons. */
export function padState(gp, dead = DEADZONE) {
  if (!gp) return { ...IDLE };
  const axes = gp.axes || [], buttons = gp.buttons || [];
  const pressed = i => !!(buttons[i] && buttons[i].pressed);
  const ax = axes[0] || 0, ay = axes[1] || 0;
  const left = ax <= -dead || pressed(BTN.LEFT), right = ax >= dead || pressed(BTN.RIGHT);
  const up = ay <= -dead || pressed(BTN.UP), down = ay >= dead || pressed(BTN.DOWN);
  return {
    x: left && right ? 0 : left ? -1 : right ? 1 : 0,
    y: up && down ? 0 : up ? -1 : down ? 1 : 0,
    a: pressed(BTN.A), b: pressed(BTN.B), lb: pressed(BTN.LB), rb: pressed(BTN.RB),
  };
}

/** Which controls went from off to on between two states. A nav direction
 * counts as an edge when x/y newly takes that value, so a flip from left
 * straight to right fires "right" without passing through centre. */
export function risingEdges(prev, next) {
  return {
    a: next.a && !prev.a, b: next.b && !prev.b, lb: next.lb && !prev.lb, rb: next.rb && !prev.rb,
    left: next.x === -1 && prev.x !== -1, right: next.x === 1 && prev.x !== 1,
    up: next.y === -1 && prev.y !== -1, down: next.y === 1 && prev.y !== 1,
  };
}

/** The first connected pad in a getGamepads() array (which holds nulls), or null. */
export function firstPad(pads) {
  if (!pads) return null;
  for (const p of pads) if (p && p.connected !== false) return p;
  return null;
}

/** Move a focus index by delta through n items, wrapping; a stale index
 * (past the end, after the list shrank) restarts from the first item. */
export function stepIndex(i, n, delta) {
  if (n <= 0) return 0;
  if (i < 0 || i >= n) return 0;
  return (i + delta + n) % n;
}

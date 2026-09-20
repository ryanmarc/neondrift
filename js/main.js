// Entry point. Modules with side effects (event subscriptions, DOM wiring) are
// imported for those effects; the rest is explicit.

import { INITIAL_SEED } from "./config/params.js";
import { loadTrack, run } from "./game/race.js";
import { resize } from "./render/renderer.js";
import { armAutoplay } from "./audio/context.js";
import "./audio/sfx.js";       // subscribes to game events
import "./game/daily.js";     // rolls the daily track over at midnight UTC
import "./ui/hud.js";          // subscribes to game events
import "./ui/controls.js";     // wires the buttons
import "./net/leaderboard.js";  // subscribes to track-loaded and race-finish
import "./ui/board.js";         // the leaderboard panel
import "./ui/devpanel.js";     // DEV PANEL — delete this line with the panel

loadTrack(INITIAL_SEED);
resize();
armAutoplay();   // title-screen music as soon as the browser allows it
run();

// Live mode: a public room, one map per round for everyone, best single lap
// ranks. Drives the race loop only through setRules(), start() and events,
// like the run; talks to the room through socket.js. No DOM, no audio.
//
// Round changes come from a 250ms timer on the room's clock, not from frames,
// so a tab that was hidden (no animation frames) comes back to the current
// round's map rather than finishing a lap on a dead one.

import { emit } from "../core/events.js";
import { track, loadTrackGeometry } from "../track/track.js";
import { guides } from "../track/guides.js";
import { car, race, resetRace } from "../game/state.js";
import { ghost, unloadGhost } from "../game/ghost.js";
import { loadTrack, start, setRules } from "../game/race.js";
import { isDaily } from "../game/daily.js";
import { peers, setPeer, removePeer, clearPeers, clearPoses, addPose } from "../game/peers.js";
import { WEATHER_PARAM, todayUtc } from "../config/params.js";
import { resetCamera, startAngle } from "../render/camera.js";
import { ensureSecret, getName } from "../net/identity.js";
import { live, serverNow } from "./state.js";
import { roundAt, phaseAt, seedFor, open, entryAction } from "./clock.js";
import { connect } from "./socket.js";
import { createAttempts, recordSent, queueOffline, takeQueued, onResult, resetAttempts, clearPending } from "./attempts.js";

const POSE_DT = 0.1;          // seconds between poses sent: 10Hz

let sock = null, timer = 0, poseAcc = 0, savedGuides = false, wasDaily = false;
const attempts = createAttempts();   // laps sent and awaiting a verdict, and the fastest one queued while offline

const liveRules = {
  laps: 1,
  onStep(flags, dt) {
    poseAcc += dt;
    if (poseAcc >= POSE_DT) {
      poseAcc -= POSE_DT;
      // Nobody else here: nobody to draw it for, and every relayed message is billed.
      if (peers.size > 0) sock?.send({ t: "pose", p: [+car.x.toFixed(1), +car.y.toFixed(1), +car.a.toFixed(3), +car.prog.toFixed(4)] });
    }
    return !open(live.round, serverNow());   // the grace is over: stop the car
  },
  onFinish(reason) {
    race.running = false;
    if (reason === "laps") submit({ round: live.round, inputs: race.inputs.slice(), time: race.time, rec: race.rec.slice() });
    if (phaseAt(serverNow()).racing && roundAt(serverNow()) === live.round) attempt();
  },
};

function submit(a) {
  if (!open(a.round, serverNow())) return;
  if (sock && sock.send({ t: "attempt", round: a.round, inputs: a.inputs, time: a.time })) {
    recordSent(attempts, { time: a.time, rec: a.rec });
  } else {
    queueOffline(attempts, a);   // offline: keep the fastest, the room takes one every 5s anyway
  }
}

/** A fresh attempt: the car on the line with a one-tick countdown. */
function attempt() {
  poseAcc = 0;
  start(1);
}

function enterRound(r) {
  live.round = r; live.best = null; live.standings = []; live.results = null;
  resetAttempts(attempts);
  loadTrackGeometry(seedFor(r));
  unloadGhost();
  clearPoses();
  race.running = false;
  resetRace(track.samples[0]);
  resetCamera(car, startAngle(car));
  emit("live-round", r);
}

function sync() {
  if (!live.active || live.status === "joining") return;   // the first map loads on welcome
  const now = serverNow();
  const act = entryAction(live.round, now);
  if (act === "load") {
    enterRound(roundAt(now));
    if (entryAction(live.round, now) === "drive") attempt();
    emit("live-state");
  } else if (act === "drive" && !race.running) {
    attempt();
  }
}

function onMessage(m) {
  switch (m.t) {
    case "welcome": {
      live.offset = m.now - Date.now();
      live.status = "on";
      clearPeers();
      for (const p of m.peers) setPeer(p);
      clearPending(attempts);                        // verdicts for laps sent on the old socket are lost
      sync();                                        // may load the round's map
      live.standings = m.standings;
      const q = takeQueued(attempts, serverNow());
      if (q) submit(q);
      emit("live-state");
      break;
    }
    case "join": setPeer(m); emit("live-peer-join", m); break;
    case "leave": removePeer(m.id); emit("live-peer-leave", m); break;
    case "pose": addPose(m.id, m.p, performance.now()); break;
    case "standing": {
      live.standings = live.standings.filter(s => s.id !== m.id);
      live.standings.push({ id: m.id, name: m.name, tag: m.tag, time: m.time });
      live.standings.sort((a, b) => a.time - b.time);
      emit("live-standing", m);
      break;
    }
    case "attempt-result": {
      const rec = onResult(attempts, m);
      if (m.ok && m.improved) {
        live.best = m.time;
        if (rec) { ghost.data = rec; ghost.bestTime = m.time; }
      }
      emit("live-attempt", m);
      break;
    }
    case "results":
      // Only while this round's results phase is showing: a late one must not cover a lap.
      if (m.round === live.round && !phaseAt(serverNow()).racing) { live.results = m; live.standings = m.rows; emit("live-results", m); }
      break;
  }
}

function onStatus(s) {
  live.status = s;
  if (s === "unavailable" || s === "displaced" || s === "idle") {
    const why = s;
    leaveLive();
    live.status = why;           // leaveLive resets it; the title screen says why
  }
  emit("live-state");
}

/** Join the live room from the title screen. Call inside a tap handler (audio unlock is the caller's). */
export function enterLive() {
  if (live.active) return;
  // A forced weather rolls a different car than the seed's, so every lap
  // would fail the room's replay: refuse up front, like the practice it is.
  if (WEATHER_PARAM) { live.status = "practice"; emit("live-state"); return; }
  live.active = true; live.status = "joining"; live.round = -1;
  live.standings = []; live.results = null; live.best = null; live.offset = 0;
  live.savedSeed = track.seed;
  wasDaily = isDaily();   // on leave, the daily comes back as today's, even after midnight UTC
  savedGuides = guides.visible; guides.visible = false;
  setRules(liveRules);
  emit("live-state");
  const secret = ensureSecret();
  sock = connect(() => ({ t: "hello", secret, name: getName() || "" }), { onMessage, onStatus });
  timer = setInterval(sync, 250);
}

/** Leave the room and go back to the daily race: today's if the daily was loaded, else the track that was. */
export function leaveLive() {
  if (!live.active) return;
  live.active = false; live.status = "off";
  clearInterval(timer);
  sock?.close(); sock = null;
  resetAttempts(attempts);
  clearPeers();
  setRules(null);
  race.running = false; race.finished = false; race.countdown = 0; race.goTimer = 0;
  guides.visible = savedGuides;
  loadTrack(wasDaily ? todayUtc() : live.savedSeed);
  emit("live-leave");
}

/** R, pad B, or the Restart button: back to the line, the lap in progress discarded. */
export function restartAttempt() {
  if (!live.active || live.round < 0) return;
  if (entryAction(live.round, serverNow()) === "drive") attempt();
}

// The leaderboard panel on the overlay: top 10 for the current track, the
// player's own row, the one-time name prompt, and the device pairing links.
// Reads `board`, listens for "board-updated", and calls into leaderboard.js.

import { $ } from "../core/dom.js";
import { on } from "../core/events.js";
import { board, submitPending, dismissPending, setPlayerName, startPairing, clearPairing, claimPairingCode } from "../net/leaderboard.js";
import * as identity from "../net/identity.js";
import { fmt } from "./hud.js";

const $board = $("board"), $list = $("boardlist"), $me = $("boardme"), $status = $("boardstatus");
const $namerow = $("namerow"), $namebox = $("namebox"), $post = $("postname"), $skip = $("skipname");
const $pairstart = $("pairstart"), $pairclaim = $("pairclaim"), $rename = $("rename"), $pairbox = $("pairbox");

// The identity can appear (first post) or change (pairing) at any time, so
// every render re-checks the tag and re-renders if it moved.
let myTag = "";
const refreshTag = () => identity.tag().then(t => { if (t !== myTag) { myTag = t; render(); } });

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const who = (name, tag) => '<span class="who">' + esc(name) + '<span class="tag">#' + esc(tag) + '</span></span>';
const row = (rank, name, tag, time, me) =>
  '<li' + (me ? ' class="me"' : "") + '><span class="rank">' + rank + "</span>" + who(name, tag) + '<span class="time">' + fmt(time) + "</span></li>";

function render() {
  $board.classList.toggle("on", board.status !== "off");
  if (board.status === "off") return;
  refreshTag();

  const myName = identity.getName();
  const mine = r => r.tag === myTag && r.name === myName;
  $list.innerHTML = board.top.map((r, i) => row(i + 1, r.name, r.tag, r.time, mine(r))).join("");
  const inTop = board.top.some(mine);
  $me.innerHTML = board.me && !inTop
    ? '<span class="rank">' + board.me.rank + "</span>" + who(board.me.name || myName || "", board.me.tag) + '<span class="time">' + fmt(board.me.time) + "</span>"
    : "";
  $me.style.display = $me.innerHTML ? "flex" : "none";

  let status = "";
  if (board.status === "loading") status = "loading…";
  else if (board.status === "unavailable") status = "leaderboard unavailable";
  else if (!board.top.length) status = "no times yet — set the first";
  if (board.lastSubmit && !board.lastSubmit.accepted) status = "couldn't verify that run (" + (board.lastSubmit.reason || "unavailable") + ")";
  $status.textContent = status;

  const renaming = $pairbox.dataset.mode === "rename";
  $namerow.classList.toggle("on", !!board.pending || renaming);
  if (board.pending && !renaming) $post.textContent = "Post " + fmt(board.pending.time);

  $rename.style.display = identity.getName() ? "" : "none";
  $pairstart.style.display = identity.getSecret() ? "" : "none";

  if (board.pairing) {
    const mins = Math.max(0, Math.ceil((board.pairing.expires - Date.now()) / 60000));
    $pairbox.innerHTML = '<div>On the other device, choose "Enter a code":</div><div class="code">' + esc(board.pairing.code) + "</div><div>good for " + mins + ' min · <button type="button" class="link" id="pairdone">done</button></div>';
    $("pairdone").addEventListener("click", clearPairing);
  } else if (!$pairbox.dataset.mode) {
    $pairbox.innerHTML = "";
  }
}

// ---------- name prompt (also used for renaming) ----------

async function postName() {
  const name = $namebox.value.trim();
  if (name.length < 2) { $namebox.focus(); return; }
  $post.disabled = true;
  const ok = await setPlayerName(name);
  $post.disabled = false;
  if (!ok) { $status.textContent = "that name can't be used"; return; }
  $pairbox.dataset.mode = "";
  if (board.pending) await submitPending();
  render();
}
$post.addEventListener("click", e => { e.stopPropagation(); postName(); });
$namebox.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") postName(); });
$namebox.addEventListener("keyup", e => e.stopPropagation());
$skip.addEventListener("click", e => {
  e.stopPropagation();
  if ($pairbox.dataset.mode === "rename") { $pairbox.dataset.mode = ""; render(); }
  else dismissPending();
});

$rename.addEventListener("click", e => {
  e.stopPropagation();
  $pairbox.dataset.mode = "rename";
  $namebox.value = identity.getName() || "";
  $post.textContent = "Save name";
  render();
  $namebox.focus();
});

// ---------- pairing ----------

$pairstart.addEventListener("click", async e => {
  e.stopPropagation();
  if (!(await startPairing())) $status.textContent = "couldn't get a code right now";
});
$pairclaim.addEventListener("click", e => {
  e.stopPropagation();
  $pairbox.dataset.mode = "claim";
  $pairbox.innerHTML = '<div>Code from your other device:</div><div><input id="codebox" maxlength="6" autocomplete="off" spellcheck="false"> <button type="button" id="codego" class="link">use it</button></div>';
  const $code = $("codebox");
  const go = async () => {
    const ok = await claimPairingCode($code.value);
    if (ok) { $pairbox.dataset.mode = ""; $pairbox.innerHTML = ""; render(); }
    else $status.textContent = "that code didn't work";
  };
  $code.addEventListener("keydown", ev => { ev.stopPropagation(); if (ev.key === "Enter") go(); });
  $code.addEventListener("keyup", ev => ev.stopPropagation());
  $("codego").addEventListener("click", go);
  $code.focus();
});

on("board-updated", render);
render();

// Thin fetch wrappers for the leaderboard API. Every failure — network,
// timeout, non-2xx, bad JSON — resolves to null so callers never throw and
// play is never blocked.

import { API_URL } from "../config/params.js";

const TIMEOUT_MS = 8000;

export function apiEnabled() { return !!API_URL; }

async function call(path, { method = "GET", body = null } = {}) {
  if (!API_URL) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL + path, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : null,
      signal: ctl.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return data && data.error ? { error: data.error } : null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const postRun = (body) => call("/runs", { method: "POST", body });
export const fetchBoard = (trackId, playerId) =>
  call("/board?track=" + encodeURIComponent(trackId) + (playerId ? "&player=" + playerId : ""));
export const fetchGhost = (trackId, playerId) =>
  call("/ghost?track=" + encodeURIComponent(trackId) + "&player=" + playerId);
export const postName = (secret, name) => call("/name", { method: "POST", body: { secret, name } });
// Pairing: the new device starts (gets a code to show and a token to keep) and
// polls; the device that has the secret approves by sending the code.
export const pairStart = () => call("/pair/start", { method: "POST", body: {} });
export const pairApprove = (code, secret) => call("/pair/approve", { method: "POST", body: { code, secret } });
export const pairPoll = (token) => call("/pair/poll", { method: "POST", body: { token } });

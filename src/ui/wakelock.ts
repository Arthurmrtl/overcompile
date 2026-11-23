// Keep the screen on while the game is visible (Screen Wake Lock API), so a phone doesn't lock
// and drop the game into offline progress. A device preference, kept outside the save.
// On by default in the installed app, off in a browser tab. The browser releases the lock
// whenever the page is hidden, so it is taken again when the page comes back.

import { isStandalone } from "./pwa";

const KEY = "overcompile-wakelock";

interface WakeLockSentinelLike { released: boolean; release(): Promise<void>; }
type WakeLockApi = { request(type: "screen"): Promise<WakeLockSentinelLike> };

const api = (): WakeLockApi | null => (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock ?? null;

let lock: WakeLockSentinelLike | null = null;

/** The browser can keep the screen on (secure context, recent Chrome / Safari). */
export const wakeLockSupported = () => api() !== null;

export function wakeLockEnabled(): boolean {
  let v: string | null = null;
  try { v = localStorage.getItem(KEY); } catch { /* storage may be unavailable */ }
  return v === null ? isStandalone() : v === "on";
}

async function sync() {
  const a = api();
  if (!a) return;
  const want = wakeLockEnabled() && document.visibilityState === "visible";
  if (want && (!lock || lock.released)) {
    try { lock = await a.request("screen"); } catch { lock = null; /* low battery mode, or refused */ }
  } else if (!want && lock && !lock.released) {
    try { await lock.release(); } catch { /* already released */ }
    lock = null;
  }
}

export function setWakeLock(on: boolean) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* storage may be unavailable */ }
  void sync();
}

export function initWakeLock() {
  if (!api()) return;
  document.addEventListener("visibilitychange", () => void sync());
  // Some browsers only grant the lock after a user gesture: retry on the first touch or click.
  const retry = () => void sync();
  document.addEventListener("pointerdown", retry, { passive: true });
  void sync();
}

// v0.6.15: keeps the last JavaScript errors of this device, so a tester can send them with the feedback report.
// Device data (localStorage, outside the save), like the layout or the sound preference.

const KEY = "overcompile-errors";
const MAX = 20;

export interface LoggedError { at: number; v: string; msg: string; where: string }

let version = "";
let list: LoggedError[] = [];

function load() {
  try { list = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { list = []; }
  if (!Array.isArray(list)) list = [];
}
function store() {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch { /* storage may be full or blocked */ }
}

export function logError(msg: string, where = "") {
  const last = list[list.length - 1];
  // the same error every frame would flood the list: count it once a minute
  if (last && last.msg === msg && Date.now() - last.at < 60_000) return;
  list.push({ at: Date.now(), v: version, msg: msg.slice(0, 300), where: where.slice(0, 200) });
  list = list.slice(-MAX);
  store();
}

export function initErrorLog(gameVersion: string) {
  version = gameVersion;
  load();
  window.addEventListener("error", e => {
    const err = e.error as Error | undefined;
    logError(err?.message || e.message || "error", err?.stack?.split("\n").slice(1, 3).map(l => l.trim()).join(" | ") || `${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener("unhandledrejection", e => {
    const r = e.reason as Error | undefined;
    logError(r?.message || String(e.reason), r?.stack?.split("\n").slice(1, 3).map(l => l.trim()).join(" | ") || "promise");
  });
}

export const loggedErrors = (): LoggedError[] => list.slice();
export function clearErrors() { list = []; store(); }

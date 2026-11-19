import type { GameState } from "./state";

/**
 * Build events (v0.3.1): every few minutes something happens in the console for a
 * few seconds. Catching it (click, or typing its command) gives a short boost.
 * All events are positive. Nothing spawns offline or during a challenge.
 */

export type EventEffect =
  | { kind: "speed"; mult: number; seconds: number }     // builds × faster
  | { kind: "nofail"; seconds: number }                  // 0 % failures
  | { kind: "gains"; mult: number; seconds: number }     // rewards ×
  | { kind: "income"; seconds: number }                  // + N seconds of current income, right away
  | { kind: "instant"; rounds: number }                  // every job finishes its build N times
  | { kind: "stars"; pct: number };                      // + pct % stars on the next release

export interface BuildEvent {
  id: string;
  icon: string;
  /** Command that catches it (first word, then optional arguments). */
  cmd: string;
  weight: number;   // relative spawn chance
  effect: EventEffect;
  /** Only once stars are known (first release done). */
  needsStars?: boolean;
}

export const BUILD_EVENTS: BuildEvent[] = [
  { id: "coffee",  icon: "☕", cmd: "coffee",       weight: 10, effect: { kind: "speed", mult: 2, seconds: 30 } },
  { id: "cargo",   icon: "📦", cmd: "cargo update", weight: 10, effect: { kind: "income", seconds: 60 } },
  { id: "flaky",   icon: "🧪", cmd: "retry",        weight: 10, effect: { kind: "nofail", seconds: 45 } },
  { id: "review",  icon: "👀", cmd: "approve",      weight: 5,  effect: { kind: "gains", mult: 3, seconds: 20 } },
  { id: "merge",   icon: "🔀", cmd: "git merge",    weight: 5,  effect: { kind: "instant", rounds: 3 } },
  { id: "cve",     icon: "🛡", cmd: "patch",        weight: 5,  effect: { kind: "income", seconds: 300 } },
  { id: "hotfix",  icon: "🔥", cmd: "hotfix",       weight: 2,  effect: { kind: "gains", mult: 7, seconds: 15 } },
  { id: "rc",      icon: "🚀", cmd: "rc",           weight: 2,  effect: { kind: "stars", pct: 10 }, needsStars: true },
];
export const RC_STARS_PCT = 10;
export const EVENT_BY_ID = Object.fromEntries(BUILD_EVENTS.map(e => [e.id, e]));

/** Seconds between two events (random in this range), and how long one stays catchable. */
export const EVENT_GAP: [number, number] = [180, 360];
export const EVENT_WINDOW = 12;
/** Pager talent: longer window, events a bit more often. */
export const PAGER_WINDOW = 20;
export const PAGER_GAP_MULT = 0.8;

/** Events that can spawn right now (rc only once stars exist, and not twice in a row). */
export function eligibleEvents(s: GameState, starsKnown: boolean): BuildEvent[] {
  return BUILD_EVENTS.filter(e => (!e.needsStars || starsKnown) && !(e.id === "rc" && s.rcPending));
}

export function pickEvent(list: BuildEvent[], rnd = Math.random()): BuildEvent {
  const total = list.reduce((a, e) => a + e.weight, 0);
  let x = rnd * total;
  for (const e of list) {
    x -= e.weight;
    if (x < 0) return e;
  }
  return list[list.length - 1];
}

/** Matches a typed command line ("git merge", "cargo update") against an event. */
export function eventForCommand(line: string): BuildEvent | undefined {
  const norm = line.trim().toLowerCase().replace(/\s+/g, " ");
  return BUILD_EVENTS.find(e => norm === e.cmd || norm.startsWith(e.cmd + " "));
}

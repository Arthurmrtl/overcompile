import Decimal from "break_eternity.js";
import type { GameState } from "./state";

// Optimizations: infinite (or long) upgrade lines bought with Stars.
// Price of the next level = base × ratio^level.

export interface Upgrade {
  id: string;
  base: number;
  ratio: number;
  max?: number;
  /** Talent required to see/buy this line. */
  req?: string;
}

export const UPGRADES: Upgrade[] = [
  { id: "opt_reward", base: 2, ratio: 2 },
  { id: "opt_speed", base: 3, ratio: 2 },
  { id: "opt_boot", base: 5, ratio: 2 },
  { id: "off_eff", base: 2, ratio: 2, max: 9, req: "offline_runners" },
  { id: "off_dur", base: 3, ratio: 2, max: 3, req: "offline_runners" },
];
export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map(u => [u.id, u]));

export const level = (s: GameState, id: string) => s.upgrades[id] ?? 0;

export function upgradePrice(s: GameState, id: string): Decimal {
  const u = UPGRADE_BY_ID[id];
  return Decimal.pow(u.ratio, level(s, id)).mul(u.base).floor();
}

export function upgradeMaxed(s: GameState, id: string): boolean {
  const u = UPGRADE_BY_ID[id];
  return u.max !== undefined && level(s, id) >= u.max;
}

/* ---- effects ---- */
export const optRewardMult = (s: GameState) => Decimal.pow(1.25, level(s, "opt_reward"));
export const optSpeedMult = (s: GameState) => Math.pow(0.9, level(s, "opt_speed"));
/** Warm start: every run begins with this many extra CPU/RAM/Disk levels. */
export const optBootLevels = (s: GameState) => 3 * level(s, "opt_boot");

export const OFFLINE_DURATIONS_H = [2, 4, 8, 24];
export const offlineCapHours = (s: GameState) => OFFLINE_DURATIONS_H[Math.min(level(s, "off_dur"), 3)];
export const offlineEff = (s: GameState) => Math.min(1, 0.1 + 0.1 * level(s, "off_eff"));

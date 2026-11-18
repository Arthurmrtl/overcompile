import Decimal from "break_eternity.js";
import type { GameState, HwKey } from "./state";

export const has = (s: GameState, talent: string) => s.talents.includes(talent);

/* ---------- Hardware prices ---------- */
export const HW: Record<HwKey, { base: number; ratio: number; max?: number }> = {
  cpu: { base: 1.5, ratio: 1.25 },
  ram: { base: 2, ratio: 1.28 },
  disk: { base: 1.5, ratio: 1.2 },
  jobs: { base: 15, ratio: 5, max: 16 },
};
export const PERK_PRICE = { ci_cd: new Decimal(10), auto_scaling: new Decimal(250) };

/** Price of the next level when currently at `level`. */
export function price(key: HwKey, level: number): Decimal {
  const { base, ratio } = HW[key];
  return Decimal.pow(ratio, level - 1).mul(base);
}

/** Total price of `n` levels starting from `level`. */
export function bulkPrice(key: HwKey, level: number, n: number): Decimal {
  const { ratio } = HW[key];
  return price(key, level).mul(Decimal.pow(ratio, n).sub(1)).div(ratio - 1);
}

/** How many levels can be afforded with `credits` (respecting the max level). */
export function maxAffordable(key: HwKey, level: number, credits: Decimal): number {
  const { ratio, max } = HW[key];
  const p = price(key, level);
  if (credits.lt(p)) return 0;
  let n = Math.floor(credits.mul(ratio - 1).div(p).add(1).log10().div(Math.log10(ratio)).toNumber());
  if (max !== undefined) n = Math.min(n, max - level);
  while (n > 0 && bulkPrice(key, level, n).gt(credits)) n--; // float safety
  return Math.max(n, 0);
}

/* ---------- Build parameters ---------- */
// CPU   : faster builds, slightly more failures
// RAM   : bigger rewards, slightly slower builds
// Disk  : fewer failures, slightly smaller rewards
// Jobs  : parallel builds
export function buildTime(s: GameState): number {
  let t = 5 / Math.pow(1.07, s.hw.cpu - 1) * Math.pow(1.004, s.hw.ram - 1);
  if (has(s, "warm_cache")) t /= 2;
  if (has(s, "dist_cache")) t /= 3;
  return t;
}

export function failProbability(s: GameState): number {
  let p = 0.25 * Math.pow(1.012, s.hw.cpu - 1) * Math.pow(0.965, s.hw.disk - 1);
  if (has(s, "rust_rewrite")) p /= 2;
  return Math.min(Math.max(p, 0.01), 0.9);
}

export function starMultiplier(s: GameState): Decimal {
  return s.lifetimeStars.sqrt().mul(0.25).add(1);
}

export function achievementMultiplier(s: GameState): number {
  return 1 + 0.02 * s.achievements.length;
}

export function rewardMultiplier(s: GameState): Decimal {
  let m = starMultiplier(s).mul(achievementMultiplier(s));
  if (has(s, "code_review")) m = m.mul(2);
  if (has(s, "lto")) m = m.mul(3);
  return m;
}

export function reward(s: GameState): Decimal {
  return Decimal.pow(1.09, s.hw.ram - 1).mul(Decimal.pow(0.997, s.hw.disk - 1)).mul(rewardMultiplier(s));
}

/** Expected credits per second with every slot building. */
export function expectedRate(s: GameState): Decimal {
  return reward(s).mul(s.hw.jobs * (1 - failProbability(s))).div(buildTime(s));
}

/* ---------- Release (prestige layer 1) ---------- */
export const RELEASE_BASE = new Decimal(2e4);

export function starsOnRelease(s: GameState): Decimal {
  if (s.runEarned.lt(RELEASE_BASE)) return new Decimal(0);
  let g = s.runEarned.div(RELEASE_BASE).sqrt();
  if (has(s, "semver")) g = g.mul(2);
  return g.floor();
}

/** runEarned needed to get one more star than now. */
export function nextStarAt(s: GameState): Decimal {
  const mult = has(s, "semver") ? 2 : 1;
  const next = starsOnRelease(s).add(1).div(mult);
  return next.pow(2).mul(RELEASE_BASE);
}

export const OFFLINE_CAP_SECONDS = 24 * 3600;
export const offlineEfficiency = (s: GameState) => (has(s, "offline_runners") ? 1 : 0.5);

import Decimal from "break_eternity.js";
import type { GameState, HwKey } from "./state";
import { CHALLENGES } from "./challenges";
import { TALENTS } from "./talents";
const TALENT_REQ: Record<string, string[]> = Object.fromEntries(TALENTS.map(t => [t.id, t.req]));
import { offlineCapHours, offlineEff, optRewardMult, optSpeedMult } from "./upgrades";

/** The player owns this talent (tree display, prerequisites). */
export const has = (s: GameState, talent: string) => s.talents.includes(talent);
/** The talent's effect is active (the No cache challenge disables the whole tree). */
export const on = (s: GameState, talent: string) => s.challenge !== "no_cache" && s.talents.includes(talent);
export const inChallenge = (s: GameState, id: string) => s.challenge === id;
export const challengeDone = (s: GameState, id: string) => s.challengesDone.includes(id);

/* ---------- Progressive reveal ---------- */
/** Stars, the release tree and optimizations stay hidden until the first release. */
export const starsRevealed = (s: GameState) => s.releases > 0 || s.lifetimeStars.gt(0);
/** Tree fog of war: "shown" = owned or buyable; "fog" = next tier, shown as ???; "hidden" = further away. */
export function talentVisibility(s: GameState, id: string, req: string[]): "shown" | "fog" | "hidden" {
  if (s.talents.includes(id) || req.every(r => s.talents.includes(r))) return "shown";
  const reqShown = (r: string) => s.talents.includes(r) || (TALENT_REQ[r] ?? []).every(x => s.talents.includes(x));
  return req.some(reqShown) ? "fog" : "hidden";
}

/* ---------- Hardware prices ---------- */
export const HW: Record<HwKey, { base: number; ratio: number; max?: number }> = {
  cpu: { base: 1.5, ratio: 1.25 },
  ram: { base: 2, ratio: 1.28 },
  disk: { base: 1.5, ratio: 1.2 },
  jobs: { base: 15, ratio: 5, max: 16 },
};
export const PERK_PRICE = { ci_cd: new Decimal(10), auto_scaling: new Decimal(1000) };

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

/* ---------- Balance knobs (tuned with `npm run sim`) ---------- */
export const BAL = {
  incSpeed: 1.5,       // warm_cache: build speed
  revReward: 1.5,      // code_review: rewards
  ltoReward: 2,        // lto: rewards
  distSpeed: 2,        // dist_cache: build speed
  releaseGrowth: 1.2,    // each released version needs ×N more credits per star
  starExp: 0.36,        // stars = (earned / base) ^ starExp
};

/* ---------- Build parameters ---------- */
// CPU   : faster builds, slightly more failures
// RAM   : bigger rewards, slightly slower builds
// Disk  : fewer failures, slightly smaller rewards
// Jobs  : parallel builds
export function buildTime(s: GameState): number {
  let t = 5 / Math.pow(1.07, s.hw.cpu - 1) * Math.pow(1.004, s.hw.ram - 1);
  if (on(s, "warm_cache")) t /= BAL.incSpeed;
  if (on(s, "dist_cache")) t /= BAL.distSpeed;
  t *= optSpeedMult(s);
  if (challengeDone(s, "single_core")) t /= 1.5;
  if (inChallenge(s, "debug_build")) t *= 10;
  return t;
}

export function failProbability(s: GameState): number {
  let p = 0.25 * Math.pow(1.012, s.hw.cpu - 1) * Math.pow(0.965, s.hw.disk - 1);
  if (on(s, "rust_rewrite")) p /= 2;
  if (challengeDone(s, "friday")) p *= 0.75;
  p = Math.min(Math.max(p, 0.01), 0.9);
  if (inChallenge(s, "friday")) p = Math.max(p, 0.5);
  return p;
}

export function starMultiplier(s: GameState): Decimal {
  return s.lifetimeStars.sqrt().mul(0.25).add(1);
}

export function achievementMultiplier(s: GameState): number {
  return 1 + 0.02 * s.achievements.length;
}

export function rewardMultiplier(s: GameState): Decimal {
  let m = starMultiplier(s).mul(achievementMultiplier(s)).mul(optRewardMult(s));
  if (on(s, "code_review")) m = m.mul(BAL.revReward);
  if (on(s, "lto")) m = m.mul(BAL.ltoReward);
  if (challengeDone(s, "debug_build")) m = m.mul(2);
  if (inChallenge(s, "friday")) m = m.mul(2);
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

/** Credits per star² for the next release: grows with every version shipped. */
export function releaseBase(s: GameState): Decimal {
  return Decimal.pow(BAL.releaseGrowth, s.releases).mul(RELEASE_BASE);
}

export function starGainMultiplier(s: GameState): number {
  let m = 1;
  if (on(s, "semver")) m *= 2;
  if (challengeDone(s, "no_cache")) m *= 1.5;
  return m;
}

export function starsOnRelease(s: GameState): Decimal {
  const base = releaseBase(s);
  if (s.challenge || s.runEarned.lt(base)) return new Decimal(0);
  return s.runEarned.div(base).pow(BAL.starExp).mul(starGainMultiplier(s)).floor();
}

/** runEarned needed to reach `n` stars on release. */
export function earnedForStars(s: GameState, n: Decimal | number): Decimal {
  return new Decimal(n).div(starGainMultiplier(s)).pow(1 / BAL.starExp).mul(releaseBase(s));
}

/** runEarned needed to get one more star than now. */
export function nextStarAt(s: GameState): Decimal {
  const next = starsOnRelease(s).add(1).div(starGainMultiplier(s));
  return next.pow(1 / BAL.starExp).mul(releaseBase(s)).max(releaseBase(s));
}

/** Credits to earn in the run to complete the active challenge. */
export const challengeGoal = (s: GameState) =>
  releaseBase(s).mul(CHALLENGES.find(c => c.id === s.challenge)?.goal ?? 1);

/* ---------- Auto-Scaling ---------- */
export const autoScaleInterval = (s: GameState) => (on(s, "as_fast") ? 0.25 : 2);

/* ---------- Offline progress ---------- */
export const OFFLINE_GRACE_SECONDS = 300;
export const offlineUnlocked = (s: GameState) => on(s, "offline_runners");
export const offlineEfficiency = (s: GameState) => (offlineUnlocked(s) ? offlineEff(s) : 0);
export const offlineCapSeconds = (s: GameState) => offlineCapHours(s) * 3600;

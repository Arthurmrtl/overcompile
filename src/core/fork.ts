import Decimal from "break_eternity.js";
import type { GameState } from "./state";
import { TALENTS } from "./talents";

/**
 * Fork (v0.4): second prestige layer, above releases.
 *
 * Once the whole release tree is owned, the player can fork the project: releases, stars,
 * the release tree, optimizations, challenges and generations reset, and the fork pays
 * **contributors**, computed from the stars earned since the last fork (same idea as stars
 * from credits). Achievements, build events stats and settings are never reset.
 *
 * Contributors:
 * - every contributor ever earned gives a permanent bonus (rewards and stars);
 * - unspent ones buy Fork talents (permanent, never reset).
 * After the first fork, contributors also open pull requests during runs: merging one gives
 * a boost until the next release. PRs never give contributors (prestige stays the only source).
 */

export const FORK = {
  starsBase: 200,        // stars earned in the cycle for the first contributor (the release tree costs 225)
  earlyK: 2,             // early curve: 1 + earlyK × log2(stars / starsBase) → 1, 3, 5, 9 at ×1, ×2, ×4, ×16
  lateExp: 0.6,          // late curve: (stars / starsBase) ^ lateExp, whichever is higher
  genBonus: 0.05,        // +5 % contributors per hardware generation owned at fork time
  chalBonus: 0.1,        // +10 % contributors per challenge completed in the cycle
  gainsPer: 0.4,         // passive: rewards × (1 + gainsPer × lifetime contributors ^ gainsExp)
  gainsExp: 0.8,
  starsPer: 0.02,        // passive: stars × (1 + starsPer × lifetime contributors)
  releaseBaseMult: 10,   // each fork makes the release threshold ×N (else the first release of a cycle pays hundreds of stars)
  prGap: 600,            // seconds between two PRs with 0 contributors (÷ √(1 + lifetime))
  prMax: 3,              // open PRs at most
};

/* ---------------- Fork talents (paid in contributors, never reset) ---------------- */
export interface ForkTalent {
  id: string;
  tag: string;   // short text tag shown in the tree (no emojis)
  cost: number;
  req: string[];
}

export const FORK_TALENTS: ForkTalent[] = [
  { id: "f_template", tag: "tpl", cost: 1, req: [] },                 // each fork starts with 5 stars
  { id: "f_iac", tag: "iac", cost: 1, req: ["f_template"] },          // Auto-Scaling sold before the 1st release, 1 000 cr
  { id: "f_sponsors", tag: "spn", cost: 2, req: ["f_template"] },     // rewards ×2
  { id: "f_lts", tag: "lts", cost: 2, req: ["f_iac"] },               // release threshold ×1.15 per release instead of ×1.2
  { id: "f_mirrors", tag: "mir", cost: 3, req: ["f_sponsors"] },      // a fork keeps half the hardware generations
  { id: "f_bench", tag: "bch", cost: 3, req: ["f_sponsors"] },        // builds ×1.5 faster
  { id: "f_dependabot", tag: "dpb", cost: 5, req: ["f_lts"] },        // common build events are caught automatically
  { id: "f_awesome", tag: "awe", cost: 5, req: ["f_mirrors", "f_bench"] }, // stars ×1.5
  { id: "f_keep", tag: "kp", cost: 8, req: ["f_dependabot"] },        // a fork keeps the Auto-Scaling branch talents
  { id: "f_upstream", tag: "ups", cost: 13, req: ["f_awesome", "f_keep"] }, // contributors ×1.5
];
export const FORK_TALENT_BY_ID = Object.fromEntries(FORK_TALENTS.map(t => [t.id, t]));
export const hasFork = (s: GameState, id: string) => s.forkTalents.includes(id);

/** Release talents a fork keeps with `f_keep`. */
export const KEPT_BY_F_KEEP = ["ci_preinstalled", "as_perm", "as_fast", "as_ctrl", "as_jobs"];
export const TEMPLATE_STARS = 5;

/* ---------------- Fork condition and contributors ---------------- */
export const forkRevealed = (s: GameState) => s.forks > 0 || s.talents.includes("release_bot") ||
  TALENTS.filter(t => t.req.length && t.req.every(r => s.talents.includes(r))).some(t => t.id === "release_bot");
export const treeComplete = (s: GameState) => TALENTS.every(t => s.talents.includes(t.id));
export const canFork = (s: GameState) => !s.challenge && treeComplete(s) && contributorsOnFork(s).gte(1);

function curve(ratio: Decimal): Decimal {
  if (ratio.lt(1)) return new Decimal(0);
  return ratio.log2().mul(FORK.earlyK).add(1).max(ratio.pow(FORK.lateExp));
}

export function contributorMultiplier(s: GameState): number {
  const gens = s.gens.cpu + s.gens.ram + s.gens.disk;
  let m = (1 + FORK.genBonus * gens) * (1 + FORK.chalBonus * s.challengesDone.length);
  if (hasFork(s, "f_upstream")) m *= 1.5;
  return m;
}

/** Contributors the fork would pay right now, before rounding down. */
export function contributorsExact(s: GameState): Decimal {
  if (s.challenge || !treeComplete(s)) return new Decimal(0);
  const base = curve(s.lifetimeStars.div(FORK.starsBase));
  if (base.lt(1)) return new Decimal(0);
  return base.mul(contributorMultiplier(s));
}
export const contributorsOnFork = (s: GameState) => contributorsExact(s).floor();

/** Stars to earn in this cycle for the first contributor. */
export const starsForFirstContributor = () => FORK.starsBase;

/* ---------------- Passive bonuses ---------------- */
export const contribGainsMult = (s: GameState) => 1 + FORK.gainsPer * Math.pow(s.lifetimeContributors, FORK.gainsExp);
export const contribStarsMult = (s: GameState) => 1 + FORK.starsPer * s.lifetimeContributors;

/* ---------------- Pull requests ---------------- */
export type PrKind = "perf" | "feat" | "docs" | "ci";
export interface PullRequest { n: number; kind: PrKind; title: number }

/** What merging a PR gives. perf/feat/ci last until the next release; docs pays now. */
export const PR_EFFECTS: Record<PrKind, { weight: number; mult?: number; seconds?: number }> = {
  perf: { weight: 3, mult: 1.2 },     // builds ×1.2 faster
  feat: { weight: 3, mult: 1.25 },    // rewards ×1.25
  docs: { weight: 2, seconds: 120 },  // +2 min of income
  ci: { weight: 1, mult: 1.05 },      // stars ×1.05 on the next release
};
export const PR_TITLES = 6; // titles per kind in i18n (pr.<kind>.0 … 5)

export const prGap = (s: GameState) => FORK.prGap / Math.sqrt(1 + s.lifetimeContributors);

export function pickPrKind(rnd = Math.random()): PrKind {
  const kinds = Object.keys(PR_EFFECTS) as PrKind[];
  const total = kinds.reduce((a, k) => a + PR_EFFECTS[k].weight, 0);
  let x = rnd * total;
  for (const k of kinds) {
    x -= PR_EFFECTS[k].weight;
    if (x < 0) return k;
  }
  return "docs";
}

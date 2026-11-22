import Decimal from "break_eternity.js";
import type { GameState } from "./state";
import { TALENTS } from "./talents";
import { distroContribMult } from "./distro";

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
  genBonus: 0.03,        // +3 % contributors per generation in the cycle's best run (gens are per run since v0.4.5)
  chalBonus: 0.1,        // +10 % contributors per challenge completed in the cycle
  // v0.4.1: the passive bonus grows logarithmically. Multipliers snowballed (more gains → more
  // stars → more contributors → shorter cycles): cycles went 3 h → 20 min → 5 min → 1 min.
  gainsLog: 0.25,        // passive: rewards × (1 + gainsLog × log2(1 + lifetime contributors))
  releaseBaseMult: 1,    // each fork makes the release threshold ×N (v0.4.1: 1, Arthur wants the same start as a new game)
  prGap: 600,            // seconds between two PRs with 0 contributors (÷ (1 + 0.5·log2(1 + lifetime)))
  prMax: 3,              // open PRs at most
};

/* ---------------- Fork talents (paid in contributors, never reset) ----------------
 * v0.4.1: they speed up the restart (stars, hardware levels, talents and automation from the
 * start of a fork) instead of multiplying rewards, so cycles get shorter without snowballing.
 * Ids kept from v0.4.0 for saves; some effects and tags changed. */
export interface ForkTalent {
  id: string;
  tag: string;   // short text tag shown in the tree (no emojis)
  cost: number;
  req: string[];
  row: number;   // position in the drawn tree (5 columns)
  col: number;
}

/* Two kinds, alternating down the tree (Arthur, v0.4.1): restart boosts (stars, levels,
 * talents, automation at the start of a fork) and fixed % bonuses (bought once). */
export const FORK_TALENTS: ForkTalent[] = [
  { id: "f_template", tag: "tpl", cost: 1, req: [], row: 0, col: 2 },                       // each fork starts with 10 stars
  { id: "f_iac", tag: "iac", cost: 1, req: ["f_template"], row: 1, col: 1 },                // Auto-Scaling sold from the start of a fork, normal price (25 % of the threshold)
  { id: "f_oc", tag: "oc", cost: 2, req: ["f_template"], row: 1, col: 3 },                  // rewards +50 %
  { id: "f_lts", tag: "lts", cost: 2, req: ["f_iac"], row: 2, col: 0 },                     // release threshold ×1.15 per release instead of ×1.2
  { id: "f_sponsors", tag: "spn", cost: 2, req: ["f_iac"], row: 2, col: 1 },                // every run starts with +10 CPU/RAM/Disk levels
  { id: "f_cdn", tag: "cdn", cost: 3, req: ["f_oc"], row: 2, col: 3 },                      // builds +25 % faster
  { id: "f_mirrors", tag: "mir", cost: 3, req: ["f_oc"], row: 2, col: 4 },                  // generations need 20 % fewer levels
  { id: "f_dependabot", tag: "dpb", cost: 5, req: ["f_lts"], row: 3, col: 0 },              // common build events are caught automatically
  { id: "f_bench", tag: "bin", cost: 3, req: ["f_sponsors", "f_cdn"], row: 3, col: 2 },     // each fork starts with inc, rev and ci owned
  { id: "f_hn", tag: "hn", cost: 5, req: ["f_mirrors"], row: 3, col: 4 },                   // stars +15 %
  { id: "f_renovate", tag: "rnv", cost: 5, req: ["f_mirrors"], row: 3, col: 3 },            // generations happen on their own (v0.4.9, per-hardware switch)
  { id: "f_keep", tag: "kp", cost: 8, req: ["f_dependabot", "f_bench"], row: 4, col: 1 },   // a fork keeps the CI and Auto-Scaling talents
  { id: "f_awesome", tag: "awe", cost: 5, req: ["f_bench", "f_hn"], row: 4, col: 3 },       // +2 stars on every release
  { id: "f_ansible", tag: "ans", cost: 8, req: ["f_keep"], row: 5, col: 0 },               // stars buy release talents, then optimizations, on their own (v0.5.5)
  { id: "f_rel", tag: "sig", cost: 8, req: ["f_keep", "f_awesome"], row: 5, col: 2 },       // contributors +10 % on every fork
  { id: "f_upstream", tag: "ups", cost: 13, req: ["f_rel"], row: 6, col: 2 },               // +2 contributors on every fork
];
export const FORK_TALENT_BY_ID = Object.fromEntries(FORK_TALENTS.map(t => [t.id, t]));
export const hasFork = (s: GameState, id: string) => s.forkTalents.includes(id);

/**
 * Same fog as the release tree: a talent is shown once its prerequisites are owned,
 * in the fog ("???") when one prerequisite is itself shown, hidden otherwise.
 */
export function forkTalentVisibility(s: GameState, id: string): "shown" | "fog" | "hidden" {
  const shown = (x: string) => hasFork(s, x) || FORK_TALENT_BY_ID[x].req.every(r => hasFork(s, r));
  if (shown(id)) return "shown";
  return FORK_TALENT_BY_ID[id].req.some(shown) ? "fog" : "hidden";
}

/** Release talents a fork keeps with `f_keep`. */
export const KEPT_BY_F_KEEP = ["ci_preinstalled", "as_perm", "as_fast", "as_ctrl", "as_jobs"];
export const TEMPLATE_STARS = 10;
/** Release talents a fork starts with when `f_bench` (prebuilt binaries) is owned. */
export const PREBUILT_TALENTS = ["warm_cache", "code_review", "ci_preinstalled"];
export const SEED_LEVELS = 10;      // f_sponsors: extra CPU/RAM/Disk levels at the start of every run
export const AWESOME_STARS = 2;     // f_awesome: flat stars added to every release
export const UPSTREAM_CONTRIBUTORS = 2; // f_upstream: flat contributors added to every fork
/** Fixed % bonuses of Fork talents (bought once, not scaling with contributors). */
export const FORK_PCT = { oc: 0.5, cdn: 0.25, hn: 0.15, rel: 0.1 };

/* ---------------- Fork upgrades (contributors, infinite levels) ----------------
 * A sink for contributors once the Fork tree is complete: small % per level, price ×2.5 per level. */
export interface ForkUpgrade { id: "fu_bounties" | "fu_mentoring"; base: number; ratio: number; pct: number }
export const FORK_UPGRADES: ForkUpgrade[] = [
  { id: "fu_bounties", base: 3, ratio: 2.5, pct: 0.1 },   // rewards +10 % per level
  { id: "fu_mentoring", base: 5, ratio: 2.5, pct: 0.03 }, // stars +3 % per level
];
export const FORK_UPGRADE_BY_ID = Object.fromEntries(FORK_UPGRADES.map(u => [u.id, u]));
export const forkUpgradeLevel = (s: GameState, id: string) => s.forkUpgrades[id] ?? 0;
export const forkUpgradePrice = (s: GameState, id: string) => {
  const u = FORK_UPGRADE_BY_ID[id];
  return Math.round(u.base * Math.pow(u.ratio, forkUpgradeLevel(s, id)));
};

/** Every % bonus of the Fork layer (talents and upgrades), by stat. */
export function forkGainsMult(s: GameState): number {
  return (1 + (hasFork(s, "f_oc") ? FORK_PCT.oc : 0)) * (1 + 0.1 * forkUpgradeLevel(s, "fu_bounties"));
}
export const forkSpeedMult = (s: GameState) => 1 + (hasFork(s, "f_cdn") ? FORK_PCT.cdn : 0);
export function forkStarsMult(s: GameState): number {
  return (1 + (hasFork(s, "f_hn") ? FORK_PCT.hn : 0)) * (1 + 0.03 * forkUpgradeLevel(s, "fu_mentoring"));
}

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
  const gens = s.stats.bestRunGens; // best run of the cycle (generations are per run)
  return (1 + FORK.genBonus * gens) * (1 + FORK.chalBonus * s.challengesDone.length) * (1 + (hasFork(s, "f_rel") ? FORK_PCT.rel : 0)) * distroContribMult(s);
}

/** Contributors the fork would pay right now, before rounding down. */
export function contributorsExact(s: GameState): Decimal {
  if (s.challenge || !treeComplete(s)) return new Decimal(0);
  const base = curve(s.lifetimeStars.div(FORK.starsBase));
  if (base.lt(1)) return new Decimal(0);
  return base.mul(contributorMultiplier(s)).add(hasFork(s, "f_upstream") ? UPSTREAM_CONTRIBUTORS : 0);
}
export const contributorsOnFork = (s: GameState) => contributorsExact(s).floor();

/** How the fork's contributors are computed, for the Fork card (Arthur: "on ne comprend pas le calcul"). */
export function contributorBreakdown(s: GameState) {
  const gens = s.stats.bestRunGens;
  const chal = s.challengesDone.length;
  const multGens = 1 + FORK.genBonus * gens;
  const multChal = 1 + FORK.chalBonus * chal;
  const multSig = hasFork(s, "f_rel") ? 1 + FORK_PCT.rel : 1;
  const multDistro = distroContribMult(s); // packages, Distro talent ctb, flavor (v0.5)
  const ups = hasFork(s, "f_upstream") ? UPSTREAM_CONTRIBUTORS : 0;
  const base = curve(s.lifetimeStars.div(FORK.starsBase));
  const total = contributorsOnFork(s).toNumber();
  // Stars of the cycle for one more contributor: invert the curve (the max of two branches → the lower inverse)
  const needBase = Math.max(1, (total + 1 - ups) / (multGens * multChal * multSig * multDistro));
  const early = new Decimal(2).pow((needBase - 1) / FORK.earlyK);
  const late = new Decimal(needBase).pow(1 / FORK.lateExp);
  const nextAt = early.min(late).mul(FORK.starsBase).ceil();
  const exact = contributorsExact(s).toNumber();
  return { stars: s.lifetimeStars, base: base.toNumber(), gens, multGens, chal, multChal, multSig, multDistro, ups, exact, total, nextAt };
}

/** Stars to earn in this cycle for the first contributor. */
export const starsForFirstContributor = () => FORK.starsBase;

/* ---------------- Passive bonuses ---------------- */
export const contribGainsMult = (s: GameState) => 1 + FORK.gainsLog * Math.log2(1 + s.lifetimeContributors);

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

export const prGap = (s: GameState) => FORK.prGap / (1 + 0.5 * Math.log2(1 + s.lifetimeContributors));

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

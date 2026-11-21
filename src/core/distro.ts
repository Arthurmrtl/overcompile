import Decimal from "break_eternity.js";
import type { GameState } from "./state";
import { FORK_TALENTS } from "./fork";

/**
 * Distro (v0.5): third prestige layer, above forks.
 *
 * Once the whole Fork tree is owned, the player can publish a distro: forks, contributors,
 * the Fork tree and Fork upgrades reset (plus everything a fork resets), and the distro pays
 * **packages** (▣), computed from the contributors earned since the last distro.
 *
 * Two ideas (Arthur, v0.5):
 * - **flavors**: each Distro cycle runs on a base the player picks (Rolling, Stable, Source,
 *   Desktop) that changes the rules until the next distro. Finishing a cycle in a flavor for
 *   the first time gives that flavor's permanent bonus;
 * - **the third layer automates the second**: the Distro tree gives back the Fork tree step by
 *   step, then automates forks (Fork bot, auto-merge, auto-buy), as the Release bot did for releases.
 *
 * Same rules as the Fork layer: logarithmic passive bonus, fixed % talents, restart boosts,
 * so nothing snowballs, and a distro never makes the game harder.
 */
export const DISTRO = {
  contribBase: 60,   // contributors earned in the cycle for the first package
  earlyK: 2,         // early curve: 1 + earlyK × log2(contributors / contribBase)
  lateExp: 0.6,      // late curve: (contributors / contribBase) ^ lateExp, whichever is higher
  contribLog: 0.2,   // passive: contributors × (1 + contribLog × log2(1 + lifetime packages))
  gainsLog: 0.25,    // passive: rewards × (1 + gainsLog × log2(1 + lifetime packages))
};

/* ---------------- Flavors ---------------- */
export type FlavorId = "rolling" | "stable" | "source" | "desktop";
export interface Flavor {
  id: FlavorId;
  tag: string;
  /** While the cycle runs on this flavor. */
  growthDelta: number;   // added to the release threshold growth (×1.2 → ×1.2 + delta)
  stars: number;         // stars ×
  contributors: number;  // contributors ×
  genPow: number;        // generation bonuses ^ (1.5: each generation is worth 1.5× as much)
  eventGap: number;      // time between build events ×
  offlineEff: number;    // offline efficiency + (points)
  offlineHours: number;  // offline duration ×
}
export const FLAVORS: Flavor[] = [
  // Rolling (Arch): releases come much faster, each pays a bit less
  { id: "rolling", tag: "arch", growthDelta: -0.1, stars: 1, contributors: 1, genPow: 1, eventGap: 1, offlineEff: 0, offlineHours: 1 },
  // Stable (Debian): slow releases, but big ones, and forks pay more
  { id: "stable", tag: "debian", growthDelta: 0.1, stars: 1.5, contributors: 1.2, genPow: 1, eventGap: 1, offlineEff: 0, offlineHours: 1 },
  // Source (Gentoo): for active play: stronger generations, twice as many build events
  { id: "source", tag: "gentoo", growthDelta: 0, stars: 1, contributors: 1, genPow: 1.25, eventGap: 0.6, offlineEff: 0, offlineHours: 1 },
  // Desktop (Ubuntu): for idle play: much better offline progress
  { id: "desktop", tag: "ubuntu", growthDelta: 0, stars: 1, contributors: 1, genPow: 1, eventGap: 1, offlineEff: 0.5, offlineHours: 2 },
];
export const FLAVOR_BY_ID = Object.fromEntries(FLAVORS.map(f => [f.id, f])) as Record<FlavorId, Flavor>;
const NO_FLAVOR: Flavor = { id: "rolling", tag: "", growthDelta: 0, stars: 1, contributors: 1, genPow: 1, eventGap: 1, offlineEff: 0, offlineHours: 1 };
export const flavorOf = (s: GameState): Flavor => (s.flavor ? FLAVOR_BY_ID[s.flavor] : NO_FLAVOR);

/** Permanent bonus for having finished a cycle in each flavor (published a distro while on it). */
export const FLAVOR_DONE = {
  rolling: 0.01,  // release threshold growth −0.01, for good
  stable: 0.1,    // stars +10 %
  source: 0.9,    // generations need ×0.9 levels
  desktop: 0.25,  // offline efficiency +25 points
};
export const flavorDone = (s: GameState, id: FlavorId) => s.flavorsDone.includes(id);

/* ---------------- Distro talents (paid in packages, never reset) ---------------- */
export interface DistroTalent { id: string; tag: string; cost: number; req: string[]; row: number; col: number }
export const DISTRO_TALENTS: DistroTalent[] = [
  { id: "d_restart", tag: "rst", cost: 1, req: [], row: 0, col: 2 },                        // a distro keeps the Fork restart talents (tpl, iac, spn, lts, bin)
  { id: "d_merge", tag: "mrg", cost: 1, req: ["d_restart"], row: 1, col: 1 },               // pull requests merge themselves
  { id: "d_pkg", tag: "pkg", cost: 2, req: ["d_restart"], row: 1, col: 3 },                 // packages +20 %
  { id: "d_forkbot", tag: "fbot", cost: 2, req: ["d_merge"], row: 2, col: 0 },              // Fork bot: forks on its own (threshold or advisor)
  { id: "d_autokeep", tag: "kpa", cost: 3, req: ["d_merge", "d_pkg"], row: 2, col: 2 },     // a distro also keeps kp, dpb, rnv, mir
  { id: "d_contrib", tag: "ctb", cost: 3, req: ["d_pkg"], row: 2, col: 4 },                 // contributors +25 %
  { id: "d_autobuy", tag: "abuy", cost: 4, req: ["d_forkbot"], row: 3, col: 1 },            // contributors buy Fork talents and upgrades on their own
  { id: "d_chal", tag: "chk", cost: 4, req: ["d_autokeep", "d_contrib"], row: 3, col: 3 },  // challenges stay done across forks (until the next distro)
  { id: "d_keepall", tag: "all", cost: 6, req: ["d_autobuy", "d_chal"], row: 4, col: 2 },   // a distro keeps the whole Fork tree
  { id: "d_upstream", tag: "ups", cost: 10, req: ["d_keepall"], row: 5, col: 2 },           // +1 package on every distro
];
export const DISTRO_TALENT_BY_ID = Object.fromEntries(DISTRO_TALENTS.map(t => [t.id, t]));
export const hasDistro = (s: GameState, id: string) => s.distroTalents.includes(id);

export function distroTalentVisibility(s: GameState, id: string): "shown" | "fog" | "hidden" {
  const shown = (x: string) => hasDistro(s, x) || DISTRO_TALENT_BY_ID[x].req.every(r => hasDistro(s, r));
  if (shown(id)) return "shown";
  return DISTRO_TALENT_BY_ID[id].req.some(shown) ? "fog" : "hidden";
}

/** Fork talents a distro keeps with d_restart, d_autokeep, d_keepall. */
export const KEPT_RESTART = ["f_template", "f_iac", "f_sponsors", "f_lts", "f_bench"];
export const KEPT_AUTO = ["f_keep", "f_dependabot", "f_renovate", "f_mirrors"];
export function forkTalentsKept(s: GameState): string[] {
  if (hasDistro(s, "d_keepall")) return FORK_TALENTS.map(t => t.id);
  const kept = [...(hasDistro(s, "d_restart") ? KEPT_RESTART : []), ...(hasDistro(s, "d_autokeep") ? KEPT_AUTO : [])];
  // A kept talent stays only with what it needs (the tree must stay a tree)
  const out: string[] = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of FORK_TALENTS) {
      if (out.includes(t.id) || !kept.includes(t.id)) continue;
      if (t.req.every(r => out.includes(r) || kept.includes(r))) { out.push(t.id); grew = true; }
    }
  }
  return out;
}
export const DISTRO_PCT = { pkg: 0.2, contrib: 0.25 };
export const UPSTREAM_PACKAGES = 1;

/* ---------------- Condition and packages ---------------- */
export const forkTreeComplete = (s: GameState) => FORK_TALENTS.every(t => s.forkTalents.includes(t.id));
export const distroRevealed = (s: GameState) => s.distros > 0 || forkTreeComplete(s);

function curve(ratio: Decimal): Decimal {
  if (ratio.lt(1)) return new Decimal(0);
  return ratio.log2().mul(DISTRO.earlyK).add(1).max(ratio.pow(DISTRO.lateExp));
}

export function packagesExact(s: GameState): Decimal {
  if (s.challenge || !forkTreeComplete(s)) return new Decimal(0);
  const base = curve(new Decimal(s.lifetimeContributors).div(DISTRO.contribBase));
  if (base.lt(1)) return new Decimal(0);
  return base.mul(hasDistro(s, "d_pkg") ? 1 + DISTRO_PCT.pkg : 1).add(hasDistro(s, "d_upstream") ? UPSTREAM_PACKAGES : 0);
}
export const packagesOnDistro = (s: GameState) => packagesExact(s).floor();
export const canDistro = (s: GameState) => packagesOnDistro(s).gte(1);

/** Contributors of the cycle needed for one more package. */
export function nextPackageAt(s: GameState): number {
  const total = packagesOnDistro(s).toNumber();
  const need = Math.max(1, (total + 1 - (hasDistro(s, "d_upstream") ? UPSTREAM_PACKAGES : 0)) / (hasDistro(s, "d_pkg") ? 1 + DISTRO_PCT.pkg : 1));
  const early = Math.pow(2, (need - 1) / DISTRO.earlyK);
  const late = Math.pow(need, 1 / DISTRO.lateExp);
  return Math.ceil(Math.min(early, late) * DISTRO.contribBase);
}

/* ---------------- Passive and flavor multipliers (used by formulas / fork) ---------------- */
export const packagesGainsMult = (s: GameState) => 1 + DISTRO.gainsLog * Math.log2(1 + s.lifetimePackages);
export function distroContribMult(s: GameState): number {
  return (1 + DISTRO.contribLog * Math.log2(1 + s.lifetimePackages)) * (hasDistro(s, "d_contrib") ? 1 + DISTRO_PCT.contrib : 1) * flavorOf(s).contributors;
}
export const distroStarsMult = (s: GameState) => flavorOf(s).stars * (flavorDone(s, "stable") ? 1 + FLAVOR_DONE.stable : 1);
export const distroGrowthDelta = (s: GameState) => flavorOf(s).growthDelta - (flavorDone(s, "rolling") ? FLAVOR_DONE.rolling : 0);
export const distroGenReqMult = (s: GameState) => (flavorDone(s, "source") ? FLAVOR_DONE.source : 1);
export const distroOfflineEff = (s: GameState) => flavorOf(s).offlineEff + (flavorDone(s, "desktop") ? FLAVOR_DONE.desktop : 0);

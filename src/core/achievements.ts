import Decimal from "break_eternity.js";
import type { GameState } from "./state";
import { CHALLENGES } from "./challenges";
import { TALENTS } from "./talents";

// Achievements double as the game's objectives: chains of tiers, never reset.
// Each one pays a reward the player claims whenever they want:
//   - early tiers: a few credits (added to the current run)
//   - later tiers: a small permanent bonus (+x% rewards, speed, stars, −x% failures)

export type BonusStat = "gains" | "speed" | "fail" | "stars";
export type Reward = { credits: number } | { stat: BonusStat; pct: number };

export type Metric = "builds" | "fails" | "earned" | "perk_ci" | "perk_as" | "cpu" | "ram" | "disk" | "jobs"
  | "streak" | "releases" | "stars" | "tree" | "opt" | "challenges" | "gens" | "events" | "forks" | "contributors" | "prs";

export interface Achievement {
  id: string;
  /** What is measured, and the value to reach (for progress bars). */
  metric?: Metric;
  target?: number;
  /** Chain it belongs to: the objectives panel shows the next tier of each chain. */
  chain: string;
  reward: Reward;
  /** Hidden (shown as ???) until the feature is discovered. */
  reveal?: "stars" | "challenges" | "fork";
  secret?: boolean;
  check: (s: GameState) => boolean;
}

/** Current value of a metric. Hardware metrics are per run (they reset at each release). */
export function metricValue(s: GameState, m: Metric): Decimal {
  switch (m) {
    case "builds": return new Decimal(s.stats.builds);
    case "fails": return new Decimal(s.stats.fails);
    case "earned": return s.totalEarned;
    case "perk_ci": return new Decimal(s.perks.ci_cd.unlocked ? 1 : 0);
    case "perk_as": return new Decimal(s.perks.auto_scaling.unlocked ? 1 : 0);
    case "cpu": case "ram": case "disk": case "jobs": return new Decimal(s.hw[m]);
    case "streak": return new Decimal(s.stats.bestStreak);
    case "releases": return new Decimal(s.releases);
    case "stars": return s.lifetimeStars;
    case "tree": return new Decimal(TALENTS.filter(t => s.talents.includes(t.id)).length);
    case "opt": return new Decimal(Object.values(s.upgrades).reduce((a, b) => a + b, 0));
    case "challenges": return new Decimal(s.challengesDone.length);
    case "events": return new Decimal(s.stats.events ?? 0);
    case "forks": return new Decimal(s.forks ?? 0);
    case "contributors": return new Decimal(s.lifetimeContributors ?? 0);
    case "prs": return new Decimal(s.stats.prsMerged ?? 0);
    case "gens": return new Decimal((s.gens?.cpu ?? 0) + (s.gens?.ram ?? 0) + (s.gens?.disk ?? 0));
  }
}
export const PER_RUN_METRICS: Metric[] = ["cpu", "ram", "disk", "jobs"];

/** Progress 0..1 towards an achievement (log scale for big numbers). */
export function achProgress(s: GameState, a: Achievement): number {
  if (!a.metric || a.target === undefined) return 0;
  const v = metricValue(s, a.metric);
  if (v.gte(a.target)) return 1;
  if (a.target >= 1e4) return Math.max(0, v.max(1).log10().toNumber() / Math.log10(a.target));
  return v.toNumber() / a.target;
}

/** Builds a tier: reaching `target` on `metric`. */
function tier(id: string, chain: string, metric: Metric, target: number, reward: Reward, reveal?: "stars" | "challenges" | "fork"): Achievement {
  return { id, chain, metric, target, reward, reveal, check: s => metricValue(s, metric).gte(target) };
}
const cr = (credits: number): Reward => ({ credits });
const gains = (pct: number): Reward => ({ stat: "gains", pct });
const speed = (pct: number): Reward => ({ stat: "speed", pct });
const fail = (pct: number): Reward => ({ stat: "fail", pct });
const stars = (pct: number): Reward => ({ stat: "stars", pct });

export const ACHIEVEMENTS: Achievement[] = [
  // Builds
  tier("first_build", "builds", "builds", 1, cr(5)),
  tier("builds_100", "builds", "builds", 100, cr(25)),
  tier("builds_1k", "builds", "builds", 1e3, cr(150)),
  tier("builds_10k", "builds", "builds", 1e4, gains(2)),
  tier("builds_100k", "builds", "builds", 1e5, speed(2)),
  tier("builds_1m", "builds", "builds", 1e6, gains(3)),
  tier("builds_10m", "builds", "builds", 1e7, speed(3)),
  // Failures (one-off, for the lore)
  tier("first_fail", "misc", "fails", 1, cr(5)),
  // Credits earned (all time)
  tier("credits_1k", "credits", "earned", 1e3, cr(100)),
  tier("credits_10k", "credits", "earned", 1e4, cr(1000)),
  tier("credits_1m", "credits", "earned", 1e6, gains(2)),
  tier("credits_1b", "credits", "earned", 1e9, gains(3)),
  tier("credits_1t", "credits", "earned", 1e12, gains(5)),
  tier("credits_1qa", "credits", "earned", 1e15, gains(5)),
  // Perks
  tier("ci_cd", "perk_ci", "perk_ci", 1, cr(10)),
  tier("auto_scaling", "perk_as", "perk_as", 1, cr(300)),
  // Hardware (within one run)
  tier("cpu_10", "cpu", "cpu", 10, cr(25)),
  tier("cpu_25", "cpu", "cpu", 25, cr(300)),
  tier("cpu_50", "cpu", "cpu", 50, speed(2)),
  tier("cpu_100", "cpu", "cpu", 100, speed(3)),
  tier("cpu_250", "cpu", "cpu", 250, speed(5)),
  tier("ram_25", "ram", "ram", 25, cr(200)),
  tier("ram_50", "ram", "ram", 50, gains(2)),
  tier("ram_100", "ram", "ram", 100, gains(3)),
  tier("ram_250", "ram", "ram", 250, gains(5)),
  tier("disk_25", "disk", "disk", 25, cr(200)),
  tier("disk_50", "disk", "disk", 50, fail(2)),
  tier("disk_100", "disk", "disk", 100, fail(3)),
  tier("disk_250", "disk", "disk", 250, fail(5)),
  tier("jobs_2", "jobs", "jobs", 2, cr(50)),
  tier("jobs_4", "jobs", "jobs", 4, cr(500)),
  tier("jobs_8", "jobs", "jobs", 8, speed(2)),
  tier("jobs_16", "jobs", "jobs", 16, speed(3)),
  // Success streak
  tier("streak_25", "streak", "streak", 25, cr(200)),
  tier("streak_100", "streak", "streak", 100, gains(2)),
  tier("streak_500", "streak", "streak", 500, fail(3)),
  // Releases
  tier("release_1", "releases", "releases", 1, gains(2), "stars"),
  tier("release_5", "releases", "releases", 5, stars(2), "stars"),
  tier("release_10", "releases", "releases", 10, stars(3), "stars"),
  tier("release_25", "releases", "releases", 25, gains(5), "stars"),
  tier("release_50", "releases", "releases", 50, stars(5), "stars"),
  // Stars earned
  tier("stars_10", "stars", "stars", 10, gains(2), "stars"),
  tier("stars_100", "stars", "stars", 100, stars(3), "stars"),
  tier("stars_1k", "stars", "stars", 1e3, gains(5), "stars"),
  tier("stars_10k", "stars", "stars", 1e4, stars(5), "stars"),
  // Tree & optimizations
  tier("tree_full", "tree", "tree", TALENTS.length, gains(5), "stars"),
  tier("opt_25", "opt", "opt", 25, speed(3), "stars"),
  tier("opt_100", "opt", "opt", 100, speed(5), "stars"),
  // Fork (v0.4)
  tier("fork_1", "forks", "forks", 1, stars(5), "fork"),
  tier("fork_5", "forks", "forks", 5, gains(5), "fork"),
  tier("fork_20", "forks", "forks", 20, stars(5), "fork"),
  tier("contrib_10", "contributors", "contributors", 10, gains(3), "fork"),
  tier("contrib_100", "contributors", "contributors", 100, stars(3), "fork"),
  tier("prs_10", "prs", "prs", 10, gains(2), "fork"),
  tier("prs_100", "prs", "prs", 100, speed(3), "fork"),
  // Build events
  tier("events_10", "events", "events", 10, gains(2)),
  tier("events_100", "events", "events", 100, gains(3)),
  tier("events_500", "events", "events", 500, gains(5)),
  // Hardware generations
  tier("gen_1", "gens", "gens", 1, gains(2), "stars"),
  tier("gen_5", "gens", "gens", 5, speed(3), "stars"),
  tier("gen_10", "gens", "gens", 10, gains(5), "stars"),
  tier("gen_20", "gens", "gens", 20, stars(5), "stars"),
  // Challenges
  tier("challenge_1", "challenges", "challenges", 1, gains(3), "challenges"),
  tier("challenge_all", "challenges", "challenges", CHALLENGES.length, stars(5), "challenges"),
  // Secrets, granted by terminal commands or actions
  { id: "interrupt", chain: "secret", secret: true, reward: gains(1), check: s => s.stats.interrupts >= 1 },
  { id: "sudo", chain: "secret", secret: true, reward: gains(1), check: () => false },
  { id: "hack", chain: "secret", secret: true, reward: gains(1), check: () => false },
  { id: "rm_rf", chain: "secret", secret: true, reward: gains(1), check: () => false },
];

export const ACH_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

/** Sum of the claimed bonuses for one stat, in %. */
export function achBonus(s: GameState, stat: BonusStat): number {
  let pct = 0;
  for (const id of s.achClaimed) {
    const r = ACH_BY_ID[id]?.reward;
    if (r && "stat" in r && r.stat === stat) pct += r.pct;
  }
  return pct;
}

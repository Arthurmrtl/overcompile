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

export interface Achievement {
  id: string;
  /** Chain it belongs to: the objectives panel shows the next tier of each chain. */
  chain: string;
  reward: Reward;
  /** Hidden (shown as ???) until the feature is discovered. */
  reveal?: "stars" | "challenges";
  secret?: boolean;
  check: (s: GameState) => boolean;
}

const earned = (s: GameState, n: number) => s.totalEarned.gte(new Decimal(n));
const cr = (credits: number): Reward => ({ credits });
const gains = (pct: number): Reward => ({ stat: "gains", pct });
const speed = (pct: number): Reward => ({ stat: "speed", pct });
const fail = (pct: number): Reward => ({ stat: "fail", pct });
const stars = (pct: number): Reward => ({ stat: "stars", pct });
const optLevels = (s: GameState) => Object.values(s.upgrades).reduce((a, b) => a + b, 0);

export const ACHIEVEMENTS: Achievement[] = [
  // Builds
  { id: "first_build", chain: "builds", reward: cr(5), check: s => s.stats.builds >= 1 },
  { id: "builds_100", chain: "builds", reward: cr(25), check: s => s.stats.builds >= 100 },
  { id: "builds_1k", chain: "builds", reward: cr(150), check: s => s.stats.builds >= 1e3 },
  { id: "builds_10k", chain: "builds", reward: gains(2), check: s => s.stats.builds >= 1e4 },
  { id: "builds_100k", chain: "builds", reward: speed(2), check: s => s.stats.builds >= 1e5 },
  { id: "builds_1m", chain: "builds", reward: gains(3), check: s => s.stats.builds >= 1e6 },
  { id: "builds_10m", chain: "builds", reward: speed(3), check: s => s.stats.builds >= 1e7 },
  // Failures (one-off, for the lore)
  { id: "first_fail", chain: "misc", reward: cr(5), check: s => s.stats.fails >= 1 },
  // Credits earned (all time)
  { id: "credits_1k", chain: "credits", reward: cr(100), check: s => earned(s, 1e3) },
  { id: "credits_10k", chain: "credits", reward: cr(1000), check: s => earned(s, 1e4) },
  { id: "credits_1m", chain: "credits", reward: gains(2), check: s => earned(s, 1e6) },
  { id: "credits_1b", chain: "credits", reward: gains(3), check: s => earned(s, 1e9) },
  { id: "credits_1t", chain: "credits", reward: gains(5), check: s => earned(s, 1e12) },
  { id: "credits_1qa", chain: "credits", reward: gains(5), check: s => earned(s, 1e15) },
  // Perks
  { id: "ci_cd", chain: "perks", reward: cr(10), check: s => s.perks.ci_cd.unlocked },
  { id: "auto_scaling", chain: "perks", reward: cr(300), check: s => s.perks.auto_scaling.unlocked },
  // Hardware
  { id: "cpu_10", chain: "cpu", reward: cr(25), check: s => s.hw.cpu >= 10 },
  { id: "cpu_25", chain: "cpu", reward: cr(300), check: s => s.hw.cpu >= 25 },
  { id: "cpu_50", chain: "cpu", reward: speed(2), check: s => s.hw.cpu >= 50 },
  { id: "cpu_100", chain: "cpu", reward: speed(3), check: s => s.hw.cpu >= 100 },
  { id: "cpu_250", chain: "cpu", reward: speed(5), check: s => s.hw.cpu >= 250 },
  { id: "ram_25", chain: "ram", reward: cr(200), check: s => s.hw.ram >= 25 },
  { id: "ram_50", chain: "ram", reward: gains(2), check: s => s.hw.ram >= 50 },
  { id: "ram_100", chain: "ram", reward: gains(3), check: s => s.hw.ram >= 100 },
  { id: "ram_250", chain: "ram", reward: gains(5), check: s => s.hw.ram >= 250 },
  { id: "disk_25", chain: "disk", reward: cr(200), check: s => s.hw.disk >= 25 },
  { id: "disk_50", chain: "disk", reward: fail(2), check: s => s.hw.disk >= 50 },
  { id: "disk_100", chain: "disk", reward: fail(3), check: s => s.hw.disk >= 100 },
  { id: "disk_250", chain: "disk", reward: fail(5), check: s => s.hw.disk >= 250 },
  { id: "jobs_2", chain: "jobs", reward: cr(50), check: s => s.hw.jobs >= 2 },
  { id: "jobs_4", chain: "jobs", reward: cr(500), check: s => s.hw.jobs >= 4 },
  { id: "jobs_8", chain: "jobs", reward: speed(2), check: s => s.hw.jobs >= 8 },
  { id: "jobs_16", chain: "jobs", reward: speed(3), check: s => s.hw.jobs >= 16 },
  // Success streak
  { id: "streak_25", chain: "streak", reward: cr(200), check: s => s.stats.bestStreak >= 25 },
  { id: "streak_100", chain: "streak", reward: gains(2), check: s => s.stats.bestStreak >= 100 },
  { id: "streak_500", chain: "streak", reward: fail(3), check: s => s.stats.bestStreak >= 500 },
  // Releases
  { id: "release_1", chain: "releases", reveal: "stars", reward: gains(2), check: s => s.releases >= 1 },
  { id: "release_5", chain: "releases", reveal: "stars", reward: stars(2), check: s => s.releases >= 5 },
  { id: "release_10", chain: "releases", reveal: "stars", reward: stars(3), check: s => s.releases >= 10 },
  { id: "release_25", chain: "releases", reveal: "stars", reward: gains(5), check: s => s.releases >= 25 },
  { id: "release_50", chain: "releases", reveal: "stars", reward: stars(5), check: s => s.releases >= 50 },
  // Stars earned
  { id: "stars_10", chain: "stars", reveal: "stars", reward: gains(2), check: s => s.lifetimeStars.gte(10) },
  { id: "stars_100", chain: "stars", reveal: "stars", reward: stars(3), check: s => s.lifetimeStars.gte(100) },
  { id: "stars_1k", chain: "stars", reveal: "stars", reward: gains(5), check: s => s.lifetimeStars.gte(1e3) },
  { id: "stars_10k", chain: "stars", reveal: "stars", reward: stars(5), check: s => s.lifetimeStars.gte(1e4) },
  // Tree & optimizations
  { id: "tree_full", chain: "tree", reveal: "stars", reward: gains(5), check: s => TALENTS.every(t => s.talents.includes(t.id)) },
  { id: "opt_25", chain: "opt", reveal: "stars", reward: speed(3), check: s => optLevels(s) >= 25 },
  { id: "opt_100", chain: "opt", reveal: "stars", reward: speed(5), check: s => optLevels(s) >= 100 },
  // Challenges
  { id: "challenge_1", chain: "challenges", reveal: "challenges", reward: gains(3), check: s => s.challengesDone.length >= 1 },
  { id: "challenge_all", chain: "challenges", reveal: "challenges", reward: stars(5), check: s => CHALLENGES.every(c => s.challengesDone.includes(c.id)) },
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

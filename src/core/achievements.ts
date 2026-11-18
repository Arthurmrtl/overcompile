import Decimal from "break_eternity.js";
import type { GameState } from "./state";
import { CHALLENGES } from "./challenges";
import { TALENTS } from "./talents";

export interface Achievement {
  id: string;
  secret?: boolean;
  check: (s: GameState) => boolean;
}

const earned = (s: GameState, n: number) => s.totalEarned.gte(new Decimal(n));

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_build", check: s => s.stats.builds >= 1 },
  { id: "first_fail", check: s => s.stats.fails >= 1 },
  { id: "builds_100", check: s => s.stats.builds >= 100 },
  { id: "builds_10k", check: s => s.stats.builds >= 1e4 },
  { id: "builds_1m", check: s => s.stats.builds >= 1e6 },
  { id: "credits_1k", check: s => earned(s, 1e3) },
  { id: "credits_1m", check: s => earned(s, 1e6) },
  { id: "credits_1b", check: s => earned(s, 1e9) },
  { id: "credits_1t", check: s => earned(s, 1e12) },
  { id: "ci_cd", check: s => s.perks.ci_cd.unlocked },
  { id: "auto_scaling", check: s => s.perks.auto_scaling.unlocked },
  { id: "cpu_25", check: s => s.hw.cpu >= 25 },
  { id: "cpu_100", check: s => s.hw.cpu >= 100 },
  { id: "ram_50", check: s => s.hw.ram >= 50 },
  { id: "disk_50", check: s => s.hw.disk >= 50 },
  { id: "jobs_4", check: s => s.hw.jobs >= 4 },
  { id: "jobs_16", check: s => s.hw.jobs >= 16 },
  { id: "streak_25", check: s => s.stats.bestStreak >= 25 },
  { id: "release_1", check: s => s.releases >= 1 },
  { id: "release_10", check: s => s.releases >= 10 },
  { id: "stars_100", check: s => s.lifetimeStars.gte(100) },
  { id: "tree_full", check: s => TALENTS.every(t => s.talents.includes(t.id)) },
  { id: "opt_25", check: s => Object.values(s.upgrades).reduce((a, b) => a + b, 0) >= 25 },
  { id: "challenge_1", check: s => s.challengesDone.length >= 1 },
  { id: "challenge_all", check: s => CHALLENGES.every(c => s.challengesDone.includes(c.id)) },
  // Secret ones are granted by terminal commands
  { id: "interrupt", secret: true, check: s => s.stats.interrupts >= 1 },
  { id: "sudo", secret: true, check: () => false },
  { id: "hack", secret: true, check: () => false },
  { id: "rm_rf", secret: true, check: () => false },
];

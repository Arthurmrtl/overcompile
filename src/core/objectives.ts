import type { GameState } from "./state";

// First-run objectives: short goals until the first release, each paying a few credits.
// They only exist before the first release (onboarding), and are done once.

export interface Objective {
  id: string;
  reward: number; // credits
  check: (s: GameState) => boolean;
}

export const OBJECTIVES: Objective[] = [
  { id: "o_first_build", reward: 5, check: s => s.stats.builds >= 1 },
  { id: "o_ci", reward: 10, check: s => s.perks.ci_cd.unlocked },
  { id: "o_cpu10", reward: 25, check: s => s.hw.cpu >= 10 },
  { id: "o_jobs2", reward: 50, check: s => s.hw.jobs >= 2 },
  { id: "o_1k", reward: 100, check: s => s.runEarned.gte(1e3) },
  { id: "o_streak25", reward: 200, check: s => s.stats.bestStreak >= 25 },
  { id: "o_autoscale", reward: 300, check: s => s.perks.auto_scaling.unlocked },
  { id: "o_jobs4", reward: 500, check: s => s.hw.jobs >= 4 },
  { id: "o_10k", reward: 1000, check: s => s.runEarned.gte(1e4) },
];

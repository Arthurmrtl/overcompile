// Challenges: a run with a constraint. Starting one resets the current run
// (no stars). Reaching the goal (enough credits earned for a release) completes
// it for good and grants a permanent bonus; the constraint is then lifted.

export interface Challenge {
  id: string;
  /** Goal = this fraction of the credits needed for the next release. */
  goal: number;
}

export const CHALLENGES: Challenge[] = [
  { id: "single_core", goal: 0.02 }, // CPU and Jobs locked at 1          → builds ×1.5 faster
  { id: "debug_build", goal: 0.1 }, // builds 10× slower                → rewards ×2
  { id: "friday", goal: 0.5 }, // ≥ 50% failures, rewards ×2        → failures ×0.75
  { id: "no_cache", goal: 0.2 }, // release tree disabled            → stars ×1.5
];

/** Releases needed before challenges unlock. */
export const CHALLENGES_UNLOCK_AT = 3;

import Decimal from "break_eternity.js";
import { packagesExact, packagesOnDistro } from "./distro";
import type { GameState } from "./state";
import { starsExact, starsOnRelease } from "./formulas";
import { contributorsExact, contributorsOnFork } from "./fork";

/**
 * Release advisor: tracks how fast the current run produces stars and says when
 * publishing is worth it. Stars per run grow slower and slower (log / power curve),
 * so past a point waiting only lowers the stars-per-minute rate.
 *
 * Advised when at least one star is available and either
 *  - the stars/min rate has dropped below ADV.peakDrop × its best value of this run, or
 *  - the release alone adds ADV.lifetimeShare × the lifetime stars (big boost).
 * Never during a challenge (a challenge run cannot be released).
 */
export const ADV = {
  peakDrop: 0.9,       // advise once the stars/min rate falls below this share of its peak
  lifetimeShare: 0.5,  // …or once the release alone adds this share of the lifetime stars
  minWindowMin: 5,     // see below
};
// minWindowMin: the rate is measured over at least this many minutes. Every release raises
// the next threshold (releaseGrowth), so very short runs are never worth it even if their
// first-minute rate looks great.

export interface Advice {
  pending: Decimal;   // stars on release now (rounded down)
  rate: number;       // stars per minute, this run
  peak: number;       // best stars per minute seen this run
  advised: boolean;
}

export class ReleaseAdvisor {
  private peak = 0;
  private lastRunTime = 0;
  private lastRelease = -1;

  update(s: GameState): Advice {
    // New run (release, challenge start/exit, load): forget the previous peak
    if (s.stats.runTime < this.lastRunTime || s.releases !== this.lastRelease) this.peak = 0;
    this.lastRunTime = s.stats.runTime;
    this.lastRelease = s.releases;

    const pending = starsOnRelease(s);
    const minutes = Math.max(s.stats.runTime / 60, ADV.minWindowMin);
    const exact = starsExact(s).toNumber();
    const rate = Number.isFinite(exact) ? exact / minutes : Infinity;
    if (pending.gte(1) && rate > this.peak) this.peak = rate;

    let advised = false;
    if (!s.challenge && pending.gte(1)) {
      advised = rate < this.peak * ADV.peakDrop || pending.gte(s.lifetimeStars.mul(ADV.lifetimeShare).max(1));
    }
    return { pending, rate, peak: this.peak, advised };
  }
}

/**
 * Fork advisor (v0.4): same idea one layer up. Contributors per minute of the current cycle
 * (time since the last fork, 20 min minimum); advised once the tree is complete and the rate
 * falls under its peak, or when the fork alone adds half the contributors ever earned.
 */
export const FORK_ADV = { peakDrop: 0.9, lifetimeShare: 1, minWindowMin: 30 };

export interface ForkAdvice {
  pending: number;   // contributors on fork now (rounded down)
  rate: number;      // contributors per hour, this cycle
  peak: number;
  advised: boolean;
}

export class ForkAdvisor {
  private peak = 0;
  private lastForks = -1;

  update(s: GameState): ForkAdvice {
    if (s.forks !== this.lastForks) { this.peak = 0; this.lastForks = s.forks; }
    const pending = contributorsOnFork(s).toNumber();
    const hours = Math.max(s.stats.forkTime / 60, FORK_ADV.minWindowMin) / 60;
    const rate = contributorsExact(s).toNumber() / hours;
    if (pending >= 1 && rate > this.peak) this.peak = rate;
    const advised = pending >= 1 && !s.challenge &&
      (rate < this.peak * FORK_ADV.peakDrop || pending >= Math.max(1, s.lifetimeContributors * FORK_ADV.lifetimeShare));
    return { pending, rate, peak: this.peak, advised };
  }
}

/**
 * Distro advisor (v0.5): packages per hour of the current Distro cycle (60 min minimum);
 * advised when the rate falls under its peak, or when the distro alone doubles the packages ever earned.
 */
export const DISTRO_ADV = { peakDrop: 0.9, lifetimeShare: 1, minWindowMin: 60 };

export interface DistroAdvice { pending: number; rate: number; peak: number; advised: boolean }

export class DistroAdvisor {
  private peak = 0;
  private lastDistros = -1;

  update(s: GameState): DistroAdvice {
    if (s.distros !== this.lastDistros) { this.peak = 0; this.lastDistros = s.distros; }
    const pending = packagesOnDistro(s).toNumber();
    const hours = Math.max(s.stats.distroTime / 60, DISTRO_ADV.minWindowMin) / 60;
    const rate = packagesExact(s).toNumber() / hours;
    if (pending >= 1 && rate > this.peak) this.peak = rate;
    const advised = pending >= 1 && !s.challenge &&
      (rate < this.peak * DISTRO_ADV.peakDrop || pending >= Math.max(1, s.lifetimePackages * DISTRO_ADV.lifetimeShare));
    return { pending, rate, peak: this.peak, advised };
  }
}

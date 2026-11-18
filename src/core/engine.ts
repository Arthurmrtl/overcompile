import Decimal from "break_eternity.js";
import { ACHIEVEMENTS } from "./achievements";
import { CHALLENGES, CHALLENGES_UNLOCK_AT } from "./challenges";
import { OBJECTIVES } from "./objectives";
import {
  HW, PERK_PRICE, OFFLINE_GRACE_SECONDS, autoScaleInterval, bulkPrice, buildTime, challengeGoal, failProbability,
  has, inChallenge, maxAffordable, offlineCapSeconds, offlineEfficiency, on, price, reward, starsOnRelease,
} from "./formulas";
import { TALENT_BY_ID } from "./talents";
import { UPGRADE_BY_ID, optBootLevels, upgradeMaxed, upgradePrice } from "./upgrades";
import {
  type BuyAmount, type GameState, type HwKey, type PerkKey, SAVE_KEY, deserialize, newState, serialize,
} from "./state";

export type GameEvent =
  | { t: "builds"; ok: number; fail: number; credits: Decimal }
  | { t: "pipeline_start" }
  | { t: "pipeline_done" }
  | { t: "interrupted" }
  | { t: "achievement"; id: string }
  | { t: "autobuy"; key: HwKey; n: number }
  | { t: "release"; stars: Decimal; auto: boolean }
  | { t: "challenge_start"; id: string }
  | { t: "challenge_done"; id: string }
  | { t: "challenge_exit"; id: string }
  | { t: "objective"; id: string; reward: number };

export type BuyResult = { ok: true; n: number } | { ok: false; reason: "credits" | "max" | "locked" | "owned" | "stars" | "req" };

export class Engine {
  s: GameState;
  private listeners: ((e: GameEvent) => void)[] = [];
  private muted = false;
  private autoScaleTimer = 0;

  constructor(state?: GameState) {
    this.s = state ?? newState();
  }

  on(fn: (e: GameEvent) => void) {
    this.listeners.push(fn);
  }
  private emit(e: GameEvent) {
    if (!this.muted) for (const fn of this.listeners) fn(e);
  }

  /* ---------------- Persistence ---------------- */
  static load(): Engine {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) return new Engine(deserialize(raw));
    } catch (err) {
      console.error("Failed to load save", err);
    }
    return new Engine();
  }
  save() {
    this.s.lastSeen = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, serialize(this.s));
    } catch (err) {
      console.error("Failed to save", err);
    }
  }
  replaceState(s: GameState) {
    this.s = s;
  }

  /* ---------------- Compile pipeline ---------------- */
  compile(): boolean {
    if (this.s.pipeline) return false;
    this.s.pipeline = true;
    for (const slot of this.s.slots) {
      slot.running = true;
      slot.progress = 0;
    }
    this.emit({ t: "pipeline_start" });
    return true;
  }

  interrupt(): boolean {
    if (!this.s.pipeline) return false;
    this.s.pipeline = false;
    for (const slot of this.s.slots) {
      slot.running = false;
      slot.progress = 0;
    }
    this.s.stats.interrupts++;
    this.emit({ t: "interrupted" });
    this.checkAchievements();
    return true;
  }

  get ciActive() {
    return this.s.perks.ci_cd.enabled;
  }

  /* ---------------- Main tick ---------------- */
  tick(dt: number) {
    const s = this.s;
    s.stats.playTime += dt;
    s.stats.runTime += dt;

    if (s.pipeline) this.advanceBuilds(dt);

    // Auto-Scaling: buys the cheapest affordable upgrade (every 2 s, 0.25 s with `fast`)
    this.autoScaleTimer += dt;
    if (s.perks.auto_scaling.enabled && this.autoScaleTimer >= autoScaleInterval(s)) {
      this.autoScaleTimer = 0;
      this.autoScale();
    }

    // Challenge completion
    if (s.challenge && s.runEarned.gte(challengeGoal(s))) {
      const id = s.challenge;
      s.challenge = null;
      s.challengesDone.push(id);
      this.emit({ t: "challenge_done", id });
    }

    // Release bot
    if (on(s, "release_bot") && s.autoRelease.enabled && !s.challenge && starsOnRelease(s).gte(Math.max(1, s.autoRelease.threshold))) {
      this.release(true);
    }

    this.checkObjectives();
    this.checkAchievements();
  }

  /** First-run objectives (before the first release only). */
  checkObjectives() {
    const s = this.s;
    if (s.releases > 0 || s.objectives.length >= OBJECTIVES.length) return;
    for (const o of OBJECTIVES) {
      if (!s.objectives.includes(o.id) && o.check(s)) {
        s.objectives.push(o.id);
        this.emit({ t: "objective", id: o.id, reward: o.reward });
      }
    }
  }

  /** Completed objectives waiting to be claimed. */
  pendingObjectives() {
    return OBJECTIVES.filter(o => this.s.objectives.includes(o.id) && !this.s.objClaimed.includes(o.id));
  }

  /** Claims one objective (or all pending ones). Returns the credits gained. */
  claimObjectives(id?: string): number {
    let total = 0;
    for (const o of this.pendingObjectives()) {
      if (id && o.id !== id) continue;
      this.s.objClaimed.push(o.id);
      this.s.credits = this.s.credits.add(o.reward);
      total += o.reward;
    }
    return total;
  }

  private advanceBuilds(dt: number) {
    const s = this.s;
    const T = buildTime(s);
    const ci = this.ciActive;
    let completions = 0;

    for (const slot of s.slots) {
      if (!slot.running) {
        if (!ci) continue;
        slot.running = true; // CI/CD restarts idle runners
        slot.progress = 0;
      }
      slot.progress += dt / T;
      if (slot.progress >= 1) {
        if (ci) {
          const n = Math.floor(slot.progress);
          completions += n;
          slot.progress -= n;
        } else {
          completions += 1;
          slot.running = false;
          slot.progress = 0;
        }
      }
    }

    if (completions > 0) this.resolveBuilds(completions);

    if (!ci && s.slots.every(sl => !sl.running)) {
      s.pipeline = false;
      this.emit({ t: "pipeline_done" });
    }
  }

  private resolveBuilds(n: number) {
    const s = this.s;
    const p = failProbability(s);
    let ok: number;
    if (n <= 64) {
      ok = 0;
      for (let i = 0; i < n; i++) {
        if (Math.random() < p) {
          s.stats.streak = 0;
        } else {
          ok++;
          s.stats.streak++;
          s.stats.bestStreak = Math.max(s.stats.bestStreak, s.stats.streak);
        }
      }
    } else {
      // Normal approximation of the binomial distribution
      const mean = n * (1 - p);
      const sd = Math.sqrt(n * p * (1 - p));
      const z = Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
      ok = Math.min(n, Math.max(0, Math.round(mean + z * sd)));
      s.stats.streak = 0;
    }
    const fail = n - ok;
    const credits = reward(s).mul(ok);
    s.credits = s.credits.add(credits);
    s.runEarned = s.runEarned.add(credits);
    s.totalEarned = s.totalEarned.add(credits);
    s.stats.builds += n;
    s.stats.fails += fail;
    this.emit({ t: "builds", ok, fail, credits });
  }

  /* ---------------- Shop ---------------- */
  buyHw(key: HwKey, amount: BuyAmount): BuyResult {
    const s = this.s;
    const level = s.hw[key];
    const max = HW[key].max;
    if (this.hwLocked(key)) return { ok: false, reason: "locked" };
    if (max !== undefined && level >= max) return { ok: false, reason: "max" };
    let n = amount === "max" ? maxAffordable(key, level, s.credits) : amount;
    if (max !== undefined) n = Math.min(n, max - level);
    if (n <= 0) return { ok: false, reason: "credits" };
    const cost = bulkPrice(key, level, n);
    if (s.credits.lt(cost)) return { ok: false, reason: "credits" };
    s.credits = s.credits.sub(cost);
    s.hw[key] += n;
    if (key === "jobs") {
      for (let i = 0; i < n; i++) s.slots.push({ progress: 0, running: s.pipeline && this.ciActive });
    }
    return { ok: true, n };
  }

  /** Single-core challenge: CPU and Jobs stay at 1. */
  hwLocked(key: HwKey) {
    return inChallenge(this.s, "single_core") && (key === "cpu" || key === "jobs");
  }

  /** Whether Auto-Scaling may buy this resource (the `ctrl` talent adds per-resource switches). */
  autoAllowed(key: HwKey) {
    const s = this.s;
    if (this.hwLocked(key)) return false;
    if (key === "jobs" && !on(s, "as_jobs")) return false;
    return on(s, "as_ctrl") ? s.autobuy[key] : true;
  }

  autoScale() {
    const s = this.s;
    const bought: Partial<Record<HwKey, number>> = {};
    // `-j`: job slots first, as soon as one is affordable
    if (this.autoAllowed("jobs")) {
      const r = this.buyHw("jobs", "max");
      if (r.ok) bought.jobs = r.n;
    }
    // then the cheapest of CPU / RAM / Disk, again and again
    const pool = (["cpu", "ram", "disk"] as HwKey[]).filter(k => this.autoAllowed(k));
    for (let guard = 0; guard < 2000; guard++) {
      let best: { k: HwKey; p: Decimal } | null = null;
      for (const k of pool) {
        const p = price(k, s.hw[k]);
        if (s.credits.gte(p) && (!best || p.lt(best.p))) best = { k, p };
      }
      if (!best) break;
      this.buyHw(best.k, 1);
      bought[best.k] = (bought[best.k] ?? 0) + 1;
    }
    for (const [key, n] of Object.entries(bought)) this.emit({ t: "autobuy", key: key as HwKey, n: n! });
  }

  buyPerk(key: PerkKey): BuyResult {
    const perk = this.s.perks[key];
    if (perk.unlocked) return { ok: false, reason: "owned" };
    if (this.s.credits.lt(PERK_PRICE[key])) return { ok: false, reason: "credits" };
    this.s.credits = this.s.credits.sub(PERK_PRICE[key]);
    perk.unlocked = true;
    perk.enabled = true;
    return { ok: true, n: 1 };
  }

  togglePerk(key: PerkKey): boolean | null {
    const perk = this.s.perks[key];
    if (!perk.unlocked) return null;
    perk.enabled = !perk.enabled;
    return perk.enabled;
  }

  /* ---------------- Release (prestige) ---------------- */
  release(auto = false): Decimal | null {
    const s = this.s;
    if (s.challenge) return null;
    const gain = starsOnRelease(s);
    if (gain.lt(1)) return null;
    s.stars = s.stars.add(gain);
    s.lifetimeStars = s.lifetimeStars.add(gain);
    s.releases++;
    if (s.stats.fastestRelease === null || s.stats.runTime < s.stats.fastestRelease) s.stats.fastestRelease = s.stats.runTime;
    this.resetRun();
    this.emit({ t: "release", stars: gain, auto });
    this.checkAchievements();
    return gain;
  }

  private resetRun() {
    const s = this.s;
    const jobs = on(s, "monorepo") && !inChallenge(s, "single_core") ? 2 : 1;
    s.credits = new Decimal(0);
    s.runEarned = new Decimal(0);
    const boot = 1 + optBootLevels(s);
    s.hw = { cpu: inChallenge(s, "single_core") ? 1 : boot, ram: boot, disk: boot, jobs };
    s.slots = Array.from({ length: jobs }, () => ({ progress: 0, running: false }));
    s.pipeline = false;
    const ci = on(s, "ci_preinstalled");
    const as = on(s, "as_perm");
    s.perks = { ci_cd: { unlocked: ci, enabled: ci }, auto_scaling: { unlocked: as, enabled: as } };
    this.autoScaleTimer = 0;
    s.stats.runTime = 0;
    s.stats.streak = 0;
    if (ci) this.compile();
  }

  canBuyTalent(id: string): BuyResult {
    const t = TALENT_BY_ID[id];
    if (!t) return { ok: false, reason: "locked" };
    if (has(this.s, id)) return { ok: false, reason: "owned" };
    if (!t.req.every(r => has(this.s, r))) return { ok: false, reason: "req" };
    if (this.s.stars.lt(t.cost)) return { ok: false, reason: "stars" };
    return { ok: true, n: 1 };
  }

  buyTalent(id: string): BuyResult {
    const r = this.canBuyTalent(id);
    if (!r.ok) return r;
    this.s.stars = this.s.stars.sub(TALENT_BY_ID[id].cost);
    this.s.talents.push(id);
    if (id === "monorepo" && this.s.hw.jobs < 2) {
      this.s.hw.jobs = 2;
      this.s.slots.push({ progress: 0, running: this.s.pipeline && this.ciActive });
    }
    if (id === "ci_preinstalled" && !this.s.perks.ci_cd.unlocked) {
      this.s.perks.ci_cd = { unlocked: true, enabled: true };
    }
    if (id === "as_perm" && !this.s.perks.auto_scaling.unlocked) {
      this.s.perks.auto_scaling = { unlocked: true, enabled: true };
    }
    this.checkAchievements();
    return r;
  }

  /* ---------------- Optimizations (infinite star upgrades) ---------------- */
  canBuyUpgrade(id: string): BuyResult {
    const u = UPGRADE_BY_ID[id];
    if (!u || (u.req && !has(this.s, u.req))) return { ok: false, reason: "locked" };
    if (upgradeMaxed(this.s, id)) return { ok: false, reason: "max" };
    if (this.s.stars.lt(upgradePrice(this.s, id))) return { ok: false, reason: "stars" };
    return { ok: true, n: 1 };
  }

  buyUpgrade(id: string): BuyResult {
    const r = this.canBuyUpgrade(id);
    if (!r.ok) return r;
    this.s.stars = this.s.stars.sub(upgradePrice(this.s, id));
    this.s.upgrades[id] = (this.s.upgrades[id] ?? 0) + 1;
    this.checkAchievements();
    return r;
  }

  /* ---------------- Challenges ---------------- */
  get challengesUnlocked() {
    return this.s.releases >= CHALLENGES_UNLOCK_AT;
  }

  startChallenge(id: string): "ok" | "locked" | "unknown" | "done" | "active" {
    if (!CHALLENGES.some(c => c.id === id)) return "unknown";
    if (!this.challengesUnlocked) return "locked";
    if (this.s.challengesDone.includes(id)) return "done";
    if (this.s.challenge) return "active";
    this.s.challenge = id;
    this.resetRun();
    this.emit({ t: "challenge_start", id });
    return "ok";
  }

  exitChallenge(): boolean {
    const id = this.s.challenge;
    if (!id) return false;
    this.s.challenge = null;
    if (id === "single_core" && on(this.s, "monorepo") && this.s.hw.jobs < 2) {
      this.s.hw.jobs = 2;
      this.s.slots.push({ progress: 0, running: this.s.pipeline && this.ciActive });
    }
    this.emit({ t: "challenge_exit", id });
    return true;
  }

  /* ---------------- Achievements ---------------- */
  grant(id: string) {
    if (this.s.achievements.includes(id)) return;
    this.s.achievements.push(id);
    this.emit({ t: "achievement", id });
  }

  checkAchievements() {
    for (const a of ACHIEVEMENTS) {
      if (!this.s.achievements.includes(a.id) && a.check(this.s)) this.grant(a.id);
    }
  }

  /* ---------------- Offline progress ---------------- */
  /**
   * Simulates time spent away. The first 5 minutes always count in full (phone
   * asleep, switching apps); beyond that, offline progress needs the `off`
   * talent and runs at its efficiency, up to its duration cap.
   * Returns a summary, or null if nothing happened.
   */
  simulateOffline(seconds: number) {
    const s = this.s;
    if (seconds < 1 || !s.pipeline || !this.ciActive) return null;
    const grace = Math.min(seconds, OFFLINE_GRACE_SECONDS);
    const beyond = Math.max(0, seconds - OFFLINE_GRACE_SECONDS);
    const eff = offlineEfficiency(s);
    const counted = Math.min(beyond, offlineCapSeconds(s));
    const simulated = grace + counted * eff;
    const before = { credits: s.totalEarned, builds: s.stats.builds, fails: s.stats.fails, cpu: s.hw.cpu, ram: s.hw.ram, disk: s.hw.disk, jobs: s.hw.jobs, releases: s.releases, stars: s.lifetimeStars };
    const steps = Math.min(2000, Math.ceil(simulated));
    const dt = simulated / steps;
    const newAchievements: string[] = [];
    const collect = (e: GameEvent) => { if (e.t === "achievement") newAchievements.push(e.id); };
    this.listeners.push(collect);
    this.muted = true;
    for (let i = 0; i < steps; i++) this.tick(dt);
    this.muted = false;
    this.listeners = this.listeners.filter(l => l !== collect);
    // Play time counts real time, not simulated time
    s.stats.playTime += seconds - simulated;
    return {
      away: seconds,
      grace,
      eff,
      unlocked: eff > 0,
      capped: beyond > counted,
      simulated,
      credits: s.totalEarned.sub(before.credits).max(0), // earned, not balance (Auto-Scaling spends it)
      builds: s.stats.builds - before.builds,
      fails: s.stats.fails - before.fails,
      upgrades: (s.hw.cpu - before.cpu) + (s.hw.ram - before.ram) + (s.hw.disk - before.disk) + (s.hw.jobs - before.jobs),
      releases: s.releases - before.releases,
      stars: s.lifetimeStars.sub(before.stars),
      achievements: newAchievements,
    };
  }

  hardReset() {
    const lang = this.s.settings.lang;
    this.s = newState();
    this.s.settings.lang = lang;
  }
}

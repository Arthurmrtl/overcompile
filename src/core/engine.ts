import Decimal from "break_eternity.js";
import { ACHIEVEMENTS, ACH_BY_ID, type Reward } from "./achievements";
import { CHALLENGES, CHALLENGES_UNLOCK_AT } from "./challenges";
import {
  HW, OFFLINE_GRACE_SECONDS, perkLocked, perkPrice, autoScaleInterval, bulkPrice, buildTime, challengeGoal, failProbability,
  expectedRate, genRequired, gensRevealed, has, starsRevealed, inChallenge, maxAffordable, offlineCapSeconds, offlineEfficiency, on, price, reward, starsOnRelease,
} from "./formulas";
import { TALENTS, TALENT_BY_ID } from "./talents";
import {
  FORK, FORK_TALENTS, FORK_UPGRADES, FORK_TALENT_BY_ID, FORK_UPGRADE_BY_ID, forkUpgradePrice, keptReleaseTalents, PR_EFFECTS, PR_TITLES, type PullRequest, SEED_LEVELS,
  PREBUILT_TALENTS, TEMPLATE_STARS,
  canFork, contributorsOnFork, hasFork, pickPrKind, prGap,
} from "./fork";
import {
  type BuildEvent, EVENT_BY_ID, EVENT_GAP, EVENT_WINDOW, PAGER_GAP_MULT, PAGER_WINDOW, eligibleEvents, pickEvent,
} from "./events";
import { UPGRADES, UPGRADE_BY_ID, optBootLevels, upgradeMaxed, upgradePrice } from "./upgrades";
import {
  DISTRO_TALENT_BY_ID, type FlavorId, FLAVOR_BY_ID, canDistro, flavorOf, forkTalentsKept, hasDistro, packagesOnDistro,
} from "./distro";
import {
  type KModule, FLAVOR_ORDER, canFuse, cratePrice, recompileCost, rerollEffects, installsFor, loadedModules, marketOpen, marketReady, marketShare, MILESTONES, moduleScore,
  moduleSlots, reached, recycleValue, rollModule, MARKET,
} from "./market";
import {
  type BuyAmount, type GameState, type GenKey, type HwKey, type OfflineRecord, type PerkKey, SAVE_KEY, GEN_KEYS, deserialize, newState, serialize,
} from "./state";

export type GameEvent =
  | { t: "builds"; ok: number; fail: number; credits: Decimal }
  | { t: "pipeline_start" }
  | { t: "pipeline_done" }
  | { t: "interrupted" }
  | { t: "achievement"; id: string }
  | { t: "autobuy"; key: HwKey; n: number }
  | { t: "autostars"; talents: string[]; opts: number }
  | { t: "release"; stars: Decimal; auto: boolean }
  | { t: "challenge_start"; id: string; auto?: boolean }
  | { t: "challenge_done"; id: string }
  | { t: "challenge_exit"; id: string; auto?: boolean }
  | { t: "generation"; key: GenKey; gen: number; auto?: boolean }
  | { t: "event_spawn"; id: string; window: number }
  | { t: "event_caught"; id: string; credits?: Decimal; builds?: number }
  | { t: "event_missed"; id: string }
  | { t: "buff_end"; id: string }
  | { t: "fork"; contributors: number; auto?: boolean }
  | { t: "distro"; packages: number; flavor: FlavorId; auto?: boolean }
  | { t: "distro_talent"; id: string }
  | { t: "fork_talent"; id: string }
  | { t: "fork_upgrade"; id: string; level: number }
  | { t: "pr_open"; pr: PullRequest }
  | { t: "pr_merged"; pr: PullRequest; credits?: Decimal }
  | { t: "market_open" }
  | { t: "module"; mod: KModule; recycled?: number }
  | { t: "crate"; mod: KModule; auto?: boolean }
  | { t: "milestone"; id: string }
  | { t: "installs"; n: number }


/** Test matrix: a challenge it started is given up after this many seconds (the sim gives up after 20 min). */
export const MATRIX_TIMEOUT = 15 * 60;
/** No cache turns the whole release tree off (no CI/CD, no Auto-Scaling): the run only moves if someone compiles
 *  and buys. In a No cache the matrix started, it plays those hands itself (v0.6.3, Arthur: "il faut quand même
 *  qu'il se fasse en auto quand on est au niveau distro"). */
export const MATRIX_HANDS = "no_cache";

export type BuyResult = { ok: true; n: number } | { ok: false; reason: "credits" | "max" | "locked" | "owned" | "stars" | "req" | "contributors" | "packages" };

/** What happened while away, counted from the engine's events (see simulateOffline). */
export interface OfflineGains {
  credits: Decimal;        // earned (not the balance: the Auto-Scaling spends it)
  hardware: number;        // hardware levels bought by the Auto-Scaling
  generations: number;
  releases: number;
  stars: Decimal;
  talents: number;         // release talents bought by Ansible
  optimizations: number;   // optimization levels bought by Ansible
  forks: number;
  contributors: number;
  forkBuys: number;        // Fork talents and upgrade levels bought by the Distro auto-buy
  prs: number;             // pull requests merged
  distros: number;         // published by crontab (v0.6)
  packages: number;
  installs: number;
  modules: number;         // kernel modules compiled
  milestones: string[];
  challenges: number;      // challenges completed (started by the Test matrix)
  achievements: string[];
}
export const newOfflineGains = (): OfflineGains => ({
  credits: new Decimal(0), hardware: 0, generations: 0, releases: 0, stars: new Decimal(0), talents: 0, optimizations: 0,
  forks: 0, contributors: 0, forkBuys: 0, prs: 0, distros: 0, packages: 0, installs: 0, modules: 0, milestones: [], challenges: 0, achievements: [],
});
function tallyOffline(g: OfflineGains, e: GameEvent) {
  switch (e.t) {
    case "builds": g.credits = g.credits.add(e.credits); break;
    case "pr_merged": if (e.credits) g.credits = g.credits.add(e.credits); g.prs++; break;
    case "autobuy": g.hardware += e.n; break;
    case "generation": g.generations++; break;
    case "release": g.releases++; g.stars = g.stars.add(e.stars); break;
    case "autostars": g.talents += e.talents.length; g.optimizations += e.opts; break;
    case "fork": g.forks++; g.contributors += e.contributors; break;
    case "fork_talent": case "fork_upgrade": g.forkBuys++; break;
    case "achievement": g.achievements.push(e.id); break;
    case "distro": g.distros++; g.packages += e.packages; break;
    case "installs": g.installs += e.n; break;
    case "crate": g.modules++; break;
    case "milestone": g.milestones.push(e.id); break;
    case "challenge_done": g.challenges++; break;
  }
}

export class Engine {
  s: GameState;
  private listeners: ((e: GameEvent) => void)[] = [];
  private muted = false;
  private autoScaleTimer = 0;
  private autoStarsTimer = 0;
  private offline = false;
  /** Build events: countdown to the next one, and the one on screen (not saved). */
  private eventTimer = Engine.nextGap(false);
  activeEvent: { id: string; left: number } | null = null;

  static nextGap(pager: boolean, rnd = Math.random()) {
    const [a, b] = EVENT_GAP;
    return (a + (b - a) * rnd) * (pager ? PAGER_GAP_MULT : 1);
  }

  constructor(state?: GameState) {
    this.s = state ?? newState();
  }

  on(fn: (e: GameEvent) => void) {
    this.listeners.push(fn);
  }
  private emit(e: GameEvent) {
    this.tap?.(e); // offline summary: sees every event, even muted ones
    if (!this.muted) for (const fn of this.listeners) fn(e);
  }
  private tap: ((e: GameEvent) => void) | null = null;

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
    s.stats.forkTime += dt;
    s.stats.distroTime += dt;

    if (s.pipeline) this.advanceBuilds(dt);
    this.tickEvents(dt);
    this.tickPrs(dt);

    // Auto-Scaling: buys the cheapest affordable upgrade (every 2 s, 0.25 s with `fast`)
    this.autoScaleTimer += dt;
    if (s.perks.auto_scaling.enabled && this.autoScaleTimer >= autoScaleInterval(s)) {
      this.autoScaleTimer = 0;
      this.autoScale();
    }

    // Fork talent `ans` (Ansible): stars buy release talents, then optimizations (4 times a second, v0.6.5;
    // it also runs right after a release). Challenges no longer stop it, except No cache (tree off).
    this.autoStarsTimer += dt;
    if (this.autoStarsTimer >= 0.25) {
      this.autoStarsTimer = 0;
      this.ansibleNow();
    }

    // Fork talent `rnv` (Renovate): generations happen on their own, per-hardware switch
    if (hasFork(s, "f_renovate") && gensRevealed(s)) {
      for (const k of GEN_KEYS) if (s.autogen[k] && this.canGenerate(k) === "ok") this.generate(k, true);
    }

    // Challenge completion
    if (s.challenge && s.runEarned.gte(challengeGoal(s))) {
      const id = s.challenge;
      s.challenge = null;
      s.challengesDone.push(id);
      this.afterChallenge(id); // v0.5.12: completing gave nothing back, only quitting did
      this.emit({ t: "challenge_done", id });
    }

    // Test matrix: a challenge it started that drags on is given up (and not retried until the next fork)
    if (this.matrixRunning && s.challenge === this.matrixRunning && s.stats.runTime > MATRIX_TIMEOUT) {
      this.matrixTried.add(this.matrixRunning);
      this.exitChallenge(true);
    }
    if (!s.challenge) this.matrixRunning = null;
    // …and in a No cache it started, it compiles, buys CI/CD, then the cheapest hardware, once a second
    if (this.matrixRunning === MATRIX_HANDS && s.challenge === MATRIX_HANDS) {
      if (!s.pipeline) this.compile();
      this.matrixHandsTimer -= dt;
      if (this.matrixHandsTimer <= 0) {
        this.matrixHandsTimer = 1;
        if (!s.perks.ci_cd.unlocked) this.buyPerk("ci_cd");
        if (!s.perks.auto_scaling.unlocked) this.buyPerk("auto_scaling");
        this.autoScale();
      }
    }

    // Release bot
    if (on(s, "release_bot") && s.autoRelease.enabled && !s.challenge && starsOnRelease(s).gte(Math.max(1, s.autoRelease.threshold))) {
      this.release(true);
    }

    // Distro talent "Fork bot" (v0.5): forks on its own at a contributor threshold (the advisor mode went in v0.6.7)
    if (hasDistro(s, "d_forkbot") && s.autoFork.enabled && !s.challenge &&
      contributorsOnFork(s).gte(Math.max(1, s.autoFork.threshold))) this.fork(true);

    // Market (v0.6): opens once the four flavors are done (also for saves that already had them)
    if (!s.market.unlocked && marketReady(s)) this.openMarket();
    // Milestone 5 % "crontab": distros publish themselves at a package threshold
    if (reached(s, "crontab") && s.market.cron.enabled && !s.challenge &&
      packagesOnDistro(s).gte(Math.max(1, s.market.cron.threshold))) this.distro(this.cronFlavor(), true);

    this.checkAchievements();
  }

  /** Unlocked achievements whose reward is waiting to be claimed. */
  pendingAchievements() {
    return ACHIEVEMENTS.filter(a => this.s.achievements.includes(a.id) && !this.s.achClaimed.includes(a.id));
  }

  /** Claims one achievement's reward (or all pending ones). Returns what was gained. */
  claimAchievements(id?: string): Reward[] {
    const got: Reward[] = [];
    for (const a of this.pendingAchievements()) {
      if (id && a.id !== id) continue;
      this.s.achClaimed.push(a.id);
      if ("credits" in a.reward) this.s.credits = this.s.credits.add(a.reward.credits);
      got.push(a.reward);
    }
    return got;
  }

  /** Reward of an achievement (for display). */
  static rewardOf(id: string): Reward | undefined {
    return ACH_BY_ID[id]?.reward;
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
    this.addCredits(credits);
    s.stats.builds += n;
    s.stats.fails += fail;
    this.emit({ t: "builds", ok, fail, credits });
  }

  /* ---------------- Build events ---------------- */
  /** Events start once CI/CD runs the builds; never offline nor during a challenge. */
  get eventsActive() {
    const s = this.s;
    return !this.offline && !s.challenge && s.pipeline && this.ciActive;
  }

  private tickEvents(dt: number) {
    const s = this.s;
    // Boosts run out
    if (s.buffs.length) {
      for (const b of s.buffs) b.left -= dt;
      for (const b of s.buffs.filter(x => x.left <= 0)) this.emit({ t: "buff_end", id: b.id });
      s.buffs = s.buffs.filter(x => x.left > 0);
    }
    // The event on screen fades away
    if (this.activeEvent) {
      this.activeEvent.left -= dt;
      if (this.activeEvent.left <= 0) {
        const id = this.activeEvent.id;
        this.activeEvent = null;
        this.emit({ t: "event_missed", id });
      }
      return;
    }
    if (!this.eventsActive) return;
    this.eventTimer -= dt;
    if (this.eventTimer > 0) return;
    const pager = has(s, "pager");
    this.eventTimer = Engine.nextGap(pager) * flavorOf(s).eventGap; // Distro flavor "Source": twice as many
    const e = pickEvent(eligibleEvents(s, starsRevealed(s)));
    const window = pager ? PAGER_WINDOW : EVENT_WINDOW;
    this.activeEvent = { id: e.id, left: window };
    this.emit({ t: "event_spawn", id: e.id, window });
    // Fork talent "dpb": common events (the most frequent ones) are caught automatically
    if (hasFork(s, "f_dependabot") && e.weight >= 10) this.catchEvent(e.id);
  }

  /** Catches the event on screen (if `id` is given, only that one). */
  catchEvent(id?: string): "ok" | "none" | "other" {
    const cur = this.activeEvent;
    if (!cur) return "none";
    if (id && cur.id !== id) return "other";
    this.activeEvent = null;
    const e = EVENT_BY_ID[cur.id] as BuildEvent;
    const s = this.s;
    s.stats.events++;
    const fx = e.effect;
    let credits: Decimal | undefined;
    let builds: number | undefined;
    switch (fx.kind) {
      case "speed": case "gains": case "nofail": {
        const same = s.buffs.find(b => b.id === e.id);
        if (same) same.left = Math.max(same.left, fx.seconds); // catching it again refreshes it
        else s.buffs.push({ id: e.id, left: fx.seconds });
        break;
      }
      case "income":
        credits = expectedRate(s).mul(fx.seconds);
        this.addCredits(credits);
        break;
      case "instant": {
        builds = s.hw.jobs * fx.rounds;
        this.resolveBuilds(builds);
        break;
      }
      case "stars":
        s.rcPending = true;
        break;
    }
    this.emit({ t: "event_caught", id: e.id, credits, builds });
    this.checkAchievements();
    return "ok";
  }

  /** Spawns an event right away (tests and the sim). */
  forceEvent(id: string) {
    if (!EVENT_BY_ID[id]) return;
    this.activeEvent = { id, left: has(this.s, "pager") ? PAGER_WINDOW : EVENT_WINDOW };
    this.emit({ t: "event_spawn", id, window: this.activeEvent.left });
  }

  private addCredits(c: Decimal) {
    const s = this.s;
    s.credits = s.credits.add(c);
    s.runEarned = s.runEarned.add(c);
    s.totalEarned = s.totalEarned.add(c);
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
  /**
   * Is the Auto-Scaling saving up for the next job slot? True when `-j` may buy jobs, a slot
   * is left, and its price is at most `jobsPrio` seconds of income (always when -1).
   */
  jobSaving(): { price: Decimal; progress: number; next: number } | null {
    const s = this.s;
    if (!s.perks.auto_scaling.enabled || !this.autoAllowed("jobs") || s.jobsPrio === 0) return null;
    const max = HW.jobs.max ?? Infinity;
    if (s.hw.jobs >= max) return null;
    const p = price("jobs", s.hw.jobs);
    if (s.jobsPrio > 0 && p.gt(expectedRate(s).mul(s.jobsPrio))) return null;
    return { price: p, progress: Math.min(1, s.credits.div(p).toNumber()), next: s.hw.jobs + 1 };
  }

  /** Sets the job priority threshold (seconds of income, 0 = never, -1 = always). */
  setJobsPrio(v: number) {
    this.s.jobsPrio = v;
  }

  autoAllowed(key: HwKey) {
    const s = this.s;
    if (this.hwLocked(key)) return false;
    if (key === "jobs" && !on(s, "as_jobs")) return false;
    return on(s, "as_ctrl") ? s.autobuy[key] : true;
  }

  autoScale() {
    const s = this.s;
    const bought: Partial<Record<HwKey, number>> = {};
    // `-j`: job slots first, as soon as one is affordable…
    if (this.autoAllowed("jobs")) {
      const r = this.buyHw("jobs", "max");
      if (r.ok) bought.jobs = r.n;
    }
    // …and while the next one is within the player's threshold, save up for it
    if (this.jobSaving()) {
      for (const [key, n] of Object.entries(bought)) this.emit({ t: "autobuy", key: key as HwKey, n: n! });
      return;
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

  /* ---------------- Hardware generations ---------------- */
  canGenerate(key: GenKey): "ok" | "locked" | "level" {
    const s = this.s;
    if (!gensRevealed(s) || this.hwLocked(key)) return "locked";
    return s.hw[key] >= genRequired(s, key) ? "ok" : "level";
  }

  /** Moves a hardware to its next generation: back to level 1, the bonus lasts until the release. */
  generate(key: GenKey, auto = false): "ok" | "locked" | "level" {
    const r = this.canGenerate(key);
    if (r !== "ok") return r;
    const s = this.s;
    s.gens[key]++;
    s.hw[key] = 1;
    s.stats.gensTotal++;
    s.stats.bestRunGens = Math.max(s.stats.bestRunGens, s.gens.cpu + s.gens.ram + s.gens.disk);
    this.emit({ t: "generation", key, gen: s.gens[key], auto });
    this.checkAchievements();
    return "ok";
  }

  buyPerk(key: PerkKey): BuyResult {
    const perk = this.s.perks[key];
    if (perk.unlocked) return { ok: false, reason: "owned" };
    if (perkLocked(this.s, key)) return { ok: false, reason: "locked" };
    const cost = perkPrice(this.s, key);
    if (this.s.credits.lt(cost)) return { ok: false, reason: "credits" };
    this.s.credits = this.s.credits.sub(cost);
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
    s.rcPending = false;
    s.stats.allStars += gain.toNumber();
    s.prBoost = { speed: 1, gains: 1, stars: 1 }; // merged PRs last until the release
    if (s.stats.fastestRelease === null || s.stats.runTime < s.stats.fastestRelease) s.stats.fastestRelease = s.stats.runTime;
    this.resetRun();
    this.emit({ t: "release", stars: gain, auto });
    this.checkAchievements();
    this.ansibleNow(); // the new stars buy the tree at once, before the matrix starts a challenge
    this.matrixStart();
    return gain;
  }

  /* ---------------- Test matrix (Distro talent mtx, v0.6.2) ---------------- */
  /** Challenges the matrix gave up on (too long): not retried until the next distro (v0.6.3; was the next fork,
   *  and with the Fork bot a challenge too hard was retried again and again, 15 min lost each time). */
  private matrixTried = new Set<string>();
  /** The challenge the matrix started (null: none, or one the player started). */
  private matrixRunning: string | null = null;
  private matrixHandsTimer = 0;

  /** Next challenge the matrix will start after a release (null: nothing left for it). */
  matrixNext() {
    const s = this.s;
    return CHALLENGES.find(c => !s.challengesDone.includes(c.id) && !this.matrixTried.has(c.id)) ?? null;
  }
  /** What the Challenges tab shows under the matrix switch. */
  get matrixState() {
    return { running: this.matrixRunning, next: this.matrixNext()?.id ?? null, tried: [...this.matrixTried] };
  }

  /** Right after a release, starts the first challenge not done yet (switch `autoChal`). */
  private matrixStart() {
    const s = this.s;
    if (!hasDistro(s, "d_matrix") || !s.autoChal || s.challenge || !this.challengesUnlocked) return;
    const next = this.matrixNext();
    if (!next) return;
    if (this.startChallenge(next.id, true) === "ok") this.matrixRunning = next.id;
  }

  private resetRun() {
    const s = this.s;
    const jobs = on(s, "monorepo") && !inChallenge(s, "single_core") ? 2 : 1;
    s.credits = new Decimal(0);
    s.runEarned = new Decimal(0);
    const boot = 1 + optBootLevels(s) + (hasFork(s, "f_sponsors") ? SEED_LEVELS : 0);
    s.hw = { cpu: inChallenge(s, "single_core") ? 1 : boot, ram: boot, disk: boot, jobs };
    s.gens = { cpu: 0, ram: 0, disk: 0 }; // generations are per run
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
    this.grantTalent(id);
    this.checkAchievements();
    return r;
  }

  /** Owns a release talent and applies what it gives right away (bought, or given by a Fork talent). */
  private grantTalent(id: string) {
    if (this.s.talents.includes(id)) return;
    this.s.talents.push(id);
    if (this.s.challenge === "no_cache") return; // No cache: talents are off, afterChallenge() gives the perks back
    if (id === "monorepo" && this.s.hw.jobs < 2 && !inChallenge(this.s, "single_core")) {
      this.s.hw.jobs = 2;
      this.s.slots.push({ progress: 0, running: this.s.pipeline && this.ciActive });
    }
    if (id === "ci_preinstalled" && !this.s.perks.ci_cd.unlocked) {
      this.s.perks.ci_cd = { unlocked: true, enabled: true };
    }
    if (id === "as_perm" && !this.s.perks.auto_scaling.unlocked) {
      this.s.perks.auto_scaling = { unlocked: true, enabled: true };
    }
  }

  /** Start-of-run hardware levels (opt_boot, f_sponsors) also count for the current run when bought. */
  private addBootLevels(n: number) {
    const hw = this.s.hw;
    if (!inChallenge(this.s, "single_core")) hw.cpu += n;
    hw.ram += n;
    hw.disk += n;
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
    if (id === "opt_boot") this.addBootLevels(3); // v0.5.16: talents act as soon as they are bought
    this.checkAchievements();
    return r;
  }

  /* ---------------- Challenges ---------------- */
  get challengesUnlocked() {
    return this.s.releases >= CHALLENGES_UNLOCK_AT || this.s.forks > 0;
  }

  startChallenge(id: string, auto = false): "ok" | "locked" | "unknown" | "done" | "active" {
    if (!CHALLENGES.some(c => c.id === id)) return "unknown";
    if (!this.challengesUnlocked) return "locked";
    if (this.s.challengesDone.includes(id)) return "done";
    if (this.s.challenge) return "active";
    this.s.challenge = id;
    this.s.buffs = []; // events stay out of challenges
    this.activeEvent = null;
    this.resetRun();
    if (!auto) this.matrixRunning = null;
    this.emit({ t: "challenge_start", id, auto });
    return "ok";
  }

  exitChallenge(auto = false): boolean {
    const id = this.s.challenge;
    if (!id) return false;
    this.s.challenge = null;
    this.matrixRunning = null;
    this.afterChallenge(id);
    this.emit({ t: "challenge_exit", id, auto });
    return true;
  }

  /** Once a challenge ends (quit or completed), talents count again (No cache disables the tree):
   *  give back what the run would have started with, instead of waiting for the next release. */
  private afterChallenge(_id: string) {
    const s = this.s;
    // Single-core locks Jobs at 1, No cache starts the run without `mono`: both get their 2nd job back
    if (on(s, "monorepo") && s.hw.jobs < 2) {
      s.hw.jobs = 2;
      s.slots.push({ progress: 0, running: s.pipeline && this.ciActive });
    }
    const p = s.perks;
    if (on(s, "ci_preinstalled") && !p.ci_cd.unlocked) p.ci_cd = { unlocked: true, enabled: true };
    if (on(s, "as_perm") && !p.auto_scaling.unlocked) p.auto_scaling = { unlocked: true, enabled: true };
    if (p.ci_cd.enabled && !s.pipeline) this.compile();
  }

  /* ---------------- Fork (prestige layer 2) ---------------- */
  /** Resets releases, stars, the release tree, optimizations, challenges and generations for contributors. */
  fork(auto = false): number | null {
    const s = this.s;
    if (!canFork(s)) return null;
    const gain = contributorsOnFork(s).toNumber();
    s.contributors += gain;
    s.lifetimeContributors += gain;
    s.stats.allContributors += gain;
    s.forks++;
    if (s.stats.fastestFork === null || s.stats.forkTime < s.stats.fastestFork) s.stats.fastestFork = s.stats.forkTime;
    s.stats.forkTime = 0;
    // What the next cycle starts with
    s.stars = new Decimal(hasFork(s, "f_template") ? TEMPLATE_STARS : 0);
    s.lifetimeStars = new Decimal(0);
    s.releases = 0;
    const kept = keptReleaseTalents(s);
    s.talents = s.talents.filter(id => kept.includes(id));
    for (const id of kept) if (!s.talents.includes(id)) s.talents.push(id); // in case a later talent was skipped
    s.upgrades = {};
    s.challenge = null;
    if (!hasDistro(s, "d_chal")) s.challengesDone = []; // Distro talent "chk": challenges stay done until the next distro
    s.stats.bestRunGens = 0;
    s.rcPending = false;
    s.buffs = [];
    s.prBoost = { speed: 1, gains: 1, stars: 1 };
    this.activeEvent = null;
    this.resetRun();
    if (hasDistro(s, "d_autobuy") && s.autoContrib) this.autoBuyFork();
    this.emit({ t: "fork", contributors: gain, auto });
    this.checkAchievements();
    return gain;
  }

  /** Fork talent "ans" (Ansible): stars buy release talents (cheapest first), then optimizations (cheapest first). */
  /** Ansible, if owned and switched on (not during No cache, where the release tree is off). */
  private ansibleNow() {
    const s = this.s;
    if (hasFork(s, "f_ansible") && s.autoStars && s.challenge !== "no_cache") this.autoBuyStars();
  }

  autoBuyStars() {
    const talents: string[] = [];
    let opts = 0;
    for (let guard = 0; guard < 500; guard++) {
      const tal = TALENTS.filter(x => this.canBuyTalent(x.id).ok).sort((a, b) => a.cost - b.cost)[0];
      if (tal) { this.buyTalent(tal.id); talents.push(tal.id); continue; }
      if (TALENTS.some(x => !has(this.s, x.id))) break; // saving up for the next talent
      const up = UPGRADES.filter(x => this.canBuyUpgrade(x.id).ok)
        .sort((a, b) => upgradePrice(this.s, a.id).cmp(upgradePrice(this.s, b.id)))[0];
      if (!up) break;
      this.buyUpgrade(up.id);
      opts++;
    }
    if (talents.length || opts) this.emit({ t: "autostars", talents, opts });
  }

  /** Distro talent "abuy": contributors buy Fork talents (cheapest first), then Fork upgrades. */
  autoBuyFork() {
    for (let guard = 0; guard < 200; guard++) {
      const ft = FORK_TALENTS.filter(x => this.canBuyForkTalent(x.id).ok).sort((a, b) => a.cost - b.cost)[0];
      if (ft) { this.buyForkTalent(ft.id); continue; }
      if (FORK_TALENTS.some(x => !hasFork(this.s, x.id))) return; // saving up for the next talent
      const fu = FORK_UPGRADES.filter(x => this.canBuyForkUpgrade(x.id).ok).sort((a, b) => forkUpgradePrice(this.s, a.id) - forkUpgradePrice(this.s, b.id))[0];
      if (!fu) return;
      this.buyForkUpgrade(fu.id);
    }
  }

  /* ---------------- Distro (v0.5, prestige layer 3) ---------------- */
  /** Publishes a distro: everything the Fork layer holds resets, packages are paid, the next cycle runs on `flavor`. */
  distro(flavor: FlavorId, auto = false): number | null {
    const s = this.s;
    if (!canDistro(s) || !FLAVOR_BY_ID[flavor]) return null;
    this.matrixTried.clear();
    const gain = packagesOnDistro(s).toNumber();
    s.packages += gain;
    s.lifetimePackages += gain;
    s.distros++;
    // Market (v0.6): the distro adds installs (with this cycle's modules) and compiles a module
    const marketWasOpen = s.market.unlocked;
    if (marketWasOpen) {
      const before = marketShare(s).pct;
      const n = installsFor(s, gain);
      s.market.installs += n;
      this.emit({ t: "installs", n });
      const after = marketShare(s).pct;
      for (const m of MILESTONES) if (m.pct > before && m.pct <= after) this.emit({ t: "milestone", id: m.id });
      this.dropCrate(rollModule(s), auto);
    }
    if (s.flavor && !s.flavorsDone.includes(s.flavor)) s.flavorsDone.push(s.flavor); // finished a cycle in this flavor
    s.flavor = flavor;
    if (s.stats.fastestDistro === null || s.stats.distroTime < s.stats.fastestDistro) s.stats.fastestDistro = s.stats.distroTime;
    s.stats.distroTime = 0;
    // The Fork layer starts over, minus what the Distro talents keep
    s.contributors = 0;
    s.lifetimeContributors = 0;
    const keptFork = forkTalentsKept(s);
    s.forkTalents = s.forkTalents.filter(id => keptFork.includes(id));
    if (!hasDistro(s, "d_keepall")) s.forkUpgrades = {};
    s.prs = [];
    s.prNext = FORK.prGap;
    s.stats.forkTime = 0;
    // …and so does everything a fork resets
    s.stars = new Decimal(hasFork(s, "f_template") ? TEMPLATE_STARS : 0);
    s.lifetimeStars = new Decimal(0);
    s.releases = 0;
    s.talents = keptReleaseTalents(s);
    s.upgrades = {};
    s.challenge = null;
    s.challengesDone = [];
    s.stats.bestRunGens = 0;
    s.rcPending = false;
    s.buffs = [];
    s.prBoost = { speed: 1, gains: 1, stars: 1 };
    this.activeEvent = null;
    this.resetRun();
    this.emit({ t: "distro", packages: gain, flavor, auto });
    if (!marketWasOpen && marketReady(s)) this.openMarket();
    this.checkAchievements();
    return gain;
  }

  /* ---------------- Market (v0.6, chapter 1) ---------------- */
  /** Opens the Market: the gauge starts at 0 % and the first module is given (a rare one). */
  private openMarket() {
    const s = this.s;
    s.market.unlocked = true;
    this.emit({ t: "market_open" });
    this.dropCrate(rollModule(s, 1), true); // the first module (rare) waits in a crate in the Market tab
  }

  /** Flavor of the next distro published by crontab: same one, or the next in order (rotation). */
  private cronFlavor(): FlavorId {
    const cur = this.s.flavor ?? "stable";
    if (!this.s.market.cron.rotate) return cur;
    return FLAVOR_ORDER[(FLAVOR_ORDER.indexOf(cur) + 1) % FLAVOR_ORDER.length];
  }

  /** v0.6.4 (Arthur: "une roulette de loot, exactement comme sur CS quand on ouvre une caisse"): a new module
   *  comes in a crate. It is already rolled (the roulette only shows it), and waits until it is opened,
   *  unless the "open on their own" switch is on. Since v0.6.9 no crate pops the roulette on its own (`auto` is informative). */
  private dropCrate(mod: KModule, auto = false) {
    const m = this.s.market;
    this.s.stats.modulesFound++;
    m.crates.push(mod);
    this.emit({ t: "crate", mod, auto });
  }

  /** v0.6.6: buys a crate with packages. v0.6.8 (Arthur): it waits with the other crates in the Market tab
   *  instead of popping the roulette, so several can be bought then opened. */
  buyCrate(): boolean {
    const s = this.s;
    if (!s.market.unlocked) return false;
    const price = cratePrice(s);
    if (s.packages < price) return false;
    s.packages -= price;
    s.market.cratesBought++;
    this.dropCrate(rollModule(s), true);
    return true;
  }

  /** v0.6.6: re-rolls a module's effects (rarity and level kept) for packages. */
  recompileModule(uid: number): boolean {
    const s = this.s;
    const mod = s.market.modules.find(m => m.uid === uid);
    if (!mod) return false;
    const cost = recompileCost(mod);
    if (s.packages < cost) return false;
    s.packages -= cost;
    rerollEffects(s, mod);
    return true;
  }

  /** Opens the first crate (or the one with this uid): its module goes to the inventory. */
  openCrate(uid?: number): KModule | null {
    const m = this.s.market;
    const i = uid === undefined ? 0 : m.crates.findIndex(c => c.uid === uid);
    if (i < 0 || i >= m.crates.length) return null;
    const [mod] = m.crates.splice(i, 1);
    this.addModule(mod);
    this.checkAchievements();
    return mod;
  }

  /** A module out of its crate goes to the inventory (recycled at once if auto-recycle takes it, or if the inventory is full). */
  private addModule(mod: KModule) {
    const m = this.s.market;
    if (m.autoRecycle && mod.rarity === 0) {
      const p = recycleValue(mod);
      this.s.packages += p;
      this.emit({ t: "module", mod, recycled: p });
      return;
    }
    m.modules.push(mod);
    this.emit({ t: "module", mod });
    if (m.modules.length > MARKET.inventory) {
      // Full: the worst unloaded module goes back as packages
      const worst = m.modules.filter(x => !m.loaded.includes(x.uid)).sort((a, b) => moduleScore(a) - moduleScore(b))[0];
      if (worst) this.recycleModule(worst.uid);
    }
    // A free slot takes the new module
    if (m.loaded.length < moduleSlots(this.s)) this.loadModule(mod.uid);
  }

  loadModule(uid: number): boolean {
    const m = this.s.market;
    if (m.loaded.includes(uid) || !m.modules.some(x => x.uid === uid) || m.loaded.length >= moduleSlots(this.s)) return false;
    m.loaded.push(uid);
    return true;
  }

  unloadModule(uid: number): boolean {
    const m = this.s.market;
    if (!m.loaded.includes(uid)) return false;
    m.loaded = m.loaded.filter(x => x !== uid);
    return true;
  }

  /** Recycles a module for packages. Returns the packages, or null. */
  recycleModule(uid: number): number | null {
    const m = this.s.market;
    const mod = m.modules.find(x => x.uid === uid);
    if (!mod) return null;
    m.modules = m.modules.filter(x => x.uid !== uid);
    m.loaded = m.loaded.filter(x => x !== uid);
    const p = recycleValue(mod);
    this.s.packages += p;
    return p;
  }

  /** Milestone 20 %: absorbs `from` into `into` (same first effect): +1 level. */
  fuseModules(into: number, from: number): boolean {
    const m = this.s.market;
    const a = m.modules.find(x => x.uid === into), b = m.modules.find(x => x.uid === from);
    if (!a || !b || !canFuse(this.s, a, b)) return false;
    a.level++;
    m.modules = m.modules.filter(x => x.uid !== from);
    m.loaded = m.loaded.filter(x => x !== from);
    this.checkAchievements();
    return true;
  }

  /** Loads the best modules in the slots (used by `modprobe --best` and the sim). */
  loadBestModules() {
    const m = this.s.market;
    m.loaded = [...m.modules].sort((a, b) => moduleScore(b) - moduleScore(a)).slice(0, moduleSlots(this.s)).map(x => x.uid);
  }

  /** Loaded modules (in slot order). */
  get loaded() { return loadedModules(this.s); }
  get marketOpen() { return marketOpen(this.s); }

  canBuyDistroTalent(id: string): BuyResult {
    const t = DISTRO_TALENT_BY_ID[id];
    if (!t) return { ok: false, reason: "locked" };
    if (hasDistro(this.s, id)) return { ok: false, reason: "owned" };
    if (!t.req.every(r => hasDistro(this.s, r))) return { ok: false, reason: "req" };
    if (this.s.packages < t.cost) return { ok: false, reason: "packages" };
    return { ok: true, n: 1 };
  }

  buyDistroTalent(id: string): BuyResult {
    const r = this.canBuyDistroTalent(id);
    if (!r.ok) return r;
    this.s.packages -= DISTRO_TALENT_BY_ID[id].cost;
    this.s.distroTalents.push(id);
    // v0.5.16: talents act as soon as they are bought ("keep" talents act on the next reset by nature)
    if (id === "d_autobuy" && this.s.autoContrib) this.autoBuyFork();
    this.emit({ t: "distro_talent", id });
    this.checkAchievements();
    return r;
  }

  canBuyForkTalent(id: string): BuyResult {
    const t = FORK_TALENT_BY_ID[id];
    if (!t) return { ok: false, reason: "locked" };
    if (hasFork(this.s, id)) return { ok: false, reason: "owned" };
    if (!t.req.every(r => hasFork(this.s, r))) return { ok: false, reason: "req" };
    if (this.s.contributors < t.cost) return { ok: false, reason: "contributors" };
    return { ok: true, n: 1 };
  }

  buyForkTalent(id: string): BuyResult {
    const r = this.canBuyForkTalent(id);
    if (!r.ok) return r;
    this.s.contributors -= FORK_TALENT_BY_ID[id].cost;
    this.s.forkTalents.push(id);
    // v0.5.16: talents act as soon as they are bought, start-of-fork/run bonuses included;
    // "keep" talents (kp, ans's Release bot) act on the next fork by nature
    if (id === "f_template") this.s.stars = this.s.stars.add(TEMPLATE_STARS);
    if (id === "f_bench") for (const tid of PREBUILT_TALENTS) this.grantTalent(tid);
    if (id === "f_sponsors") this.addBootLevels(SEED_LEVELS);
    this.emit({ t: "fork_talent", id });
    this.checkAchievements();
    return r;
  }

  canBuyForkUpgrade(id: string): BuyResult {
    if (!FORK_UPGRADE_BY_ID[id]) return { ok: false, reason: "locked" };
    if (this.s.contributors < forkUpgradePrice(this.s, id)) return { ok: false, reason: "contributors" };
    return { ok: true, n: 1 };
  }

  buyForkUpgrade(id: string): BuyResult {
    const r = this.canBuyForkUpgrade(id);
    if (!r.ok) return r;
    this.s.contributors -= forkUpgradePrice(this.s, id);
    this.s.forkUpgrades[id] = (this.s.forkUpgrades[id] ?? 0) + 1;
    this.emit({ t: "fork_upgrade", id, level: this.s.forkUpgrades[id] });
    return r;
  }

  /** After the first fork, contributors open pull requests from time to time (not offline, not in a challenge). */
  private tickPrs(dt: number) {
    const s = this.s;
    if (s.forks === 0 || this.offline || s.challenge) return;
    if (s.prs.length >= FORK.prMax) return;
    s.prNext -= dt;
    if (s.prNext > 0) return;
    s.prNext = prGap(s);
    const pr: PullRequest = { n: ++s.prSeq, kind: pickPrKind(), title: Math.floor(Math.random() * PR_TITLES) };
    s.prs.push(pr);
    this.emit({ t: "pr_open", pr });
    if (hasDistro(s, "d_merge")) this.mergePr(pr.n); // Distro talent "mrg": PRs merge themselves
  }

  /** Merges an open PR (by number, or the oldest one). */
  mergePr(n?: number): PullRequest | null {
    const s = this.s;
    const i = n === undefined ? 0 : s.prs.findIndex(p => p.n === n);
    if (i < 0 || !s.prs[i]) return null;
    const [pr] = s.prs.splice(i, 1);
    const fx = PR_EFFECTS[pr.kind];
    let credits: Decimal | undefined;
    if (pr.kind === "perf") s.prBoost.speed *= fx.mult!;
    else if (pr.kind === "feat") s.prBoost.gains *= fx.mult!;
    else if (pr.kind === "ci") s.prBoost.stars *= fx.mult!;
    else { credits = expectedRate(s).mul(fx.seconds!); this.addCredits(credits); }
    s.stats.prsMerged++;
    this.emit({ t: "pr_merged", pr, credits });
    this.checkAchievements();
    return pr;
  }

  /** Closes an open PR without merging it. */
  closePr(n: number): boolean {
    const i = this.s.prs.findIndex(p => p.n === n);
    if (i < 0) return false;
    this.s.prs.splice(i, 1);
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
    const before = { builds: s.stats.builds, fails: s.stats.fails };
    const steps = Math.min(2000, Math.ceil(simulated));
    const dt = simulated / steps;
    // Everything earned while away is counted from the game's own events, so resets during
    // the absence (release, fork) do not break the totals. A new currency or automation adds
    // its event here and one line in the offline summary (main.ts, OFFLINE_LINES).
    const got = newOfflineGains();
    this.tap = e => tallyOffline(got, e);
    this.muted = true;
    this.offline = true; // no events while away
    this.activeEvent = null;
    for (let i = 0; i < steps; i++) this.tick(dt);
    this.offline = false;
    this.muted = false;
    this.tap = null;
    // Play time counts real time, not simulated time
    s.stats.playTime += seconds - simulated;
    if (seconds >= 60) this.recordOffline(seconds, simulated, eff, got);
    return {
      away: seconds,
      grace,
      eff,
      unlocked: eff > 0,
      capped: beyond > counted,
      simulated,
      credits: got.credits,
      builds: s.stats.builds - before.builds,
      fails: s.stats.fails - before.fails,
      gains: got,
    };
  }

  /** v0.6.11: keeps the last absence and the running total for the Stats tab. */
  private recordOffline(away: number, counted: number, eff: number, g: OfflineGains) {
    const s = this.s;
    const rec: OfflineRecord = {
      at: Date.now(), away, counted, eff, credits: g.credits.toString(), releases: g.releases, stars: g.stars.toString(),
      forks: g.forks, contributors: g.contributors, distros: g.distros, packages: g.packages, installs: g.installs, modules: g.modules,
    };
    s.offlineLast = rec;
    const tot = s.offlineTotal;
    s.offlineTotal = {
      at: rec.at, away: tot.away + away, counted: tot.counted + counted, eff: 0,
      credits: new Decimal(tot.credits).add(g.credits).toString(), releases: tot.releases + g.releases,
      stars: new Decimal(tot.stars).add(g.stars).toString(), forks: tot.forks + g.forks, contributors: tot.contributors + g.contributors,
      distros: tot.distros + g.distros, packages: tot.packages + g.packages, installs: tot.installs + g.installs, modules: tot.modules + g.modules,
    };
  }

  hardReset() {
    const lang = this.s.settings.lang;
    this.s = newState();
    this.s.settings.lang = lang;
  }
}

import Decimal from "break_eternity.js";
import { ACHIEVEMENTS, ACH_BY_ID, type Reward } from "./achievements";
import { CHALLENGES, CHALLENGES_UNLOCK_AT } from "./challenges";
import {
  HW, OFFLINE_GRACE_SECONDS, perkLocked, perkPrice, autoScaleInterval, bulkPrice, buildTime, challengeGoal, failProbability,
  expectedRate, genRequired, gensRevealed, has, starsRevealed, inChallenge, maxAffordable, offlineCapSeconds, offlineEfficiency, on, price, reward, starsOnRelease,
} from "./formulas";
import { TALENT_BY_ID } from "./talents";
import {
  FORK, FORK_TALENT_BY_ID, FORK_UPGRADE_BY_ID, KEPT_BY_F_KEEP, forkUpgradePrice, PREBUILT_TALENTS, PR_EFFECTS, PR_TITLES, type PullRequest, SEED_LEVELS,
  TEMPLATE_STARS,
  canFork, contributorsOnFork, hasFork, pickPrKind, prGap,
} from "./fork";
import {
  type BuildEvent, EVENT_BY_ID, EVENT_GAP, EVENT_WINDOW, PAGER_GAP_MULT, PAGER_WINDOW, eligibleEvents, pickEvent,
} from "./events";
import { UPGRADE_BY_ID, optBootLevels, upgradeMaxed, upgradePrice } from "./upgrades";
import {
  type BuyAmount, type GameState, type GenKey, type HwKey, type PerkKey, SAVE_KEY, deserialize, newState, serialize,
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
  | { t: "generation"; key: GenKey; gen: number }
  | { t: "event_spawn"; id: string; window: number }
  | { t: "event_caught"; id: string; credits?: Decimal; builds?: number }
  | { t: "event_missed"; id: string }
  | { t: "buff_end"; id: string }
  | { t: "fork"; contributors: number }
  | { t: "fork_talent"; id: string }
  | { t: "fork_upgrade"; id: string; level: number }
  | { t: "pr_open"; pr: PullRequest }
  | { t: "pr_merged"; pr: PullRequest; credits?: Decimal }


export type BuyResult = { ok: true; n: number } | { ok: false; reason: "credits" | "max" | "locked" | "owned" | "stars" | "req" | "contributors" };

export class Engine {
  s: GameState;
  private listeners: ((e: GameEvent) => void)[] = [];
  private muted = false;
  private autoScaleTimer = 0;
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
    s.stats.forkTime += dt;

    if (s.pipeline) this.advanceBuilds(dt);
    this.tickEvents(dt);
    this.tickPrs(dt);

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
    this.eventTimer = Engine.nextGap(pager);
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
  generate(key: GenKey): "ok" | "locked" | "level" {
    const r = this.canGenerate(key);
    if (r !== "ok") return r;
    const s = this.s;
    s.gens[key]++;
    s.hw[key] = 1;
    s.stats.gensTotal++;
    s.stats.bestRunGens = Math.max(s.stats.bestRunGens, s.gens.cpu + s.gens.ram + s.gens.disk);
    this.emit({ t: "generation", key, gen: s.gens[key] });
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
    return gain;
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
    return this.s.releases >= CHALLENGES_UNLOCK_AT || this.s.forks > 0;
  }

  startChallenge(id: string): "ok" | "locked" | "unknown" | "done" | "active" {
    if (!CHALLENGES.some(c => c.id === id)) return "unknown";
    if (!this.challengesUnlocked) return "locked";
    if (this.s.challengesDone.includes(id)) return "done";
    if (this.s.challenge) return "active";
    this.s.challenge = id;
    this.s.buffs = []; // events stay out of challenges
    this.activeEvent = null;
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
    // Talents count again once the challenge is left (No cache disables the tree): give back
    // the perks the run would have started with, instead of waiting for the next release.
    const p = this.s.perks;
    if (on(this.s, "ci_preinstalled") && !p.ci_cd.unlocked) p.ci_cd = { unlocked: true, enabled: true };
    if (on(this.s, "as_perm") && !p.auto_scaling.unlocked) p.auto_scaling = { unlocked: true, enabled: true };
    if (p.ci_cd.enabled && !this.s.pipeline) this.compile();
    this.emit({ t: "challenge_exit", id });
    return true;
  }

  /* ---------------- Fork (prestige layer 2) ---------------- */
  /** Resets releases, stars, the release tree, optimizations, challenges and generations for contributors. */
  fork(): number | null {
    const s = this.s;
    if (!canFork(s)) return null;
    const gain = contributorsOnFork(s).toNumber();
    s.contributors += gain;
    s.lifetimeContributors += gain;
    s.forks++;
    if (s.stats.fastestFork === null || s.stats.forkTime < s.stats.fastestFork) s.stats.fastestFork = s.stats.forkTime;
    s.stats.forkTime = 0;
    // What the next cycle starts with
    s.stars = new Decimal(hasFork(s, "f_template") ? TEMPLATE_STARS : 0);
    s.lifetimeStars = new Decimal(0);
    s.releases = 0;
    const kept = [...(hasFork(s, "f_keep") ? KEPT_BY_F_KEEP : []), ...(hasFork(s, "f_bench") ? PREBUILT_TALENTS : [])];
    s.talents = s.talents.filter(id => kept.includes(id));
    for (const id of kept) if (!s.talents.includes(id)) s.talents.push(id); // in case a later talent was skipped
    s.upgrades = {};
    s.challenge = null;
    s.challengesDone = [];
    s.stats.bestRunGens = 0;
    s.rcPending = false;
    s.buffs = [];
    s.prBoost = { speed: 1, gains: 1, stars: 1 };
    this.activeEvent = null;
    this.resetRun();
    this.emit({ t: "fork", contributors: gain });
    this.checkAchievements();
    return gain;
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
    // "iac" makes Auto-Scaling buyable at once; "keep"/others act on the next fork or run
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
    const before = { credits: s.totalEarned, builds: s.stats.builds, fails: s.stats.fails, cpu: s.hw.cpu, ram: s.hw.ram, disk: s.hw.disk, jobs: s.hw.jobs, releases: s.releases, stars: s.lifetimeStars };
    const steps = Math.min(2000, Math.ceil(simulated));
    const dt = simulated / steps;
    const newAchievements: string[] = [];
    const collect = (e: GameEvent) => { if (e.t === "achievement") newAchievements.push(e.id); };
    this.listeners.push(collect);
    this.muted = true;
    this.offline = true; // no events while away
    this.activeEvent = null;
    for (let i = 0; i < steps; i++) this.tick(dt);
    this.offline = false;
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

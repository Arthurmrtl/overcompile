import Decimal from "break_eternity.js";
import { ACHIEVEMENTS } from "./achievements";
import {
  HW, PERK_PRICE, bulkPrice, buildTime, failProbability, has, maxAffordable, price, reward, starsOnRelease,
  OFFLINE_CAP_SECONDS, offlineEfficiency,
} from "./formulas";
import { TALENT_BY_ID } from "./talents";
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
  | { t: "release"; stars: Decimal; auto: boolean };

export type BuyResult = { ok: true; n: number } | { ok: false; reason: "credits" | "max" | "locked" | "owned" | "stars" | "req" };

export class Engine {
  s: GameState;
  private listeners: ((e: GameEvent) => void)[] = [];
  private muted = false;
  private autoScaleTimer = 0;
  private autobuyTimer = 0;

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

    // Auto-Scaling perk: buys the cheapest affordable CPU/RAM/Disk upgrade (every second)
    this.autoScaleTimer += dt;
    if (s.perks.auto_scaling.enabled && this.autoScaleTimer >= 1) {
      this.autoScaleTimer = 0;
      this.autoScale();
    }

    // Release-tree autobuyers: buy max (every half second)
    this.autobuyTimer += dt;
    if (this.autobuyTimer >= 0.5) {
      this.autobuyTimer = 0;
      for (const key of ["jobs", "ram", "cpu", "disk"] as HwKey[]) {
        if (has(s, `autobuy_${key}`) && s.autobuy[key]) {
          const r = this.buyHw(key, "max");
          if (r.ok) this.emit({ t: "autobuy", key, n: r.n });
        }
      }
    }

    // Release bot
    if (has(s, "release_bot") && s.autoRelease.enabled && starsOnRelease(s).gte(Math.max(1, s.autoRelease.threshold))) {
      this.release(true);
    }

    this.checkAchievements();
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

  autoScale() {
    let guard = 0;
    for (;;) {
      const options = (["cpu", "ram", "disk"] as HwKey[])
        .map(k => ({ k, p: price(k, this.s.hw[k]) }))
        .filter(o => this.s.credits.gte(o.p));
      if (!options.length || guard++ > 500) break;
      const cheapest = options.reduce((a, b) => (b.p.lt(a.p) ? b : a));
      this.buyHw(cheapest.k, 1);
      this.emit({ t: "autobuy", key: cheapest.k, n: 1 });
    }
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
    const jobs = has(s, "monorepo") ? 2 : 1;
    s.credits = new Decimal(0);
    s.runEarned = new Decimal(0);
    s.hw = { cpu: 1, ram: 1, disk: 1, jobs };
    s.slots = Array.from({ length: jobs }, () => ({ progress: 0, running: false }));
    s.pipeline = false;
    const ci = has(s, "ci_preinstalled");
    s.perks = { ci_cd: { unlocked: ci, enabled: ci }, auto_scaling: { unlocked: false, enabled: false } };
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
    this.checkAchievements();
    return r;
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
  /** Simulates time spent away. Returns a summary, or null if nothing happened. */
  simulateOffline(seconds: number) {
    const s = this.s;
    const away = Math.min(seconds, OFFLINE_CAP_SECONDS);
    if (away < 10 || !s.pipeline || !this.ciActive) return null;
    const before = { credits: s.credits, builds: s.stats.builds, fails: s.stats.fails, cpu: s.hw.cpu, ram: s.hw.ram, disk: s.hw.disk, jobs: s.hw.jobs, releases: s.releases, stars: s.lifetimeStars };
    const eff = offlineEfficiency(s);
    const steps = Math.min(2000, Math.ceil(away));
    const dt = (away * eff) / steps;
    const newAchievements: string[] = [];
    const collect = (e: GameEvent) => { if (e.t === "achievement") newAchievements.push(e.id); };
    this.listeners.push(collect);
    this.muted = true;
    for (let i = 0; i < steps; i++) this.tick(dt);
    this.muted = false;
    this.listeners = this.listeners.filter(l => l !== collect);
    // Play time counts real time, not simulated time
    s.stats.playTime += away - away * eff;
    return {
      away,
      eff,
      credits: s.credits.sub(before.credits).max(0),
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

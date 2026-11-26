import Decimal from "break_eternity.js";
import type { FlavorId } from "./distro";
import type { PullRequest } from "./fork";
import type { KModule } from "./market";

export type HwKey = "cpu" | "ram" | "disk" | "jobs";
export const HW_KEYS: HwKey[] = ["cpu", "ram", "disk", "jobs"];
/** Hardware that can move to a new generation (Jobs are capped at 16). */
export type GenKey = "cpu" | "ram" | "disk";
export const GEN_KEYS: GenKey[] = ["cpu", "ram", "disk"];
export type PerkKey = "ci_cd" | "auto_scaling";
export const PERK_KEYS: PerkKey[] = ["ci_cd", "auto_scaling"];
export type Lang = "en" | "fr";
export type Notation = "standard" | "scientific";
export type BuyAmount = 1 | 10 | "max";

export interface Slot {
  progress: number; // 0..1
  running: boolean;
}

export interface GameState {
  version: number;
  credits: Decimal;
  runEarned: Decimal;
  totalEarned: Decimal;
  hw: Record<HwKey, number>;
  /**
   * Hardware generations of the current run (v0.4.5): a generation sends the hardware back to
   * level 1 for a strong bonus, and every release (or fork, or challenge start) resets them.
   */
  gens: Record<GenKey, number>;
  /** "Release candidate" event caught: the next release gives more stars. */
  rcPending: boolean;
  /**
   * `-j` talent: Auto-Scaling saves up for the next job slot when it costs at most this many
   * seconds of income (0 = never saves, -1 = always). Set by the player. Default 0: the sim shows
   * saving up never helps (each slot costs ×5 the previous one for a linear gain), it is a preference.
   */
  jobsPrio: number;
  /** Active event boosts, with the seconds left. Short-lived; saved so a reload does not drop them. */
  buffs: { id: string; left: number }[];
  perks: Record<PerkKey, { unlocked: boolean; enabled: boolean }>;
  pipeline: boolean; // a compile pipeline is currently running
  slots: Slot[];
  stars: Decimal;
  lifetimeStars: Decimal;
  releases: number;
  talents: string[];
  autobuy: Record<HwKey, boolean>;
  /** Fork talent `rnv`: which hardware generates on its own as soon as it can (v0.4.9). */
  autogen: Record<GenKey, boolean>;
  autoRelease: { enabled: boolean; threshold: number };
  /** Levels of the infinite star upgrades (Optimizations). */
  upgrades: Record<string, number>;
  /** Active challenge id, or null. */
  challenge: string | null;
  challengesDone: string[];
  /** Features the player has already discovered (for NEW badges). */
  seen: string[];
  /** Achievements whose reward has been claimed (never reset). */
  achClaimed: string[];
  achievements: string[];
  stats: {
    builds: number;
    fails: number;
    interrupts: number;
    playTime: number;
    runTime: number;
    streak: number;
    bestStreak: number;
    fastestRelease: number | null;
    events: number; // build events caught (never reset)
    forkTime: number;          // time since the last fork (or since the start)
    fastestFork: number | null;
    prsMerged: number;
    allStars: number;          // stars earned over every fork (stats only)
    gensTotal: number;         // generations ever done (achievements, never reset)
    bestRunGens: number;       // most generations in one run during this fork cycle (contributors)
    distroTime: number;        // time since the last distro (or since the start)
    fastestDistro: number | null;
    allContributors: number;   // contributors earned over every distro (stats only)
    modulesFound: number;      // kernel modules ever compiled (v0.6, never reset)
  };
  settings: { lang: Lang; notation: Notation; logLevel: "full" | "reduced" | "minimal"; buyAmount: BuyAmount };
  /* ---------- Fork (v0.4, prestige layer 2) ---------- */
  forks: number;
  /** Unspent contributors (Fork talents). */
  contributors: number;
  /** Every contributor ever earned (passive bonus, never reset). */
  lifetimeContributors: number;
  /** Fork talents and Fork upgrades (levels), never reset. */
  forkTalents: string[];
  forkUpgrades: Record<string, number>;
  /** Open pull requests, and the boosts of merged ones (until the next release). */
  prs: PullRequest[];
  prNext: number;      // seconds before the next PR
  prSeq: number;       // last PR number
  prBoost: { speed: number; gains: number; stars: number };
  /* ---------- Distro (v0.5, prestige layer 3) ---------- */
  distros: number;
  /** Unspent packages (Distro talents) and every package ever earned (passive bonus, never reset). */
  packages: number;
  lifetimePackages: number;
  distroTalents: string[];
  /** The base of the current Distro cycle (null before the first distro), and the ones finished at least once. */
  flavor: FlavorId | null;
  flavorsDone: FlavorId[];
  /** Distro talent "Fork bot": fork on its own once the fork pays this many contributors (≥ 1). */
  autoFork: { enabled: boolean; threshold: number };
  /** Fork talent `ans` (Ansible, v0.5.5): stars buy release talents, then optimizations, on their own. */
  autoStars: boolean;
  /** Distro talent `abuy` (Maintainers): switch for the contributors' automatic purchases (v0.5.11). */
  autoContrib: boolean;
  /** Distro talent `mtx` (Test matrix, v0.6.2): switch for the challenges started on their own. */
  autoChal: boolean;
  /* ---------- Market (v0.6, chapter 1) — never reset ---------- */
  market: {
    unlocked: boolean;
    /** Installs ever earned: they only fill the market share gauge. */
    installs: number;
    /** Seed of the module rolls (kept in the save so a reload cannot re-roll). */
    seed: number;
    nextUid: number;
    modules: KModule[];
    /** Uids of the loaded modules (as many as the slots). */
    loaded: number[];
    /** Recycle new common modules at once (switch next to the inventory). */
    autoRecycle: boolean;
    /** v0.6.4: modules already rolled, waiting in their crate (opened with the roulette). */
    crates: KModule[];
    /** Open crates as they come, without the roulette (switch next to the crates). */
    autoOpen: boolean;
    /** v0.6.6: crates bought with packages (their price grows with it). */
    cratesBought: number;
    /** Milestone 5 %: distros publish themselves at a package threshold (≥ 1). */
    cron: { enabled: boolean; threshold: number; rotate: boolean };
  };
  lastSeen: number;
  createdAt: number;
}

/** Default thresholds of the Fork bot (contributors) and crontab (packages), since v0.6.7. */
export const FORK_BOT_DEFAULT = 50;
export const CRON_DEFAULT = 30;

export const SAVE_VERSION = 16;
export const SAVE_KEY = "overcompile-save";

function browserLang(): Lang {
  try {
    return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
  } catch {
    return "en";
  }
}

export function newMarket(): GameState["market"] {
  return {
    unlocked: false, installs: 0, seed: (Math.random() * 2 ** 32) >>> 0, nextUid: 1, modules: [], loaded: [],
    autoRecycle: false, crates: [], autoOpen: false, cratesBought: 0, cron: { enabled: true, threshold: CRON_DEFAULT, rotate: false },
  };
}

export function newState(): GameState {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    credits: new Decimal(0),
    runEarned: new Decimal(0),
    totalEarned: new Decimal(0),
    hw: { cpu: 1, ram: 1, disk: 1, jobs: 1 },
    gens: { cpu: 0, ram: 0, disk: 0 },
    rcPending: false,
    buffs: [],
    jobsPrio: 0,
    perks: { ci_cd: { unlocked: false, enabled: false }, auto_scaling: { unlocked: false, enabled: false } },
    pipeline: false,
    slots: [{ progress: 0, running: false }],
    stars: new Decimal(0),
    lifetimeStars: new Decimal(0),
    releases: 0,
    talents: [],
    autobuy: { cpu: true, ram: true, disk: true, jobs: true },
    autogen: { cpu: true, ram: true, disk: true },
    autoRelease: { enabled: false, threshold: 10 },
    upgrades: {},
    challenge: null,
    challengesDone: [],
    seen: [],
    achClaimed: [],
    achievements: [],
    stats: { builds: 0, fails: 0, interrupts: 0, playTime: 0, runTime: 0, streak: 0, bestStreak: 0, fastestRelease: null, events: 0, forkTime: 0, fastestFork: null, prsMerged: 0, allStars: 0, gensTotal: 0, bestRunGens: 0, distroTime: 0, fastestDistro: null, allContributors: 0, modulesFound: 0 },
    settings: { lang: browserLang(), notation: "standard", logLevel: "reduced", buyAmount: 1 },
    forks: 0,
    contributors: 0,
    lifetimeContributors: 0,
    forkTalents: [],
    forkUpgrades: {},
    prs: [],
    prNext: 600,
    prSeq: 0,
    prBoost: { speed: 1, gains: 1, stars: 1 },
    distros: 0,
    packages: 0,
    lifetimePackages: 0,
    distroTalents: [],
    flavor: null,
    flavorsDone: [],
    autoFork: { enabled: true, threshold: FORK_BOT_DEFAULT },
    autoStars: true,
    autoContrib: true,
    autoChal: true,
    market: newMarket(),
    lastSeen: now,
    createdAt: now,
  };
}

const DECIMAL_FIELDS = ["credits", "runEarned", "totalEarned", "stars", "lifetimeStars"] as const;

export function serialize(s: GameState): string {
  const plain: Record<string, unknown> = { ...s };
  for (const f of DECIMAL_FIELDS) plain[f] = s[f].toString();
  return JSON.stringify(plain);
}

export function deserialize(json: string): GameState {
  const raw = JSON.parse(json);
  const base = newState();
  const s: GameState = {
    ...base,
    ...raw,
    hw: { ...base.hw, ...raw.hw },
    gens: { ...base.gens, ...raw.gens },
    perks: {
      ci_cd: { ...base.perks.ci_cd, ...raw.perks?.ci_cd },
      auto_scaling: { ...base.perks.auto_scaling, ...raw.perks?.auto_scaling },
    },
    autobuy: { ...base.autobuy, ...raw.autobuy },
    autogen: { ...base.autogen, ...raw.autogen },
    autoRelease: { ...base.autoRelease, ...raw.autoRelease },
    autoFork: { ...base.autoFork, ...raw.autoFork },
    stats: { ...base.stats, ...raw.stats },
    settings: { ...base.settings, ...raw.settings },
  };
  for (const f of DECIMAL_FIELDS) s[f] = new Decimal(raw[f] ?? 0);
  s.upgrades = { ...(raw.upgrades ?? {}) };
  s.challengesDone = [...(raw.challengesDone ?? [])];
  s.seen = [...(raw.seen ?? [])];
  s.buffs = Array.isArray(raw.buffs) ? raw.buffs.map((b: { id: string; left: number }) => ({ ...b })) : [];
  if (raw.settings?.verbose === false && !raw.settings?.logLevel) s.settings.logLevel = "minimal";
  delete (s.settings as Record<string, unknown>).verbose;
  s.achClaimed = [...(raw.achClaimed ?? [])];
  s.forkTalents = [...(raw.forkTalents ?? [])];
  s.forkUpgrades = { ...(raw.forkUpgrades ?? {}) };
  s.prs = Array.isArray(raw.prs) ? raw.prs.map((p: PullRequest) => ({ ...p })) : [];
  s.prBoost = { ...base.prBoost, ...raw.prBoost };
  s.distroTalents = [...(raw.distroTalents ?? [])];
  s.flavorsDone = [...(raw.flavorsDone ?? [])];
  s.market = {
    ...base.market, ...raw.market,
    cron: { ...base.market.cron, ...raw.market?.cron },
    modules: Array.isArray(raw.market?.modules) ? raw.market.modules.map((m: KModule) => ({ ...m, effects: m.effects.map(e => ({ ...e })) })) : [],
    loaded: [...(raw.market?.loaded ?? [])],
    crates: Array.isArray(raw.market?.crates) ? raw.market.crates.map((m: KModule) => ({ ...m, effects: m.effects.map(e => ({ ...e })) })) : [],
  };
  // v0.6.7: no more "when the advisor says" mode (threshold 0): bots only work at a threshold
  if (!(s.autoFork.threshold >= 1)) s.autoFork.threshold = FORK_BOT_DEFAULT;
  if (!(s.market.cron.threshold >= 1)) s.market.cron.threshold = CRON_DEFAULT;
  // v0.2.2–0.2.4 first-run objectives became the first tiers of the achievement chains
  if (!raw.achClaimed) {
    const map: Record<string, string> = {
      o_first_build: "first_build", o_ci: "ci_cd", o_cpu10: "cpu_10", o_jobs2: "jobs_2", o_1k: "credits_1k",
      o_streak25: "streak_25", o_autoscale: "auto_scaling", o_jobs4: "jobs_4", o_10k: "credits_10k",
    };
    // v0.2.2 credited objectives automatically, v0.2.3+ only once claimed
    const claimed: string[] = raw.objClaimed ?? raw.objectives ?? [];
    for (const o of claimed) if (map[o] && !s.achClaimed.includes(map[o])) s.achClaimed.push(map[o]);
  }
  delete (s as unknown as Record<string, unknown>).objectives;
  delete (s as unknown as Record<string, unknown>).objClaimed;
  migrate(s, raw.version ?? 1);
  // Slots must match the number of jobs
  s.slots = Array.from({ length: s.hw.jobs }, (_, i) => raw.slots?.[i] ?? { progress: 0, running: false });
  return s;
}

/** Upgrades older saves to the current format. */
function migrate(s: GameState, from: number) {
  if (from < 2) {
    // v0.1 → v0.2: the four autobuyers become the Auto-Scaling branch, same cost each
    const map: Record<string, string> = {
      autobuy_cpu: "as_perm", autobuy_ram: "as_fast", autobuy_disk: "as_ctrl", autobuy_jobs: "as_jobs",
    };
    s.talents = s.talents.map(t => map[t] ?? t);
    // A talent that no longer has its prerequisite keeps working: nothing is lost
    if (s.talents.includes("as_perm")) s.perks.auto_scaling = { unlocked: true, enabled: true };
    // Offline progress used to be 50% for everyone (100% with the talent): owners keep 50%
    if (s.talents.includes("offline_runners")) s.upgrades.off_eff = Math.max(s.upgrades.off_eff ?? 0, 4);
    s.challenge = null;
  }
  if (from < 3) {
    // v0.2 → v0.3: hardware generations start at 0 for everyone
    s.gens = { cpu: 0, ram: 0, disk: 0 };
  }
  if (from < 4) {
    // v0.3.0 → v0.3.1: build events
    s.rcPending = false;
    s.buffs = [];
    s.stats.events = 0;
  }
  if (from < 5) {
    // v0.3.2 → v0.3.3: job priority threshold of the Auto-Scaling
    s.jobsPrio = 0;
  }
  if (from < 6) {
    // v0.3 → v0.4: Fork layer. The current cycle started with the save, so its time is the play time.
    s.forks = 0;
    s.contributors = 0;
    s.lifetimeContributors = 0;
    s.forkTalents = [];
    s.prs = [];
    s.prNext = 600;
    s.prSeq = 0;
    s.prBoost = { speed: 1, gains: 1, stars: 1 };
    s.stats.forkTime = s.stats.playTime;
    s.stats.fastestFork = null;
    s.stats.prsMerged = 0;
    s.stats.allStars = s.lifetimeStars.toNumber();
  }
  if (from < 7) {
    // v0.4.0 → v0.4.1: Fork upgrades (infinite levels, paid in contributors)
    s.forkUpgrades = {};
  }
  if (from < 8) {
    // v0.4.4 → v0.4.5: generations become per run. The ones owned stay until the next release;
    // they count as done (achievements) and as this cycle's best run (contributors).
    const n = s.gens.cpu + s.gens.ram + s.gens.disk;
    s.stats.gensTotal = n;
    s.stats.bestRunGens = n;
  }
  if (from < 9) {
    // v0.4.8 → v0.4.9: per-hardware switches of the Fork talent `rnv` (auto-generation), all on
    s.autogen = { cpu: true, ram: true, disk: true };
  }
  if (from < 10) {
    // v0.4.14 → v0.5.0: Distro layer. Nothing to convert: a new layer, empty
    s.stats.distroTime = s.stats.playTime;
    s.stats.allContributors = s.lifetimeContributors;
  }
  if (from < 11) {
    // v0.5.4 → v0.5.5: switch of the Fork talent `ans` (Ansible), on by default
    s.autoStars = true;
  }
  if (from < 12) {
    // v0.5.10 → v0.5.11: switch of the Distro talent `abuy`, on by default (it always ran before)
    s.autoContrib = true;
  }
  if (from < 13) {
    // v0.5.16 → v0.6.0: Market (chapter 1). Empty; it opens on its own if the four flavors are done
    s.market = newMarket();
    s.stats.modulesFound = 0;
  }
  if (from < 16) {
    // v0.6.5 → v0.6.6: crates bought with packages
    s.market.cratesBought = 0;
  }
  if (from < 15) {
    // v0.6.3 → v0.6.4: crates (loot roulette); nothing waiting yet
    s.market.crates = [];
    s.market.autoOpen = false;
  }
  if (from < 14) {
    // v0.6.1 → v0.6.2: switch of the Distro talent `mtx` (Test matrix), on by default
    s.autoChal = true;
  }
  s.version = SAVE_VERSION;
}

export function exportSave(s: GameState): string {
  return btoa(unescape(encodeURIComponent(serialize(s))));
}

export function importSave(text: string): GameState {
  const json = decodeURIComponent(escape(atob(text.trim())));
  return deserialize(json);
}

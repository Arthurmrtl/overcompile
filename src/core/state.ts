import Decimal from "break_eternity.js";

export type HwKey = "cpu" | "ram" | "disk" | "jobs";
export const HW_KEYS: HwKey[] = ["cpu", "ram", "disk", "jobs"];
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
  perks: Record<PerkKey, { unlocked: boolean; enabled: boolean }>;
  pipeline: boolean; // a compile pipeline is currently running
  slots: Slot[];
  stars: Decimal;
  lifetimeStars: Decimal;
  releases: number;
  talents: string[];
  autobuy: Record<HwKey, boolean>;
  autoRelease: { enabled: boolean; threshold: number };
  /** Levels of the infinite star upgrades (Optimizations). */
  upgrades: Record<string, number>;
  /** Active challenge id, or null. */
  challenge: string | null;
  challengesDone: string[];
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
  };
  settings: { lang: Lang; notation: Notation; verbose: boolean; buyAmount: BuyAmount };
  lastSeen: number;
  createdAt: number;
}

export const SAVE_VERSION = 2;
export const SAVE_KEY = "overcompile-save";

function browserLang(): Lang {
  try {
    return navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
  } catch {
    return "en";
  }
}

export function newState(): GameState {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    credits: new Decimal(0),
    runEarned: new Decimal(0),
    totalEarned: new Decimal(0),
    hw: { cpu: 1, ram: 1, disk: 1, jobs: 1 },
    perks: { ci_cd: { unlocked: false, enabled: false }, auto_scaling: { unlocked: false, enabled: false } },
    pipeline: false,
    slots: [{ progress: 0, running: false }],
    stars: new Decimal(0),
    lifetimeStars: new Decimal(0),
    releases: 0,
    talents: [],
    autobuy: { cpu: true, ram: true, disk: true, jobs: true },
    autoRelease: { enabled: false, threshold: 10 },
    upgrades: {},
    challenge: null,
    challengesDone: [],
    achievements: [],
    stats: { builds: 0, fails: 0, interrupts: 0, playTime: 0, runTime: 0, streak: 0, bestStreak: 0, fastestRelease: null },
    settings: { lang: browserLang(), notation: "standard", verbose: true, buyAmount: 1 },
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
    perks: {
      ci_cd: { ...base.perks.ci_cd, ...raw.perks?.ci_cd },
      auto_scaling: { ...base.perks.auto_scaling, ...raw.perks?.auto_scaling },
    },
    autobuy: { ...base.autobuy, ...raw.autobuy },
    autoRelease: { ...base.autoRelease, ...raw.autoRelease },
    stats: { ...base.stats, ...raw.stats },
    settings: { ...base.settings, ...raw.settings },
  };
  for (const f of DECIMAL_FIELDS) s[f] = new Decimal(raw[f] ?? 0);
  s.upgrades = { ...(raw.upgrades ?? {}) };
  s.challengesDone = [...(raw.challengesDone ?? [])];
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
  s.version = SAVE_VERSION;
}

export function exportSave(s: GameState): string {
  return btoa(unescape(encodeURIComponent(serialize(s))));
}

export function importSave(text: string): GameState {
  const json = decodeURIComponent(escape(atob(text.trim())));
  return deserialize(json);
}

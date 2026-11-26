import type { GameState } from "./state";

/**
 * Market (v0.6, chapter 1 "The year of the Linux desktop").
 *
 * After the four flavors, the game had no goal left: packages piled up with nothing to buy.
 * Chapter 1 adds a final goal and a way to reach it, without any new reset (Arthur, 25/11/2026):
 * - **market share**: a gauge from 0 to 100 % that never goes down. Every distro published once
 *   the Market is open adds **installs** (packages of that distro × module bonuses); the gauge is
 *   cut into 10 slices of 10 %, each one costs more installs than the one before. At 100 %, the
 *   chapter ends (end screen in v0.6.10) and the game goes on.
 * - **milestones** on the gauge unlock things (module slots, crontab, fusion, Dual boot…), with
 *   the same fog as the trees: only the next one is shown.
 * - **kernel modules**: loot. Every distro compiles a random module (rarity, 1–3 effects); only
 *   the loaded ones act (1 to 5 slots). Upstream effects (gains, stars) stay small on purpose:
 *   they feed the whole chain, that is where a snowball would start.
 *
 * Installs do nothing but fill the gauge, so they cannot snowball; packages stay a currency.
 */
export const MARKET = {
  // Sim (260 h, v0.6.0): 5 % 3 h 24 after the Market opens, 50 % 49 h, 100 % 171 h (158 distros); a real player
  // with crontab and offline progress: ~2–3 weeks. 80 / ×1.45 ended in 58 h; 200 / ×1.3 took 8 h for the first 5 %.
  sliceBase: 100,      // installs for the first 10 % slice
  sliceRatio: 1.55,    // each slice costs × this much more than the previous one
  inventory: 20,       // modules kept at most (the worst unloaded one is recycled when full)
  maxLevel: 5,         // fusion levels
  levelBonus: 0.15,    // +15 % on every effect per level above 1 (0.25 tripled packages per distro in the sim)
  pressBonus: 0.25,    // milestone 90 %: installs +25 %
};

/* ---------------- Unlock ---------------- */
/** Flavor order for crontab's rotation. */
export const FLAVOR_ORDER = ["rolling", "stable", "source", "desktop"] as const;
/** The Market opens once the four flavors have each been finished once. */
export const marketReady = (s: GameState) => s.flavorsDone.length >= 4;
export const marketOpen = (s: GameState) => s.market.unlocked;

/* ---------------- Gauge ---------------- */
export const sliceCost = (i: number) => MARKET.sliceBase * Math.pow(MARKET.sliceRatio, i);
export const totalInstallsFor100 = () => Array.from({ length: 10 }, (_, i) => sliceCost(i)).reduce((a, b) => a + b, 0);

/** Market share in % (0..100) from the installs, with where the current slice stands. */
export function marketShare(s: GameState): { pct: number; slice: number; inSlice: number; sliceCost: number } {
  let left = s.market.installs;
  for (let i = 0; i < 10; i++) {
    const c = sliceCost(i);
    if (left < c) return { pct: 10 * i + (10 * left) / c, slice: i, inSlice: left, sliceCost: c };
    left -= c;
  }
  return { pct: 100, slice: 10, inSlice: 0, sliceCost: 0 };
}

/* ---------------- Milestones ---------------- */
export type MilestoneId = "modules" | "crontab" | "slot2" | "fuse" | "slot3" | "dualboot" | "luck" | "slot4" | "nixos" | "slot5" | "press" | "end";
export interface Milestone { id: MilestoneId; pct: number; ready: boolean }
/** `ready: false` = announced on the gauge, delivered in a later version (Dual boot v0.6.9, NixOS and the end screen v0.6.10). */
export const MILESTONES: Milestone[] = [
  { id: "modules", pct: 0, ready: true },
  { id: "crontab", pct: 5, ready: true },
  { id: "slot2", pct: 10, ready: true },
  { id: "fuse", pct: 20, ready: true },
  { id: "slot3", pct: 30, ready: true },
  { id: "dualboot", pct: 40, ready: false },
  { id: "luck", pct: 50, ready: true },
  { id: "slot4", pct: 60, ready: true },
  { id: "nixos", pct: 70, ready: false },
  { id: "slot5", pct: 80, ready: true },
  { id: "press", pct: 90, ready: true },
  { id: "end", pct: 100, ready: false },
];
export const MILESTONE_BY_ID = Object.fromEntries(MILESTONES.map(m => [m.id, m])) as Record<MilestoneId, Milestone>;
export const reached = (s: GameState, id: MilestoneId) => marketOpen(s) && marketShare(s).pct >= MILESTONE_BY_ID[id].pct;
export const nextMilestone = (s: GameState) => MILESTONES.find(m => !reached(s, m.id)) ?? null;
export const moduleSlots = (s: GameState) =>
  1 + (["slot2", "slot3", "slot4", "slot5"] as MilestoneId[]).filter(id => reached(s, id)).length;

/* ---------------- Modules ---------------- */
export type EffectKey = "installs" | "packages" | "contributors" | "stars" | "gains" | "offline";
export const EFFECT_KEYS: EffectKey[] = ["installs", "packages", "contributors", "stars", "gains", "offline"];
/** Value of each effect on a common module, level 1 (offline: efficiency points, as a fraction). */
export const EFFECT_BASE: Record<EffectKey, number> = {
  installs: 0.1, packages: 0.03, contributors: 0.03, stars: 0.03, gains: 0.15, offline: 0.1,
};
export const RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type Rarity = 0 | 1 | 2 | 3;
export const RARITY_CHANCE = [0.6, 0.28, 0.1, 0.02];
export const RARITY_POWER = [1, 1.6, 2.5, 4];
export const RARITY_EFFECTS = [1, 1, 2, 3];
export const RECYCLE_PACKAGES = [1, 3, 8, 20];
/** Names of real kernel modules, for flavour. */
export const MODULE_NAMES = [
  "nvidia", "amdgpu", "i915", "zram", "btrfs", "ext4", "xfs", "iwlwifi", "kvm", "wireguard", "nf_tables", "bluetooth",
  "snd_hda_intel", "usbhid", "nvme", "dm_crypt", "overlay", "vfio", "e1000e", "r8169", "fuse", "squashfs", "tcp_bbr", "v4l2",
];

export interface KModule {
  uid: number;
  name: string;
  rarity: Rarity;
  effects: { k: EffectKey; v: number }[];
  level: number;
}

/** Seeded random (mulberry32): the seed lives in the save, so reloading cannot re-roll a module. */
function rand(s: GameState): number {
  let t = (s.market.seed = (s.market.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rollRarity(s: GameState): Rarity {
  const chance = [...RARITY_CHANCE];
  if (reached(s, "luck")) { chance[3] *= 2; chance[0] -= RARITY_CHANCE[3]; } // milestone 50 %: legendary ×2
  let r = rand(s);
  for (let i = 3; i >= 1; i--) {
    if (r < chance[i]) return i as Rarity;
    r -= chance[i];
  }
  return 0;
}

/** Compiles a new random module (rarity, name, distinct effects). */
export function rollModule(s: GameState, rarity: Rarity = rollRarity(s)): KModule {
  const keys = [...EFFECT_KEYS];
  const effects: KModule["effects"] = [];
  for (let i = 0; i < RARITY_EFFECTS[rarity]; i++) {
    const k = keys.splice(Math.floor(rand(s) * keys.length), 1)[0];
    // ±20 % around the base value, so two modules of the same kind are not identical
    const v = EFFECT_BASE[k] * RARITY_POWER[rarity] * (0.8 + 0.4 * rand(s));
    effects.push({ k, v: Math.round(v * 1000) / 1000 });
  }
  const name = MODULE_NAMES[Math.floor(rand(s) * MODULE_NAMES.length)];
  return { uid: s.market.nextUid++, name, rarity, effects, level: 1 };
}

export const levelMult = (m: KModule) => 1 + MARKET.levelBonus * (m.level - 1);
export const effectValue = (m: KModule, k: EffectKey) =>
  m.effects.filter(e => e.k === k).reduce((a, e) => a + e.v, 0) * levelMult(m);
export const loadedModules = (s: GameState) =>
  s.market.loaded.map(uid => s.market.modules.find(m => m.uid === uid)).filter((m): m is KModule => !!m);

/** Sum of an effect over the loaded modules (0 when the Market is closed). */
export function moduleBonus(s: GameState, k: EffectKey): number {
  if (!marketOpen(s)) return 0;
  return loadedModules(s).reduce((a, m) => a + effectValue(m, k), 0);
}
export const moduleMult = (s: GameState, k: EffectKey) => 1 + moduleBonus(s, k);

/** How good a module is for the player who wants the gauge to move (sim, auto-recycle, inventory full). */
export function moduleScore(m: KModule): number {
  const w: Record<EffectKey, number> = { installs: 1, packages: 1.6, contributors: 1, stars: 0.8, gains: 0.15, offline: 0.3 };
  return m.effects.reduce((a, e) => a + (e.v / EFFECT_BASE[e.k]) * EFFECT_BASE.installs * w[e.k], 0) * levelMult(m);
}
export const recycleValue = (m: KModule) => RECYCLE_PACKAGES[m.rarity] * m.level;

/* ---------------- Package shop (v0.6.6) ----------------
 * Arthur: "quand on est au stade du Marché, la monnaie des distro ne sert plus à rien ?". Once the Distro tree
 * is done, packages in hand had nothing left to buy. They now buy extra crates (price ×1.15 per crate bought,
 * never reset: a sink that keeps the chapter length) and re-roll a module's effects ("recompile"). */
export const CRATE_SHOP = { base: 10, growth: 1.15 };
export const cratePrice = (s: GameState) => Math.round(CRATE_SHOP.base * Math.pow(CRATE_SHOP.growth, s.market.cratesBought));
/** Re-rolling a module's effects (rarity and level kept), by rarity. */
export const RECOMPILE_COST = [3, 6, 15, 40];
export const recompileCost = (m: KModule) => RECOMPILE_COST[m.rarity];

/** New effects for a module, same rarity and level (seeded, like any roll). */
export function rerollEffects(s: GameState, m: KModule) {
  const fresh = rollModule(s, m.rarity);
  s.market.nextUid--; // the fresh module was only used for its effects
  m.effects = fresh.effects;
}

/** Installs paid by a distro that paid `packages`. */
export const installsFor = (s: GameState, packages: number) =>
  packages * moduleMult(s, "installs") * (reached(s, "press") ? 1 + MARKET.pressBonus : 1);

/** Two modules can fuse when they share their first effect and the target is not maxed. */
export const canFuse = (s: GameState, into: KModule, from: KModule) =>
  reached(s, "fuse") && into.uid !== from.uid && into.level < MARKET.maxLevel && into.effects[0].k === from.effects[0].k;

import { writeFileSync } from "node:fs";
import { exportSave } from "../src/core/state";
// Balance simulation: a reasonably smart player, played at 0.25 s ticks.
// Usage: npm run sim -- [hours]
import { Engine } from "../src/core/engine";
import { perkLocked, perkPrice, price, starsOnRelease, expectedRate, releaseBase } from "../src/core/formulas";
import { TALENTS } from "../src/core/talents";
import { FORK, FORK_TALENTS, FORK_UPGRADES, forkUpgradePrice } from "../src/core/fork";
import { FORK_ADV, ForkAdvisor } from "../src/core/advisor";
import { UPGRADES, upgradePrice } from "../src/core/upgrades";
import { CHALLENGES } from "../src/core/challenges";
import { ADV, ReleaseAdvisor } from "../src/core/advisor";
import { GEN_KEYS } from "../src/core/state";
import { DISTRO, DISTRO_TALENTS, FLAVORS, type FlavorId } from "../src/core/distro";
import { DISTRO_ADV, DistroAdvisor } from "../src/core/advisor";
import { EFFECT_BASE, MARKET, MILESTONES, canFuse, marketShare, moduleScore, moduleSlots } from "../src/core/market";

import { BAL } from "../src/core/formulas";
for (const [k, v] of Object.entries(process.env)) if (k.startsWith("BAL_")) (BAL as any)[k.slice(4)] = Number(v);
for (const [k, v] of Object.entries(process.env)) if (k.startsWith("ADV_")) (ADV as any)[k.slice(4)] = Number(v);
const e = new Engine();
const s = e.s;
const fmt = (t: number) => `${Math.floor(t / 3600)}h${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;
const H = Number(process.argv[2] ?? 8);
const dt = 0.25;
let t = 0;
let firstStarLogged = false;
const milestones: string[] = [];
const advisor = new ReleaseAdvisor();
let asLogged = false;
if (process.env.JOBSPRIO !== undefined) s.jobsPrio = Number(process.env.JOBSPRIO); // -j saving threshold (s of income; 0 never, -1 always)
let manualTimer = 0;
const catchRate = Number(process.env.EVENTS ?? 0.7);
let lastEvent: unknown = null;
const forkAdvisor = new ForkAdvisor();
let treeLoggedForks = -1;
let cycleStart = 0;
for (const [k, v] of Object.entries(process.env)) if (k.startsWith("FORK_")) (FORK as any)[k.slice(5)] = Number(v);
for (const [k, v] of Object.entries(process.env)) if (k.startsWith("FADV_")) (FORK_ADV as any)[k.slice(5)] = Number(v);
for (const [k, v] of Object.entries(process.env)) if (k.startsWith("DISTRO_")) (DISTRO as any)[k.slice(7)] = Number(v);
for (const [k, v] of Object.entries(process.env)) if (k.startsWith("DADV_")) (DISTRO_ADV as any)[k.slice(5)] = Number(v);
for (const [k, v] of Object.entries(process.env)) if (k.startsWith("MARKET_")) (MARKET as any)[k.slice(7)] = Number(v);
for (const [k, v] of Object.entries(process.env)) if (k.startsWith("EFFECT_")) (EFFECT_BASE as any)[k.slice(7)] = Number(v);
const distroAdvisor = new DistroAdvisor();
let marketAt = -1;
e.on(ev => {
  if (ev.t === "challenge_done") milestones.push(`${fmt(t)} challenge done ${ev.id} (run ${fmt(s.stats.runTime)})`);
  if (ev.t === "challenge_exit" && ev.auto) milestones.push(`${fmt(t)} matrix gave up ${ev.id}`);
});
const marketLog: string[] = [];
/** Market (v0.6): the sim publishes distros itself (crontab off), loads the best modules and fuses duplicates. */
function tendModules() {
  if (!s.market.unlocked) return;
  if (marketAt < 0) marketAt = t;
  s.market.autoOpen = true; // the sim opens crates at once
  while (s.market.crates.length) e.openCrate();
  for (;;) {
    const mods = [...s.market.modules].sort((a, b) => moduleScore(b) - moduleScore(a));
    let fused = false;
    for (const a of mods) {
      const b = [...mods].reverse().find(x => canFuse(s, a, x) && moduleScore(x) < moduleScore(a));
      if (b && e.fuseModules(a.uid, b.uid)) { fused = true; break; }
    }
    if (!fused) break;
  }
  e.loadBestModules();
}
let distroStart = 0;
let forkTreeLogged = -1;
/** The player tries every flavor once (to get each permanent bonus), then picks FLAVOR (default stable). */
function pickFlavor(): FlavorId {
  const order: FlavorId[] = ["rolling", "stable", "source", "desktop"];
  const next = order.find(f => !s.flavorsDone.includes(f) && s.flavor !== f);
  return (process.env.FLAVOR as FlavorId) ?? next ?? "stable";
}
function spendPackages() {
  for (;;) {
    const dt = DISTRO_TALENTS.filter(x => e.canBuyDistroTalent(x.id).ok).sort((a, b) => a.cost - b.cost)[0];
    if (!dt) break;
    e.buyDistroTalent(dt.id);
  }
}

function spendContributors() {
  // Fork talents first (cheapest first), then the infinite Fork upgrades (cheapest first)
  for (;;) {
    const ft = FORK_TALENTS.filter(x => e.canBuyForkTalent(x.id).ok).sort((a, b) => a.cost - b.cost)[0];
    if (ft) { e.buyForkTalent(ft.id); continue; }
    if (FORK_TALENTS.some(x => !s.forkTalents.includes(x.id))) break; // save up for the next talent
    const fu = FORK_UPGRADES.filter(x => e.canBuyForkUpgrade(x.id).ok).sort((a, b) => forkUpgradePrice(s, a.id) - forkUpgradePrice(s, b.id))[0];
    if (!fu) break;
    e.buyForkUpgrade(fu.id);
  }
}

function spendStars() {
  for (;;) {
    const tal = TALENTS.filter(x => e.canBuyTalent(x.id).ok).sort((a, b) => a.cost - b.cost)[0];
    // Prefer talents; otherwise the cheapest optimization (offline lines are useless here)
    if (tal) { e.buyTalent(tal.id); continue; }
    const up = UPGRADES.filter(u => !u.id.startsWith("off_") && e.canBuyUpgrade(u.id).ok)
      .sort((a, b) => upgradePrice(s, a.id).cmp(upgradePrice(s, b.id)))[0];
    if (up) { e.buyUpgrade(up.id); continue; }
    break;
  }
}

let forkAt = 0, asForkLogged = 0, lastForksSeen = 0; const asAfterFork: number[] = [];
while (t < H * 3600) {
  if (!s.pipeline) e.compile();
  if (!s.perks.ci_cd.unlocked) e.buyPerk("ci_cd");
  else if (!s.perks.auto_scaling.unlocked) {
    const locked = perkLocked(s, "auto_scaling");
    const cost = perkPrice(s, "auto_scaling");
    if (!locked && s.credits.gte(cost)) {
      e.buyPerk("auto_scaling");
      if (!asLogged) { asLogged = true; milestones.push(`Auto-Scaling bought ${fmt(t)} (after release ${s.releases})`); }
      if (s.forks > 0 && s.releases === 0 && asForkLogged < s.forks) { asForkLogged = s.forks; asAfterFork.push(Math.round((t - forkAt) / 6) / 10); }
    } else if ((manualTimer += dt) >= 4) {
      // A human buys by hand about every 4 s; once the perk is for sale, keep 10 % of its price aside
      manualTimer = 0;
      const cheapest = (["cpu", "ram", "disk"] as const).map(k => price(k, s.hw[k])).reduce((a, b) => a.min(b));
      if (locked || cheapest.lt(cost.mul(0.1))) e.autoScale();
    }
  }
  if (!s.talents.includes("as_jobs") && s.credits.gte(price("jobs", s.hw.jobs).mul(1.2))) e.buyHw("jobs", 1);
  // Hardware generations: taken as soon as available (NOGEN=1 to disable)
  if (!process.env.NOGEN) for (const k of GEN_KEYS) e.generate(k);
  e.tick(dt);
  // Build events: the player catches a share of them (EVENTS=0..1, default 0.7; NOEVENTS=1 to turn them off)
  if (e.activeEvent && e.activeEvent !== lastEvent) {
    lastEvent = e.activeEvent;
    if (!process.env.NOEVENTS && Math.random() < catchRate) e.catchEvent();
  }
  e.claimAchievements();
  // Pull requests: merged as soon as they open (NOFORK=1 to never fork)
  while (s.prs.length) e.mergePr();
  t += dt;

  if (!firstStarLogged && starsOnRelease(s).gte(1) && s.releases === 0) { firstStarLogged = true; milestones.push(`1st star possible ${fmt(t)} (${Math.round(t / 60)} min)`); }

  // Challenges: try each one right after a release, once unlocked
  if (!process.env.NOCHAL && e.challengesUnlocked && !s.challenge && s.stats.runTime < 1) {
    const next = CHALLENGES.find(c => !s.challengesDone.includes(c.id));
    if (next && s.releases % 2 === 1) { e.startChallenge(next.id); milestones.push(`${fmt(t)} start challenge ${next.id}`); }
  }
  if (s.challenge && s.stats.runTime > 20 * 60) { milestones.push(`${fmt(t)} gave up ${s.challenge}`); e.exitChallenge(); }

  // Release when the in-game advisor says so (what a player following the hint does)
  const adv = advisor.update(s);
  const gain = adv.pending.toNumber();
  if (adv.advised) {
    const rt = s.stats.runTime;
    const jobsAtRelease = s.hw.jobs;
    const lvAtRelease = `${s.hw.cpu}/${s.hw.ram}/${s.hw.disk}`;
    const gensAtRelease = `${s.gens.cpu}/${s.gens.ram}/${s.gens.disk}`;
    e.release();
    console.log(`${fmt(t)}  v${s.releases}.0.0  +${gain}★ in ${Math.round(rt / 60)} min  (lifetime ${s.lifetimeStars}, talents ${s.talents.length}/${TALENTS.length}, jobs ${jobsAtRelease}, lv ${lvAtRelease}, gens ${gensAtRelease}, next base ${releaseBase(s).toExponential(1)})`);
    spendStars();
    if (s.talents.length === TALENTS.length && treeLoggedForks !== s.forks) {
      treeLoggedForks = s.forks;
      milestones.push(`tree complete ${fmt(t)}${s.forks ? ` (cycle ${s.forks + 1}, ${fmt(t - cycleStart)} after the fork)` : ""}`);
    }
  }
  // Fork when the fork advisor says so
  if (!process.env.NOFORK) {
    const fa = forkAdvisor.update(s);
    if (fa.advised) {
      const cycle = t - cycleStart;
      const stars = s.lifetimeStars.toNumber();
      const gain = e.fork();
      forkAt = t;
      if (gain !== null) {
        cycleStart = t;
        spendContributors();
        const line = `${fmt(t)}  FORK #${s.forks}  +${gain} contributors after ${fmt(cycle)} (cycle stars ${Math.round(stars)}, lifetime contributors ${s.lifetimeContributors}, fork talents ${s.forkTalents.length}/${FORK_TALENTS.length}, upgrades ${JSON.stringify(s.forkUpgrades)})`;
        console.log(line);
        milestones.push(line.trim());
      }
    }
  }
  // Forks made by the Fork bot (Distro talent): log them and spend like the player would
  if (s.forks !== lastForksSeen) {
    if (s.forks > lastForksSeen + 0 && t - forkAt > 1) {
      console.log(`${fmt(t)}  FORK #${s.forks} (bot)  lifetime contributors ${s.lifetimeContributors}, fork talents ${s.forkTalents.length}/${FORK_TALENTS.length}`);
      cycleStart = t; forkAt = t;
    }
    lastForksSeen = s.forks;
    spendContributors();
  }
  if (s.forkTalents.length === FORK_TALENTS.length && forkTreeLogged !== s.distros) {
    forkTreeLogged = s.distros;
    milestones.push(`fork tree complete ${fmt(t)} (distro cycle ${s.distros + 1}, ${fmt(t - distroStart)} into it)`);
  }
  // Distro when the distro advisor says so
  if (!process.env.NODISTRO) {
    const da = distroAdvisor.update(s);
    if (da.advised) {
      // SAVE_DISTRO=<file>: write the save right before the first distro, then stop
      if (process.env.SAVE_DISTRO && s.distros === 0) {
        writeFileSync(process.env.SAVE_DISTRO, exportSave(s));
        console.log(`saved before the first distro at ${fmt(t)} → ${process.env.SAVE_DISTRO}`);
        process.exit(0);
      }
      const cycle = t - distroStart;
      const contribs = s.lifetimeContributors;
      const from = s.flavor ?? "none";
      const flavor = pickFlavor();
      const pctBefore = s.market.unlocked ? marketShare(s).pct : 0;
      const gain = e.distro(flavor);
      if (gain !== null) {
        distroStart = t; cycleStart = t; forkAt = t; lastForksSeen = s.forks;
        s.market.cron.enabled = false;
        tendModules();
        spendPackages(); spendContributors(); spendStars();
        if (s.market.unlocked) {
          const pct = marketShare(s).pct;
          for (const m of MILESTONES) if (m.pct > pctBefore && m.pct <= pct)
            marketLog.push(`  ${m.pct}% ${m.id} at ${fmt(t)} (${fmt(t - marketAt)} after the Market opened, distro #${s.distros})`);
          console.log(`${fmt(t)}  MARKET ${pct.toFixed(2)}%  installs ${Math.round(s.market.installs)}  slots ${moduleSlots(s)}  modules ${s.market.modules.length} loaded [${e.loaded.map(m => `${m.name}:${m.rarity}L${m.level}`).join(" ")}]`);
        }
        const line = `${fmt(t)}  DISTRO #${s.distros}  +${gain} packages after ${fmt(cycle)} on ${from} (cycle contributors ${contribs}, lifetime packages ${s.lifetimePackages}, distro talents ${s.distroTalents.length}/${DISTRO_TALENTS.length}, kept fork talents ${s.forkTalents.length}) → ${flavor}`;
        console.log(line);
        milestones.push(line.trim());
      }
    }
  }
}
for (const c of s.challengesDone) milestones.push(`challenge done: ${c}`);
milestones.push(`Auto-Scaling bought after fork (min): ${asAfterFork.join(" ")}`);
console.log(milestones.join("\n"));
if (marketAt >= 0) console.log(`market opened at ${fmt(marketAt)}, now ${marketShare(s).pct.toFixed(2)}%, modules found ${s.stats.modulesFound}\n${marketLog.join("\n")}`);
console.log("forks", s.forks, "contributors", s.lifetimeContributors, "PRs merged", s.stats.prsMerged, "events caught", s.stats.events, "optimizations", JSON.stringify(s.upgrades), "achievements", s.achievements.length, "rate", expectedRate(s).toExponential(2));

// Balance simulation: a reasonably smart player, played at 0.25 s ticks.
// Usage: npm run sim -- [hours]
import { Engine } from "../src/core/engine";
import { perkLocked, perkPrice, price, starsOnRelease, expectedRate, releaseBase } from "../src/core/formulas";
import { TALENTS } from "../src/core/talents";
import { FORK, FORK_TALENTS } from "../src/core/fork";
import { FORK_ADV, ForkAdvisor } from "../src/core/advisor";
import { UPGRADES, upgradePrice } from "../src/core/upgrades";
import { CHALLENGES } from "../src/core/challenges";
import { ADV, ReleaseAdvisor } from "../src/core/advisor";
import { GEN_KEYS } from "../src/core/state";

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

function spendContributors() {
  for (;;) {
    const ft = FORK_TALENTS.filter(x => e.canBuyForkTalent(x.id).ok).sort((a, b) => a.cost - b.cost)[0];
    if (!ft) break;
    e.buyForkTalent(ft.id);
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

while (t < H * 3600) {
  if (!s.pipeline) e.compile();
  if (!s.perks.ci_cd.unlocked) e.buyPerk("ci_cd");
  else if (!s.perks.auto_scaling.unlocked) {
    const locked = perkLocked(s, "auto_scaling");
    const cost = perkPrice(s, "auto_scaling");
    if (!locked && s.credits.gte(cost)) {
      e.buyPerk("auto_scaling");
      if (!asLogged) { asLogged = true; milestones.push(`Auto-Scaling bought ${fmt(t)} (after release ${s.releases})`); }
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
    e.release();
    console.log(`${fmt(t)}  v${s.releases}.0.0  +${gain}★ in ${Math.round(rt / 60)} min  (lifetime ${s.lifetimeStars}, talents ${s.talents.length}/${TALENTS.length}, jobs ${jobsAtRelease}, gens ${s.gens.cpu}/${s.gens.ram}/${s.gens.disk}, next base ${releaseBase(s).toExponential(1)})`);
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
      if (gain !== null) {
        cycleStart = t;
        spendContributors();
        const line = `${fmt(t)}  FORK #${s.forks}  +${gain} contributors after ${fmt(cycle)} (cycle stars ${Math.round(stars)}, lifetime contributors ${s.lifetimeContributors}, fork talents ${s.forkTalents.length}/${FORK_TALENTS.length})`;
        console.log(line);
        milestones.push(line.trim());
      }
    }
  }
}
for (const c of s.challengesDone) milestones.push(`challenge done: ${c}`);
console.log(milestones.join("\n"));
console.log("forks", s.forks, "contributors", s.lifetimeContributors, "PRs merged", s.stats.prsMerged, "events caught", s.stats.events, "optimizations", JSON.stringify(s.upgrades), "achievements", s.achievements.length, "rate", expectedRate(s).toExponential(2));

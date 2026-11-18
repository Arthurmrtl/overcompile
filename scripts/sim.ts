// Balance simulation: a reasonably smart player, played at 0.25 s ticks.
// Usage: npm run sim -- [hours]
import { Engine } from "../src/core/engine";
import { PERK_PRICE, price, starsOnRelease, expectedRate, releaseBase } from "../src/core/formulas";
import { TALENTS } from "../src/core/talents";
import { UPGRADES, upgradePrice } from "../src/core/upgrades";
import { CHALLENGES } from "../src/core/challenges";

import { BAL } from "../src/core/formulas";
for (const [k, v] of Object.entries(process.env)) if (k.startsWith("BAL_")) (BAL as any)[k.slice(4)] = Number(v);
const e = new Engine();
const s = e.s;
const fmt = (t: number) => `${Math.floor(t / 3600)}h${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;
const H = Number(process.argv[2] ?? 8);
const dt = 0.25;
let t = 0;
let firstStarLogged = false;
const milestones: string[] = [];

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
    if (s.credits.gte(PERK_PRICE.auto_scaling)) e.buyPerk("auto_scaling");
    else if (s.hw.cpu + s.hw.ram < 24) e.autoScale(); // manual buying until saving for the perk
  }
  if (!s.talents.includes("as_jobs") && s.credits.gte(price("jobs", s.hw.jobs).mul(1.2))) e.buyHw("jobs", 1);
  e.tick(dt);
  t += dt;

  if (!firstStarLogged && starsOnRelease(s).gte(1) && s.releases === 0) { firstStarLogged = true; milestones.push(`1st star possible ${fmt(t)} (${Math.round(t / 60)} min)`); }

  // Challenges: try each one right after a release, once unlocked
  if (!process.env.NOCHAL && e.challengesUnlocked && !s.challenge && s.stats.runTime < 1) {
    const next = CHALLENGES.find(c => !s.challengesDone.includes(c.id));
    if (next && s.releases % 2 === 1) { e.startChallenge(next.id); milestones.push(`${fmt(t)} start challenge ${next.id}`); }
  }
  if (s.challenge && s.stats.runTime > 20 * 60) { milestones.push(`${fmt(t)} gave up ${s.challenge}`); e.exitChallenge(); }

  // Release when the gain adds a good chunk to lifetime stars (or the run drags on)
  const gain = starsOnRelease(s).toNumber();
  const target = Math.max(1, Math.floor(0.35 * s.lifetimeStars.toNumber()));
  if (gain >= target || (gain >= 1 && s.stats.runTime > 40 * 60)) {
    const rt = s.stats.runTime;
    e.release();
    console.log(`${fmt(t)}  v${s.releases}.0.0  +${gain}★ in ${Math.round(rt / 60)} min  (lifetime ${s.lifetimeStars}, talents ${s.talents.length}/14, next base ${releaseBase(s).toExponential(1)})`);
    spendStars();
    if (s.talents.length === TALENTS.length && !milestones.some(m => m.startsWith("tree"))) milestones.push(`tree complete ${fmt(t)}`);
  }
}
for (const c of s.challengesDone) milestones.push(`challenge done: ${c}`);
console.log(milestones.join("\n"));
console.log("optimizations", JSON.stringify(s.upgrades), "achievements", s.achievements.length, "rate", expectedRate(s).toExponential(2));

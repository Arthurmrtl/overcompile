import { Engine } from "../src/core/engine";
import { PERK_PRICE, price, starsOnRelease, expectedRate } from "../src/core/formulas";
import { TALENTS } from "../src/core/talents";
const e = new Engine();
const s = e.s;
const marks: Record<string, number> = {};
const mark = (k: string, t: number) => { if (!(k in marks)) marks[k] = t; };
const fmt = (t: number) => `${Math.floor(t / 60)}m${String(Math.floor(t % 60)).padStart(2, "0")}`;
let t = 0, dt = 0.25;
const H = Number(process.argv[2] ?? 3);
let releaseTarget = 2;
while (t < H * 3600) {
  if (!s.pipeline) e.compile();
  if (!s.perks.ci_cd.unlocked) e.buyPerk("ci_cd");
  else if (!s.perks.auto_scaling.unlocked && s.credits.gte(PERK_PRICE.auto_scaling.mul(1))) e.buyPerk("auto_scaling");
  if (s.credits.gte(price("jobs", s.hw.jobs).mul(1.2))) e.buyHw("jobs", 1);
  if (!s.perks.auto_scaling.unlocked && s.perks.ci_cd.unlocked && s.credits.gte(PERK_PRICE.auto_scaling)) {}
  else if (s.perks.ci_cd.unlocked && !s.perks.auto_scaling.unlocked) {
    // save for auto-scaling only after a few upgrades
    if (s.hw.cpu + s.hw.ram < 20) e.autoScale();
  }
  e.tick(dt);
  t += dt;
  if (s.perks.ci_cd.unlocked) mark("ci_cd", t);
  if (s.perks.auto_scaling.unlocked) mark("auto_scaling", t);
  if (s.hw.jobs >= 2) mark("jobs2", t);
  if (s.hw.jobs >= 4) mark("jobs4", t);
  if (s.runEarned.gte(1e3)) mark("1e3", t);
  if (starsOnRelease(s).gte(1)) mark("release possible", t);
  // release when stars >= target
  if (starsOnRelease(s).gte(releaseTarget)) {
    const g = e.release()!;
    console.log(`${fmt(t)} release #${s.releases} +${g} stars (lifetime ${s.lifetimeStars})`);
    for (;;) { const c = TALENTS.filter(x => e.canBuyTalent(x.id).ok).sort((a, b) => a.cost - b.cost)[0]; if (!c) break; e.buyTalent(c.id); console.log(`   talent ${c.id}`); }
    releaseTarget = Math.max(2, Math.floor(s.lifetimeStars.toNumber() * 0.5));
    if (!s.pipeline) e.compile();
  }
  if (Math.abs(t % 300) < dt / 2) console.log(`${fmt(t)} cpu${s.hw.cpu} ram${s.hw.ram} disk${s.hw.disk} jobs${s.hw.jobs} cr=${s.credits.toStringWithDecimalPlaces(1)} run=${s.runEarned.toStringWithDecimalPlaces(0)} rate=${expectedRate(s).toStringWithDecimalPlaces(1)}/s`);
}
console.log(Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, fmt(v)])));
console.log("achievements", s.achievements.length, "talents", s.talents.length);

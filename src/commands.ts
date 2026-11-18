import type { Engine } from "./core/engine";
import { ACHIEVEMENTS } from "./core/achievements";
import { CHALLENGES } from "./core/challenges";
import {
  HW, PERK_PRICE, autoScaleInterval, bulkPrice, buildTime, challengeGoal, expectedRate, failProbability, has,
  maxAffordable, offlineEfficiency, offlineUnlocked, on, releaseBase, reward, rewardMultiplier,
} from "./core/formulas";
import { UPGRADES, UPGRADE_BY_ID, level, offlineCapHours, upgradeMaxed, upgradePrice } from "./core/upgrades";
import { type HwKey, HW_KEYS, PERK_KEYS, type PerkKey, exportSave, importSave } from "./core/state";
import { TALENTS, TALENT_BY_ID } from "./core/talents";
import { fmt, fmtInt, fmtTime, setNotation } from "./format";
import { setLang, t } from "./i18n";
import { FAIL, INFO, OK, STAR, type Seg, type Terminal } from "./ui/terminal";

export interface GameCtx {
  engine: Engine;
  term: Terminal;
  relayout: () => void;
  openSettings: () => void;
  halt: () => void;
  save: () => void;
}

export const LOGO = String.raw`                                    _ _
  _____ _____ _ _ __ ___ _ __  _ __(_) |___
 / _ \ V / -_) '_/ _/ _ \ '  \| '_ \ | / -_)
 \___/\_/\___|_| \__\___/_|_|_| .__/_|_\___|
                              |_|`;

export const version = (e: Engine) => `${e.s.releases + 1}.0.0`;
const pad = (s: string, n: number) => s.padEnd(n);
const hwUnit = (k: HwKey) => t(`hw.${k}.unit`);

export function perkState(e: Engine, k: PerkKey) {
  const p = e.s.perks[k];
  return !p.unlocked ? t("perk.locked") : p.enabled ? t("perk.enabled") : t("perk.disabled");
}

/** Auto-Scaling level (1–5) from the perk and the four talents of its branch. */
export function autoScaleLevel(e: Engine) {
  return 1 + ["as_perm", "as_fast", "as_ctrl", "as_jobs"].filter(id => on(e.s, id)).length;
}

/** e.g. "lvl 3 · every 0.25s · CPU RAM Disk" */
export function autoScaleInfo(e: Engine) {
  const keys = HW_KEYS.filter(k => e.autoAllowed(k)).map(k => t(`hw.${k}`));
  return `${t("as.level", { n: autoScaleLevel(e) })} · ${t("as.every", { i: fmtTime(autoScaleInterval(e.s)) })} · ${keys.join(" ")}`;
}

/** Text of an optimization's current effect. */
export function upgradeNow(e: Engine, id: string): string {
  const s = e.s;
  const n = level(s, id);
  switch (id) {
    case "opt_reward": return `×${fmt(Math.pow(1.25, n))}`;
    case "opt_speed": return `×${Math.pow(0.9, n).toFixed(2)}`;
    case "opt_boot": return `+${3 * n}`;
    case "off_eff": return `${Math.round(Math.min(1, 0.1 + 0.1 * n) * 100)}%`;
    case "off_dur": return `${offlineCapHours(s)} h`;
  }
  return String(n);
}

export const challengeName = (id: string) => t(`ch.${id}`);

export function printStatus(c: GameCtx) {
  const { s } = c.engine;
  const p = (a: string, b: string) => c.term.println(pad(a, 26) + b);
  c.term.println(["[RESOURCES]", "c-bold"]);
  for (const k of HW_KEYS) p(t(`hw.${k}`), `${s.hw[k]} ${hwUnit(k)}`);
  p(t("credits").toUpperCase(), fmt(s.credits));
  p(t("rel.stars"), fmt(s.stars));
  c.term.println("");
  c.term.println(["[PERKS]", "c-bold"]);
  for (const k of PERK_KEYS) p(t(`perk.${k}`), perkState(c.engine, k));
  c.term.println("");
  c.term.println(["[COMPILATION]", "c-bold"]);
  p(t("pipe.build_time"), fmtTime(buildTime(s)));
  p(t("pipe.reward"), fmt(reward(s)));
  p(t("pipe.fail"), `${(failProbability(s) * 100).toFixed(1)}%`);
  p(t("pipe.rate"), `${fmt(expectedRate(s))}${t("per_sec")}`);
  p(t("st.offline"), offlineUnlocked(s)
    ? t("st.offline.val", { p: Math.round(offlineEfficiency(s) * 100), h: offlineCapHours(s) })
    : t("st.offline.locked"));
  if (s.perks.auto_scaling.unlocked) p(t("perk.auto_scaling"), autoScaleInfo(c.engine));
  if (s.challenge) {
    c.term.println("");
    c.term.println(["[CHALLENGE]", "c-bold"], " ", [challengeName(s.challenge), "c-amber"]);
    p(t("ch.rule"), t(`ch.${s.challenge}.rule`));
    p("goal", `${fmt(s.runEarned)} / ${fmt(challengeGoal(s))}`);
  }
}

function hwDisplayName(k: HwKey) {
  return t(`hw.${k}`);
}

function resolveTalent(arg: string | undefined) {
  if (!arg) return undefined;
  const a = arg.toLowerCase();
  return TALENT_BY_ID[a] ?? TALENTS.find(x => t(`t.${x.id}`).toLowerCase().replace(/\s+/g, "_") === a);
}

export function createCommands(c: GameCtx) {
  const e = () => c.engine;
  const term = c.term;
  const say = (...segs: Seg[]) => term.println(...segs);

  const commands: Record<string, (args: string[]) => void> = {
    help() {
      say(t("help.title"));
      say("");
      const rows: [string, string][] = [
        ["compile", t("help.compile")], ["stop", t("help.stop")], ["buy", t("help.buy")],
        ["shop", t("help.shop")], ["perk", t("help.perk")], ["toggle", t("help.toggle")],
        ["status", t("help.status")], ["release", t("help.release")], ["tree", t("help.tree")],
        ["talent", t("help.talent")], ["optimize", t("help.optimize")], ["challenge", t("help.challenge")], ["achievements", t("help.achievements")], ["stats", t("help.stats")],
        ["save", t("help.save")], ["export", t("help.export")], ["lang", t("help.lang")],
        ["guide", t("help.guide")], ["clear", t("help.clear")], ["exit", t("help.exit")],
      ];
      for (const [cmd, desc] of rows) say([pad(cmd, 14), "c-green"], ["<== ", "c-dim"], desc);
    },
    guide() {
      for (const l of t("guide").split("\n")) say(l);
    },
    status() {
      printStatus(c);
    },
    compile() {
      const en = e();
      if (en.s.pipeline) return void say(INFO, " " + t("term.already_running"));
      say(OK, " " + t("term.sync"));
      say(OK, " " + t("term.flush"));
      say(OK, " " + t("term.start", { n: en.s.hw.jobs }));
      en.compile();
    },
    stop() {
      if (!e().interrupt()) say(t("term.not_running"));
    },
    buy(args) {
      const key = args[0] as HwKey;
      if (!HW_KEYS.includes(key)) return void say(t("term.usage_buy"));
      const raw = args[1] ?? "1";
      const amount = raw === "max" ? "max" : Math.max(1, parseInt(raw, 10) || 1);
      const r = e().buyHw(key, amount as 1);
      if (r.ok) say(OK, " " + t("term.upgraded", { r: hwDisplayName(key), n: r.n, lvl: `${e().s.hw[key]} ${hwUnit(key)}` }));
      else if (r.reason === "max") say(t("term.max", { r: hwDisplayName(key) }));
      else if (r.reason === "locked") say(FAIL, " " + t("term.hw_locked", { r: hwDisplayName(key) }));
      else say(FAIL, " " + t("term.not_enough"));
    },
    shop() {
      const { s } = e();
      say(["[UPGRADE]", "c-bold"]);
      say(`${t("credits")}: ${fmt(s.credits)}`);
      say("");
      for (const k of HW_KEYS) {
        const lvl = s.hw[k];
        const max = HW[k].max;
        const priceTxt = max !== undefined && lvl >= max ? t("hw.max") : `${fmt(bulkPrice(k, lvl, 1))} ${t("credits")}`;
        const afford = maxAffordable(k, lvl, s.credits);
        say([pad(k, 6), "c-green"], `${pad(`${lvl} -> ${lvl + 1}`, 14)}==> ${priceTxt}`, afford > 1 ? ["  (max +" + afford + ")", "c-dim"] : "");
        say(["      " + t(`hw.${k}.desc`), "c-dim"]);
      }
      say("");
      for (const k of PERK_KEYS) {
        say([pad(k, 14), "c-green"], `==> ${fmt(PERK_PRICE[k])} ${t("credits")}  [${perkState(e(), k)}]`);
        say(["      " + t(`perk.${k}.desc`), "c-dim"]);
      }
      say("");
      say(["buy <cpu|ram|disk|jobs> [n|max]  ·  perk <ci_cd|auto_scaling>", "c-dim"]);
    },
    perk(args) {
      const key = args[0] as PerkKey;
      if (!PERK_KEYS.includes(key)) return void say(t("term.usage_perk"));
      const r = e().buyPerk(key);
      const name = t(`perk.${key}`);
      if (r.ok) say(OK, " " + t("term.perk_unlocked", { p: name }));
      else if (r.reason === "owned") say(t("term.perk_owned", { p: name }));
      else say(FAIL, " " + t("term.not_enough"));
    },
    toggle(args) {
      const what = args[0];
      const en = e();
      if (PERK_KEYS.includes(what as PerkKey)) {
        const r = en.togglePerk(what as PerkKey);
        const name = t(`perk.${what}`);
        if (r === null) say(t("term.perk_locked", { p: name }));
        else say(INFO, " " + t("term.perk_toggled", { p: name, s: perkState(en, what as PerkKey) }));
        return;
      }
      const m = /^auto_(cpu|ram|disk|jobs)$/.exec(what ?? "");
      if (m && on(en.s, "as_ctrl") && (m[1] !== "jobs" || on(en.s, "as_jobs"))) {
        const k = m[1] as HwKey;
        en.s.autobuy[k] = !en.s.autobuy[k];
        say(INFO, " " + t("term.perk_toggled", { p: `Auto-Scaling ${t(`hw.${k}`)}`, s: en.s.autobuy[k] ? t("perk.enabled") : t("perk.disabled") }));
        return;
      }
      if (what === "release_bot" && has(en.s, what)) {
        en.s.autoRelease.enabled = !en.s.autoRelease.enabled;
        say(INFO, " " + t("term.perk_toggled", { p: t("t.release_bot"), s: en.s.autoRelease.enabled ? t("perk.enabled") : t("perk.disabled") }));
        return;
      }
      say(t("term.usage_toggle"));
    },
    release() {
      // On success, the "release" event handler prints the result.
      const en = e();
      if (en.s.challenge) return void say(INFO, " " + t("rel.challenge"));
      if (!en.release()) {
        const base = releaseBase(en.s);
        const hint = en.s.runEarned.lt(base) ? t("rel.locked", { x: `${fmt(en.s.runEarned)} / ${fmt(base)}` }) : "";
        say(INFO, " " + t("term.release_no", { hint }));
      }
    },
    optimize(args) {
      const en = e();
      const id = args[0];
      if (!id) {
        say(["[OPTIMIZATIONS]", "c-bold"], `  ★ ${fmt(en.s.stars)}`);
        say(["  " + t("opt.desc"), "c-dim"]);
        for (const u of UPGRADES) {
          if (u.req && !has(en.s, u.req)) continue;
          const maxed = upgradeMaxed(en.s, u.id);
          say([pad(u.id, 12), "c-green"], pad(t(`opt.${u.id}`), 26), pad(t("opt.level", { n: level(en.s, u.id) }), 9),
            pad(upgradeNow(en, u.id), 10), [maxed ? t("opt.max") : `${fmt(upgradePrice(en.s, u.id))}★`, "c-amber"]);
          say(["    " + t(`opt.${u.id}.desc`), "c-dim"]);
        }
        say(["optimize <id>", "c-dim"]);
        return;
      }
      const u = UPGRADE_BY_ID[id];
      if (!u) return void say(t("term.opt_unknown"));
      const r = en.buyUpgrade(id);
      if (r.ok) say(STAR, " " + t("term.opt_ok", { o: t(`opt.${id}`), n: level(en.s, id) }));
      else if (r.reason === "locked") say(FAIL, " " + t("term.opt_locked", { t: u.req ?? "" }));
      else if (r.reason === "max") say(t("term.opt_max"));
      else say(FAIL, " " + t("term.talent_stars"));
    },
    challenge(args) {
      const en = e();
      const arg = args[0];
      if (!arg) {
        say(["[CHALLENGES]", "c-bold"]);
        if (!en.challengesUnlocked) return void say(t("term.ch_locked", { n: 3 }));
        for (const ch of CHALLENGES) {
          const done = en.s.challengesDone.includes(ch.id);
          const active = en.s.challenge === ch.id;
          const mark: Seg = done ? ["[x]", "c-green"] : active ? ["[>]", "c-amber"] : ["[ ]", "c-dim"];
          say(mark, " ", [pad(ch.id, 13), done ? "c-green" : ""], challengeName(ch.id));
          say(["      " + t("ch.rule") + " : " + t(`ch.${ch.id}.rule`), "c-dim"]);
          say(["      " + t("ch.reward") + " : " + t(`ch.${ch.id}.reward`), "c-dim"]);
        }
        say(["challenge <id>  ·  challenge exit", "c-dim"]);
        return;
      }
      if (arg === "exit") {
        if (!en.exitChallenge()) say(t("term.ch_none"));
        return;
      }
      const r = en.startChallenge(arg);
      if (r === "unknown") say(t("term.ch_unknown"));
      else if (r === "locked") say(t("term.ch_locked", { n: 3 }));
      else if (r === "done") say(t("term.ch_already"));
      else if (r === "active") say(t("term.ch_active"));
    },
    tree() {
      const en = e();
      say(["[RELEASE TREE]", "c-bold"], `  ⭐ ${fmt(en.s.stars)}`);
      say("");
      for (const tal of TALENTS) {
        const owned = has(en.s, tal.id);
        const avail = en.canBuyTalent(tal.id);
        const mark: Seg = owned ? ["[x]", "c-green"] : avail.ok ? ["[+]", "c-amber"] : ["[ ]", "c-dim"];
        say(mark, " ", [pad(tal.id, 17), owned ? "c-green" : ""], pad(t(`t.${tal.id}`), 24), [`${tal.cost}⭐`, "c-amber"]);
        say(["      " + t(`t.${tal.id}.desc`) + (tal.req.length ? "  · " + t("tree.requires", { x: tal.req.join(", ") }) : ""), "c-dim"]);
      }
    },
    talent(args) {
      const tal = resolveTalent(args[0]);
      if (!args[0]) return void say(t("term.usage_talent"));
      if (!tal) return void say(t("term.talent_unknown"));
      const r = e().buyTalent(tal.id);
      if (r.ok) say(STAR, " " + t("term.talent_ok", { t: t(`t.${tal.id}`) }));
      else if (r.reason === "owned") say(t("term.talent_owned"));
      else if (r.reason === "req") say(FAIL, " " + t("term.talent_req"));
      else say(FAIL, " " + t("term.talent_stars"));
    },
    achievements() {
      const { s } = e();
      say(["[ACHIEVEMENTS]", "c-bold"], "  " + t("ach.count", { n: s.achievements.length, total: ACHIEVEMENTS.length, x: (1 + 0.02 * s.achievements.length).toFixed(2) }));
      for (const a of ACHIEVEMENTS) {
        const got = s.achievements.includes(a.id);
        if (!got && a.secret) { say(["  🔒 ???", "c-dim"]); continue; }
        say(got ? ["  🏆 ", ""] : ["  🔒 ", "c-dim"], [pad(t(`a.${a.id}`), 28), got ? "c-amber" : "c-dim"], [t(`a.${a.id}.desc`), "c-dim"]);
      }
    },
    stats() {
      const { s } = e();
      const p = (k: string, v: string) => say(pad(t(k), 32), v);
      p("st.builds", fmtInt(s.stats.builds));
      p("st.fails", fmtInt(s.stats.fails));
      p("st.success", s.stats.builds ? `${((1 - s.stats.fails / s.stats.builds) * 100).toFixed(1)}%` : "—");
      p("st.earned", fmt(s.totalEarned));
      p("st.run_earned", fmt(s.runEarned));
      p("st.mult", `×${fmt(rewardMultiplier(s))}`);
      p("st.playtime", fmtTime(s.stats.playTime));
      p("st.runtime", fmtTime(s.stats.runTime));
      p("st.releases", fmtInt(s.releases));
      p("st.lifetime_stars", fmt(s.lifetimeStars));
      p("st.fastest", s.stats.fastestRelease === null ? "—" : fmtTime(s.stats.fastestRelease));
      p("st.streak", fmtInt(s.stats.bestStreak));
      p("st.interrupts", fmtInt(s.stats.interrupts));
    },
    save() {
      c.save();
      say(OK, " " + t("term.saved"));
    },
    export() {
      say(INFO, " " + t("term.export"));
      say([exportSave(e().s), "c-dim sel"]);
    },
    import(args) {
      try {
        const st = importSave(args.join(""));
        e().replaceState(st);
        c.save();
        setLang(st.settings.lang);
        setNotation(st.settings.notation);
        c.relayout();
        say(OK, " " + t("term.import_ok"));
      } catch {
        say(FAIL, " " + t("term.import_fail"));
      }
    },
    lang(args) {
      const l = args[0] === "fr" ? "fr" : args[0] === "en" ? "en" : null;
      if (!l) return void say("lang <en|fr>");
      e().s.settings.lang = l;
      setLang(l);
      c.relayout();
      say(INFO, " " + t("term.lang"));
    },
    notation(args) {
      const n = args[0] === "scientific" ? "scientific" : "standard";
      e().s.settings.notation = n;
      setNotation(n);
      say(INFO, " " + t("term.notation", { n }));
    },
    settings() {
      c.openSettings();
    },
    clear() {
      term.clear();
    },
    sudo() {
      say(t("term.sudo1"));
      say(t("term.sudo2"));
      e().grant("sudo");
    },
    hack() {
      say(["Access granted", "c-green"]);
      e().grant("hack");
    },
    rm(args) {
      if (args.includes("-rf") || args.includes("-fr")) {
        say(["rm: " + t("term.rm1"), "c-red"]);
        say(t("term.rm2"));
        e().grant("rm_rf");
      } else say("rm: missing operand");
    },
    whoami() { say(t("term.whoami")); },
    pwd() { say("/home/dev/overcompile"); },
    ls() { say(["Cargo.toml  Cargo.lock  README.md  ", ""], ["src/  target/", "c-blue"]); },
    uname() { say("Overcompile 0.1.0-web #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux"); },
    echo(args) { say(args.join(" ")); },
    exit() {
      c.halt();
    },
  };

  const aliases: Record<string, string> = {
    make: "compile", build: "compile", upgrade: "shop", manage: "toggle", ach: "achievements",
    prestige: "release", opt: "optimize", optimise: "optimize", ch: "challenge", ship: "release", quit: "exit", shutdown: "exit", cls: "clear", "?": "help",
  };

  function run(line: string, echo = false) {
    if (echo) term.echo(line);
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return;
    const name = aliases[parts[0].toLowerCase()] ?? parts[0].toLowerCase();
    const fn = commands[name];
    if (!fn) {
      say(t("term.invalid", { c: parts[0] }));
      say([t("term.invalid2"), "c-dim"]);
      return;
    }
    if (name === "manage" && parts.length === 1) return commands.status([]);
    fn(parts.slice(1));
  }

  const ARGS: Record<string, string[]> = {
    buy: HW_KEYS, perk: PERK_KEYS as string[], toggle: [...PERK_KEYS, "auto_cpu", "auto_ram", "auto_disk", "auto_jobs", "release_bot"],
    optimize: UPGRADES.map(u => u.id), challenge: [...CHALLENGES.map(c => c.id), "exit"],
    talent: TALENTS.map(x => x.id), lang: ["en", "fr"], notation: ["standard", "scientific"],
  };
  const PUBLIC = ["help", "guide", "status", "compile", "stop", "buy", "shop", "perk", "toggle", "release", "tree", "talent", "optimize", "challenge", "achievements", "stats", "save", "export", "import", "lang", "notation", "settings", "clear", "exit"];

  function complete(line: string): string[] {
    const parts = line.trimStart().split(/\s+/);
    if (parts.length <= 1) return PUBLIC.filter(cmd => cmd.startsWith(parts[0] ?? ""));
    const opts = ARGS[parts[0]];
    if (!opts || parts.length > 2) return [];
    return opts.filter(o => o.startsWith(parts[1])).map(o => `${parts[0]} ${o}`);
  }

  return { run, complete, printStatus: () => printStatus(c) };
}

/** Fake cargo output, stand-in for genact. */
const CRATES = ["serde", "serde_json", "tokio", "anyhow", "clap", "rand", "rand_core", "libc", "syn", "quote",
  "proc-macro2", "memchr", "regex", "regex-syntax", "aho-corasick", "itoa", "ryu", "cfg-if", "bitflags", "log",
  "once_cell", "colored", "rustyline", "nix", "dirs", "which", "ctrlc", "fs2", "hashbrown", "indexmap", "smallvec",
  "parking_lot", "futures", "bytes", "mio", "socket2", "hyper", "http", "tracing", "thiserror", "getrandom",
  "zerocopy", "crossbeam", "rayon", "either", "num-traits", "heck", "strsim", "anstyle", "rustix", "unicode-width",
  "break_eternity", "overcompile-core", "wasm-bindgen", "js-sys", "web-sys", "image", "flate2", "sha2", "uuid"];
const WARNINGS = ["unused variable: `tmp`", "unused import: `std::fmt::Write`", "field `legacy` is never read",
  "function `old_compile` is never used", "variable does not need to be mutable", "unreachable pattern",
  "this `if` has identical blocks", "you are compiling on a Friday"];
const rnd = (n: number) => Math.floor(Math.random() * n);
export function fakeCargoLine(): Seg[] {
  if (Math.random() < 0.05) return [["warning", "c-amber c-bold"], ": " + WARNINGS[rnd(WARNINGS.length)]];
  return [["   Compiling", "c-green c-bold"], ` ${CRATES[rnd(CRATES.length)]} v${rnd(3)}.${rnd(40)}.${rnd(25)}`];
}

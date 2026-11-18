import "./style.css";
import Decimal from "break_eternity.js";
import { Engine, type GameEvent } from "./core/engine";
import { ACHIEVEMENTS } from "./core/achievements";
import {
  HW, PERK_PRICE, autoScaleInterval, bulkPrice, buildTime, challengeGoal, earnedForStars, expectedRate,
  failProbability, has, maxAffordable, nextStarAt, offlineEfficiency, offlineUnlocked, on, releaseBase,
  achievementMultiplier, reward, rewardMultiplier, starMultiplier, starsOnRelease, starsRevealed, talentVisibility,
} from "./core/formulas";
import { CHALLENGES, CHALLENGES_UNLOCK_AT } from "./core/challenges";
import { OBJECTIVES } from "./core/objectives";
import { UPGRADES, level, offlineCapHours, upgradeMaxed, upgradePrice } from "./core/upgrades";
import { HW_KEYS, PERK_KEYS, type HwKey, exportSave, importSave } from "./core/state";
import { TALENTS, TALENT_BY_ID } from "./core/talents";
import { LOGO, autoScaleInfo, challengeName, createCommands, fakeCargoLine, upgradeNow, version } from "./commands";
import { fmt, fmtInt, fmtTime, setNotation } from "./format";
import { setLang, t } from "./i18n";
import { AUTO, FAIL, INFO, OK, STAR, type Seg, Terminal } from "./ui/terminal";

const GAME_VERSION = "0.2.4";

/* ================= Boot ================= */
const engine = Engine.load();
setLang(engine.s.settings.lang);
setNotation(engine.s.settings.notation);

let halted = false;
const term = new Terminal({
  onCommand: line => {
    if (halted) return void boot();
    cmd.run(line, true);
  },
  onCtrlC: () => {
    if (halted) return;
    engine.interrupt();
  },
  complete: line => cmd.complete(line),
});

const ctx = {
  engine,
  term,
  relayout: () => buildLayout(),
  openSettings: () => openSettings(),
  halt: () => void halt(),
  save: () => engine.save(),
};
const cmd = createCommands(ctx);

/* ================= DOM helpers ================= */
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
function h(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}
function setText(el: Element | null, text: string) {
  if (el && el.textContent !== text) el.textContent = text;
}
function toggleClass(el: Element | null, cls: string, on: boolean) {
  if (el && el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/* ================= Layout ================= */
const app = document.getElementById("app")!;
let selectedTalent: string = "warm_cache";
let sideTab: "release" | "challenges" | "achievements" | "stats" = "release";
let mobilePanel: "center" | "shop" | "side" = "center";
let lastAchCount = -1;
let lastSlotCount = -1;
let lastTalentKey = "";
let lastOptKey = "";
let lastChKey = "";

function buildLayout() {
  document.title = "overcompile";
  app.innerHTML = `
  <header class="top">
    <div class="brand"><span class="logo">overcompile</span><span class="cursor">▌</span><span class="ver">v${GAME_VERSION}</span></div>
    <div class="hud">
      <div class="hud-credits"><div class="big" data-r="credits">0</div><div class="sub"><span data-r="rate">0</span> ${t("credits")}${t("per_sec")}</div></div>
      <div class="hud-stars" data-reveal="stars" title="${t("rel.stars")}"><span class="star">⭐</span><span data-r="stars">0</span></div>
    </div>
    <div class="actions">
      <button class="icon-btn" data-a="save" title="${t("save")}">💾</button>
      <button class="icon-btn" data-a="settings" title="${t("settings")}">⚙</button>
    </div>
  </header>
  <main class="layout" data-mobile="${mobilePanel}">
    <section class="col col-shop">
      <div class="card">
        <div class="card-h"><span>${t("panel.hardware")}</span>
          <div class="seg" role="group" aria-label="${t("buy.amount")}">
            <button data-amount="1">×1</button><button data-amount="10">×10</button><button data-amount="max">max</button>
          </div>
        </div>
        <div class="hw-list" data-r="hw"></div>
      </div>
      <div class="card">
        <div class="card-h"><span>${t("panel.perks")}</span></div>
        <div class="perk-list" data-r="perks"></div>
      </div>
    </section>
    <section class="col col-center">
      <div class="card pipeline">
        <div class="card-h">
          <span>${t("panel.pipeline")} <span class="pipe-state" data-r="pipeState"></span></span>
          <button class="run-btn" data-r="runBtn"></button>
        </div>
        <div class="params">
          <div><span class="k">${t("pipe.build_time")}</span><span class="v" data-r="pTime"></span></div>
          <div><span class="k">${t("pipe.reward")}</span><span class="v" data-r="pReward"></span></div>
          <div><span class="k">${t("pipe.fail")}</span><span class="v" data-r="pFail"></span></div>
          <div><span class="k">${t("pipe.rate")}</span><span class="v" data-r="pRate"></span></div>
        </div>
        <div class="slots" data-r="slots"></div>
        <div class="ch-banner" data-r="chBanner" hidden>
          <div class="ch-banner-top"><span class="ch-banner-name" data-r="chName"></span><button class="btn small-btn" data-r="chExit">${t("ch.exit")}</button></div>
          <div class="muted small" data-r="chRule"></div>
          <div class="progress"><div class="fill" data-r="chProg"></div></div>
          <div class="muted small" data-r="chGoal"></div>
        </div>
      </div>
      <div class="card term-card">
        <div class="card-h"><span>${t("panel.terminal")}</span><span class="hint">Tab · ↑↓ · Ctrl+C · Ctrl+L</span></div>
        <div class="term-host" data-r="termHost"></div>
      </div>
    </section>
    <section class="col col-side">
      <div class="tabs" role="tablist">
        <button data-tab="release">${t("tab.release")}</button>
        <button data-tab="challenges" data-reveal="challenges">${t("tab.challenges")} <span class="badge new" data-r="chNew">${t("rev.new")}</span></button>
        <button data-tab="achievements">${t("tab.achievements")} <span class="badge" data-r="achBadge"></span></button>
        <button data-tab="stats">${t("tab.stats")}</button>
      </div>
      <div class="card tab-body" data-body="release">
        <p class="teaser" data-reveal="pre">${t("rev.teaser")}</p>
        <div class="rel-head" data-reveal="stars">
          <div class="rel-stars"><span class="star">⭐</span><span data-r="relStars"></span><span class="lbl">${t("rel.stars")}</span></div>
          <div class="rel-bonus" data-r="relBonus"></div>
        </div>
        <p class="muted small" data-reveal="stars">${t("rel.desc")}</p>
        <button class="release-btn" data-r="relBtn"></button>
        <div class="progress"><div class="fill" data-r="relProg"></div></div>
        <div class="muted small" data-r="relHint"></div>
        <div class="objectives" data-reveal="pre">
          <h3>${t("obj.title")}</h3>
          <div data-r="objList"></div>
        </div>
        <div class="bot" data-r="bot" hidden>
          <label class="switch"><input type="checkbox" data-r="botOn"><span>${t("rel.bot")}</span></label>
          <label class="small">${t("rel.bot.threshold")} <input type="number" min="1" step="1" data-r="botThr"> ⭐</label>
        </div>
        <div data-reveal="stars">
          <h3>${t("rel.tree")}</h3>
          <div class="tree" data-r="tree"></div>
          <div class="tree-detail" data-r="treeDetail"></div>
          <h3>${t("opt.title")}</h3>
          <p class="muted small">${t("opt.desc")}</p>
          <div class="opt-list" data-r="opts"></div>
        </div>
      </div>
      <div class="card tab-body" data-body="challenges">
        <p class="muted small">${t("ch.desc")}</p>
        <div class="ch-list" data-r="chList"></div>
      </div>
      <div class="card tab-body" data-body="achievements">
        <div class="muted small" data-r="achHead"></div>
        <div class="ach-grid" data-r="ach"></div>
      </div>
      <div class="card tab-body" data-body="stats">
        <table class="stats" data-r="stats"></table>
      </div>
    </section>
  </main>
  <nav class="mnav">
    <button data-m="shop">🛒<span>${t("nav.shop")}</span></button>
    <button data-m="center">⌨️<span>${t("nav.terminal")}</span></button>
    <button data-m="side">🚀<span>${t("nav.release")}</span></button>
  </nav>
  <footer class="foot"><a href="https://github.com/Antiz96/incrust" target="_blank" rel="noopener noreferrer">${t("fork_of")}</a></footer>
  <div class="toasts" data-r="toasts"></div>
  <div class="modal" data-r="modal" hidden><div class="modal-box" data-r="modalBox"></div></div>`;

  $("[data-r=termHost]").append(term.root);
  term.root.dataset.log = engine.s.settings.logLevel;
  buildHardware();
  buildPerks();
  buildTree();
  lastAchCount = -1;
  lastSlotCount = -1;
  lastTalentKey = "";
  lastOptKey = "";
  lastChKey = "";
  lastObjKey = "";
  bindLayout();
  render();
}

function buildHardware() {
  const list = $("[data-r=hw]");
  list.replaceChildren();
  for (const k of HW_KEYS) {
    const card = h("button", { class: "hw", "data-hw": k },
      h("div", { class: "hw-top" },
        h("span", { class: "hw-name" }, t(`hw.${k}`)),
        h("span", { class: "hw-lvl", "data-f": "lvl" }),
      ),
      h("div", { class: "hw-desc" }, t(`hw.${k}.desc`)),
      h("div", { class: "hw-bottom" },
        h("span", { class: "hw-effect", "data-f": "effect" }),
        h("span", { class: "hw-price", "data-f": "price" }),
      ),
    );
    const auto = h("label", { class: "auto-pill", "data-f": "auto", hidden: "" },
      h("input", { type: "checkbox" }), h("span", {}, t("auto")));
    auto.addEventListener("click", ev => ev.stopPropagation());
    auto.querySelector("input")!.addEventListener("change", () => cmd.run(`toggle auto_${k}`, true));
    card.querySelector(".hw-top")!.append(auto);
    card.addEventListener("click", () => {
      const a = engine.s.settings.buyAmount;
      cmd.run(`buy ${k}${a === 1 ? "" : " " + a}`, true);
    });
    list.append(card);
  }
}

function buildPerks() {
  const list = $("[data-r=perks]");
  list.replaceChildren();
  for (const k of PERK_KEYS) {
    const btn = h("button", { class: "perk-btn", "data-f": "btn" });
    btn.addEventListener("click", () => {
      cmd.run(engine.s.perks[k].unlocked ? `toggle ${k}` : `perk ${k}`, true);
    });
    list.append(h("div", { class: "perk", "data-perk": k },
      h("div", { class: "perk-main" },
        h("div", { class: "perk-name" }, t(`perk.${k}`), " ", h("span", { class: "perk-state", "data-f": "state" })),
        h("div", { class: "hw-desc", "data-f": "desc" }),
      ),
      btn,
    ));
  }
}

function buildTree() {
  const tree = $("[data-r=tree]");
  tree.replaceChildren();
  const rows = Math.max(...TALENTS.map(x => x.row)) + 1;
  const COLS = 5;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${COLS * 100} ${rows * 100}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("tree-lines");
  for (const tal of TALENTS) {
    for (const r of tal.req) {
      const p = TALENT_BY_ID[r];
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(p.col * 100 + 50));
      line.setAttribute("y1", String(p.row * 100 + 50));
      line.setAttribute("x2", String(tal.col * 100 + 50));
      line.setAttribute("y2", String(tal.row * 100 + 50));
      line.dataset.to = tal.id;
      line.dataset.from = r;
      svg.append(line);
    }
  }
  tree.style.aspectRatio = `${COLS} / ${rows}`;
  tree.append(svg);
  for (const tal of TALENTS) {
    const node = h("button", { class: "node", "data-t": tal.id, title: t(`t.${tal.id}`) },
      h("span", { class: "node-icon" }, tal.icon),
      h("span", { class: "node-cost" }, `${tal.cost}★`),
    );
    node.style.left = `${(tal.col + 0.5) * (100 / COLS)}%`;
    node.style.top = `${(tal.row + 0.5) * (100 / rows)}%`;
    node.addEventListener("click", () => {
      selectedTalent = tal.id;
      lastTalentKey = "";
      render();
    });
    node.addEventListener("dblclick", () => cmd.run(`talent ${tal.id}`, true));
    tree.append(node);
  }
}

function bindLayout() {
  app.querySelectorAll<HTMLButtonElement>("[data-amount]").forEach(b =>
    b.addEventListener("click", () => {
      const v = b.dataset.amount!;
      engine.s.settings.buyAmount = v === "max" ? "max" : (Number(v) as 1 | 10);
      render();
    }));
  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(b =>
    b.addEventListener("click", () => {
      sideTab = b.dataset.tab as typeof sideTab;
      if (sideTab === "challenges" && !engine.s.seen.includes("challenges")) engine.s.seen.push("challenges");
      render();
    }));
  app.querySelectorAll<HTMLButtonElement>("[data-m]").forEach(b =>
    b.addEventListener("click", () => {
      mobilePanel = b.dataset.m as typeof mobilePanel;
      $("main.layout").dataset.mobile = mobilePanel;
      render();
      if (mobilePanel === "center") term.focus();
    }));
  $("[data-r=runBtn]").addEventListener("click", () => {
    if (engine.s.pipeline) { term.echo("^C"); engine.interrupt(); }
    else cmd.run("compile", true);
  });
  $("[data-r=relBtn]").addEventListener("click", () => cmd.run("release", true));
  $("[data-r=chExit]").addEventListener("click", () => cmd.run("challenge exit", true));
  $("[data-a=save]").addEventListener("click", () => cmd.run("save", true));
  $("[data-a=settings]").addEventListener("click", () => openSettings());
  $<HTMLInputElement>("[data-r=botOn]").addEventListener("change", () => cmd.run("toggle release_bot", true));
  $<HTMLInputElement>("[data-r=botThr]").addEventListener("change", ev => {
    const v = Math.max(1, Math.floor(Number((ev.target as HTMLInputElement).value) || 1));
    engine.s.autoRelease.threshold = v;
  });
  $("[data-r=modal]").addEventListener("click", ev => {
    if (ev.target === ev.currentTarget) closeModal();
  });
}

/* ================= Render ================= */
function render() {
  const s = engine.s;
  setText($("[data-r=credits]"), fmt(s.credits));
  setText($("[data-r=rate]"), s.pipeline || engine.ciActive ? fmt(expectedRate(s)) : "0");
  setText($("[data-r=stars]"), fmt(s.stars));

  // Buy amount
  app.querySelectorAll<HTMLButtonElement>("[data-amount]").forEach(b =>
    toggleClass(b, "on", String(s.settings.buyAmount) === b.dataset.amount));

  // Hardware
  for (const k of HW_KEYS) {
    const card = $(`[data-hw=${k}]`);
    const lvl = s.hw[k];
    const max = HW[k].max;
    const maxed = max !== undefined && lvl >= max;
    let n = s.settings.buyAmount === "max" ? Math.max(1, maxAffordable(k, lvl, s.credits)) : s.settings.buyAmount;
    if (max !== undefined) n = Math.max(1, Math.min(n, max - lvl));
    const cost = bulkPrice(k, lvl, n);
    setText($("[data-f=lvl]", card), `${lvl} ${t(`hw.${k}.unit`)}`);
    setText($("[data-f=price]", card), maxed ? t("hw.max") : `${n > 1 ? `+${n} · ` : ""}${fmt(cost)} cr`);
    setText($("[data-f=effect]", card), hwEffect(k));
    const locked = engine.hwLocked(k);
    if (locked) setText($("[data-f=price]", card), "🔒");
    toggleClass(card, "afford", !maxed && !locked && s.credits.gte(cost));
    toggleClass(card, "maxed", maxed || locked);
    const auto = $("[data-f=auto]", card);
    const ownsAuto = on(s, "as_ctrl") && (k !== "jobs" || on(s, "as_jobs"));
    if (auto.hidden === ownsAuto) auto.hidden = !ownsAuto;
    const cb = $<HTMLInputElement>("input", auto);
    if (cb.checked !== s.autobuy[k]) cb.checked = s.autobuy[k];
  }

  // Perks
  for (const k of PERK_KEYS) {
    const el = $(`[data-perk=${k}]`);
    const p = s.perks[k];
    const st = $("[data-f=state]", el);
    setText(st, !p.unlocked ? "" : p.enabled ? t("perk.enabled") : t("perk.disabled"));
    toggleClass(st, "on", p.enabled);
    const btn = $<HTMLButtonElement>("[data-f=btn]", el);
    setText(btn, p.unlocked ? (p.enabled ? "ON" : "OFF") : `${t("unlock")} · ${fmt(PERK_PRICE[k])} cr`);
    toggleClass(btn, "afford", !p.unlocked && s.credits.gte(PERK_PRICE[k]));
    toggleClass(btn, "toggle-on", p.unlocked && p.enabled);
    toggleClass(el, "owned", p.unlocked);
    const desc = k === "auto_scaling"
      ? (p.unlocked ? autoScaleInfo(engine) : t("perk.auto_scaling.desc", { i: fmtTime(autoScaleInterval(s)) }))
      : t(`perk.${k}.desc`);
    setText($("[data-f=desc]", el), desc);
  }

  // Pipeline
  const T = buildTime(s);
  setText($("[data-r=pTime]"), fmtTime(T));
  setText($("[data-r=pReward]"), fmt(reward(s)));
  setText($("[data-r=pFail]"), `${(failProbability(s) * 100).toFixed(1)}%`);
  setText($("[data-r=pRate]"), `${fmt(expectedRate(s))}${t("per_sec")}`);
  setText($("[data-r=pipeState]"), s.pipeline ? (engine.ciActive ? `● ${t("pipe.ci")}` : `● ${t("pipe.running")}`) : "");
  const runBtn = $("[data-r=runBtn]");
  setText(runBtn, s.pipeline ? `■ ${t("interrupt")}` : `▶ ${t("compile")}`);
  toggleClass(runBtn, "running", s.pipeline);
  renderSlots(T);
  renderChallengeBanner();

  // Progressive reveal
  const revealed = { stars: starsRevealed(s), pre: !starsRevealed(s), challenges: engine.challengesUnlocked };
  app.querySelectorAll<HTMLElement>("[data-reveal]").forEach(el => {
    const show = revealed[el.dataset.reveal as keyof typeof revealed];
    if (el.hidden === show) el.hidden = !show;
  });
  const chNew = $("[data-r=chNew]");
  const showNew = engine.challengesUnlocked && !s.seen.includes("challenges");
  if (chNew.hidden === showNew) chNew.hidden = !showNew;
  if (sideTab === "challenges" && !engine.challengesUnlocked) sideTab = "release";

  // Side tabs
  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(b => toggleClass(b, "on", b.dataset.tab === sideTab));
  app.querySelectorAll<HTMLElement>("[data-body]").forEach(b => toggleClass(b, "on", b.dataset.body === sideTab));
  app.querySelectorAll<HTMLButtonElement>("[data-m]").forEach(b => toggleClass(b, "on", b.dataset.m === mobilePanel));

  renderRelease();
  renderOptimizations();
  renderObjectives();
  if (sideTab === "challenges") renderChallenges();
  renderAchievements();
  if (sideTab === "stats") renderStats();
}

function hwEffect(k: HwKey): string {
  const s = engine.s;
  switch (k) {
    case "cpu": return `${fmtTime(buildTime(s))} / build`;
    case "ram": return `${fmt(reward(s))} cr / build`;
    case "disk": return `${(failProbability(s) * 100).toFixed(1)}% fail`;
    case "jobs": return `make -j${s.hw.jobs}`;
  }
}

function renderSlots(T: number) {
  const s = engine.s;
  const box = $("[data-r=slots]");
  if (lastSlotCount !== s.slots.length) {
    lastSlotCount = s.slots.length;
    box.replaceChildren(...s.slots.map((_, i) => h("div", { class: "slot" }, h("div", { class: "fill" }), h("span", { class: "slot-id" }, `#${i + 1}`))));
    box.dataset.n = String(s.slots.length);
  }
  const fast = T < 0.4;
  s.slots.forEach((slot, i) => {
    const el = box.children[i] as HTMLElement;
    const fill = el.firstElementChild as HTMLElement;
    toggleClass(el, "active", slot.running);
    toggleClass(el, "fast", slot.running && fast);
    const w = slot.running ? (fast ? 100 : Math.min(100, slot.progress * 100)) : 0;
    fill.style.width = `${w}%`;
  });
}

function renderRelease() {
  const s = engine.s;
  setText($("[data-r=relStars]"), fmt(s.stars));
  setText($("[data-r=relBonus]"), t("rel.bonus", { x: fmt(starMultiplier(s)) }));
  const gain = starsOnRelease(s);
  const btn = $<HTMLButtonElement>("[data-r=relBtn]");
  const can = gain.gte(1);
  btn.disabled = !can;
  const firstRelease = !starsRevealed(s);
  setText(btn, s.challenge ? `🔒 ${t("rel.challenge")}`
    : can ? (firstRelease ? t("rev.button") : t("rel.button", { v: version(engine), n: fmt(gain) }))
    : `🔒 ${t("rel.title")}`);
  toggleClass(btn, "ready", can);
  let prog: number;
  const base = releaseBase(s);
  if (s.challenge) {
    prog = 0;
    setText($("[data-r=relHint]"), "");
  } else if (!can) {
    prog = s.runEarned.div(base).toNumber();
    setText($("[data-r=relHint]"), t("rel.locked", { x: `${fmt(s.runEarned)} / ${fmt(base)}` }));
  } else {
    const next = nextStarAt(s);
    const prevNeeded = earnedForStars(s, gain);
    prog = s.runEarned.sub(prevNeeded).div(next.sub(prevNeeded).max(1)).toNumber();
    setText($("[data-r=relHint]"), firstRelease ? t("rev.ready") : t("rel.next", { x: fmt(next) }));
  }
  $("[data-r=relProg]").style.width = `${Math.max(0, Math.min(1, prog)) * 100}%`;

  const bot = $("[data-r=bot]");
  const ownsBot = has(s, "release_bot");
  if (bot.hidden === ownsBot) bot.hidden = !ownsBot;
  const botOn = $<HTMLInputElement>("[data-r=botOn]");
  if (botOn.checked !== s.autoRelease.enabled) botOn.checked = s.autoRelease.enabled;
  const thr = $<HTMLInputElement>("[data-r=botThr]");
  if (document.activeElement !== thr && thr.value !== String(s.autoRelease.threshold)) thr.value = String(s.autoRelease.threshold);

  // Tree state
  const key = `${s.talents.join(",")}|${s.stars.toString()}|${selectedTalent}`;
  if (key === lastTalentKey) return;
  lastTalentKey = key;
  const vis = Object.fromEntries(TALENTS.map(x => [x.id, talentVisibility(s, x.id, x.req)]));
  if (vis[selectedTalent] === "hidden") selectedTalent = "warm_cache";
  for (const tal of TALENTS) {
    const node = $(`[data-t=${tal.id}]`);
    toggleClass(node, "hidden", vis[tal.id] === "hidden");
    toggleClass(node, "fog", vis[tal.id] === "fog");
    setText($(".node-icon", node), vis[tal.id] === "fog" ? "???" : tal.icon);
    node.title = vis[tal.id] === "shown" ? t(`t.${tal.id}`) : "???";
    const owned = has(s, tal.id);
    const reqOk = tal.req.every(r => has(s, r));
    toggleClass(node, "owned", owned);
    toggleClass(node, "avail", !owned && reqOk);
    toggleClass(node, "afford", !owned && reqOk && s.stars.gte(tal.cost));
    toggleClass(node, "sel", selectedTalent === tal.id);
  }
  app.querySelectorAll<SVGLineElement>(".tree-lines line").forEach(l => {
    l.classList.toggle("lit", has(s, l.dataset.from!) && has(s, l.dataset.to!));
    l.classList.toggle("hidden", vis[l.dataset.from!] !== "shown" || vis[l.dataset.to!] === "hidden");
  });
  const tal = TALENT_BY_ID[selectedTalent];
  const owned = has(s, tal.id);
  const check = engine.canBuyTalent(tal.id);
  const detail = $("[data-r=treeDetail]");
  const learn = h("button", { class: "learn-btn" + (check.ok ? " afford" : "") }, owned ? `✓ ${t("tree.owned")}` : `${t("buy")} · ${tal.cost} ⭐`);
  if (owned || !check.ok) learn.setAttribute("disabled", "");
  learn.addEventListener("click", () => cmd.run(`talent ${tal.id}`, true));
  if (vis[tal.id] === "fog") {
    detail.replaceChildren(
      h("div", { class: "td-name" }, h("span", { class: "td-tag" }, "[???]"), ` ${t("tree.fog")}`),
      h("div", { class: "td-desc muted" }, t("tree.fog.desc")),
      h("div", { class: "td-req muted small" }, `${tal.cost} ★`),
    );
    return;
  }
  detail.replaceChildren(
    h("div", { class: "td-name" }, h("span", { class: "td-tag" }, `[${tal.icon}]`), ` ${t(`t.${tal.id}`)}`),
    h("div", { class: "td-desc" }, t(`t.${tal.id}.desc`)),
    tal.req.length ? h("div", { class: "td-req muted small" }, t("tree.requires", { x: tal.req.map(r => t(`t.${r}`)).join(", ") })) : "",
    learn,
  );
}

let lastObjKey = "";
function renderObjectives() {
  const s = engine.s;
  if (starsRevealed(s)) return;
  const key = `${s.objectives.join(",")}|${s.objClaimed.join(",")}|${s.settings.lang}`;
  if (key === lastObjKey) return;
  lastObjKey = key;
  // Claimed objectives, then those to claim, then the next three to aim for
  const claimed = OBJECTIVES.filter(o => s.objClaimed.includes(o.id));
  const pending = engine.pendingObjectives();
  const next = OBJECTIVES.filter(o => !s.objectives.includes(o.id)).slice(0, 3);
  const rows = [...claimed, ...pending, ...next].map(o => {
    const done = s.objectives.includes(o.id);
    const isClaimed = s.objClaimed.includes(o.id);
    let right: HTMLElement;
    if (done && !isClaimed) {
      right = h("button", { class: "claim-btn" }, `${t("obj.claim")} +${fmt(o.reward)} cr`);
      right.addEventListener("click", () => cmd.run(`claim ${o.id}`, true));
    } else right = h("span", { class: "obj-reward" }, `+${fmt(o.reward)} cr`);
    return h("div", { class: "obj" + (isClaimed ? " done" : done ? " ready" : "") },
      h("span", { class: "obj-mark" }, isClaimed ? "[x]" : done ? "[!]" : "[ ]"),
      h("span", { class: "obj-name" }, t(`obj.${o.id}`)),
      right);
  });
  const footer = h("div", { class: "obj-count muted small" }, `${claimed.length} / ${OBJECTIVES.length}`);
  if (pending.length > 1) {
    const all = h("button", { class: "claim-btn" }, `${t("obj.claim_all")} (${pending.length})`);
    all.addEventListener("click", () => cmd.run("claim all", true));
    footer.prepend(all, " ");
  }
  $("[data-r=objList]").replaceChildren(...rows, footer);
}

function renderOptimizations() {
  const s = engine.s;
  const key = `${s.stars.toString()}|${JSON.stringify(s.upgrades)}|${s.talents.length}`;
  if (key === lastOptKey) return;
  lastOptKey = key;
  const rows = UPGRADES.filter(u => !u.req || has(s, u.req)).map(u => {
    const maxed = upgradeMaxed(s, u.id);
    const price = upgradePrice(s, u.id);
    const ok = engine.canBuyUpgrade(u.id).ok;
    const btn = h("button", { class: "opt-btn" + (ok ? " afford" : "") }, maxed ? t("opt.max") : t("opt.buy", { n: fmt(price) }));
    if (!ok) btn.setAttribute("disabled", "");
    btn.addEventListener("click", () => cmd.run(`optimize ${u.id}`, true));
    return h("div", { class: "opt" },
      h("div", { class: "opt-main" },
        h("div", { class: "opt-name" }, t(`opt.${u.id}`), " ", h("span", { class: "opt-lvl" }, t("opt.level", { n: level(s, u.id) }))),
        h("div", { class: "hw-desc" }, `${t(`opt.${u.id}.desc`)} · ${t("opt.now", { x: upgradeNow(engine, u.id) })}`),
      ),
      btn,
    );
  });
  $("[data-r=opts]").replaceChildren(...rows);
}

function renderChallengeBanner() {
  const s = engine.s;
  const banner = $("[data-r=chBanner]");
  if (banner.hidden !== !s.challenge) {
    banner.hidden = !s.challenge;
    term.scrollToEnd();
  }
  if (!s.challenge) return;
  const goal = challengeGoal(s);
  setText($("[data-r=chName]"), t("ch.banner", { c: challengeName(s.challenge) }));
  setText($("[data-r=chRule]"), t(`ch.${s.challenge}.rule`));
  setText($("[data-r=chGoal]"), `${fmt(s.runEarned)} / ${fmt(goal)}`);
  $("[data-r=chProg]").style.width = `${Math.min(1, s.runEarned.div(goal).toNumber()) * 100}%`;
}

function renderChallenges() {
  const s = engine.s;
  const key = `${s.challenge}|${s.challengesDone.join(",")}|${engine.challengesUnlocked}|${s.settings.lang}`;
  if (key === lastChKey) return;
  lastChKey = key;
  const list = $("[data-r=chList]");
  if (!engine.challengesUnlocked) {
    list.replaceChildren(h("div", { class: "ch-locked" }, `🔒 ${t("ch.locked", { n: 3 })}`));
    return;
  }
  list.replaceChildren(...CHALLENGES.map(ch => {
    const done = s.challengesDone.includes(ch.id);
    const active = s.challenge === ch.id;
    let action: HTMLElement;
    if (done) action = h("span", { class: "ch-state done" }, `✓ ${t("ch.done")}`);
    else if (active) {
      action = h("button", { class: "btn small-btn" }, t("ch.exit"));
      action.addEventListener("click", () => cmd.run("challenge exit", true));
    } else {
      action = h("button", { class: "btn small-btn ch-start" }, t("ch.start"));
      if (s.challenge) action.setAttribute("disabled", "");
      action.addEventListener("click", () => confirmChallenge(ch.id));
    }
    return h("div", { class: "ch" + (done ? " done" : "") + (active ? " active" : "") },
      h("div", { class: "ch-top" }, h("span", { class: "ch-name" }, challengeName(ch.id)), action),
      h("div", { class: "ch-line" }, h("span", { class: "k" }, t("ch.rule")), t(`ch.${ch.id}.rule`)),
      h("div", { class: "ch-line" }, h("span", { class: "k" }, t("ch.reward")), t(`ch.${ch.id}.reward`)),
    );
  }));
}

function confirmChallenge(id: string) {
  const yes = h("button", { class: "btn" }, t("ch.start"));
  const no = h("button", { class: "btn" }, t("cancel"));
  yes.addEventListener("click", () => { closeModal(); cmd.run(`challenge ${id}`, true); });
  no.addEventListener("click", closeModal);
  openModal(
    h("h2", {}, challengeName(id)),
    h("p", {}, t(`ch.${id}.rule`)),
    h("p", { class: "muted small" }, `${t("ch.reward")} : ${t(`ch.${id}.reward`)}`),
    h("p", { class: "small" }, t("ch.confirm", { c: challengeName(id) })),
    h("div", { class: "row" }, no, yes),
  );
}

/** Achievements that would reveal a feature the player hasn't discovered yet. */
function achievementSpoils(id: string, en: Engine) {
  if (["release_10", "stars_100", "tree_full", "opt_25"].includes(id)) return !starsRevealed(en.s);
  if (["challenge_1", "challenge_all"].includes(id)) return !en.challengesUnlocked;
  return false;
}

function renderAchievements() {
  const s = engine.s;
  const n = s.achievements.length;
  setText($("[data-r=achBadge]"), `${n}/${ACHIEVEMENTS.length}`);
  const achKey = n * 100 + (starsRevealed(s) ? 10 : 0) + (engine.challengesUnlocked ? 1 : 0);
  if (achKey === lastAchCount) return;
  lastAchCount = achKey;
  setText($("[data-r=achHead]"), t("ach.count", { n, total: ACHIEVEMENTS.length, x: achievementMultiplier(s).toFixed(2) }));
  $("[data-r=ach]").replaceChildren(...ACHIEVEMENTS.map(a => {
    const got = s.achievements.includes(a.id);
    const hidden = (a.secret || achievementSpoils(a.id, engine)) && !got;
    return h("div", { class: "ach" + (got ? " got" : "") , title: hidden ? t("ach.secret") : t(`a.${a.id}.desc`) },
      h("div", { class: "ach-icon" }, got ? "🏆" : "🔒"),
      h("div", { class: "ach-name" }, hidden ? "???" : t(`a.${a.id}`)),
      h("div", { class: "ach-desc" }, hidden ? t("ach.secret") : t(`a.${a.id}.desc`)),
    );
  }));
}

function renderStats() {
  const s = engine.s;
  const rows: [string, string][] = [
    ["st.builds", fmtInt(s.stats.builds)],
    ["st.fails", fmtInt(s.stats.fails)],
    ["st.success", s.stats.builds ? `${((1 - s.stats.fails / s.stats.builds) * 100).toFixed(1)}%` : "—"],
    ["st.earned", fmt(s.totalEarned)],
    ["st.run_earned", fmt(s.runEarned)],
    ["st.mult", `×${fmt(rewardMultiplier(s))}`],
    ["st.playtime", fmtTime(s.stats.playTime)],
    ["st.runtime", fmtTime(s.stats.runTime)],
    ["st.releases", fmtInt(s.releases)],
    ["st.lifetime_stars", fmt(s.lifetimeStars)],
    ["st.fastest", s.stats.fastestRelease === null ? "—" : fmtTime(s.stats.fastestRelease)],
    ["st.streak", fmtInt(s.stats.bestStreak)],
    ["st.interrupts", fmtInt(s.stats.interrupts)],
    ["st.offline", offlineUnlocked(s) ? t("st.offline.val", { p: Math.round(offlineEfficiency(s) * 100), h: offlineCapHours(s) }) : t("st.offline.locked")],
    ["opt.title", `${Object.values(s.upgrades).reduce((a, b) => a + b, 0)}`],
    ["tab.challenges", `${s.challengesDone.length} / ${CHALLENGES.length}`],
  ];
  const table = $("[data-r=stats]");
  if (table.childElementCount !== rows.length) {
    table.replaceChildren(...rows.map(() => h("tr", {}, h("th"), h("td"))));
  }
  rows.forEach(([k, v], i) => {
    const tr = table.children[i];
    setText(tr.children[0], t(k));
    setText(tr.children[1], v);
  });
}

/* ================= Toasts & modals ================= */
let toastOverflow: HTMLElement | null = null;
let toastOverflowCount = 0;
function toast(title: string, body: string) {
  const box = $("[data-r=toasts]");
  // At most 3 toasts on screen: the rest are summed up in one line (they are in the terminal log anyway)
  if (box.querySelectorAll(".toast:not(.more)").length >= 3) {
    toastOverflowCount++;
    if (!toastOverflow || !toastOverflow.isConnected) {
      toastOverflow = h("div", { class: "toast more" });
      box.append(toastOverflow);
      const el = toastOverflow;
      setTimeout(() => el.classList.add("out"), 3500);
      setTimeout(() => { el.remove(); toastOverflowCount = 0; }, 4000);
    }
    setText(toastOverflow, `+${toastOverflowCount} …`);
    return;
  }
  const el = h("div", { class: "toast" }, h("div", { class: "toast-t" }, title), h("div", {}, body));
  box.append(el);
  setTimeout(() => el.classList.add("out"), 3500);
  setTimeout(() => el.remove(), 4000);
}

function openModal(...content: (Node | string)[]) {
  const modal = $("[data-r=modal]");
  const close = h("button", { class: "modal-close", "aria-label": t("close") }, "✕");
  close.addEventListener("click", closeModal);
  $("[data-r=modalBox]").replaceChildren(close, ...content);
  modal.hidden = false;
}
function closeModal() {
  $("[data-r=modal]").hidden = true;
  term.focus();
}

function openSettings() {
  const s = engine.s;
  const langSel = h("select", {}, h("option", { value: "en" }, "English"), h("option", { value: "fr" }, "Français")) as HTMLSelectElement;
  langSel.value = s.settings.lang;
  langSel.addEventListener("change", () => { cmd.run(`lang ${langSel.value}`, true); openSettings(); });
  const notSel = h("select", {},
    h("option", { value: "standard" }, t("set.notation.standard")),
    h("option", { value: "scientific" }, t("set.notation.scientific"))) as HTMLSelectElement;
  notSel.value = s.settings.notation;
  notSel.addEventListener("change", () => cmd.run(`notation ${notSel.value}`, true));
  const logSel = h("select", {},
    h("option", { value: "full" }, t("set.log.full")),
    h("option", { value: "reduced" }, t("set.log.reduced")),
    h("option", { value: "minimal" }, t("set.log.minimal"))) as HTMLSelectElement;
  logSel.value = s.settings.logLevel;
  logSel.addEventListener("change", () => {
    s.settings.logLevel = logSel.value as LogLevel;
    term.root.dataset.log = s.settings.logLevel;
  });

  const area = h("textarea", { rows: "4", placeholder: t("set.import.placeholder") }) as HTMLTextAreaElement;
  const msg = h("div", { class: "small muted" });
  const exportBtn = h("button", { class: "btn" }, t("set.export"));
  exportBtn.addEventListener("click", async () => {
    engine.save();
    area.value = exportSave(engine.s);
    try { await navigator.clipboard.writeText(area.value); } catch { /* clipboard may be unavailable */ }
    setText(msg, t("set.export.done"));
  });
  const importBtn = h("button", { class: "btn" }, t("set.import"));
  importBtn.addEventListener("click", () => {
    try {
      const st = importSave(area.value);
      engine.replaceState(st);
      engine.save();
      setLang(st.settings.lang);
      setNotation(st.settings.notation);
      buildLayout();
      closeModal();
      term.println(OK, " " + t("term.import_ok"));
    } catch {
      setText(msg, t("set.import.fail"));
    }
  });
  const resetBtn = h("button", { class: "btn danger" }, t("set.reset"));
  resetBtn.addEventListener("click", () => {
    const yes = h("button", { class: "btn danger" }, t("confirm"));
    const no = h("button", { class: "btn" }, t("cancel"));
    yes.addEventListener("click", () => {
      engine.hardReset();
      engine.save();
      setLang(engine.s.settings.lang);
      term.clear();
      buildLayout();
      closeModal();
      boot();
    });
    no.addEventListener("click", () => openSettings());
    openModal(h("h2", {}, t("set.reset")), h("p", {}, t("set.reset.confirm")), h("div", { class: "row" }, no, yes));
  });

  openModal(
    h("h2", {}, t("settings")),
    h("label", { class: "field" }, h("span", {}, t("set.lang")), langSel),
    h("label", { class: "field" }, h("span", {}, t("set.notation")), notSel),
    h("label", { class: "field" }, h("span", {}, t("set.log")), logSel),
    h("hr"),
    area,
    h("div", { class: "row" }, exportBtn, importBtn),
    msg,
    h("hr"),
    resetBtn,
  );
}

function showOffline(rep: NonNullable<ReturnType<Engine["simulateOffline"]>>) {
  if (rep.away < 60) return; // short absences are silent
  const items = [
    h("li", {}, t("off.credits", { x: fmt(rep.credits) })),
    h("li", {}, t("off.builds", { n: fmtInt(rep.builds), f: fmtInt(rep.fails) })),
  ];
  if (rep.upgrades > 0) items.push(h("li", {}, t("off.upgrades", { n: fmtInt(rep.upgrades) })));
  if (rep.releases > 0) items.push(h("li", {}, t("off.releases", { n: rep.releases, s: fmt(rep.stars) })));
  for (const a of rep.achievements) items.push(h("li", {}, `🏆 ${t(`a.${a}`)}`));
  openModal(
    h("h2", {}, `🌙 ${t("off.title")}`),
    h("p", {}, t("off.time", { t: fmtTime(rep.away) })),
    h("p", { class: "muted small" }, t("off.grace")),
    rep.unlocked
      ? h("p", { class: "muted small" }, t("off.eff", { p: Math.round(rep.eff * 100) }))
      : h("p", { class: "muted small" }, t("off.locked")),
    rep.capped ? h("p", { class: "muted small" }, t("off.capped", { h: offlineCapHours(engine.s) })) : "",
    h("ul", { class: "off-list" }, ...items),
  );
  term.println(INFO, ` ${t("off.title")} (${fmtTime(rep.away)}): +${fmt(rep.credits)} ${t("credits")}`);
}

/* ================= Game events → terminal ================= */
// The journal only gets what matters. Builds feed the live status line (top of
// the terminal) and a summary line every minute.
type LogLevel = "full" | "reduced" | "minimal";
const logLevel = (): LogLevel => engine.s.settings.logLevel;
let minute = { ok: 0, fail: 0, credits: new Decimal(0), time: 0 };
let runCount = { ok: 0, fail: 0 };
let lastMinuteRate = 0;
let autobuys: Partial<Record<HwKey, number>> = {};
let autobuyTimer = 0;
let bestDecade = Number.NEGATIVE_INFINITY;

engine.on((e: GameEvent) => {
  switch (e.t) {
    case "builds":
      minute.ok += e.ok;
      minute.fail += e.fail;
      minute.credits = minute.credits.add(e.credits);
      runCount.ok += e.ok;
      runCount.fail += e.fail;
      // Manual mode (no CI/CD): every build is a decision, so its result is worth a line
      if (!engine.ciActive) {
        for (let i = 0; i < e.fail; i++) term.println(FAIL, " " + t("term.build_fail"));
        if (e.ok) term.println(OK, " " + t("log.build_ok", { x: fmt(e.credits) }));
      }
      break;
    case "interrupted":
      term.println(INFO, " " + t("term.interrupted"));
      break;
    case "autobuy":
      autobuys[e.key] = (autobuys[e.key] ?? 0) + e.n;
      break;
    case "achievement":
      term.println(["🏆 ", ""], [t("term.achievement", { a: t(`a.${e.id}`) }).replace("🏆 ", ""), "c-amber"]);
      toast(t("ach.unlocked"), `🏆 ${t(`a.${e.id}`)}`);
      break;
    case "release": {
      flushMinute(true);
      runCount = { ok: 0, fail: 0 };
      lastMinuteRate = 0;
      const v = `${engine.s.releases}.0.0`;
      term.banner(`🚀 v${v} · +${fmt(e.stars)} ★`);
      if (e.auto) term.println(STAR, " " + t("term.release_auto", { v, n: fmt(e.stars) }));
      else term.println(STAR, " " + t("term.release_ok", { v, n: fmt(e.stars), b: fmt(starMultiplier(engine.s)) }));
      toast("🚀 Release", `v${v} · +${fmt(e.stars)} ⭐`);
      if (engine.s.releases === 1) {
        term.println(STAR, " " + t("rev.first"));
        term.println(["[ NEW ]", "c-green"], " " + t("rev.cmds", { c: "tree, talent, optimize" }));
      }
      if (engine.s.releases === CHALLENGES_UNLOCK_AT) {
        term.println(["[ NEW ]", "c-green"], " " + t("rev.cmds", { c: "challenge" }));
        toast(t("rev.new"), t("tab.challenges"));
      }
      engine.save();
      break;
    }
    case "challenge_start":
      flushMinute(true);
      runCount = { ok: 0, fail: 0 };
      term.println(["[ CH ]", "c-amber"], " " + t("term.ch_started", { c: challengeName(e.id), x: fmt(challengeGoal(engine.s)) }));
      toast("Challenge", challengeName(e.id));
      break;
    case "challenge_done":
      term.banner(`✓ ${t("ch.done")} · ${challengeName(e.id)}`, "c-green");
      term.println(["[ CH ]", "c-green"], " " + t("term.ch_done", { c: challengeName(e.id), r: t(`ch.${e.id}.reward`) }));
      toast(t("ch.done"), `${challengeName(e.id)} · ${t(`ch.${e.id}.reward`)}`);
      engine.save();
      break;
    case "challenge_exit":
      term.println(["[ CH ]", "c-dim"], " " + t("term.ch_exit", { c: challengeName(e.id) }));
      break;
    case "objective":
      term.println(["[ OBJ ]", "c-green"], " " + t("obj.done", { o: t(`obj.${e.id}`), x: fmt(e.reward) }));
      toast(t("obj.title"), `${t(`obj.${e.id}`)} · ${t("obj.claim")} +${fmt(e.reward)} cr`);
      break;
    case "pipeline_start":
    case "pipeline_done":
      break;
  }
});

function autobuyText(): string {
  const entries = Object.entries(autobuys).filter(([, n]) => n! > 0);
  autobuys = {};
  return entries.map(([k, n]) => `${t(`hw.${k}`)} +${n}`).join(", ");
}

/** "── 1 min · 2 340 builds (52 failed) · +4.8K cr · 80.4/s (+12%) ──" */
function flushMinute(force = false) {
  const m = minute;
  minute = { ok: 0, fail: 0, credits: new Decimal(0), time: 0 };
  const n = m.ok + m.fail;
  if (n === 0 || m.time < (force ? 5 : 1) || logLevel() === "minimal") return;
  const rate = m.credits.div(m.time).toNumber();
  const segs: Seg[] = [["── ", "c-dim"], [fmtTime(m.time), "c-dim"], " · ",
    t("log.summary", { n: fmtInt(n), f: fmtInt(m.fail), x: fmt(m.credits) }), " · ", [`${fmt(rate)}/s`, "c-green"]];
  if (lastMinuteRate > 0 && !force) {
    const delta = (rate / lastMinuteRate - 1) * 100;
    if (Math.abs(delta) >= 1) segs.push(" ", [`(${delta > 0 ? "+" : ""}${delta.toFixed(0)} %)`, delta > 0 ? "c-green" : "c-red"]);
  }
  if (logLevel() === "reduced") {
    const auto = autobuyText();
    if (auto) segs.push(" · ", ["auto: " + auto, "c-violet"]);
  }
  segs.push([" ──", "c-dim"]);
  term.println(...segs).classList.add("summary");
  if (!force) lastMinuteRate = rate;
}

function flushAutobuys() {
  const auto = autobuyText();
  if (auto && logLevel() === "full") term.println(AUTO, " " + t("term.autobuy", { list: auto }));
}

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spin = 0;
function renderStatus() {
  const s = engine.s;
  if (!s.pipeline) {
    term.setStatus(["■ ", "c-dim"], [t("log.idle"), "c-dim"]);
    return;
  }
  spin = (spin + 1) % SPIN.length;
  const T = buildTime(s);
  const width = 20;
  const fast = T < 0.4;
  const progress = fast ? 1 : Math.max(0, ...s.slots.map(sl => (sl.running ? sl.progress : 0)));
  const fill = Math.round(progress * width);
  term.setStatus(
    [SPIN[spin] + " ", "c-green"], ["Building ", "c-bold"],
    "[", [fast ? "▓".repeat(width) : "█".repeat(fill), "c-green"], fast ? "" : ["░".repeat(width - fill), "c-dim"], "] ",
    fast ? [t("pipe.continuous").padEnd(4), "c-dim"] : `${String(Math.floor(progress * 100)).padStart(3)}%`,
    "  ", ["✓ " + fmtInt(runCount.ok), "c-green"], "  ", ["✗ " + fmtInt(runCount.fail), "c-red"],
    "  ", ["+" + fmt(s.runEarned) + " cr", "c-amber"], "  ", [fmt(expectedRate(s)) + "/s", "c-dim"],
  );
}

/* ================= Main loop ================= */
let last = performance.now();
let saveTimer = 0;
let recordTimer = 0;

function loop() {
  const now = performance.now();
  let dt = (now - last) / 1000;
  last = now;
  if (halted) return;

  if (dt > 60) {
    // The tab was asleep (laptop lid closed, throttled tab…): treat as offline time
    const rep = engine.simulateOffline(dt);
    if (rep) showOffline(rep);
    minute = { ok: 0, fail: 0, credits: new Decimal(0), time: 0 };
    dt = 0;
  }
  if (engine.s.pipeline) minute.time += dt;
  // Split long frames so that slots and autobuyers behave consistently
  while (dt > 0) {
    const step = Math.min(dt, 1);
    engine.tick(step);
    dt -= step;
  }

  const summaryEvery = logLevel() === "minimal" ? 300 : 60;
  if (minute.time >= summaryEvery) flushMinute();
  autobuyTimer += 0.1;
  if (autobuyTimer >= 30) { autobuyTimer = 0; flushAutobuys(); }
  // Records: announce each new power of ten of income
  recordTimer += 0.1;
  if (recordTimer >= 1) {
    recordTimer = 0;
    const rate = expectedRate(engine.s).toNumber();
    const decade = rate > 0 ? Math.floor(Math.log10(rate)) : Number.NEGATIVE_INFINITY;
    if (engine.s.pipeline && engine.ciActive && decade > bestDecade && decade >= 1) {
      if (bestDecade !== Number.NEGATIVE_INFINITY) term.println(["[ REC ]", "c-amber"], " " + t("log.record", { r: fmt(Math.pow(10, decade)) }));
      bestDecade = decade;
    }
  }
  saveTimer += 0.1;
  if (saveTimer >= 15) { saveTimer = 0; engine.save(); }

  render();
  renderStatus();
}

// Decorative build output in the stream zone (rate scales with CPU, capped)
function cargoTick() {
  if (!halted && engine.s.pipeline && logLevel() !== "minimal") term.streamLine(...fakeCargoLine());
  const speed = Math.ceil(engine.s.hw.cpu / 10);
  const delay = Math.max(250, (200 + Math.random() * 700) / speed);
  setTimeout(cargoTick, delay);
}

/* ================= Boot / halt ================= */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function boot() {
  halted = false;
  term.clear();
  const steps = ["Starting system initialization...", "Mounting virtual filesystems...", "Detecting available brain cells...",
    "Fetching coffee...", "Checking if it works on my machine...", "Loading essential nonsense..."];
  for (const s of steps) { term.println(OK, " " + s); await sleep(90); }
  term.println([LOGO, "c-green ascii"]);
  term.println(["  v" + GAME_VERSION + " · " + t("fork_of"), "c-dim"]);
  term.println("");
  cmd.printStatus();
  term.println("");
  term.println(t("term.welcome"));
  term.println("");
  term.focus();
}

async function halt() {
  flushMinute(true);
  engine.interrupt();
  engine.save();
  const steps: [typeof OK, string, number][] = [
    [OK, "Terminating background nonsense...", 200], [OK, "Saving imaginary progress...", 200],
    [OK, "Returning borrowed brain cells...", 300], [FAIL, "Considering touching some grass...", 300],
    [OK, "Flushing coffee reserves...", 600], [OK, "Shutting down system...", 500],
  ];
  halted = true;
  for (const [tag, msg, ms] of steps) { term.println(tag, " " + msg); await sleep(ms); }
  term.println("");
  term.println([t("term.halted"), "c-dim"]);
}

/* ================= Start ================= */
buildLayout();
const away = (Date.now() - engine.s.lastSeen) / 1000;
boot().then(() => {
  const rep = engine.simulateOffline(away);
  if (rep) showOffline(rep);
  else if (away > 300 && engine.s.stats.builds > 0 && !engine.ciActive) {
    term.println(INFO, " " + t("off.nothing"));
  }
  if (rep && !rep.unlocked && away > 300) term.println(INFO, " " + t("off.locked"));
});
setInterval(loop, 100);
cargoTick();
window.addEventListener("beforeunload", () => engine.save());
document.addEventListener("visibilitychange", () => { if (document.hidden) engine.save(); });
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && !$("[data-r=modal]").hidden) closeModal();
  const target = ev.target as HTMLElement;
  const inField = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
  // Typing anywhere goes to the terminal
  if (!inField && $("[data-r=modal]").hidden && ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) term.focus();
  // Ctrl+C anywhere (outside of text fields) interrupts the pipeline
  if (!inField && ev.ctrlKey && ev.key.toLowerCase() === "c" && !String(window.getSelection()) && engine.s.pipeline) {
    ev.preventDefault();
    term.echo("^C");
    engine.interrupt();
  }
});

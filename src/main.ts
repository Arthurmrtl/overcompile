import "./style.css";
import { initTutorial, replayTutorial, updateTutorial } from "./ui/tutorial";
import { initPwa, installMode, promptInstall } from "./ui/pwa";
import { initWakeLock, setWakeLock, wakeLockEnabled, wakeLockSupported } from "./ui/wakelock";
import { openRoulette } from "./ui/roulette";
import Decimal from "break_eternity.js";
import { Engine, type GameEvent, MATRIX_HANDS, MATRIX_TIMEOUT, type OfflineGains } from "./core/engine";
import { ACH_BY_ID, ACHIEVEMENTS, type Achievement } from "./core/achievements";
import {
  HW, JOBS_PRIO_STEPS, autoScaleInterval, perkLocked, perkPrice, bulkPrice, buildTime, challengeGoal, earnedForStars, expectedRate,
  failProbability, diskCacheMult, genRequired, gensRevealed, has, maxAffordable, totalGens, nextStarAt, offlineEfficiency, offlineUnlocked, on, releaseBase,
  reward, rewardMultiplier, starMultiplier, starsOnRelease, starsRevealed, talentVisibility,
} from "./core/formulas";
import { CHALLENGES, CHALLENGES_UNLOCK_AT } from "./core/challenges";
import { UPGRADES, level, offlineCapHours, upgradeMaxed, upgradePrice } from "./core/upgrades";
import { GEN_KEYS, type GameState, type GenKey, HW_KEYS, PERK_KEYS, type HwKey, exportSave, importSave } from "./core/state";
import {
  type EffectKey, type KModule, type MilestoneId, EFFECT_KEYS, MARKET, MILESTONES, MILESTONE_BY_ID, MODULE_NAMES, RARITIES, RARITY_CHANCE, canFuse, cratePrice, levelMult, loadedModules, recompileCost,
  marketShare, moduleBonus, moduleScore, moduleSlots, nextMilestone, reached, recycleValue, sliceCost,
} from "./core/market";
import { TALENTS, TALENT_BY_ID } from "./core/talents";
import {
  LOGO, achDesc, achVisible, autoScaleInfo, bonusSummary, challengeName, createCommands, fakeCargoLine, genBonusText, progressText,
  eventBonusText, jobsPrioText, parseJobsPrio, rewardText, upgradeNow, version,
} from "./commands";
import { achProgress } from "./core/achievements";
import { fmt, fmtInt, fmtTime, setNotation } from "./format";
import { setLang, t } from "./i18n";
import { AUTO, FAIL, INFO, OK, STAR, type Seg, Terminal, TOUCH } from "./ui/terminal";
import { type Advice, type DistroAdvice, DistroAdvisor, type ForkAdvice, ForkAdvisor, ReleaseAdvisor } from "./core/advisor";
import {
  DISTRO_PCT, DISTRO_TALENTS, DISTRO_TALENT_BY_ID, FLAVORS, type Flavor, distroRevealed, distroTalentVisibility,
  forkTreeComplete, hasDistro, NEXT_DISTRO_TALENTS, NEXT_FORK_DISTRO_TALENTS, nextPackageAt, packagesExact, packagesGainsMult, packagesOnDistro, UPSTREAM_PACKAGES,
} from "./core/distro";
import {
  FORK_TALENTS, FORK_TALENT_BY_ID, FORK_UPGRADES, PR_EFFECTS, contribGainsMult, contributorsOnFork, contributorBreakdown, forkUpgradeLevel,
  forkUpgradePrice, forkRevealed, hasFork, forkTalentVisibility,
  NEXT_FORK_TALENTS, starsForFirstContributor, treeComplete,
} from "./core/fork";
import { EVENT_BY_ID, EVENT_WINDOW, PAGER_WINDOW, RC_STARS_PCT } from "./core/events";

const GAME_VERSION = "0.6.6";

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
let sideTab: "release" | "challenges" | "fork" | "distro" | "market" | "achievements" | "stats" = "release";
let mobilePanel: "center" | "shop" | "side" = "center";
const advisor = new ReleaseAdvisor();
let advice: Advice = advisor.update(engine.s);
let advisedLogged = false; // one journal line per run when the advice turns on
const forkAdvisor = new ForkAdvisor();
let forkAdvice: ForkAdvice = forkAdvisor.update(engine.s);
const distroAdvisor = new DistroAdvisor();
let distroAdvice: DistroAdvice = distroAdvisor.update(engine.s);
let distroAdvisedLogged = false;
let forkAdvisedLogged = false;
let lastAchCount = "";
let lastSlotCount = -1;
let lastTalentKey = "";
let lastOptKey = "";
let lastChKey = "";

/** Mobile tab bar: line icons (SVG, theme colour) instead of emojis (Arthur: "less AI slop"). */
const svgIcon = (body: string) =>
  `<svg class="nav-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const NAV_ICONS = {
  // a chip: the shop sells hardware
  shop: svgIcon('<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>'),
  // a prompt
  terminal: svgIcon('<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 10l3 2.5L7 15M12.5 15.5H17"/>'),
  // rising bars: releases, challenges, fork, achievements, stats
  progress: svgIcon('<path d="M4 20h16"/><rect x="5.5" y="13" width="3" height="5"/><rect x="10.5" y="9" width="3" height="9"/><rect x="15.5" y="5" width="3" height="13"/>'),
};

/**
 * Desktop only (v0.4.11, Arthur: the right panel got cramped once forking): the shop and side
 * columns can be resized by dragging the handles between columns. Double-click: default ⇄ wide.
 * A UI preference, kept in its own localStorage key (not in the save).
 */
const LAYOUT_KEY = "overcompile-layout";
const COL_DEFAULT = { shop: 300, side: 370 };
const COL_WIDE = { shop: 420, side: 620 };
const COL_MIN = { shop: 240, side: 300 };
const CENTER_MIN = 360;
let colW: { shop: number | null; side: number | null } = { shop: null, side: null };
try { colW = { ...colW, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || "{}") }; } catch { /* default widths */ }
function applyColumns() {
  const l = document.querySelector<HTMLElement>(".layout");
  if (!l) return;
  for (const k of ["shop", "side"] as const) {
    if (colW[k] === null) l.style.removeProperty(`--w-${k}`);
    else l.style.setProperty(`--w-${k}`, `${colW[k]}px`);
  }
}
function clampColumn(k: "shop" | "side", w: number) {
  const other = k === "shop" ? colW.side ?? COL_DEFAULT.side : colW.shop ?? COL_DEFAULT.shop;
  const max = window.innerWidth - other - CENTER_MIN - 48;
  return Math.round(Math.max(COL_MIN[k], Math.min(w, max)));
}
// A smaller window must still leave the terminal its minimum width
window.addEventListener("resize", () => {
  for (const k of ["shop", "side"] as const) if (colW[k] !== null) colW[k] = clampColumn(k, colW[k]!);
  applyColumns();
});
function saveColumns() { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(colW)); } catch { /* not kept */ } }
function initColumnHandles() {
  const l = $(".layout");
  for (const handle of l.querySelectorAll<HTMLElement>(".col-handle")) {
    const k = handle.dataset.handle as "shop" | "side";
    handle.addEventListener("pointerdown", ev => {
      ev.preventDefault();
      handle.setPointerCapture(ev.pointerId);
      handle.classList.add("drag");
      document.documentElement.classList.add("resizing");
      const rect = l.getBoundingClientRect();
      const move = (e: PointerEvent) => {
        colW[k] = clampColumn(k, k === "shop" ? e.clientX - rect.left - 12 : rect.right - e.clientX - 12);
        applyColumns();
      };
      const up = () => {
        handle.classList.remove("drag");
        document.documentElement.classList.remove("resizing");
        handle.removeEventListener("pointermove", move);
        saveColumns();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up, { once: true });
      handle.addEventListener("pointercancel", up, { once: true });
    });
    handle.addEventListener("dblclick", () => {
      colW[k] = colW[k] !== null && colW[k]! > COL_DEFAULT[k] + 20 ? null : clampColumn(k, COL_WIDE[k]);
      applyColumns();
      saveColumns();
    });
  }
  applyColumns();
}

function buildLayout() {
  document.title = "overcompile";
  app.innerHTML = `
  <header class="top">
    <div class="brand"><span class="logo">overcompile</span><span class="cursor">▌</span><span class="ver">v${GAME_VERSION}</span></div>
    <div class="hud">
      <div class="hud-credits"><div class="big" data-r="credits">0</div><div class="sub"><span data-r="rate">0</span> ${t("credits")}${t("per_sec")}</div></div>
      <div class="hud-cur">
        <div class="hud-stars" data-reveal="stars" title="${t("rel.stars")}"><span class="star">⭐</span><span data-r="stars">0</span></div>
        <div class="hud-contrib" data-reveal="forked" title="${t("fk.contributors")}"><span class="fk-glyph">⑂</span><span data-r="contrib">0</span></div>
        <div class="hud-pkg" data-reveal="distroed" title="${t("ds.packages")}"><span class="pk-glyph">▣</span><span data-r="pkg">0</span></div>
        <div class="hud-mk" data-reveal="market" title="${t("mk.share")}"><span class="mk-glyph">◕</span><span data-r="mkPct">0</span></div>
      </div>
    </div>
    <div class="actions">
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
    <div class="col-handle" data-handle="shop" role="separator" aria-orientation="vertical" title="${t("layout.resize")}"></div>
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
        <div class="buffs" data-r="buffs" hidden></div>
        <div class="ch-banner" data-r="chBanner" hidden>
          <div class="ch-banner-top"><span class="ch-banner-name" data-r="chName"></span><button class="btn small-btn" data-r="chExit">${t("ch.exit")}</button></div>
          <div class="muted small" data-r="chRule"></div>
          <div class="progress"><div class="fill" data-r="chProg"></div></div>
          <div class="muted small" data-r="chGoal"></div>
        </div>
      </div>
      <div class="card term-card">
        <div class="card-h"><span>${t("panel.terminal")}</span><span class="hint kb-only">Tab · ↑↓ · Ctrl+C · Ctrl+L</span></div>
        <div class="term-host" data-r="termHost"></div>
      </div>
    </section>
    <div class="col-handle" data-handle="side" role="separator" aria-orientation="vertical" title="${t("layout.resize")}"></div>
    <section class="col col-side">
      <div class="tabs" role="tablist">
        <button data-tab="release">${t("tab.release")} <span class="badge new" data-r="relBadge" hidden>!</span></button>
        <button data-tab="challenges" data-reveal="challenges">${t("tab.challenges")} <span class="badge new" data-r="chNew">${t("rev.new")}</span></button>
        <button data-tab="fork" data-reveal="fork">${t("tab.fork")} <span class="badge new" data-r="forkBadge" hidden></span></button>
        <button data-tab="distro" data-reveal="distro">${t("tab.distro")} <span class="badge new" data-r="distroBadge" hidden>!</span></button>
        <button data-tab="market" data-reveal="market">${t("tab.market")} <span class="badge new" data-r="mkBadge" hidden>!</span></button>
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
        <div class="rel-rc small" data-r="relRc" hidden></div>
        <div class="rel-rate small" data-r="relRate" hidden></div>
        <p class="teaser small" data-r="forkTeaser" hidden>${t("fk.teaser_tree")}</p>
        <div class="bot" data-r="bot" hidden>
          <label class="switch"><input type="checkbox" data-r="botOn"><span>${t("rel.bot")}</span></label>
          <label class="small">${t("rel.bot.threshold")} <input type="number" min="1" step="1" data-r="botThr"> ⭐</label>
        </div>
        <div data-reveal="stars">
          <h3>${t("rel.tree")}</h3>
          <label class="switch small" data-r="ansAuto" hidden><input type="checkbox"><span>${t("rel.ans")}</span></label>
          <div class="tree" data-r="tree"></div>
          <div class="tree-detail" data-r="treeDetail"></div>
          <h3>${t("opt.title")}</h3>
          <p class="muted small">${t("opt.desc")}</p>
          <div class="opt-list" data-r="opts"></div>
        </div>
      </div>
      <div class="card tab-body" data-body="challenges">
        <p class="muted small">${t("ch.desc")}</p>
        <label class="switch small" data-r="mtxAuto" hidden><input type="checkbox"><span>${t("ch.mtx")}</span></label>
        <div class="small mtx-state" data-r="mtxState" hidden></div>
        <div class="ch-list" data-r="chList"></div>
      </div>
      <div class="card tab-body" data-body="fork">
        <div class="fork-card" data-r="forkCard" hidden>
          <div class="fork-title"><span class="fk-glyph">⑂</span> <span data-r="forkTitle"></span></div>
          <div class="muted small" data-r="forkDesc"></div>
          <button class="fork-btn" data-r="forkBtn" hidden></button>
          <div class="fork-calc" data-r="forkCalc" hidden></div>
          <div class="rel-rate small" data-r="forkRate" hidden></div>
        </div>
        <!-- Fork bot (Distro talent fbot): set here, next to the fork button, like the Release bot in the Release tab -->
        <div class="bot" data-r="fbot" hidden>
          <label class="switch"><input type="checkbox" data-r="fbotOn"><span>${t("ds.fbot")}</span></label>
          <label class="small">${t("ds.fbot.threshold")} <input type="number" min="0" step="1" data-r="fbotThr"> ⑂</label>
          <div class="muted small">${t("ds.fbot.hint")}</div>
        </div>
        <div class="fork-sum" data-r="forkSum" data-reveal="forked"></div>
        <p class="teaser small" data-r="distroTeaser" hidden>${t("ds.teaser")}</p>
        <div data-reveal="forked">
          <h3>${t("fk.prs")}</h3>
          <p class="muted small">${t("fk.prs.desc")}</p>
          <div class="pr-list" data-r="prList"></div>
          <div class="pr-boost small" data-r="prBoost"></div>
        </div>
        <h3>${t("fk.tree")}</h3>
        <label class="switch small" data-r="abuyAuto" hidden><input type="checkbox"><span>${t("fk.abuy")}</span></label>
        <p class="muted small">${t("fk.tree.desc")}</p>
        <div class="tree" data-r="ftree"></div>
        <div class="tree-detail" data-r="ftDetail"></div>
        <h3>${t("fu.title")}</h3>
        <p class="muted small">${t("fu.desc")}</p>
        <div class="fu-list" data-r="fuList"></div>
      </div>
      <div class="card tab-body" data-body="distro">
        <div class="fork-card distro-card">
          <div class="fork-title"><span class="pk-glyph">▣</span> <span>${t("ds.title")}</span></div>
          <div class="muted small" data-r="dsDesc"></div>
          <div class="ds-flavor small" data-r="dsFlavor"></div>
          <button class="fork-btn distro-btn" data-r="dsBtn"></button>
          <div class="fork-calc" data-r="dsCalc"></div>
          <div class="rel-rate small" data-r="dsRate" hidden></div>
        </div>
        <!-- crontab (Market milestone 5 %): set here, next to the distro button, like the Fork bot in the Fork tab -->
        <div class="bot cron" data-r="cron" hidden>
          <label class="switch"><input type="checkbox" data-r="cronOn"><span>${t("mk.cron")}</span></label>
          <label class="small">${t("mk.cron.threshold")} <input type="number" min="0" step="1" data-r="cronThr"> ▣</label>
          <label class="switch small"><input type="checkbox" data-r="cronRot"><span>${t("mk.cron.rotate")}</span></label>
          <div class="muted small">${t("mk.cron.hint")}</div>
        </div>
        <div class="fork-sum" data-r="dsSum"></div>
        <h3>${t("ds.flavors")}</h3>
        <p class="muted small">${t("ds.flavors.desc")}</p>
        <div class="ds-perm" data-r="dsPerm" hidden></div>
        <p class="teaser small" data-r="mkTeaser" hidden>${t("mk.teaser")}</p>
        <div class="fu-list" data-r="dsFlavors"></div>
        <h3>${t("ds.tree")}</h3>
        <p class="muted small">${t("ds.tree.desc")}</p>
        <div class="tree" data-r="dtree"></div>
        <div class="tree-detail" data-r="dtDetail"></div>
      </div>
      <div class="card tab-body" data-body="market">
        <div class="mk-card">
          <div class="mk-title"><span class="mk-glyph">◕</span> <span>${t("mk.title")}</span></div>
          <div class="muted small">${t("mk.desc")}</div>
          <div class="mk-pct" data-r="mkBig"></div>
          <div class="mk-bar"><div class="mk-fill" data-r="mkFill"></div><div class="mk-ticks" data-r="mkTicks"></div></div>
          <div class="small" data-r="mkSlice"></div>
          <div class="small mk-next" data-r="mkNext"></div>
        </div>
        <h3>${t("mk.milestones")}</h3>
        <div class="mk-miles" data-r="mkMiles"></div>
        <div class="mk-crates" data-r="mkCrates">
          <div class="mk-crates-row" data-r="mkCrateRow" hidden>
            <span class="mk-crate-n" data-r="mkCrateN"></span>
            <button class="btn small mk-open" data-r="mkOpen">${t("mk.crate.open")}</button>
            <button class="btn small" data-r="mkOpenAll">${t("mk.crate.openall")}</button>
          </div>
          <div class="mk-shop"><button class="btn small mk-open" data-r="mkBuy"></button><span class="muted small">${t("mk.shop.desc")}</span></div>
          <label class="switch small"><input type="checkbox" data-r="mkAutoOpen"><span>${t("mk.crate.auto")}</span></label>
        </div>
        <h3 data-r="mkLoadedH"></h3>
        <p class="muted small">${t("mk.loaded.desc")}</p>
        <div class="mk-bonus small" data-r="mkBonus"></div>
        <div class="fu-list" data-r="mkLoaded"></div>
        <h3 data-r="mkInvH"></h3>
        <div class="mk-tools">
          <button class="btn small" data-r="mkBest">${t("mk.best")}</button>
          <label class="switch small"><input type="checkbox" data-r="mkAutoRec"><span>${t("mk.autorecycle")}</span></label>
        </div>
        <div class="fu-list" data-r="mkInv"></div>
      </div>
      <div class="card tab-body" data-body="achievements">
        <div class="muted small" data-r="achHead"></div>
        <div data-r="achPendingBox">
          <h3>${t("ach.pending")}</h3>
          <div class="obj-list" data-r="achPending"></div>
        </div>
        <h3>${t("ach.all")}</h3>
        <div class="ach-grid" data-r="ach"></div>
      </div>
      <div class="card tab-body" data-body="stats">
        <table class="stats" data-r="stats"></table>
      </div>
    </section>
  </main>
  <nav class="mnav">
    <button data-m="shop">${NAV_ICONS.shop}<span>${t("nav.shop")}</span></button>
    <button data-m="center">${NAV_ICONS.terminal}<span>${t("nav.terminal")}</span></button>
    <button data-m="side">${NAV_ICONS.progress}<span>${t("nav.progress")}</span><i class="mdot" data-r="mDot" hidden></i></button>
  </nav>
  <footer class="foot"><a href="https://github.com/Antiz96/incrust" target="_blank" rel="noopener noreferrer">${t("fork_of")}</a></footer>
  <div class="toasts" data-r="toasts"></div>
  <button class="ev-pill" data-r="evPill" hidden>
    <span class="ev-pill-t" data-r="evText"></span>
    <span class="ev-pill-h" data-r="evHint"></span>
    <span class="ev-bar"><i data-r="evBar"></i></span>
  </button>
  <div class="modal" data-r="modal" hidden><div class="modal-box" data-r="modalBox"></div></div>`;

  $("[data-r=termHost]").append(term.root);
  if (TOUCH) term.setPlaceholder(t("term.tap"));
  term.root.dataset.log = engine.s.settings.logLevel;
  buildHardware();
  buildPerks();
  buildTree();
  lastAchCount = "";
  lastSlotCount = -1;
  lastTalentKey = "";
  lastOptKey = "";
  lastChKey = "";
  lastObjKey = "";
  bindLayout();
  initColumnHandles();
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
    if (k === "jobs") {
      // `-j`: threshold under which Auto-Scaling saves up for the next slot (not a <button>: the card is one)
      // A native menu over the pill (v0.4.10): presets from 1 s to 5 min, plus any custom value
      const prio = h("span", { class: "prio-btn", "data-f": "prio", hidden: "" },
        h("span", { "data-f": "prioT" }),
        h("select", { class: "prio-sel", "data-f": "prioSel", "aria-label": t("jp.help") }));
      const sel = $<HTMLSelectElement>("select", prio);
      prio.addEventListener("click", ev => ev.stopPropagation());
      sel.addEventListener("change", () => {
        let v = sel.value;
        if (v === "custom") {
          const got = window.prompt(t("jp.custom_q"), engine.s.jobsPrio > 0 ? String(engine.s.jobsPrio) : "");
          if (got === null || parseJobsPrio(got) === null) { sel.dataset.key = ""; return; }
          v = got.trim();
        }
        cmd.run(`autoscale jobs ${v}`, true);
      });
      card.querySelector(".hw-top")!.append(prio);
      card.append(h("div", { class: "job-save", "data-f": "save", hidden: "" },
        h("span", { class: "job-save-t", "data-f": "saveT" }),
        h("span", { class: "job-save-bar" }, h("i", { "data-f": "saveBar" })),
      ));
    }
    if ((GEN_KEYS as HwKey[]).includes(k)) {
      // Not a <button>: the card itself is one
      const genBtn = h("span", { class: "gen-btn", role: "button", tabindex: "0", "data-f": "genBtn", hidden: "" });
      const go = (ev: Event) => { ev.stopPropagation(); cmd.run(`gen ${k}`, true); };
      genBtn.addEventListener("click", go);
      genBtn.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(ev); } });
      // Fork talent `rnv`: per-hardware auto-generation switch
      const genAuto = h("label", { class: "auto-pill", "data-f": "genAuto", hidden: "" }, h("input", { type: "checkbox" }), h("span", {}, t("auto")));
      genAuto.addEventListener("click", ev => ev.stopPropagation());
      genAuto.querySelector("input")!.addEventListener("change", () => cmd.run(`gen auto ${k}`, true));
      card.append(h("div", { class: "hw-gen", "data-f": "gen", hidden: "" },
        h("span", { class: "hw-gen-lbl", "data-f": "genLbl" }),
        genAuto,
        h("span", { class: "hw-gen-next", "data-f": "genNext" }),
        genBtn,
      ));
    }
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

const TREE_COLS = 5;
let treeRows = 0;

/**
 * Sizes the tree to the rows the player can see (owned, buyable or in the fog): hidden rows
 * below would otherwise leave a big empty gap, very visible on phones.
 */
function layoutTree(rows: number) {
  if (rows === treeRows) return;
  treeRows = rows;
  const tree = $("[data-r=tree]");
  tree.style.aspectRatio = `${TREE_COLS} / ${rows}`;
  $(".tree-lines", tree).setAttribute("viewBox", `0 0 ${TREE_COLS * 100} ${rows * 100}`);
  for (const tal of TALENTS) $(`[data-t=${tal.id}]`, tree).style.top = `${(tal.row + 0.5) * (100 / rows)}%`;
}

function buildTree() {
  treeRows = 0;
  const tree = $("[data-r=tree]");
  tree.replaceChildren();
  const rows = Math.max(...TALENTS.map(x => x.row)) + 1;
  const COLS = TREE_COLS;
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
  tree.append(svg);
  for (const tal of TALENTS) {
    const node = h("button", { class: "node", "data-t": tal.id, title: t(`t.${tal.id}`) },
      h("span", { class: "node-icon" }, tal.icon),
      h("span", { class: "node-cost" }, `${tal.cost}★`),
    );
    node.style.left = `${(tal.col + 0.5) * (100 / COLS)}%`;
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
  const tabs = $(".tabs");
  tabs.addEventListener("scroll", updateTabFades, { passive: true });
  window.addEventListener("resize", updateTabFades);
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
  $("[data-r=evPill]").addEventListener("click", () => {
    const cur = engine.activeEvent;
    if (cur) cmd.run(EVENT_BY_ID[cur.id].cmd, true);
  });
  $("[data-r=forkBtn]").addEventListener("click", confirmFork);
  $("[data-r=dsBtn]").addEventListener("click", confirmDistro);
  $<HTMLInputElement>("[data-r=fbotOn]").addEventListener("change", () => cmd.run(`forkbot ${engine.s.autoFork.enabled ? "off" : "on"}`, true));
  $<HTMLInputElement>("[data-r=fbotThr]").addEventListener("change", ev => {
    const v = Math.max(0, Math.floor(Number((ev.target as HTMLInputElement).value) || 0));
    cmd.run(`forkbot ${v === 0 ? "advisor" : v}`, true);
  });
  $("[data-r=chExit]").addEventListener("click", () => cmd.run("challenge exit", true));
  $<HTMLInputElement>("[data-r=cronOn]").addEventListener("change", () => cmd.run(`crontab ${engine.s.market.cron.enabled ? "off" : "on"}`, true));
  $<HTMLInputElement>("[data-r=cronRot]").addEventListener("change", () => cmd.run(`crontab ${engine.s.market.cron.rotate ? "same" : "rotate"}`, true));
  $<HTMLInputElement>("[data-r=cronThr]").addEventListener("change", ev => {
    const v = Math.max(0, Math.floor(Number((ev.target as HTMLInputElement).value) || 0));
    cmd.run(`crontab ${v === 0 ? "advisor" : v}`, true);
  });
  $("[data-r=mkBest]").addEventListener("click", () => cmd.run("modprobe --best", true));
  $("[data-r=mkOpen]").addEventListener("click", () => openCrateRoulette());
  $("[data-r=mkBuy]").addEventListener("click", () => cmd.run("modules buy", true));
  $("[data-r=mkOpenAll]").addEventListener("click", () => cmd.run("modules open all", true));
  $<HTMLInputElement>("[data-r=mkAutoOpen]").addEventListener("change", () => cmd.run("modules autoopen", true));
  $<HTMLInputElement>("[data-r=mkAutoRec]").addEventListener("change", () => cmd.run("modules autorecycle", true));
  $("[data-a=settings]").addEventListener("click", () => openSettings());
  $<HTMLInputElement>("[data-r=botOn]").addEventListener("change", () => cmd.run("toggle release_bot", true));
  $<HTMLInputElement>("[data-r=ansAuto] input").addEventListener("change", () => cmd.run("tree auto", true));
  $<HTMLInputElement>("[data-r=abuyAuto] input").addEventListener("change", () => cmd.run("fork auto", true));
  $<HTMLInputElement>("[data-r=mtxAuto] input").addEventListener("change", () => cmd.run("challenge auto", true));
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
  updateTutorial();
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
    renderGen(card, k);
    if (k === "jobs") renderJobsPrio(card);
  }

  // Perks
  for (const k of PERK_KEYS) {
    const el = $(`[data-perk=${k}]`);
    const p = s.perks[k];
    const st = $("[data-f=state]", el);
    setText(st, !p.unlocked ? "" : p.enabled ? t("perk.enabled") : t("perk.disabled"));
    toggleClass(st, "on", p.enabled);
    const btn = $<HTMLButtonElement>("[data-f=btn]", el);
    const locked = perkLocked(s, k);
    const cost = perkPrice(s, k);
    setText(btn, p.unlocked ? (p.enabled ? "ON" : "OFF") : locked ? "🔒" : `${t("unlock")} · ${fmt(cost)} cr`);
    btn.disabled = locked;
    toggleClass(btn, "afford", !p.unlocked && !locked && s.credits.gte(cost));
    toggleClass(btn, "toggle-on", p.unlocked && p.enabled);
    toggleClass(el, "owned", p.unlocked);
    const desc = k === "auto_scaling"
      ? (p.unlocked ? autoScaleInfo(engine) : locked ? t("perk.auto_scaling.locked") : t("perk.auto_scaling.desc", { i: fmtTime(autoScaleInterval(s)) }))
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
  const revealed = { stars: starsRevealed(s), pre: !starsRevealed(s), challenges: engine.challengesUnlocked, forked: s.forks > 0, fork: s.forks > 0 || treeComplete(s), distro: distroRevealed(s), distroed: s.distros > 0, market: s.market.unlocked };
  app.querySelectorAll<HTMLElement>("[data-reveal]").forEach(el => {
    const show = revealed[el.dataset.reveal as keyof typeof revealed];
    if (el.hidden === show) el.hidden = !show;
  });
  const revKey = JSON.stringify(revealed);
  if (revKey !== lastRevealKey) { lastRevealKey = revKey; updateTabFades(); } // a new tab can overflow the strip
  const chNew = $("[data-r=chNew]");
  const showNew = engine.challengesUnlocked && !s.seen.includes("challenges");
  if (chNew.hidden === showNew) chNew.hidden = !showNew;
  if (sideTab === "challenges" && !engine.challengesUnlocked) sideTab = "release";
  if (sideTab === "fork" && s.forks === 0 && !treeComplete(s)) sideTab = "release";
  if (sideTab === "distro" && !distroRevealed(s)) sideTab = "release";
  if (sideTab === "market" && !s.market.unlocked) sideTab = "release";

  // Side tabs
  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(b => toggleClass(b, "on", b.dataset.tab === sideTab));
  if (sideTab !== lastSideTab) {
    lastSideTab = sideTab;
    // Keep the active tab visible in the scrollable strip (a tip or the tutorial can switch tabs too)
    app.querySelector<HTMLElement>(`[data-tab=${sideTab}]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    updateTabFades();
  }
  app.querySelectorAll<HTMLElement>("[data-body]").forEach(b => toggleClass(b, "on", b.dataset.body === sideTab));
  app.querySelectorAll<HTMLButtonElement>("[data-m]").forEach(b => toggleClass(b, "on", b.dataset.m === mobilePanel));

  renderRelease();
  renderOptimizations();
  if (sideTab === "achievements") renderGoals();
  if (sideTab === "challenges") renderChallenges();
  renderAchievements();
  if (sideTab === "stats") renderStats();
  renderForkCard();
  if (sideTab === "fork") renderForkTab();
  if (sideTab === "distro") renderDistroTab();
  if (sideTab === "market") renderMarketTab();
  { const b = $("[data-r=mkBadge]"); const show = s.market.crates.length > 0; if (b.hidden === show) b.hidden = !show; }
  setText($("[data-r=contrib]"), fmtInt(s.contributors));
  setText($("[data-r=pkg]"), fmtInt(s.packages));
  if (s.market.unlocked) setText($("[data-r=mkPct]"), `${marketShare(s).pct.toFixed(2)} %`);
  const db = $("[data-r=distroBadge]");
  if (db.hidden === !distroAdvice.advised) db.hidden = !distroAdvice.advised;
  const dt = $("[data-r=distroTeaser]");
  const showDt = !distroRevealed(s) && s.forks > 0 && s.forkTalents.length >= 10;
  if (dt.hidden === showDt) dt.hidden = !showDt;
  const fb = $("[data-r=forkBadge]");
  const fbOn = s.prs.length > 0 || (forkAdvice.advised && treeComplete(s) && !s.challenge);
  if (fb.hidden === fbOn) fb.hidden = !fbOn;
  if (fbOn) setText(fb, s.prs.length ? `${s.prs.length}` : "!");
  // Release tab: only the teaser before the first fork; the fork itself lives in the Fork tab
  const ft = $("[data-r=forkTeaser]");
  const showFt = forkRevealed(s) && s.forks === 0 && !treeComplete(s) && !s.challenge;
  if (ft.hidden === showFt) ft.hidden = !showFt;
  renderEvents();
}

/** Floating event to catch, and the boosts running in the Pipeline card. */
function renderEvents() {
  const s = engine.s;
  const pill = $<HTMLButtonElement>("[data-r=evPill]");
  const cur = engine.activeEvent;
  if (pill.hidden === !!cur) pill.hidden = !cur;
  if (cur) {
    const ev = EVENT_BY_ID[cur.id];
    setText($("[data-r=evText]"), `${ev.icon} ${t(`ev.${ev.id}`)} · ${eventBonusText(ev.id)}`);
    setText($("[data-r=evHint]"), t("ev.hint", { c: ev.cmd }));
    const total = has(s, "pager") ? PAGER_WINDOW : EVENT_WINDOW;
    $("[data-r=evBar]").style.width = `${Math.max(0, Math.min(100, (cur.left / total) * 100))}%`;
  }
  const box = $("[data-r=buffs]");
  const show = s.buffs.length > 0;
  if (box.hidden === show) box.hidden = !show;
  if (show) {
    const key = s.buffs.map(b => `${b.id}:${Math.ceil(b.left)}`).join("|");
    if (box.dataset.k !== key) {
      box.dataset.k = key;
      box.replaceChildren(...s.buffs.map(b => {
        const ev = EVENT_BY_ID[b.id];
        return h("span", { class: "buff" }, `${ev.icon} ${eventBonusText(ev.id).split(" · ")[0]} · ${Math.ceil(b.left)} s`);
      }));
    }
  }
  const rc = $("[data-r=relRc]");
  const showRc = s.rcPending && !s.challenge;
  if (rc.hidden === showRc) rc.hidden = !showRc;
  if (showRc) setText(rc, t("ev.rc_pending", { p: RC_STARS_PCT }));
}

/** Jobs card: priority threshold button (with `-j`) and the "saving up for job N" bar. */
function renderJobsPrio(card: HTMLElement) {
  const s = engine.s;
  const prio = $("[data-f=prio]", card);
  const owns = on(s, "as_jobs");
  if (prio.hidden === owns) prio.hidden = !owns;
  if (owns) {
    setText($("[data-f=prioT]", prio), t("jp.btn", { v: jobsPrioText(s.jobsPrio) }));
    prio.title = t("jp.help");
    const sel = $<HTMLSelectElement>("[data-f=prioSel]", prio);
    const key = `${s.jobsPrio}|${s.settings.lang}`;
    if (sel.dataset.key !== key) {
      sel.dataset.key = key;
      const steps = JOBS_PRIO_STEPS.includes(s.jobsPrio) ? JOBS_PRIO_STEPS : [...JOBS_PRIO_STEPS.slice(0, -1), s.jobsPrio, -1].sort((a, b) => (a < 0 ? 1 : b < 0 ? -1 : a - b));
      const val = (v: number) => (v === 0 ? "off" : v < 0 ? "always" : String(v));
      sel.replaceChildren(...steps.map(v => h("option", { value: val(v) }, jobsPrioText(v))), h("option", { value: "custom" }, t("jp.custom")));
      sel.value = val(s.jobsPrio);
    }
  }
  const sv = engine.jobSaving();
  const row = $("[data-f=save]", card);
  if (row.hidden === !!sv) row.hidden = !sv;
  if (sv) {
    setText($("[data-f=saveT]", card), t("jp.saving", { n: sv.next, p: Math.floor(sv.progress * 100) }));
    $("[data-f=saveBar]", card).style.width = `${sv.progress * 100}%`;
  }
}

/** Generation row of a hardware card: current generation, then the next requirement or the button. */
function renderGen(card: HTMLElement, k: HwKey) {
  const row = card.querySelector<HTMLElement>("[data-f=gen]");
  if (!row) return;
  const s = engine.s;
  const show = gensRevealed(s);
  if (row.hidden === show) row.hidden = !show;
  if (!show) return;
  const g = k as GenKey;
  const state = engine.canGenerate(g);
  setText($("[data-f=genLbl]", row), t("gen.label", { n: s.gens[g] }));
  const genAuto = $("[data-f=genAuto]", row);
  const showAuto = hasFork(s, "f_renovate");
  if (genAuto.hidden === showAuto) genAuto.hidden = !showAuto;
  if (showAuto) { const box = $<HTMLInputElement>("input", genAuto); if (box.checked !== s.autogen[g]) box.checked = s.autogen[g]; }
  const next = $("[data-f=genNext]", row);
  setText(next, state === "locked" ? "🔒" : t("gen.next", { l: genRequired(s, g) }));
  const btn = $("[data-f=genBtn]", row);
  const ready = state === "ok";
  if (btn.hidden === ready) btn.hidden = !ready;
  toggleClass(card, "gen-ready", ready);
  toggleClass(next, "ready", ready);
  // Ready: the requirement gives way to the bonus of the next generation
  if (ready) {
    setText(next, genBonusText(g));
    setText(btn, t("gen.btn", { n: s.gens[g] + 1 }));
  }
  row.title = s.gens[g] > 0 ? t("gen.now", { b: genBonusText(g, s.gens[g]) }) : t("gen.desc");
}

function hwEffect(k: HwKey): string {
  const s = engine.s;
  switch (k) {
    case "cpu": return `${fmtTime(buildTime(s))} / build`;
    case "ram": return `${fmt(reward(s))} cr / build`;
    case "disk": {
      const cache = diskCacheMult(s);
      return `${(failProbability(s) * 100).toFixed(1)}% fail` + (cache > 1.0005 ? ` · ${t("hw.disk.cache", { x: cache.toFixed(2) })}` : "");
    }
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

function fmtRate(r: number): string {
  if (!Number.isFinite(r)) return "∞";
  return r >= 100 ? fmt(new Decimal(r)) : r >= 10 ? r.toFixed(0) : r.toFixed(r >= 1 ? 1 : 2);
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
  const advised = advice.advised && starsRevealed(s);
  toggleClass(btn, "advised", advised);
  const relBadge = $("[data-r=relBadge]");
  if (relBadge.hidden === advised) relBadge.hidden = !advised;

  // Stars per minute, once stars are known
  const rateEl = $("[data-r=relRate]");
  const showRate = starsRevealed(s) && can && !s.challenge;
  if (rateEl.hidden === showRate) rateEl.hidden = !showRate;
  if (showRate) {
    // Only the current pace: the button, the badge and the highlight already say when to ship
    setText(rateEl, t("adv.rate", { r: fmtRate(advice.rate) }));
    toggleClass(rateEl, "on", advised);
  }

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
  // Fork talent `ans` (Ansible): switch for the automatic purchase of talents and optimizations
  const ans = $("[data-r=ansAuto]");
  const showAns = hasFork(s, "f_ansible");
  if (ans.hidden === showAns) ans.hidden = !showAns;
  if (showAns) { const box = $<HTMLInputElement>("input", ans); if (box.checked !== s.autoStars) box.checked = s.autoStars; }
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
  layoutTree(Math.max(...TALENTS.filter(x => vis[x.id] !== "hidden").map(x => x.row)) + 1);
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
  $("[data-r=tree]").querySelectorAll<SVGLineElement>(".tree-lines line").forEach(l => { // release tree only: the Fork tree has its own lines
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
function claimButton(label: string, command: string) {
  const b = h("button", { class: "claim-btn" }, label);
  b.addEventListener("click", () => cmd.run(command, true));
  return b;
}

let goalsTimer = 0;
/** Achievements tab: rewards to claim, then the next tier of each chain with its progress. */
function renderGoals(force = false) {
  const s = engine.s;
  const pending = engine.pendingAchievements();
  const key = `${s.achievements.length}|${s.achClaimed.length}|${starsRevealed(s)}|${engine.challengesUnlocked}|${s.settings.lang}`;
  const now = performance.now();
  if (!force && key === lastObjKey && now - goalsTimer < 1000) return;
  lastObjKey = key;
  goalsTimer = now;
  const box = $("[data-r=achPendingBox]");
  if (box.hidden === pending.length > 0) box.hidden = pending.length === 0;
  const claimRows = pending.map(a => h("div", { class: "obj ready" },
    h("span", { class: "obj-mark" }, "[!]"),
    h("span", { class: "obj-name", title: achDesc(a) }, t(`a.${a.id}`)),
    claimButton(`${t("obj.claim")} ${rewardText(a.reward)}`, `claim ${a.id}`)));
  if (pending.length > 1) claimRows.push(h("div", { class: "obj-count" }, claimButton(`${t("obj.claim_all")} (${pending.length})`, "claim all")));
  $("[data-r=achPending]").replaceChildren(...claimRows);
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
  // Distro talent `mtx` (Test matrix): switch for the challenges started on their own
  const mtx = $("[data-r=mtxAuto]");
  const showMtx = hasDistro(s, "d_matrix");
  if (mtx.hidden === showMtx) mtx.hidden = !showMtx;
  if (showMtx) { const box = $<HTMLInputElement>("input", mtx); if (box.checked !== s.autoChal) box.checked = s.autoChal; }
  // What the matrix is doing (v0.6.3): done count, current or next challenge, given up, manual ones
  const st = $("[data-r=mtxState]");
  const showSt = showMtx && engine.challengesUnlocked;
  if (st.hidden === showSt) st.hidden = !showSt;
  if (showSt) {
    const m = engine.matrixState;
    const parts = [t("ch.mtx.done", { n: s.challengesDone.length, m: CHALLENGES.length })];
    if (!s.autoChal) parts.push(t("ch.mtx.off"));
    else if (m.running) parts.push(t("ch.mtx.running", { c: challengeName(m.running) }));
    else if (m.next) parts.push(t("ch.mtx.next", { c: challengeName(m.next) }));
    else if (s.challengesDone.length >= CHALLENGES.length) parts.push(t("ch.mtx.alldone"));
    if (m.tried.length) parts.push(t("ch.mtx.tried", { c: m.tried.map(challengeName).join(", ") }));
    if (m.running === MATRIX_HANDS) parts.push(t("ch.mtx.hands"));
    setText(st, parts.join(" · "));
  }
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

function renderAchievements() {
  const s = engine.s;
  const n = s.achievements.length;
  const pendingCount = engine.pendingAchievements().length;
  setText($("[data-r=achBadge]"), pendingCount ? `${pendingCount}!` : `${n}/${ACHIEVEMENTS.length}`);
  toggleClass($("[data-r=achBadge]"), "new", pendingCount > 0);
  const dot = $("[data-r=mDot]");
  const dotOn = pendingCount > 0 || (advice.advised && starsRevealed(s));
  if (dot.hidden === dotOn) dot.hidden = !dotOn;
  const achKey = `${n}|${s.achClaimed.length}|${starsRevealed(s)}|${engine.challengesUnlocked}|${s.settings.lang}`;
  if (achKey === lastAchCount) {
    if (sideTab === "achievements") updateAchBars();
    return;
  }
  lastAchCount = achKey;
  const bonus = bonusSummary(engine);
  setText($("[data-r=achHead]"), t("ach.count", { n, total: ACHIEVEMENTS.length }) + (bonus ? ` · ${bonus}` : ""));
  // Order: in progress (closest first), then ready to claim, claimed, and secrets last
  const rank = (a: Achievement) => {
    const got = s.achievements.includes(a.id);
    if (got && !s.achClaimed.includes(a.id)) return 1;
    if (got) return 2;
    return achVisible(engine, a) ? 0 : 3;
  };
  const list = [...ACHIEVEMENTS].sort((x, y) => rank(x) - rank(y) || (rank(x) === 0 ? achProgress(s, y) - achProgress(s, x) : 0));
  $("[data-r=ach]").replaceChildren(...list.map(a => {
    const got = s.achievements.includes(a.id);
    const claimed = s.achClaimed.includes(a.id);
    const hidden = !got && !achVisible(engine, a);
    const foot = hidden ? h("div", { class: "ach-reward" }, "")
      : got && !claimed ? claimButton(`${t("obj.claim")} ${rewardText(a.reward)}`, `claim ${a.id}`)
      : h("div", { class: "ach-reward" }, rewardText(a.reward));
    // Progress bar on achievements still to get (not for one-shot ones)
    const bar = !got && !hidden && a.target !== undefined && a.target > 1
      ? h("div", { class: "ach-prog", "data-prog": a.id },
          h("div", { class: "progress" }, h("div", { class: "fill" })),
          h("span", { class: "ach-val" }))
      : null;
    return h("div", { class: "ach" + (claimed ? " got" : got ? " ready" : ""), title: hidden ? t("ach.secret") : t(`a.${a.id}.desc`) },
      // Text tags, like the release tree and the "To claim" list (no emojis: Arthur's call)
      h("div", { class: "ach-icon" }, hidden ? "[?]" : claimed ? "[✓]" : got ? "[!]" : "[ ]"),
      h("div", { class: "ach-name" }, hidden ? "???" : t(`a.${a.id}`)),
      h("div", { class: "ach-desc" }, hidden ? t("ach.secret") : achDesc(a)),
      ...(bar ? [bar] : []),
      foot,
    );
  }));
  achBarsTimer = 0;
  updateAchBars();
}

let achBarsTimer = 0;
/** Refreshes the progress bars of the achievements tab (about once a second). */
function updateAchBars() {
  const now = performance.now();
  if (now - achBarsTimer < 1000) return;
  achBarsTimer = now;
  const s = engine.s;
  for (const el of app.querySelectorAll<HTMLElement>("[data-prog]")) {
    const a = ACH_BY_ID[el.dataset.prog!];
    ($(".fill", el) as HTMLElement).style.width = `${Math.round(achProgress(s, a) * 100)}%`;
    setText($(".ach-val", el), progressText(engine, a));
  }
}

/** Fork tab: the fork button once the release tree is complete (like the Distro card in the Distro tab). */
function renderForkCard() {
  const s = engine.s;
  const card = $("[data-r=forkCard]");
  const show = (s.forks > 0 || treeComplete(s)) && !s.challenge;
  if (card.hidden === show) card.hidden = !show;
  if (!show) return;
  const done = treeComplete(s);
  const pending = contributorsOnFork(s).toNumber();
  const btn = $<HTMLButtonElement>("[data-r=forkBtn]");
  const rate = $("[data-r=forkRate]");
  if (!done) {
    // Teaser: no detail before the tree is done (like "Ship v1.0.0 → ???")
    setText($("[data-r=forkTitle]"), s.forks ? t("fk.title") : t("fk.teaser"));
    setText($("[data-r=forkDesc]"), t("fk.need_tree"));
    if (!btn.hidden) btn.hidden = true;
    if (!rate.hidden) rate.hidden = true;
    if (!$("[data-r=forkCalc]").hidden) $("[data-r=forkCalc]").hidden = true;
    return;
  }
  // How the contributors are computed, and what one more needs
  const calc = $("[data-r=forkCalc]");
  if (calc.hidden) calc.hidden = false;
  const b = contributorBreakdown(s);
  // A small table, one line per factor (v0.4.8: the one-line version was "ugly and hard to follow")
  const x = (m: number) => `×${m.toFixed(2)}`;
  const rows: [string, string, string?][] = [
    [t("fk.calc.stars", { s: fmt(b.stars) }), b.base.toFixed(1)],
    [t("fk.calc.gens", { n: b.gens }), x(b.multGens), b.gens ? "" : "dim"],
    [t("fk.calc.chal", { n: b.chal }), x(b.multChal), b.chal ? "" : "dim"],
    ...(b.multSig > 1 ? [[t("fk.calc.sig"), x(b.multSig)] as [string, string]] : []),
    ...(b.multDistro !== 1 ? [[t("fk.calc.distro"), x(b.multDistro)] as [string, string]] : []),
    ...(b.ups ? [[t("fk.calc.ups"), `+${b.ups}`] as [string, string]] : []),
    [t("fk.calc.total", { e: b.exact.toFixed(2) }), `${fmtInt(b.total)} ⑂`, "total"],
    [t("fk.calc.next", { s: fmt(b.nextAt) }), t("fk.calc.more", { s: fmt(b.nextAt.sub(b.stars).max(0)) }), "next"],
  ];
  const key = rows.map(r => r.join("|")).join("/");
  if (calc.dataset.key !== key) {
    calc.dataset.key = key;
    calc.replaceChildren(h("div", { class: "fc-title" }, t("fk.calc.title")),
      ...rows.map(([l, v, c]) => h("div", { class: "fc-row" + (c ? ` ${c}` : "") }, h("span", {}, l), h("span", { class: "fc-v" }, v))));
  }
  setText($("[data-r=forkTitle]"), t("fk.title"));
  setText($("[data-r=forkDesc]"), pending >= 1 ? t("fk.desc") : t("fk.need_stars", { n: fmtInt(starsForFirstContributor()), c: fmt(s.lifetimeStars) }));
  if (btn.hidden) btn.hidden = false;
  setText(btn, pending >= 1 ? t("fk.btn", { n: fmtInt(pending) }) : t("fk.btn0"));
  btn.disabled = pending < 1;
  toggleClass(btn, "advised", forkAdvice.advised);
  const showRate = pending >= 1;
  if (rate.hidden === showRate) rate.hidden = !showRate;
  if (showRate) setText(rate, t("fk.rate", { r: forkAdvice.rate.toFixed(forkAdvice.rate < 10 ? 1 : 0) }));
  toggleClass(rate, "on", forkAdvice.advised);
}

let forkTabKey = "";
/** Fork tab: summary, open pull requests, Fork talents. */
function renderForkTab() {
  const s = engine.s;
  // Distro talent `abuy`: switch for the contributors' automatic purchases (so ⑂ never vanish unexplained)
  const abuy = $("[data-r=abuyAuto]");
  const showAbuy = hasDistro(s, "d_autobuy");
  if (abuy.hidden === showAbuy) abuy.hidden = !showAbuy;
  if (showAbuy) { const box = $<HTMLInputElement>("input", abuy); if (box.checked !== s.autoContrib) box.checked = s.autoContrib; }
  // Fork bot settings (Distro talent fbot), shown in the Fork tab next to the fork button
  const fbot = $("[data-r=fbot]");
  const showBot = hasDistro(s, "d_forkbot");
  if (fbot.hidden === showBot) fbot.hidden = !showBot;
  if (showBot) {
    const on = $<HTMLInputElement>("[data-r=fbotOn]");
    if (on.checked !== s.autoFork.enabled) on.checked = s.autoFork.enabled;
    const thr = $<HTMLInputElement>("[data-r=fbotThr]");
    if (document.activeElement !== thr && thr.value !== String(s.autoFork.threshold)) thr.value = String(s.autoFork.threshold);
  }
  setText($("[data-r=forkSum]"), t("fk.sum", {
    c: fmtInt(s.contributors), l: fmtInt(s.lifetimeContributors), f: fmtInt(s.forks),
    g: `×${contribGainsMult(s).toFixed(2)}`,
  }));
  const b = s.prBoost;
  setText($("[data-r=prBoost]"), b.speed > 1 || b.gains > 1 || b.stars > 1
    ? t("fk.boost", { sp: b.speed.toFixed(2), g: b.gains.toFixed(2), st: b.stars.toFixed(2) }) : "");
  const key = `${s.prs.map(p => p.n).join(",")}|${s.forkTalents.join(",")}|${JSON.stringify(s.forkUpgrades)}|${s.contributors}|${selectedFork}|${s.settings.lang}`;
  if (key === forkTabKey) return;
  forkTabKey = key;
  $("[data-r=prList]").replaceChildren(...(s.prs.length ? s.prs.map(pr => {
    const merge = h("button", { class: "claim-btn" }, t("fk.merge"));
    merge.addEventListener("click", () => cmd.run(`gh pr merge ${pr.n}`, true));
    return h("div", { class: "pr" },
      h("span", { class: "pr-n" }, `#${pr.n}`),
      h("span", { class: "pr-t" }, t(`pr.${pr.kind}.${pr.title}`)),
      h("span", { class: "pr-fx" }, prEffectText(pr.kind)),
      merge);
  }) : [h("p", { class: "muted small" }, t("fk.no_pr"))]));
  renderForkTree();
  $("[data-r=fuList]").replaceChildren(...FORK_UPGRADES.map(u => {
    const lvl = forkUpgradeLevel(s, u.id);
    const cost = forkUpgradePrice(s, u.id);
    const btn = h("button", { class: "claim-btn" }, `${t("fk.buy")} · ${cost} ⑂`) as HTMLButtonElement;
    btn.disabled = s.contributors < cost;
    btn.addEventListener("click", () => cmd.run(`fork upgrade ${u.id}`, true));
    return h("div", { class: "fu" },
      h("div", { class: "fu-top" }, h("span", { class: "ft-name" }, t(`fu.${u.id}`)), h("span", { class: "fu-lvl" }, t("fu.level", { n: lvl }))),
      h("div", { class: "ft-desc" }, t(`fu.${u.id}.desc`, { now: Math.round(lvl * u.pct * 100) })),
      btn);
  }));
}

/* Fork tree: drawn like the release tree (same nodes and lines), all talents visible. */
let forkTreeBuilt = false;
let selectedFork = "f_template";
let forkTreeRows = 0;
/** Sizes the Fork tree to its visible rows, like layoutTree() for the release tree. */
function layoutForkTree(rows: number) {
  if (rows === forkTreeRows) return;
  forkTreeRows = rows;
  const tree = $("[data-r=ftree]");
  tree.style.aspectRatio = `${TREE_COLS} / ${rows}`;
  $(".tree-lines", tree).setAttribute("viewBox", `0 0 ${TREE_COLS * 100} ${rows * 100}`);
  for (const ft of FORK_TALENTS) $(`[data-ft=${ft.id}]`, tree).style.top = `${(ft.row + 0.5) * (100 / rows)}%`;
}
function buildForkTree() {
  const tree = $("[data-r=ftree]");
  tree.replaceChildren();
  forkTreeRows = 0;
  const rows = Math.max(...FORK_TALENTS.map(x => x.row)) + 1;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${TREE_COLS * 100} ${rows * 100}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("tree-lines");
  for (const ft of FORK_TALENTS) {
    for (const r of ft.req) {
      const p = FORK_TALENT_BY_ID[r];
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(p.col * 100 + 50));
      line.setAttribute("y1", String(p.row * 100 + 50));
      line.setAttribute("x2", String(ft.col * 100 + 50));
      line.setAttribute("y2", String(ft.row * 100 + 50));
      line.dataset.to = ft.id;
      line.dataset.from = r;
      svg.append(line);
    }
  }
  tree.append(svg);
  for (const ft of FORK_TALENTS) {
    const node = h("button", { class: "node fnode", "data-ft": ft.id, title: t(`ft.${ft.id}`) },
      h("span", { class: "node-icon" }, ft.tag),
      h("span", { class: "node-cost" }, `${ft.cost}⑂`),
    );
    node.style.left = `${(ft.col + 0.5) * (100 / TREE_COLS)}%`;
    node.addEventListener("click", () => { selectedFork = ft.id; forkTabKey = ""; render(); });
    node.addEventListener("dblclick", () => cmd.run(`fork buy ${ft.tag}`, true));
    tree.append(node);
  }
  forkTreeBuilt = true;
}

function renderForkTree() {
  if (!forkTreeBuilt || !$("[data-r=ftree]").firstChild) buildForkTree(); // the layout is rebuilt on language change
  const s = engine.s;
  const tree = $("[data-r=ftree]");
  const vis = Object.fromEntries(FORK_TALENTS.map(x => [x.id, forkTalentVisibility(s, x.id)]));
  if (vis[selectedFork] === "hidden") selectedFork = "f_template";
  layoutForkTree(Math.max(...FORK_TALENTS.filter(x => vis[x.id] !== "hidden").map(x => x.row)) + 1);
  for (const ft of FORK_TALENTS) {
    const node = $(`[data-ft=${ft.id}]`, tree);
    toggleClass(node, "hidden", vis[ft.id] === "hidden");
    toggleClass(node, "fog", vis[ft.id] === "fog");
    setText($(".node-icon", node), vis[ft.id] === "fog" ? "???" : ft.tag);
    node.title = vis[ft.id] === "shown" ? t(`ft.${ft.id}`) : "???";
    const owned = hasFork(s, ft.id);
    const reqOk = ft.req.every(r => hasFork(s, r));
    toggleClass(node, "owned", owned);
    toggleClass(node, "avail", !owned && reqOk);
    toggleClass(node, "afford", !owned && reqOk && s.contributors >= ft.cost);
    toggleClass(node, "locked", !owned && !reqOk && vis[ft.id] === "shown");
    toggleClass(node, "sel", ft.id === selectedFork);
  }
  tree.querySelectorAll<SVGLineElement>("line").forEach(l => {
    l.classList.toggle("lit", hasFork(s, l.dataset.from!) && hasFork(s, l.dataset.to!));
    l.classList.toggle("hidden", vis[l.dataset.from!] !== "shown" || vis[l.dataset.to!] === "hidden");
  });
  const ft = FORK_TALENT_BY_ID[selectedFork];
  if (vis[ft.id] === "fog") {
    $("[data-r=ftDetail]").replaceChildren(h("div", {}, h("span", { class: "ft-tag" }, "[???]"), ` ${t("tree.fog")}`));
    return;
  }
  const owned = hasFork(s, ft.id);
  const reqOk = ft.req.every(r => hasFork(s, r));
  const btn = h("button", { class: "claim-btn" }, owned ? t("fk.owned") : `${t("fk.buy")} · ${ft.cost} ⑂`) as HTMLButtonElement;
  btn.disabled = owned || !reqOk || s.contributors < ft.cost;
  btn.addEventListener("click", () => cmd.run(`fork buy ${ft.tag}`, true));
  $("[data-r=ftDetail]").replaceChildren(
    h("div", {}, h("span", { class: "ft-tag" }, `[${ft.tag}]`), h("strong", {}, t(`ft.${ft.id}`))),
    h("div", {}, t(`ft.${ft.id}.desc`)),
    NEXT_FORK_TALENTS.includes(ft.id) ? h("div", { class: "td-next small" }, t("tree.next.fork")) : "",
    ft.req.length ? h("div", { class: "muted small" }, t("fk.req", { r: ft.req.map(r => FORK_TALENT_BY_ID[r].tag).join(" + ") })) : "",
    btn,
  );
}

/** Side tabs (v0.6.1): one scrollable row; fade the edges that hide more tabs. */
let lastSideTab = "";
let lastRevealKey = "";
function updateTabFades() {
  const el = app.querySelector<HTMLElement>(".tabs");
  if (!el) return;
  toggleClass(el, "fade-l", el.scrollLeft > 2);
  toggleClass(el, "fade-r", el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
}

/* ================= Market (v0.6, chapter 1) ================= */
let marketTabKey = "";
let lastInstalls = 0; // installs of the last distro, for the "≈ N distros" estimate

/** "+12.5 % installs" / "+20 pts offline" */
function effectText(k: EffectKey, v: number): string {
  return t(`mk.fx.${k}`, { v: k === "offline" ? `+${Math.round(v * 100)}` : `+${(v * 100).toFixed(1)} %` });
}

function moduleCard(s: GameState, m: KModule, loaded: boolean): HTMLElement {
  const btns: HTMLElement[] = [];
  const btn = (label: string, line: string, disabled = false, title = "") => {
    const b = h("button", { class: "btn small" + (disabled ? " off" : ""), ...(title ? { title } : {}) }, label) as HTMLButtonElement;
    b.disabled = disabled;
    b.addEventListener("click", () => cmd.run(line, true));
    btns.push(b);
  };
  if (loaded) btn(t("mk.unload"), `rmmod ${m.uid}`);
  else {
    const full = s.market.loaded.length >= moduleSlots(s);
    btn(t("mk.load"), `modprobe ${m.uid}`, full, full ? t("mk.full") : "");
    btn(t("mk.recycle", { n: recycleValue(m) }), `modules recycle ${m.uid}`);
  }
  btn(t("mk.recompile", { n: recompileCost(m) }), `modules recompile ${m.uid}`, s.packages < recompileCost(m), t("mk.recompile.hint"));
  if (reached(s, "fuse")) {
    const dup = s.market.modules.filter(x => !s.market.loaded.includes(x.uid) && canFuse(s, m, x) && moduleScore(x) <= moduleScore(m))
      .sort((a, b) => moduleScore(a) - moduleScore(b))[0];
    if (dup) btn(t("mk.fuse", { n: dup.name }), `modules fuse ${m.uid} ${dup.uid}`);
  }
  return h("div", { class: `fu mod r${m.rarity}` + (loaded ? " on" : "") },
    h("div", { class: "fu-top" },
      h("span", { class: "ft-name" }, m.name),
      h("span", { class: "mod-tags" }, h("span", { class: "mod-rar" }, `[${t(`mk.r.${RARITIES[m.rarity]}`)}]`),
        m.level > 1 ? h("span", { class: "mod-lvl" }, ` L${m.level}`) : "", h("span", { class: "muted" }, ` #${m.uid}`))),
    h("div", { class: "mod-fx small" }, m.effects.map(e => effectText(e.k, e.v * levelMult(m))).join(" · ")),
    h("div", { class: "mod-btns" }, ...btns));
}

/* ---- Crates and loot roulette (v0.6.4) ---- */
let rouletteOpen = false;
function randomRarity(): number {
  let r = Math.random();
  for (let i = 3; i >= 1; i--) { if (r < RARITY_CHANCE[i]) return i; r -= RARITY_CHANCE[i]; }
  return 0;
}
const rItem = (name: string, rarity: number) => ({ name, rarity, tag: t(`mk.r.${RARITIES[rarity]}`) });

/** Opens the next crate with the CS-style roulette. The module is already rolled: the roulette only shows it. */
function openCrateRoulette() {
  const s = engine.s;
  const mod = s.market.crates[0];
  if (!mod || rouletteOpen) return;
  rouletteOpen = true;
  let closeRl = () => {};
  closeRl = openRoulette({
    title: t("mk.crate.title", { n: s.market.crates.length }),
    winner: rItem(mod.name, mod.rarity),
    filler: () => rItem(MODULE_NAMES[Math.floor(Math.random() * MODULE_NAMES.length)], randomRarity()),
    skipLabel: t("mk.crate.skip"),
    soundLabel: on => t(on ? "mk.crate.sound.on" : "mk.crate.sound.off"),
    onStop: () => {
      engine.openCrate(mod.uid);
      const where = engine.s.market.loaded.includes(mod.uid) ? t("mk.crate.loaded")
        : engine.s.market.modules.some(m => m.uid === mod.uid) ? t("mk.crate.inv") : t("mk.crate.recycled", { n: recycleValue(mod) });
      return h("div", { class: `rl-won r${mod.rarity}` },
        h("div", { class: "rl-won-h" }, `${mod.name} `, h("span", { class: "mod-rar" }, `[${t(`mk.r.${RARITIES[mod.rarity]}`)}]`)),
        h("div", { class: "mod-fx" }, mod.effects.map(e => effectText(e.k, e.v)).join(" · ")),
        h("div", { class: "muted small" }, where));
    },
    actions: () => {
      const out: HTMLElement[] = [];
      const left = engine.s.market.crates.length;
      if (left > 0) {
        const next = h("button", { class: "btn mk-open" }, t("mk.crate.next", { n: left }));
        next.addEventListener("click", () => { closeRl(); openCrateRoulette(); });
        out.push(next);
      }
      const done = h("button", { class: "btn" }, t("close"));
      done.addEventListener("click", () => closeRl());
      out.push(done);
      return out;
    },
    onClose: () => { rouletteOpen = false; marketTabKey = ""; },
  });
}

function renderMarketTab() {
  const s = engine.s;
  const nCrates = s.market.crates.length;
  const row = $("[data-r=mkCrateRow]");
  if (row.hidden === nCrates > 0) row.hidden = nCrates === 0;
  setText($("[data-r=mkCrateN]"), t("mk.crate.n", { n: nCrates }));
  const buy = $<HTMLButtonElement>("[data-r=mkBuy]");
  const price = cratePrice(s);
  setText(buy, t("mk.shop.buy", { n: fmtInt(price) }));
  const canBuy = s.packages >= price;
  if (buy.disabled === canBuy) { buy.disabled = !canBuy; toggleClass(buy, "off", !canBuy); }
  const ao = $<HTMLInputElement>("[data-r=mkAutoOpen]");
  if (ao.checked !== s.market.autoOpen) ao.checked = s.market.autoOpen;
  const sh = marketShare(s);
  setText($("[data-r=mkBig]"), `${sh.pct.toFixed(2)} %`);
  $("[data-r=mkFill]").style.width = `${sh.pct}%`;
  setText($("[data-r=mkSlice]"), sh.slice >= 10 ? t("mk.full100")
    : t("mk.slice", { i: sh.slice + 1, a: fmtInt(Math.floor(sh.inSlice)), b: fmtInt(Math.ceil(sh.sliceCost)), n: fmtInt(Math.floor(s.market.installs)) }));
  const next = nextMilestone(s);
  let nextText = "";
  if (next) {
    // Installs still needed to reach the next milestone
    let need = 0, left = next.pct;
    for (let i = 0; i < 10 && left > 0; i++) { const part = Math.min(10, left); need += sliceCost(i) * part / 10; left -= part; }
    const rest = Math.max(0, need - s.market.installs);
    const est = lastInstalls > 0 ? t("mk.est", { n: fmtInt(Math.ceil(rest / lastInstalls)) }) : "";
    nextText = t("mk.next", { p: next.pct, m: t(`mk.m.${next.id}`), n: fmtInt(Math.ceil(rest)), e: est });
  }
  setText($("[data-r=mkNext]"), nextText);
  const bonus = EFFECT_KEYS.map(k => [k, moduleBonus(s, k)] as const).filter(([, v]) => v > 0);
  setText($("[data-r=mkBonus]"), bonus.length ? t("mk.bonus", { b: bonus.map(([k, v]) => effectText(k, v)).join(" · ") }) : "");
  const box = $<HTMLInputElement>("[data-r=mkAutoRec]");
  if (box.checked !== s.market.autoRecycle) box.checked = s.market.autoRecycle;
  const key = `${Math.floor(sh.pct)}|${JSON.stringify(s.market.modules.map(m => [m.uid, m.level, m.effects]))}|${s.market.loaded.join(",")}|${s.settings.lang}|${Math.floor(s.packages)}`;
  if (key === marketTabKey) return;
  marketTabKey = key;
  $("[data-r=mkTicks]").replaceChildren(...MILESTONES.filter(m => m.pct > 0 && m.pct < 100).map(m =>
    h("i", { class: reached(s, m.id) ? "on" : "", style: `left:${m.pct}%` })));
  // Milestones: the reached ones, the next one, the rest in the fog
  const rows: HTMLElement[] = [];
  let fog = 0;
  for (const m of MILESTONES) {
    const got = reached(s, m.id);
    if (got || m === next) {
      rows.push(h("div", { class: "mk-mile" + (got ? " on" : "") },
        h("span", { class: "mk-mile-tag" }, `${got ? "[✓]" : "[ ]"} ${m.pct} %`),
        h("span", {}, h("strong", {}, t(`mk.m.${m.id}`)), ` · ${t(`mk.m.${m.id}.desc`)}`, m.ready ? "" : h("span", { class: "muted" }, ` (${t("mk.soon")})`))));
    } else fog++;
  }
  if (fog) rows.push(h("div", { class: "mk-mile fog muted" }, h("span", { class: "mk-mile-tag" }, "[?] ???"), t("mk.fog", { n: fog })));
  $("[data-r=mkMiles]").replaceChildren(...rows);
  const loaded = loadedModules(s);
  setText($("[data-r=mkLoadedH]"), t("mk.loaded", { n: loaded.length, m: moduleSlots(s) }));
  $("[data-r=mkLoaded]").replaceChildren(...(loaded.length ? loaded.map(m => moduleCard(s, m, true)) : [h("p", { class: "muted small" }, t("mk.none"))]));
  const inv = s.market.modules.filter(m => !s.market.loaded.includes(m.uid)).sort((a, b) => moduleScore(b) - moduleScore(a));
  setText($("[data-r=mkInvH]"), t("mk.inv", { n: s.market.modules.length, m: MARKET.inventory }));
  $("[data-r=mkInv]").replaceChildren(...(inv.length ? inv.map(m => moduleCard(s, m, false)) : [h("p", { class: "muted small" }, t("mk.inv.empty"))]));
}

/** "builds ×1.2 until the release" … */
function prEffectText(kind: keyof typeof PR_EFFECTS): string {
  const fx = PR_EFFECTS[kind];
  return kind === "docs" ? t("pr.fx.docs", { m: fx.seconds! / 60 }) : t(`pr.fx.${kind}`, { x: fx.mult! });
}

function confirmFork() {
  const s = engine.s;
  const n = contributorsOnFork(s).toNumber();
  const go = h("button", { class: "fork-btn" }, t("fk.btn", { n: fmtInt(n) }));
  go.addEventListener("click", () => { closeModal(); cmd.run("fork --yes", true); });
  const cancel = h("button", { class: "claim-btn" }, t("fk.cancel"));
  cancel.addEventListener("click", closeModal);
  openModal(
    h("h2", {}, `⑂ ${t("fk.title")}`),
    h("p", {}, t("fk.confirm", { n: fmtInt(n) })),
    h("ul", { class: "small" },
      h("li", {}, t("fk.resets")),
      h("li", {}, t("fk.keeps"))),
    h("div", { class: "modal-actions" }, cancel, go),
  );
}

/* ================= Distro (v0.5) ================= */
let distroTabKey = "";
let selectedDistro = "d_restart";
function renderDistroTab() {
  const s = engine.s;
  const pending = packagesOnDistro(s).toNumber();
  const done = forkTreeComplete(s);
  setText($("[data-r=dsDesc]"), done ? t("ds.desc") : t("ds.need_tree"));
  setText($("[data-r=dsFlavor]"), s.flavor ? t("ds.current", { f: t(`fl.${s.flavor}`) }) : t("ds.no_flavor"));
  const btn = $<HTMLButtonElement>("[data-r=dsBtn]");
  setText(btn, pending >= 1 ? t("ds.btn", { n: fmtInt(pending) }) : t("ds.btn0"));
  btn.disabled = pending < 1 || !!s.challenge;
  toggleClass(btn, "advised", distroAdvice.advised);
  // How the packages are computed
  const calc = $("[data-r=dsCalc]");
  const rows: [string, string, string?][] = [
    [t("ds.calc.contrib", { c: fmtInt(s.lifetimeContributors) }), packagesExact(s).toNumber().toFixed(2)],
    ...(hasDistro(s, "d_pkg") ? [[t("ds.calc.pkg"), `×${(1 + DISTRO_PCT.pkg).toFixed(2)}`] as [string, string]] : []),
    ...(moduleBonus(s, "packages") > 0 ? [[t("ds.calc.mod"), `×${(1 + moduleBonus(s, "packages")).toFixed(2)}`] as [string, string]] : []),
    ...(hasDistro(s, "d_upstream") ? [[t("ds.calc.ups"), `+${UPSTREAM_PACKAGES}`] as [string, string]] : []),
    [t("ds.calc.total"), `${fmtInt(pending)} ▣`, "total"],
    [t("ds.calc.next", { c: fmtInt(nextPackageAt(s)) }), t("ds.calc.more", { c: fmtInt(Math.max(0, nextPackageAt(s) - s.lifetimeContributors)) }), "next"],
  ];
  const ckey = rows.map(r => r.join("|")).join("/");
  if (calc.dataset.key !== ckey) {
    calc.dataset.key = ckey;
    calc.replaceChildren(h("div", { class: "fc-title" }, t("ds.calc.title")),
      ...rows.map(([l, v, c]) => h("div", { class: "fc-row" + (c ? ` ${c}` : "") }, h("span", {}, l), h("span", { class: "fc-v" }, v))));
  }
  const rate = $("[data-r=dsRate]");
  const showRate = pending >= 1;
  if (rate.hidden === showRate) rate.hidden = !showRate;
  if (showRate) setText(rate, t("ds.rate", { r: distroAdvice.rate.toFixed(1) }));
  toggleClass(rate, "on", distroAdvice.advised);
  // crontab (Market milestone 5 %), next to the distro button
  const cron = $("[data-r=cron]");
  const showCron = reached(s, "crontab");
  if (cron.hidden === showCron) cron.hidden = !showCron;
  if (showCron) {
    const c = s.market.cron;
    const on = $<HTMLInputElement>("[data-r=cronOn]");
    if (on.checked !== c.enabled) on.checked = c.enabled;
    const rot = $<HTMLInputElement>("[data-r=cronRot]");
    if (rot.checked !== c.rotate) rot.checked = c.rotate;
    const thr = $<HTMLInputElement>("[data-r=cronThr]");
    if (document.activeElement !== thr && thr.value !== String(c.threshold)) thr.value = String(c.threshold);
  }
  setText($("[data-r=dsSum]"), t("ds.sum", { p: fmtInt(s.packages), l: fmtInt(s.lifetimePackages), d: fmtInt(s.distros), g: `×${packagesGainsMult(s).toFixed(2)}` }));
  const key = `${s.distroTalents.join(",")}|${s.packages}|${s.flavor}|${s.flavorsDone.join(",")}|${selectedDistro}|${s.settings.lang}`;
  if (key === distroTabKey) return;
  distroTabKey = key;
  const doneFl: Flavor[] = FLAVORS.filter(f => s.flavorsDone.includes(f.id));
  const mkTeaser = $("[data-r=mkTeaser]");
  mkTeaser.hidden = s.market.unlocked || doneFl.length < 2;
  const perm = $("[data-r=dsPerm]");
  perm.hidden = doneFl.length === 0;
  perm.replaceChildren(h("div", { class: "ds-perm-h" }, t("ds.fl.summary", { n: doneFl.length, t: FLAVORS.length })),
    ...doneFl.map(f => h("div", { class: "ds-perm-l" }, h("span", { class: "ds-perm-ok" }, "[✓] "), t("ds.fl.permline", { n: t(`fl.${f.id}`), b: t(`fl.${f.id}.perm`) }))));
  $("[data-r=dsFlavors]").replaceChildren(...FLAVORS.map(f => {
    const isDone = s.flavorsDone.includes(f.id), isCur = s.flavor === f.id;
    const badges: Node[] = [];
    if (isCur) badges.push(h("span", { class: "fl-badge cur" }, t("ds.fl.st.current")));
    if (isDone) badges.push(h("span", { class: "fl-badge done" }, t("ds.fl.st.done")));
    return h("div", { class: "fu fl-card" + (isCur ? " on" : "") + (isDone ? " done" : "") },
      h("div", { class: "fu-top" }, h("span", { class: "ft-name" }, t(`fl.${f.id}`)), h("span", { class: "ft-tag" }, `[${f.tag}]`)),
      ...(badges.length ? [h("div", { class: "fl-badges" }, ...badges)] : []),
      h("div", { class: "ft-desc" }, t(`fl.${f.id}.desc`)),
      isDone
        ? h("div", { class: "fl-perm" }, t("ds.fl.perm", { b: t(`fl.${f.id}.perm`) }))
        : h("div", { class: "fl-todo" }, t("ds.fl.bonus", { b: t(`fl.${f.id}.bonus`) })));
  }));
  renderDistroTree();
}

let distroTreeBuilt = false;
function buildDistroTree() {
  const tree = $("[data-r=dtree]");
  tree.replaceChildren();
  const rows = Math.max(...DISTRO_TALENTS.map(x => x.row)) + 1;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${TREE_COLS * 100} ${rows * 100}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("tree-lines");
  for (const dt of DISTRO_TALENTS) for (const r of dt.req) {
    const p = DISTRO_TALENT_BY_ID[r];
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(p.col * 100 + 50)); line.setAttribute("y1", String(p.row * 100 + 50));
    line.setAttribute("x2", String(dt.col * 100 + 50)); line.setAttribute("y2", String(dt.row * 100 + 50));
    line.dataset.to = dt.id; line.dataset.from = r;
    svg.append(line);
  }
  tree.append(svg);
  for (const dt of DISTRO_TALENTS) {
    const node = h("button", { class: "node fnode dnode", "data-dt": dt.id, title: t(`dt.${dt.id}`) },
      h("span", { class: "node-icon" }, dt.tag), h("span", { class: "node-cost" }, `${dt.cost}▣`));
    node.style.left = `${(dt.col + 0.5) * (100 / TREE_COLS)}%`;
    node.addEventListener("click", () => { selectedDistro = dt.id; distroTabKey = ""; render(); });
    node.addEventListener("dblclick", () => cmd.run(`distro buy ${dt.tag}`, true));
    tree.append(node);
  }
  distroTreeBuilt = true;
}
function renderDistroTree() {
  if (!distroTreeBuilt || !$("[data-r=dtree]").firstChild) buildDistroTree();
  const s = engine.s;
  const tree = $("[data-r=dtree]");
  const vis = Object.fromEntries(DISTRO_TALENTS.map(x => [x.id, distroTalentVisibility(s, x.id)]));
  if (vis[selectedDistro] === "hidden") selectedDistro = "d_restart";
  const rows = Math.max(...DISTRO_TALENTS.filter(x => vis[x.id] !== "hidden").map(x => x.row)) + 1;
  tree.style.aspectRatio = `${TREE_COLS} / ${rows}`;
  $(".tree-lines", tree).setAttribute("viewBox", `0 0 ${TREE_COLS * 100} ${rows * 100}`);
  for (const dt of DISTRO_TALENTS) {
    const node = $(`[data-dt=${dt.id}]`, tree);
    node.style.top = `${(dt.row + 0.5) * (100 / rows)}%`;
    toggleClass(node, "hidden", vis[dt.id] === "hidden");
    toggleClass(node, "fog", vis[dt.id] === "fog");
    setText($(".node-icon", node), vis[dt.id] === "fog" ? "???" : dt.tag);
    node.title = vis[dt.id] === "shown" ? t(`dt.${dt.id}`) : "???";
    const owned = hasDistro(s, dt.id);
    const reqOk = dt.req.every(r => hasDistro(s, r));
    toggleClass(node, "owned", owned);
    toggleClass(node, "avail", !owned && reqOk);
    toggleClass(node, "afford", !owned && reqOk && s.packages >= dt.cost);
    toggleClass(node, "locked", !owned && !reqOk && vis[dt.id] === "shown");
    toggleClass(node, "sel", dt.id === selectedDistro);
  }
  tree.querySelectorAll<SVGLineElement>("line").forEach(l => {
    l.classList.toggle("lit", hasDistro(s, l.dataset.from!) && hasDistro(s, l.dataset.to!));
    l.classList.toggle("hidden", vis[l.dataset.from!] !== "shown" || vis[l.dataset.to!] === "hidden");
  });
  const dt = DISTRO_TALENT_BY_ID[selectedDistro];
  if (vis[dt.id] === "fog") {
    $("[data-r=dtDetail]").replaceChildren(h("div", {}, h("span", { class: "ft-tag" }, "[???]"), ` ${t("tree.fog")}`));
    return;
  }
  const owned = hasDistro(s, dt.id);
  const reqOk = dt.req.every(r => hasDistro(s, r));
  const buy = h("button", { class: "claim-btn" }, owned ? t("fk.owned") : `${t("fk.buy")} · ${dt.cost} ▣`) as HTMLButtonElement;
  buy.disabled = owned || !reqOk || s.packages < dt.cost;
  buy.addEventListener("click", () => cmd.run(`distro buy ${dt.tag}`, true));
  $("[data-r=dtDetail]").replaceChildren(
    h("div", {}, h("span", { class: "ft-tag" }, `[${dt.tag}]`), h("strong", {}, t(`dt.${dt.id}`))),
    h("div", {}, t(`dt.${dt.id}.desc`)),
    NEXT_DISTRO_TALENTS.includes(dt.id) ? h("div", { class: "td-next small" }, t("tree.next.distro"))
      : NEXT_FORK_DISTRO_TALENTS.includes(dt.id) ? h("div", { class: "td-next small" }, t("tree.next.fork")) : "",
    dt.req.length ? h("div", { class: "muted small" }, t("fk.req", { r: dt.req.map(r => DISTRO_TALENT_BY_ID[r].tag).join(" + ") })) : "",
    buy,
  );
}

/** Publishing a distro: pick the flavor of the next cycle, then confirm. */
function confirmDistro() {
  const s = engine.s;
  const n = packagesOnDistro(s).toNumber();
  const cancel = h("button", { class: "claim-btn" }, t("fk.cancel"));
  cancel.addEventListener("click", closeModal);
  const choices = FLAVORS.map(f => {
    const b = h("button", { class: "flavor-choice" },
      h("strong", {}, `${t(`fl.${f.id}`)} `), h("span", { class: "ft-tag" }, `[${f.tag}]`),
      h("div", { class: "small" }, t(`fl.${f.id}.desc`)),
      h("div", { class: "muted small" }, s.flavorsDone.includes(f.id) ? t("ds.fl.done") : t("ds.fl.bonus", { b: t(`fl.${f.id}.bonus`) })));
    b.addEventListener("click", () => { closeModal(); cmd.run(`distro ${f.id} --yes`, true); });
    return b;
  });
  openModal(
    h("h2", {}, `▣ ${t("ds.title")}`),
    h("p", {}, t("ds.confirm", { n: fmtInt(n) })),
    h("ul", { class: "small" }, h("li", {}, t("ds.resets")), h("li", {}, t("ds.keeps"))),
    h("p", { class: "small" }, t("ds.pick")),
    h("div", { class: "flavor-grid" }, ...choices),
    h("div", { class: "modal-actions" }, cancel),
  );
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
    ["st.ach_bonus", bonusSummary(engine) || "—"],
    ["st.playtime", fmtTime(s.stats.playTime)],
    ["st.runtime", fmtTime(s.stats.runTime)],
    ["st.releases", fmtInt(s.releases)],
    ["st.lifetime_stars", fmt(s.lifetimeStars)],
    ["st.events", fmtInt(s.stats.events)],
    ...(s.forks > 0 ? [
      ["st.forks", fmtInt(s.forks)],
      ["st.contributors", fmtInt(s.lifetimeContributors)],
      ["st.fastest_fork", s.stats.fastestFork === null ? "—" : fmtTime(s.stats.fastestFork)],
      ["st.fork_time", fmtTime(s.stats.forkTime)],
      ["st.prs", fmtInt(s.stats.prsMerged)],
      ["st.all_stars", fmt(new Decimal(s.stats.allStars))],
    ] as [string, string][] : []),
    ...(s.distros > 0 ? [
      ["st.distros", fmtInt(s.distros)],
      ["st.packages", fmtInt(s.lifetimePackages)],
      ["st.fastest_distro", s.stats.fastestDistro === null ? "—" : fmtTime(s.stats.fastestDistro)],
      ["st.distro_time", fmtTime(s.stats.distroTime)],
    ] as [string, string][] : []),
    ...(s.market.unlocked ? [
      ["st.market", `${marketShare(s).pct.toFixed(2)} %`],
      ["st.installs", fmtInt(Math.floor(s.market.installs))],
      ["st.modules", fmtInt(s.stats.modulesFound)],
    ] as [string, string][] : []),
    ...(gensRevealed(s) ? [
      ["st.gens", `${totalGens(s)} (CPU ${s.gens.cpu} · RAM ${s.gens.ram} · ${t("hw.disk")} ${s.gens.disk})`] as [string, string],
      ["st.gens_total", fmtInt(s.stats.gensTotal)] as [string, string],
    ] : []),
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
  const life = 2500; // v0.4.14: short everywhere (Arthur: just as annoying on desktop)
  setTimeout(() => el.classList.add("out"), life);
  setTimeout(() => el.remove(), life + 500);
}
// Any click or touch clears the toasts (phone since v0.4.8, desktop since v0.4.14):
// they must never sit on what the player wants to reach
document.addEventListener("pointerdown", () => {
  for (const el of document.querySelectorAll<HTMLElement>(".toast")) {
    el.classList.add("out");
    setTimeout(() => el.remove(), 300);
  }
}, { capture: true, passive: true });

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
  // Installable app (PWA): the browser's prompt, or the iPhone how-to
  const mode = installMode();
  const install: Node[] = [];
  if (mode === "prompt") {
    const btn = h("button", { class: "btn" }, t("set.install"));
    btn.addEventListener("click", async () => { await promptInstall(); openSettings(); });
    install.push(h("hr"), btn, h("div", { class: "small muted" }, t("set.install.desc")));
  } else if (mode === "ios") {
    install.push(h("hr"), h("div", { class: "small" }, h("strong", {}, t("set.install")), " · ", t("set.install.ios")),
      h("div", { class: "small muted" }, t("set.install.ios_save")));
  }
  // Keep the screen on (device preference, outside the save)
  const wake: Node[] = [];
  if (wakeLockSupported()) {
    const box = h("input", { type: "checkbox" }) as HTMLInputElement;
    box.checked = wakeLockEnabled();
    box.addEventListener("change", () => setWakeLock(box.checked));
    wake.push(h("label", { class: "switch" }, box, t("set.wake")), h("div", { class: "small muted" }, t("set.wake.desc")));
  }
  const tutBtn = h("button", { class: "btn" }, t("set.tutorial"));
  tutBtn.addEventListener("click", () => { replayTutorial(); closeModal(); render(); });
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
    ...wake,
    h("hr"),
    area,
    h("div", { class: "row" }, exportBtn, importBtn),
    msg,
    ...install,
    h("hr"),
    tutBtn,
    resetBtn,
  );
}

/** Every reward the offline summary can list, in order; a line shows only when its count is above 0.
 *  A new currency or automation adds its counter in OfflineGains (engine.ts) and one line here. */
const OFFLINE_LINES: ((g: OfflineGains) => string | null)[] = [
  g => g.hardware > 0 ? t("off.upgrades", { n: fmtInt(g.hardware) }) : null,
  g => g.generations > 0 ? t("off.gens", { n: fmtInt(g.generations) }) : null,
  g => g.releases > 0 ? t("off.releases", { n: fmtInt(g.releases), s: fmt(g.stars) }) : null,
  g => g.talents > 0 ? t("off.talents", { n: fmtInt(g.talents) }) : null,
  g => g.optimizations > 0 ? t("off.opts", { n: fmtInt(g.optimizations) }) : null,
  g => g.forks > 0 ? t("off.forks", { n: fmtInt(g.forks), c: fmtInt(g.contributors) }) : null,
  g => g.forkBuys > 0 ? t("off.forkbuys", { n: fmtInt(g.forkBuys) }) : null,
  g => g.prs > 0 ? t("off.prs", { n: fmtInt(g.prs) }) : null,
  g => g.distros > 0 ? t("off.distros", { n: fmtInt(g.distros), p: fmtInt(g.packages) }) : null,
  g => g.installs > 0 ? t("off.installs", { n: fmtInt(Math.round(g.installs)), p: marketShare(engine.s).pct.toFixed(2) }) : null,
  g => g.modules > 0 ? t(engine.s.market.crates.length ? "off.crates" : "off.modules", { n: fmtInt(g.modules), c: fmtInt(engine.s.market.crates.length) }) : null,
  g => g.challenges > 0 ? t("off.challenges", { n: fmtInt(g.challenges) }) : null,
  g => g.milestones.length > 0 ? t("off.milestones", { m: g.milestones.map(id => `${MILESTONE_BY_ID[id as MilestoneId].pct} % ${t(`mk.m.${id}`)}`).join(", ") }) : null,
];

function showOffline(rep: NonNullable<ReturnType<Engine["simulateOffline"]>>) {
  if (rep.away < 60) return; // short absences are silent
  const items = [
    h("li", {}, t("off.credits", { x: fmt(rep.credits) })),
    h("li", {}, t("off.builds", { n: fmtInt(rep.builds), f: fmtInt(rep.fails) })),
  ];
  for (const line of OFFLINE_LINES) { const text = line(rep.gains); if (text) items.push(h("li", {}, text)); }
  for (const a of rep.gains.achievements) items.push(h("li", {}, `[!] ${t(`a.${a}`)}`));
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
  const extra = [
    rep.gains.releases > 0 ? `+${fmt(rep.gains.stars)} ⭐` : "",
    rep.gains.forks > 0 ? `+${fmtInt(rep.gains.contributors)} ⑂` : "",
  ].filter(Boolean).join(", ");
  term.println(INFO, ` ${t("off.title")} (${fmtTime(rep.away)}): +${fmt(rep.credits)} ${t("credits")}${extra ? `, ${extra}` : ""}`);
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
    case "autostars": {
      // One quiet journal line per batch, no toast (automation should not get in the way)
      const parts: string[] = [];
      if (e.talents.length) parts.push(e.talents.map(id => t(`t.${id}`)).join(", "));
      if (e.opts) parts.push(t("ans.opts", { n: e.opts }));
      term.println(["[ ANS ]", "c-dim"], [" " + parts.join(" · "), "c-dim"]);
      if (e.talents.length) buildTree();
      break;
    }
    case "achievement": {
      const r = Engine.rewardOf(e.id);
      const rt = r ? rewardText(r) : "";
      term.println(["[ ACH ]", "c-amber"], [" " + t("term.achievement", { a: t(`a.${e.id}`) }), "c-amber"], ["  " + t("ach.to_claim", { r: rt }), "c-green"]);
      toast(t("ach.unlocked"), `${t(`a.${e.id}`)} · ${rt}`);
      break;
    }
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
        term.println(["[ NEW ]", "c-green"], " " + t("rev.cmds", { c: "tree, talent, optimize, gen" }));
      }
      if (engine.s.releases === CHALLENGES_UNLOCK_AT) {
        term.println(["[ NEW ]", "c-green"], " " + t("rev.cmds", { c: "challenge" }));
        toast(t("rev.new"), t("tab.challenges"));
      }
      if (engine.challengesUnlocked) {
        const next = CHALLENGES.find(c => !engine.s.challengesDone.includes(c.id));
        if (next) term.println(["[ TIP ]", "c-violet"], " " + t("adv.ch_tip", { c: t(`ch.${next.id}`), r: t(`ch.${next.id}.reward`), id: next.id }));
      }
      engine.save();
      break;
    }
    case "challenge_start":
      flushMinute(true);
      runCount = { ok: 0, fail: 0 };
      term.println(["[ CH ]", "c-amber"], " " + t(e.auto ? "ch.mtx.started" : "term.ch_started", { c: challengeName(e.id), x: fmt(challengeGoal(engine.s)) }));
      if (!e.auto) toast("Challenge", challengeName(e.id));
      break;
    case "challenge_done":
      term.banner(`✓ ${t("ch.done")} · ${challengeName(e.id)}`, "c-green");
      term.println(["[ CH ]", "c-green"], " " + t("term.ch_done", { c: challengeName(e.id), r: t(`ch.${e.id}.reward`) }));
      toast(t("ch.done"), `${challengeName(e.id)} · ${t(`ch.${e.id}.reward`)}`);
      engine.save();
      break;
    case "challenge_exit":
      term.println(["[ CH ]", "c-dim"], " " + t(e.auto ? "ch.mtx.gaveup" : "term.ch_exit", { c: challengeName(e.id), m: Math.round(MATRIX_TIMEOUT / 60) }));
      break;
    case "event_spawn": {
      const ev = EVENT_BY_ID[e.id];
      term.println(["[ EVENT ]", "c-amber"], " " + t("ev.spawn", { i: ev.icon, n: t(`ev.${ev.id}`), c: ev.cmd, w: Math.round(e.window) }));
      break;
    }
    case "event_caught": {
      const ev = EVENT_BY_ID[e.id];
      const n = t(`ev.${ev.id}`);
      const line = e.credits ? t("ev.got_credits", { i: ev.icon, n, c: fmt(e.credits) })
        : e.builds ? t("ev.got_builds", { i: ev.icon, n, b: fmtInt(e.builds) })
        : t("ev.got", { i: ev.icon, n, b: eventBonusText(ev.id) });
      term.println(OK, " " + line);
      toast(`${ev.icon} ${n}`, e.credits ? `+${fmt(e.credits)} cr` : eventBonusText(ev.id));
      break;
    }
    case "event_missed": {
      if (logLevel() === "minimal") break;
      const ev = EVENT_BY_ID[e.id];
      term.println(["[ EVENT ]", "c-dim"], [" " + t("ev.missed", { i: ev.icon, n: t(`ev.${ev.id}`) }), "c-dim"]);
      break;
    }
    case "buff_end":
      break;
    case "fork":
      // Forks made by the Fork bot (Distro talent): one journal line, no banner or toast
      if (e.auto) term.println(["[ FORK ]", "c-violet"], " " + t("ds.fbot.log", { n: fmtInt(e.contributors), f: fmtInt(engine.s.forks) }));
      else {
        term.banner(t("fk.banner", { n: fmtInt(e.contributors), f: fmtInt(engine.s.forks) }));
        toast(`⑂ ${t("fk.title")}`, t("fk.toast", { n: fmtInt(e.contributors) }));
      }
      buildTree();
      forkTabKey = "";
      lastAchCount = "";
      break;
    case "distro":
      // Distros published by crontab: one journal line, no banner or toast
      if (e.auto) term.println(["[ CRON ]", "c-cyan"], " " + t("mk.cron.log", { n: fmtInt(e.packages), f: t(`fl.${e.flavor}`), d: fmtInt(engine.s.distros) }));
      else {
        term.banner(t("ds.banner", { n: fmtInt(e.packages), f: t(`fl.${e.flavor}`), d: fmtInt(engine.s.distros) }));
        toast(`▣ ${t("ds.title")}`, t("ds.toast", { n: fmtInt(e.packages), f: t(`fl.${e.flavor}`) }));
      }
      buildTree();
      forkTabKey = distroTabKey = "";
      lastAchCount = "";
      engine.save();
      break;
    case "market_open":
      term.banner(t("mk.banner"));
      toast(`◕ ${t("mk.title")}`, t("mk.toast"));
      marketTabKey = "";
      break;
    case "installs":
      lastInstalls = e.n;
      term.println(["[ MARKET ]", "c-orange"], " " + t("mk.log", { n: fmtInt(Math.round(e.n)), p: marketShare(engine.s).pct.toFixed(2) }));
      marketTabKey = "";
      break;
    case "milestone":
      term.banner(t("mk.m.banner", { p: MILESTONE_BY_ID[e.id as MilestoneId].pct, m: t(`mk.m.${e.id}`) }));
      toast(`◕ ${MILESTONE_BY_ID[e.id as MilestoneId].pct} %`, t(`mk.m.${e.id}`));
      marketTabKey = "";
      break;
    case "crate":
      if (engine.s.market.autoOpen) break; // the "module" line follows at once
      term.println(["[ MOD ]", "c-orange"], " " + t("mk.crate.log", { n: engine.s.market.crates.length }));
      // A distro published by hand: the roulette pops up right away (crontab ones wait in the Market tab)
      if (!e.auto && document.visibilityState === "visible") setTimeout(() => openCrateRoulette(), 700);
      marketTabKey = "";
      break;
    case "module": {
      const r = t(`mk.r.${RARITIES[e.mod.rarity]}`);
      const fx = e.mod.effects.map(x => effectText(x.k, x.v)).join(" · ");
      term.println(["[ MOD ]", "c-orange"], " " + (e.recycled
        ? t("mk.mod.recycled", { n: e.mod.name, r, p: e.recycled })
        : t("mk.mod.log", { n: e.mod.name, r, fx })));
      if (!e.recycled && e.mod.rarity >= 2 && !rouletteOpen) toast(`◕ ${e.mod.name} [${r}]`, fx);
      marketTabKey = "";
      break;
    }
    case "distro_talent":
      term.println(OK, " " + t("ds.bought", { t: t(`dt.${e.id}`) }));
      distroTabKey = "";
      break;
    case "fork_upgrade":
      term.println(OK, " " + t("fu.bought", { u: t(`fu.${e.id}`), n: e.level }));
      forkTabKey = "";
      break;
    case "fork_talent":
      term.println(OK, " " + t("fk.bought", { t: t(`ft.${e.id}`) }));
      forkTabKey = "";
      break;
    case "pr_open":
      term.println(["[ PR ]", "c-violet"], " " + t("fk.pr_open", { n: e.pr.n, title: t(`pr.${e.pr.kind}.${e.pr.title}`), fx: prEffectText(e.pr.kind) }));
      forkTabKey = "";
      break;
    case "pr_merged":
      term.println(OK, " " + t("fk.pr_merged", { n: e.pr.n, fx: e.credits ? `+${fmt(e.credits)} cr` : prEffectText(e.pr.kind) }));
      forkTabKey = "";
      break;
    case "generation": {
      const r = t(`hw.${e.key}`);
      const b = genBonusText(e.key);
      term.println(["[ GEN ]", "c-violet"], " " + t("term.gen_ok", { r, n: e.gen, f: t(`gen.flavor.${e.key}`), b, l: engine.s.hw[e.key] }));
      if (!e.auto) toast(`⬆ ${r} · ${t("gen.label", { n: e.gen })}`, b); // auto-generations (rnv): journal only
      engine.save();
      break;
    }
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

  advice = advisor.update(engine.s);
  forkAdvice = forkAdvisor.update(engine.s);
  distroAdvice = distroAdvisor.update(engine.s);
  if (!distroAdvice.advised) distroAdvisedLogged = false;
  else if (!distroAdvisedLogged) {
    distroAdvisedLogged = true;
    term.println(["[ DISTRO ]", "c-violet"], " " + t("ds.adv.log", { n: fmtInt(distroAdvice.pending) }));
  }
  const forkBotOn = hasDistro(engine.s, "d_forkbot") && engine.s.autoFork.enabled;
  if (!forkAdvice.advised || forkBotOn) forkAdvisedLogged = forkBotOn && forkAdvice.advised;
  else if (!forkAdvisedLogged) {
    forkAdvisedLogged = true;
    term.println(["[ FORK ]", "c-violet"], " " + t("fk.adv.log", { n: fmtInt(forkAdvice.pending) }));
  }
  if (!advice.advised) advisedLogged = false;
  else if (!advisedLogged && starsRevealed(engine.s) && !has(engine.s, "release_bot")) {
    advisedLogged = true;
    term.println(STAR, " " + t("adv.log", { n: fmt(advice.pending) }));
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
initPwa(() => { /* the Settings read installMode() each time they open */ });
initWakeLock();
initTutorial({
  engine: () => engine,
  show: (panel, tab) => {
    if (tab) { sideTab = tab; }
    if (window.matchMedia("(max-width: 900px)").matches && mobilePanel !== panel) {
      mobilePanel = panel;
      $("main.layout").dataset.mobile = panel;
    }
    setTimeout(render, 0); // called from render(): never re-enter it
  },
  mobile: () => window.matchMedia("(max-width: 900px)").matches,
  modalOpen: () => !$("[data-r=modal]").hidden,
});
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
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    document.documentElement.style.setProperty("--app-h", vv.height + "px");
    if (vv.offsetTop) window.scrollTo(0, 0);
  };
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  fit();
}
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

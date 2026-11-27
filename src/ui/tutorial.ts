/**
 * New-player tutorial and one-time tips (v0.4.12, Arthur: "un tuto skippable, des pop-ups
 * explicatives"). Two parts:
 * - a short interactive tutorial at the start of a new game: each step points at one element
 *   and waits for the player to do it (compile, buy hardware, CI/CD), with Skip at every step;
 * - one-time tips when a feature unlocks (first release, events, generations, challenges, fork).
 *   They never explain anything before it unlocks (progressive discovery).
 * Progress lives in `s.seen` ("tut:…" and "tip:…" entries), so no save format change.
 * Existing saves never see the tutorial, and only get tips for features they unlock later.
 */
import type { Engine } from "../core/engine";
import { GEN_KEYS } from "../core/state";
import { forkRevealed, treeComplete } from "../core/fork";
import { distroRevealed } from "../core/distro";
import { PERK_PRICE, gensRevealed, price } from "../core/formulas";
import { t } from "../i18n";
import { fmt } from "../format";
import type Decimal from "break_eternity.js";
import { installMode, promptInstall } from "./pwa";

type Panel = "shop" | "center" | "side";
type SideTab = "release" | "challenges" | "fork" | "distro" | "market" | "achievements" | "stats";

interface Deps {
  engine: () => Engine;
  /** Shows a column on mobile and, for the side column, a tab. */
  show: (panel: Panel, tab?: SideTab) => void;
  mobile: () => boolean;
  /** True while a modal (settings, confirmations) is open: bubbles wait. */
  modalOpen: () => boolean;
  /** This session follows a real absence (a returning player): the install tip may show. */
  returning: () => boolean;
}

interface Step {
  id: string;
  anchor: string;
  panel: Panel;
  tab?: SideTab;
  /** Done when this becomes true; without it, the step has a Next button. */
  done?: () => boolean;
  /** Credits goal of the step: shows a progress bar "x / goal cr" in the bubble. */
  goal?: () => Decimal;
}

interface Tip {
  id: string;
  anchor: () => string;
  panel: Panel;
  tab?: SideTab;
  when: () => boolean;
  /** For short-lived anchors (an event): the tip closes itself when this becomes false. */
  live?: () => boolean;
  /** Text other than `tip.<id>`. */
  text?: () => string;
  /** A main button (e.g. Install) next to "Later", instead of Got it / No more tips / Show. */
  action?: () => { label: string; run: () => void } | null;
}

let deps: Deps;
const S = () => deps.engine().s;
const seen = (k: string) => S().seen.includes(k);
const mark = (k: string) => { if (!seen(k)) S().seen.push(k); };

const bought = () => S().hw.cpu + S().hw.ram + S().hw.disk + S().hw.jobs > 4;
const cheapestHw = () => (["cpu", "ram", "disk"] as const).map(k => price(k, S().hw[k])).reduce((a, b) => (a.lt(b) ? a : b));

const STEPS: Step[] = [
  { id: "welcome", anchor: "[data-r=credits]", panel: "center" },
  // Each step only moves on when the next one is possible (1st build: 1 cr, cheapest hardware 1.5 cr,
  // CI/CD 10 cr), so a phone never sends the player to a shop they cannot afford yet
  { id: "compile", anchor: "[data-r=runBtn]", panel: "center", done: () => bought() || S().credits.gte(cheapestHw()), goal: () => cheapestHw() },
  { id: "buy", anchor: "[data-r=hw]", panel: "shop", done: bought },
  { id: "grind", anchor: "[data-r=runBtn]", panel: "center", done: () => S().perks.ci_cd.unlocked || S().credits.gte(PERK_PRICE.ci_cd), goal: () => PERK_PRICE.ci_cd },
  { id: "ci", anchor: "[data-perk=ci_cd]", panel: "shop", done: () => S().perks.ci_cd.unlocked },
  { id: "goal", anchor: "[data-r=relBtn]", panel: "side", tab: "release" },
];

const readyGen = () => GEN_KEYS.find(k => deps.engine().canGenerate(k) === "ok");
const TIPS: Tip[] = [
  { id: "stars", anchor: () => "[data-r=tree]", panel: "side", tab: "release", when: () => S().releases >= 1 || S().forks >= 1 },
  // v0.6.16 (Arthur: the installed app plays better): offered once, on a phone, to a player who is hooked:
  // after the first release, or when they come back after an absence. Never at the very start.
  {
    id: "install", anchor: () => "[data-a=settings]", panel: "center",
    when: () => deps.mobile() && installMode() !== "none" && (S().releases >= 1 || S().forks >= 1 || deps.returning()),
    text: () => t(installMode() === "ios" ? "tip.install.ios" : "tip.install"),
    action: () => installMode() === "prompt" ? { label: t("tip.install.btn"), run: () => { void promptInstall(); } } : null,
  },
  { id: "event", anchor: () => "[data-r=evPill]", panel: "center", when: () => !!deps.engine().activeEvent, live: () => !!deps.engine().activeEvent },
  { id: "gen", anchor: () => `[data-hw=${readyGen() ?? "cpu"}] [data-f=gen]`, panel: "shop", when: () => gensRevealed(S()) && !!readyGen() },
  { id: "challenges", anchor: () => "[data-tab=challenges]", panel: "side", when: () => deps.engine().challengesUnlocked },
  { id: "fork", anchor: () => "[data-r=forkTeaser]", panel: "side", tab: "release", when: () => forkRevealed(S()) && S().forks === 0 && !treeComplete(S()) },
  { id: "forkready", anchor: () => "[data-tab=fork]", panel: "side", when: () => treeComplete(S()) || S().forks >= 1 },
  { id: "forked", anchor: () => "[data-tab=fork]", panel: "side", when: () => S().forks >= 1 },
  { id: "distro", anchor: () => "[data-tab=distro]", panel: "side", when: () => distroRevealed(S()) },
  { id: "distroed", anchor: () => "[data-r=dtree]", panel: "side", tab: "distro", when: () => S().distros >= 1 },
  { id: "market", anchor: () => "[data-tab=market]", panel: "side", when: () => S().market.unlocked },
];

let bubble: HTMLElement | null = null;
let lit: Element | null = null;
let shown = ""; // id of what the bubble currently shows
let stepShown = -1; // last tutorial step the columns were switched for

export function initTutorial(d: Deps) {
  deps = d;
}

/**
 * A save with real progress that has never seen the tutorial predates it (or was imported):
 * no tutorial, and no tip for what is already unlocked. Checked on every update, since a save
 * can be imported or reset at any time. A new player finishes the tutorial long before this.
 */
function adoptOldSave() {
  const s = S();
  if (seen("tut:done") || seen("tut:off") || seen("tut:replay")) return;
  if (s.releases === 0 && s.forks === 0 && s.stats.playTime < 1800) return;
  mark("tut:done");
  // install: old saves still get it once (their players are the most likely to want the app)
  for (const tip of TIPS) if (tip.id !== "event" && tip.id !== "gen" && tip.id !== "install" && tip.when()) mark(`tip:${tip.id}`);
  if (s.stats.events > 0) mark("tip:event");
  if (s.stats.gensTotal > 0) mark("tip:gen");
}

/** Settings → "Replay the tutorial": the steps start over, tips come back on. */
export function replayTutorial() {
  const s = S();
  s.seen = s.seen.filter(k => k !== "tut:done" && k !== "tut:off" && !k.startsWith("tut:step:"));
  // Replayed on a save with progress: every step gets a Next button instead of waiting for an action
  s.seen.push("tut:replay");
  stepShown = -1;
  shown = "";
}

const currentStep = () => {
  if (seen("tut:done") || seen("tut:off")) return -1;
  // Steps with a Next button are remembered; the others are done when their action is
  for (let i = 0; i < STEPS.length; i++) {
    const st = STEPS[i];
    if (st.done && !seen("tut:replay") ? !st.done() : !seen(`tut:step:${st.id}`)) return i;
  }
  mark("tut:done");
  S().seen = S().seen.filter(k => k !== "tut:replay");
  return -1;
};

function skip() {
  mark("tut:off");
  S().seen = S().seen.filter(k => k !== "tut:replay");
  close();
}

function close() {
  bubble?.remove();
  bubble = null;
  lit?.classList.remove("tut-hl");
  lit = null;
  shown = "";
}

function place(anchor: Element | null) {
  if (!bubble) return;
  if (lit !== anchor) {
    lit?.classList.remove("tut-hl");
    anchor?.classList.add("tut-hl");
    lit = anchor;
  }
  if (deps.mobile()) { bubble.classList.add("tut-mobile"); bubble.style.left = bubble.style.top = ""; return; }
  bubble.classList.remove("tut-mobile");
  const b = bubble.getBoundingClientRect();
  const r = anchor?.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) { // not on screen: centered at the top
    bubble.style.left = `${Math.round((innerWidth - b.width) / 2)}px`;
    bubble.style.top = "80px";
    return;
  }
  const below = r.bottom + 10 + b.height < innerHeight;
  const top = below ? r.bottom + 10 : Math.max(10, r.top - 10 - b.height);
  const left = Math.min(Math.max(10, r.left + r.width / 2 - b.width / 2), innerWidth - b.width - 10);
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;
}

function open(id: string, head: string, text: string, buttons: HTMLElement[], progress = false) {
  close();
  shown = id;
  bubble = document.createElement("div");
  bubble.className = "tut-bubble";
  bubble.setAttribute("role", "dialog");
  const h = document.createElement("div");
  h.className = "tut-head";
  h.textContent = head;
  const p = document.createElement("div");
  p.className = "tut-text";
  p.textContent = text;
  const row = document.createElement("div");
  row.className = "tut-row";
  row.append(...buttons);
  bubble.append(h, p);
  if (progress) {
    const prog = document.createElement("div");
    prog.className = "tut-prog";
    prog.innerHTML = '<span class="tut-bar"><i></i></span><span class="tut-prog-t"></span>';
    bubble.append(prog);
  }
  bubble.append(row);
  document.body.append(bubble);
}

const btn = (label: string, cls: string, fn: () => void) => {
  const b = document.createElement("button");
  b.className = `tut-btn ${cls}`;
  b.textContent = label;
  b.addEventListener("click", ev => { ev.stopPropagation(); fn(); });
  return b;
};

/** Called on every render. */
export function updateTutorial() {
  if (!deps) return;
  adoptOldSave();
  document.documentElement.classList.toggle("tut-on", !!bubble);
  if (deps.modalOpen()) { if (bubble) bubble.hidden = true; return; }
  if (bubble) bubble.hidden = false;

  // 1. Tutorial steps
  const i = currentStep();
  if (i >= 0) {
    const st = STEPS[i];
    const id = `step:${st.id}`;
    if (stepShown !== i) { stepShown = i; deps.show(st.panel, st.tab); }
    if (shown !== id) {
      const buttons = [btn(t("tut.skip"), "ghost", skip)];
      if (!st.done || seen("tut:replay")) buttons.push(btn(i === STEPS.length - 1 ? t("tut.finish") : t("tut.next"), "main", () => { mark(`tut:step:${st.id}`); close(); }));
      open(id, `[ TUTO ${i + 1}/${STEPS.length} ]`, t(`tut.${st.id}`), buttons, !!st.goal);
    }
    if (st.goal && bubble) {
      // v0.4.13 (Arthur): a progress bar on the credit goals, so the wait is clear without skipping
      const goal = st.goal();
      const cr = S().credits;
      const pct = Math.min(100, cr.div(goal).toNumber() * 100);
      (bubble.querySelector(".tut-bar i") as HTMLElement).style.width = `${pct}%`;
      bubble.querySelector(".tut-prog-t")!.textContent = `${fmt(cr.min(goal))} / ${fmt(goal)} cr`;
    }
    place(document.querySelector(st.anchor));
    return;
  }
  if (shown.startsWith("step:")) close();
  if (seen("tut:off")) { if (bubble) close(); return; }

  // 2. One tip at a time, in order
  if (shown.startsWith("tip:")) {
    const tip = TIPS.find(x => `tip:${x.id}` === shown)!;
    if (tip.live && !tip.live()) { mark(shown); close(); return; }
    place(document.querySelector(tip.anchor()));
    return;
  }
  const tip = TIPS.find(x => !seen(`tip:${x.id}`) && x.when());
  if (!tip) return;
  const id = `tip:${tip.id}`;
  const ok = btn(t("tut.ok"), "main", () => { mark(id); close(); });
  let buttons: HTMLElement[];
  if (tip.action) {
    // "Later" closes it for good; the action does the thing
    const act = tip.action();
    buttons = [btn(t("tip.later"), "ghost", () => { mark(id); close(); })];
    buttons.push(act ? btn(act.label, "main", () => { mark(id); close(); act.run(); }) : ok);
  } else {
    buttons = [btn(t("tut.mute"), "ghost", skip)];
    // On a phone, a tip never switches tabs by itself: "Show" does it
    if (deps.mobile()) buttons.push(btn(t("tut.show"), "ghost", () => deps.show(tip.panel, tip.tab)));
    buttons.push(ok);
  }
  open(id, `[ ${t("tut.tip")} ]`, tip.text ? tip.text() : t(`tip.${tip.id}`), buttons);
  if (!deps.mobile()) deps.show(tip.panel, tip.tab);
  place(document.querySelector(tip.anchor()));
}

// Loot roulette (v0.6.4, Arthur: "une roulette de loot, exactement comme sur CS à l'époque quand on ouvre une caisse").
// Purely cosmetic: the module in the crate is already rolled by the engine (seeded, in the save). The strip is
// filled with random modules for show, the real one is placed near the end, and the strip slows down on it.

export interface RouletteItem { name: string; rarity: number; tag: string }

export interface RouletteOptions {
  title: string;
  winner: RouletteItem;
  /** Random filler items (cosmetic). */
  filler: () => RouletteItem;
  skipLabel: string;
  soundLabel: (on: boolean) => string;
  /** Called once the strip has stopped (or was skipped); returns the result panel to show under it. */
  onStop: () => HTMLElement;
  /** Buttons shown once stopped. */
  actions: () => HTMLElement[];
  onClose: () => void;
}

const CARD = 112;      // card width + gap, px
const COUNT = 46;      // cards in the strip
const WIN_AT = 40;     // index of the real module
const SOUND_KEY = "overcompile-sound";

let audio: AudioContext | null = null;
function soundOn(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; }
}
function tick(pitch = 1) {
  if (!soundOn()) return;
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "square";
    o.frequency.value = 1400 * pitch;
    g.gain.setValueAtTime(0.03, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.04);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.05);
  } catch { /* no audio */ }
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function card(it: RouletteItem): HTMLElement {
  const c = el("div", `rl-card r${it.rarity}`);
  c.append(el("div", "rl-name", it.name), el("div", "rl-tag", `[${it.tag}]`));
  return c;
}

/** Opens the roulette overlay. Returns a function that closes it. */
export function openRoulette(o: RouletteOptions): () => void {
  const overlay = el("div", "rl-overlay");
  const box = el("div", "rl-box");
  const head = el("div", "rl-head");
  const title = el("div", "rl-title", o.title);
  const sound = el("button", "btn small rl-sound", o.soundLabel(soundOn())) as HTMLButtonElement;
  sound.addEventListener("click", () => {
    try { localStorage.setItem(SOUND_KEY, soundOn() ? "off" : "on"); } catch { /* ignore */ }
    sound.textContent = o.soundLabel(soundOn());
  });
  head.append(title, sound);
  const win = el("div", "rl-window");
  const strip = el("div", "rl-strip");
  for (let i = 0; i < COUNT; i++) strip.append(card(i === WIN_AT ? o.winner : o.filler()));
  win.append(strip, el("div", "rl-marker"));
  const result = el("div", "rl-result");
  const btns = el("div", "rl-btns");
  const skip = el("button", "btn rl-skip", o.skipLabel) as HTMLButtonElement;
  btns.append(skip);
  box.append(head, win, result, btns);
  overlay.append(box);
  document.body.append(overlay);

  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const duration = reduce ? 600 : 5200;
  // Stop somewhere inside the winning card (not always dead centre), like the real thing
  const jitter = (Math.random() - 0.5) * (CARD - 30);
  const target = () => WIN_AT * CARD + CARD / 2 - win.clientWidth / 2 + jitter;
  const start = performance.now();
  let lastIdx = -1, stopped = false, raf = 0;

  const finish = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    strip.style.transform = `translateX(${-target()}px)`;
    strip.children[WIN_AT].classList.add("win");
    tick(1.6);
    result.replaceChildren(o.onStop());
    btns.replaceChildren(...o.actions());
  };
  const frame = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 4); // fast, then a long slow-down
    const x = eased * target();
    strip.style.transform = `translateX(${-x}px)`;
    const idx = Math.floor((x + win.clientWidth / 2) / CARD);
    if (idx !== lastIdx) { lastIdx = idx; if (t < 1) tick(); }
    if (t < 1) raf = requestAnimationFrame(frame);
    else finish();
  };
  raf = requestAnimationFrame(frame);
  skip.addEventListener("click", finish);

  const close = () => {
    finish();
    overlay.remove();
    o.onClose();
  };
  overlay.addEventListener("click", e => { if (e.target === overlay && stopped) close(); });
  return close;
}

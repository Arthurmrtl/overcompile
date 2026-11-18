export type Seg = string | [string, string];

export const OK: Seg = ["[ OK ]", "c-green"];
export const FAIL: Seg = ["[FAIL]", "c-red"];
export const INFO: Seg = ["[INFO]", "c-blue"];
export const AUTO: Seg = ["[AUTO]", "c-violet"];
export const STAR: Seg = ["[ ⭐ ]", "c-amber"];

const MAX_LINES = 1500;

/** Phones and tablets: the on-screen keyboard must only open when the player asks for it. */
export const TOUCH = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const STREAM_LINES = 5;

export interface TerminalHooks {
  onCommand: (line: string) => void;
  onCtrlC: () => void;
  complete: (line: string) => string[];
}

/**
 * Two zones: a short "build stream" on top (decorative cargo output + one live
 * status line, never pushing anything), and the scrolling journal below
 * (commands, purchases, events) where only what matters is written.
 */
export class Terminal {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private stream: HTMLElement;
  private status: HTMLElement;
  private out: HTMLElement;
  private input: HTMLInputElement;
  private ps1: HTMLElement;
  private history: string[] = [];
  private hIdx = 0;
  private draft = "";
  private stickToBottom = true;
  user = "dev";
  host = "overcompile";

  constructor(private hooks: TerminalHooks) {
    this.root = document.createElement("div");
    this.root.className = "term";
    const top = document.createElement("div");
    top.className = "term-top";
    this.stream = document.createElement("div");
    this.stream.className = "term-stream";
    this.status = document.createElement("div");
    this.status.className = "term-status";
    top.append(this.stream, this.status);
    this.body = document.createElement("div");
    this.body.className = "term-body";
    this.out = document.createElement("div");
    this.out.className = "term-out";
    const row = document.createElement("label");
    row.className = "term-row";
    this.ps1 = document.createElement("span");
    this.input = document.createElement("input");
    this.input.className = "term-input";
    this.input.setAttribute("autocomplete", "off");
    this.input.setAttribute("autocapitalize", "off");
    this.input.setAttribute("spellcheck", "false");
    this.input.setAttribute("aria-label", "terminal input");
    this.input.setAttribute("enterkeyhint", "send");
    row.append(this.ps1, this.input);
    this.body.append(this.out, row);
    this.root.append(top, this.body);
    this.renderPrompt();

    this.body.addEventListener("scroll", () => {
      this.stickToBottom = this.body.scrollTop + this.body.clientHeight >= this.body.scrollHeight - 40;
    });
    // Desktop: clicking anywhere in the terminal focuses the prompt.
    // Touch: only the prompt row does (it is a <label>), so reading or scrolling never pops the keyboard.
    if (!TOUCH) {
      this.root.addEventListener("mouseup", () => {
        if (!String(window.getSelection())) this.focus();
      });
    }
    this.input.addEventListener("focus", () => {
      if (!TOUCH) return;
      document.documentElement.classList.add("kbd");
      // wait for the keyboard to finish opening, then keep the prompt in view
      setTimeout(() => this.scrollToEnd(), 300);
    });
    this.input.addEventListener("blur", () => document.documentElement.classList.remove("kbd"));
    this.input.addEventListener("keydown", e => this.onKey(e));
  }

  private promptSegs(): Seg[] {
    return [["[", "c-amber"], [this.user, "c-blue"], ["@", "c-amber"], [this.host, "c-green"], [" ~]$ ", "c-amber"]];
  }
  private renderPrompt() {
    this.ps1.replaceChildren(...this.segsToNodes(this.promptSegs()));
  }

  scrollToEnd() {
    this.stickToBottom = true;
    this.body.scrollTop = this.body.scrollHeight;
  }

  /** Decorative build output: a few lines that scroll in place. */
  streamLine(...segs: Seg[]) {
    const d = document.createElement("div");
    d.className = "l";
    d.append(...this.segsToNodes(segs));
    this.stream.append(d);
    while (this.stream.childElementCount > STREAM_LINES) this.stream.firstElementChild?.remove();
  }

  clearStream() {
    this.stream.replaceChildren();
  }

  /** The live status line, updated in place. */
  setStatus(...segs: Seg[]) {
    this.status.replaceChildren(...this.segsToNodes(segs));
  }

  /** Framed line for big moments (release, challenge…). */
  banner(text: string, cls = "c-amber") {
    const d = this.println([` ${text} `, cls + " c-bold"]);
    d.classList.add("banner");
    return d;
  }

  /** Automatic focus (boot, after a modal…): skipped on touch screens. */
  focus() {
    if (TOUCH) return;
    this.input.focus({ preventScroll: true });
  }

  setPlaceholder(text: string) {
    this.input.placeholder = text;
  }

  private segsToNodes(segs: Seg[]): Node[] {
    return segs.map(s => {
      if (typeof s === "string") return document.createTextNode(s);
      const sp = document.createElement("span");
      sp.className = s[1];
      sp.textContent = s[0];
      return sp;
    });
  }

  println(...segs: Seg[]) {
    const d = document.createElement("div");
    d.className = "l";
    d.append(...this.segsToNodes(segs));
    this.out.append(d);
    let extra = this.out.childElementCount - MAX_LINES;
    while (extra-- > 0) this.out.firstElementChild?.remove();
    if (this.stickToBottom) this.body.scrollTop = this.body.scrollHeight;
    return d;
  }

  /** Echo a command line as if it had been typed (spaced from what precedes). */
  echo(line: string) {
    this.println(...this.promptSegs(), line).classList.add("cmd");
  }

  clear() {
    this.out.replaceChildren();
  }

  private onKey(e: KeyboardEvent) {
    const key = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (key === "Enter") {
      e.preventDefault();
      const line = this.input.value;
      this.input.value = "";
      if (line.trim() && this.history[this.history.length - 1] !== line) this.history.push(line);
      this.hIdx = this.history.length;
      this.stickToBottom = true;
      this.hooks.onCommand(line);
    } else if (e.ctrlKey && key.toLowerCase() === "c") {
      if (this.input.selectionStart !== this.input.selectionEnd) return; // let the browser copy
      e.preventDefault();
      this.println(...this.promptSegs(), this.input.value + "^C").classList.add("cmd");
      this.input.value = "";
      this.hooks.onCtrlC();
    } else if (e.ctrlKey && key.toLowerCase() === "l") {
      e.preventDefault();
      this.clear();
    } else if (key === "ArrowUp") {
      e.preventDefault();
      if (this.hIdx === this.history.length) this.draft = this.input.value;
      if (this.hIdx > 0) this.input.value = this.history[--this.hIdx];
    } else if (key === "ArrowDown") {
      e.preventDefault();
      if (this.hIdx < this.history.length) {
        this.hIdx++;
        this.input.value = this.hIdx === this.history.length ? this.draft : this.history[this.hIdx];
      }
    } else if (key === "Tab") {
      e.preventDefault();
      const cur = this.input.value;
      const matches = this.hooks.complete(cur);
      if (matches.length === 1) this.input.value = matches[0] + " ";
      else if (matches.length > 1) {
        let p = matches[0];
        for (const m of matches) while (!m.startsWith(p)) p = p.slice(0, -1);
        if (p.length > cur.length) this.input.value = p;
        else {
          this.echo(cur);
          this.println(["  " + matches.map(m => m.split(" ").pop()).join("   "), "c-dim"]);
        }
      }
    } else if (ctrl) {
      return;
    }
  }
}

import Decimal from "break_eternity.js";
type DecimalSource = ConstructorParameters<typeof Decimal>[0];
import type { Notation } from "./core/state";

const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
let notation: Notation = "standard";
export const setNotation = (n: Notation) => (notation = n);

function sci(x: Decimal, places = 2): string {
  const e = x.log10().floor();
  const m = x.div(Decimal.pow(10, e));
  let mant = m.toNumber();
  let exp = e.toNumber();
  if (Number(mant.toFixed(places)) >= 10) { mant /= 10; exp += 1; }
  return `${mant.toFixed(places)}e${exp >= 1e6 ? fmt(exp) : exp}`;
}

/** Formats a number for display. `small` = decimals shown below 1000. */
export function fmt(v: DecimalSource, small = 2): string {
  const x = new Decimal(v);
  if (x.sign < 0) return "-" + fmt(x.neg(), small);
  if (!x.isFinite()) return "∞";
  if (x.lt(1000)) {
    const n = x.toNumber();
    return Number.isInteger(n) ? String(n) : n.toFixed(small);
  }
  if (notation === "scientific") return sci(x);
  const e = Math.floor(x.log10().toNumber());
  const tier = Math.floor(e / 3);
  if (tier < SUFFIXES.length) {
    const m = x.div(Decimal.pow(10, tier * 3)).toNumber();
    const s = m >= 100 ? m.toFixed(1) : m.toFixed(2);
    return `${s}${SUFFIXES[tier]}`;
  }
  return sci(x);
}

/** Integer counts (builds, levels…) with thin grouping. */
export function fmtInt(n: number): string {
  if (n >= 1e9) return fmt(n);
  return Math.floor(n).toLocaleString("en-US").replace(/,/g, " ");
}

export function fmtTime(seconds: number): string {
  if (seconds < 1) return `${seconds.toFixed(2)}s`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(r).padStart(2, "0")}s`;
}

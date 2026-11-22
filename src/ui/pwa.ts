// Installable app (PWA): service worker registration and the browser's install prompt.
// Only on the hosted site (https or localhost): from a file on disk there is nothing to install.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
let onChange: () => void = () => {};

const hosted = () => location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";

/** Running as the installed app, not in a browser tab. */
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** iPhone / iPad Safari: no install prompt, "Add to Home Screen" from the Share menu instead. */
export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** What the Settings can offer: the browser's prompt, the iOS how-to, or nothing. */
export function installMode(): "prompt" | "ios" | "none" {
  if (!hosted() || isStandalone()) return "none";
  if (deferred) return "prompt";
  if (isIOS()) return "ios";
  return "none";
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const ev = deferred;
  deferred = null;
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  onChange();
  return outcome === "accepted";
}

export function initPwa(changed: () => void) {
  onChange = changed;
  if (!hosted()) return;
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => { /* the game works without it */ });
    });
  }
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); // offered from the Settings, never as a pop-up
    deferred = e as InstallPromptEvent;
    onChange();
  });
  window.addEventListener("appinstalled", () => { deferred = null; onChange(); });
}

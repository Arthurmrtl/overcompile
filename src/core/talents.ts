// Release tree: permanent upgrades bought with Stars.
// row/col position the node in the visual tree.

export interface Talent {
  id: string;
  cost: number;
  req: string[];
  row: number;
  col: number;
  icon: string; // short terminal-style tag shown in the tree node
}

export const TALENTS: Talent[] = [
  { id: "warm_cache", cost: 1, req: [], row: 0, col: 2, icon: "inc" },

  { id: "code_review", cost: 1, req: ["warm_cache"], row: 1, col: 1, icon: "rev" },
  { id: "ci_preinstalled", cost: 2, req: ["warm_cache"], row: 1, col: 3, icon: "ci" },

  { id: "monorepo", cost: 4, req: ["code_review"], row: 2, col: 0, icon: "mono" },
  { id: "rust_rewrite", cost: 6, req: ["code_review"], row: 2, col: 1, icon: "rs" },
  { id: "autobuy_cpu", cost: 3, req: ["ci_preinstalled"], row: 2, col: 2, icon: "cpu" },
  { id: "autobuy_ram", cost: 3, req: ["ci_preinstalled"], row: 2, col: 3, icon: "ram" },
  { id: "autobuy_disk", cost: 3, req: ["ci_preinstalled"], row: 2, col: 4, icon: "dsk" },

  { id: "lto", cost: 8, req: ["monorepo"], row: 3, col: 0, icon: "lto" },
  { id: "dist_cache", cost: 12, req: ["rust_rewrite"], row: 3, col: 1, icon: "dst" },
  { id: "autobuy_jobs", cost: 10, req: ["autobuy_cpu"], row: 3, col: 2, icon: "-j" },
  { id: "offline_runners", cost: 5, req: ["autobuy_ram"], row: 3, col: 3, icon: "off" },

  { id: "semver", cost: 25, req: ["lto", "dist_cache"], row: 4, col: 1, icon: "ver" },
  { id: "release_bot", cost: 30, req: ["autobuy_jobs", "offline_runners"], row: 4, col: 3, icon: "bot" },
];

export const TALENT_BY_ID = Object.fromEntries(TALENTS.map(t => [t.id, t]));

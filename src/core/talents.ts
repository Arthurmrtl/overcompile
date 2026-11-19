// Release tree: permanent upgrades bought with Stars.
// row/col position the node in the visual tree (5 columns).

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

  { id: "monorepo", cost: 5, req: ["code_review"], row: 2, col: 0, icon: "mono" },
  { id: "rust_rewrite", cost: 5, req: ["code_review"], row: 2, col: 1, icon: "rs" },
  { id: "offline_runners", cost: 2, req: ["ci_preinstalled"], row: 2, col: 2, icon: "off" },
  { id: "as_perm", cost: 3, req: ["ci_preinstalled"], row: 2, col: 3, icon: "as" },
  { id: "pager", cost: 3, req: ["ci_preinstalled"], row: 2, col: 4, icon: "pgr" },

  { id: "lto", cost: 15, req: ["monorepo"], row: 3, col: 0, icon: "lto" },
  { id: "dist_cache", cost: 15, req: ["rust_rewrite"], row: 3, col: 1, icon: "dst" },
  { id: "as_fast", cost: 3, req: ["as_perm"], row: 3, col: 3, icon: "fast" },
  { id: "as_ctrl", cost: 3, req: ["as_perm"], row: 3, col: 4, icon: "ctrl" },

  { id: "semver", cost: 50, req: ["lto", "dist_cache"], row: 4, col: 1, icon: "ver" },
  { id: "as_jobs", cost: 10, req: ["as_fast"], row: 4, col: 3, icon: "-j" },

  { id: "release_bot", cost: 100, req: ["as_jobs", "offline_runners"], row: 5, col: 2, icon: "bot" },
];

export const TALENT_BY_ID = Object.fromEntries(TALENTS.map(t => [t.id, t]));

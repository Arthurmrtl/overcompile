# Contributing to overcompile

## Setup

```bash
nvm use            # Node 22 (see .nvmrc)
npm install
npm run dev        # http://localhost:5173, hot reload
```

`npm run build` type-checks and produces `dist/index.html`, the whole game in one file.

## Workflow

- `main` is what's deployed: every push on `main` builds a new Docker image and the home server
  picks it up within a few minutes. Don't push directly to it.
- Work on a branch (`feat/challenges-ui`, `fix/offline-report`…) and open a pull request.
  CI must be green (type-check + build) before merging.
- One feature or fix per PR, with a short description of what changes for the player.

## Where things live

| You want to change… | Look at |
|---|---|
| A number (prices, speeds, star curve…) | `src/core/formulas.ts` (`BAL` holds the main knobs) |
| Release tree talents | `src/core/talents.ts` |
| Optimizations (infinite star upgrades) | `src/core/upgrades.ts` |
| Challenges | `src/core/challenges.ts` |
| Achievements / objectives | `src/core/achievements.ts` |
| Game rules (tick, release, offline…) | `src/core/engine.ts` |
| Save format & migrations | `src/core/state.ts` |
| Terminal commands | `src/commands.ts` |
| Layout and rendering | `src/main.ts`, `src/style.css` |
| Any text shown to the player | `src/i18n.ts` |

`src/core/` must stay free of DOM code: it's the game logic, used by the simulation too.

## Rules of thumb

- **Every player-facing string goes in `src/i18n.ts`, in English and French.**
- **Balance changes are checked with the simulation** before merging:
  ```bash
  npm run sim -- 8                           # 8 hours of simulated play
  BAL_releaseGrowth=1.3 npm run sim -- 8     # try a value without editing the code
  ```
  Targets: first star ≈ 25 min, full release tree in 4–6 h.
- **Never break saves.** If the save format changes, bump `SAVE_VERSION` and add a step to
  `migrate()` in `src/core/state.ts`.
- Keep the terminal readable: the journal is for things that matter; decorative output goes to the
  build stream (`term.streamLine`).

## License

GPL-3.0-or-later, like Incrust (the original game). Contributions are accepted under the same license.

# overcompile

An incremental / idle game about compiling stuff — half terminal, half dashboard.
A fork of [Incrust](https://github.com/Antiz96/incrust) by Antiz96, rebuilt for the web.

Compile to earn credits, upgrade your hardware, run builds in parallel, unlock CI/CD to keep
compiling while you're away, then ship a **Release** to reset with ⭐ Stars and grow a permanent
release tree. Everything you can click is also a terminal command.

## Run it

```bash
npm install
npm run dev       # dev server with hot reload
npm run build     # type-check + build dist/index.html (a single self-contained file)
npm run sim       # headless balance simulation (hours as arg: npm run sim -- 8; BAL_<knob>=x to try values)
```

`dist/index.html` works when opened straight from disk, and can be hosted on any static host
(GitHub Pages, Nginx, …). Saves live in `localStorage` (`overcompile-save`), with export/import
in the settings.

## Project layout

```
src/
  core/            game logic, no DOM (portable / testable)
    state.ts       save format, (de)serialization
    formulas.ts    every balance number lives here
    engine.ts      tick, builds, shop, release, offline progress, events
    talents.ts     release tree
    upgrades.ts    optimizations (infinite star upgrades)
    challenges.ts  challenges
    achievements.ts
  commands.ts      terminal commands (UI buttons go through these too)
  ui/terminal.ts   terminal widget (history, Tab completion, Ctrl+C / Ctrl+L)
  main.ts          layout, rendering, game loop
  i18n.ts          English + French strings
scripts/sim.ts     pacing simulation
```

## Content (v0.2.2)

- Hardware: CPU / RAM / Disk (with Incrust's trade-offs) + Jobs (parallel builds, up to 16)
- Perks: CI/CD (idle mode), Auto-Scaling (1 000 cr, buys the cheapest upgrade every 2 s)
- First-run objectives: 9 short goals before the first release, each paying credits (`goals`, rewards collected with a Claim button or `claim`)
- Prestige layer 1 — Release: ⭐ Stars, lifetime bonus; each version needs more credits per star
- Release tree (14 talents), including the Auto-Scaling branch (`as` permanent, `fast` 4×/s,
  `ctrl` per-resource switches, `-j` job slots) and `off` (offline progress)
- Optimizations: infinite star upgrades (rewards, build speed, warm start, offline efficiency/duration)
- Offline progress: the first 5 minutes of absence always count; beyond that it must be unlocked
  (`off`: 10 %, 2 h) and improved with Optimizations
- Challenges (after 3 releases): Single-core, Debug build, Friday deploy, No cache — each grants a
  permanent bonus
- Progressive reveal: stars, the tree (with fog of war), optimizations and challenges — and their terminal commands — appear as they are unlocked
- 29 achievements (+2% rewards each), stats, EN/FR, standard/scientific notation
- v0.1 saves are migrated (old autobuyers become the Auto-Scaling talents)

## Roadmap

- v0.3 — Prestige layer 2: Fork (Contributors, PRs) + `crontab` automation scripting
- v0.4 — Prestige layer 3: Distro (Arch / Debian / NixOS rule sets)

## License

GPL-3.0-or-later, like Incrust. See [LICENSE](LICENSE).

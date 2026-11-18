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
npm run sim       # headless balance simulation of a greedy player (hours as arg: npm run sim -- 4)
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
    achievements.ts
  commands.ts      terminal commands (UI buttons go through these too)
  ui/terminal.ts   terminal widget (history, Tab completion, Ctrl+C / Ctrl+L)
  main.ts          layout, rendering, game loop
  i18n.ts          English + French strings
scripts/sim.ts     pacing simulation
```

## v0.1 content

- Hardware: CPU / RAM / Disk (with Incrust's trade-offs) + Jobs (parallel builds, up to 16)
- Perks: CI/CD (idle mode), Auto-Scaling
- Offline progress (50%, 100% with a talent), capped at 24h
- Prestige layer 1 — Release: ⭐ Stars, lifetime bonus, 14-node release tree, autobuyers, release bot
- 26 achievements (+2% rewards each), stats, EN/FR, standard/scientific notation

## Roadmap

- v0.2 — Challenges (Single-core, Debug build, Friday deploy…), `crontab` automation scripting
- v0.3 — Prestige layer 2: Fork (Contributors, PRs)
- v0.4 — Prestige layer 3: Distro (Arch / Debian / NixOS rule sets)

## License

GPL-3.0-or-later, like Incrust. See [LICENSE](LICENSE).

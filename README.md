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

## Contributing / deploying

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, workflow, where things live, balance rules
- [deploy/README.md](deploy/README.md): Docker image, GitHub Actions, home hosting behind Nginx Proxy Manager

```bash
docker build -t overcompile . && docker run --rm -p 8080:80 overcompile   # → http://localhost:8080
```

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

## Content (v0.5.5)

- Hardware: CPU / RAM / Disk (with Incrust's trade-offs) + Jobs (parallel builds, up to 16)
- Perks: CI/CD (idle mode), Auto-Scaling (buys the cheapest upgrade every 2 s): not sold before the first release (the first run is played by hand), then priced at 25 % of the current release threshold until the permanent `as` talent (10★)
- Prestige layer 1 — Release: ⭐ Stars, lifetime bonus; each version needs more credits per star; generous early star curve (2★ at ×1.6, 3★ at ×2.5, 4★ at ×4…)
- Release tree (15 talents), including the Auto-Scaling branch (`as` permanent, `fast` 4×/s,
  `ctrl` per-resource switches, `-j` job slots, with a player-set priority: save up for the next slot when it costs ≤ N s of income, from the `prio` button on the Jobs card or `autoscale jobs <off|10|30|60|300|always>`) and `off` (offline progress)
- Release advisor: stars/min of the current run; the Release button pulses (and the journal says so) when shipping is worth it
- Optimizations: infinite star upgrades, price ×3 per level (rewards, build speed, warm start, offline efficiency/duration)
- **Fork** (v0.4, second prestige layer, `fork`): once the whole release tree is owned, the Fork tab opens and you can fork the project there. Releases, stars, the release tree, optimizations, challenges and generations reset, and the release threshold starts again at 20K like a new game; you earn **contributors** from the stars earned since the last fork (+3 % per generation in the cycle's best run and +10 % per challenge done). Every contributor ever earned gives rewards ×(1 + 0.25·log2(1 + total)); unspent ones buy **Fork talents** (15, drawn as a tree, never reset): restart boosts (starting stars, hardware levels and release talents, Auto-Scaling from the start, automatic events and generations) and fixed % bonuses (rewards, build speed, stars, contributors), then infinite **Fork upgrades** (Bounties rewards +10 %/level, Mentoring stars +3 %/level). After the first fork, contributors open **pull requests** (`gh pr`): merging one boosts the run until the next release. A fork advisor says when forking is worth it
- **Distro** (v0.5, third prestige layer, `distro`): once the whole Fork tree is owned, publish a distro. The whole Fork layer starts over (forks, contributors, Fork tree and upgrades) plus everything a fork resets, for **packages** (▣), computed from the contributors earned since the last distro. Each Distro cycle runs on a **flavor** picked when publishing: Rolling (releases much faster), Stable (slow releases, more stars and contributors), Source (stronger generations, more build events) or Desktop (better offline progress); finishing a first cycle in each flavor gives its permanent bonus. Packages give a logarithmic passive bonus and buy the **Distro tree** (10 talents, never reset), which gives the Fork tree back step by step, then automates the Fork layer: auto-merged PRs, a **Fork bot** (`forkbot`), maintainers that buy Fork talents, challenges kept across forks. A distro advisor says when publishing is worth it
- Hardware generations (`gen`, inspired by Revolution Idle's ascension), a small prestige inside each run: once CPU, RAM or Disk reaches the required level (25, then ×1.6 each time in the same run), move it to the next generation. It goes back to level 1 for a big bonus until the next release (CPU: builds ×1.12 faster · RAM: rewards ×1.2 · Disk: rewards ×1.08, failures ×0.88); every release resets the generations
- Build events (`events`): every 3–6 min something shows up for 12 s (20 s with the `pgr` talent); click it or type its command for a boost. All positive: coffee break (`coffee`, builds ×2 · 30 s), `cargo update` (+1 min of income), flaky test (`retry`, 0 % failures · 45 s), express code review (`approve`, rewards ×3 · 20 s), merge conflict (`git merge`, every job finishes instantly ×3), CVE patched (`patch`, +5 min of income), prod on fire (`hotfix`, rewards ×7 · 15 s), release candidate (`rc`, +10 % stars on the next release). None offline or during a challenge
- Offline progress: the first 5 minutes of absence always count; beyond that it must be unlocked
  (`off`: 10 %, 2 h) and improved with Optimizations
- Challenges (after 3 releases): Single-core, Debug build, Friday deploy, No cache — each grants a
  permanent bonus
- Progressive reveal: stars, the tree (with fog of war), optimizations and challenges — and their terminal commands — appear as they are unlocked
- Terminal: a short build stream + live status line on top, a readable journal below (commands, events, one summary per minute, income records); 3 log levels
- 61 achievements in tiered chains, never reset; the Achievements tab shows rewards to claim, then the next tier of each chain with its progress. Each pays a reward claimed whenever you want (`claim`): credits early, permanent bonuses later (+x% rewards / speed / stars, −x% failures)
- Mobile: bottom tab bar; the on-screen keyboard only opens when you tap the prompt, and the terminal takes the full height while typing
- Stats, EN/FR, standard/scientific notation
- v0.1 saves are migrated (old autobuyers become the Auto-Scaling talents); v0.2 saves start with every hardware at generation 0

## Roadmap

- v0.4 — Prestige layer 2: Fork (Contributors, PRs) + `crontab` automation scripting
- v0.5 — Prestige layer 3: Distro with flavors and Fork automation (v0.5.0), the fork moved to the Fork tab (v0.5.1), a two-line mobile header (v0.5.2), an installable app (PWA, v0.5.3), no more save button since the game autosaves (v0.5.4), the terminal's return key on iPhone (v0.5.5), then `crontab` and Distro achievements (v0.5.6)

## License

GPL-3.0-or-later, like Incrust. See [LICENSE](LICENSE).

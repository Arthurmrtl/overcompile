# CLAUDE.md : contexte du projet overcompile

Ce fichier donne à Claude (et aux humains) le contexte du projet : ce qu'est le jeu, les choix déjà faits et pourquoi, l'architecture, et ce qui reste ouvert. Lis-le en entier avant de toucher au code. Les décisions marquées **Tranché** ont été prises par Arthur (le mainteneur) après des tests en jeu : ne les remets pas en cause sans qu'on te le demande.

## Le projet en bref

- **overcompile** est un jeu incrémental (« idle ») dans le navigateur, sur le thème de la compilation logicielle : on lance des builds, on gagne des crédits, on achète du matériel (CPU, RAM, Disk, Jobs), puis on fait des « releases » (prestige) qui rapportent des **étoiles**.
- C'est un fork d'**Incrust** (https://github.com/Antiz96/incrust), un jeu en Rust dans le terminal. Licence **GPL-3.0-or-later**, héritée d'Incrust. Le lien vers Incrust reste visible dans le jeu (pied de page).
- Ambition : un jeu jouable par tout le monde, « pas une pâle copie » d'Incrust.
- **Tranché :** 100 % web, aucune monétisation pour l'instant (ni pub, ni achats, ni Steam/mobile). On verra plus tard.
- **Tranché :** interface **hybride**, avec un vrai terminal où l'on tape des commandes et des panneaux cliquables à côté. Tout doit pouvoir se faire à la souris, et le terminal reste le cœur de l'identité du jeu.
- Langues : anglais et français (le public visé est mondial). Le mainteneur parle français ; les messages de commit, le code et les commentaires sont en anglais.

## Démarrer

```bash
npm ci
npm run dev          # serveur de dev Vite
npm run build        # tsc + vite build → dist/index.html (fichier unique autonome)
npm run sim -- 6     # simulation d'équilibrage sur 6 h de jeu (voir plus bas)
```

Node 22 (`.nvmrc`). Pas de framework UI : TypeScript pur + DOM.

## Architecture

```
src/
  core/            logique de jeu pure, SANS DOM (testable, simulable)
    state.ts         GameState, sérialisation, SAVE_VERSION, migrate()
    formulas.ts      toutes les formules (prix, temps de build, échecs, gains, étoiles) + BAL
    engine.ts        Engine : tick, compile, autoScale, achats, release, challenges, hors ligne ; émet des événements
    talents.ts       arbre de release (15 talents, payés en étoiles)
    upgrades.ts      optimisations rachetables à l'infini (étoiles, coût ×3 par niveau)
    advisor.ts       conseillers de release (étoiles/min), de fork (contributeurs/h) et de distro (paquets/h)
    fork.ts          couche Fork : contributeurs, arbre Fork, pull requests, réglages FORK
    distro.ts        couche Distro : paquets, saveurs, arbre Distro, réglages DISTRO
    challenges.ts    4 challenges (releases sous contrainte → bonus permanent)
    events.ts        événements de build (liste, poids, effets, délais)
    achievements.ts  68 succès, avec récompense à récupérer
  ui/terminal.ts   widget terminal (flux de build, ligne de statut, journal, prompt, historique, Tab)
  commands.ts      toutes les commandes du terminal
  main.ts          mise en page, rendu des panneaux, journal d'événements, boucle (100 ms), GAME_VERSION
  i18n.ts          dictionnaires EN/FR
  format.ts        formatage des nombres (notations)
  style.css        thème sombre type terminal
scripts/sim.ts     simulateur d'équilibrage (headless)
```

Règles d'architecture :
- `src/core` ne touche **jamais** au DOM. L'UI écoute les événements de l'`Engine` (`builds`, `pipeline_done`, `release`, `achievement`, `autobuy`, `challenge_*`, `generation`, `event_*`, `fork`, `fork_talent`, `pr_open`, `pr_merged`…).
- Les grands nombres utilisent **break_eternity.js** (`Decimal`). Ne mélange pas `number` et `Decimal` pour les crédits ou les gains.
- **Chaque texte affiché passe par `i18n.ts`**, en EN **et** en FR. Pas de chaîne en dur dans l'UI.
- Le build produit **un seul fichier HTML** (`vite-plugin-singlefile`) : pas d'assets externes ni de CDN.

## Sauvegarde : à ne pas casser

- Stockage dans `localStorage`, clé `overcompile-save`. Sauvegarde automatique ; export/import en texte dans les paramètres.
- `SAVE_VERSION` vaut actuellement **10**. Si tu changes la forme de `GameState` :
  1. incrémente `SAVE_VERSION` ;
  2. ajoute une étape dans `migrate()` qui convertit les anciennes sauvegardes ;
  3. vérifie qu'une sauvegarde de la version précédente se charge sans perte.
- Des joueurs (dont Arthur) ont des parties en cours : une sauvegarde perdue est un bug bloquant.

## Mécaniques actuelles (v0.5.1)

**Boucle de base.** Un build prend ~5 s et peut échouer (25 % au départ). Les Jobs exécutent plusieurs builds en parallèle. Matériel :
- CPU : builds plus rapides, mais plus d'échecs ;
- RAM : gains plus élevés, builds légèrement plus lents ;
- Disk : moins d'échecs, gains légèrement plus faibles ;
- Jobs : builds en parallèle (max 16).

**Cache du Disk (v0.4.7, Arthur : « réactiver le disque fait perdre des cr/s, c'est bizarre »).** Le taux d'échec a un plancher à 1 % ; au-delà, chaque niveau de Disk ne faisait plus que −0,3 % de gains, et l'Auto-Scaling (le moins cher d'abord) en achetait quand même. Désormais le surplus de fiabilité sous le plancher (en « niveaux de Disk » équivalents, `diskSurplus()`) devient un bonus de gains ×1,004 par niveau (`BAL.diskCache`, affiché « cache ×N » sur la carte Disk). Simulation (3 runs de 8 h) : arbre 3 h 00–3 h 04 et cycles de fork inchangés ; ~680 contributeurs en 8 h, contre ~630 pour un joueur qui arrête d'acheter du Disk au plancher et ~455 pour celui qui en achète sans réfléchir. Avec ×1,008, les contributeurs des forks tardifs doublaient.

Perks de boutique :
- **CI/CD** à 10 crédits : relance automatique des builds. **Tranché :** reste à 10.
- **Auto-Scaling** : achète automatiquement le matériel le moins cher. **Tranché (v0.3.2, Arthur et son ami voulaient retarder l'autobuy) :** pas en vente avant la 1re release (la 1re run se joue à la main), puis prix = 25 % du seuil de release en cours (`AS_PRICE_SHARE`, ~6 000 cr après la 1re release), racheté à chaque run jusqu'au talent permanent `as`, passé de 3★ à 10★. Simulation : la 1re étoile ne bouge pas (~22 min, achats à la main toutes les ~4 s), Auto-Scaling acheté vers 33–39 min, arbre complet 3 h 05–3 h 30. Avant ça, il coûtait 1 000 cr dès la 1re run.

**Release (prestige).** Le seuil de base est de 20 000 crédits gagnés dans la run, multiplié par 1,2 à chaque release. Étoiles gagnées :
`floor(max(1 + 1,5·log2(ratio), ratio^0.36) × multiplicateurs)`, où `ratio = gagné / seuil`.
La courbe est volontairement généreuse au début : 2★ à ×1,6 le seuil, 3★ à ×2,5, 4★ à ×4. Le terme `ratio^0,36` est devenu `ratio^0,25` en v0.4.1 (voir Fork). Les étoiles gagnées au total donnent aussi un bonus permanent de gains (`1 + 0,25·total^0,35` ; c'était `√total` avant la v0.2.8, ce qui faisait exploser la fin de partie).

**Conseiller de release** (`src/core/advisor.ts`, v0.2.8). Constat d'Arthur à 6 h 19 de jeu : il s'ennuyait, ses runs duraient ~1 h et il n'avait jamais fait de challenge. Les étoiles d'une release montent de plus en plus lentement, donc garder une run trop longtemps fait perdre du temps, et le jeu ne le disait pas. Le conseiller calcule les étoiles par minute de la run (sur 5 min minimum) et conseille de publier quand ce rythme retombe sous 90 % de son meilleur niveau, ou quand la release ajoute au moins 50 % des étoiles déjà gagnées. Le bouton Release ne clignote plus que dans ce cas ; il y a aussi un badge sur l'onglet, un point sur mobile et une ligne dans le journal. La simulation suit ce conseiller : c'est le rythme d'un joueur qui écoute le jeu. **Tranché (v0.4.4, Arthur) :** plus d'encart « N challenge(s) à faire » dans l'onglet Release (il gênait la lecture) ; il reste la ligne `[ TIP ]` dans le journal et le badge de l'onglet Challenges.

**Tranché :** la monnaie de prestige reste les « étoiles ». Ne pas la renommer.

**Découverte progressive.** Avant la 1re release, le joueur ne voit que l'objectif (« Publier v1.0.0 → ??? ») : ni étoiles, ni arbre, ni optimisations. Les challenges apparaissent après 3 releases. Une commande pas encore débloquée répond `bash: X: command not found`. L'arbre a un « brouillard » : seuls les talents adjacents à ceux qu'on possède sont visibles, et l'arbre ne prend que la hauteur des rangées visibles (v0.3.4, sinon gros vide sur mobile). Ne divulgue rien de verrouillé (UI, aide, `guide`, succès cachés).

**Arbre de release (talents).** 15 talents, du premier (`inc`, Cache chaud, 1★) au dernier (`bot`, Release bot, 100★). Ils sont identifiés par des **tags texte**, et **Tranché :** pas d'emojis dans l'arbre (« ça fait gamin / IA »). Même chose pour les succès depuis la v0.3.5 (Arthur : « moins IA slop ») : tags `[ ]` à faire, `[!]` à récupérer, `[✓]` récupéré, `[?]` secret, et `[ ACH ]` dans le journal. Les autres emojis de l'interface (💾 ⚙ 🔒 ⭐, icônes des événements) restent pour l'instant.

Branche Auto-Scaling :
- `as` (10★ depuis la v0.3.2) : Auto-Scaling permanent (conservé après une release) ;
- `fast` : 4 passages par seconde au lieu d'un toutes les 2 s ;
- `ctrl` : cases AUTO, pour choisir quelles ressources l'Auto-Scaling achète ;
- `-j` : l'Auto-Scaling gère aussi les Jobs. Il en achète d'abord autant que possible, puis dépense le reste en CPU/RAM/Disk. **Tranché (v0.3.3, option choisie par Arthur) :** un seuil réglé par le joueur (`jobsPrio`, en secondes de revenu) fait économiser pour le prochain slot quand il coûte au plus ce temps de revenu. **Tranché (v0.4.10, Arthur : « pas suffisant ») :** menu natif sur la pastille `prio … ▸` de la carte Jobs avec jamais, 1 s, 5 s, 10 s, 30 s, 1 min, 5 min, toujours, et « autre… » pour n'importe quelle valeur ; commande `autoscale jobs <off|secondes|always>` (visible seulement avec `-j`). Barre « épargne pour le job N ». Défaut : jamais, parce que la simulation montre qu'économiser ne fait jamais gagner (chaque slot coûte ×5 le précédent pour un gain linéaire ; 16 jobs atteints vers 3 h 30 sans épargne ; 30 s retarde l'arbre de ~10 min, 5 min de ~2 h). C'est une préférence de joueur, pas une optimisation. Sim : `JOBSPRIO=<s>`.

Ces talents remplacent les anciens autobuyers par ressource, qui faisaient doublon avec l'Auto-Scaling.

**Optimisations** (étoiles, coût ×3 à chaque niveau depuis la v0.2.8, rachetables à l'infini) : gains, vitesse, boot (+3 niveaux de matériel au début de chaque run), efficacité hors ligne, durée hors ligne. Elles existent parce qu'après l'arbre, les étoiles s'accumulaient sans rien sur quoi les dépenser.

**Générations de matériel** (commande `gen`, inspirées de l'Ascension de Revolution Idle). **Tranché (v0.4.5, Arthur) : c'est un petit prestige à l'intérieur de la run.** Quand le CPU, la RAM ou le Disk atteint le niveau requis (25, puis ×1,6 à chaque génération de la même run : 25, 40, 65, 100…), on peut le passer à la génération suivante : il **repart au niveau 1** contre un gros bonus jusqu'à la prochaine release (CPU builds ×1,12 plus rapides, RAM gains ×1,2, Disk gains ×1,08 et échecs ×0,88). **Chaque release (et chaque fork ou début de challenge) remet les générations à zéro.** Visibles après la 1re release. Réglages : `BAL.gen*`. Le simulateur les prend dès qu'elles sont disponibles (`NOGEN=1` pour les désactiver).
- Pourquoi : Arthur voulait « le même principe que la release ou le fork, mais avec les ressources », et garder les générations entre les releases n'était pas « smart » : elles s'empilaient sans aucune décision. Condition posée : **ne changer ni le temps de la 1re release, ni le temps pour finir l'arbre, ni les premiers forks, et ne pas s'ennuyer plus** (« ce genre de jeu fonctionne sur la dopamine et le sentiment de puissance »).
- Simulation v0.4.5 (3 runs de 8 h, référence v0.4.4 entre parenthèses) : 1re étoile 19–22 min (16–20), arbre complet 3 h 02–3 h 07 (2 h 43–3 h 15), contributeurs par fork +5, +6, +11, +23, +40 (+5, +7, +13, +25, +33), cycles de fork ~35 min comme avant. Générations par run : 3 dès la 2e run (1re génération vers 25–35 min au lieu de 1 h 05), 8–11 en fin d'arbre. Sans générations, l'arbre prend 3 h 30. Réglages essayés : seuil 20 et ×1,3 (RAM ×1,25) → arbre en 2 h 25 et forks qui s'emballent (1 800 contributeurs par fork) ; seuil 20 et ×1,6 (RAM ×1,2) → 2 h 18–2 h 57.
- Le reset au niveau 1 ne coûte presque rien (les prix sont exponentiels : racheter tous les niveaux ≈ 4–5 fois le dernier, l'Auto-Scaling le fait en quelques secondes). La « puissance » vient donc du bonus, et le seuil qui grimpe vite (×1,6) empêche la boule de neige.
- Historique : v0.3.0 seuil 75 et bonus permanents (×1,15 / ×1,3 / ×1,15) ; v0.3.6 seuil 45 et bonus réduits, toujours permanents, car « quasi inexploitable ». Les sauvegardes v7 gardent leurs générations jusqu'à la prochaine release (`SAVE_VERSION` 8 : `stats.gensTotal` pour les succès, `stats.bestRunGens` pour les contributeurs).
- Liens avec Fork : `mir` (Miroirs) demande 20 % de niveaux en moins, `rnv` (Renovate) les fait toutes seules ; les contributeurs gagnent +3 % par génération de la meilleure run du cycle.

**Événements de build** (`src/core/events.ts`, v0.3.1, façon « golden cookie »). Une fois la CI/CD active, un événement apparaît toutes les 3 à 6 minutes et reste 12 s : une pastille en haut de l'écran (visible quel que soit l'onglet) et une ligne `[ EVENT ]` dans le journal. On l'attrape en cliquant ou en tapant sa commande. **Tranché par Arthur :** tous positifs (pas de pénalité, la CVE est « CVE patchée ») et **pas d'option pour les désactiver**. Liste : Pause café `coffee` (builds ×2, 30 s), `cargo update` (+1 min de revenu), Test instable `retry` (0 % d'échec, 45 s), Code review express `approve` (gains ×3, 20 s), Conflit de merge `git merge` (tous les jobs terminent instantanément, 3 fois), CVE patchée `patch` (+5 min de revenu), Prod en feu `hotfix` (gains ×7, 15 s, rare), Release candidate `rc` (+10 % d'étoiles sur la prochaine release, rare, après la 1re release). Rien hors ligne ni pendant un challenge. Talent `pgr` (Astreinte, 3★, après `ci`) : fenêtre de 20 s et événements 25 % plus fréquents. Succès : 10 / 100 / 500 événements attrapés. La commande `events` les liste. Simulation : le joueur simulé en attrape 70 % (`EVENTS=0..1`, `NOEVENTS=1` pour les couper) ; arbre complet ~3 h 15–3 h 25 contre 3 h 35 sans, 1re étoile inchangée.

**Fork** (`src/core/fork.ts`, v0.4, 2e couche de prestige). **Tranché (Arthur) :**
- Condition : **arbre de release complet** (les 15 talents). Teaser « Fork → ??? · termine l'arbre de release » dans l'onglet Release dès que le dernier talent (`bot`) est visible, et seulement avant le 1er fork. **Tranché (v0.5.1, Arthur : forker se faisait dans l'onglet Release mais la Distro dans l'onglet Distro, pas clair) :** l'onglet Fork s'ouvre dès que l'arbre de release est complet, et c'est **là** qu'on forke (carte, bouton, calcul des contributeurs, conseiller), comme pour la Distro. Avant le 1er fork, il ne montre que la carte, l'arbre Fork et les améliorations : ni résumé ni PR. Badge `!` sur l'onglet quand le conseiller dit de forker. Astuce « forkready » à l'ouverture.
- Forker remet à zéro crédits, matériel, releases, étoiles (dont le total, qui sert au calcul), arbre de release, optimisations, challenges et générations. Restent : contributeurs, arbre Fork, succès, stats d'événements, paramètres. Fenêtre de confirmation, commande `fork --yes`.
- **Tranché (v0.4.1) : un fork ramène aux conditions du début du jeu**, avec en plus les améliorations de Fork. Le seuil de release repart à 20K puis ×1,2 par release, comme au début : **il ne faut pas que le jeu devienne plus dur** après un fork. La v0.4.0 multipliait le seuil par 10 à chaque fork ; Arthur l'a refusé. Pas de plafond d'étoiles par release non plus (« ça traduit un problème de fonctionnement ou d'équilibrage »).
- **Contributeurs** = f(étoiles gagnées depuis le dernier fork), sur le modèle des étoiles : `max(1 + 2·log2(étoiles/200), (étoiles/200)^0,6)`, ×(1 + 3 % par génération de la meilleure run du cycle) ×(1 + 10 % par challenge fait dans le cycle). Le total gagné donne un bonus permanent **logarithmique** : gains ×(1 + 0,25·log2(1 + total)). Les non dépensés achètent l'arbre Fork.
- **Pourquoi c'est logarithmique et pourquoi l'arbre Fork ne multiplie presque rien** (v0.4.1) : avec des multiplicateurs (gains ×(1 + 0,4·total^0,8), Sponsors ×2, Benchmarks ×1,5, Awesome ×1,5) et le seuil remis à 20K, tout faisait boule de neige (plus de gains → plus d'étoiles → plus de contributeurs → cycle plus court) : cycles de 3 h → 20 min → 5 min → 1 min, même avec un bonus divisé par 20. La couche Fork accélère donc le **redémarrage** (étoiles, niveaux, talents, automatisation au départ) plutôt que la vitesse de croisière.
- Même cause côté releases : l'exposant de la courbe d'étoiles pour les très grosses runs passe de 0,36 à **0,25** (`BAL.starExp`). Avec 0,36, la fin de l'arbre s'emballait déjà sans fork (+56 → +47 000★ par release en 1 h 30) ; avec 0,25 : +115 → +434★, arbre toujours fini vers 2 h 40–3 h 10, 1re étoile inchangée.
- **Arbre Fork** (15 talents, 1 à 13 contributeurs, 66 au total, jamais remis à zéro), **dessiné en arbre** comme l'arbre de release (demande d'Arthur). **Tranché (v0.4.4, Arthur) :** même brouillard que l'arbre de release (`forkTalentVisibility`) : il se découvre au fil des achats, le reste est en `???` ou caché, y compris dans `fork tree`. **Tranché (Arthur) :** deux familles qui alternent dans l'arbre, des accélérateurs de redémarrage et des bonus en % **fixes** (achetés une fois, ils ne grossissent pas avec le nombre de contributeurs, d'où pas de boule de neige) :
  - redémarrage : `tpl` 10★ au départ de chaque fork ; `iac` Auto-Scaling achetable dès le début d'un fork, au prix normal (25 % du seuil, ~5 000 cr ; **Tranché v0.4.7, Arthur :** à 1 000 cr il « tuait rapidement les actions manuelles ». Sim : 5–7 min d'achats à la main après le 1er fork, puis ça fond avec `oc`/`spn` et disparaît avec `kp` vers le 4e fork, volontairement : l'automatisation est la récompense) ; `spn` chaque run commence avec +10 niveaux de CPU/RAM/Disk ; `lts` seuil ×1,15 par release au lieu de ×1,2 ; `mir` générations à 20 % de niveaux en moins (v0.4.5 ; gardait la moitié des générations quand elles étaient permanentes) ; `rnv` (Renovate, 5 ⑂, après `mir`, v0.4.9, demande d'Arthur) génère tout seul dès que possible, avec une case AUTO par matériel sur la ligne Gén. (`s.autogen`, commande `gen auto <cpu|ram|disk>`) ; les générations automatiques vont au journal sans toast. Sim : rythme inchangé (la sim générait déjà dès que possible), arbre Fork complet un fork plus tard ; `bin` chaque fork commence avec `inc`, `rev` et `ci` ; `dpb` attrape seul les événements courants ; `kp` garde les talents CI et Auto-Scaling ; `awe` +2★ par release ; `ups` +2 contributeurs par fork ;
  - en % : `oc` gains +50 % ; `cdn` builds +25 % plus rapides ; `hn` étoiles +15 % ; `sig` contributeurs +10 % à chaque fork.
  - Identifiants internes gardés depuis la v0.4.0 (`f_sponsors`, `f_bench`… même si l'effet a changé) ; les prérequis ont changé avec le nouvel arbre.
- **Améliorations Fork** (infinies, en contributeurs, prix ×2,5 par niveau, `fork upgrade <bounties|mentoring>`) : Bounties gains +10 %/niveau (3 ⑂ au départ), Mentorat étoiles +3 %/niveau (5 ⑂). Elles donnent un usage aux contributeurs une fois l'arbre Fork complet.
- **Pull requests** (après le 1er fork) : une PR s'ouvre toutes les 600 s / (1 + 0,5·log2(1 + contributeurs gagnés)), 3 ouvertes au maximum, ni hors ligne ni en challenge. Fusionner (`gh pr merge <n>` ou bouton) donne un bonus jusqu'à la prochaine release : perf builds ×1,2, feat gains ×1,25, ci étoiles ×1,05 ; docs donne +2 min de revenu. Fusionner est gratuit et **ne rapporte jamais de contributeurs** (seul le fork en donne).
- **Détail du calcul** (v0.4.6, Arthur : « on ne comprend pas comment est calculé le nombre de contributeurs » ; **v0.4.8** : la ligne unique était « moche et peu compréhensible », c'est maintenant un petit tableau « Calcul des contributeurs », une ligne par facteur, avec la valeur exacte avant l'arrondi) : sous le bouton Fork, `contributorBreakdown()` montre les étoiles du cycle → la base, ×générations de la meilleure run, ×challenges, `sig`, `ups`, le total, et les étoiles qu'il faut pour le contributeur suivant (comme « Prochaine ⭐ à … » pour les releases).
- **Conseiller de fork** : contributeurs par heure du cycle (30 min minimum), conseille quand le rythme baisse ou quand le fork double les contributeurs gagnés. Bouton qui clignote, ligne `[ FORK ]` dans le journal.
- Onglet Fork (ouvert quand l'arbre de release est complet), compteur `⑂` dans l'en-tête, 7 succès Fork, lignes de stats.
- Simulation v0.4.1 (`npm run sim -- 10`, 3 runs ; le joueur forke quand le conseiller le dit, fusionne toutes les PR, achète les talents Fork puis les améliorations) : 1er fork vers 3 h 10–3 h 20 avec 5–6 contributeurs ; 2e cycle 35–45 min, 3e ~22 min, ensuite cycles stables de 33–36 min ; contributeurs par fork en hausse lente (5 → 12 → 24 → 30 → 50 → 75 au 12e fork) ; arbre Fork complet au 5e fork (~5 h 20), puis ~1 niveau d'amélioration Fork par fork. Options : `NOFORK=1`, `FORK_<clé>=valeur`, `FADV_<clé>=valeur`.
- `crontab` : prévu en talent final de l'arbre Distro (v0.5.2).

**Distro** (`src/core/distro.ts`, v0.5, 3e couche de prestige). **Tranché (Arthur, 21/11/2026, Whiteboard « overcompile v0.5 — Distro ») :** concept C, « Distro avec saveurs » (en jeu : **« Base » en FR** depuis la v0.5.1, « saveur » sonnait faux ; « Flavor » en EN ; le code garde `flavor`) ; monnaie **▣ Paquets** (« Utilisateurs » était trop proche de « contributeurs ») ; « en avançant, le pain devient automatique » : la 3e couche automatise la 2e, comme le Release bot l'a fait pour les releases.
- Condition : **arbre Fork complet** (les 15 talents). Avant, un teaser « Distro → ??? » dans l'onglet Fork (à partir de 10 talents Fork). L'onglet Distro (couleur cyan, compteur ▣ dans l'en-tête) s'ouvre quand l'arbre est complet.
- Publier une distro remet à zéro toute la couche Fork (forks du cycle, contributeurs, `lifetimeContributors`, arbre et améliorations Fork, PR) et tout ce qu'un fork remet à zéro. Restent : paquets, arbre Distro, saveurs terminées, succès, paramètres. `s.forks` reste un compteur global (onglet Fork, PR).
- **Paquets** = f(contributeurs gagnés depuis la dernière distro), même modèle : `max(1 + 2·log2(C/60), (C/60)^0,6)` (×1,2 avec `pkg`, +1 avec `ups`). Bonus passifs **logarithmiques** : contributeurs ×(1 + 0,2·log2(1 + total ▣)), gains ×(1 + 0,5·log2(1 + total ▣)) (0,25 en v0.5.0). Tableau « Calcul des paquets » comme pour les contributeurs.
- **Saveurs** (choisie en publiant, pour le cycle suivant ; le 1er cycle n'en a pas) :
  - Rolling `[arch]` : seuil de release −0,1 par release (×1,1 au lieu de ×1,2) ;
  - Stable `[debian]` : seuil +0,1 (×1,3), étoiles ×1,5, contributeurs ×1,2 ;
  - Source `[gentoo]` : générations comptées ×1,25 (exposant), événements ~2× plus fréquents (écart ×0,6) ;
  - Desktop `[ubuntu]` : hors ligne +50 points d'efficacité, durée ×2.
  Terminer un cycle dans une saveur (publier la distro suivante) donne son **bonus permanent** : Rolling seuil −0,01 ; Stable étoiles +10 % ; Source générations à ×0,9 niveau ; Desktop hors ligne +25 points. Équilibrage en jeu actif (sim 16 h, une seule saveur) : Rolling 79–82 ▣, Stable 88–89, Source 83–89 ; Desktop 64 (fait pour le hors ligne, que la sim ne joue pas). Première version : Source à ×1,5 et événements ×2 → 127 ▣, trop fort ; Rolling −0,07 et étoiles ×0,8 → aucun gain.
- **Première distro = vrai reset. Tranché (v0.5.1, Arthur : « c'est pas un peu nimp qu'après un reset […] tu partes déjà avec un arbre fork à moitié plein ? ») :** la v0.5.0 offrait `rst` à la 1re distro (5 talents Fork gardés dès ce reset) ; retiré. `rst` acheté après une distro ne joue qu'à partir de la suivante. La puissance vient de la reconstruction : bonus de gains des paquets doublé (`gainsLog` 0,25 → 0,5, ×1,79 avec 2 ▣). Sim (3 × 16 h) : 2e cycle 1 h 23–1 h 43 (1er fork ~45 min au lieu de 3 h, puis forks de 10–20 min, arbre Fork en ~5 forks), puis ~1 h 06 ; paquets à la 10e distro 15–16 (15 avant). Essais écartés : cadeau `rst` 1 h 05–1 h 14 ; sans rien 1 h 41–1 h 58 ; `contribLog` 0,6 → 1 h 29–1 h 37 mais 20–26 ▣ tardifs ; `contribBase` 40 → 1re distro retardée (5 h 40).
- **Arbre Distro** (10 talents, 1 à 10 ▣, dessiné, même brouillard) : `rst` garde les talents Fork de redémarrage (tpl, iac, spn, lts, bin) ; `mrg` les PR se fusionnent seules ; `pkg` paquets +20 % ; `fbot` **Fork bot** (forke seul à un seuil de ⑂ réglé, ou quand le conseiller le dit si seuil 0 ; réglages dans l'onglet Distro et commande `forkbot <on|off|advisor|N>` ; les forks du bot vont au journal, sans bannière ni toast) ; `kpa` garde aussi kp, dpb, rnv, mir ; `ctb` contributeurs +25 % ; `abuy` les contributeurs achètent seuls talents puis améliorations Fork ; `chk` les challenges restent faits d'un fork à l'autre ; `all` garde tout l'arbre Fork et les améliorations ; `ups` +1 paquet par distro.
- **Conseiller de distro** : paquets/heure du cycle (60 min minimum), conseille quand le rythme baisse ou quand la distro double les paquets gagnés. Badge sur l'onglet, ligne `[ DISTRO ]`.
- Commandes : `distro` (état et saveurs), `distro tree`, `distro buy <tag>`, `distro <rolling|stable|source|desktop> --yes`, `forkbot`. Astuces du tuto : ouverture de l'onglet Distro, 1re distro.
- Sauvegarde v10 : `distros`, `packages`, `lifetimePackages`, `distroTalents`, `flavor`, `flavorsDone`, `autoFork`, stats `distroTime`, `fastestDistro`, `allContributors`.
- Simulation v0.5.0 (3 runs de 16 h ; le joueur publie quand le conseiller le dit, essaie chaque saveur une fois puis prend Stable) : rien ne change avant la Distro (1re étoile 20–22 min, arbre 3 h 00–3 h 02) ; arbre Fork complet et 1re distro 4 h 53–5 h 17 (le vrai jeu d'Arthur : arbre Fork à 8 h 45) ; 2e cycle 1 h 23–1 h 43 depuis la v0.5.1 (vrai reset, `gainsLog` 0,5), puis cycles stables d'~1 h 06 ; paquets par distro 1–2 → 15, pas d'emballement ; arbre Distro complet vers la 6e distro. Options : `NODISTRO=1`, `FLAVOR=<id>` (toujours la même saveur), `DISTRO_<clé>=valeur`, `DADV_<clé>=valeur`.
- Pas encore fait : `crontab` (v0.5.2, talent final de l'arbre Distro), succès Distro.
- Une seule saveur active par cycle ; seuls les bonus permanents se cumulent. Idée à l'étude : talent tardif « Dual boot » (2 saveurs actives).

**Hors ligne.** Les 5 premières minutes d'absence comptent toujours à 100 %, pour couvrir un téléphone en veille ou un changement d'onglet. Au-delà, rien sans le talent `off` (10 % d'efficacité, 2 h max), qu'on améliore ensuite avec des optimisations (jusqu'à 100 % et 24 h). **Tranché :** c'est volontairement faible au début.

**Challenges** (débloqués après 3 releases) : Single-core, Debug build -O0, Friday deploy, No cache. Ce sont des releases sous contrainte qui donnent un bonus permanent. Quitter un challenge en cours de run rend les perks que les talents donnent (CI/CD avec `ci`, Auto-Scaling avec `as`) : avant la v0.4.2, sortir de No cache laissait la run sans CI/CD jusqu'à la release suivante.

**Succès.** 68 succès qui fusionnent les anciens « objectifs » et « succès ». **Tranché** (idée d'Arthur) :
- jamais remis à zéro ;
- récompense à récupérer quand on veut (bouton Claim, commande `claim`) ;
- petites sommes en crédits au début, puis bonus permanents du type « +2 % de gains » ;
- un seul onglet Succès : « À récupérer » puis « Tous les succès ». **Tranché (v0.3.5) :** plus de liste « En cours » séparée (doublon, selon Arthur) ; chaque carte de succès pas encore obtenu porte sa barre de progression, et la grille est triée : en cours (les plus proches d'abord), puis à récupérer, récupérés, secrets. Pas d'affichage en double.

**Console.** Elle doit être avant tout **satisfaisante et informative, pas verbeuse**. On a en haut un flux de build décoratif (lignes façon `cargo`, 5 max) et une ligne de statut en direct. En bas, un journal lisible : résumés par minute, records, bannières. Trois niveaux de verbosité dans les paramètres. Les toasts sont limités à 3 à la fois. **Tranché (v0.4.8, Arthur : « les pop up sur téléphone c'est relou, ça bloque ») :** sur mobile, une ligne compacte juste au-dessus de la barre d'onglets, 2 au maximum, 2,5 s, et ils disparaissent dès qu'on touche l'écran. **Tranché (v0.4.14, Arthur : « aussi gênants sur PC ») :** pareil sur PC, en bas à droite (plus en haut, sur les onglets du volet), et ils disparaissent au moindre clic.

**Mobile.** Sur écran tactile, le jeu ne place jamais le curseur dans le terminal tout seul : le clavier ne s'ouvre que si on touche la ligne du prompt. Pendant la saisie, la barre d'onglets et le bloc Pipeline sont masqués pour laisser toute la hauteur au terminal. La hauteur suit la zone réellement visible (`100dvh` + `visualViewport`), y compris avec la zone du geste d'accueil sur iPhone.

**Tranché (v0.4.3, Arthur) :** la barre d'onglets du bas sur mobile n'a plus d'emojis (« IA slop ») : icônes au trait en SVG (`NAV_ICONS` dans `main.ts`, couleur du thème). Le 3e onglet s'appelle **Progression / Progress** et plus « Release », car il contient aussi Challenges, Fork, Succès et Stats.

**Colonnes redimensionnables (PC seulement, v0.4.11, Arthur : « le volet de droite est un peu serré » une fois qu'on forke).** Poignées entre les colonnes (boutique | terminal | volet de droite) : on glisse pour élargir, double-clic = normal ⇄ large (420 / 620 px). Largeurs gardées dans `localStorage` (`overcompile-layout`, préférence d'UI, hors sauvegarde), bornées pour laisser au moins 360 px au terminal, re-bornées si la fenêtre rétrécit. Les arbres sont plafonnés à 460 px de large pour ne pas grossir avec le volet. Rien ne change sur mobile. Les fenêtres déplaçables façon bureau ont été écartées (refonte, contre « on garde l'UI actuelle »).

**Tuto et astuces (v0.4.12, Arthur : « un tuto skippable, des pop-ups explicatives », PC et mobile ; `src/ui/tutorial.ts`).** Option choisie : tuto interactif au début + astuces au déblocage.
- Tuto (nouvelle partie) en 6 étapes, chacune pointe un élément (contour violet) et attend l'action : bienvenue → compiler jusqu'à pouvoir acheter → acheter du matériel → compiler jusqu'à 10 cr → CI/CD → objectif v1.0.0. Les étapes 2 et 4, qui attendent des crédits, ont une barre de progression « x / objectif cr » (v0.4.13, demande d'Arthur). Une étape n'avance que quand la suivante est possible (sur mobile, on n'est jamais envoyé dans une boutique qu'on ne peut pas payer). Sur mobile, le tuto change d'onglet tout seul ; la bulle est en bas, au-dessus de la barre d'onglets (les toasts sont masqués pendant ce temps).
- Astuces, une seule fois, au moment du déblocage : 1re release (étoiles, arbre, Auto-Scaling), 1er événement, 1re génération prête, challenges, teaser du Fork (sans rien dévoiler), 1er fork. Sur mobile, une astuce ne change jamais d'onglet d'elle-même (bouton « Voir »).
- « Passer le tuto » / « Plus d'astuces » coupe tout ; Paramètres → « Revoir le tutoriel » (sur une partie avancée, chaque étape a alors un bouton Suivant).
- État dans `s.seen` (`tut:*`, `tip:*`) : pas de changement de format de sauvegarde. Une partie avec de la progression (release, fork ou 30 min de jeu) qui n'a jamais vu le tuto est « adoptée » : pas de tuto, et pas d'astuce pour ce qu'elle a déjà débloqué (y compris importée).

**Terminal / CLI.** **Tranché :** on ne change rien pour le moment. On a douté que les joueurs tapent vraiment des commandes, mais le terminal fait l'identité du jeu, et tout reste faisable à la souris.

## Équilibrage : comment travailler

- Tous les réglages sont dans `formulas.ts` (objet `BAL`, prix, courbes). Ne change pas un chiffre au hasard : **lance la simulation avant et après**.
- `npm run sim -- <heures>` simule un joueur (achats, claims, challenges, releases quand le conseiller le dit). Options :
  - `BAL_<clé>=valeur` pour tester un réglage sans toucher au code ;
  - `ADV_<clé>=valeur` pour régler le conseiller (`peakDrop`, `lifetimeShare`, `minWindowMin`) ;
  - `NOCHAL=1` pour désactiver les challenges ;
  - `NOGEN=1` pour désactiver les générations de matériel ;
  - `EVENTS=0..1` pour la part d'événements attrapés (0,7 par défaut), `NOEVENTS=1` pour les couper ;
  - `NOFORK=1` pour ne jamais forker, `FORK_<clé>=valeur` et `FADV_<clé>=valeur` pour régler Fork et son conseiller.
  - Sous WSL, `npx` lance le Node de Windows : passe les variables avec `WSLENV` (ex. `WSLENV=BAL_genBase BAL_genBase=60 npm run sim -- 6`).
- Rythme visé, et validé par Arthur en jouant :
  - 1re étoile en ~20–35 min. Arthur trouve ce début « vraiment bien ».
  - Ensuite, des releases rapprochées au début, puis des runs de 15–20 min en milieu de partie.
  - Arbre complet en ~3 h 30–4 h pour un joueur qui suit le conseiller (simulation v0.2.8 : 3 h 42).
  - Fin de partie : croissance maîtrisée (environ ×1,5 d'étoiles par demi-heure, runs de 20–30 min), pas d'explosion.
  - Après l'arbre, place aux optimisations infinies.
- Retours de jeu à garder en tête :
  - v0.1 : arbre fini en 1 h 38 avec 310 étoiles. C'était trop rapide après la 1re étoile, d'où le seuil qui monte à chaque release.
  - v0.2.2 : 1re étoile en 21 min 53.
  - v0.3.5 : arbre complet en 3 h 39 (15 releases, 267 étoiles, 21 événements attrapés, 2 générations, release la plus rapide 1 min 21). Dans la cible, mais générations quasi inutilisées → v0.3.6. À surveiller : des releases toutes les ~1 min en fin d'arbre.
  - v0.2.7 : à 6 h 19, 6 releases, 22 étoiles, 0 challenge, « on s'ennuie fort ». Cause : runs d'une heure, aucune indication du bon moment pour publier, challenges passés inaperçus → v0.2.8.
  - Un creux d'attente avant la 1re étoile, quand il n'y a plus rien à acheter, décourage le joueur : il faut toujours un prochain objectif visible.

## Workflow Git et déploiement

- Dépôt privé `github.com/Arthurmrtl/overcompile`, mainteneur **Arthur** (`Arthurmrtl`).
- **`main` est déployé automatiquement en production** : CI GitHub Actions → image `ghcr.io/arthurmrtl/overcompile:latest` → Watchtower sur le serveur d'Arthur (Docker derrière Nginx Proxy Manager) en moins de 5 minutes. Donc :
  - travaille **toujours sur une branche** et ouvre une **pull request** ;
  - ne pousse jamais directement sur `main` ;
  - ne commite ni ne pousse sans que l'humain le demande.
- La CI (`.github/workflows/ci.yml`) lance `npm ci` et `npm run build` sur chaque PR. La PR doit être verte.
- Quand une version change, mets à jour **à la fois** `GAME_VERSION` dans `src/main.ts` et `version` dans `package.json`, puis le README.
- Versions : `0.MINEUR.PATCH`. Un mineur ajoute du contenu ou une mécanique, un patch apporte des correctifs ou de l'équilibrage.
- Voir aussi `CONTRIBUTING.md` (conventions) et `deploy/README.md` (hébergement).

Pour tester dans un vrai navigateur, `npm run build` puis ouvrir `dist/index.html`. Après tout changement d'UI, vérifie le rendu en FR **et** en EN, sur desktop **et** sur mobile (navigation par onglets en bas).

## Pas encore décidé (demander à Arthur avant de coder)

1. **Seuil de la 1re release à 8 000 au lieu de 20 000**, pour raccourcir l'attente avant la 1re étoile après l'achat de l'Auto-Scaling.
2. Mettre à jour les actions GitHub signalées comme utilisant Node 20 (fin de vie). Ce n'est pas bloquant.

## Feuille de route

- **v0.3** (en cours) : générations de matériel (`gen`, v0.3.0), événements de build (v0.3.1), puis correctifs et équilibrage selon les retours de jeu, et peut-être les points ci-dessus.
- **v0.4** : couche de prestige **Fork** (v0.4.0 : contributeurs, arbre Fork, PR `gh pr`), rééquilibrage du fork, arbre Fork dessiné et bonus en % (v0.4.1), correctif de sortie de challenge (v0.4.2), barre d'onglets mobile (v0.4.3), brouillard de l'arbre Fork (v0.4.4), générations par run (v0.4.5), détail du calcul des contributeurs (v0.4.6), prix normal de l'Auto-Scaling avec `iac` et cache du Disk (v0.4.7), toasts mobiles et tableau du calcul des contributeurs (v0.4.8), génération automatique `rnv` (v0.4.9), réglage libre de la priorité Jobs (v0.4.10), colonnes redimensionnables sur PC (v0.4.11), tuto interactif et astuces au déblocage (v0.4.12), barre de progression du tuto (v0.4.13), toasts discrets sur PC (v0.4.14).
- **v0.5** : couche **Distro** avec saveurs et automatisation du Fork (v0.5.0), onglet Fork qui porte le fork, « Base » en FR, 1re distro en vrai reset (v0.5.1), puis **`crontab`** en talent final de l'arbre Distro (v0.5.2) et des succès Distro.
- **v0.6 (idée)** : paquets en parallèle (concept B du Whiteboard v0.5 : plusieurs projets, dépendances, répartition des Jobs).

## Façon de travailler avec Arthur

- Il teste en jouant et renvoie des captures d'écran et ses stats. Pars de ses ressentis (« trop long », « ça fait doublon », « pas lisible ») et propose 2–3 options courtes plutôt qu'un gros changement imposé.
- Il ne veut pas de refonte visuelle : des maquettes ont été proposées et **refusées**, on garde l'UI actuelle et on l'améliore par petites touches.
- Réponds-lui en français, de façon directe et concise.

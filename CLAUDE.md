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
    advisor.ts       conseillers de release (étoiles/min) et de fork (contributeurs/h)
    fork.ts          couche Fork : contributeurs, arbre Fork, pull requests, réglages FORK
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
- `SAVE_VERSION` vaut actuellement **6**. Si tu changes la forme de `GameState` :
  1. incrémente `SAVE_VERSION` ;
  2. ajoute une étape dans `migrate()` qui convertit les anciennes sauvegardes ;
  3. vérifie qu'une sauvegarde de la version précédente se charge sans perte.
- Des joueurs (dont Arthur) ont des parties en cours : une sauvegarde perdue est un bug bloquant.

## Mécaniques actuelles (v0.4.1)

**Boucle de base.** Un build prend ~5 s et peut échouer (25 % au départ). Les Jobs exécutent plusieurs builds en parallèle. Matériel :
- CPU : builds plus rapides, mais plus d'échecs ;
- RAM : gains plus élevés, builds légèrement plus lents ;
- Disk : moins d'échecs, gains légèrement plus faibles ;
- Jobs : builds en parallèle (max 16).

Perks de boutique :
- **CI/CD** à 10 crédits : relance automatique des builds. **Tranché :** reste à 10.
- **Auto-Scaling** : achète automatiquement le matériel le moins cher. **Tranché (v0.3.2, Arthur et son ami voulaient retarder l'autobuy) :** pas en vente avant la 1re release (la 1re run se joue à la main), puis prix = 25 % du seuil de release en cours (`AS_PRICE_SHARE`, ~6 000 cr après la 1re release), racheté à chaque run jusqu'au talent permanent `as`, passé de 3★ à 10★. Simulation : la 1re étoile ne bouge pas (~22 min, achats à la main toutes les ~4 s), Auto-Scaling acheté vers 33–39 min, arbre complet 3 h 05–3 h 30. Avant ça, il coûtait 1 000 cr dès la 1re run.

**Release (prestige).** Le seuil de base est de 20 000 crédits gagnés dans la run, multiplié par 1,2 à chaque release. Étoiles gagnées :
`floor(max(1 + 1,5·log2(ratio), ratio^0.36) × multiplicateurs)`, où `ratio = gagné / seuil`.
La courbe est volontairement généreuse au début : 2★ à ×1,6 le seuil, 3★ à ×2,5, 4★ à ×4. Le terme `ratio^0,36` est devenu `ratio^0,25` en v0.4.1 (voir Fork). Les étoiles gagnées au total donnent aussi un bonus permanent de gains (`1 + 0,25·total^0,35` ; c'était `√total` avant la v0.2.8, ce qui faisait exploser la fin de partie).

**Conseiller de release** (`src/core/advisor.ts`, v0.2.8). Constat d'Arthur à 6 h 19 de jeu : il s'ennuyait, ses runs duraient ~1 h et il n'avait jamais fait de challenge. Les étoiles d'une release montent de plus en plus lentement, donc garder une run trop longtemps fait perdre du temps, et le jeu ne le disait pas. Le conseiller calcule les étoiles par minute de la run (sur 5 min minimum) et conseille de publier quand ce rythme retombe sous 90 % de son meilleur niveau, ou quand la release ajoute au moins 50 % des étoiles déjà gagnées. Le bouton Release ne clignote plus que dans ce cas ; il y a aussi un badge sur l'onglet, un point sur mobile et une ligne dans le journal. La simulation suit ce conseiller : c'est le rythme d'un joueur qui écoute le jeu. Un encart signale aussi les challenges pas encore faits.

**Tranché :** la monnaie de prestige reste les « étoiles ». Ne pas la renommer.

**Découverte progressive.** Avant la 1re release, le joueur ne voit que l'objectif (« Publier v1.0.0 → ??? ») : ni étoiles, ni arbre, ni optimisations. Les challenges apparaissent après 3 releases. Une commande pas encore débloquée répond `bash: X: command not found`. L'arbre a un « brouillard » : seuls les talents adjacents à ceux qu'on possède sont visibles, et l'arbre ne prend que la hauteur des rangées visibles (v0.3.4, sinon gros vide sur mobile). Ne divulgue rien de verrouillé (UI, aide, `guide`, succès cachés).

**Arbre de release (talents).** 15 talents, du premier (`inc`, Cache chaud, 1★) au dernier (`bot`, Release bot, 100★). Ils sont identifiés par des **tags texte**, et **Tranché :** pas d'emojis dans l'arbre (« ça fait gamin / IA »). Même chose pour les succès depuis la v0.3.5 (Arthur : « moins IA slop ») : tags `[ ]` à faire, `[!]` à récupérer, `[✓]` récupéré, `[?]` secret, et `[ ACH ]` dans le journal. Les autres emojis de l'interface (💾 ⚙ 🔒 🛒 ⌨️ 🚀 ⭐, icônes des événements) restent pour l'instant.

Branche Auto-Scaling :
- `as` (10★ depuis la v0.3.2) : Auto-Scaling permanent (conservé après une release) ;
- `fast` : 4 passages par seconde au lieu d'un toutes les 2 s ;
- `ctrl` : cases AUTO, pour choisir quelles ressources l'Auto-Scaling achète ;
- `-j` : l'Auto-Scaling gère aussi les Jobs. Il en achète d'abord autant que possible, puis dépense le reste en CPU/RAM/Disk. **Tranché (v0.3.3, option choisie par Arthur) :** un seuil réglé par le joueur (`jobsPrio`, en secondes de revenu : jamais, 10 s, 30 s, 1 min, 5 min, toujours) fait économiser pour le prochain slot quand il coûte au plus ce temps de revenu. Bouton `prio … ▸` sur la carte Jobs, barre « épargne pour le job N », commande `autoscale jobs <off|10|30|60|300|always>` (visible seulement avec `-j`). Défaut : jamais, parce que la simulation montre qu'économiser ne fait jamais gagner (chaque slot coûte ×5 le précédent pour un gain linéaire ; 16 jobs atteints vers 3 h 30 sans épargne ; 30 s retarde l'arbre de ~10 min, 5 min de ~2 h). C'est une préférence de joueur, pas une optimisation. Sim : `JOBSPRIO=<s>`.

Ces talents remplacent les anciens autobuyers par ressource, qui faisaient doublon avec l'Auto-Scaling.

**Optimisations** (étoiles, coût ×3 à chaque niveau depuis la v0.2.8, rachetables à l'infini) : gains, vitesse, boot (+3 niveaux de matériel au début de chaque run), efficacité hors ligne, durée hors ligne. Elles existent parce qu'après l'arbre, les étoiles s'accumulaient sans rien sur quoi les dépenser.

**Générations de matériel** (commande `gen`, inspirées de l'Ascension de Revolution Idle). Quand le CPU, la RAM ou le Disk atteint le niveau requis (45, puis ×1,4 à chaque fois : 45, 63, 88, 123…), on peut le passer à la génération suivante. Son niveau repart au niveau de départ de la run, mais le bonus est permanent et n'est jamais remis à zéro : CPU builds ×1,08 plus rapides, RAM gains ×1,12, Disk gains ×1,06 et échecs ×0,92. Visibles après la 1re release. Réglages : `BAL.gen*`. Le simulateur les prend dès qu'elles sont disponibles (`NOGEN=1` pour les désactiver).
- v0.3.0 (conçues par l'ami d'Arthur) : seuil 75, bonus ×1,15 / ×1,3 / ×1,15 et échecs ×0,85.
- **Tranché (v0.3.6, Arthur) :** retour de jeu après l'arbre complet en 3 h 39 : « quasi inexploitable, on n'est jamais à 75 avant la toute fin de l'arbre ». Seuil baissé à 45 et bonus réduits pour ne pas accélérer l'arbre (baisser le seuil seul fait boule de neige : seuil 40 avec les anciens bonus → arbre en 2 h 10). Simulation : 1re génération vers 1 h 05–1 h 10 (Disk), puis environ une toutes les 30 min, arbre complet 2 h 57–3 h 03 (3 h 08 avant ; le vrai jeu d'Arthur prend ~15 % de plus que la sim).
- **Tranché :** les générations restent une mécanique des releases (elles remplissent le milieu de partie). La couche Fork pourra s'en servir : remise à zéro avec un talent qui en garde une partie, seuil réduit, ou bonus de contributeurs selon les générations obtenues.

**Événements de build** (`src/core/events.ts`, v0.3.1, façon « golden cookie »). Une fois la CI/CD active, un événement apparaît toutes les 3 à 6 minutes et reste 12 s : une pastille en haut de l'écran (visible quel que soit l'onglet) et une ligne `[ EVENT ]` dans le journal. On l'attrape en cliquant ou en tapant sa commande. **Tranché par Arthur :** tous positifs (pas de pénalité, la CVE est « CVE patchée ») et **pas d'option pour les désactiver**. Liste : Pause café `coffee` (builds ×2, 30 s), `cargo update` (+1 min de revenu), Test instable `retry` (0 % d'échec, 45 s), Code review express `approve` (gains ×3, 20 s), Conflit de merge `git merge` (tous les jobs terminent instantanément, 3 fois), CVE patchée `patch` (+5 min de revenu), Prod en feu `hotfix` (gains ×7, 15 s, rare), Release candidate `rc` (+10 % d'étoiles sur la prochaine release, rare, après la 1re release). Rien hors ligne ni pendant un challenge. Talent `pgr` (Astreinte, 3★, après `ci`) : fenêtre de 20 s et événements 25 % plus fréquents. Succès : 10 / 100 / 500 événements attrapés. La commande `events` les liste. Simulation : le joueur simulé en attrape 70 % (`EVENTS=0..1`, `NOEVENTS=1` pour les couper) ; arbre complet ~3 h 15–3 h 25 contre 3 h 35 sans, 1re étoile inchangée.

**Fork** (`src/core/fork.ts`, v0.4, 2e couche de prestige). **Tranché (Arthur) :**
- Condition : **arbre de release complet** (les 15 talents). Teaser « Fork → ??? » dans l'onglet Release dès que le dernier talent (`bot`) est visible.
- Forker remet à zéro crédits, matériel, releases, étoiles (dont le total, qui sert au calcul), arbre de release, optimisations, challenges et générations. Restent : contributeurs, arbre Fork, succès, stats d'événements, paramètres. Fenêtre de confirmation, commande `fork --yes`.
- **Tranché (v0.4.1) : un fork ramène aux conditions du début du jeu**, avec en plus les améliorations de Fork. Le seuil de release repart à 20K puis ×1,2 par release, comme au début : **il ne faut pas que le jeu devienne plus dur** après un fork. La v0.4.0 multipliait le seuil par 10 à chaque fork ; Arthur l'a refusé. Pas de plafond d'étoiles par release non plus (« ça traduit un problème de fonctionnement ou d'équilibrage »).
- **Contributeurs** = f(étoiles gagnées depuis le dernier fork), sur le modèle des étoiles : `max(1 + 2·log2(étoiles/200), (étoiles/200)^0,6)`, ×(1 + 5 % par génération) ×(1 + 10 % par challenge fait dans le cycle). Le total gagné donne un bonus permanent **logarithmique** : gains ×(1 + 0,25·log2(1 + total)). Les non dépensés achètent l'arbre Fork.
- **Pourquoi c'est logarithmique et pourquoi l'arbre Fork ne multiplie presque rien** (v0.4.1) : avec des multiplicateurs (gains ×(1 + 0,4·total^0,8), Sponsors ×2, Benchmarks ×1,5, Awesome ×1,5) et le seuil remis à 20K, tout faisait boule de neige (plus de gains → plus d'étoiles → plus de contributeurs → cycle plus court) : cycles de 3 h → 20 min → 5 min → 1 min, même avec un bonus divisé par 20. La couche Fork accélère donc le **redémarrage** (étoiles, niveaux, talents, automatisation au départ) plutôt que la vitesse de croisière.
- Même cause côté releases : l'exposant de la courbe d'étoiles pour les très grosses runs passe de 0,36 à **0,25** (`BAL.starExp`). Avec 0,36, la fin de l'arbre s'emballait déjà sans fork (+56 → +47 000★ par release en 1 h 30) ; avec 0,25 : +115 → +434★, arbre toujours fini vers 2 h 40–3 h 10, 1re étoile inchangée.
- **Arbre Fork** (10 talents, 1 à 13 contributeurs, 43 au total, jamais remis à zéro) : `tpl` 10★ au départ de chaque fork ; `iac` Auto-Scaling achetable dès le début d'un fork (1 000 cr) ; `spn` chaque run commence avec +10 niveaux de CPU/RAM/Disk ; `lts` seuil ×1,15 par release au lieu de ×1,2 ; `mir` garde la moitié des générations ; `bin` chaque fork commence avec `inc`, `rev` et `ci` ; `dpb` attrape seul les événements courants ; `awe` +2★ par release ; `kp` garde les talents CI et Auto-Scaling ; `ups` +2 contributeurs par fork. Identifiants internes inchangés depuis la v0.4.0 (`f_sponsors`, `f_bench`… gardent leur nom même si l'effet a changé). Affiché en liste de cartes.
- **Pull requests** (après le 1er fork) : une PR s'ouvre toutes les 600 s / (1 + 0,5·log2(1 + contributeurs gagnés)), 3 ouvertes au maximum, ni hors ligne ni en challenge. Fusionner (`gh pr merge <n>` ou bouton) donne un bonus jusqu'à la prochaine release : perf builds ×1,2, feat gains ×1,25, ci étoiles ×1,05 ; docs donne +2 min de revenu. Fusionner est gratuit et **ne rapporte jamais de contributeurs** (seul le fork en donne).
- **Conseiller de fork** : contributeurs par heure du cycle (30 min minimum), conseille quand le rythme baisse ou quand le fork double les contributeurs gagnés. Bouton qui clignote, ligne `[ FORK ]` dans le journal.
- Nouvel onglet Fork (après le 1er fork), compteur `⑂` dans l'en-tête, 7 succès Fork, lignes de stats.
- Simulation v0.4.1 (`npm run sim -- 10`, 3 runs ; le joueur forke quand le conseiller le dit et fusionne toutes les PR) : 1er fork vers 3 h 10 avec 5–6 contributeurs ; 2e cycle 45–50 min ; ensuite cycles stables de ~35 min ; contributeurs par fork 5 → 10 → 16 → 20, puis plateau vers 25–28 ; arbre Fork complet au 5e fork (~5 h 45). Options : `NOFORK=1`, `FORK_<clé>=valeur`, `FADV_<clé>=valeur`.
- Pas encore fait : `crontab` (v0.4.2), arbre Fork affiché en arbre, lien avec les générations au-delà de `mir`, contenu après l'arbre Fork complet.

**Hors ligne.** Les 5 premières minutes d'absence comptent toujours à 100 %, pour couvrir un téléphone en veille ou un changement d'onglet. Au-delà, rien sans le talent `off` (10 % d'efficacité, 2 h max), qu'on améliore ensuite avec des optimisations (jusqu'à 100 % et 24 h). **Tranché :** c'est volontairement faible au début.

**Challenges** (débloqués après 3 releases) : Single-core, Debug build -O0, Friday deploy, No cache. Ce sont des releases sous contrainte qui donnent un bonus permanent.

**Succès.** 68 succès qui fusionnent les anciens « objectifs » et « succès ». **Tranché** (idée d'Arthur) :
- jamais remis à zéro ;
- récompense à récupérer quand on veut (bouton Claim, commande `claim`) ;
- petites sommes en crédits au début, puis bonus permanents du type « +2 % de gains » ;
- un seul onglet Succès : « À récupérer » puis « Tous les succès ». **Tranché (v0.3.5) :** plus de liste « En cours » séparée (doublon, selon Arthur) ; chaque carte de succès pas encore obtenu porte sa barre de progression, et la grille est triée : en cours (les plus proches d'abord), puis à récupérer, récupérés, secrets. Pas d'affichage en double.

**Console.** Elle doit être avant tout **satisfaisante et informative, pas verbeuse**. On a en haut un flux de build décoratif (lignes façon `cargo`, 5 max) et une ligne de statut en direct. En bas, un journal lisible : résumés par minute, records, bannières. Trois niveaux de verbosité dans les paramètres. Les toasts sont limités à 3 à la fois.

**Mobile.** Sur écran tactile, le jeu ne place jamais le curseur dans le terminal tout seul : le clavier ne s'ouvre que si on touche la ligne du prompt. Pendant la saisie, la barre d'onglets et le bloc Pipeline sont masqués pour laisser toute la hauteur au terminal. La hauteur suit la zone réellement visible (`100dvh` + `visualViewport`), y compris avec la zone du geste d'accueil sur iPhone.

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
- **v0.4** : couche de prestige **Fork** (v0.4.0 : contributeurs, arbre Fork, PR `gh pr`), rééquilibrage du fork (v0.4.1), puis **`crontab`** pour l'automatisation scriptée (v0.4.2).
- **v0.5** : couche **Distro** (idée encore vague).

## Façon de travailler avec Arthur

- Il teste en jouant et renvoie des captures d'écran et ses stats. Pars de ses ressentis (« trop long », « ça fait doublon », « pas lisible ») et propose 2–3 options courtes plutôt qu'un gros changement imposé.
- Il ne veut pas de refonte visuelle : des maquettes ont été proposées et **refusées**, on garde l'UI actuelle et on l'améliore par petites touches.
- Réponds-lui en français, de façon directe et concise.

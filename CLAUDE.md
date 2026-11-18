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
    talents.ts       arbre de release (14 talents, payés en étoiles)
    upgrades.ts      optimisations rachetables à l'infini (étoiles, coût ×2 par niveau)
    challenges.ts    4 challenges (releases sous contrainte → bonus permanent)
    achievements.ts  54 succès, avec récompense à récupérer
  ui/terminal.ts   widget terminal (flux de build, ligne de statut, journal, prompt, historique, Tab)
  commands.ts      toutes les commandes du terminal
  main.ts          mise en page, rendu des panneaux, journal d'événements, boucle (100 ms), GAME_VERSION
  i18n.ts          dictionnaires EN/FR
  format.ts        formatage des nombres (notations)
  style.css        thème sombre type terminal
scripts/sim.ts     simulateur d'équilibrage (headless)
```

Règles d'architecture :
- `src/core` ne touche **jamais** au DOM. L'UI écoute les événements de l'`Engine` (`builds`, `pipeline_done`, `release`, `achievement`, `autobuy`, `challenge_*`…).
- Les grands nombres utilisent **break_eternity.js** (`Decimal`). Ne mélange pas `number` et `Decimal` pour les crédits ou les gains.
- **Chaque texte affiché passe par `i18n.ts`**, en EN **et** en FR. Pas de chaîne en dur dans l'UI.
- Le build produit **un seul fichier HTML** (`vite-plugin-singlefile`) : pas d'assets externes ni de CDN.

## Sauvegarde : à ne pas casser

- Stockage dans `localStorage`, clé `overcompile-save`. Sauvegarde automatique ; export/import en texte dans les paramètres.
- `SAVE_VERSION` vaut actuellement **2**. Si tu changes la forme de `GameState` :
  1. incrémente `SAVE_VERSION` ;
  2. ajoute une étape dans `migrate()` qui convertit les anciennes sauvegardes ;
  3. vérifie qu'une sauvegarde de la version précédente se charge sans perte.
- Des joueurs (dont Arthur) ont des parties en cours : une sauvegarde perdue est un bug bloquant.

## Mécaniques actuelles (v0.2.6)

**Boucle de base.** Un build prend ~5 s et peut échouer (25 % au départ). Les Jobs exécutent plusieurs builds en parallèle. Matériel :
- CPU : builds plus rapides, mais plus d'échecs ;
- RAM : gains plus élevés, builds légèrement plus lents ;
- Disk : moins d'échecs, gains légèrement plus faibles ;
- Jobs : builds en parallèle (max 16).

Perks de boutique :
- **CI/CD** à 10 crédits : relance automatique des builds. **Tranché :** reste à 10.
- **Auto-Scaling** à 1 000 crédits : achète automatiquement le matériel le moins cher.

**Release (prestige).** Le seuil de base est de 20 000 crédits gagnés dans la run, multiplié par 1,2 à chaque release. Étoiles gagnées :
`floor(max(1 + log2(ratio), ratio^0.36) × multiplicateurs)`, où `ratio = gagné / seuil`.
La courbe est volontairement généreuse au début : la 2e étoile est atteinte à ×2 le seuil. Les étoiles gagnées au total donnent aussi un bonus permanent de gains (`1 + 0,25·√total`).

**Tranché :** la monnaie de prestige reste les « étoiles ». Ne pas la renommer.

**Découverte progressive.** Avant la 1re release, le joueur ne voit que l'objectif (« Publier v1.0.0 → ??? ») : ni étoiles, ni arbre, ni optimisations. Les challenges apparaissent après 3 releases. Une commande pas encore débloquée répond `bash: X: command not found`. L'arbre a un « brouillard » : seuls les talents adjacents à ceux qu'on possède sont visibles. Ne divulgue rien de verrouillé (UI, aide, `guide`, succès cachés).

**Arbre de release (talents).** 14 talents, du premier (`inc`, Cache chaud, 1★) au dernier (`bot`, Release bot, 100★). Ils sont identifiés par des **tags texte**, et **Tranché :** pas d'emojis dans l'arbre (« ça fait gamin / IA »). Les autres emojis de l'interface (💾 ⚙ 🏆 🔒 🛒 ⌨️ 🚀 ⭐) restent.

Branche Auto-Scaling :
- `as` : Auto-Scaling permanent (conservé après une release) ;
- `fast` : 4 passages par seconde au lieu d'un toutes les 2 s ;
- `ctrl` : cases AUTO, pour choisir quelles ressources l'Auto-Scaling achète ;
- `-j` : l'Auto-Scaling gère aussi les Jobs.

Ces talents remplacent les anciens autobuyers par ressource, qui faisaient doublon avec l'Auto-Scaling.

**Optimisations** (étoiles, coût qui double à chaque niveau, rachetables à l'infini) : gains, vitesse, boot (+3 niveaux de matériel au début de chaque run), efficacité hors ligne, durée hors ligne. Elles existent parce qu'après l'arbre, les étoiles s'accumulaient sans rien sur quoi les dépenser.

**Hors ligne.** Les 5 premières minutes d'absence comptent toujours à 100 %, pour couvrir un téléphone en veille ou un changement d'onglet. Au-delà, rien sans le talent `off` (10 % d'efficacité, 2 h max), qu'on améliore ensuite avec des optimisations (jusqu'à 100 % et 24 h). **Tranché :** c'est volontairement faible au début.

**Challenges** (débloqués après 3 releases) : Single-core, Debug build -O0, Friday deploy, No cache. Ce sont des releases sous contrainte qui donnent un bonus permanent.

**Succès.** 54 succès qui fusionnent les anciens « objectifs » et « succès ». **Tranché** (idée d'Arthur) :
- jamais remis à zéro ;
- récompense à récupérer quand on veut (bouton Claim, commande `claim`) ;
- petites sommes en crédits au début, puis bonus permanents du type « +2 % de gains » ;
- un seul onglet Succès : « À récupérer », « En cours » (barres de progression, triés par proximité), « Tous ». Pas d'affichage en double.

**Console.** Elle doit être avant tout **satisfaisante et informative, pas verbeuse**. On a en haut un flux de build décoratif (lignes façon `cargo`, 5 max) et une ligne de statut en direct. En bas, un journal lisible : résumés par minute, records, bannières. Trois niveaux de verbosité dans les paramètres. Les toasts sont limités à 3 à la fois.

**Terminal / CLI.** **Tranché :** on ne change rien pour le moment. On a douté que les joueurs tapent vraiment des commandes, mais le terminal fait l'identité du jeu, et tout reste faisable à la souris.

## Équilibrage : comment travailler

- Tous les réglages sont dans `formulas.ts` (objet `BAL`, prix, courbes). Ne change pas un chiffre au hasard : **lance la simulation avant et après**.
- `npm run sim -- <heures>` simule un joueur (achats, claims, releases, challenges). Options :
  - `BAL_<clé>=valeur` pour tester un réglage sans toucher au code ;
  - `NOCHAL=1` pour désactiver les challenges.
- Rythme visé, et validé par Arthur en jouant :
  - 1re étoile en ~20–35 min. Arthur trouve ce début « vraiment bien ».
  - Ensuite, des releases rapprochées au début, puis des runs de 15–20 min en milieu de partie.
  - Arbre complet en ~4–6 h.
  - Après l'arbre, place aux optimisations infinies.
- Retours de jeu à garder en tête :
  - v0.1 : arbre fini en 1 h 38 avec 310 étoiles. C'était trop rapide après la 1re étoile, d'où le seuil qui monte à chaque release.
  - v0.2.2 : 1re étoile en 21 min 53.
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
2. **Événements de build aléatoires**, façon « golden cookie » : un événement apparaît brièvement dans la console et le joueur clique dessus (ou tape la commande) pour un bonus temporaire. Idées : `cargo update`, test instable, code review, CVE, conflit de merge, prod en feu, pause café. Il faudrait une option pour les désactiver, et une progression liée (talents ou succès). Questions ouvertes :
   - faire les deux (seuil à 8K et événements) ou seulement les événements ?
   - la CVE garde-t-elle une pénalité possible, ou tous les événements sont-ils positifs ?
3. Mettre à jour les actions GitHub signalées comme utilisant Node 20 (fin de vie). Ce n'est pas bloquant.

## Feuille de route

- **v0.2.x** : correctifs et équilibrage selon les retours de jeu, et peut-être les points ci-dessus.
- **v0.3** : nouvelle couche de prestige **Fork**, au-dessus des releases, avec des contributeurs, des PR (commande `gh pr`) et son propre arbre. Plus une commande **`crontab`** pour l'automatisation scriptée.
- **v0.4** : couche **Distro** (idée encore vague).

## Façon de travailler avec Arthur

- Il teste en jouant et renvoie des captures d'écran et ses stats. Pars de ses ressentis (« trop long », « ça fait doublon », « pas lisible ») et propose 2–3 options courtes plutôt qu'un gros changement imposé.
- Il ne veut pas de refonte visuelle : des maquettes ont été proposées et **refusées**, on garde l'UI actuelle et on l'améliore par petites touches.
- Réponds-lui en français, de façon directe et concise.

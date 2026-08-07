# SimpleCarto

Générateur de cartes thématiques (France & Monde) à partir de données CSV — gratuit, sans inscription, fonctionne **100 % hors-ligne**.

🔗 **Démo en ligne : [guiraudjb.github.io/SimpleCarto](https://guiraudjb.github.io/SimpleCarto)**

## Fonctionnalités

- **Cartes thématiques** à plusieurs échelles : monde, France métropolitaine, région, département, EPCI, commune.
- **Import de données CSV** (le vôtre, ou l'un des jeux d'exemple fournis) avec moteur de calcul intégré (somme, part en %, ratio, évolution).
- **Palettes de couleurs** prédéfinies ou personnalisées (dégradé manuel à 2-3 couleurs).
- **Étiquettes** intelligentes (nom, valeur, ou les deux) avec anti-collision automatique.
- **Pictogrammes thématiques** à placer librement sur la carte, classés par catégorie :
  - jeu **humanitaire** (OCHA Humanitarian Icons — conflits, catastrophes naturelles, santé, WASH, camps, logistique...)
  - jeu **DSFR** (pictogrammes du Système de Design de l'État, recolorables)
- **Export PNG** haute définition et **export/import de configuration JSON** (pour reprendre une carte plus tard).
- **PWA installable**, précache intégral (données géographiques + pictogrammes) pour un usage entièrement hors-ligne après la première visite.

## Utilisation

Aucune installation requise : ouvrez [la démo en ligne](https://guiraudjb.github.io/SimpleCarto), ou installez l'application depuis le bouton dédié dans l'en-tête pour un accès hors-ligne permanent.

### En local

L'application est 100 % statique (aucun serveur applicatif, aucune dépendance réseau). Servez simplement le dossier avec n'importe quel serveur HTTP statique, par exemple :

```bash
python3 -m http.server 8080
```

puis ouvrez `http://localhost:8080`.

## Architecture

- Aucun framework, aucune étape de build : HTML / CSS / JavaScript vanilla.
- [D3.js](https://d3js.org) + [TopoJSON](https://github.com/topojson/topojson) pour le rendu cartographique.
- [PapaParse](https://www.papaparse.com) pour la lecture des CSV.
- [html2canvas](https://html2canvas.hertzen.com) pour l'export PNG haute définition.
- Toutes les bibliothèques et données sont vendorisées localement (`libs/`, `data/`) — aucun appel réseau externe, aucun CDN.

## Données & licences

- **Référentiels géographiques** (`data/`) : limites communales, départementales, régionales et mondiales, ainsi que jeux de données d'exemple.
- **Pictogrammes OCHA** (`icons/pictograms/`) : [UN-OCHA/humanitarian-icons](https://github.com/UN-OCHA/humanitarian-icons), domaine public (CC0 1.0).
- **Pictogrammes DSFR** (`icons/pictograms-dsfr/`) : [Système de Design de l'État](https://github.com/GouvernementFR/dsfr) v1.14.3, licence MIT — icônes majoritairement issues de [Remix Icon](https://remixicon.com) (Apache License 2.0).

Voir les fichiers `LICENSE.txt` correspondants dans chaque sous-dossier d'icônes pour le détail des attributions.

## Licence du code

Non définie pour le moment.

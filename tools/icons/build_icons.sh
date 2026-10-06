#!/usr/bin/env bash
# Génère le jeu d'icônes illustrées avec Krea 2, l'intègre dans SimpleCarto,
# régénère le manuel PDF, monte la version du service worker, puis commit et push.
#
#   ./tools/icons/build_icons.sh
#
# Variables facultatives :
#   SEEDS=2          variantes générées par icône (la plus propre est retenue automatiquement,
#                    ou celle imposée dans tools/icons/selection.json : {"routeur": 1, ...})
#   SKIP_GENERATE=1  ne pas relancer Krea 2 (réutilise les images déjà générées)
#   NO_PUSH=1        tout faire sauf le commit et le push
#
# Le script peut être interrompu (Ctrl+C) puis relancé à tout moment :
#  - les images déjà générées et détourées sont conservées ;
#  - la version du service worker est toujours « version du dernier commit + 1 », jamais plus ;
#  - s'il n'y a plus rien à commiter (commit déjà fait), il ne fait que retenter le push.
# Lancement conseillé dans tmux ou avec nohup : la génération dure plusieurs heures et
# s'arrêterait si le terminal était fermé.
set -euo pipefail

SEEDS="${SEEDS:-2}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="$REPO/tools/icons"
KREA_DIR=/home/adm1/RAID/aitools/krea-2
KREA_PY="$KREA_DIR/.venv/bin/python3"
IMG_PY=/home/adm1/RAID/venv/bin/python
OUT_DIR="$KREA_DIR/outputs/simplecarto-icons"
LOG="$OUT_DIR/logs/build-$(date +%Y%m%d-%H%M).log"

mkdir -p "$OUT_DIR/logs"
exec > >(tee -a "$LOG") 2>&1
step() { echo; echo "=== $(date +%H:%M:%S) — $* ==="; }
fail() { echo "ERREUR : $*" >&2; exit 1; }

cd "$REPO"
step "Vérifications préalables"
[ "$(git branch --show-current)" = "main" ] || fail "le dépôt n'est pas sur la branche main."
git pull --ff-only || fail "git pull impossible (modifications distantes en conflit ?)."
[ -x "$KREA_PY" ] || fail "venv Krea 2 introuvable : $KREA_PY"
[ -x "$IMG_PY" ] || fail "venv rembg introuvable : $IMG_PY"

if [ "${SKIP_GENERATE:-0}" != "1" ]; then
    if curl -s -o /dev/null -m 3 http://127.0.0.1:7864; then
        fail "le webui Krea (port 7864) tourne déjà et occupe le GPU : l'arrêter avant de relancer."
    fi
    used=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1)
    [ "$used" -lt 3000 ] || fail "le GPU utilise déjà ${used} Mo : libérer la VRAM avant de relancer."

    step "Génération des icônes avec Krea 2 ($SEEDS variante(s) par icône)"
    OSS_TURBO="$KREA_DIR/checkpoints/krea2_turbo_fp8_scaled.safetensors" \
        "$KREA_PY" -u "$TOOLS/generate_icons.py" --seeds "$SEEDS"
fi

step "Détourage et planche contact"
"$IMG_PY" "$TOOLS/cutout_icons.py"

step "Installation dans l'application"
"$IMG_PY" "$TOOLS/install_icons.py"

step "Contrôle de syntaxe JavaScript"
for f in js/*.js sw.js; do
    node -e "new Function(require('fs').readFileSync('$f', 'utf8'))" || fail "syntaxe invalide : $f"
done

step "Manuel PDF"
# Seulement si le HTML a changé : chaque impression Chrome produit un PDF différent
# (date intégrée), ce qui ferait croire à un changement lors d'une relance.
PDF="$REPO/docs/manuel/SimpleCarto-Manuel-Utilisateur.pdf"
if [ "$REPO/docs/manuel/manuel.html" -nt "$PDF" ]; then
    google-chrome --headless=new --disable-gpu --no-pdf-header-footer \
        --print-to-pdf="$PDF" "file://$REPO/docs/manuel/manuel.html" 2>/dev/null
else
    echo "manuel.html inchangé : PDF conservé"
fi

step "Version du service worker"
# Calculée depuis le dernier commit (et non depuis le fichier de travail), pour qu'une
# relance après interruption ne monte pas la version deux fois.
ver_re="s/^const CACHE_NAME = 'simplecarto-v\([0-9]*\)';/\1/p"
committed=$(git show HEAD:sw.js | sed -n "$ver_re")
[ -n "$committed" ] || fail "CACHE_NAME introuvable dans sw.js."
set_sw_version() { sed -i "s/^const CACHE_NAME = 'simplecarto-v[0-9]*';/const CACHE_NAME = 'simplecarto-v$1';/" sw.js; }
COMMIT_PATHS=(icons/pictograms-k2 js/k2-pictogram-catalog.js js/studio.js js/geo-engine.js
              index.html css/style.css sw.js docs/manuel tools/icons)
set_sw_version "$committed"
if [ -n "$(git status --porcelain -- "${COMMIT_PATHS[@]}")" ]; then
    next=$((committed + 1))
    set_sw_version "$next"
    echo "simplecarto-v$committed -> simplecarto-v$next"
else
    next=""
    echo "aucun changement depuis le dernier commit : version inchangée (simplecarto-v$committed)"
fi

if [ "${NO_PUSH:-0}" = "1" ]; then
    step "NO_PUSH=1 : ni commit ni push"
    git status --short
elif [ -z "$next" ]; then
    step "Rien à commiter : push des commits éventuellement en attente"
    git push origin main
else
    step "Commit et push"
    count=$(find icons/pictograms-k2 -name '*.png' | wc -l)
    git add "${COMMIT_PATHS[@]}"
    git commit -F - <<EOF
Ajoute $count icônes illustrées générées avec Krea 2 (pictogrammes et épingles)

- Nouveau jeu « Icônes illustrées » : informatique et réseaux, guerre et défense,
  énergie, météo, transports, secours, bâtiments publics, cadastre et géomètres,
  finances publiques, environnement, agriculture, économie et emploi
- Épingles : icône au choix à la place du point, 5e colonne « icône » dans le CSV
- Icônes intégrées en data URL dans le SVG pour apparaître dans l'export PNG
- Scripts de génération reproductibles dans tools/icons/
- Manuel mis à jour, cache du service worker en v$next

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
    git push origin main
fi

step "Terminé"
echo "Planche contact : $OUT_DIR/cutout/planche.html"
echo "Pour changer une variante : tools/icons/selection.json ({\"id\": graine}), puis"
echo "  SKIP_GENERATE=1 ./tools/icons/build_icons.sh"
echo "Journal : $LOG"

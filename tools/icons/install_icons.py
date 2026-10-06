"""Installe dans SimpleCarto une variante par icône détourée (sortie de cutout_icons.py).

    /home/adm1/RAID/venv/bin/python install_icons.py

Choix de la variante, pour chaque icône du catalogue :
  1. celle imposée dans selection.json ({"routeur": 2, ...} = graine s2), si présent ;
  2. sinon la plus « propre » : le moins de morceaux détachés dans le masque
     (un détourage raté laisse des îlots), puis la graine la plus basse.

Écrit :
  icons/pictograms-k2/<theme>/<id>.png
  icons/pictograms-k2/manifest.json   (précache hors ligne, lu par sw.js)
  icons/pictograms-k2/LICENSE.txt
  js/k2-pictogram-catalog.js          (K2_PICTOGRAM_CATEGORIES / K2_PICTOGRAM_ICONS)
"""
import argparse
import glob
import json
import os
import shutil

import numpy as np
from PIL import Image
from scipy.ndimage import label

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
KREA_OUT = "/home/adm1/RAID/aitools/krea-2/outputs/simplecarto-icons"
DEST_REL = "icons/pictograms-k2"


def fragment_count(path):
    alpha = np.array(Image.open(path).getchannel("A")) > 40
    _, n = label(alpha)
    return n


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cutout", default=os.path.join(KREA_OUT, "cutout"))
    parser.add_argument("--catalog", default=os.path.join(HERE, "icon-prompts.json"))
    parser.add_argument("--selection", default=os.path.join(HERE, "selection.json"))
    args = parser.parse_args()

    catalog = json.load(open(args.catalog, encoding="utf-8"))
    selection = json.load(open(args.selection, encoding="utf-8")) if os.path.exists(args.selection) else {}
    dest_root = os.path.join(REPO, DEST_REL)
    if os.path.isdir(dest_root):
        shutil.rmtree(dest_root)

    installed, missing, categories = [], [], {}
    for icon in catalog["icons"]:
        variants = sorted(glob.glob(os.path.join(args.cutout, icon["theme"], f"{icon['id']}_s*.png")))
        if not variants:
            missing.append(icon["id"])
            continue
        forced = selection.get(icon["id"])
        chosen = next((v for v in variants if v.endswith(f"_s{forced}.png")), None) if forced is not None else None
        if chosen is None:
            chosen = min(variants, key=lambda v: (fragment_count(v), v))

        dest_dir = os.path.join(dest_root, icon["theme"])
        os.makedirs(dest_dir, exist_ok=True)
        shutil.copyfile(chosen, os.path.join(dest_dir, f"{icon['id']}.png"))
        categories.setdefault(icon["theme"], icon["theme_label"])
        installed.append({"file": f"{icon['id']}.png", "id": icon["id"], "name": icon["label_fr"],
                          "category": icon["theme"]})
        print(f"{icon['id']:40s} <- {os.path.basename(chosen)}")

    if not installed:
        raise SystemExit("Aucune icône détourée trouvée : rien à installer.")

    with open(os.path.join(dest_root, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump([f"./{DEST_REL}/{i['category']}/{i['file']}" for i in installed], f)

    with open(os.path.join(dest_root, "LICENSE.txt"), "w", encoding="utf-8") as f:
        f.write("Icônes illustrées SimpleCarto\n"
                "Générées localement avec le modèle Krea 2 (checkpoint Turbo), détourées avec rembg.\n"
                "Prompts et scripts de génération : tools/icons/ de ce dépôt.\n")

    cats_js = ",\n".join(f'    {{ id: {json.dumps(k)}, label: {json.dumps(v, ensure_ascii=False)} }}'
                         for k, v in categories.items())
    icons_js = ",\n".join(f"    {json.dumps(i, ensure_ascii=False)}" for i in installed)
    with open(os.path.join(REPO, "js", "k2-pictogram-catalog.js"), "w", encoding="utf-8") as f:
        f.write("/**\n"
                " * SimpleCarto - Catalogue des icônes illustrées (générées avec Krea 2)\n"
                " * Fichier généré par tools/icons/install_icons.py : ne pas modifier à la main.\n"
                " */\n\n"
                f"const K2_PICTOGRAM_CATEGORIES = [\n{cats_js}\n];\n\n"
                f"const K2_PICTOGRAM_ICONS = [\n{icons_js}\n];\n")

    print(f"\n{len(installed)} icône(s) installée(s) dans {DEST_REL}/"
          + (f", {len(missing)} manquante(s) : {', '.join(missing[:10])}{' ...' if len(missing) > 10 else ''}"
             if missing else "."))


if __name__ == "__main__":
    main()

"""Détoure les icônes brutes générées par generate_icons.py et les met au format SimpleCarto.

À lancer avec une venv contenant rembg (modèle isnet-general-use déjà présent dans ~/.u2net) :

    /home/adm1/RAID/venv/bin/python cutout_icons.py [--only id1,id2]

Pour chaque <theme>/<id>_s<seed>.png brut : suppression du fond, recadrage sur l'objet,
carré transparent avec marge, redimensionné en 256x256 -> --out/<theme>/<id>_s<seed>.png.
Produit aussi une planche contact HTML (--out/planche.html) pour choisir une variante par icône.
"""
import argparse
import glob
import html
import json
import os

import numpy as np
from PIL import Image
from scipy.ndimage import binary_fill_holes
from rembg import new_session, remove

HERE = os.path.dirname(os.path.abspath(__file__))
KREA_OUT = "/home/adm1/RAID/aitools/krea-2/outputs/simplecarto-icons"
SIZE = 256
MARGIN = 0.06  # marge transparente autour de l'objet, en fraction du côté


def solidify(rgb, mask):
    """Assemble l'icône : couleurs de l'image d'origine, masque issu de rembg.

    rembg laisse semi-transparentes les zones claires (murs blancs, pales d'éolienne)
    et efface leur couleur : elles paraîtraient délavées, voire noires, sur une carte.
    Les icônes ayant un contour sombre fermé, on remplit les trous du masque et on
    n'y garde que de l'opaque ; le bord antialiasé extérieur est conservé.
    """
    alpha = np.array(mask.getchannel("A"))
    inside = binary_fill_holes(alpha > 40)
    arr = np.dstack([np.array(rgb), np.where(inside, 255, alpha).astype(np.uint8)])
    return Image.fromarray(arr, "RGBA")


def to_square_icon(rgba):
    alpha = rgba.getchannel("A").point(lambda a: 255 if a > 24 else 0)
    bbox = alpha.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    side = max(rgba.size)
    canvas_side = int(side / (1 - 2 * MARGIN))
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    canvas.paste(rgba, ((canvas_side - rgba.width) // 2, (canvas_side - rgba.height) // 2), rgba)
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", default=os.path.join(KREA_OUT, "raw"))
    parser.add_argument("--out", default=os.path.join(KREA_OUT, "cutout"))
    parser.add_argument("--catalog", default=os.path.join(HERE, "icon-prompts.json"))
    parser.add_argument("--only", default="")
    args = parser.parse_args()

    wanted = set(args.only.split(",")) if args.only else None
    session = new_session("isnet-general-use")

    for raw_path in sorted(glob.glob(os.path.join(args.raw, "*", "*.png"))):
        theme = os.path.basename(os.path.dirname(raw_path))
        name = os.path.basename(raw_path)
        icon_id = name.rsplit("_s", 1)[0]
        if wanted and icon_id not in wanted:
            continue
        out_path = os.path.join(args.out, theme, name)
        if os.path.exists(out_path) and os.path.getmtime(out_path) >= os.path.getmtime(raw_path):
            continue
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        try:
            rgb = Image.open(raw_path).convert("RGB")
        except OSError as e:
            # Image brute illisible (génération interrompue avant l'écriture atomique) :
            # on la supprime pour que generate_icons.py la refasse à la prochaine relance.
            print(f"image brute illisible, supprimée : {raw_path} ({e})", flush=True)
            os.remove(raw_path)
            continue
        cut = remove(rgb, session=session)
        tmp_path = out_path + ".tmp"
        to_square_icon(solidify(rgb, cut.convert("RGBA"))).save(tmp_path, format="PNG", optimize=True)
        os.replace(tmp_path, out_path)
        print("détouré :", out_path, flush=True)

    write_contact_sheet(args.out, args.catalog)


def write_contact_sheet(out_dir, catalog_path):
    catalog = json.load(open(catalog_path, encoding="utf-8"))
    sections, current_theme = [], None
    for icon in catalog["icons"]:
        variants = sorted(glob.glob(os.path.join(out_dir, icon["theme"], f"{icon['id']}_s*.png")))
        if not variants:
            continue
        if icon["theme"] != current_theme:
            current_theme = icon["theme"]
            sections.append(f"<h2>{html.escape(icon['theme_label'])}</h2>")
        cells = "".join(
            f'<figure><img src="{html.escape(os.path.relpath(v, out_dir))}" loading="lazy">'
            f"<figcaption>s{os.path.basename(v).rsplit('_s', 1)[1][:-4]}</figcaption></figure>"
            for v in variants
        )
        sections.append(f'<div class="row"><div class="lbl"><b>{html.escape(icon["label_fr"])}</b>'
                        f'<code>{icon["id"]}</code></div>{cells}</div>')
    page = f"""<!doctype html><meta charset="utf-8"><title>Planche icônes SimpleCarto</title>
<style>
body {{ font-family: system-ui, sans-serif; margin: 16px; background: #fff; color: #1e1e1e; }}
h2 {{ margin-top: 2rem; border-bottom: 2px solid #000091; color: #000091; }}
.row {{ display: flex; align-items: center; gap: 12px; padding: 6px 0; border-bottom: 1px solid #eee; }}
.lbl {{ width: 200px; display: flex; flex-direction: column; font-size: 13px; }}
.lbl code {{ color: #666; font-size: 11px; }}
figure {{ margin: 0; text-align: center; font-size: 11px; color: #666; }}
img {{ width: 96px; height: 96px; background: repeating-conic-gradient(#eee 0 25%, #fff 0 50%) 0 0 / 16px 16px; border: 1px solid #ddd; }}
</style>
<h1>Icônes SimpleCarto — variantes générées (Krea 2 Turbo)</h1>
{''.join(sections)}"""
    with open(os.path.join(out_dir, "planche.html"), "w", encoding="utf-8") as f:
        f.write(page)
    print("planche contact :", os.path.join(out_dir, "planche.html"))


if __name__ == "__main__":
    main()

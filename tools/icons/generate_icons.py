"""Génère les icônes du catalogue icon-prompts.json avec Krea 2 (checkpoint Turbo).

À lancer avec la venv du dépôt krea-2 (le GPU doit être libre : pas de webui Krea actif) :

    OSS_TURBO=/home/adm1/RAID/aitools/krea-2/checkpoints/krea2_turbo_fp8_scaled.safetensors \
    /home/adm1/RAID/aitools/krea-2/.venv/bin/python3 generate_icons.py [--only id1,id2] [--seeds 4]

Les images brutes (1024x1024, fond blanc) sont écrites dans --out/<theme>/<id>_s<seed>.png.
Une image déjà présente n'est pas régénérée : le script peut être interrompu et relancé.
"""
import argparse
import json
import os
import sys
import time

KREA_DIR = "/home/adm1/RAID/aitools/krea-2"
HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default=os.path.join(HERE, "icon-prompts.json"))
    parser.add_argument("--out", default=os.path.join(KREA_DIR, "outputs", "simplecarto-icons", "raw"))
    parser.add_argument("--only", default="", help="identifiants séparés par des virgules")
    parser.add_argument("--theme", default="", help="limiter à un thème")
    parser.add_argument("--seeds", type=int, default=4)
    parser.add_argument("--size", type=int, default=1024)
    args = parser.parse_args()

    catalog = json.load(open(args.catalog, encoding="utf-8"))
    style = catalog["style"]
    icons = catalog["icons"]
    if args.only:
        wanted = set(args.only.split(","))
        icons = [i for i in icons if i["id"] in wanted]
    if args.theme:
        icons = [i for i in icons if i["theme"] == args.theme]

    jobs = []
    for icon in icons:
        for seed in range(args.seeds):
            path = os.path.join(args.out, icon["theme"], f"{icon['id']}_s{seed}.png")
            if not os.path.exists(path):
                jobs.append((icon, seed, path))
    print(f"{len(jobs)} image(s) à générer pour {len(icons)} icône(s).")
    if not jobs:
        return

    # k2_pipeline lit OSS_TURBO à l'import et charge ses modules relativement au dépôt
    os.environ.setdefault("OSS_TURBO", os.path.join(KREA_DIR, "checkpoints", "krea2_turbo_fp8_scaled.safetensors"))
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    sys.path.insert(0, KREA_DIR)
    os.chdir(KREA_DIR)
    from k2_pipeline import K2Pipeline

    pipe = K2Pipeline()

    # L'encodeur de texte tourne sur CPU et domine le temps de génération : les
    # variantes (graines) d'une même icône partagent le prompt, on mémorise donc
    # son encodage plutôt que de le recalculer à chaque image.
    encoder = pipe.encoder
    encoded = {}

    def cached_encoder(prompts):
        key = tuple(prompts)
        if key not in encoded:
            encoded.clear()
            encoded[key] = encoder(prompts)
        return encoded[key]

    pipe.encoder = cached_encoder
    start = time.time()
    for n, (icon, seed, path) in enumerate(jobs, 1):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        prompt = style.format(subject=icon["subject"])
        img = pipe.generate(prompt, checkpoint="oss_turbo", width=args.size, height=args.size,
                            steps=8, guidance=0.0, seed=seed)
        # Écriture atomique : une interruption pendant l'enregistrement ne laisse
        # pas de PNG tronqué qui serait ensuite pris pour une image terminée.
        tmp_path = path + ".tmp"
        img.save(tmp_path, format="PNG")
        os.replace(tmp_path, path)
        elapsed = time.time() - start
        print(f"[{n}/{len(jobs)}] {icon['id']} s{seed} — {elapsed / n:.1f}s/image, "
              f"reste ~{(len(jobs) - n) * elapsed / n / 60:.0f} min", flush=True)


if __name__ == "__main__":
    main()

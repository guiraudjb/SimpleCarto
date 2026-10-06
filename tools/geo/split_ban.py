"""Découpe la Base Adresse Nationale en un dossier par département et un
fichier CSV par commune : data/ban/<département>/<code INSEE>.csv

Source : https://adresse.data.gouv.fr/data/ban/adresses/latest/csv/adresses-france.csv.gz
(Licence Ouverte 2.0). Seules les colonnes utiles au géocodage sont conservées.

Usage : python split_ban.py adresses-france.csv.gz data/ban
"""
import csv
import gzip
import shutil
import sys
from collections import OrderedDict
from pathlib import Path

COLUMNS = ["id", "numero", "rep", "nom_voie", "code_postal", "code_insee", "nom_commune",
           "nom_ancienne_commune", "nom_ld", "lon", "lat"]
MAX_OPEN_FILES = 64


def departement(code_insee):
    return code_insee[:3] if code_insee.startswith(("97", "98")) else code_insee[:2]


def main(source, out_dir):
    out = Path(out_dir)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    handles = OrderedDict()  # code INSEE -> (fichier, writer), fermés au-delà de MAX_OPEN_FILES
    created = set()
    rows = 0
    with gzip.open(source, "rt", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            code = row["code_insee"]
            if code not in handles:
                path = out / departement(code) / f"{code}.csv"
                path.parent.mkdir(exist_ok=True)
                fh = open(path, "a", encoding="utf-8", newline="")
                writer = csv.writer(fh, delimiter=";", lineterminator="\n")
                if code not in created:
                    writer.writerow(COLUMNS)
                    created.add(code)
                handles[code] = (fh, writer)
                if len(handles) > MAX_OPEN_FILES:
                    handles.popitem(last=False)[1][0].close()
            else:
                handles.move_to_end(code)
            handles[code][1].writerow([row[c] for c in COLUMNS])
            rows += 1
    for fh, _ in handles.values():
        fh.close()

    deps = sorted(p.name for p in out.iterdir() if p.is_dir())
    print(f"{rows} adresses, {len(created)} communes, {len(deps)} départements -> {out}")


if __name__ == "__main__":
    main(*sys.argv[1:3])

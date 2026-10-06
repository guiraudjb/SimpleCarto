"""Ajoute les arrondissements municipaux (Paris, Lyon, Marseille) au fond communal.

Les contours source (GeoJSON, ex. geo.api.gouv.fr
`/communes?type=arrondissement-municipal&format=geojson&geometry=contour`)
sont découpés sur le polygone de la commune parente déjà présent dans la
topologie, puis les interstices restants sont rattachés à l'arrondissement
voisin : l'union des arrondissements recouvre donc exactement la commune et
reste alignée sur les communes limitrophes.

Le résultat est ajouté comme second objet `arrondissement_municipal` de la
topologie (arcs propres, non partagés), sans toucher à l'objet communal.

Usage : python add_arrondissements.py data/commune_2025.json arm.geojson
Dépendance : shapely.
"""
import json
import sys

from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

OBJECT_NAME = "arrondissement_municipal"


def decode_arcs(topo):
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x, y))
        arcs.append(pts)
    return arcs


def ring_coords(arcs, indices):
    coords = []
    for i in indices:
        pts = arcs[i] if i >= 0 else arcs[~i][::-1]
        coords.extend(pts if not coords else pts[1:])
    return coords


def topo_geometry(arcs, geom):
    polys = geom["arcs"] if geom["type"] == "MultiPolygon" else [geom["arcs"]]
    parts = [Polygon(ring_coords(arcs, p[0]), [ring_coords(arcs, r) for r in p[1:]]) for p in polys]
    return unary_union(parts)


def to_quantized(geom, transform):
    (sx, sy), (tx, ty) = transform["scale"], transform["translate"]

    def conv(ring):
        return [((lon - tx) / sx, (lat - ty) / sy) for lon, lat in ring]

    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    return unary_union([Polygon(conv(p[0]), [conv(r) for r in p[1:]]) for p in polys]).buffer(0)


def polygons(geom):
    if isinstance(geom, Polygon):
        return [geom] if not geom.is_empty else []
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon) and not g.is_empty]


def encode_ring(coords, out_arcs):
    pts = []
    for x, y in coords:
        p = (round(x), round(y))
        if not pts or p != pts[-1]:
            pts.append(p)
    if len(pts) < 4:
        return None
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    delta, prev = [], (0, 0)
    for p in pts:
        delta.append([p[0] - prev[0], p[1] - prev[1]])
        prev = p
    out_arcs.append(delta)
    return len(out_arcs) - 1


def encode_geometry(geom, out_arcs):
    encoded = []
    for poly in polygons(geom):
        rings = [encode_ring(poly.exterior.coords, out_arcs)]
        if rings[0] is None:
            continue
        rings += [i for i in (encode_ring(r.coords, out_arcs) for r in poly.interiors) if i is not None]
        encoded.append([[i] for i in rings])
    if len(encoded) == 1:
        return {"type": "Polygon", "arcs": encoded[0]}
    return {"type": "MultiPolygon", "arcs": encoded}


def main(topo_path, arm_path):
    with open(topo_path, encoding="utf-8") as f:
        topo = json.load(f)
    if OBJECT_NAME in topo["objects"]:
        sys.exit(f"L'objet {OBJECT_NAME} existe déjà dans {topo_path}.")
    with open(arm_path, encoding="utf-8") as f:
        source = json.load(f)["features"]

    arcs = decode_arcs(topo)
    communes = next(iter(topo["objects"].values()))["geometries"]
    by_code = {g["properties"]["code_insee"]: g for g in communes}

    by_parent = {}
    for feat in sorted(source, key=lambda f: f["properties"]["code"]):
        by_parent.setdefault(feat["properties"]["codeParent"], []).append(feat)

    geometries = []
    for parent_code, feats in sorted(by_parent.items()):
        parent = by_code[parent_code]
        parent_shape = topo_geometry(arcs, parent).buffer(0)

        clipped, taken = [], Polygon()
        for feat in feats:
            piece = to_quantized(feat["geometry"], topo["transform"]).intersection(parent_shape).difference(taken)
            clipped.append(piece)
            taken = taken.union(piece)

        # Interstices entre la commune (simplifiée) et les arrondissements :
        # chacun rejoint l'arrondissement avec lequel il partage le plus de surface.
        for gap in polygons(parent_shape.difference(taken)):
            halo = gap.buffer(1.0)
            best = max(range(len(clipped)), key=lambda i: halo.intersection(clipped[i]).area)
            clipped[best] = clipped[best].union(gap)

        pp = parent["properties"]
        for feat, piece in zip(feats, clipped):
            sp = feat["properties"]
            geom = encode_geometry(piece, topo["arcs"])
            geom["properties"] = {
                "nom_officiel": sp["nom"],
                "statut": "Arrondissement municipal",
                "code_insee": sp["code"],
                "code_insee_de_la_commune_parente": parent_code,
                "population": sp.get("population"),
                "code_insee_de_l_arrondissement": pp.get("code_insee_de_l_arrondissement"),
                "code_insee_du_departement": pp.get("code_insee_du_departement"),
                "code_insee_de_la_region": pp.get("code_insee_de_la_region"),
                "codes_siren_des_epci": pp.get("codes_siren_des_epci"),
            }
            geometries.append(geom)
        print(f"{parent_code} {pp['nom_officiel']} : {len(feats)} arrondissements, "
              f"écart de surface {abs(unary_union(clipped).area - parent_shape.area):.3f}")

    topo["objects"][OBJECT_NAME] = {"type": "GeometryCollection", "geometries": geometries}
    with open(topo_path, "w", encoding="utf-8") as f:
        json.dump(topo, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main(*sys.argv[1:3])

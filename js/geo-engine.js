/**
 * SimpleCarto - Moteur cartographique (D3.js)
 * Extrait et adapté du module cartographique de PLUME.
 * Aucune dépendance réseau : toutes les données sont lues dans ./data/
 */

let geoReferential = { loaded: false, communes: [], epci: [], worldRegions: [], comToDep: new Map(), comToEpci: new Map() };

const REGIONS_DICT = {
    "11": "Île-de-France", "24": "Centre-Val de Loire", "27": "Bourgogne-Franche-Comté",
    "28": "Normandie", "32": "Hauts-de-France", "44": "Grand Est", "52": "Pays de la Loire",
    "53": "Bretagne", "75": "Nouvelle-Aquitaine", "76": "Occitanie", "84": "Auvergne-Rhône-Alpes",
    "93": "Provence-Alpes-Côte d'Azur", "94": "Corse", "01": "Guadeloupe", "02": "Martinique",
    "03": "Guyane", "04": "La Réunion", "06": "Mayotte"
};

const DEPARTEMENTS_DICT = {
    "01": "Ain", "02": "Aisne", "03": "Allier", "04": "Alpes-de-Haute-Provence", "05": "Hautes-Alpes", "06": "Alpes-Maritimes", "07": "Ardèche", "08": "Ardennes", "09": "Ariège", "10": "Aube", "11": "Aude", "12": "Aveyron", "13": "Bouches-du-Rhône", "14": "Calvados", "15": "Cantal", "16": "Charente", "17": "Charente-Maritime", "18": "Cher", "19": "Corrèze", "2A": "Corse-du-Sud", "2B": "Haute-Corse", "21": "Côte-d'Or", "22": "Côtes-d'Armor", "23": "Creuse", "24": "Dordogne", "25": "Doubs", "26": "Drôme", "27": "Eure", "28": "Eure-et-Loir", "29": "Finistère", "30": "Gard", "31": "Haute-Garonne", "32": "Gers", "33": "Gironde", "34": "Hérault", "35": "Ille-et-Vilaine", "36": "Indre", "37": "Indre-et-Loire", "38": "Isère", "39": "Jura", "40": "Landes", "41": "Loir-et-Cher", "42": "Loire", "43": "Haute-Loire", "44": "Loire-Atlantique", "45": "Loiret", "46": "Lot", "47": "Lot-et-Garonne", "48": "Lozère", "49": "Maine-et-Loire", "50": "Manche", "51": "Marne", "52": "Haute-Marne", "53": "Mayenne", "54": "Meurthe-et-Moselle", "55": "Meuse", "56": "Morbihan", "57": "Moselle", "58": "Nièvre", "59": "Nord", "60": "Oise", "61": "Orne", "62": "Pas-de-Calais", "63": "Puy-de-Dôme", "64": "Pyrénées-Atlantiques", "65": "Hautes-Pyrénées", "66": "Pyrénées-Orientales", "67": "Bas-Rhin", "68": "Haut-Rhin", "69": "Rhône", "70": "Haute-Saône", "71": "Saône-et-Loire", "72": "Sarthe", "73": "Savoie", "74": "Haute-Savoie", "75": "Paris", "76": "Seine-Maritime", "77": "Seine-et-Marne", "78": "Yvelines", "79": "Deux-Sèvres", "80": "Somme", "81": "Tarn", "82": "Tarn-et-Garonne", "83": "Var", "84": "Vaucluse", "85": "Vendée", "86": "Vienne", "87": "Haute-Vienne", "88": "Vosges", "89": "Yonne", "90": "Territoire de Belfort", "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise", "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion", "976": "Mayotte"
};

// Arrondissements municipaux (absents du COG chargé) : commune parente ->
// [département, premier code INSEE, nombre d'arrondissements].
const MUNICIPAL_ARRONDISSEMENTS = {
    "75056": ["75", 75101, 20], "69123": ["69", 69381, 9], "13055": ["13", 13201, 16]
};

const PALETTE_SCALES = {
    divergentDescending: d3.interpolateRgbBasis(["#298641", "#EFB900", "#E91719"]),
    divergentAscending: d3.interpolateRgbBasis(["#E91719", "#EFB900", "#298641"])
};

const DEFAULT_MAP_COLORS = { background: '#ffffff', context: '#f8f9fa', noData: '#e5e5e5' };

const frenchNumberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

function getSafeCol(row, expectedKey) {
    if (!row) return "";
    if (row[expectedKey] !== undefined) return String(row[expectedKey]).trim();
    const keys = Object.keys(row);
    const matchingKey = keys.find(k => k.includes(expectedKey));
    return matchingKey ? String(row[matchingKey]).trim() : String(Object.values(row)[0] || "").trim();
}

async function loadMapReferentials() {
    if (geoReferential.loaded) return;
    const [communesData, epciData, worldData] = await Promise.all([
        fetchCSV('./data/v_commune_2025.csv', ','),
        fetchCSV('./data/EPCI_2025.csv', ';'),
        d3.json('./data/world_region_list.json')
    ]);
    geoReferential.communes = communesData;
    geoReferential.epci = epciData;
    geoReferential.worldRegions = worldData || [];
    communesData.forEach(c => geoReferential.comToDep.set(getSafeCol(c, 'COM'), getSafeCol(c, 'DEP')));
    epciData.forEach(e => geoReferential.comToEpci.set(getSafeCol(e, 'CODGEO'), getSafeCol(e, 'EPCI')));
    Object.entries(MUNICIPAL_ARRONDISSEMENTS).forEach(([parent, [dep, first, count]]) => {
        for (let i = 0; i < count; i++) {
            const code = String(first + i);
            geoReferential.comToDep.set(code, dep);
            geoReferential.comToEpci.set(code, geoReferential.comToEpci.get(parent));
        }
    });
    geoReferential.loaded = true;
}

function fetchCSV(url, delimiter = ",") {
    return new Promise((resolve, reject) => {
        Papa.parse(url, { download: true, header: true, delimiter: delimiter, skipEmptyLines: true, complete: res => resolve(res.data), error: err => reject(err) });
    });
}

// Normalise un code INSEE du CSV (zéro initial perdu par les tableurs) et, aux
// échelles affichées par département, ramène un code commune à son département.
function resolveTargetCode(rawCode, targetScale) {
    let sourceCode = String(rawCode || "").trim();
    if (!sourceCode) return null;
    if (sourceCode.length === 1 || sourceCode.length === 4) sourceCode = "0" + sourceCode;
    if (targetScale === 'national' || targetScale === 'region') {
        return (sourceCode.length >= 4) ? geoReferential.comToDep.get(sourceCode) : sourceCode;
    }
    return sourceCode;
}

function computeValorAggregation(rawData, targetScale, calcMode, colCode, col1, col2) {
    const aggregatedData = new Map();
    let globalTotalCol1 = 0;

    rawData.forEach(row => {
        const targetCode = resolveTargetCode(row[colCode], targetScale);
        if (!targetCode) return;
        if (!aggregatedData.has(targetCode)) aggregatedData.set(targetCode, { val1: 0, val2: 0 });

        const acc = aggregatedData.get(targetCode);
        const v1 = parseFloat(String(row[col1]).replace(',', '.')) || 0;
        const v2 = col2 ? (parseFloat(String(row[col2]).replace(',', '.')) || 0) : 0;
        acc.val1 += v1; acc.val2 += v2; globalTotalCol1 += v1;
    });

    const finalMap = new Map();
    aggregatedData.forEach((acc, code) => {
        let val = 0;
        if (calcMode === 'simple' || calcMode === 'sum') val = acc.val1;
        else if (calcMode === 'ratio') val = acc.val2 !== 0 ? acc.val1 / acc.val2 : 0;
        else if (calcMode === 'growth') val = acc.val1 !== 0 ? ((acc.val2 - acc.val1) / acc.val1) * 100 : 0;
        else if (calcMode === 'share') val = globalTotalCol1 !== 0 ? (acc.val1 / globalTotalCol1) * 100 : 0;
        finalMap.set(String(code), val);
    });
    return finalMap;
}

// Texte d'étiquette issu d'une colonne du CSV : premier texte non vide par zone.
function computeTextMap(rawData, targetScale, colCode, textCol) {
    const textMap = new Map();
    rawData.forEach(row => {
        const targetCode = resolveTargetCode(row[colCode], targetScale);
        const text = String(row[textCol] ?? "").trim();
        if (targetCode && text && !textMap.has(targetCode)) textMap.set(targetCode, text);
    });
    return textMap;
}

// Découpe un titre en lignes : respecte les retours à la ligne manuels (\n)
// puis, dans chaque segment, ajoute des retours automatiques si le texte
// dépasse la largeur disponible (mesure réelle via getComputedTextLength).
function wrapTitleLines(svg, text, maxWidth, fontSize, fontFamily) {
    if (!text) return [];

    const measurer = svg.append("text")
        .style("font-weight", "bold")
        .style("font-size", `${fontSize}px`)
        .style("font-family", fontFamily)
        .style("opacity", 0);

    const manualLines = text.replace(/\r\n/g, "\n").split("\n");
    const wrapped = [];

    manualLines.forEach(manualLine => {
        const words = manualLine.split(/\s+/).filter(Boolean);
        if (words.length === 0) { wrapped.push(""); return; }

        let currentLine = "";
        words.forEach(word => {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            measurer.text(testLine);
            const testWidth = measurer.node().getComputedTextLength();
            if (testWidth > maxWidth && currentLine) {
                wrapped.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        });
        if (currentLine) wrapped.push(currentLine);
    });

    measurer.remove();
    return wrapped;
}

function forceRectCollide(padding) {
    let nodes;
    function force(alpha) {
        const quad = d3.quadtree().x(d => d.x).y(d => d.y).addAll(nodes);
        for (const d of nodes) {
            quad.visit((q, x1, y1, x2, y2) => {
                if (!q.length && q.data !== d) {
                    const d2 = q.data, w = (d.width + d2.width) / 2 + padding, h = (d.height + d2.height) / 2 + padding;
                    let x = d.x - d2.x, y = d.y - d2.y, absX = Math.abs(x), absY = Math.abs(y);
                    if (absX < w && absY < h) {
                        const lx = (w - absX) / w, ly = (h - absY) / h;
                        if (lx < ly) { x *= lx * alpha; d.x += x; d2.x -= x; }
                        else { y *= ly * alpha; d.y += y; d2.y -= y; }
                    }
                }
                return x1 > d.x + d.width/2 || x2 < d.x - d.width/2 || y1 > d.y + d.height/2 || y2 < d.y - d.height/2;
            });
        }
    }
    force.initialize = _ => nodes = _;
    return force;
}

// Bornes lon/lat exactes de l'image data/relief_france.png (requête WMS IGN d'origine)
const RELIEF_BOUNDS = { lonMin: -5.2, latMin: 41.2, lonMax: 9.7, latMax: 51.3 };
const roadDataCache = new Map();

// Les images référencées dans le SVG de la carte (relief, icônes d'épingles) y sont
// intégrées en data URL : html2canvas ne charge pas les href externes d'un SVG,
// elles disparaîtraient de l'export PNG.
const dataUrlCache = new Map();

function loadDataUrl(url) {
    if (!dataUrlCache.has(url)) {
        dataUrlCache.set(url, fetch(url)
            .then(res => { if (!res.ok) throw new Error(res.status); return res.blob(); })
            .then(blob => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            }))
            .catch(() => { dataUrlCache.delete(url); return null; }));
    }
    return dataUrlCache.get(url);
}

function loadReliefDataUrl() {
    return loadDataUrl('./data/relief_france.png');
}

// Chemin d'une icône illustrée (jeu Krea 2) d'après son identifiant, ou null si inconnue.
function k2IconPath(iconId) {
    if (!iconId || typeof K2_PICTOGRAM_ICONS === 'undefined') return null;
    const icon = K2_PICTOGRAM_ICONS.find(i => i.id === iconId);
    return icon ? `./icons/pictograms-k2/${icon.category}/${icon.file}` : null;
}

async function loadPinIconDataUrls(pins) {
    const ids = [...new Set(pins.map(p => p.icon).filter(Boolean))];
    const urls = await Promise.all(ids.map(id => {
        const path = k2IconPath(id);
        return path ? loadDataUrl(path) : null;
    }));
    return new Map(ids.map((id, i) => [id, urls[i]]).filter(([, url]) => url));
}

// Découpe l'image de relief en grille et positionne chaque tuile via la projection D3
// courante (recalculée à chaque rendu) : évite une reprojection matricielle complète,
// suffisant pour un calque décoratif à faible emphase. L'image n'est décodée qu'une
// seule fois (<defs><image>) et chaque tuile la référence via <use> — l'embarquer en
// base64 dans chacune des tuiles ferait exploser la mémoire et gèlerait le rendu.
const RELIEF_IMG_WIDTH = 2400, RELIEF_IMG_HEIGHT = 1700;

function drawReliefTiles(svg, gRelief, projection, imgDataUrl) {
    const GRID_N = 8, GRID_M = 6;
    const { lonMin, latMin, lonMax, latMax } = RELIEF_BOUNDS;
    const defImageId = 'relief-img-' + Math.random().toString(36).slice(2, 9);
    svg.append("defs").append("image")
        .attr("id", defImageId)
        .attr("href", imgDataUrl)
        .attr("width", RELIEF_IMG_WIDTH).attr("height", RELIEF_IMG_HEIGHT);

    const srcTileW = RELIEF_IMG_WIDTH / GRID_N, srcTileH = RELIEF_IMG_HEIGHT / GRID_M;

    for (let j = 0; j < GRID_M; j++) {
        for (let i = 0; i < GRID_N; i++) {
            const lon0 = lonMin + (i / GRID_N) * (lonMax - lonMin);
            const lon1 = lonMin + ((i + 1) / GRID_N) * (lonMax - lonMin);
            const lat1 = latMax - (j / GRID_M) * (latMax - latMin);
            const lat0 = latMax - ((j + 1) / GRID_M) * (latMax - latMin);
            const topLeft = projection([lon0, lat1]);
            const bottomRight = projection([lon1, lat0]);
            if (!topLeft || !bottomRight || Number.isNaN(topLeft[0]) || Number.isNaN(bottomRight[1])) continue;
            const [sx0, sy0] = topLeft, [sx1, sy1] = bottomRight;
            const screenW = sx1 - sx0, screenH = sy1 - sy0;
            if (!(screenW > 0) || !(screenH > 0)) continue;
            const scaleX = screenW / srcTileW, scaleY = screenH / srcTileH;
            const tileSvg = gRelief.append("svg")
                .attr("x", sx0).attr("y", sy0).attr("width", screenW).attr("height", screenH)
                .attr("overflow", "hidden");
            tileSvg.append("use")
                .attr("href", `#${defImageId}`)
                .attr("transform", `translate(${-i * srcTileW * scaleX}, ${-j * srcTileH * scaleY}) scale(${scaleX}, ${scaleY})`);
        }
    }
}

async function loadRoadData(config) {
    let url = null;
    if (['national', 'region', 'region-communes'].includes(config.scale)) {
        url = './data/roads_national.json';
    } else if (['departement', 'epci', 'commune'].includes(config.scale) && config.dept) {
        url = `./data/roads/dept/${config.dept}.json`;
    }
    if (!url) return null;
    if (roadDataCache.has(url)) return roadDataCache.get(url);
    try {
        const topo = await d3.json(url);
        const key = Object.keys(topo.objects)[0];
        const features = topojson.feature(topo, topo.objects[key]).features;
        roadDataCache.set(url, features);
        return features;
    } catch (e) {
        console.warn('Réseau routier indisponible pour', url, e);
        return null;
    }
}

// Calques statiques France entière (un seul fichier, toujours le même quelle que soit
// l'échelle) : hydrographie, voies ferrées (topojson) et aéroports/villes (points bruts).
const staticTopoCache = new Map();
async function loadStaticTopoLayer(url) {
    if (staticTopoCache.has(url)) return staticTopoCache.get(url);
    try {
        const topo = await d3.json(url);
        const key = Object.keys(topo.objects)[0];
        const features = topojson.feature(topo, topo.objects[key]).features;
        staticTopoCache.set(url, features);
        return features;
    } catch (e) {
        console.warn('Calque indisponible pour', url, e);
        return null;
    }
}

const pointLayerCache = new Map();
async function loadPointLayer(url) {
    if (pointLayerCache.has(url)) return pointLayerCache.get(url);
    try {
        const data = await d3.json(url);
        pointLayerCache.set(url, data);
        return data;
    } catch (e) {
        console.warn('Calque indisponible pour', url, e);
        return null;
    }
}

function projectPoints(points, projection) {
    return points.map(p => {
        const xy = projection([p.lon, p.lat]);
        return (xy && !Number.isNaN(xy[0]) && !Number.isNaN(xy[1])) ? { ...p, x: xy[0], y: xy[1] } : null;
    }).filter(Boolean);
}

function appendMergedLinePath(container, path, features) {
    const geom = { type: "GeometryCollection", geometries: features.map(f => f.geometry) };
    container.append("path").attr("d", path(geom));
}

// Relief et routes sont limités à la France métropolitaine (pas de vendorisation
// mondiale, pas de pertinence pour l'outre-mer avec ces jeux de données).
function isMetropolitanScope(config) {
    if (config.scale === 'world') return false;
    if (['region', 'region-communes'].includes(config.scale) && ['01', '02', '03', '04', '06'].includes(String(config.region))) return false;
    if (config.dept && String(config.dept).startsWith('97')) return false;
    return true;
}

// Épingles géolocalisées (lon/lat WGS84) : point coloré, texte optionnel à côté,
// et encadré de légende (en bas à gauche) regroupant les couples couleur/légende
// des épingles visibles dans le cadre.
const PIN_LEGEND_MAX_ENTRIES = 12;

function drawPins(svg, config, projection, width, height, iconUrls) {
    const radius = config.pinSize || 5;
    const iconSize = config.pinIconSize || 28;
    const labelFont = `"${config.labelFont || DEFAULT_FONT}", 'Segoe UI', Arial, sans-serif`;
    const pts = projectPoints(config.pins, projection)
        .filter(p => p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height)
        .map(p => ({ ...p, iconUrl: iconUrls.get(p.icon) || null }));
    const halfExtent = d => d.iconUrl ? iconSize / 2 : radius;

    const gPins = svg.append("g").attr("class", "pins-layer");
    gPins.selectAll("circle").data(pts.filter(p => !p.iconUrl)).enter().append("circle")
        .attr("cx", d => d.x).attr("cy", d => d.y).attr("r", radius)
        .attr("fill", d => d.color).attr("stroke", "#ffffff").attr("stroke-width", 1.2);
    gPins.selectAll("image").data(pts.filter(p => p.iconUrl)).enter().append("image")
        .attr("href", d => d.iconUrl)
        .attr("x", d => d.x - iconSize / 2).attr("y", d => d.y - iconSize / 2)
        .attr("width", iconSize).attr("height", iconSize);

    if (config.showPinLabels !== false) {
        gPins.selectAll("text").data(pts.filter(p => p.label)).enter().append("text")
            .attr("x", d => d.x + halfExtent(d) + 3).attr("y", d => d.y + 3.5)
            .style("font-size", "10px").style("font-family", labelFont).style("font-weight", "700")
            .style("fill", "#1e1e1e")
            .attr("stroke", "#ffffff").attr("stroke-width", 2.5).attr("stroke-linejoin", "round")
            .style("paint-order", "stroke fill")
            .text(d => d.label);
    }

    if (config.showPinLegend === false) return;
    const entries = [];
    const seen = new Set();
    pts.forEach(p => {
        if (!p.label) return;
        const key = `${p.iconUrl ? p.icon : p.color}|${p.label}`;
        if (seen.has(key)) return;
        seen.add(key);
        entries.push({ color: p.color, label: p.label, iconUrl: p.iconUrl });
    });
    if (entries.length === 0) return;

    const shown = entries.slice(0, PIN_LEGEND_MAX_ENTRIES);
    const overflow = entries.length - shown.length;
    const lineH = 17, padX = 8, padY = 6;
    const rows = shown.length + (overflow > 0 ? 1 : 0);
    const boxH = padY * 2 + rows * lineH;
    const legend = svg.append("g").attr("class", "pins-legend")
        .attr("transform", `translate(12, ${height - 12 - boxH})`);
    const bg = legend.append("rect").attr("rx", 4)
        .attr("fill", "#ffffff").attr("fill-opacity", 0.88).attr("stroke", "#cccccc").attr("height", boxH);

    shown.forEach((e, i) => {
        const cy = padY + i * lineH + lineH / 2;
        if (e.iconUrl) {
            legend.append("image").attr("href", e.iconUrl)
                .attr("x", padX - 2).attr("y", cy - 7).attr("width", 14).attr("height", 14);
        } else {
            legend.append("circle").attr("cx", padX + 5).attr("cy", cy).attr("r", 5)
                .attr("fill", e.color).attr("stroke", "#ffffff").attr("stroke-width", 1);
        }
        legend.append("text").attr("x", padX + 15).attr("y", cy + 3.5)
            .style("font-size", "10px").style("font-family", labelFont).style("fill", "#1e1e1e")
            .text(e.label);
    });
    if (overflow > 0) {
        legend.append("text").attr("x", padX).attr("y", padY + shown.length * lineH + lineH / 2 + 3.5)
            .style("font-size", "10px").style("font-style", "italic").style("font-family", labelFont).style("fill", "#555555")
            .text(`+${overflow} autre${overflow > 1 ? 's' : ''}`);
    }
    bg.attr("width", legend.node().getBBox().width + padX * 2);
}

async function drawD3Map(container, config, dataMap) {
    const width = container.clientWidth, height = container.clientHeight;
    const pStrength = config.physStrength ?? 0.15;
    const pPadding = config.physPadding ?? 4;
    const pRatio = 0.62;
    const lSize = config.labelSize ?? 10;

    let jsonFile = './data/commune_2025.json';
    if (['national', 'region'].includes(config.scale)) jsonFile = './data/departement_2025.json';
    if (config.scale === 'world') jsonFile = './data/world_2025.json';

    let geoJSON;
    try { geoJSON = await d3.json(jsonFile); } catch (e) { return false; }

    container.innerHTML = '';
    let features = [];
    if (geoJSON.type === "Topology") {
        const key = Object.keys(geoJSON.objects)[0];
        features = topojson.feature(geoJSON, geoJSON.objects[key]).features;
        // Paris, Lyon et Marseille sont remplacées par leurs arrondissements
        // municipaux quand les données utilisent ces codes, ou à l'échelle commune.
        const armObj = geoJSON.objects.arrondissement_municipal;
        if (armObj) {
            const arms = topojson.feature(geoJSON, armObj).features;
            const parentOf = f => f.properties.code_insee_de_la_commune_parente;
            const detailed = new Set(arms.filter(f => config.scale === 'commune'
                || dataMap?.has(f.properties.code_insee) || config.labelTextMap?.has(f.properties.code_insee)).map(parentOf));
            features = features.filter(f => !detailed.has(f.properties.code_insee))
                .concat(arms.filter(f => detailed.has(parentOf(f))));
        }
    } else {
        features = geoJSON.features || [];
    }

    let validEpci = new Set();
    if (config.scale === 'epci' && config.epci) {
        geoReferential.epci.forEach(e => { if (getSafeCol(e, 'EPCI') === String(config.epci)) validEpci.add(getSafeCol(e, 'CODGEO')); });
    }

    const getIso = (d) => String(d.id || d.properties.iso_a3 || d.properties.ISO3 || d.properties.ADM0_A3 || "");

    let targetFeatures = features.filter(f => {
        const p = f.properties;
        const codeReg = String(p.code_insee_de_la_region || p.code_insee_region || p.reg || "");
        const codeDep = String(p.code_insee_du_departement || p.code_insee_departement || p.dep || "");
        const codeCom = String(p.code_insee_de_la_commune_parente || p.code_insee || p.code || "");

        if (['region', 'region-communes'].includes(config.scale) && config.region) return codeReg === String(config.region);
        if (config.scale === 'departement' && config.dept) return codeDep === String(config.dept);
        if (config.scale === 'epci' && config.epci) return validEpci.has(codeCom);
        if (config.scale === 'commune' && config.commune) return codeCom === String(config.commune);

        if (config.scale === 'world' && config.worldRegion && config.worldRegion !== 'all') {
            if (config.worldRegion === 'auto' && dataMap) return dataMap.has(getIso(f));
            const reg = geoReferential.worldRegions.find(r => r.code === config.worldRegion);
            return reg ? reg.countries.includes(getIso(f)) : true;
        }
        return true;
    });

    if (targetFeatures.length === 0) return false;

    const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);
    const mapColors = { ...DEFAULT_MAP_COLORS, ...config.mapColors };
    svg.append("rect").attr("width", width).attr("height", height).attr("fill", mapColors.background);

    // Zone de titre dynamique : retour à la ligne automatique (en plus des
    // retours manuels saisis par l'utilisateur), avec une hauteur réservée
    // qui s'adapte au nombre de lignes pour ne jamais chevaucher la carte.
    const titleFontFamily = `"${config.titleFont || DEFAULT_FONT}", 'Segoe UI', Arial, sans-serif`;
    const titleFontSize = config.titleFontSize || 17;
    const titleLineHeight = Math.round(titleFontSize * 1.3);
    const titleMaxWidth = Math.max(40, width - 40);
    const titleLines = wrapTitleLines(svg, config.title || '', titleMaxWidth, titleFontSize, titleFontFamily);
    const titleBlockHeight = titleLines.length > 0 ? (14 + titleLines.length * titleLineHeight + 10) : 24;

    let projection = (config.scale === 'world') ? d3.geoMercator().scale(1).translate([0,0]) : d3.geoConicConformal().center([2.45, 46.2]).scale(1).translate([0,0]);
    const path = d3.geoPath().projection(projection);

    let cameraFeatures = targetFeatures;
    if (config.scale === 'world') {
        const giants = ['FRA', 'RUS', 'USA', 'ATA'];
        const filteredCamera = targetFeatures.filter(f => !giants.includes(getIso(f)));
        if (filteredCamera.length > 0) cameraFeatures = filteredCamera;
    } else if (config.scale === 'national') {
        cameraFeatures = targetFeatures.filter(f => !String(f.properties.code_insee || "").startsWith('97'));
    }

    const bounds = path.bounds({type: "FeatureCollection", features: cameraFeatures});
    const availableMapHeight = Math.max(40, height - 40 - titleBlockHeight);
    const s = .85 / Math.max((bounds[1][0] - bounds[0][0]) / width, (bounds[1][1] - bounds[0][1]) / availableMapHeight);
    const t = [(width - s * (bounds[1][0] + bounds[0][0])) / 2, ((titleBlockHeight + height - 40) - s * (bounds[1][1] + bounds[0][1])) / 2];
    projection.scale(s).translate(t);

    const rootStyle = getComputedStyle(document.documentElement);
    const mainColor = rootStyle.getPropertyValue('--theme-sun').trim() || '#000091';
    const bgColor = rootStyle.getPropertyValue('--theme-bg').trim() || '#f5f5fe';

    const vals = dataMap && dataMap.size > 0 ? Array.from(dataMap.values()) : [0];
    let minVal = d3.min(vals) || 0, maxVal = d3.max(vals) || 0;
    if (minVal === maxVal) { minVal = 0; maxVal = maxVal || 100; }

    let colorScale;
    if (config.palette === 'custom' && config.customColors && config.customColors.length >= 2) {
        colorScale = d3.scaleSequential(d3.interpolateRgbBasis(config.customColors)).domain([minVal, maxVal]);
    } else if (config.palette && config.palette !== 'default' && PALETTE_SCALES[config.palette]) {
        colorScale = d3.scaleSequential(PALETTE_SCALES[config.palette]).domain([minVal, maxVal]);
    } else {
        colorScale = d3.scaleLinear().domain([minVal, maxVal]).range([bgColor, mainColor]);
    }

    let renderFeatures = features;
    if (['departement', 'epci', 'commune', 'region-communes'].includes(config.scale)) {
        renderFeatures = targetFeatures;
    }

    const g = svg.append("g");

    g.selectAll("path").data(renderFeatures).enter().append("path")
        .attr("d", path)
        .attr("fill", d => {
            const code = String((config.scale === 'world') ? getIso(d) : (d.properties.code_insee || d.properties.code || ""));
            if (!targetFeatures.includes(d)) return mapColors.context;
            return dataMap?.has(code) ? colorScale(dataMap.get(code)) : mapColors.noData;
        })
        .attr("stroke", d => targetFeatures.includes(d) ? "#ffffff" : d3.color(mapColors.context).darker(0.3).formatHex())
        .attr("stroke-width", d => targetFeatures.includes(d) ? 0.5 : 0.2);

    // Région détaillée à la commune : limites départementales internes en trait
    // plus épais pour garder des repères lisibles parmi des centaines de communes.
    if (config.scale === 'region-communes' && geoJSON.type === "Topology" && config.region) {
        const obj = geoJSON.objects[Object.keys(geoJSON.objects)[0]];
        const regionCode = String(config.region);
        const depOf = (geom) => String(geom.properties?.code_insee_du_departement || "");
        const regionObj = { ...obj, geometries: obj.geometries.filter(geom => String(geom.properties?.code_insee_de_la_region || "") === regionCode) };
        g.append("path")
            .datum(topojson.mesh(geoJSON, regionObj, (a, b) => a !== b && depOf(a) !== depOf(b)))
            .attr("d", path)
            .attr("fill", "none").attr("stroke", "#555555").attr("stroke-width", 1.2).attr("stroke-linejoin", "round");
    }

    const isMetro = isMetropolitanScope(config);
    const [reliefImg, hydroFeatures, railFeatures, roadFeatures, airportPoints, cityPoints] = await Promise.all([
        (isMetro && config.showRelief) ? loadReliefDataUrl() : null,
        (isMetro && config.showHydro) ? loadStaticTopoLayer('./data/hydro_france.json') : null,
        (isMetro && config.showRail) ? loadStaticTopoLayer('./data/rail_france.json') : null,
        (isMetro && config.showRoads) ? loadRoadData(config) : null,
        (isMetro && config.showAirports) ? loadPointLayer('./data/airports_france.json') : null,
        (isMetro && config.showCities) ? loadPointLayer('./data/cities_france.json') : null
    ]);

    if (reliefImg) {
        const clipId = 'geo-clip-' + Math.random().toString(36).slice(2, 9);
        svg.append("defs").append("clipPath").attr("id", clipId)
            .selectAll("path").data(targetFeatures).enter().append("path").attr("d", path);
        const gRelief = svg.append("g").attr("opacity", config.reliefOpacity ?? 0.6).attr("clip-path", `url(#${clipId})`);
        drawReliefTiles(svg, gRelief, projection, reliefImg);
    }
    if (hydroFeatures && hydroFeatures.length > 0) {
        const gHydro = svg.append("g").attr("fill", "none").attr("stroke", "#5b8dd6").attr("stroke-width", 0.8).attr("stroke-linecap", "round");
        appendMergedLinePath(gHydro, path, hydroFeatures);
    }
    if (railFeatures && railFeatures.length > 0) {
        const gRail = svg.append("g").attr("fill", "none").attr("stroke", "#333333").attr("stroke-width", 0.7).attr("stroke-dasharray", "4,2");
        appendMergedLinePath(gRail, path, railFeatures);
    }
    if (roadFeatures && roadFeatures.length > 0) {
        // Un unique <path> concaténant tous les tronçons : des dizaines de milliers
        // d'éléments <path> séparés (un par tronçon) font s'effondrer les perfs de
        // rendu SVG ; un seul path multi-segments se peint en un temps négligeable.
        const gRoads = svg.append("g")
            .attr("fill", "none").attr("stroke", "#6b3f1d").attr("stroke-width", 0.9).attr("stroke-opacity", 0.85).attr("stroke-linecap", "round");
        appendMergedLinePath(gRoads, path, roadFeatures);
    }
    if (airportPoints && airportPoints.length > 0) {
        const pts = projectPoints(airportPoints, projection);
        svg.append("g").attr("fill", "#3a3a3a").attr("stroke", "#ffffff").attr("stroke-width", 0.6)
            .selectAll("circle").data(pts).enter().append("circle")
            .attr("cx", d => d.x).attr("cy", d => d.y).attr("r", 3);
    }
    if (cityPoints && cityPoints.length > 0) {
        const pts = projectPoints(cityPoints, projection);
        const gCities = svg.append("g");
        gCities.selectAll("circle").data(pts).enter().append("circle")
            .attr("cx", d => d.x).attr("cy", d => d.y).attr("r", 2.5)
            .attr("fill", "#333333").attr("stroke", "#ffffff").attr("stroke-width", 0.6);
        // Les noms de villes ne sont affichés qu'aux échelles nationale/régionale, où les
        // étiquettes de données existantes sont peu denses ; à l'échelle département/EPCI/
        // commune elles saturaient l'espace déjà occupé par les étiquettes de données.
        if (['national', 'region'].includes(config.scale)) {
            gCities.selectAll("text").data(pts).enter().append("text")
                .attr("x", d => d.x + 4).attr("y", d => d.y + 3)
                .style("font-size", "9px").style("font-family", "'Segoe UI', Arial, sans-serif")
                .style("fill", "#333333")
                .text(d => d.name);
        }
    }

    if (Array.isArray(config.pins) && config.pins.length > 0) {
        drawPins(svg, config, projection, width, height, await loadPinIconDataUrls(config.pins));
    }

    const gLabels = svg.append("g");

    if (config.labelType !== 'none') {
        const labelNodes = [];
        const filterNames = config.labelFilterNames ? config.labelFilterNames.split(',').map(s => s.trim().toLowerCase()) : [];
        targetFeatures.forEach(d => {
            const centroid = path.centroid(d);
            if (isNaN(centroid[0])) return;

            const code = String((config.scale === 'world') ? getIso(d) : (d.properties.code_insee || d.properties.code || ""));

            const geoName = (config.scale === 'world')
                ? (d.properties.name_fr || d.properties.name || d.properties.NAME || "")
                : (d.properties.nom_officiel || d.properties.nom || d.properties.NOM || d.properties.libgeo || d.properties.LIBGEO || d.properties.nom_com || d.properties.nom_commune || d.properties.nom_dept || d.properties.nom_reg || d.properties.libelle || "");
            const name = config.labelTextMap?.get(code) || geoName;

            const rawValue = dataMap?.has(code) ? dataMap.get(code) : 0;
            const valText = dataMap?.has(code) ? frenchNumberFormat.format(rawValue) : "";

            let shouldDisplay = true;

            if (config.filterDataMap && !isNaN(config.filterThreshold)) {
                const fVal = config.filterDataMap.get(code) || 0;
                const op = config.filterOperator;
                const thresh = config.filterThreshold;

                if (op === '>') shouldDisplay = fVal > thresh;
                else if (op === '>=') shouldDisplay = fVal >= thresh;
                else if (op === '=') shouldDisplay = fVal === thresh;
                else if (op === '<=') shouldDisplay = fVal <= thresh;
                else if (op === '<') shouldDisplay = fVal < thresh;
            }

            if (shouldDisplay && filterNames.length > 0) {
                shouldDisplay = filterNames.some(f => name.toLowerCase().includes(f) || code.toLowerCase() === f);
            }

            if (!shouldDisplay) return;

            const textLen = (config.labelType === 'both') ? Math.max(name.length, valText.length) : (config.labelType === 'name' ? name.length : valText.length);
            if (textLen === 0) return;

            labelNodes.push({
                cx: centroid[0], cy: centroid[1], x: centroid[0], y: centroid[1],
                name, val: valText, width: textLen * (lSize * pRatio), height: lSize * (config.labelType === 'both' ? 2.4 : 1.2)
            });
        });
        const simulation = d3.forceSimulation(labelNodes)
            .force("x", d3.forceX(d => d.cx).strength(pStrength)).force("y", d3.forceY(d => d.cy).strength(pStrength))
            .force("collide", forceRectCollide(pPadding)).stop();
        for (let i = 0; i < 200; ++i) simulation.tick();

        gLabels.selectAll("text.label").data(labelNodes).enter().append("text")
            .attr("class", "label")
            .attr("x", d => d.x).attr("y", d => d.y).attr("text-anchor", "middle")
            .style("font-size", `${lSize}px`)
            .style("font-family", `"${config.labelFont || DEFAULT_FONT}", 'Segoe UI', Arial, sans-serif`)
            .style("font-weight", "700")
            .style("fill", mainColor)
            .attr("stroke", "#ffffff")
            .attr("stroke-width", lSize * 0.25)
            .attr("stroke-linejoin", "round")
            .style("paint-order", "stroke fill")
            .each(function(d) {
                const el = d3.select(this);
                if (config.labelType !== 'value') el.append("tspan").attr("x", d.x).attr("dy", config.labelType === 'both' ? "-0.2em" : "0.3em").text(d.name);
                if (config.labelType !== 'name') el.append("tspan").attr("x", d.x).attr("dy", config.labelType === 'both' ? "1.1em" : "0.3em").text(d.val);
            });
    }

    if (titleLines.length > 0) {
        const titleEl = svg.append("text")
            .attr("x", 20)
            .style("font-weight", "bold")
            .style("font-size", `${titleFontSize}px`)
            .style("font-family", titleFontFamily)
            .style("fill", mainColor);
        titleLines.forEach((line, idx) => {
            titleEl.append("tspan")
                .attr("x", 20)
                .attr("y", 14 + titleFontSize + idx * titleLineHeight)
                .text(line);
        });
    }

    if (dataMap && dataMap.size > 0 && minVal !== maxVal && config.showLegend !== false) {
        const legendWidth = 200, legendHeight = 12;
        const legendX = width - legendWidth - 30, legendY = height - 30;
        const defs = svg.append("defs");

        const gradId = 'map-grad-' + Math.random().toString(36).slice(2, 9);
        const grad = defs.append("linearGradient").attr("id", gradId).attr("x1","0%").attr("x2","100%");

        if (config.palette === 'custom' && config.customColors && config.customColors.length >= 2) {
            const interpolator = d3.interpolateRgbBasis(config.customColors);
            for(let i=0; i<=10; i++) grad.append("stop").attr("offset", `${i*10}%`).attr("stop-color", interpolator(i/10));
        } else if (config.palette !== 'default' && PALETTE_SCALES[config.palette]) {
            const interpolator = PALETTE_SCALES[config.palette];
            for(let i=0; i<=10; i++) grad.append("stop").attr("offset", `${i*10}%`).attr("stop-color", interpolator(i/10));
        } else {
            grad.append("stop").attr("offset", "0%").attr("stop-color", bgColor);
            grad.append("stop").attr("offset", "100%").attr("stop-color", mainColor);
        }

        const leg = svg.append("g").attr("transform", `translate(${legendX}, ${legendY})`);
        leg.append("rect").attr("width", legendWidth).attr("height", legendHeight).style("fill", `url(#${gradId})`).style("stroke", "#ccc");
        leg.append("text").attr("x", 0).attr("y", -6).style("font-size", "0.75rem").text(frenchNumberFormat.format(minVal));
        leg.append("text").attr("x", legendWidth).attr("y", -6).attr("text-anchor", "end").style("font-size", "0.75rem").text(frenchNumberFormat.format(maxVal));
    }
    return true;
}

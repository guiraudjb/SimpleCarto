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

const PALETTE_SCALES = {
    divergentDescending: d3.interpolateRgbBasis(["#298641", "#EFB900", "#E91719"]),
    divergentAscending: d3.interpolateRgbBasis(["#E91719", "#EFB900", "#298641"])
};

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
    geoReferential.loaded = true;
}

function fetchCSV(url, delimiter = ",") {
    return new Promise((resolve, reject) => {
        Papa.parse(url, { download: true, header: true, delimiter: delimiter, skipEmptyLines: true, complete: res => resolve(res.data), error: err => reject(err) });
    });
}

function computeValorAggregation(rawData, targetScale, calcMode, colCode, col1, col2) {
    const aggregatedData = new Map();
    let globalTotalCol1 = 0;

    rawData.forEach(row => {
        let sourceCode = String(row[colCode] || "").trim();
        if (!sourceCode) return;
        if (sourceCode.length === 1 || sourceCode.length === 4) sourceCode = "0" + sourceCode;

        let targetCode = sourceCode;
        if (targetScale === 'national' || targetScale === 'region') {
            targetCode = (sourceCode.length >= 4) ? geoReferential.comToDep.get(sourceCode) : sourceCode;
        }

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
        const codeCom = String(p.code_insee || p.code || "");

        if (config.scale === 'region' && config.region) return codeReg === String(config.region);
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
    const s = .85 / Math.max((bounds[1][0] - bounds[0][0]) / width, (bounds[1][1] - bounds[0][1]) / height);
    const t = [(width - s * (bounds[1][0] + bounds[0][0])) / 2, ((height - 40) - s * (bounds[1][1] + bounds[0][1])) / 2];
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
    if (['departement', 'epci', 'commune'].includes(config.scale)) {
        renderFeatures = targetFeatures;
    }

    const g = svg.append("g");

    g.selectAll("path").data(renderFeatures).enter().append("path")
        .attr("d", path)
        .attr("fill", d => {
            const code = String((config.scale === 'world') ? getIso(d) : (d.properties.code_insee || d.properties.code || ""));
            if (!targetFeatures.includes(d)) return "#f8f9fa";
            return dataMap?.has(code) ? colorScale(dataMap.get(code)) : "#e5e5e5";
        })
        .attr("stroke", d => targetFeatures.includes(d) ? "#ffffff" : "#f0f0f0")
        .attr("stroke-width", d => targetFeatures.includes(d) ? 0.5 : 0.2);

    if (config.labelType !== 'none') {
        const labelNodes = [];
        const filterNames = config.labelFilterNames ? config.labelFilterNames.split(',').map(s => s.trim().toLowerCase()) : [];
        targetFeatures.forEach(d => {
            const centroid = path.centroid(d);
            if (isNaN(centroid[0])) return;

            const code = String((config.scale === 'world') ? getIso(d) : (d.properties.code_insee || d.properties.code || ""));

            const name = (config.scale === 'world')
                ? (d.properties.name_fr || d.properties.name || d.properties.NAME || "")
                : (d.properties.nom_officiel || d.properties.nom || d.properties.NOM || d.properties.libgeo || d.properties.LIBGEO || d.properties.nom_com || d.properties.nom_commune || d.properties.nom_dept || d.properties.nom_reg || d.properties.libelle || "");

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

        g.selectAll("text.label").data(labelNodes).enter().append("text")
            .attr("class", "label")
            .attr("x", d => d.x).attr("y", d => d.y).attr("text-anchor", "middle")
            .style("font-size", `${lSize}px`)
            .style("font-family", "'Segoe UI', Arial, sans-serif")
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

    svg.append("text").attr("x", 20).attr("y", 35).style("font-weight", "bold").style("font-size", "1.1rem").style("fill", mainColor).text(config.title);

    if (dataMap && dataMap.size > 0 && minVal !== maxVal && config.showLegend !== false) {
        const legendWidth = 200, legendHeight = 12;
        const legendX = width - legendWidth - 30, legendY = height - 30;
        const defs = svg.append("defs");

        const grad = defs.append("linearGradient").attr("id", "map-grad").attr("x1","0%").attr("x2","100%");

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
        leg.append("rect").attr("width", legendWidth).attr("height", legendHeight).style("fill", "url(#map-grad)").style("stroke", "#ccc");
        leg.append("text").attr("x", 0).attr("y", -6).style("font-size", "0.75rem").text(frenchNumberFormat.format(minVal));
        leg.append("text").attr("x", legendWidth).attr("y", -6).attr("text-anchor", "end").style("font-size", "0.75rem").text(frenchNumberFormat.format(maxVal));
    }
    return true;
}

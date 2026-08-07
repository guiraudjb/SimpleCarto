/**
 * SimpleCarto - Studio (interface utilisateur)
 * Contrôleur de la page : câble les champs du panneau au moteur de rendu (geo-engine.js).
 */

// Palette de couleurs suggérée pour le sélecteur manuel (dégradés départ/pivot/arrivée)
const SUGGESTED_COLORS = {
    bleu:     { bg: '#f5f5fe', main: '#6a6af4', sun: '#000091' },
    rouge:    { bg: '#fdf4f4', main: '#e18787', sun: '#c9191e' },
    orange:   { bg: '#fee9e5', main: '#e4794a', sun: '#755348' },
    jaune:    { bg: '#fef6e3', main: '#e3c53f', sun: '#716043' },
    vert:     { bg: '#c3fad5', main: '#3ec37a', sun: '#297254' },
    turquoise:{ bg: '#e5fbfd', main: '#3ec3cb', sun: '#006a6f' },
    violet:   { bg: '#fee7fc', main: '#c17dbc', sun: '#6e445a' },
    gris:     { bg: '#f6f6f6', main: '#aaaaaa', sun: '#3a3a3a' }
};

function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `<strong>${title}</strong><p>${message}</p>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast--fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

function buildColorSwatchGrid(pickerId, targetGridId) {
    const grid = document.getElementById(targetGridId);
    if (!grid) return;
    const intensities = [
        { key: 'bg',   label: 'clair'     },
        { key: 'main', label: 'principal' },
        { key: 'sun',  label: 'foncé'     }
    ];
    grid.innerHTML = Object.entries(SUGGESTED_COLORS).map(([key, p]) => {
        const swatches = intensities.map(({ key: iKey, label: iLabel }) =>
            `<div class="swatch-cell"
                data-picker="${pickerId}"
                data-color="${p[iKey]}"
                data-label="${key} (${iLabel})"
                title="${key} — ${iLabel}\n${p[iKey]}"
                style="background:${p[iKey]};">
            </div>`
        ).join('');
        return `<div class="swatch-row">
            <span class="swatch-row-label" title="${key}">${key}</span>
            ${swatches}
        </div>`;
    }).join('');
}

document.addEventListener('DOMContentLoaded', () => {

    // État
    let rawCsvData = [];
    let currentMapConfig = null;
    let currentMapData = null;
    let currentPictograms = [];
    let customColors = { from: SUGGESTED_COLORS.bleu.bg, to: SUGGESTED_COLORS.bleu.sun, mid: null, midEnabled: false };

    const regToDeps = new Map();
    const svgTextCache = new Map();

    // ---------------------------------------------------------------
    // PICTOGRAMMES THÉMATIQUES
    // Deux jeux d'icônes : OCHA Humanitarian Icons (domaine public)
    // et pictogrammes DSFR / Remix Icon (licence MIT / Apache 2.0)
    // ---------------------------------------------------------------
    const dsfrCategoryByFile = new Map();
    DSFR_PICTOGRAM_ICONS.forEach(i => dsfrCategoryByFile.set(i.file, i.category));

    function currentPictogramSet() {
        return document.getElementById('pictogram-set').value;
    }

    function populatePictogramSelect() {
        const sel = document.getElementById('pictogram-select');
        sel.innerHTML = '';
        const set = currentPictogramSet();
        const categories = set === 'dsfr' ? DSFR_PICTOGRAM_CATEGORIES : PICTOGRAM_CATEGORIES;
        const icons = set === 'dsfr' ? DSFR_PICTOGRAM_ICONS : PICTOGRAM_ICONS;

        categories.forEach(cat => {
            const catIcons = icons.filter(i => i.category === cat.id);
            if (catIcons.length === 0) return;
            const grp = document.createElement('optgroup');
            grp.label = cat.label;
            catIcons.forEach(icon => {
                const opt = document.createElement('option');
                opt.value = icon.file;
                opt.textContent = icon.name;
                grp.appendChild(opt);
            });
            sel.appendChild(grp);
        });

        document.getElementById('pictogram-color').style.display = set === 'dsfr' ? 'none' : 'block';
        document.getElementById('pictogram-dsfr-color').style.display = set === 'dsfr' ? 'block' : 'none';
    }

    // Construit le chemin d'accès et, pour les icônes DSFR (monochromes,
    // sans fill défini), la couleur à injecter par héritage SVG.
    function resolvePictogramSource(set, file, color) {
        if (set === 'dsfr') {
            const category = dsfrCategoryByFile.get(file);
            return { path: `./icons/pictograms-dsfr/${category}/${file}`, category, recolor: color };
        }
        return { path: `./icons/pictograms/${color}/${file}`, category: null, recolor: null };
    }

    async function getPictogramSvgText(path) {
        if (svgTextCache.has(path)) return svgTextCache.get(path);
        try {
            const res = await fetch(path);
            const text = await res.text();
            svgTextCache.set(path, text);
            return text;
        } catch (e) {
            console.error('Pictogramme introuvable :', path, e);
            return null;
        }
    }

    // Les SVG DSFR n'ont pas de fill explicite (hérité) : on l'injecte sur la balise <svg>.
    function applySvgRecolor(svgText, hexColor) {
        if (!hexColor) return svgText;
        return svgText.replace(/<svg /, `<svg fill="${hexColor}" `);
    }

    async function updatePictogramPreview() {
        const set = currentPictogramSet();
        const file = document.getElementById('pictogram-select').value;
        const frame = document.getElementById('pictogram-preview-frame');
        if (!file) { frame.innerHTML = ''; return; }
        const color = set === 'dsfr' ? document.getElementById('pictogram-dsfr-color').value : document.getElementById('pictogram-color').value;
        const { path, recolor } = resolvePictogramSource(set, file, color);
        let svgText = await getPictogramSvgText(path);
        if (svgText && recolor) svgText = applySvgRecolor(svgText, recolor);
        frame.innerHTML = svgText || '';
    }

    async function renderPictogramOverlay(container, pictograms) {
        container.querySelectorAll('.pictogram-marker').forEach(el => el.remove());
        for (let i = 0; i < pictograms.length; i++) {
            const p = pictograms[i];
            const { path, recolor } = resolvePictogramSource(p.set, p.file, p.color);
            let svgText = await getPictogramSvgText(path);
            if (!svgText) continue;
            if (recolor) svgText = applySvgRecolor(svgText, recolor);

            const marker = document.createElement('div');
            marker.className = 'pictogram-marker';
            marker.dataset.index = String(i);
            marker.title = p.file.replace('.svg', '').replace(/-/g, ' ');
            marker.style.left = `${p.x}px`;
            marker.style.top = `${p.y}px`;
            marker.style.width = `${p.size}px`;
            marker.style.height = `${p.size}px`;
            marker.innerHTML = svgText;
            container.appendChild(marker);
        }
    }

    document.getElementById('pictogram-set').onchange = () => {
        populatePictogramSelect();
        updatePictogramPreview();
    };
    populatePictogramSelect();
    updatePictogramPreview();
    document.getElementById('pictogram-select').onchange = updatePictogramPreview;
    document.getElementById('pictogram-color').onchange = updatePictogramPreview;
    document.getElementById('pictogram-dsfr-color').oninput = updatePictogramPreview;

    document.getElementById('btn-clear-pictograms').onclick = () => {
        currentPictograms = [];
        renderPictogramOverlay(document.getElementById('map-preview-area'), currentPictograms);
    };

    document.getElementById('map-preview-area').addEventListener('click', (e) => {
        const container = e.currentTarget;
        const marker = e.target.closest('.pictogram-marker');

        if (marker) {
            const idx = parseInt(marker.dataset.index, 10);
            currentPictograms.splice(idx, 1);
            renderPictogramOverlay(container, currentPictograms);
            return;
        }

        if (!currentMapConfig) {
            showToast("Action impossible", "Générez d'abord une carte (Actualiser la vue) avant d'y placer un pictogramme.", "warning");
            return;
        }

        const set = currentPictogramSet();
        const file = document.getElementById('pictogram-select').value;
        if (!file) return;

        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const color = set === 'dsfr' ? document.getElementById('pictogram-dsfr-color').value : document.getElementById('pictogram-color').value;
        const size = parseFloat(document.getElementById('pictogram-size').value) || 28;

        currentPictograms.push({ set, file, color, size, x, y });
        renderPictogramOverlay(container, currentPictograms);
    });

    function getCustomColorsArray() {
        const arr = [customColors.from];
        if (customColors.midEnabled && customColors.mid) arr.push(customColors.mid);
        arr.push(customColors.to);
        return arr;
    }

    function updateGradientPreview() {
        const el = document.getElementById('gradient-preview');
        if (!el) return;
        const colors = getCustomColorsArray();
        if (colors.length >= 2) el.style.background = `linear-gradient(to right, ${colors.join(', ')})`;
    }

    buildColorSwatchGrid('from', 'cp-from-grid');
    buildColorSwatchGrid('mid', 'cp-mid-grid');
    buildColorSwatchGrid('to', 'cp-to-grid');
    updateGradientPreview();

    const scaleSelect = document.getElementById('map-scale');
    const cascade = document.getElementById('cascade-menus');

    const updateUI = () => {
        cascade.innerHTML = '';

        const preview = document.getElementById('map-preview-area');
        const emptyState = document.getElementById('map-empty-state');
        if (preview) preview.innerHTML = '';
        if (emptyState) emptyState.style.display = 'flex';

        if (scaleSelect.value === 'world') {
            const sel = document.createElement('select'); sel.className = 'select-input'; sel.id = 'sel-world-region';
            sel.innerHTML = '<option value="all">🌍 Monde entier</option><option value="auto">✨ Auto-cadrage</option>';
            const cats = [...new Set(geoReferential.worldRegions.map(r => r.category))];
            cats.forEach(cat => {
                const grp = document.createElement('optgroup'); grp.label = cat;
                geoReferential.worldRegions.filter(r => r.category === cat).forEach(r => {
                    const opt = document.createElement('option'); opt.value = r.code; opt.textContent = r.name; grp.appendChild(opt);
                });
                sel.appendChild(grp);
            });
            cascade.appendChild(sel);

        } else if (scaleSelect.value !== 'national') {
            const createSelect = (id, defaultText) => { let s = document.createElement('select'); s.className = 'select-input'; s.id = id; s.innerHTML = `<option value="">${defaultText}</option>`; return s; };

            let selReg = createSelect('sel-region', '-- 1. Choisir la Région --');
            Object.entries(REGIONS_DICT).forEach(([c,n]) => { let o = document.createElement('option'); o.value=c; o.textContent=n; selReg.appendChild(o); });
            cascade.appendChild(selReg);

            let selDep, selEpci, selCom;
            if (['departement', 'epci', 'commune'].includes(scaleSelect.value)) { selDep = createSelect('sel-dept', '-- 2. Choisir le Département --'); selDep.disabled = true; cascade.appendChild(selDep); }
            if (scaleSelect.value === 'epci') { selEpci = createSelect('sel-epci', "-- 3. Choisir l'EPCI --"); selEpci.disabled = true; cascade.appendChild(selEpci); }
            if (scaleSelect.value === 'commune') { selCom = createSelect('sel-commune', '-- 3. Choisir la Commune --'); selCom.disabled = true; cascade.appendChild(selCom); }

            selReg.onchange = () => {
                if (selDep) {
                    selDep.innerHTML = '<option value="">-- 2. Choisir le Département --</option>';
                    selDep.disabled = !selReg.value;
                    if (selReg.value && regToDeps.has(selReg.value)) {
                        Array.from(regToDeps.get(selReg.value)).sort().forEach(d => { let o = document.createElement('option'); o.value=d; o.textContent = `${d} - ${DEPARTEMENTS_DICT[d] || ''}`; selDep.appendChild(o); });
                    }
                    if (selEpci) { selEpci.innerHTML = "<option value=\"\">-- 3. Choisir l'EPCI --</option>"; selEpci.disabled = true; }
                    if (selCom) { selCom.innerHTML = '<option value="">-- 3. Choisir la Commune --</option>'; selCom.disabled = true; }
                }
            };

            if (selDep) {
                selDep.onchange = () => {
                    let depVal = selDep.value;
                    if (selEpci) {
                        selEpci.innerHTML = "<option value=\"\">-- 3. Choisir l'EPCI --</option>";
                        selEpci.disabled = !depVal;
                        if (depVal) {
                            const uniqueEpci = new Map();
                            geoReferential.epci.forEach(r => {
                                if (getSafeCol(r, 'DEP') === depVal || getSafeCol(r, 'DEP').includes(depVal)) {
                                    const code = getSafeCol(r, 'EPCI');
                                    const name = r['LIBEPCI'] || r['libepci'] || r['nom'] || ("EPCI " + code);
                                    if (code && !uniqueEpci.has(code)) uniqueEpci.set(code, name);
                                }
                            });
                            Array.from(uniqueEpci.entries()).sort((a,b) => a[1].localeCompare(b[1])).forEach(([code, name]) => { let o = document.createElement('option'); o.value = code; o.textContent = `${name} (${code})`; selEpci.appendChild(o); });
                        }
                    }
                    if (selCom) {
                        selCom.innerHTML = '<option value="">-- 3. Choisir la Commune --</option>';
                        selCom.disabled = !depVal;
                        if (depVal) {
                            const uniqueCom = new Map();
                            geoReferential.communes.forEach(r => {
                                if (getSafeCol(r, 'DEP') === depVal) {
                                    const code = getSafeCol(r, 'COM');
                                    const name = getSafeCol(r, 'LIBELLE') || getSafeCol(r, 'NCC') || ("COM " + code);
                                    if (code && !uniqueCom.has(code)) uniqueCom.set(code, name);
                                }
                            });
                            Array.from(uniqueCom.entries()).sort((a,b) => a[1].localeCompare(b[1])).forEach(([code, name]) => { let o = document.createElement('option'); o.value = code; o.textContent = `${name} (${code})`; selCom.appendChild(o); });
                        }
                    }
                };
            }
        }
    };

    async function renderPreview() {
        const loader = document.getElementById('map-loader');
        const emptyState = document.getElementById('map-empty-state');

        if (loader) loader.style.display = 'flex';
        if (emptyState) emptyState.style.display = 'none';
        const showLegend = document.getElementById('map-show-legend').checked;

        setTimeout(async () => {
            let mapData = null;
            let filterMap = null;

            if (rawCsvData.length > 0) {
                const codeCol = Object.keys(rawCsvData[0])[0];
                mapData = computeValorAggregation(rawCsvData, scaleSelect.value, document.getElementById('calc-mode').value, codeCol, document.getElementById('calc-col1').value, document.getElementById('calc-col2').value);
                const fCol = document.getElementById('filter-col').value;
                if (fCol) {
                    filterMap = computeValorAggregation(rawCsvData, scaleSelect.value, 'simple', codeCol, fCol);
                }
            }

            const config = {
                scale: scaleSelect.value,
                worldRegion: document.getElementById('sel-world-region')?.value,
                region: document.getElementById('sel-region')?.value,
                dept: document.getElementById('sel-dept')?.value,
                epci: document.getElementById('sel-epci')?.value,
                commune: document.getElementById('sel-commune')?.value,
                title: document.getElementById('map-title')?.value,
                labelType: document.getElementById('label-type')?.value,
                showLegend: showLegend,
                palette: document.getElementById('map-palette')?.value || 'default',
                customColors: document.getElementById('map-palette')?.value === 'custom' ? getCustomColorsArray() : null,

                labelFilterNames: document.getElementById('label-filter-names')?.value,
                labelSize: parseFloat(document.getElementById('label-size')?.value) || 10,
                physPadding: parseFloat(document.getElementById('phys-padding')?.value) || 4,
                physStrength: parseFloat(document.getElementById('phys-strength')?.value) || 0.15,

                filterOperator: document.getElementById('filter-operator')?.value,
                filterCol: document.getElementById('filter-col')?.value,
                filterThreshold: parseFloat(document.getElementById('filter-value')?.value),
                filterDataMap: filterMap,
                pictograms: currentPictograms
            };

            currentMapConfig = config;
            currentMapData = mapData;

            const success = await drawD3Map(document.getElementById('map-preview-area'), config, mapData);

            if (!success) {
                showToast("Sélection incomplète", "Veuillez préciser la zone géographique à cartographier.", "warning");
                if (emptyState) emptyState.style.display = 'flex';
            } else {
                await renderPictogramOverlay(document.getElementById('map-preview-area'), currentPictograms);
            }

            if (loader) loader.style.display = 'none';
        }, 50);
    }

    scaleSelect.onchange = updateUI;
    document.getElementById('btn-map-refresh').onclick = renderPreview;

    document.getElementById('label-type').onchange = (e) => {
        document.getElementById('label-toolkit').style.display = e.target.value === 'none' ? 'none' : 'block';
    };

    document.getElementById('calc-mode').onchange = (e) => {
        document.getElementById('calc-col2').style.display = ['ratio', 'growth'].includes(e.target.value) ? 'block' : 'none';
    };

    function applyCsvData(data, headers, statusText) {
        rawCsvData = data;
        document.getElementById('csv-status').innerText = statusText;
        document.getElementById('calc-engine-ui').style.display = 'block';
        document.getElementById('label-insee-col').innerText = headers[0];
        const s1 = document.getElementById('calc-col1'), s2 = document.getElementById('calc-col2');
        s1.innerHTML = ''; s2.innerHTML = '';
        headers.slice(1).forEach(h => { const o = document.createElement('option'); o.value = h; o.textContent = h; s1.appendChild(o.cloneNode(true)); s2.appendChild(o); });
        document.getElementById('advanced-filter-ui').style.display = 'block';
        const filterCol = document.getElementById('filter-col');
        filterCol.innerHTML = '<option value="">-- Champ à filtrer (Optionnel) --</option>';
        headers.forEach(h => {
            const o = document.createElement('option');
            o.value = h; o.textContent = h;
            filterCol.appendChild(o);
        });
    }

    document.getElementById('map-csv-file').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        Papa.parse(file, { header: true, skipEmptyLines: true, complete: (res) => {
            applyCsvData(res.data, res.meta.fields, `✅ ${res.data.length} lignes importées.`);
        }});
        document.getElementById('csv-sample-select').value = '';
    };

    function loadSampleCsv(path, label) {
        return new Promise((resolve, reject) => {
            document.getElementById('csv-status').innerText = `⏳ Chargement de « ${label} »...`;
            Papa.parse(path, { download: true, header: true, skipEmptyLines: true, complete: (res) => {
                applyCsvData(res.data, res.meta.fields, `✅ ${res.data.length} lignes chargées — ${label}`);
                resolve(res);
            }, error: (err) => {
                showToast("Erreur", "Impossible de charger le fichier d'exemple.", "error");
                reject(err);
            }});
            document.getElementById('map-csv-file').value = '';
        });
    }

    document.getElementById('csv-sample-select').onchange = (e) => {
        const path = e.target.value;
        if (!path) return;
        const label = e.target.selectedOptions[0].textContent;
        loadSampleCsv(path, label);
    };

    document.getElementById('map-palette').onchange = (e) => {
        const val = e.target.value;
        document.getElementById('palette-warning').style.display = (val !== 'default' && val !== 'custom') ? 'block' : 'none';
        const customUI = document.getElementById('custom-palette-ui');
        customUI.style.display = val === 'custom' ? 'block' : 'none';
        if (val === 'custom') updateGradientPreview();
    };

    document.addEventListener('click', function(e) {
        const swatch = e.target.closest('.swatch-cell');
        if (!swatch) return;
        const picker = swatch.dataset.picker;
        const color  = swatch.dataset.color;
        const label  = swatch.dataset.label;

        document.querySelectorAll(`.swatch-cell[data-picker="${picker}"]`).forEach(s => {
            s.classList.remove('is-selected');
        });
        swatch.classList.add('is-selected');

        if (picker === 'from') {
            customColors.from = color;
            document.getElementById('cp-from-preview').style.background = color;
            document.getElementById('cp-from-label').textContent = `${label} — ${color}`;
        } else if (picker === 'mid') {
            customColors.mid = color;
            document.getElementById('cp-mid-preview').style.background = color;
            document.getElementById('cp-mid-label').textContent = `${label} — ${color}`;
        } else if (picker === 'to') {
            customColors.to = color;
            document.getElementById('cp-to-preview').style.background = color;
            document.getElementById('cp-to-label').textContent = `${label} — ${color}`;
        }
        updateGradientPreview();
    });

    document.getElementById('cp-mid-enabled').onchange = (e) => {
        customColors.midEnabled = e.target.checked;
        document.getElementById('cp-mid-panel').style.display = e.target.checked ? 'block' : 'none';
        updateGradientPreview();
    };

    // ---------------------------------------------------------------
    // TÉLÉCHARGEMENT PNG (remplace l'insertion dans un document PLUME)
    // ---------------------------------------------------------------
    document.getElementById('btn-download-png').onclick = () => {
        if (!currentMapConfig) {
            showToast("Action impossible", "Veuillez d'abord Actualiser la vue pour générer une carte.", "warning");
            return;
        }

        const loader = document.getElementById('map-loader');
        if (loader) {
            loader.querySelector('p').innerText = "Création de l'image haute définition...";
            loader.style.display = 'flex';
        }

        setTimeout(async () => {
            try {
                const hiddenDiv = document.createElement('div');
                hiddenDiv.style.position = 'absolute';
                hiddenDiv.style.left = '-9999px';
                hiddenDiv.style.width = '850px';
                hiddenDiv.style.height = '550px';
                hiddenDiv.style.background = '#fff';
                document.body.appendChild(hiddenDiv);

                await drawD3Map(hiddenDiv, currentMapConfig, currentMapData);
                await renderPictogramOverlay(hiddenDiv, currentMapConfig.pictograms || []);
                await new Promise(resolve => setTimeout(resolve, 50));

                const canvas = await html2canvas(hiddenDiv, {
                    scale: 2,
                    backgroundColor: "#ffffff",
                    useCORS: true,
                    logging: false
                });

                hiddenDiv.remove();

                const link = document.createElement('a');
                const safeTitle = (currentMapConfig.title || 'carte').replace(/[^a-z0-9\-_]+/gi, '_');
                link.download = `${safeTitle}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();

                showToast("Succès", "La carte a été téléchargée.", "success");
            } catch (error) {
                console.error("Erreur de capture :", error);
                showToast("Erreur", "Impossible de générer l'image de la carte.", "error");
            } finally {
                if (loader) loader.style.display = 'none';
            }
        }, 100);
    };

    // ---------------------------------------------------------------
    // EXPORT / IMPORT DE CONFIGURATION (remplace data-map-config)
    // ---------------------------------------------------------------
    document.getElementById('btn-export-config').onclick = () => {
        if (!currentMapConfig) {
            showToast("Action impossible", "Veuillez d'abord Actualiser la vue pour générer une carte.", "warning");
            return;
        }
        const payload = {
            config: { ...currentMapConfig, filterDataMap: undefined },
            data: currentMapData ? Array.from(currentMapData.entries()) : null,
            rawCsvData: rawCsvData
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = `simplecarto-config-${Date.now()}.json`;
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
        showToast("Export réussi", "La configuration a été téléchargée.", "success");
    };

    document.getElementById('btn-import-config').onclick = () => {
        document.getElementById('config-import-file').click();
    };

    document.getElementById('config-import-file').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const payload = JSON.parse(evt.target.result);
                const config = payload.config || {};

                currentPictograms = Array.isArray(config.pictograms)
                    ? config.pictograms.map(p => ({ set: 'ocha', ...p }))
                    : [];
                rawCsvData = payload.rawCsvData || [];
                if (rawCsvData.length > 0) {
                    const headers = Object.keys(rawCsvData[0]);
                    document.getElementById('csv-status').innerText = `✅ ${rawCsvData.length} lignes importées (config restaurée).`;
                    document.getElementById('calc-engine-ui').style.display = 'block';
                    document.getElementById('label-insee-col').innerText = headers[0];
                    const s1 = document.getElementById('calc-col1'), s2 = document.getElementById('calc-col2');
                    s1.innerHTML = ''; s2.innerHTML = '';
                    headers.slice(1).forEach(h => { const o = document.createElement('option'); o.value = h; o.textContent = h; s1.appendChild(o.cloneNode(true)); s2.appendChild(o); });
                    document.getElementById('advanced-filter-ui').style.display = 'block';
                    const filterCol = document.getElementById('filter-col');
                    filterCol.innerHTML = '<option value="">-- Champ à filtrer (Optionnel) --</option>';
                    headers.forEach(h => { const o = document.createElement('option'); o.value = h; o.textContent = h; filterCol.appendChild(o); });
                }

                document.getElementById('map-title').value = config.title || "";
                document.getElementById('map-scale').value = config.scale || "national";
                document.getElementById('label-type').value = config.labelType || "none";
                document.getElementById('map-show-legend').checked = config.showLegend !== false;
                document.getElementById('map-palette').value = config.palette || "default";
                document.getElementById('label-toolkit').style.display = config.labelType !== 'none' ? 'block' : 'none';
                if (config.labelSize) document.getElementById('label-size').value = config.labelSize;
                if (config.labelFilterNames) document.getElementById('label-filter-names').value = config.labelFilterNames;
                if (config.physPadding) document.getElementById('phys-padding').value = config.physPadding;
                if (config.physStrength) document.getElementById('phys-strength').value = config.physStrength;

                if (config.palette === 'custom' && config.customColors) {
                    const cols = config.customColors;
                    customColors.from = cols[0] || customColors.from;
                    customColors.to   = cols[cols.length - 1] || customColors.to;
                    if (cols.length >= 3) { customColors.mid = cols[1]; customColors.midEnabled = true; }
                    document.getElementById('custom-palette-ui').style.display = 'block';
                    document.getElementById('cp-from-preview').style.background = customColors.from;
                    document.getElementById('cp-to-preview').style.background   = customColors.to;
                    if (customColors.midEnabled) {
                        document.getElementById('cp-mid-enabled').checked = true;
                        document.getElementById('cp-mid-panel').style.display = 'block';
                        document.getElementById('cp-mid-preview').style.background = customColors.mid;
                    }
                    updateGradientPreview();
                }

                updateUI();
                setTimeout(() => {
                    if (config.scale && config.scale !== 'national' && config.scale !== 'world') {
                        const selReg = document.getElementById('sel-region');
                        if (selReg && config.region) { selReg.value = config.region; selReg.onchange(); }
                        setTimeout(() => {
                            const selDep = document.getElementById('sel-dept');
                            if (selDep && config.dept) { selDep.value = config.dept; selDep.onchange(); }
                            setTimeout(() => {
                                const selEpci = document.getElementById('sel-epci');
                                if (selEpci && config.epci) selEpci.value = config.epci;
                                const selCom = document.getElementById('sel-commune');
                                if (selCom && config.commune) selCom.value = config.commune;
                                renderPreview();
                            }, 50);
                        }, 50);
                    } else {
                        const selWorld = document.getElementById('sel-world-region');
                        if (selWorld && config.worldRegion) selWorld.value = config.worldRegion;
                        renderPreview();
                    }
                }, 100);

                showToast("Import réussi", "La configuration a été restaurée.", "success");
            } catch (err) {
                console.error(err);
                showToast("Erreur", "Fichier de configuration invalide.", "error");
            } finally {
                e.target.value = '';
            }
        };
        reader.readAsText(file);
    };

    // ---------------------------------------------------------------
    // INITIALISATION
    // ---------------------------------------------------------------
    (async function init() {
        try {
            await loadMapReferentials();
            geoReferential.communes.forEach(r => {
                let reg = getSafeCol(r, 'REG'), dep = getSafeCol(r, 'DEP');
                if (reg && dep) {
                    if (!regToDeps.has(reg)) regToDeps.set(reg, new Set());
                    regToDeps.get(reg).add(dep);
                }
            });
            updateUI();

            // Chargement par défaut : évolution de la population des départements de France (2020 → 2025)
            const defaultSample = document.getElementById('csv-sample-select');
            defaultSample.value = './data/samples/france_departements.csv';
            await loadSampleCsv(defaultSample.value, defaultSample.selectedOptions[0].textContent);

            document.getElementById('map-title').value = 'Évolution de la population en France entre 2020 et 2025';
            document.getElementById('calc-mode').value = 'growth';
            document.getElementById('calc-col1').value = 'Pop 2020';
            document.getElementById('calc-col2').value = 'Pop 2025';
            document.getElementById('calc-col2').style.display = 'block';

            const labelTypeSelect = document.getElementById('label-type');
            labelTypeSelect.value = 'value';
            document.getElementById('label-toolkit').style.display = 'block';

            document.getElementById('map-palette').value = 'divergentAscending';
            document.getElementById('palette-warning').style.display = 'block';

            await renderPreview();
        } catch (err) {
            console.error(err);
            showToast("Erreur de chargement", "Impossible de charger les référentiels géographiques (dossier data/).", "error");
        }
    })();
});

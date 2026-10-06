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
    let currentAnnotations = [];
    let currentPins = [];
    let pictogramPlacementArmed = false;
    let annotationPlacementArmed = false;
    let autoRefreshEnabled = false;
    let currentMapScale = 1;
    let customColors = { from: SUGGESTED_COLORS.bleu.bg, to: SUGGESTED_COLORS.bleu.sun, mid: null, midEnabled: false };

    const regToDeps = new Map();
    const svgTextCache = new Map();

    // ---------------------------------------------------------------
    // ADAPTATION DE LA CARTE À LA TAILLE DE LA FENÊTRE
    // La carte garde une taille logique fixe (850x550, nécessaire pour que
    // les coordonnées des pictogrammes/annotations restent cohérentes avec
    // l'export PNG) mais est affichée à l'échelle via transform:scale(),
    // recalculée à chaque redimensionnement de fenêtre.
    // ---------------------------------------------------------------
    function updateMapScale() {
        const previewArea = document.querySelector('.preview-area');
        const wrapper = document.getElementById('map-frame-wrapper');
        const frame = document.getElementById('map-frame');
        if (!previewArea || !wrapper || !frame) return;

        const style = getComputedStyle(previewArea);
        const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

        const availW = previewArea.clientWidth - paddingX;
        const availH = window.innerHeight - previewArea.getBoundingClientRect().top - paddingY - 16;

        const scale = Math.max(0.25, Math.min(1, availW / 850, availH / 550));

        frame.style.transform = `scale(${scale})`;
        wrapper.style.width = `${850 * scale}px`;
        wrapper.style.height = `${550 * scale}px`;
        currentMapScale = scale;
    }

    let mapScaleResizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(mapScaleResizeTimer);
        mapScaleResizeTimer = setTimeout(updateMapScale, 100);
    });
    updateMapScale();

    // ---------------------------------------------------------------
    // POLICES (titre, étiquettes) — catalogue issu du projet ArduPaint
    // (Google Fonts, self-hébergées) + Marianne.
    // ---------------------------------------------------------------
    function appendFontOptions(selectEl, selectedFont) {
        FONT_CATALOG.forEach(cat => {
            const grp = document.createElement('optgroup');
            grp.label = cat.group;
            cat.fonts.forEach(font => {
                const opt = document.createElement('option');
                opt.value = font;
                opt.textContent = font;
                opt.style.fontFamily = `"${font}", sans-serif`;
                if (font === selectedFont) opt.selected = true;
                grp.appendChild(opt);
            });
            selectEl.appendChild(grp);
        });
    }

    ['title-font-select', 'label-font-select'].forEach(id => {
        appendFontOptions(document.getElementById(id), DEFAULT_FONT);
    });

    // Précharge une police avant de l'utiliser pour un rendu/une mesure de texte,
    // afin d'éviter tout décalage lié au chargement asynchrone du fichier WOFF2.
    async function ensureFontLoaded(fontFamily) {
        try {
            await document.fonts.load(`700 16px "${fontFamily}"`);
        } catch (e) { /* police indisponible : repli sur la police système */ }
    }

    // ---------------------------------------------------------------
    // PICTOGRAMMES THÉMATIQUES
    // Deux jeux d'icônes : OCHA Humanitarian Icons (domaine public)
    // et pictogrammes DSFR / Remix Icon (licence MIT / Apache 2.0)
    // ---------------------------------------------------------------
    const dsfrCategoryByFile = new Map();
    DSFR_PICTOGRAM_ICONS.forEach(i => dsfrCategoryByFile.set(i.file, i.category));

    // Jeu d'icônes illustrées (PNG générés avec Krea 2) : catalogue optionnel,
    // absent tant que tools/icons/install_icons.py n'a pas été lancé.
    const K2_CATEGORIES = typeof K2_PICTOGRAM_CATEGORIES !== 'undefined' ? K2_PICTOGRAM_CATEGORIES : [];
    const K2_ICONS = typeof K2_PICTOGRAM_ICONS !== 'undefined' ? K2_PICTOGRAM_ICONS : [];
    const k2CategoryByFile = new Map(K2_ICONS.map(i => [i.file, i.category]));
    const k2IconIds = new Set(K2_ICONS.map(i => i.id));

    function currentPictogramSet() {
        return document.getElementById('pictogram-set').value;
    }

    function populatePictogramSelect() {
        const sel = document.getElementById('pictogram-select');
        sel.innerHTML = '';
        const set = currentPictogramSet();
        const categories = set === 'dsfr' ? DSFR_PICTOGRAM_CATEGORIES : set === 'k2' ? K2_CATEGORIES : PICTOGRAM_CATEGORIES;
        const icons = set === 'dsfr' ? DSFR_PICTOGRAM_ICONS : set === 'k2' ? K2_ICONS : PICTOGRAM_ICONS;

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

        document.getElementById('pictogram-color').style.display = set === 'ocha' ? 'block' : 'none';
        document.getElementById('pictogram-dsfr-color').style.display = set === 'dsfr' ? 'block' : 'none';
    }

    // Construit le chemin d'accès et, pour les icônes DSFR (monochromes,
    // sans fill défini), la couleur à injecter par héritage SVG. Les icônes
    // illustrées sont des PNG en couleur (raster) : ni recoloration ni SVG inline.
    function resolvePictogramSource(set, file, color) {
        if (set === 'k2') {
            const category = k2CategoryByFile.get(file);
            return { path: `./icons/pictograms-k2/${category}/${file}`, category, recolor: null, raster: true };
        }
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
        const { path, recolor, raster } = resolvePictogramSource(set, file, color);
        if (raster) {
            frame.innerHTML = '';
            const img = document.createElement('img');
            img.src = path;
            img.alt = '';
            frame.appendChild(img);
            return;
        }
        let svgText = await getPictogramSvgText(path);
        if (svgText && recolor) svgText = applySvgRecolor(svgText, recolor);
        frame.innerHTML = svgText || '';
    }

    async function renderPictogramOverlay(container, pictograms) {
        container.querySelectorAll('.pictogram-marker').forEach(el => el.remove());
        for (let i = 0; i < pictograms.length; i++) {
            const p = pictograms[i];
            const { path, recolor, raster } = resolvePictogramSource(p.set, p.file, p.color);
            let svgText = null;
            if (!raster) {
                svgText = await getPictogramSvgText(path);
                if (!svgText) continue;
                if (recolor) svgText = applySvgRecolor(svgText, recolor);
            }

            const marker = document.createElement('div');
            marker.className = 'pictogram-marker';
            marker.dataset.index = String(i);
            marker.title = p.file.replace('.svg', '').replace(/-/g, ' ');
            marker.style.left = `${p.x}px`;
            marker.style.top = `${p.y}px`;
            marker.style.width = `${p.size}px`;
            marker.style.height = `${p.size}px`;
            if (raster) {
                const img = document.createElement('img');
                img.src = path;
                img.alt = '';
                marker.appendChild(img);
            } else {
                marker.innerHTML = svgText;
            }
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

    function setPictogramPlacementArmed(armed) {
        pictogramPlacementArmed = armed;
        const btn = document.getElementById('btn-add-pictogram');
        btn.textContent = armed ? '🛑 Arrêter le placement' : '📍 Placer ce pictogramme';
        btn.classList.toggle('btn-armed', armed);
    }

    document.getElementById('btn-add-pictogram').onclick = () => {
        if (pictogramPlacementArmed) {
            setPictogramPlacementArmed(false);
            return;
        }
        if (!currentMapConfig) {
            showToast("Action impossible", "Générez d'abord une carte (Actualiser la vue) avant d'y placer un pictogramme.", "warning");
            return;
        }
        if (!document.getElementById('pictogram-select').value) return;
        setPictogramPlacementArmed(true);
        showToast("Placement activé", "Cliquez sur la carte pour poser autant de pictogrammes que nécessaire. Cliquez de nouveau sur le bouton pour arrêter.", "info");
    };

    document.getElementById('map-preview-area').addEventListener('click', (e) => {
        const container = e.currentTarget;

        if (annotationPlacementArmed) {
            annotationPlacementArmed = false;
            const rect = container.getBoundingClientRect();
            const tx = (e.clientX - rect.left) / currentMapScale;
            const ty = (e.clientY - rect.top) / currentMapScale;
            const width = 180;
            const bubbleX = Math.max(4, Math.min(tx + 30, 850 - width - 4));
            const bubbleY = Math.max(4, Math.min(ty - 90, 550 - 70));

            currentAnnotations.push({ text: '', targetX: tx, targetY: ty, bubbleX, bubbleY, width });
            const bubbleLayer = renderAnnotationOverlay(container, currentAnnotations);
            const lastBubbleText = bubbleLayer?.lastElementChild?.querySelector('.annotation-bubble-text');
            if (lastBubbleText) lastBubbleText.focus();
            return;
        }

        const marker = e.target.closest('.pictogram-marker');

        if (marker) {
            const idx = parseInt(marker.dataset.index, 10);
            currentPictograms.splice(idx, 1);
            renderPictogramOverlay(container, currentPictograms);
            return;
        }

        if (!pictogramPlacementArmed) return;

        if (!currentMapConfig) {
            showToast("Action impossible", "Générez d'abord une carte (Actualiser la vue) avant d'y placer un pictogramme.", "warning");
            return;
        }

        const set = currentPictogramSet();
        const file = document.getElementById('pictogram-select').value;
        if (!file) return;

        const rect = container.getBoundingClientRect();
        const x = (e.clientX - rect.left) / currentMapScale;
        const y = (e.clientY - rect.top) / currentMapScale;
        const color = set === 'dsfr' ? document.getElementById('pictogram-dsfr-color').value : document.getElementById('pictogram-color').value;
        const size = parseFloat(document.getElementById('pictogram-size').value) || 28;

        currentPictograms.push({ set, file, color, size, x, y });
        renderPictogramOverlay(container, currentPictograms);
    });

    // ---------------------------------------------------------------
    // ANNOTATIONS MANUSCRITES (bulle de texte + flèche vers une zone)
    // ---------------------------------------------------------------
    function clipPointToRect(cx, cy, tx, ty, w, h) {
        const dx = tx - cx, dy = ty - cy;
        if (dx === 0 && dy === 0) return { x: cx, y: cy };
        const halfW = w / 2, halfH = h / 2;
        let scale = Infinity;
        if (dx !== 0) scale = Math.min(scale, halfW / Math.abs(dx));
        if (dy !== 0) scale = Math.min(scale, halfH / Math.abs(dy));
        return { x: cx + dx * scale, y: cy + dy * scale };
    }

    function renderAnnotationOverlay(container, annotations) {
        container.querySelectorAll('.annotation-layer').forEach(el => el.remove());
        if (annotations.length === 0) return;

        const svgNS = 'http://www.w3.org/2000/svg';
        const markerId = `annotation-arrow-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('class', 'annotation-layer annotation-arrows-svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');

        const defs = document.createElementNS(svgNS, 'defs');
        const marker = document.createElementNS(svgNS, 'marker');
        marker.setAttribute('id', markerId);
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '8');
        marker.setAttribute('refX', '6');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        marker.setAttribute('markerUnits', 'strokeWidth');
        const arrowPath = document.createElementNS(svgNS, 'path');
        arrowPath.setAttribute('d', 'M0,0 L6,3 L0,6 Z');
        arrowPath.setAttribute('fill', '#1e1e1e');
        marker.appendChild(arrowPath);
        defs.appendChild(marker);
        svg.appendChild(defs);

        const paths = annotations.map(() => {
            const path = document.createElementNS(svgNS, 'path');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', '#1e1e1e');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('marker-end', `url(#${markerId})`);
            svg.appendChild(path);
            return path;
        });

        const curveHandles = annotations.map((ann, i) => {
            const handle = document.createElementNS(svgNS, 'circle');
            handle.setAttribute('r', '5');
            handle.setAttribute('class', 'annotation-curve-handle annotation-control-handle');
            handle.setAttribute('title', 'Glisser pour courber la flèche');
            svg.appendChild(handle);

            handle.addEventListener('click', (e) => e.stopPropagation());
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handle.classList.add('is-active');
                const startX = e.clientX, startY = e.clientY;
                const origCX = ann.curveX, origCY = ann.curveY;
                function onMove(ev) {
                    ann.curveX = origCX + (ev.clientX - startX) / currentMapScale;
                    ann.curveY = origCY + (ev.clientY - startY) / currentMapScale;
                    updateGeometry(i);
                }
                function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    const bubbleEl = bubbleLayer?.children[i];
                    if (!bubbleEl || !bubbleEl.matches(':hover, :focus-within')) handle.classList.remove('is-active');
                }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            return handle;
        });
        container.appendChild(svg);

        const bubbleLayer = document.createElement('div');
        bubbleLayer.className = 'annotation-layer annotation-bubble-layer';
        container.appendChild(bubbleLayer);

        function updateGeometry(i) {
            const ann = annotations[i];
            const bubbleEl = bubbleLayer.children[i];
            if (!bubbleEl) return;
            bubbleEl.style.left = `${ann.bubbleX}px`;
            bubbleEl.style.top = `${ann.bubbleY}px`;
            const w = bubbleEl.offsetWidth, h = bubbleEl.offsetHeight;
            const cx = ann.bubbleX + w / 2, cy = ann.bubbleY + h / 2;
            const edge = clipPointToRect(cx, cy, ann.targetX, ann.targetY, w, h);

            if (ann.curveX === undefined || ann.curveY === undefined) {
                ann.curveX = (edge.x + ann.targetX) / 2;
                ann.curveY = (edge.y + ann.targetY) / 2;
            }

            paths[i].setAttribute('d', `M ${edge.x} ${edge.y} Q ${ann.curveX} ${ann.curveY} ${ann.targetX} ${ann.targetY}`);
            curveHandles[i].setAttribute('cx', ann.curveX);
            curveHandles[i].setAttribute('cy', ann.curveY);
        }

        annotations.forEach((ann, i) => {
            const bubble = document.createElement('div');
            bubble.className = 'annotation-bubble';
            bubble.style.width = `${ann.width || 180}px`;
            if (ann.height) bubble.style.height = `${ann.height}px`;
            bubble.style.background = ann.bgColor || '#ffffff';

            const handle = document.createElement('div');
            handle.className = 'annotation-bubble-handle';
            handle.innerHTML = '<span>⠿</span>';

            const settingsBtn = document.createElement('button');
            settingsBtn.type = 'button';
            settingsBtn.className = 'annotation-bubble-settings-btn';
            settingsBtn.innerHTML = '⚙';
            settingsBtn.title = 'Police, taille et couleurs de cette bulle';
            handle.appendChild(settingsBtn);

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'annotation-bubble-delete';
            delBtn.innerHTML = '×';
            delBtn.title = 'Supprimer cette annotation';
            handle.appendChild(delBtn);

            const textEl = document.createElement('div');
            textEl.className = 'annotation-bubble-text';
            textEl.contentEditable = 'true';
            textEl.dataset.placeholder = 'Votre annotation...';
            textEl.innerText = ann.text || '';
            textEl.style.fontFamily = `"${ann.font || DEFAULT_FONT}", sans-serif`;
            textEl.style.fontSize = `${ann.fontSize || 14}px`;
            textEl.style.color = ann.textColor || '#1e1e1e';

            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'annotation-bubble-resize';
            resizeHandle.title = 'Redimensionner';

            // Panneau de réglages individuels (police, taille, couleurs)
            const settingsPanel = document.createElement('div');
            settingsPanel.className = 'annotation-settings-panel';
            settingsPanel.style.display = 'none';

            const fontLabel = document.createElement('label');
            fontLabel.textContent = 'Police';
            const fontSelect = document.createElement('select');
            appendFontOptions(fontSelect, ann.font || DEFAULT_FONT);

            const sizeLabel = document.createElement('label');
            sizeLabel.textContent = 'Taille (px)';
            const sizeInput = document.createElement('input');
            sizeInput.type = 'number';
            sizeInput.min = '10'; sizeInput.max = '40';
            sizeInput.value = ann.fontSize || 14;

            const textColorLabel = document.createElement('label');
            textColorLabel.textContent = 'Couleur du texte';
            const textColorInput = document.createElement('input');
            textColorInput.type = 'color';
            textColorInput.value = ann.textColor || '#1e1e1e';

            const bgColorLabel = document.createElement('label');
            bgColorLabel.textContent = 'Couleur de fond';
            const bgColorInput = document.createElement('input');
            bgColorInput.type = 'color';
            bgColorInput.value = ann.bgColor || '#ffffff';

            settingsPanel.append(fontLabel, fontSelect, sizeLabel, sizeInput, textColorLabel, textColorInput, bgColorLabel, bgColorInput);

            fontSelect.addEventListener('change', () => {
                ann.font = fontSelect.value;
                textEl.style.fontFamily = `"${ann.font}", sans-serif`;
            });
            sizeInput.addEventListener('input', () => {
                ann.fontSize = parseFloat(sizeInput.value) || 14;
                textEl.style.fontSize = `${ann.fontSize}px`;
            });
            textColorInput.addEventListener('input', () => {
                ann.textColor = textColorInput.value;
                textEl.style.color = ann.textColor;
            });
            bgColorInput.addEventListener('input', () => {
                ann.bgColor = bgColorInput.value;
                bubble.style.background = ann.bgColor;
            });
            [fontSelect, sizeInput, textColorInput, bgColorInput].forEach(el => {
                el.addEventListener('click', (e) => e.stopPropagation());
                el.addEventListener('mousedown', (e) => e.stopPropagation());
            });

            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = settingsPanel.style.display !== 'none';
                settingsPanel.style.display = isOpen ? 'none' : 'flex';
                settingsBtn.classList.toggle('is-open', !isOpen);
            });

            bubble.appendChild(handle);
            bubble.appendChild(textEl);
            bubble.appendChild(resizeHandle);
            bubble.appendChild(settingsPanel);
            bubbleLayer.appendChild(bubble);

            // Empêche le clic dans la bulle de déclencher un placement sur la carte
            bubble.addEventListener('click', (e) => e.stopPropagation());
            bubble.addEventListener('mousedown', (e) => e.stopPropagation());

            // Met en évidence la poignée de courbure tant que la bulle est survolée ou a le focus
            const syncCurveHandleVisibility = () => {
                curveHandles[i].classList.toggle('is-active', bubble.matches(':hover, :focus-within'));
            };
            bubble.addEventListener('mouseenter', syncCurveHandleVisibility);
            bubble.addEventListener('mouseleave', syncCurveHandleVisibility);
            bubble.addEventListener('focusin', syncCurveHandleVisibility);
            bubble.addEventListener('focusout', syncCurveHandleVisibility);

            textEl.addEventListener('input', () => { ann.text = textEl.innerText; });
            textEl.addEventListener('focusin', () => {
                settingsPanel.style.display = 'none';
                settingsBtn.classList.remove('is-open');
            });

            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                annotations.splice(i, 1);
                renderAnnotationOverlay(container, annotations);
            });

            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX, startY = e.clientY;
                const origX = ann.bubbleX, origY = ann.bubbleY;
                function onMove(ev) {
                    ann.bubbleX = origX + (ev.clientX - startX) / currentMapScale;
                    ann.bubbleY = origY + (ev.clientY - startY) / currentMapScale;
                    updateGeometry(i);
                }
                function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            resizeHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX, startY = e.clientY;
                const origW = bubble.offsetWidth, origH = bubble.offsetHeight;
                function onMove(ev) {
                    const newW = Math.max(100, Math.min(400, origW + (ev.clientX - startX) / currentMapScale));
                    const newH = Math.max(40, Math.min(400, origH + (ev.clientY - startY) / currentMapScale));
                    bubble.style.width = `${newW}px`;
                    bubble.style.height = `${newH}px`;
                    ann.width = newW;
                    ann.height = newH;
                    updateGeometry(i);
                }
                function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            updateGeometry(i);
        });

        return bubbleLayer;
    }

    document.getElementById('btn-add-annotation').onclick = () => {
        if (!currentMapConfig) {
            showToast("Action impossible", "Générez d'abord une carte (Actualiser la vue) avant d'ajouter une annotation.", "warning");
            return;
        }
        annotationPlacementArmed = true;
        showToast("Placement", "Cliquez sur la carte à l'endroit que vous voulez annoter.", "info");
    };

    document.getElementById('btn-clear-annotations').onclick = () => {
        currentAnnotations = [];
        renderAnnotationOverlay(document.getElementById('map-preview-area'), currentAnnotations);
    };

    // ---------------------------------------------------------------
    // ÉPINGLES GÉOLOCALISÉES (lon/lat WGS84)
    // Dessinées par le moteur via la projection : elles suivent la carte
    // quelle que soit l'échelle, et passent dans l'export PNG et le lot.
    // ---------------------------------------------------------------
    const DEFAULT_PIN_COLOR = '#e1000f';

    // Recherche d'adresse en cascade (département → commune → voie → numéro)
    // sur la Base Adresse Nationale découpée par commune : data/ban/<dép>/<code INSEE>.csv
    const addrDept = document.getElementById('addr-dept');
    const addrCommune = document.getElementById('addr-commune');
    const addrVoie = document.getElementById('addr-voie');
    const addrNumero = document.getElementById('addr-numero');
    let addrRows = [];

    function resetAddrSelect(sel, text) {
        sel.innerHTML = `<option value="">${text}</option>`;
        sel.disabled = true;
    }
    function appendOptions(sel, entries) {
        entries.forEach(([value, label]) => { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); });
        sel.disabled = entries.length === 0;
    }
    // La BAN note « 0 » les adresses sans numéro (lieux-dits notamment)
    const hasHouseNumber = r => r.numero && r.numero !== '0';
    const formatHouseNumber = r => hasHouseNumber(r) ? `${r.numero}${r.rep ? ' ' + r.rep : ''}` : '(sans numéro)';

    appendOptions(addrDept, Object.entries(DEPARTEMENTS_DICT).map(([c, n]) => [c, `${c} - ${n}`]));

    addrDept.onchange = async () => {
        resetAddrSelect(addrCommune, '-- 2. Choisir la Commune --');
        resetAddrSelect(addrVoie, '-- 3. Choisir la Voie --');
        resetAddrSelect(addrNumero, '-- 4. Choisir le Numéro --');
        const dep = addrDept.value;
        if (!dep) return;
        await loadMapReferentials();
        const communes = [];
        geoReferential.communes.forEach(r => {
            if (getSafeCol(r, 'DEP') !== dep || getSafeCol(r, 'TYPECOM') !== 'COM') return;
            const code = getSafeCol(r, 'COM'), name = getSafeCol(r, 'LIBELLE');
            const arm = MUNICIPAL_ARRONDISSEMENTS[code];
            // La BAN adresse Paris, Lyon et Marseille par arrondissement municipal
            if (arm) for (let i = 1; i <= arm[2]; i++) communes.push([String(arm[1] + i - 1), `${name} ${i === 1 ? '1er' : i + 'e'} Arrondissement`]);
            else communes.push([code, name]);
        });
        communes.sort((a, b) => a[1].localeCompare(b[1], 'fr', { numeric: true }));
        appendOptions(addrCommune, communes.map(([c, n]) => [c, `${n} (${c})`]));
    };

    addrCommune.onchange = async () => {
        resetAddrSelect(addrVoie, '-- 3. Choisir la Voie --');
        resetAddrSelect(addrNumero, '-- 4. Choisir le Numéro --');
        addrRows = [];
        if (!addrCommune.value) return;
        const code = addrCommune.value;
        try {
            const res = await fetch(`./data/ban/${addrDept.value}/${code}.csv`);
            if (!res.ok) throw new Error(res.status);
            addrRows = Papa.parse(await res.text(), { header: true, delimiter: ';', skipEmptyLines: true }).data;
        } catch (e) {
            showToast("Recherche d'adresse", "Aucune adresse disponible pour cette commune.", 'warning');
            return;
        }
        if (addrCommune.value !== code) return;
        const voies = Array.from(new Set(addrRows.map(r => r.nom_voie).filter(Boolean)))
            .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
        appendOptions(addrVoie, voies.map(v => [v, v]));
    };

    addrVoie.onchange = () => {
        resetAddrSelect(addrNumero, '-- 4. Choisir le Numéro --');
        if (!addrVoie.value) return;
        const numeros = addrRows
            .map((r, i) => [i, r])
            .filter(([, r]) => r.nom_voie === addrVoie.value)
            .sort(([, a], [, b]) => (parseInt(a.numero, 10) - parseInt(b.numero, 10)) || a.rep.localeCompare(b.rep));
        appendOptions(addrNumero, numeros.map(([i, r]) => [i, formatHouseNumber(r)]));
        // Une voie à adresse unique (lieu-dit) se sélectionne directement
        if (numeros.length === 1) { addrNumero.value = numeros[0][0]; addrNumero.onchange(); }
    };

    addrNumero.onchange = () => {
        const r = addrRows[addrNumero.value];
        if (!r) return;
        document.getElementById('pin-lon').value = r.lon;
        document.getElementById('pin-lat').value = r.lat;
        const num = hasHouseNumber(r) ? formatHouseNumber(r) + ' ' : '';
        document.getElementById('pin-label').value = `${num}${r.nom_voie}, ${r.code_postal} ${r.nom_commune}`;
    };

    function parseCoordinate(raw) {
        const n = parseFloat(String(raw ?? '').trim().replace(',', '.'));
        return Number.isFinite(n) ? n : NaN;
    }

    // Couleur validée par le navigateur (#hex, rgb(), nom CSS) : évite toute
    // valeur arbitraire injectée dans le SVG depuis un CSV ou une config.
    function sanitizePinColor(raw) {
        const c = String(raw ?? '').trim();
        return c && CSS.supports('color', c) ? c : DEFAULT_PIN_COLOR;
    }

    // Icône illustrée facultative : seul un identifiant connu du catalogue est conservé.
    function sanitizePinIcon(raw) {
        const id = String(raw ?? '').trim().toLowerCase();
        return k2IconIds.has(id) ? id : '';
    }

    function makePin(lon, lat, color, label, icon) {
        if (!(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90)) return null;
        return { lon, lat, color: sanitizePinColor(color), label: String(label ?? '').trim(), icon: sanitizePinIcon(icon) };
    }

    function populatePinIconSelect() {
        const sel = document.getElementById('pin-icon');
        K2_CATEGORIES.forEach(cat => {
            const catIcons = K2_ICONS.filter(i => i.category === cat.id);
            if (catIcons.length === 0) return;
            const grp = document.createElement('optgroup');
            grp.label = cat.label;
            catIcons.forEach(icon => {
                const opt = document.createElement('option');
                opt.value = icon.id;
                opt.textContent = icon.name;
                grp.appendChild(opt);
            });
            sel.appendChild(grp);
        });
    }
    populatePinIconSelect();

    // Affiche l'identifiant de l'icône choisie, à reprendre dans la colonne « icône » d'un CSV d'épingles
    document.getElementById('pin-icon').onchange = (e) => {
        document.getElementById('pin-icon-id').innerHTML = e.target.value
            ? `Identifiant pour le CSV : <code>${e.target.value}</code>` : '';
    };

    function refreshAfterPinsChange() {
        renderPinList();
        if (currentMapConfig) renderPreview();
    }

    function renderPinList() {
        const list = document.getElementById('pin-list');
        list.innerHTML = '';
        currentPins.forEach((pin, i) => {
            const li = document.createElement('li');
            let dot;
            const iconPath = k2IconPath(pin.icon);
            if (iconPath) {
                dot = document.createElement('img');
                dot.className = 'pin-icon-thumb';
                dot.src = iconPath;
                dot.alt = '';
            } else {
                dot = document.createElement('span');
                dot.className = 'pin-dot';
                dot.style.background = pin.color;
            }
            const text = document.createElement('span');
            text.className = 'pin-text';
            text.textContent = `${pin.label || '(sans légende)'} — ${pin.lon}, ${pin.lat}`;
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'pin-delete';
            del.title = 'Supprimer cette épingle';
            del.textContent = '×';
            del.onclick = () => {
                currentPins.splice(i, 1);
                refreshAfterPinsChange();
            };
            li.append(dot, text, del);
            list.appendChild(li);
        });
        document.getElementById('btn-clear-pins').style.display = currentPins.length > 0 ? 'block' : 'none';
    }

    document.getElementById('btn-add-pin').onclick = () => {
        const pin = makePin(
            parseCoordinate(document.getElementById('pin-lon').value),
            parseCoordinate(document.getElementById('pin-lat').value),
            document.getElementById('pin-color').value,
            document.getElementById('pin-label').value,
            document.getElementById('pin-icon').value
        );
        if (!pin) {
            showToast("Coordonnées invalides", "Saisissez une longitude (-180 à 180) et une latitude (-90 à 90) en degrés décimaux.", "warning");
            return;
        }
        currentPins.push(pin);
        document.getElementById('pin-lon').value = '';
        document.getElementById('pin-lat').value = '';
        document.getElementById('pin-label').value = '';
        refreshAfterPinsChange();
    };

    document.getElementById('btn-import-pins').onclick = () => {
        document.getElementById('pins-csv-file').click();
    };

    document.getElementById('pins-csv-file').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        Papa.parse(file, { header: false, skipEmptyLines: true, complete: (res) => {
            const rows = res.data;
            // Ligne d'en-tête facultative : détectée si x/y ne sont pas numériques
            const hasHeader = rows.length > 0 && (Number.isNaN(parseCoordinate(rows[0][0])) || Number.isNaN(parseCoordinate(rows[0][1])));
            const dataRows = hasHeader ? rows.slice(1) : rows;
            let imported = 0, unknownIcons = 0;
            dataRows.forEach(r => {
                const pin = makePin(parseCoordinate(r[0]), parseCoordinate(r[1]), r[2], r[3], r[4]);
                if (!pin) return;
                if (String(r[4] ?? '').trim() && !pin.icon) unknownIcons++;
                currentPins.push(pin);
                imported++;
            });
            const ignored = dataRows.length - imported;
            const notes = [];
            if (ignored > 0) notes.push(`${ignored} ligne(s) ignorée(s) (coordonnées invalides)`);
            if (unknownIcons > 0) notes.push(`${unknownIcons} icône(s) inconnue(s), remplacée(s) par un point`);
            showToast("Import des épingles",
                `${imported} épingle(s) importée(s)${notes.length ? ', ' + notes.join(', ') : ''}.`,
                imported > 0 ? (notes.length ? "warning" : "success") : "error");
            refreshAfterPinsChange();
        }});
        e.target.value = '';
    };

    document.getElementById('btn-clear-pins').onclick = () => {
        currentPins = [];
        refreshAfterPinsChange();
    };

    // Remplit les listes de colonnes (calcul, filtre, texte des étiquettes) d'après les en-têtes du CSV
    function populateColumnSelects(headers) {
        document.getElementById('calc-engine-ui').style.display = 'block';
        document.getElementById('label-insee-col').innerText = headers[0];
        const s1 = document.getElementById('calc-col1'), s2 = document.getElementById('calc-col2');
        s1.innerHTML = ''; s2.innerHTML = '';
        headers.slice(1).forEach(h => { const o = document.createElement('option'); o.value = h; o.textContent = h; s1.appendChild(o.cloneNode(true)); s2.appendChild(o); });
        document.getElementById('advanced-filter-ui').style.display = 'block';
        const filterCol = document.getElementById('filter-col');
        filterCol.innerHTML = '<option value="">-- Champ à filtrer (Optionnel) --</option>';
        const textCol = document.getElementById('label-text-col');
        textCol.innerHTML = '<option value="">Nom de la zone (par défaut)</option>';
        headers.forEach(h => {
            const o = document.createElement('option');
            o.value = h; o.textContent = h;
            filterCol.appendChild(o.cloneNode(true));
            textCol.appendChild(o);
        });
    }

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

        const layersSection = document.getElementById('layers-section');
        if (layersSection) layersSection.style.display = scaleSelect.value === 'world' ? 'none' : '';

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

    // ---------------------------------------------------------------
    // CONSTRUCTION DE LA CONFIGURATION DE CARTE
    // Centralise la lecture du panneau pour l'aperçu ET pour l'export
    // (simple ou par lot). Les overrides permettent de générer une carte
    // pour une colonne donnée sans modifier les champs du panneau.
    // ---------------------------------------------------------------
    function buildMapConfig(overrides = {}) {
        const showLegend = document.getElementById('map-show-legend').checked;
        const calcMode = overrides.calcMode !== undefined ? overrides.calcMode : document.getElementById('calc-mode').value;
        const calcCol1 = overrides.calcCol1 !== undefined ? overrides.calcCol1 : document.getElementById('calc-col1').value;
        const calcCol2 = overrides.calcCol2 !== undefined ? overrides.calcCol2 : document.getElementById('calc-col2').value;
        const title = overrides.title !== undefined ? overrides.title : document.getElementById('map-title')?.value;

        let mapData = null;
        let filterMap = null;
        let labelTextMap = null;
        const labelTextCol = document.getElementById('label-text-col').value;

        if (rawCsvData.length > 0) {
            const codeCol = Object.keys(rawCsvData[0])[0];
            mapData = computeValorAggregation(rawCsvData, scaleSelect.value, calcMode, codeCol, calcCol1, calcCol2);
            const fCol = document.getElementById('filter-col').value;
            if (fCol) {
                filterMap = computeValorAggregation(rawCsvData, scaleSelect.value, 'simple', codeCol, fCol);
            }
            if (labelTextCol) {
                labelTextMap = computeTextMap(rawCsvData, scaleSelect.value, codeCol, labelTextCol);
            }
        }

        const config = {
            scale: scaleSelect.value,
            worldRegion: document.getElementById('sel-world-region')?.value,
            region: document.getElementById('sel-region')?.value,
            dept: document.getElementById('sel-dept')?.value,
            epci: document.getElementById('sel-epci')?.value,
            commune: document.getElementById('sel-commune')?.value,
            title: title,
            calcMode: calcMode,
            calcCol1: calcCol1,
            calcCol2: calcCol2,
            titleFont: document.getElementById('title-font-select')?.value || DEFAULT_FONT,
            titleFontSize: parseFloat(document.getElementById('title-font-size')?.value) || 17,
            labelType: document.getElementById('label-type')?.value,
            labelFont: document.getElementById('label-font-select')?.value || DEFAULT_FONT,
            labelTextCol: labelTextCol,
            labelTextMap: labelTextMap,
            showLegend: showLegend,
            mapColors: getMapColors(),
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
            pictograms: currentPictograms,
            annotations: currentAnnotations,
            pins: currentPins,
            showPinLabels: document.getElementById('pin-show-labels').checked,
            showPinLegend: document.getElementById('pin-show-legend').checked,
            pinSize: parseFloat(document.getElementById('pin-size').value) || 5,
            pinIconSize: parseFloat(document.getElementById('pin-icon-size').value) || 28,

            showRelief: document.getElementById('layer-show-relief')?.checked || false,
            reliefOpacity: parseFloat(document.getElementById('layer-relief-opacity')?.value) ?? 0.6,
            showRoads: document.getElementById('layer-show-roads')?.checked || false,
            showHydro: document.getElementById('layer-show-hydro')?.checked || false,
            showRail: document.getElementById('layer-show-rail')?.checked || false,
            showAirports: document.getElementById('layer-show-airports')?.checked || false,
            showCities: document.getElementById('layer-show-cities')?.checked || false
        };

        return { config, mapData };
    }

    // ---------------------------------------------------------------
    // EXPORT PNG (utilisé par le téléchargement simple et le mode lot)
    // ---------------------------------------------------------------
    function sanitizeFilename(name) {
        return String(name || 'carte').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'carte';
    }

    async function exportMapAsPng(config, mapData, filename) {
        const hiddenDiv = document.createElement('div');
        hiddenDiv.style.position = 'absolute';
        hiddenDiv.style.left = '-9999px';
        hiddenDiv.style.width = '850px';
        hiddenDiv.style.height = '550px';
        hiddenDiv.style.background = config.mapColors?.background || DEFAULT_MAP_COLORS.background;
        document.body.appendChild(hiddenDiv);

        await Promise.all([ensureFontLoaded(config.titleFont), ensureFontLoaded(config.labelFont)]);
        const success = await drawD3Map(hiddenDiv, config, mapData);

        if (!success) {
            hiddenDiv.remove();
            return false;
        }

        await renderPictogramOverlay(hiddenDiv, config.pictograms || []);
        renderAnnotationOverlay(hiddenDiv, config.annotations || []);
        hiddenDiv.querySelectorAll('.annotation-control-handle').forEach(el => el.remove());
        await new Promise(resolve => setTimeout(resolve, 50));

        const canvas = await html2canvas(hiddenDiv, {
            scale: 2,
            backgroundColor: config.mapColors?.background || DEFAULT_MAP_COLORS.background,
            useCORS: true,
            logging: false
        });

        hiddenDiv.remove();

        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        link.click();
        return true;
    }

    async function renderPreview() {
        const loader = document.getElementById('map-loader');
        const emptyState = document.getElementById('map-empty-state');

        if (loader) loader.style.display = 'flex';
        if (emptyState) emptyState.style.display = 'none';

        setTimeout(async () => {
            const { config, mapData } = buildMapConfig();

            currentMapConfig = config;
            currentMapData = mapData;

            await Promise.all([ensureFontLoaded(config.titleFont), ensureFontLoaded(config.labelFont)]);
            const success = await drawD3Map(document.getElementById('map-preview-area'), config, mapData);

            if (!success) {
                showToast("Sélection incomplète", "Veuillez préciser la zone géographique à cartographier.", "warning");
                if (emptyState) emptyState.style.display = 'flex';
            } else {
                await renderPictogramOverlay(document.getElementById('map-preview-area'), currentPictograms);
                renderAnnotationOverlay(document.getElementById('map-preview-area'), currentAnnotations);
            }

            if (loader) loader.style.display = 'none';
        }, 50);
    }

    scaleSelect.onchange = updateUI;
    document.getElementById('btn-map-refresh').onclick = renderPreview;

    // ---------------------------------------------------------------
    // ACTUALISATION AUTOMATIQUE
    // Regénère la carte (avec un léger délai anti-rebond) dès qu'un
    // réglage change dans le panneau, tant que le mode "Auto" est activé.
    // ---------------------------------------------------------------
    let autoRefreshTimer = null;
    function triggerAutoRefresh() {
        if (!autoRefreshEnabled || !currentMapConfig) return;
        clearTimeout(autoRefreshTimer);
        autoRefreshTimer = setTimeout(renderPreview, 500);
    }

    document.getElementById('auto-refresh-toggle').onchange = (e) => {
        autoRefreshEnabled = e.target.checked;
        if (autoRefreshEnabled) triggerAutoRefresh();
    };

    document.querySelector('.panel').addEventListener('input', triggerAutoRefresh);
    document.querySelector('.panel').addEventListener('change', triggerAutoRefresh);

    document.getElementById('label-type').onchange = (e) => {
        document.getElementById('label-toolkit').style.display = e.target.value === 'none' ? 'none' : 'block';
    };

    document.getElementById('calc-mode').onchange = (e) => {
        document.getElementById('calc-col2').style.display = ['ratio', 'growth'].includes(e.target.value) ? 'block' : 'none';
    };

    function applyCsvData(data, headers, statusText) {
        rawCsvData = data;
        document.getElementById('csv-status').innerText = statusText;
        populateColumnSelects(headers);

        // Nouveau jeu de données : retour au mode par défaut (somme brute,
        // palette bleue dégradée par défaut) plutôt que de garder les
        // réglages du jeu de données précédent.
        document.getElementById('calc-mode').value = 'simple';
        document.getElementById('calc-col2').style.display = 'none';
        document.getElementById('map-palette').value = 'default';
        document.getElementById('palette-warning').style.display = 'none';
        document.getElementById('custom-palette-ui').style.display = 'none';

        const batchBtn = document.getElementById('btn-batch-generate');
        const batchStatus = document.getElementById('batch-status');
        const hasMultipleColumns = headers.slice(1).length > 1;
        batchBtn.style.display = hasMultipleColumns ? 'block' : 'none';
        if (batchStatus) batchStatus.innerText = '';

        triggerAutoRefresh();
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

    // Couleurs du fond de carte : un préréglage remplit les trois sélecteurs,
    // une retouche manuelle bascule le préréglage sur « Personnalisé ».
    const MAP_COLOR_INPUTS = { background: 'map-bg-color', context: 'map-context-color', noData: 'map-nodata-color' };

    function getMapColors() {
        return Object.fromEntries(Object.entries(MAP_COLOR_INPUTS).map(([k, id]) => [k, document.getElementById(id).value]));
    }

    function setMapColors(colors) {
        const merged = { ...DEFAULT_MAP_COLORS, ...colors };
        Object.entries(MAP_COLOR_INPUTS).forEach(([k, id]) => { document.getElementById(id).value = merged[k]; });
        const preset = document.getElementById('map-colors-preset');
        const key = [merged.background, merged.context, merged.noData].join(',');
        preset.value = [...preset.options].some(o => o.value === key) ? key : 'custom';
    }

    document.getElementById('map-colors-preset').onchange = (e) => {
        if (e.target.value === 'custom') return;
        const [background, context, noData] = e.target.value.split(',');
        setMapColors({ background, context, noData });
    };
    Object.values(MAP_COLOR_INPUTS).forEach(id => {
        document.getElementById(id).addEventListener('input', () => setMapColors(getMapColors()));
    });

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
                const safeTitle = (currentMapConfig.title || 'carte').replace(/[^a-z0-9\-_]+/gi, '_');
                const ok = await exportMapAsPng(currentMapConfig, currentMapData, `${safeTitle}.png`);

                if (ok) {
                    showToast("Succès", "La carte a été téléchargée.", "success");
                } else {
                    showToast("Sélection incomplète", "Veuillez préciser la zone géographique à cartographier.", "warning");
                }
            } catch (error) {
                console.error("Erreur de capture :", error);
                showToast("Erreur", "Impossible de générer l'image de la carte.", "error");
            } finally {
                if (loader) loader.style.display = 'none';
            }
        }, 100);
    };

    // ---------------------------------------------------------------
    // GÉNÉRATION PAR LOT (une carte par colonne de données du CSV)
    // Pour chaque colonne (hors identifiant), calcule la carte en mode
    // "Somme brute", utilise l'en-tête de colonne comme titre, et
    // télécharge automatiquement l'image en <titre-colonne>.png.
    // ---------------------------------------------------------------
    async function runBatchGeneration() {
        if (rawCsvData.length === 0) return;
        const headers = Object.keys(rawCsvData[0]);
        const dataColumns = headers.slice(1);

        if (dataColumns.length < 2) {
            showToast("Action impossible", "Le CSV ne possède qu'une seule colonne de données à cartographier.", "warning");
            return;
        }

        const batchBtn = document.getElementById('btn-batch-generate');
        const statusEl = document.getElementById('batch-status');
        const loader = document.getElementById('map-loader');

        batchBtn.disabled = true;
        if (loader) {
            loader.querySelector('p').innerText = "Génération des cartes par lot...";
            loader.style.display = 'flex';
        }

        let successCount = 0;
        try {
            for (let i = 0; i < dataColumns.length; i++) {
                const col = dataColumns[i];
                if (statusEl) statusEl.innerText = `⏳ Carte ${i + 1}/${dataColumns.length} : « ${col} »...`;

                const { config, mapData } = buildMapConfig({ calcMode: 'simple', calcCol1: col, calcCol2: '', title: col });
                const ok = await exportMapAsPng(config, mapData, `${sanitizeFilename(col)}.png`);
                if (ok) successCount++;
                await new Promise(resolve => setTimeout(resolve, 300));
            }

            if (statusEl) statusEl.innerText = `✅ ${successCount}/${dataColumns.length} carte(s) générée(s) et téléchargée(s).`;
            showToast("Génération par lot terminée", `${successCount} carte(s) sur ${dataColumns.length} téléchargée(s).`, successCount === dataColumns.length ? "success" : "warning");
        } catch (error) {
            console.error("Erreur de génération par lot :", error);
            showToast("Erreur", "La génération par lot a été interrompue.", "error");
        } finally {
            batchBtn.disabled = false;
            if (loader) loader.style.display = 'none';
        }
    }

    document.getElementById('btn-batch-generate').onclick = runBatchGeneration;

    // ---------------------------------------------------------------
    // MODALE "À PROPOS" (manuel d'utilisation téléchargeable)
    // ---------------------------------------------------------------
    const aboutOverlay = document.getElementById('about-modal-overlay');
    const openAboutModal = () => { aboutOverlay.style.display = 'flex'; };
    const closeAboutModal = () => { aboutOverlay.style.display = 'none'; };

    document.getElementById('btn-about').onclick = openAboutModal;
    document.getElementById('btn-about-close').onclick = closeAboutModal;
    aboutOverlay.addEventListener('click', (e) => {
        if (e.target === aboutOverlay) closeAboutModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && aboutOverlay.style.display !== 'none') closeAboutModal();
    });

    // ---------------------------------------------------------------
    // EXPORT / IMPORT DE CONFIGURATION (remplace data-map-config)
    // ---------------------------------------------------------------
    document.getElementById('btn-export-config').onclick = () => {
        if (!currentMapConfig) {
            showToast("Action impossible", "Veuillez d'abord Actualiser la vue pour générer une carte.", "warning");
            return;
        }
        const payload = {
            config: { ...currentMapConfig, filterDataMap: undefined, labelTextMap: undefined },
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
                currentAnnotations = Array.isArray(config.annotations) ? config.annotations : [];
                rawCsvData = payload.rawCsvData || [];
                if (rawCsvData.length > 0) {
                    const headers = Object.keys(rawCsvData[0]);
                    document.getElementById('csv-status').innerText = `✅ ${rawCsvData.length} lignes importées (config restaurée).`;
                    populateColumnSelects(headers);
                    document.getElementById('calc-mode').value = config.calcMode || 'simple';
                    if (config.calcCol1) document.getElementById('calc-col1').value = config.calcCol1;
                    if (config.calcCol2) document.getElementById('calc-col2').value = config.calcCol2;
                    document.getElementById('calc-col2').style.display = ['ratio', 'growth'].includes(config.calcMode) ? 'block' : 'none';
                    document.getElementById('label-text-col').value = config.labelTextCol || '';
                }

                currentPins = Array.isArray(config.pins)
                    ? config.pins.map(p => makePin(parseCoordinate(p.lon), parseCoordinate(p.lat), p.color, p.label, p.icon)).filter(Boolean)
                    : [];
                renderPinList();
                document.getElementById('pin-show-labels').checked = config.showPinLabels !== false;
                document.getElementById('pin-show-legend').checked = config.showPinLegend !== false;
                document.getElementById('pin-size').value = config.pinSize || 5;
                document.getElementById('pin-icon-size').value = config.pinIconSize || 28;

                document.getElementById('map-title').value = config.title || "";
                document.getElementById('title-font-select').value = config.titleFont || DEFAULT_FONT;
                document.getElementById('title-font-size').value = config.titleFontSize || 17;
                document.getElementById('label-font-select').value = config.labelFont || DEFAULT_FONT;
                document.getElementById('map-scale').value = config.scale || "national";
                document.getElementById('label-type').value = config.labelType || "none";
                document.getElementById('map-show-legend').checked = config.showLegend !== false;
                setMapColors(config.mapColors);
                document.getElementById('map-palette').value = config.palette || "default";
                document.getElementById('label-toolkit').style.display = config.labelType !== 'none' ? 'block' : 'none';
                if (config.labelSize) document.getElementById('label-size').value = config.labelSize;
                if (config.labelFilterNames) document.getElementById('label-filter-names').value = config.labelFilterNames;
                if (config.physPadding) document.getElementById('phys-padding').value = config.physPadding;
                if (config.physStrength) document.getElementById('phys-strength').value = config.physStrength;
                document.getElementById('layer-show-relief').checked = config.showRelief === true;
                document.getElementById('layer-relief-opacity').value = config.reliefOpacity ?? 0.6;
                document.getElementById('layer-show-roads').checked = config.showRoads === true;
                document.getElementById('layer-show-hydro').checked = config.showHydro === true;
                document.getElementById('layer-show-rail').checked = config.showRail === true;
                document.getElementById('layer-show-airports').checked = config.showAirports === true;
                document.getElementById('layer-show-cities').checked = config.showCities === true;

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

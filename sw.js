const CACHE_NAME = 'simplecarto-v5';
const PICTOGRAM_MANIFEST_URLS = [
    './icons/pictograms/manifest.json',
    './icons/pictograms-dsfr/manifest.json'
];

const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './js/geo-engine.js',
    './js/studio.js',
    './js/pwa.js',
    './js/pictogram-catalog.js',
    './js/dsfr-pictogram-catalog.js',
    './libs/papaparse.min.js',
    './libs/d3.v7.min.js',
    './libs/topojson.v3.min.js',
    './libs/html2canvas.min.js',
    './data/v_commune_2025.csv',
    './data/EPCI_2025.csv',
    './data/world_region_list.json',
    './data/commune_2025.json',
    './data/departement_2025.json',
    './data/world_2025.json',
    './data/samples/france_communes.csv',
    './data/samples/france_departements.csv',
    './data/samples/monde.csv',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/favicon.ico',
    ...PICTOGRAM_MANIFEST_URLS
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            await cache.addAll(PRECACHE_URLS);
            for (const manifestUrl of PICTOGRAM_MANIFEST_URLS) {
                try {
                    const res = await fetch(manifestUrl);
                    const pictogramPaths = await res.json();
                    await cache.addAll(pictogramPaths);
                } catch (e) {
                    console.error('Précache des pictogrammes impossible, ils seront mis en cache à la demande :', manifestUrl, e);
                }
            }
            self.skipWaiting();
        })()
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
            ))
            .then(() => self.clients.claim())
    );
});

// Cache d'abord (app 100% hors-ligne), avec repli réseau et mise à jour silencieuse du cache
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            const networkFetch = fetch(event.request).then((response) => {
                if (response && response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => cached);

            return cached || networkFetch;
        })
    );
});

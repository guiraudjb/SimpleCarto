/**
 * SimpleCarto - Intégration PWA (service worker + invite d'installation)
 */

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
            console.error('Échec de l\'enregistrement du service worker :', err);
        });
    });
}

let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    const btn = document.getElementById('btn-install-app');
    if (btn) btn.style.display = 'inline-flex';
});

window.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btn-install-app');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        btn.style.display = 'none';
    });
});

window.addEventListener('appinstalled', () => {
    const btn = document.getElementById('btn-install-app');
    if (btn) btn.style.display = 'none';
    if (typeof showToast === 'function') showToast('Installation réussie', 'SimpleCarto est maintenant disponible hors-ligne.', 'success');
});

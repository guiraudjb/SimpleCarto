/**
 * SimpleCarto - Intégration PWA (service worker + invite d'installation)
 *
 * Firefox n'implémente pas beforeinstallprompt (Mozilla a refusé de
 * standardiser cette API). On propose donc, pour Firefox spécifiquement,
 * une alternative honnête plutôt que de cacher silencieusement le bouton :
 *  - Firefox Android : instructions pour "Ajouter à l'écran d'accueil"
 *    (fonctionnalité native du navigateur, pas de notre ressort).
 *  - Firefox desktop (Windows/Linux/macOS) : lien vers l'extension tierce
 *    PWAsForFirefox, la seule façon d'obtenir une fenêtre autonome.
 */

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
            console.error('Échec de l\'enregistrement du service worker :', err);
        });
    });
}

function detectBrowserPlatform() {
    const ua = navigator.userAgent;
    return {
        isFirefox: /firefox/i.test(ua) && !/seamonkey/i.test(ua),
        isAndroid: /android/i.test(ua)
    };
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

    const { isFirefox, isAndroid } = detectBrowserPlatform();

    if (isFirefox && isAndroid) {
        // Pas d'API pour déclencher l'invite : on affiche le bouton
        // directement et on explique la manipulation manuelle.
        btn.textContent = '📲 Ajouter à l\'écran d\'accueil';
        btn.style.display = 'inline-flex';
        btn.addEventListener('click', () => {
            if (typeof showToast === 'function') {
                showToast(
                    'Installation sur Firefox Android',
                    'Ouvrez le menu ⋮ de Firefox, puis « Ajouter à l\'écran d\'accueil ».',
                    'info'
                );
            }
        });
        return;
    }

    if (isFirefox && !isAndroid) {
        // Firefox desktop n'a aucun mécanisme natif d'installation de PWA.
        btn.textContent = '🦊 Installer via une extension';
        btn.style.display = 'inline-flex';
        btn.addEventListener('click', () => {
            if (typeof showToast === 'function') {
                showToast(
                    'Installation sur Firefox',
                    'Firefox ne propose pas d\'installation native. Ouverture de PWAsForFirefox, une extension qui permet d\'installer SimpleCarto comme une application autonome.',
                    'info'
                );
            }
            window.open('https://github.com/filips123/PWAsForFirefox', '_blank', 'noopener,noreferrer');
        });
        return;
    }

    // Navigateurs à base Chromium (Chrome, Edge, Opera...) : flux standard.
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

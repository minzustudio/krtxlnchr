/**
 * Limite le nombre de résolutions de téléchargement (donc de navigateurs
 * Chrome) actives en même temps, pour ne jamais épuiser la RAM/CPU du VPS
 * peu importe combien d'utilisateurs frappent le serveur simultanément.
 */
function creerSemaphore(limite) {
    let actifs = 0;
    const file = [];

    function suivant() {
        if (actifs >= limite || file.length === 0) return;
        actifs++;
        const { resolve } = file.shift();
        resolve();
    }

    return {
        async acquerir() {
            if (actifs < limite) {
                actifs++;
                return;
            }
            await new Promise((resolve) => file.push({ resolve }));
        },
        liberer() {
            actifs = Math.max(0, actifs - 1);
            suivant();
        },
        get actifs() { return actifs; },
        get enAttente() { return file.length; }
    };
}

module.exports = { creerSemaphore };

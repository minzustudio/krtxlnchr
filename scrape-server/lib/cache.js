/**
 * Cache TTL en mémoire (pour /game-info, dont le contenu est identique pour
 * tout le monde) et déduplication de requêtes en vol (pour
 * /resolve-download, dont le résultat ne doit PAS être partagé entre
 * utilisateurs différents dans la durée — certains liens d'hébergeurs sont
 * à usage limité — mais dont les requêtes strictement simultanées pour le
 * même jeu peuvent partager une seule résolution).
 */

function creerCacheAvecTTL(ttlMs) {
    const entrees = new Map();
    return {
        obtenir(cle) {
            const entree = entrees.get(cle);
            if (!entree) return null;
            if (Date.now() - entree.horodatage > ttlMs) {
                entrees.delete(cle);
                return null;
            }
            return entree.valeur;
        },
        definir(cle, valeur) {
            entrees.set(cle, { valeur, horodatage: Date.now() });
        }
    };
}

function creerDedupliqueur() {
    const enCours = new Map();
    return function dedupliquer(cle, fabriquePromesse) {
        if (enCours.has(cle)) return enCours.get(cle);
        const promesse = fabriquePromesse().finally(() => enCours.delete(cle));
        enCours.set(cle, promesse);
        return promesse;
    };
}

module.exports = { creerCacheAvecTTL, creerDedupliqueur };

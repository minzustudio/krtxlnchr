// Copie ce fichier en "secrets.local.js" (jamais suivi par git, voir
// .gitignore) et renseigne les vraies valeurs après avoir déployé
// scrape-server/ sur ta VPS (voir scrape-server/README.md, étapes 3 et 4).
module.exports = {
    SCRAPE_SERVER_CERT_FINGERPRINT: 'REMPLACE_PAR_L_EMPREINTE_SHA256_REELLE',
    SCRAPE_SERVER_API_KEY: 'REMPLACE_PAR_LA_CLE_API_REELLE'
};

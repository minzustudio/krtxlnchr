/**
 * Génère un certificat TLS auto-signé (valide 20 ans, donc pas de
 * renouvellement à gérer) pour le serveur de scraping Kortex, et affiche
 * son empreinte SHA-256 à coller dans main.js (SCRAPE_SERVER_CERT_FINGERPRINT).
 *
 * À lancer UNE SEULE FOIS lors du premier déploiement. Si tu le relances,
 * un nouveau certificat est généré et l'empreinte change : il faudra
 * republier l'app avec la nouvelle empreinte, sinon plus aucun client
 * ne pourra se connecter (protection normale du pinning).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const selfsigned = require('selfsigned');

const dossierData = path.join(__dirname, 'data');
if (!fs.existsSync(dossierData)) fs.mkdirSync(dossierData, { recursive: true });

const cheminCert = path.join(dossierData, 'cert.pem');
const cheminCle = path.join(dossierData, 'key.pem');

if (fs.existsSync(cheminCert) || fs.existsSync(cheminCle)) {
    console.error('⚠️ Un certificat existe déjà dans data/. Supprime-le manuellement si tu veux vraiment en générer un nouveau (ça cassera les clients déjà déployés tant que tu n\'auras pas mis à jour l\'empreinte dans l\'app).');
    process.exit(1);
}

const attributs = [{ name: 'commonName', value: 'kortex-scrape-server' }];
const pems = selfsigned.generate(attributs, {
    days: 365 * 20,
    keySize: 2048,
    algorithm: 'sha256'
});

fs.writeFileSync(cheminCert, pems.cert);
fs.writeFileSync(cheminCle, pems.private, { mode: 0o600 });

const certDer = crypto.X509Certificate ? new crypto.X509Certificate(pems.cert) : null;
const empreinte = certDer ? certDer.fingerprint256 : 'Impossible de calculer automatiquement (Node trop ancien), utilise: openssl x509 -in cert.pem -noout -fingerprint -sha256';

console.log('✅ Certificat généré dans data/cert.pem et data/key.pem (valide 20 ans).');
console.log('');
console.log('Empreinte SHA-256 à copier dans main.js (SCRAPE_SERVER_CERT_FINGERPRINT) :');
console.log(empreinte);

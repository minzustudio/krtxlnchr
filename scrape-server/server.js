/**
 * Serveur de scraping Kortex.
 *
 * Centralise la récupération des infos d'un jeu et la résolution des liens
 * de téléchargement — le catalogue, lui, reste récupéré côté client (voir
 * test2.js dans l'app), à la demande explicite du projet.
 *
 * Protection contre les abus :
 *  - Clé API partagée obligatoire (X-Kortex-Key), vérifiée en temps constant.
 *  - Rate-limiting par IP sur chaque route, plus strict sur les routes
 *    coûteuses (qui lancent un vrai navigateur Chrome).
 *  - Limite globale du nombre de résolutions simultanées, pour ne jamais
 *    épuiser la RAM/CPU du VPS peu importe le nombre d'utilisateurs.
 *  - Cache TTL sur /game-info (contenu identique pour tout le monde) et
 *    déduplication des requêtes en vol sur /resolve-download.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');

const { recupererInfosJeu } = require('./lib/gameInfo');
const { resoudreTelechargement } = require('./lib/resolveDownload');
const { creerCacheAvecTTL, creerDedupliqueur } = require('./lib/cache');
const { creerSemaphore } = require('./lib/concurrency');

process.on('uncaughtException', (error) => {
    console.error('⚠️ Exception non interceptée (le serveur continue) :', error);
});
process.on('unhandledRejection', (error) => {
    console.error('⚠️ Promesse non gérée (le serveur continue) :', error);
});

const PORT = process.env.PORT || 4433;
const API_KEY = process.env.KORTEX_API_KEY;

if (!API_KEY) {
    console.error("❌ La variable d'environnement KORTEX_API_KEY est obligatoire. Voir README.md.");
    process.exit(1);
}

function cleEgale(a, b) {
    const bufA = Buffer.from(String(a || ''));
    const bufB = Buffer.from(String(b || ''));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function urlSteamripValide(url) {
    return typeof url === 'string' && url.length < 300 && /^https:\/\/steamrip\.com\//i.test(url);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

function envoyerErreur(res, status, code, message) {
    res.status(status).json({ error: code, message: message || code });
}

function authentifier(req, res, next) {
    const cle = req.headers['x-kortex-key'];
    if (!cle || !cleEgale(cle, API_KEY)) {
        return envoyerErreur(res, 401, 'unauthorized', 'Clé API invalide ou manquante.');
    }
    next();
}

const limiteurLecture = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const limiteurResolution = rateLimit({ windowMs: 60 * 1000, max: 6, standardHeaders: true, legacyHeaders: false });

const MAX_RESOLUTIONS_SIMULTANEES = parseInt(process.env.MAX_RESOLUTIONS_SIMULTANEES || '3', 10);
const MAX_FILE_ATTENTE = parseInt(process.env.MAX_FILE_ATTENTE || '10', 10);
const semaphoreResolution = creerSemaphore(MAX_RESOLUTIONS_SIMULTANEES);

const cacheGameInfo = creerCacheAvecTTL(10 * 60 * 1000);
const dedupliquerResolution = creerDedupliqueur();

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use(authentifier);

app.post('/game-info', limiteurLecture, async (req, res) => {
    const url = req.body?.url;
    if (!urlSteamripValide(url)) return envoyerErreur(res, 400, 'invalid_url', 'URL invalide.');

    try {
        const cache = cacheGameInfo.obtenir(url);
        if (cache) return res.json({ status: 'success', ...cache });

        const infos = await recupererInfosJeu(url);
        cacheGameInfo.definir(url, infos);
        res.json({ status: 'success', ...infos });
    } catch (error) {
        console.error('Erreur /game-info :', error.message);
        envoyerErreur(res, 502, 'game_info_failed', error.message);
    }
});

app.post('/resolve-download', limiteurResolution, async (req, res) => {
    const url = req.body?.url;
    if (!urlSteamripValide(url)) return envoyerErreur(res, 400, 'invalid_url', 'URL invalide.');

    if (semaphoreResolution.actifs >= MAX_RESOLUTIONS_SIMULTANEES && semaphoreResolution.enAttente >= MAX_FILE_ATTENTE) {
        return envoyerErreur(res, 503, 'server_busy', 'Le serveur est surchargé, réessaie dans un instant.');
    }

    await semaphoreResolution.acquerir();
    try {
        const resultat = await dedupliquerResolution(url, () => resoudreTelechargement(url));
        if (resultat.status !== 'success') {
            return envoyerErreur(res, 404, 'no_link_found', resultat.message);
        }
        res.json(resultat);
    } catch (error) {
        console.error('Erreur /resolve-download :', error.message);
        envoyerErreur(res, 502, 'resolve_failed', error.message);
    } finally {
        semaphoreResolution.liberer();
    }
});

app.use((req, res) => {
    envoyerErreur(res, 404, 'not_found', 'Route inconnue.');
});

app.use((error, req, res, next) => {
    console.error('Erreur non gérée sur une requête :', error);
    if (res.headersSent) return next(error);
    envoyerErreur(res, 500, 'internal_error', 'Erreur interne.');
});

const cheminCert = path.join(__dirname, 'data', 'cert.pem');
const cheminCle = path.join(__dirname, 'data', 'key.pem');

if (!fs.existsSync(cheminCert) || !fs.existsSync(cheminCle)) {
    console.error("❌ Certificat introuvable. Lance d'abord : npm run generate-cert");
    process.exit(1);
}

https.createServer({ cert: fs.readFileSync(cheminCert), key: fs.readFileSync(cheminCle) }, app).listen(PORT, () => {
    console.log(`✅ Serveur de scraping Kortex en écoute sur le port ${PORT} (HTTPS).`);
});

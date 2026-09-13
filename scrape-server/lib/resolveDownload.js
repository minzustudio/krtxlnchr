const cheerio = require('cheerio');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// playwright-extra accepte les plugins puppeteer-extra (même API) : c'est
// la combinaison officiellement recommandée, bien plus complète que des
// overrides manuels (patch navigator.webdriver, plugins, permissions,
// WebGL, chrome.runtime, etc. — pas juste 2-3 propriétés). Déjà utilisée
// avec succès ailleurs dans ce projet (test2.js) contre ce même site.
chromium.use(StealthPlugin());

const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://steamrip.com/'
};

const ARGS_NAVIGATEUR = ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-features=IsolateOrigins,site-per-process'];

async function resoudreBuzzheaver(urlHebergeur, urlPageSteamrip) {
    // bzzhr.to est protégé par un vrai défi Cloudflare (confirmé : code 403,
    // titre "Just a moment...") — un simple GET HTTP ne peut jamais le
    // résoudre (pas de moteur JS). Il faut un navigateur qui puisse exécuter
    // le défi, et suffisamment furtif pour ne pas être détecté comme
    // automatisé (le plugin stealth patche navigator.webdriver, plugins,
    // permissions, WebGL, chrome.runtime... bien plus que des overrides
    // manuels). On navigue directement vers le lien avec le bon Referer
    // (celui de la page du jeu, pas juste "steamrip.com") plutôt que de
    // cliquer depuis steamrip — équivalent, mais un aller-retour de moins.
    let browser;
    console.log(`[Buzzheaver] Démarrage résolution pour ${urlHebergeur} (referer : ${urlPageSteamrip})`);
    try {
        browser = await chromium.launch({ headless: true, channel: 'chrome', args: ARGS_NAVIGATEUR });
        console.log('[Buzzheaver] Navigateur lancé.');
        const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-US', timezoneId: 'America/New_York' });
        const page = await context.newPage();

        await page.goto(urlHebergeur, { waitUntil: 'domcontentloaded', timeout: 20000, referer: urlPageSteamrip });
        console.log(`[Buzzheaver] Page chargée. URL actuelle : ${page.url()}, titre : "${await page.title().catch(() => 'inconnu')}"`);

        const lienCopie = page.locator('a.copy[onclick*="copyDownloadLink"]').first();
        try {
            await lienCopie.waitFor({ state: 'attached', timeout: 20000 });
            console.log('[Buzzheaver] Bouton "Copy download link" trouvé.');
        } catch (e) {
            const titre = await page.title().catch(() => 'inconnu');
            throw new Error(`Bouton 'Copy download link' introuvable après 20s (titre de la page : "${titre}", URL : ${page.url()}).`);
        }

        const chemin = await lienCopie.evaluate((el) => {
            const match = (el.getAttribute('onclick') || '').match(/copyDownloadLink\('([^']+)'\)/);
            return match ? match[1].replace(/\\\//g, '/') : null;
        });

        if (!chemin) throw new Error("Attribut 'onclick' du bouton Buzzheaver invalide.");
        console.log(`[Buzzheaver] Chemin extrait de l'onclick : ${chemin}`);

        const origine = new URL(page.url()).origin;
        const lienIntermediaire = `${origine}${chemin}`;
        console.log(`[Buzzheaver] Lien intermédiaire (htmx) : ${lienIntermediaire}`);

        // Ce lien intermédiaire n'est PAS le fichier : c'est un endpoint htmx
        // qui répond 204 No Content avec le vrai lien direct dans le header
        // "hx-redirect" (vers un sous-domaine du type ts.bzzhr.to). Il faut
        // l'appeler avec l'en-tête hx-request, depuis ce même navigateur
        // (seul à avoir le cookie cf_clearance valide), puis récupérer ce
        // header pour obtenir le vrai lien final.
        const resultatHtmx = await page.evaluate(async (urlIntermediaire) => {
            const reponse = await fetch(urlIntermediaire, {
                method: 'GET',
                headers: {
                    'hx-request': 'true',
                    'Accept': '*/*',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            return { status: reponse.status, hxRedirect: reponse.headers.get('hx-redirect') };
        }, lienIntermediaire);
        console.log(`[Buzzheaver] Réponse endpoint htmx : statut ${resultatHtmx.status}, hx-redirect : ${resultatHtmx.hxRedirect || '(absent)'}`);

        if (!resultatHtmx.hxRedirect) {
            throw new Error(`Endpoint htmx Buzzheaver n'a renvoyé aucun header 'hx-redirect' (statut ${resultatHtmx.status}).`);
        }

        const link = resultatHtmx.hxRedirect;

        const cookiesPage = await context.cookies();
        const cookies = cookiesPage.map((c) => `${c.name}=${c.value}`).join('; ');
        console.log(`[Buzzheaver] ${cookiesPage.length} cookie(s) capturé(s) : ${cookiesPage.map((c) => c.name).join(', ') || '(aucun)'}`);
        console.log(`[Buzzheaver] Lien final réel : ${link}`);

        // On vérifie le VRAI lien final (celui que le client va utiliser),
        // pas le lien intermédiaire htmx — c'est justement ce qui manquait
        // avant : le check passait sur le mauvais lien.
        let preVerifie = false;
        try {
            const verif = await page.evaluate(async (urlLien) => {
                const reponse = await fetch(urlLien, { method: 'HEAD' });
                return { status: reponse.status, ok: reponse.ok };
            }, link);
            preVerifie = verif.ok || verif.status === 206;
            console.log(`[Buzzheaver] Vérification joignabilité intra-navigateur (lien final) : statut ${verif.status} (${preVerifie ? 'OK' : 'échec'})`);
        } catch (e) {
            console.log(`[Buzzheaver] Échec de la vérification intra-navigateur : ${e.message}`);
        }

        return { link, cookies, chunks: 15, preVerifie };
    } finally {
        if (browser) await browser.close();
        console.log('[Buzzheaver] Navigateur fermé.');
    }
}

async function resoudreMegaDB(urlHebergeur, urlPageSteamrip) {
    // L'UI de MegaDB a changé : il n'y a plus de #downloadbtn direct. La
    // page embarque désormais le vrai lien intermédiaire dans une variable
    // JS ("finalDownloadUrl"), déjà présente au chargement — pas besoin de
    // cliquer sur quoi que ce soit. Ce lien intermédiaire applique un délai
    // anti-bot d'environ 10s (visible côté UI comme un compte à rebours) :
    // y accéder trop tôt renvoie juste la même page. Après le délai, il
    // redirige (302) vers le vrai lien final, à usage unique, sur un
    // sous-domaine du type fs12.megadb.xyz.
    let browser;
    try {
        console.log(`[MegaDB] Démarrage résolution pour ${urlHebergeur}`);
        browser = await chromium.launch({ headless: true, channel: 'chrome', args: ARGS_NAVIGATEUR });
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            locale: 'en-US',
            timezoneId: 'America/New_York',
            acceptDownloads: true
        });
        const page = await context.newPage();

        await page.goto(urlHebergeur, { waitUntil: 'domcontentloaded', timeout: 30000, referer: urlPageSteamrip });
        console.log(`[MegaDB] Page chargée. URL actuelle : ${page.url()}, titre : "${await page.title().catch(() => 'inconnu')}"`);
        const pageUrl = page.url();

        const html = await page.content();
        const correspondance = html.match(/finalDownloadUrl\s*=\s*'([^']+)'/);
        if (!correspondance) throw new Error("Variable 'finalDownloadUrl' introuvable sur la page MegaDB.");
        const lienIntermediaire = correspondance[1];
        console.log(`[MegaDB] Lien intermédiaire extrait : ${lienIntermediaire}`);

        console.log('[MegaDB] Attente du délai anti-bot (11s)...');
        await page.waitForTimeout(11000);

        // Le download_token généré par MegaDB est à usage unique : la toute
        // première requête qui l'atteint le consomme, que cette requête soit
        // menée à bien ou interrompue (confirmé : naviguer la page vers ce
        // lien fait bien partir une vraie requête réseau vers le CDN — même
        // si Chrome l'annule ensuite en la reconnaissant comme un
        // téléchargement, net::ERR_ABORTED — ce qui grillait le lien avant
        // même que le launcher ne puisse s'en servir). On utilise donc
        // `context.request` (le client HTTP de Playwright, qui partage les
        // cookies du navigateur) avec `maxRedirects: 0` pour ne récupérer
        // QUE le header "Location" de la redirection, sans jamais laisser le
        // navigateur toucher au CDN final.
        const reponse = await context.request.get(lienIntermediaire, {
            headers: { Referer: pageUrl },
            maxRedirects: 0,
            failOnStatusCode: false
        });
        const link = reponse.headers()['location'] || null;

        if (!link) throw new Error(`Redirection MegaDB introuvable (statut ${reponse.status()}, header 'Location' absent).`);
        console.log(`[MegaDB] Lien final intercepté (jamais consommé) : ${link}`);

        return { link, cookies: '', chunks: 15 };
    } finally {
        if (browser) await browser.close();
        console.log('[MegaDB] Navigateur fermé.');
    }
}

async function resoudreGofile(urlHebergeur) {
    let browser;
    try {
        browser = await chromium.launch({ headless: true, channel: 'chrome', args: ARGS_NAVIGATEUR });
        const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-US', timezoneId: 'America/New_York', acceptDownloads: true });
        const page = await context.newPage();

        console.log(`[Gofile] Démarrage résolution pour ${urlHebergeur}`);
        await page.goto(urlHebergeur, { waitUntil: 'domcontentloaded', timeout: 20000 });
        console.log(`[Gofile] Page chargée. Titre : "${await page.title().catch(() => 'inconnu')}"`);

        // On récupérait auparavant le champ "Stored on" des propriétés pour
        // reconstruire nous-mêmes l'URL (https://<storedOn>.gofile.io/...),
        // mais ce champ ne correspond plus au vrai sous-domaine CDN utilisé
        // par Gofile (ex. "store4" affiché, alors que le vrai lien pointe
        // vers "file-na-phx-1.gofile.io") — reconstruire l'URL à la main est
        // devenu peu fiable. On clique directement sur "Download" et on
        // intercepte le vrai lien via l'évènement de téléchargement du
        // navigateur, qui est toujours exact quel que soit le nommage interne
        // de Gofile.
        const boutonTelecharger = page.locator('button[data-action="download"]').first();
        await boutonTelecharger.waitFor({ state: 'visible', timeout: 15000 });
        console.log('[Gofile] Bouton "Download" trouvé.');

        const telechargementPromesse = page.waitForEvent('download', { timeout: 15000 });
        await boutonTelecharger.click();
        const telechargement = await telechargementPromesse;
        const link = telechargement.url();
        console.log(`[Gofile] Lien de téléchargement intercepté : ${link}`);
        try { await telechargement.cancel(); } catch (e) {}

        // Le cookie "accountToken" (identité de session invité Gofile) est
        // requis par le CDN de téléchargement — sans lui, il renvoie la page
        // web HTML au lieu du fichier, même avec le bon lien et un Referer
        // correct (confirmé par test direct).
        const cookiesPage = await page.context().cookies();
        const cookies = cookiesPage.map((c) => `${c.name}=${c.value}`).join('; ');
        console.log(`[Gofile] ${cookiesPage.length} cookie(s) capturé(s) : ${cookiesPage.map((c) => c.name).join(', ') || '(aucun)'}`);

        return { link, cookies, chunks: 5 };
    } finally {
        if (browser) await browser.close();
        console.log('[Gofile] Navigateur fermé.');
    }
}

async function lienJoignable(link, cookies) {
    console.log(`[Joignabilité] Vérification de ${link} (cookies : ${cookies ? `${cookies.length} caractère(s)` : 'aucun'})`);
    try {
        const { gotScraping } = await import('got-scraping');
        const headers = { ...BASE_HEADERS, Range: 'bytes=0-0' };
        if (cookies) headers['Cookie'] = cookies;

        // On utilise un GET avec Range plutôt qu'un HEAD : certains CDN de
        // streaming de fichiers (constaté avec megadb.xyz) gèrent mal HEAD
        // et laissent la requête traîner sans jamais répondre, alors qu'un
        // GET classique répond normalement et rapidement — c'est d'ailleurs
        // le pattern qui a marché de façon fiable à chaque test manuel
        // pendant le débogage. Mode stream + destroy dès réception des
        // headers : si un serveur ignore le Range et tente de renvoyer le
        // fichier entier (parfois plusieurs centaines de Mo), on ne
        // télécharge jamais le corps, juste le statut.
        //
        // L'option timeout.request de got-scraping n'est pas toujours
        // respectée (constaté : une requête vers un lien expiré peut rester
        // bloquée indéfiniment, bien au-delà des 8s configurées, ce qui
        // gèle tout le pipeline de résolution). On force donc une limite
        // dure avec Promise.race, qui abandonne quoi qu'il arrive.
        const reponse = await Promise.race([
            new Promise((resolve, reject) => {
                const flux = gotScraping.stream({
                    url: link,
                    method: 'GET',
                    headers,
                    timeout: { request: 8000 },
                    throwHttpErrors: false,
                    retry: { limit: 1 }
                });
                flux.on('response', (rep) => {
                    resolve(rep);
                    flux.destroy();
                });
                flux.on('error', reject);
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout dur (10s) : la requête ne répondait pas.')), 10000))
        ]);
        console.log(`[Joignabilité] Réponse pour ${link} : statut ${reponse.statusCode}, headers importants : content-length=${reponse.headers['content-length']}, content-type=${reponse.headers['content-type']}, cf-mitigated=${reponse.headers['cf-mitigated'] || 'aucun'}`);
        const statutOk = reponse.statusCode === 200 || reponse.statusCode === 206 || reponse.statusCode === 302;
        // Un vrai fichier ne renvoie jamais du HTML : certains hébergeurs
        // (constaté avec MegaDB sur un token déjà invalidé) répondent avec un
        // statut 200 "normal" mais un corps qui est en fait une page d'erreur
        // — le seul statut ne suffit donc pas à garantir la joignabilité.
        const typeContenu = (reponse.headers['content-type'] || '').toLowerCase();
        const estPageHtml = typeContenu.startsWith('text/html');
        const ok = statutOk && !estPageHtml;
        if (!statutOk) console.log(`[Joignabilité] Rejeté : statut ${reponse.statusCode} non accepté.`);
        else if (estPageHtml) console.log(`[Joignabilité] Rejeté : statut ${reponse.statusCode} mais content-type HTML (page d'erreur probable, lien invalide/expiré).`);
        return ok;
    } catch (e) {
        console.log(`[Joignabilité] Erreur réseau/timeout sur ${link} : ${e.message}`);
        return false;
    }
}

async function resoudreTelechargement(urlPageSteamrip) {
    const { gotScraping } = await import('got-scraping');

    const reponsePage = await gotScraping({ url: urlPageSteamrip, http2: true, timeout: { request: 15000 } });
    const $ = cheerio.load(reponsePage.body);

    const liensIntermediaires = [];
    $('a').each((index, element) => {
        const texte = $(element).text().trim();
        if (texte === 'DOWNLOAD HERE') {
            let href = $(element).attr('href');
            if (href) {
                if (href.startsWith('//')) href = `https:${href}`;
                liensIntermediaires.push(href);
            }
        }
    });

    if (liensIntermediaires.length === 0) {
        return { status: 'error', message: 'Aucun lien de téléchargement trouvé sur la page.' };
    }

    console.log(`[DEBUG] ${liensIntermediaires.length} lien(s) serveur trouvé(s) : ${liensIntermediaires.join(', ')}`);

    const liensParHote = { buzzheaver: null, megadb: null, gofile: null };
    for (const url of liensIntermediaires) {
        if (!liensParHote.buzzheaver && (url.includes('bzzhr.to') || url.includes('buzzheaver') || url.includes('buzzhvr'))) {
            liensParHote.buzzheaver = url;
        } else if (!liensParHote.megadb && url.includes('megadb.net')) {
            liensParHote.megadb = url;
        } else if (!liensParHote.gofile && url.includes('gofile.io')) {
            liensParHote.gofile = url;
        }
    }

    // Vérifie la joignabilité d'un résultat de résolution fraîchement obtenu,
    // en respectant son éventuelle pré-vérification déjà faite en navigateur.
    async function verifierEtAjouter(hostName, resultat, listeCandidats) {
        if (!resultat) return false;
        console.log(`[DEBUG] Résultat résolution ${hostName} :`, resultat);
        let joignable = resultat.preVerifie;
        if (joignable) {
            console.log(`[Joignabilité] ${hostName} déjà vérifié depuis le navigateur qui a résolu le lien, pas de nouveau contrôle.`);
        } else {
            joignable = await lienJoignable(resultat.link, resultat.cookies);
        }
        if (joignable) {
            listeCandidats.push({ hostName, ...resultat });
            return true;
        }
        console.log(`⚠️ Serveur ${hostName} injoignable, exclu.`);
        return false;
    }

    // Buzzheaver et Gofile sont rapides à résoudre et n'imposent aucun délai
    // artificiel : on tente toujours les deux (le client garde ainsi un
    // vrai choix de repli si l'un des deux devient injoignable d'ici le
    // début du téléchargement réel). MegaDB, en revanche, impose un délai
    // anti-bot serveur d'environ 10s incompressible (vérifié : échoue à
    // 10.0s, réussit à 10.3s) avant de livrer le vrai lien — inutile de le
    // payer si Buzzheaver ou Gofile fonctionne déjà.
    const candidats = [];

    if (liensParHote.buzzheaver) {
        console.log(`[DEBUG] Traitement du lien Buzzheaver : ${liensParHote.buzzheaver}`);
        const resultat = await resoudreBuzzheaver(liensParHote.buzzheaver, urlPageSteamrip).catch((e) => {
            console.error('[ERREUR] Buzzheaver ignoré :', e.message);
            return null;
        });
        await verifierEtAjouter('Buzzheaver', resultat, candidats);
    }

    if (liensParHote.gofile) {
        console.log(`[DEBUG] Traitement du lien Gofile : ${liensParHote.gofile}`);
        const resultat = await resoudreGofile(liensParHote.gofile).catch((e) => {
            console.error('[ERREUR] Gofile ignoré :', e.message);
            return null;
        });
        await verifierEtAjouter('Gofile', resultat, candidats);
    }

    if (candidats.length > 0) {
        console.log(`[INFO] ${candidats.length} candidat(s) rapide(s) déjà joignable(s) (${candidats.map((c) => c.hostName).join(', ')}) — MegaDB non tenté (délai anti-bot évité).`);
    } else if (liensParHote.megadb) {
        // MegaDB délivre un token à usage unique dont l'invalidation est
        // parfois immédiate côté serveur (constaté rarement : le lien est
        // déjà mort au moment même du contrôle de joignabilité, alors que le
        // même code réussit de façon fiable la grande majorité du temps) —
        // une nouvelle tentative avec un tout nouveau token résout ce flake.
        const NB_TENTATIVES_MEGADB = 2;
        for (let tentative = 1; tentative <= NB_TENTATIVES_MEGADB && candidats.length === 0; tentative++) {
            console.log(`[DEBUG] Aucun candidat rapide disponible, tentative ${tentative}/${NB_TENTATIVES_MEGADB} avec MegaDB (délai anti-bot ~10s) : ${liensParHote.megadb}`);
            const resultat = await resoudreMegaDB(liensParHote.megadb, urlPageSteamrip).catch((e) => {
                console.error('[ERREUR] MegaDB ignoré :', e.message);
                return null;
            });
            await verifierEtAjouter('MegaDB', resultat, candidats);
        }
    }

    if (candidats.length === 0) {
        return { status: 'error', message: "Aucun lien de téléchargement n'a pu être récupéré sur les hébergeurs disponibles." };
    }

    console.log(`✅ ${candidats.length} candidat(s) joignable(s) : ${candidats.map((c) => c.hostName).join(', ')}`);
    return { status: 'success', candidates: candidats };
}

module.exports = { resoudreTelechargement };

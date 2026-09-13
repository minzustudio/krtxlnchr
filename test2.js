const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');

puppeteer.use(StealthPlugin());

// aria-label="Command &amp; Conquer" arrive tel quel (entité HTML non
// décodée) : sans ça, le nom stocké ("Command &amp; Conquer") diffère du
// nom que le navigateur restitue une fois l'attribut HTML parsé
// ("Command & Conquer"), et les clés calculées à partir de l'un ou l'autre
// ne correspondent plus jamais.
function decoderEntitesHtml(texte) {
    return cheerio.load(`<div>${texte}</div>`)('div').text();
}

function slugify(text) {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/<[^>]*>/g, '')
        .replace(/['’]/g, '-')
        .replace(/[^a-z0-9 -]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

async function fetchSteamRipCatalogue() {
    const browser = await puppeteer.launch({
        headless: true,
        channel: 'chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log('Connexion au site pour initialiser la session...');
        await page.goto('https://steamrip.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('Exécution de la requête AJAX...');
        const rawResponse = await page.evaluate(async () => {
            const params = new URLSearchParams();
            params.append('action', 'tie_blocks_load_more');
            params.append('block[order]', 'latest');
            params.append('block[number]', '5000');
            params.append('block[posts_category]', 'true');
            params.append('block[style]', 'default');
            params.append('block[title_length]', '');
            params.append('block[excerpt_length]', '');
            params.append('block[media_overlay]', '');
            params.append('block[read_more_text]', '');
            params.append('page', '0');
            params.append('width', 'full');

            const response = await fetch('https://steamrip.com/wp-admin/admin-ajax.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: params
            });

            return await response.text();
        });

        console.log("=== TRAITEMENT DES DONNÉES ===");

        let parsedData;
        try {
            parsedData = JSON.parse(rawResponse);
            if (typeof parsedData === 'string') {
                parsedData = JSON.parse(parsedData);
            }
        } catch (e) {
            throw new Error(`Erreur lors du parsing JSON : ${e.message}`);
        }

        if (!parsedData || typeof parsedData.code !== 'string') {
            throw new Error("La structure JSON ne contient pas de propriété 'code' valide.");
        }

        const htmlContent = parsedData.code
            .replace(/\\"/g, '"')
            .replace(/\\\//g, '/');

        const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/g;
        const gamesObject = {};

        let match;
        while ((match = liRegex.exec(htmlContent)) !== null) {
            const liHtml = match[1];

            const hrefMatch = liHtml.match(/href="([^"]+)"/);
            const url = hrefMatch ? hrefMatch[1] : '';

            const labelMatch = liHtml.match(/aria-label="([^"]+)"/);
            const nom = labelMatch ? decoderEntitesHtml(labelMatch[1]) : '';

            const imgMatch = liHtml.match(/src="([^"]+)"/);
            const image = imgMatch ? imgMatch[1] : '';

            if (nom && url) {
                const key = slugify(nom);
                gamesObject[key] = {
                    gameName: nom,
                    url: url,
                    imageLink: image || "Pas d'image"
                };
            }
        }

        const totalGames = Object.keys(gamesObject).length;
        if (totalGames === 0) {
            throw new Error("Aucun jeu trouvé dans la réponse du catalogue.");
        }

        console.log(`=== CATALOGUE RÉCUPÉRÉ (${totalGames} jeux) ===`);
        return gamesObject;

    } finally {
        await browser.close();
    }
}

module.exports = { fetchSteamRipCatalogue };

if (require.main === module) {
    fetchSteamRipCatalogue()
        .then((games) => {
            console.log(`${Object.keys(games).length} jeux extraits.`);
        })
        .catch((error) => {
            console.error('Erreur lors de l\'exécution :', error);
        });
}
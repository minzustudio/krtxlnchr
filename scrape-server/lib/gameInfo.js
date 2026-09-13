const cheerio = require('cheerio');

async function recupererInfosJeu(url) {
    const { gotScraping } = await import('got-scraping');

    const reponse = await gotScraping({ url, http2: true, timeout: { request: 15000 } });
    const $ = cheerio.load(reponse.body);

    let gameSize = null;
    let version = null;
    let servers = [];
    let mainImage = null;
    let previews = [];

    const getAbsoluteUrl = (chemin) => {
        if (!chemin) return null;
        try {
            return new URL(chemin, url).href;
        } catch (e) {
            return chemin;
        }
    };

    $('li').each((index, element) => {
        const texteComplet = $(element).text().trim();
        if (texteComplet.toLowerCase().includes('game size:')) {
            gameSize = texteComplet.replace(/game size:/i, '').trim();
        }
        if (texteComplet.toLowerCase().includes('version:')) {
            version = texteComplet.replace(/version:/i, '').trim();
        }
    });

    $('a.shortc-button').each((index, element) => {
        const buttonText = $(element).text().trim();
        if (buttonText.toUpperCase() === 'DOWNLOAD HERE') {
            let rawServerName = $(element).parent().text().replace(/DOWNLOAD HERE/ig, '').trim();
            if (rawServerName) {
                const formattedName = rawServerName.charAt(0).toUpperCase() + rawServerName.slice(1).toLowerCase();
                if (!servers.includes(formattedName)) servers.push(formattedName);
            }
        }
    });

    const variantesBuzzheaver = ['buzzhvr', 'bzzhr', 'buzzheaver'];
    const indexBuzzhvr = servers.findIndex((nomServeur) => {
        const nomMinuscule = nomServeur.toLowerCase();
        return variantesBuzzheaver.some((variante) => nomMinuscule.includes(variante));
    });
    if (indexBuzzhvr > 0) {
        const [buzzhvr] = servers.splice(indexBuzzhvr, 1);
        servers.unshift(buzzhvr);
    }

    const mainImgElement = $('figure.single-featured-image img');
    let rawMainImage = mainImgElement.attr('src');

    if (!rawMainImage || rawMainImage.startsWith('data:')) {
        const srcset = mainImgElement.attr('srcset');
        const dataSrc = mainImgElement.attr('data-src') || mainImgElement.attr('data-lazy-src');

        if (srcset) {
            rawMainImage = srcset.split(',')[0].trim().split(' ')[0];
        } else if (dataSrc) {
            rawMainImage = dataSrc;
        }
    }

    if (rawMainImage) mainImage = getAbsoluteUrl(rawMainImage);

    $('img.alignnone').each((index, element) => {
        const parentAnchor = $(element).parent('a').attr('href');
        const imgSrc = parentAnchor || $(element).attr('src');
        if (imgSrc) previews.push(getAbsoluteUrl(imgSrc));
    });

    return { gameSize, version, servers, mainImage, previews };
}

module.exports = { recupererInfosJeu };

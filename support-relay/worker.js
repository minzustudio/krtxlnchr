/**
 * Relais Support Kortex.
 *
 * Ce Worker reçoit les messages de support envoyés depuis l'app Kortex,
 * les valide, applique une limite anti-spam par IP, puis les transmet
 * au webhook Discord réel.
 *
 * Le webhook Discord n'est JAMAIS présent dans ce fichier ni dans l'app :
 * il vit uniquement en tant que secret Cloudflare (voir README.md).
 * Ce fichier peut donc rester public/open source sans risque.
 */

const CATEGORIES_VALIDES = ['bug', 'suggestion', 'question', 'other'];
const LIMITE_MESSAGES = 5;
const FENETRE_SECONDES = 3600;

const COULEURS_PAR_CATEGORIE = {
    bug: 0xC1704A,
    suggestion: 0x7A9B6E,
    question: 0x6E8CA0,
    other: 0x9A9A9A
};

function reponseJson(corps, status) {
    return new Response(JSON.stringify(corps), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') {
            return reponseJson({ error: 'method_not_allowed' }, 405);
        }

        let body;
        try {
            body = await request.json();
        } catch (e) {
            return reponseJson({ error: 'invalid_json' }, 400);
        }

        const titre = typeof body.title === 'string' ? body.title.trim().slice(0, 100) : '';
        const description = typeof body.description === 'string' ? body.description.trim().slice(0, 1500) : '';
        const categorieBrute = typeof body.category === 'string' ? body.category.trim().toLowerCase() : 'other';
        const categorie = CATEGORIES_VALIDES.includes(categorieBrute) ? categorieBrute : 'other';
        const appVersion = typeof body.appVersion === 'string' ? body.appVersion.slice(0, 20) : 'inconnue';

        if (!titre || !description) {
            return reponseJson({ error: 'missing_fields' }, 400);
        }

        // --- Anti-spam : limite par IP, via Cloudflare KV ---
        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        const cleCompteur = `ratelimit:${ip}`;

        if (env.SUPPORT_KV) {
            const compteurActuel = parseInt((await env.SUPPORT_KV.get(cleCompteur)) || '0', 10);

            if (compteurActuel >= LIMITE_MESSAGES) {
                return reponseJson({ error: 'rate_limited' }, 429);
            }

            await env.SUPPORT_KV.put(cleCompteur, String(compteurActuel + 1), { expirationTtl: FENETRE_SECONDES });
        }

        if (!env.DISCORD_WEBHOOK_URL) {
            return reponseJson({ error: 'server_misconfigured' }, 500);
        }

        const payloadDiscord = {
            embeds: [{
                title: titre,
                description,
                color: COULEURS_PAR_CATEGORIE[categorie] || COULEURS_PAR_CATEGORIE.other,
                fields: [
                    { name: 'Catégorie', value: categorie, inline: true },
                    { name: 'Version Kortex', value: appVersion, inline: true }
                ],
                timestamp: new Date().toISOString()
            }]
        };

        const reponseDiscord = await fetch(env.DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadDiscord)
        });

        if (!reponseDiscord.ok) {
            return reponseJson({ error: 'discord_relay_failed' }, 502);
        }

        return reponseJson({ status: 'ok' }, 200);
    }
};

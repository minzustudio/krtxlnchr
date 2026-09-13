# Relais Support Kortex

Petit Worker Cloudflare qui reçoit les messages de support envoyés depuis
Kortex et les transmet à un webhook Discord — sans jamais exposer ce
webhook dans l'application distribuée.

## Pourquoi ce relais existe

Kortex est open source et distribué en `.exe`. N'importe qui peut extraire
le contenu de l'app installée (`asar extract`) et lire `main.js` en clair.
Un webhook Discord codé en dur dans l'app serait donc récupérable par
n'importe quel utilisateur, permettant de spammer ton serveur Discord
directement — que le dépôt GitHub soit public ou privé ne change rien.

Ce Worker sert d'intermédiaire : l'app ne connaît que l'URL publique du
Worker (pas sensible en soi), et seul le Worker connaît le vrai webhook
(stocké comme secret Cloudflare, jamais dans un fichier). Il applique
aussi une limite de 5 messages par IP par heure avant de relayer quoi que
ce soit à Discord.

## Déploiement (une seule fois)

Prérequis : un compte Cloudflare gratuit.

```bash
cd support-relay
npm install -g wrangler   # si pas déjà installé
wrangler login

# 1. Créer le namespace KV utilisé pour l'anti-spam
wrangler kv:namespace create SUPPORT_KV
# -> copie l'id retourné dans wrangler.toml (champ "id")

# 2. Enregistrer le vrai webhook Discord comme secret (jamais dans un fichier)
wrangler secret put DISCORD_WEBHOOK_URL
# -> la commande te demande ENSUITE de coller l'URL, de façon interactive.
# NE JAMAIS mettre l'URL du webhook directement dans cette commande, dans ce
# fichier, ou dans n'importe quel fichier suivi par git : colle-la uniquement
# quand le terminal te la demande.

# 3. Déployer
wrangler deploy
```

La commande `wrangler deploy` affiche une URL du type :
`https://kortex-support-relay.<ton-compte>.workers.dev`

Copie cette URL dans `main.js`, dans la constante `SUPPORT_RELAY_URL`.
Cette URL peut rester dans le code source public sans problème : ce n'est
pas un secret, juste le point d'entrée de ton relais.

## Pour changer le webhook plus tard

```bash
wrangler secret put DISCORD_WEBHOOK_URL
```

Aucune mise à jour de l'app n'est nécessaire.

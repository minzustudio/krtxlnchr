# Serveur de scraping Kortex

Ce serveur centralise la récupération des infos d'un jeu et la résolution
des liens de téléchargement direct, pour que ça ne tourne pas sur la
machine des utilisateurs. Le catalogue (liste complète des jeux), lui,
reste récupéré côté client (voir `test2.js` dans l'app) — choix délibéré
du projet, pas géré par ce serveur.

- `POST /game-info` — infos d'un jeu (taille, version, images, hébergeurs).
- `POST /resolve-download` — résout le vrai lien de téléchargement direct
  (Buzzheaver / MegaDB / Gofile) pour un jeu donné. Le fichier lui-même
  n'est **jamais** téléchargé par le serveur : il renvoie juste le lien,
  et c'est l'app de l'utilisateur qui télécharge directement depuis
  l'hébergeur. Pas de bande passante ni de stockage à prévoir côté VPS
  pour ça.

## Pourquoi un certificat auto-signé + une clé API

Deux couches de protection, pour deux problèmes différents :

1. **Chiffrement (certificat auto-signé + pinning)** : ton VPS n'a qu'une
   IP nue (82.41.119.103), donc impossible d'obtenir un certificat
   Let's Encrypt classique (ça demande un nom de domaine). Ce serveur
   génère son propre certificat auto-signé, et l'app Kortex vérifie son
   empreinte exacte avant de faire confiance à la connexion — ça bloque
   toute interception réseau, même sans autorité de certification connue.

2. **Anti-abus (clé API + rate-limiting + limite de concurrence)** :
   n'importe qui qui extrairait la clé de l'app pourrait quand même
   essayer de spammer ton serveur. Comme chaque résolution de
   téléchargement lance un vrai navigateur Chrome (coûteux en RAM/CPU),
   le vrai risque n'est pas "quelqu'un lit mes requêtes" mais "quelqu'un
   fait tomber mon VPS". Donc :
   - Chaque requête doit présenter la bonne clé API (`X-Kortex-Key`).
   - Rate-limiting par IP sur chaque route (plus strict sur
     `/resolve-download`, qui est la plus coûteuse).
   - Au maximum 3 résolutions tournent en même temps sur le serveur —
     toute requête au-delà attend son tour (jusqu'à une file d'attente
     limitée), peu importe le nombre d'utilisateurs simultanés.
   - Si la clé fuit un jour, il suffit de la changer côté serveur et de
     republier l'app avec la nouvelle — aucune donnée sensible n'est
     perdue (contrairement à un webhook Discord par exemple).

## Déploiement sur ton VPS (Ubuntu 24.04)

### 1. Prérequis système

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo apt-get update
```

**Google Chrome réel (obligatoire)** — Buzzheaver, MegaDB et Gofile sont
protégés par de la détection anti-bot qui repère fiablement le Chromium
générique embarqué dans Playwright, même avec les scripts de camouflage.
Un vrai Chrome installé est beaucoup moins détecté :

```bash
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt-get update
sudo apt-get install -y google-chrome-stable
```

### 2. Récupérer le dossier `scrape-server/` sur le VPS

Copie ce dossier sur ton serveur (`scp`, `git clone` de ton repo, ou autre),
puis :

```bash
cd scrape-server
npm install
```

(Pas besoin de `npm run install-browser` : le code utilise le Chrome
installé à l'étape précédente via `channel: 'chrome'`, pas le Chromium
intégré à Playwright.)

### 3. Générer le certificat TLS

```bash
npm run generate-cert
```

Copie l'empreinte SHA-256 affichée — tu en auras besoin à l'étape 5.

### 4. Choisir une clé API secrète

Génère une clé aléatoire robuste, par exemple :

```bash
openssl rand -hex 32
```

Garde-la de côté, tu vas la mettre à deux endroits : dans la config du
serveur (étape suivante) et dans `main.js` (étape 5) — jamais dans un
fichier suivi par git.

### 5. Configurer les variables d'environnement et lancer

Avec [pm2](https://pm2.keymetrics.io/) (recommandé — redémarre
automatiquement le serveur s'il plante) :

```bash
sudo npm install -g pm2

KORTEX_API_KEY="colle_ta_clé_ici" pm2 start server.js --name kortex-scrape
pm2 save
pm2 startup   # affiche une commande à exécuter pour démarrer pm2 au boot
```

Pour changer la clé plus tard sans tout redéployer :

```bash
pm2 delete kortex-scrape
KORTEX_API_KEY="nouvelle_clé" pm2 start server.js --name kortex-scrape
pm2 save
```

### 6. Ouvrir le port sur le pare-feu

```bash
sudo ufw allow 4433/tcp
```

(Remplace `4433` si tu changes le port par défaut via la variable
d'environnement `PORT`.)

### 7. Configurer l'app Kortex

Dans `main.js` :
- `SCRAPE_SERVER_URL` doit déjà pointer vers `https://82.41.119.103:4433`
  (adapte le port si tu l'as changé).
- Remplace `SCRAPE_SERVER_CERT_FINGERPRINT` par l'empreinte obtenue à
  l'étape 3.
- Remplace `SCRAPE_SERVER_API_KEY` par la clé générée à l'étape 4 (la
  même exactement que celle passée en `KORTEX_API_KEY` côté serveur).

## Réglages de charge

Deux variables d'environnement optionnelles pour ajuster selon les
capacités réelles de ton VPS :

- `MAX_RESOLUTIONS_SIMULTANEES` (défaut 3) — nombre de navigateurs Chrome
  autorisés à tourner en même temps.
- `MAX_FILE_ATTENTE` (défaut 10) — nombre de requêtes en attente
  au-delà duquel le serveur répond directement "surchargé" plutôt que de
  laisser la file grossir indéfiniment.

```bash
KORTEX_API_KEY="..." MAX_RESOLUTIONS_SIMULTANEES=5 pm2 start server.js --name kortex-scrape
```

## Vérifier que ça tourne

```bash
curl -k https://localhost:4433/health
# {"status":"ok"}

pm2 logs kortex-scrape
```

## Données stockées

Rien de sensible côté disque à part le certificat et sa clé privée dans
`data/` (déjà dans `.gitignore` du dépôt principal). Le serveur ne
persiste aucune donnée utilisateur — tout est en mémoire (cache des
infos de jeu, limites de débit) et repart de zéro à chaque redémarrage.

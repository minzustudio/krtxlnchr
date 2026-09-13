const { app, BrowserWindow, ipcMain, globalShortcut,shell,clipboard, Notification, Tray, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Client: DiscordRPCClient } = require('@xhayper/discord-rpc');
const axios = require('axios');
const https = require('https');
const tls = require('tls');

process.on('unhandledRejection', (error) => {
    console.error('⚠️ Promesse non gérée (évite un crash) :', error);
});

// URL publique du relais Cloudflare Worker (voir support-relay/README.md).
// Pas un secret : le vrai webhook Discord ne vit que côté relais.
const SUPPORT_RELAY_URL = 'https://kortex-support-relay.kortex.workers.dev';

// Serveur de scraping perso (VPS, voir scrape-server/README.md). Les infos
// d'un jeu et la résolution des liens de téléchargement se font là-bas ;
// le catalogue (liste des jeux), lui, est récupéré ici même via test2.js.
// La clé API et l'empreinte du certificat vivent dans secrets.local.js
// (jamais suivi par git, voir secrets.example.js) — ne JAMAIS les remettre
// en dur ici, ce fichier est suivi par git et potentiellement auto-poussé.
const SCRAPE_SERVER_URL = 'https://82.41.119.103:4433';
let secretsLocaux;
try {
    secretsLocaux = require('./secrets.local.js');
} catch (e) {
    console.error("⚠️ Fichier 'secrets.local.js' introuvable. Copie 'secrets.example.js' vers 'secrets.local.js' et renseigne tes vraies valeurs (voir scrape-server/README.md).");
    secretsLocaux = { SCRAPE_SERVER_CERT_FINGERPRINT: '', SCRAPE_SERVER_API_KEY: '' };
}
const { SCRAPE_SERVER_CERT_FINGERPRINT, SCRAPE_SERVER_API_KEY } = secretsLocaux;

// Agent HTTPS avec "certificate pinning" : le certificat auto-signé du VPS
// n'est jamais validé par une autorité (impossible sans domaine + accès
// port 80/443 sur une IP nue), donc on vérifie nous-mêmes son empreinte
// exacte à chaque connexion pour empêcher toute interception.
class AgentScrapePinne extends https.Agent {
    createConnection(options, callback) {
        const socket = tls.connect({ ...options, rejectUnauthorized: false }, callback);
        socket.once('secureConnect', () => {
            const certificat = socket.getPeerCertificate();
            const empreinteValide = certificat && certificat.fingerprint256 === SCRAPE_SERVER_CERT_FINGERPRINT;
            if (!empreinteValide) {
                socket.destroy(new Error('Empreinte du certificat du serveur de scraping invalide (connexion refusée par sécurité).'));
            }
        });
        return socket;
    }
}

const agentScrapePinne = new AgentScrapePinne();

async function appelScrapeAPI(methode, route, donnees, timeoutMs = 20000) {
    return axios({
        method: methode,
        url: `${SCRAPE_SERVER_URL}${route}`,
        data: donnees,
        httpsAgent: agentScrapePinne,
        timeout: timeoutMs,
        validateStatus: () => true,
        headers: {
            'X-Kortex-Key': SCRAPE_SERVER_API_KEY,
            'Content-Type': 'application/json'
        }
    });
}

const dossierAppData = app.getPath('userData');
const dossierDestination = path.join(dossierAppData, 'games');
const dataPath = path.join(dossierAppData, 'data.json');
const { startScraping } = require('./scraper');
const { fetchSteamRipCatalogue } = require('./test2');
const { translate } = require('./i18n');

function t(key, params) {
    return translate(chargerSettings().language || 'en', key, params);
}

const telechargementsActifs = {};
const jeuxEnCours = {};

const settingsPath = path.join(dossierAppData, 'settings.json');

const settingsParDefaut = {
    sortByName: false,
    launchAtStartup: false,
    notifyOnDownloadComplete: true,
    minimizeToTray: false,
    autoOpenFolderAfterInstall: false,
    updateCatalogueAtStartup: true,
    language: null,
    defaultLibraryView: 'grid',
    accentColor: 'terracotta',
    discordRichPresence: {
        enabled: true,
        clientId: '1546292667221020672',
        buttonLabel: 'Get Kortex',
        buttonUrl: 'https://www.google.com'
    }
};

let isQuittingApp = false;
let tray = null;

function chargerSettings() {
    if (!fs.existsSync(settingsPath)) {
        return JSON.parse(JSON.stringify(settingsParDefaut));
    }
    try {
        const disque = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        return {
            ...settingsParDefaut,
            ...disque,
            discordRichPresence: { ...settingsParDefaut.discordRichPresence, ...(disque.discordRichPresence || {}) }
        };
    } catch (error) {
        console.error('Erreur de lecture de settings.json :', error.message);
        return JSON.parse(JSON.stringify(settingsParDefaut));
    }
}

function sauvegarderSettingsSurDisque(settings) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4));
}

let discordRPC = null;
let discordActivityStartTime = Date.now();
let jeuActifDiscord = null;
let imageJeuActifDiscord = null;

function joliNomJeu(nomJeu) {
    return String(nomJeu || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (lettre) => lettre.toUpperCase());
}

function calculerStatsDiscord() {
    let nbJeuxTelecharges = 0;
    let tempsTotalSecondes = 0;

    try {
        if (fs.existsSync(dossierDestination)) {
            nbJeuxTelecharges = fs.readdirSync(dossierDestination)
                .filter((nom) => !nom.endsWith('.rar') && !nom.includes('.part'))
                .length;
        }
    } catch (error) {
        console.error('Erreur calcul stats Discord (dossiers) :', error.message);
    }

    try {
        if (fs.existsSync(dataPath)) {
            const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
            tempsTotalSecondes = Object.values(data).reduce((total, jeu) => total + (jeu.tempsDeJeu || 0), 0);
        }
    } catch (error) {
        console.error('Erreur calcul stats Discord (temps de jeu) :', error.message);
    }

    return { nbJeuxTelecharges, tempsTotalSecondes };
}

function formaterDureeDiscord(secondes) {
    const heures = Math.floor(secondes / 3600);
    const minutes = Math.floor((secondes % 3600) / 60);
    if (heures > 0) return t('discord.playedHours', { h: heures, m: minutes });
    return t('discord.playedMinutes', { m: minutes });
}

async function mettreAJourActiviteDiscord() {
    if (!discordRPC || !discordRPC.isConnected) return;

    const settings = chargerSettings();
    const rpcSettings = settings.discordRichPresence;
    if (!rpcSettings.enabled) return;

    const { nbJeuxTelecharges, tempsTotalSecondes } = calculerStatsDiscord();
    const motJeu = t(nbJeuxTelecharges > 1 ? 'discord.games' : 'discord.game');
    const motTelecharge = t(nbJeuxTelecharges > 1 ? 'discord.downloadedPlural' : 'discord.downloadedSingular');
    const description = `${nbJeuxTelecharges} ${motJeu} ${motTelecharge} • ${formaterDureeDiscord(tempsTotalSecondes)}`;

    const activite = {
        details: jeuActifDiscord ? t('discord.playing', { game: jeuActifDiscord }) : t('discord.browsing'),
        state: description,
        largeImageKey: 'kortex_logo',
        largeImageText: jeuActifDiscord || 'Kortex Launcher',
        startTimestamp: discordActivityStartTime
    };

    if (rpcSettings.buttonLabel && rpcSettings.buttonUrl) {
        activite.buttons = [{ label: rpcSettings.buttonLabel, url: rpcSettings.buttonUrl }];
    }

    try {
        await discordRPC.user.setActivity(activite);
    } catch (error) {
        console.error('Erreur mise à jour Discord RPC :', error.message);
    }
}

async function arreterDiscordRPC() {
    if (!discordRPC) return;
    try {
        await discordRPC.user.clearActivity();
        await discordRPC.destroy();
    } catch (error) {
    }
    discordRPC = null;
}

async function demarrerDiscordRPC() {
    const settings = chargerSettings();
    const rpcSettings = settings.discordRichPresence;

    if (!rpcSettings.enabled || !rpcSettings.clientId) {
        await arreterDiscordRPC();
        return;
    }

    await arreterDiscordRPC();

    discordRPC = new DiscordRPCClient({ clientId: rpcSettings.clientId });

    discordRPC.on('ready', () => {
        console.log('✅ Discord RPC connecté.');
        discordActivityStartTime = Date.now();
        mettreAJourActiviteDiscord();
    });

    discordRPC.on('disconnected', () => {
        console.log('⚠️ Discord RPC déconnecté (Discord fermé ?). Nouvelle tentative périodique en cours...');
        discordRPC = null;
    });

    try {
        await discordRPC.login();
    } catch (error) {
        console.error('Impossible de se connecter à Discord (client Discord lancé ?) :', error.message);
        discordRPC = null;
    }
}

setInterval(() => {
    const settings = chargerSettings();
    const rpcSettings = settings.discordRichPresence;
    if (rpcSettings.enabled && rpcSettings.clientId && (!discordRPC || !discordRPC.isConnected)) {
        demarrerDiscordRPC();
    }
}, 15000);

function demarrerActiviteJeuDiscord(nomJeu, imageJeu) {
    jeuActifDiscord = joliNomJeu(nomJeu);
    imageJeuActifDiscord = imageJeu || null;
    discordActivityStartTime = Date.now();
    mettreAJourActiviteDiscord();
}

function arreterActiviteJeuDiscord() {
    jeuActifDiscord = null;
    imageJeuActifDiscord = null;
    discordActivityStartTime = Date.now();
    mettreAJourActiviteDiscord();
}

function creerTrayIcon() {
    if (tray) return;

    tray = new Tray(path.join(__dirname, 'sources/kortexAccentLogo.png'));
    tray.setToolTip('Kortex Launcher');

    const menu = Menu.buildFromTemplate([
        {
            label: 'Ouvrir Kortex', click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quitter', click: () => {
                isQuittingApp = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(menu);
    tray.on('click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

function detruireTrayIcon() {
    if (!tray) return;
    tray.destroy();
    tray = null;
}

async function calculerTailleDossierAsync(cheminDossier) {
    let taille = 0;
    let entries;

    try {
        entries = await fs.promises.readdir(cheminDossier, { withFileTypes: true });
    } catch (error) {
        return 0;
    }

    for (const entry of entries) {
        const chemin = path.join(cheminDossier, entry.name);
        if (entry.isDirectory()) {
            taille += await calculerTailleDossierAsync(chemin);
        } else {
            try {
                const stats = await fs.promises.stat(chemin);
                taille += stats.size;
            } catch (error) {
            }
        }
    }

    return taille;
}

function formaterOctets(octets) {
    if (octets >= 1024 ** 3) return `${(octets / 1024 ** 3).toFixed(1)} Go`;
    if (octets >= 1024 ** 2) return `${(octets / 1024 ** 2).toFixed(0)} Mo`;
    if (octets >= 1024) return `${(octets / 1024).toFixed(0)} Ko`;
    return `${octets} o`;
}

ipcMain.handle('get-storage-stats', async () => {
    let nbJeux = 0;
    try {
        if (fs.existsSync(dossierDestination)) {
            nbJeux = fs.readdirSync(dossierDestination)
                .filter((nom) => !nom.endsWith('.rar') && !nom.includes('.part'))
                .length;
        }
    } catch (error) {
        console.error('Erreur comptage des jeux installés :', error.message);
    }

    const jeuxOctets = await calculerTailleDossierAsync(dossierDestination);

    let diskTotalOctets = 0;
    let diskFreeOctets = 0;
    try {
        const stats = fs.statfsSync(dossierAppData);
        diskTotalOctets = stats.blocks * stats.bsize;
        diskFreeOctets = stats.bavail * stats.bsize;
    } catch (error) {
        console.error('Erreur lecture des stats disque :', error.message);
    }

    const diskUsedOctets = Math.max(0, diskTotalOctets - diskFreeOctets);
    const autreOctets = Math.max(0, diskUsedOctets - jeuxOctets);

    const pourcentage = (valeur) => diskTotalOctets > 0 ? (valeur / diskTotalOctets) * 100 : 0;

    return {
        nbJeux,
        jeuxOctets,
        jeuxFormatte: formaterOctets(jeuxOctets),
        autreOctets,
        autreFormatte: formaterOctets(autreOctets),
        libreOctets: diskFreeOctets,
        libreFormatte: formaterOctets(diskFreeOctets),
        diskTotalOctets,
        diskTotalFormatte: formaterOctets(diskTotalOctets),
        jeuxPourcent: pourcentage(jeuxOctets),
        autrePourcent: pourcentage(autreOctets),
        librePourcent: pourcentage(diskFreeOctets)
    };
});

ipcMain.handle('get-app-info', () => ({
    version: app.getVersion()
}));

ipcMain.handle('check-for-updates-manual', () => {
    return new Promise((resolve) => {
        let repondu = false;

        const nettoyer = () => {
            autoUpdater.removeListener('update-available', surDisponible);
            autoUpdater.removeListener('update-not-available', surAbsent);
            autoUpdater.removeListener('error', surErreur);
        };

        const repondreUneFois = (reponse) => {
            if (repondu) return;
            repondu = true;
            nettoyer();
            resolve(reponse);
        };

        const surDisponible = () => repondreUneFois({ status: 'update-available' });
        const surAbsent = () => repondreUneFois({ status: 'up-to-date' });
        const surErreur = (error) => repondreUneFois({ status: 'error', message: error.message });

        autoUpdater.once('update-available', surDisponible);
        autoUpdater.once('update-not-available', surAbsent);
        autoUpdater.once('error', surErreur);

        autoUpdater.checkForUpdates().catch(surErreur);

        setTimeout(() => repondreUneFois({ status: 'error', message: 'Délai dépassé' }), 15000);
    });
});

ipcMain.handle('reset-settings', async () => {
    const settings = JSON.parse(JSON.stringify(settingsParDefaut));
    sauvegarderSettingsSurDisque(settings);

    try {
        app.setLoginItemSettings({ openAtLogin: false });
    } catch (error) {
        console.error('Erreur setLoginItemSettings (reset) :', error.message);
    }

    detruireTrayIcon();
    await arreterDiscordRPC();

    return settings;
});

ipcMain.handle('charger-settings', () => chargerSettings());

ipcMain.handle('envoyer-support', async (event, donnees = {}) => {
    const { title, description, category } = donnees;

    if (!title || !description) {
        return { status: 'error', message: 'Champs manquants.' };
    }

    try {
        const reponse = await axios.post(SUPPORT_RELAY_URL, {
            title: String(title).slice(0, 100),
            description: String(description).slice(0, 1500),
            category: String(category || 'other').slice(0, 40),
            appVersion: app.getVersion()
        }, {
            timeout: 10000,
            validateStatus: () => true
        });

        if (reponse.status === 200) return { status: 'success' };
        if (reponse.status === 429) return { status: 'rate_limited' };

        return { status: 'error', message: `Le relais a répondu avec le code ${reponse.status}.` };
    } catch (error) {
        console.error('Erreur envoi support :', error.message);
        return { status: 'error', message: error.message };
    }
});

ipcMain.handle('exporter-bibliotheque', async () => {
    try {
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Exporter la bibliothèque Kortex',
            defaultPath: 'kortex-sauvegarde.json',
            filters: [{ name: 'Sauvegarde Kortex', extensions: ['json'] }]
        });
        if (canceled || !filePath) return { status: 'cancelled' };

        const tempsDeJeu = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, 'utf-8')) : {};

        const sauvegarde = {
            type: 'kortex-backup',
            version: app.getVersion(),
            date: new Date().toISOString(),
            settings: chargerSettings(),
            tempsDeJeu
        };

        fs.writeFileSync(filePath, JSON.stringify(sauvegarde, null, 4), 'utf-8');
        return { status: 'success', path: filePath };
    } catch (error) {
        console.error('Erreur export bibliothèque :', error.message);
        return { status: 'error', message: error.message };
    }
});

ipcMain.handle('importer-bibliotheque', async () => {
    try {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Importer une sauvegarde Kortex',
            filters: [{ name: 'Sauvegarde Kortex', extensions: ['json'] }],
            properties: ['openFile']
        });
        if (canceled || !filePaths.length) return { status: 'cancelled' };

        const contenu = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
        if (!contenu || contenu.type !== 'kortex-backup') {
            return { status: 'error', message: 'invalidFile' };
        }

        if (contenu.settings) {
            sauvegarderSettingsSurDisque({
                ...settingsParDefaut,
                ...contenu.settings,
                discordRichPresence: { ...settingsParDefaut.discordRichPresence, ...(contenu.settings.discordRichPresence || {}) }
            });
        }
        if (contenu.tempsDeJeu) {
            fs.writeFileSync(dataPath, JSON.stringify(contenu.tempsDeJeu, null, 4), 'utf-8');
        }

        return { status: 'success' };
    } catch (error) {
        console.error('Erreur import bibliothèque :', error.message);
        return { status: 'error', message: error.message };
    }
});

ipcMain.handle('sauvegarder-settings', async (event, nouveauxSettings) => {
    const settings = {
        ...settingsParDefaut,
        ...nouveauxSettings,
        discordRichPresence: { ...settingsParDefaut.discordRichPresence, ...(nouveauxSettings.discordRichPresence || {}) }
    };

    sauvegarderSettingsSurDisque(settings);

    try {
        app.setLoginItemSettings({ openAtLogin: !!settings.launchAtStartup });
    } catch (error) {
        console.error('Erreur setLoginItemSettings :', error.message);
    }

    if (settings.minimizeToTray) {
        creerTrayIcon();
    } else {
        detruireTrayIcon();
    }

    if (settings.discordRichPresence.enabled) {
        await demarrerDiscordRPC();
    } else {
        await arreterDiscordRPC();
    }

    return { status: 'success' };
});

require('./scraper.js');

let mainWindow = null;
let splashWindow = null;

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1266,
    height: 735,
    minHeight: 561,
    minWidth: 866,
    icon: path.join(__dirname, 'sources/kortexAccentLogo.ico'),
    frame: false,
    autoHideMenuBar: true,
    transparent: false,
    roundedCorners: true,
    backgroundColor: '#00000000',
    thickFrame: true,
    show: false,

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools();
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximized-state', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-maximized-state', false);
  });

  mainWindow.on('close', (event) => {
    const settings = chargerSettings();
    if (settings.minimizeToTray && !isQuittingApp) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    return;
  }

  splashWindow = new BrowserWindow({
        width: 473,
        height: 149,
    resizable: false,
    movable: true,
    frame: false,
    transparent: true,
    show: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  splashWindow.focus();
  splashWindow.loadFile(path.join(__dirname, 'update.html'));

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function openMainLauncher() {
    createMainWindow();

  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
}

let languageWindow = null;

function creerFenetreLangue(onChoisi) {
  languageWindow = new BrowserWindow({
    width: 420,
    height: 220,
    resizable: false,
    movable: true,
    frame: false,
    transparent: true,
    show: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  languageWindow.loadFile(path.join(__dirname, 'language.html'));

  ipcMain.once('choisir-langue', (event, langue) => {
    const settingsActuels = chargerSettings();
    sauvegarderSettingsSurDisque({ ...settingsActuels, language: langue === 'fr' ? 'fr' : 'en' });

    if (languageWindow && !languageWindow.isDestroyed()) {
      languageWindow.close();
    }
    languageWindow = null;

    onChoisi();
  });

  languageWindow.on('closed', () => {
    languageWindow = null;
  });
}

app.whenReady().then(() => {
  const demarrerApresLangue = () => {
    createSplashWindow();
    startStartupUpdateCheck();

    const settingsInitiaux = chargerSettings();
    try {
      app.setLoginItemSettings({ openAtLogin: !!settingsInitiaux.launchAtStartup });
    } catch (error) {
      console.error('Erreur setLoginItemSettings au démarrage :', error.message);
    }
    if (settingsInitiaux.minimizeToTray) {
      creerTrayIcon();
    }
    demarrerDiscordRPC();
  };

  if (!chargerSettings().language) {
    creerFenetreLangue(demarrerApresLangue);
  } else {
    demarrerApresLangue();
  }

  ipcMain.on('lancer-scraping', async () => {
    console.log("📥 [Main] Demande de scraping reçue...");

    try {
        const resultat = await startScraping(
            (gameObj) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('nouveau-jeu', gameObj);
                }
            },
            (pourcentage) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('progression-scraping', pourcentage);
                }
            }
        );

        if (resultat && resultat.success) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('scraping-termine');
            }
        }

    } catch (error) {
        console.error("❌ [Main] Erreur capturée durant le scraping :", error);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow();
      startStartupUpdateCheck();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  isQuittingApp = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});



const unrar = require('node-unrar-js');

ipcMain.handle('canal-securise', async (event, urlRecue, nomJeu) => {
    const nomSecurise = nomJeu ? nomJeu.toLowerCase().replace(/[^a-zA-Z0-9]/g, "_") : "jeu_telecharge";
    const nomFichierFinal = `${nomSecurise}.rar`;
    let nbChunks = 5;

    if (!fs.existsSync(dossierDestination)) {
        fs.mkdirSync(dossierDestination, { recursive: true });
    }

    console.log(`\n[ÉTAPE 1] Résolution du lien de téléchargement via le serveur...`);

    try {
        const { gotScraping } = await import('got-scraping');

        const baseHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': 'https://steamrip.com/',
        };

        const reponseResolution = await appelScrapeAPI('post', '/resolve-download', { url: urlRecue }, 150000);

        if (reponseResolution.status !== 200 || reponseResolution.data?.status !== 'success') {
            const message = reponseResolution.data?.message || `Le serveur a répondu avec le code ${reponseResolution.status}.`;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('no-server-found', { nomJeu });
            }
            return { status: 'error', message };
        }

        console.log(`\n[ÉTAPE 2] Sélection du serveur prioritaire...`);

        async function validerLien(link, cookies = "") {
            try {
                const reqHeaders = { ...baseHeaders };
                if (cookies) reqHeaders['Cookie'] = cookies;

                const pingRes = await gotScraping({
                    url: link,
                    method: 'HEAD',
                    headers: reqHeaders,
                    timeout: { request: 5000 },
                    throwHttpErrors: false,
                    retry: { limit: 1 }
                });
                return pingRes.statusCode === 200 || pingRes.statusCode === 206 || pingRes.statusCode === 302;
            } catch (e) { return false; }
        }

        const candidatsServeurs = reponseResolution.data.candidates.map((candidat) => ({
            nom: candidat.hostName,
            link: candidat.link,
            cookies: candidat.cookies || '',
            chunks: candidat.chunks || 5
        }));

        if (candidatsServeurs.length === 0) {
            return { status: 'error', message: "Aucun lien de téléchargement n'a pu être récupéré sur les hébergeurs disponibles." };
        }

        let derniereErreurServeur = null;

        for (const candidat of candidatsServeurs) {
            console.log(`[INFO] Test du serveur ${candidat.nom}...`);

            const enLigne = await validerLien(candidat.link, candidat.cookies);
            if (!enLigne) {
                console.log(`⚠️ Serveur ${candidat.nom} injoignable (erreur/timeout), passage au serveur suivant.`);
                derniereErreurServeur = new Error(`Le serveur ${candidat.nom} est injoignable.`);
                continue;
            }

            console.log(`✅ Serveur ${candidat.nom} en ligne, tentative de téléchargement...`);

            const lienChoisi = candidat.link;
            const cookiesHebergeur = candidat.cookies;
            nbChunks = candidat.chunks;

            if (cookiesHebergeur) {
                baseHeaders['Cookie'] = cookiesHebergeur;
            }

            const cheminComplet = path.join(dossierDestination, nomFichierFinal);
            let downloadController;
            let progressInterval;

            try {
                downloadController = new AbortController();

                console.log(`\n[ÉTAPE 4] Lancement du téléchargement sur : ${lienChoisi}`);

                let totalOctets = 0;
                let supporteChunks = false;

                try {
                    const pingRes = await gotScraping({
                        url: lienChoisi,
                        method: 'HEAD',
                        headers: baseHeaders,
                        http2: false,
                        throwHttpErrors: false,
                        timeout: { request: 10000 }
                    });

                    totalOctets = parseInt(pingRes.headers['content-length'] || 0, 10);

                    if (pingRes.statusCode === 200 && /bytes/i.test(pingRes.headers['accept-ranges'] || '')) {
                        supporteChunks = true;
                        console.log(`[INFO] Multi-connexion supporté ! Taille : ${(totalOctets / (1024 * 1024)).toFixed(2)} Mo`);
                    } else {
                        console.log(`[INFO] Multi-connexion refusé. Passage en mode classique.`);
                    }
                } catch (error) {
                    throw new Error(`Erreur de connexion au fichier final: ${error.message}`);
                }

                let telecharges = 0;
                let derniersOctets = 0;
                event.sender.send('debut-download', "start");

                progressInterval = setInterval(() => {
                    const octetsDepuisDerniereFois = telecharges - derniersOctets;
                    derniersOctets = telecharges;

                    const vitesseMoS = (octetsDepuisDerniereFois / (1024 * 1024)).toFixed(2);

                    const progress = {
                        pourcentage: totalOctets > 0 ? ((telecharges / totalOctets) * 80).toFixed(1) + "%" : t('progress.calculating'),
                        actuel: (telecharges / (1024 * 1024)).toFixed(2) + " MB",
                        total: totalOctets > 0 ? (totalOctets / (1024 * 1024)).toFixed(2) + " MB" : t('progress.unknown'),
                        name: nomSecurise,
                        vitesse: `${vitesseMoS} MB/s`,
                    };
                    event.sender.send('update-download-progress', progress);
                }, 1000);

                telechargementsActifs[nomSecurise] = {
                    controller: downloadController,
                    cheminFichier: cheminComplet,
                    activeStreams: [],
                    progressInterval
                };

                if (supporteChunks) {
                    const chunkSize = Math.floor(totalOctets / nbChunks);
                    const promises = [];
                    const partFiles = [];

                    for (let i = 0; i < nbChunks; i++) {
                        const start = i * chunkSize;
                        const end = i === nbChunks - 1 ? totalOctets - 1 : (start + chunkSize - 1);
                        const partPath = `${cheminComplet}.part${i}`;
                        partFiles.push(partPath);

                        promises.push((async () => {
                            let maxRetries = 5;
                            let octetsDuChunkTelecharges = 0;

                            for (let tentative = 1; tentative <= maxRetries; tentative++) {
                                if (downloadController.signal.aborted) break;

                                try {
                                    const rangeStart = start + octetsDuChunkTelecharges;
                                    if (rangeStart > end) break;

                                    await new Promise((resolve, reject) => {
                                        if (downloadController.signal.aborted) return reject(new Error('Aborted'));

                                        const stream = gotScraping.stream({
                                            url: lienChoisi,
                                            headers: { ...baseHeaders, 'Range': `bytes=${rangeStart}-${end}` },
                                            signal: downloadController.signal,
                                            http2: false,
                                            timeout: {
                                                response: 15000,
                                                request: 2147483647
                                             },
                                            retry: { limit: 0 }
                                        });

                                        const writeStream = fs.createWriteStream(partPath, {
                                            flags: octetsDuChunkTelecharges > 0 ? 'a' : 'w',
                                            highWaterMark: 4 * 1024 * 1024
                                        });

                                        telechargementsActifs[nomSecurise].activeStreams.push({ stream, writeStream });

                                        stream.on('data', (chunk) => {
                                            telecharges += chunk.length;
                                            octetsDuChunkTelecharges += chunk.length;
                                        });

                                        stream.pipe(writeStream);

                                        stream.on('end', resolve);
                                        stream.on('error', (err) => { writeStream.end(); reject(err); });
                                        writeStream.on('error', (err) => { reject(err); });
                                    });

                                    break;

                                } catch (err) {
                                    if (downloadController.signal.aborted) {
                                        console.log(`[INFO] Chunk ${i} arrêté proprement suite à l'annulation de l'utilisateur.`);
                                        break;
                                    }

                                    console.warn(`[⚠️ ATTENTION] Chunk ${i} déconnecté (Tentative ${tentative}/${maxRetries}) : ${err.message}. Reprise en cours...`);

                                    if (tentative === maxRetries) {
                                        downloadController.abort();
                                        throw new Error(`Le Chunk ${i} a définitivement planté après ${maxRetries} essais.`);
                                    }

                                    await new Promise(res => setTimeout(res, 2000));
                                }
                            }
                        })());
                    }

                    await Promise.all(promises);
                    clearInterval(progressInterval);

                    console.log(`[INFO] Morceaux téléchargés. Fusion ultra-rapide en cours...`);

                    event.sender.send('update-download-progress', {
                        vitesse: "0 MB/s",
                        pourcentage: "90%",
                        actuel: t('progress.disk'),
                        total: t('progress.pleaseWait'),
                        name: nomSecurise
                    });

                    const finalStream = fs.createWriteStream(cheminComplet, { highWaterMark: 8 * 1024 * 1024 });

                    for (const partPath of partFiles) {
                        await new Promise((resolve, reject) => {
                            const readPart = fs.createReadStream(partPath, { highWaterMark: 4 * 1024 * 1024 });
                            readPart.pipe(finalStream, { end: false });
                            readPart.on('end', resolve);
                            readPart.on('error', reject);
                        });
                    }

                    await new Promise((resolve, reject) => {
                        finalStream.on('finish', resolve);
                        finalStream.on('error', reject);
                        finalStream.end();
                    });

                    for (const partPath of partFiles) {
                        if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
                    }

                } else {
                    console.log("[INFO] Lancement du mode classique sécurisé...");
                    const writeStream = fs.createWriteStream(cheminComplet, { highWaterMark: 1024 * 1024 });

                    const stream = gotScraping.stream({
                        url: lienChoisi,
                        headers: baseHeaders,
                        signal: downloadController.signal,
                        http2: false,
                        timeout: { request: undefined },
                        retry: {
                            limit: 5,
                            methods: ['GET'],
                            statusCodes: [408, 413, 429, 500, 502, 503, 504],
                            errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'EADDRINUSE', 'ECONNREFUSED', 'EPIPE']
                        }
                    });

                    telechargementsActifs[nomSecurise] = { stream, writeStream, controller: downloadController, cheminFichier: cheminComplet, progressInterval };

                    await new Promise((resolve, reject) => {
                        let reponseInvalide = false;
                        let corpsErreur = Buffer.alloc(0);

                        stream.on('response', (response) => {
                            const contentType = response.headers['content-type'] || '';
                            console.log(`[DEBUG] Réponse du serveur de téléchargement : ${response.statusCode} | content-length: ${response.headers['content-length'] || 'absent'} | content-type: ${contentType || 'absent'}`);

                            if (response.statusCode < 200 || response.statusCode >= 300 || /text\/html|application\/json/i.test(contentType)) {
                                reponseInvalide = true;
                            }
                        });

                        stream.on('data', (chunk) => {
                            if (reponseInvalide) {
                                if (corpsErreur.length < 2000) corpsErreur = Buffer.concat([corpsErreur, chunk]);
                                if (corpsErreur.length >= 2000) stream.destroy();
                                return;
                            }
                            telecharges += chunk.length;
                            const readyForMore = writeStream.write(chunk);
                            if (!readyForMore) stream.pause();
                        });

                        writeStream.on('drain', () => { stream.resume(); });
                        stream.on('end', () => { writeStream.end(); });
                        stream.on('close', () => {
                            if (reponseInvalide) {
                                console.error(`[DEBUG] Contenu renvoyé par le serveur au lieu du fichier :\n${corpsErreur.toString('utf-8').slice(0, 2000)}`);
                                writeStream.end();
                                reject(new Error('Le serveur a renvoyé une page invalide au lieu du fichier.'));
                            }
                        });
                        writeStream.on('finish', () => {
                            if (!reponseInvalide) resolve();
                        });
                        stream.on('error', (err) => { writeStream.end(); reject(err); });
                        writeStream.on('error', (err) => { reject(err); });
                    });

                    clearInterval(progressInterval);
                }

                delete telechargementsActifs[nomSecurise];
                console.log(`[SUCCÈS] Téléchargement de ${nomSecurise} terminé !`);

                const tailleFichierFinal = fs.existsSync(cheminComplet) ? fs.statSync(cheminComplet).size : 0;
                const tailleMinimumAcceptable = totalOctets > 0 ? totalOctets * 0.98 : 1024 * 1024;
                if (tailleFichierFinal < tailleMinimumAcceptable) {
                    throw new Error(`Téléchargement incomplet ou invalide (${(tailleFichierFinal / (1024 * 1024)).toFixed(1)} Mo reçus${totalOctets > 0 ? ` sur ${(totalOctets / (1024 * 1024)).toFixed(1)} Mo attendus` : ''}).`);
                }

                console.log(`\n[ÉTAPE 5] Début de l'extraction de : ${nomFichierFinal}`);

                const dossierExtraction = path.join(dossierDestination, nomSecurise);
                if (!fs.existsSync(dossierExtraction)) fs.mkdirSync(dossierExtraction, { recursive: true });

                const extractor = await unrar.createExtractorFromFile({
                    filepath: cheminComplet,
                    targetPath: dossierExtraction
                });

                const infoArc = extractor.getFileList();
                const fileHeaders = [...infoArc.fileHeaders];
                const totalFichiers = fileHeaders.length;

                console.log(`📦 Nombre de fichiers à extraire : ${totalFichiers}`);

                const extractedFiles = extractor.extract({
                    files: (fileHeader) => true
                });

                let fichiersTraites = 0;

                for (const file of extractedFiles.files) {
                    fichiersTraites++;

                    const progressionExtraction = 90 + Math.floor((fichiersTraites / totalFichiers) * 9);

                    event.sender.send('update-download-progress', {
                        vitesse: t('progress.extracting'),
                        pourcentage: `${progressionExtraction}%`,
                        actuel: `${fichiersTraites}/${totalFichiers} ${t('progress.files')}`,
                        total: t('progress.extraction'),
                        name: nomSecurise
                    });

                    if (fichiersTraites % 10 === 0) {
                        await new Promise(resolve => setImmediate(resolve));
                    }
                }

                console.log(`📦 Extraction terminée avec succès dans : ${dossierExtraction}`);

                const fichiersExtraits = fs.readdirSync(dossierExtraction);
                if (fichiersExtraits.length === 0) {
                    throw new Error("L'extraction semble avoir échoué : aucun fichier trouvé.");
                }

                if (fs.existsSync(cheminComplet)) {
                    fs.unlinkSync(cheminComplet);
                    console.log(`🗑️ Archive temporaire nettoyée.`);
                }

                const progressFinal = {
                    pourcentage: "100%",
                    actuel: t('progress.done'),
                    total: t('progress.installed'),
                    name: nomSecurise,
                };
                event.sender.send('update-download-progress', progressFinal);
                event.sender.send('debut-download', "start");

                const settingsActuels = chargerSettings();
                if (settingsActuels.notifyOnDownloadComplete && Notification.isSupported()) {
                    new Notification({
                        title: t('discord.notifyTitle'),
                        body: t('discord.notifyBody', { game: nomJeu }),
                        icon: path.join(__dirname, 'sources/kortexAccentLogo.png')
                    }).show();
                }
                if (settingsActuels.autoOpenFolderAfterInstall) {
                    shell.openPath(dossierExtraction);
                }
                mettreAJourActiviteDiscord();

                console.log("✅ Installation terminée !");
                return { status: 'success', path: dossierExtraction };

            } catch (erreurServeur) {
                console.error(`[ERREUR] Échec du téléchargement via ${candidat.nom} :`, erreurServeur.message);
                derniereErreurServeur = erreurServeur;

                if (progressInterval) clearInterval(progressInterval);
                delete telechargementsActifs[nomSecurise];

                try {
                    const residus = fs.readdirSync(dossierDestination).filter((f) =>
                        f.startsWith(nomSecurise) && (f.endsWith('.rar') || f.includes('.part'))
                    );
                    residus.forEach((f) => {
                        try { fs.unlinkSync(path.join(dossierDestination, f)); } catch (e) {}
                    });
                } catch (e) {}

                continue;
            }
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('no-server-found', { nomJeu: nomJeu });
        }
        return {
            status: 'error',
            message: derniereErreurServeur ? derniereErreurServeur.message : "Aucun serveur disponible n'a permis de terminer le téléchargement."
        };

    } catch (err) {
        console.error("Erreur globale :", err.message);
        return { status: 'error', message: err.message };
    }
});

function extraireNomCoeurJeu(chaine) {
    let coeur = String(chaine || '')
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s+Free Download\b.*$/i, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_');

    coeur = coeur
        .replace(/_free_download.*$/i, '')
        .replace(/(_v\d+(_\d+){0,4})+$/i, '')
        .replace(/_multiplayer$/i, '')
        .replace(/_repack$/i, '')
        .replace(/_+$/, '');

    return coeur;
}

function trouverDossierJeuInstalle(nomJeu) {
    const nomSecurise = nomJeu ? nomJeu.toLowerCase().replace(/[^a-zA-Z0-9]/g, "_") : "jeu_telecharge";
    const cheminExact = path.join(dossierDestination, nomSecurise);
    if (fs.existsSync(cheminExact)) return cheminExact;

    if (!fs.existsSync(dossierDestination)) return null;

    const coeurCible = extraireNomCoeurJeu(nomJeu);
    if (!coeurCible) return null;

    const dossiers = fs.readdirSync(dossierDestination).filter((f) => {
        try { return fs.statSync(path.join(dossierDestination, f)).isDirectory(); } catch (e) { return false; }
    });

    const trouve = dossiers.find((d) => extraireNomCoeurJeu(d) === coeurCible);
    return trouve ? path.join(dossierDestination, trouve) : null;
}

ipcMain.handle('lister-dossiers-jeux', () => {
    if (!fs.existsSync(dossierDestination)) return [];

    return fs.readdirSync(dossierDestination).filter((nom) => {
        const cheminComplet = path.join(dossierDestination, nom);
        let stats;
        try {
            stats = fs.statSync(cheminComplet);
        } catch (error) {
            return false;
        }

        if (!stats.isDirectory()) return true; // .rar / .part : jamais "vides" au sens dossier

        // Un antivirus peut supprimer le contenu d'un jeu installé sans
        // supprimer le dossier lui-même : sans ce contrôle, l'app le
        // considère toujours comme installé alors qu'il n'y a plus rien.
        try {
            return fs.readdirSync(cheminComplet).length > 0;
        } catch (error) {
            return false;
        }
    });
});

ipcMain.handle('uninstallGame', async (event, nomJeu) => {
    try {
        const cheminDossierJeu = trouverDossierJeuInstalle(nomJeu);

        if (cheminDossierJeu && fs.existsSync(cheminDossierJeu)) {
            fs.rmSync(cheminDossierJeu, { recursive: true, force: true });
            console.log(`🗑️ Dossier supprimé avec succès : ${cheminDossierJeu}`);
            event.sender.send('debut-download', "start");
            return { status: 'success', message: 'Jeu désinstallé.' };
        } else {
            console.warn(`⚠️ Tentative de suppression d'un dossier inexistant : ${cheminDossierJeu}`);
            return { status: 'error', message: 'Dossier introuvable.' };
        }
    } catch (error) {
        console.error("Erreur lors de la désinstallation :", error.message);
        return { status: 'error', message: error.message };
    }
});

const { spawn, exec } = require('child_process');

ipcMain.handle('ajouter-exclusion-antivirus', async () => {
    if (process.platform !== 'win32') {
        return { status: 'error', message: 'Fonction disponible uniquement sur Windows.' };
    }

    try {
        if (!fs.existsSync(dossierDestination)) {
            fs.mkdirSync(dossierDestination, { recursive: true });
        }

        const cheminScript = path.join(os.tmpdir(), `kortex-exclusion-${Date.now()}.ps1`);
        const cheminEchappe = dossierDestination.replace(/'/g, "''");
        const contenuScript = `try { Add-MpPreference -ExclusionPath '${cheminEchappe}'; exit 0 } catch { exit 1 }`;
        fs.writeFileSync(cheminScript, contenuScript, 'utf-8');

        await new Promise((resolve, reject) => {
            const cheminScriptEchappe = cheminScript.replace(/'/g, "''");
            const commandeElevation = `try { $p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${cheminScriptEchappe}') -Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { exit 1 }`;
            const argsElevation = ['-NoProfile', '-Command', commandeElevation];

            const enfant = spawn('powershell.exe', argsElevation, { windowsHide: true });
            let erreur = '';
            enfant.stderr.on('data', (d) => { erreur += d.toString(); });
            enfant.on('error', reject);
            enfant.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(erreur || `L'élévation a échoué (code ${code}). L'utilisateur a peut-être refusé la demande.`));
            });
        });

        try { fs.unlinkSync(cheminScript); } catch (e) {}

        return { status: 'success' };
    } catch (error) {
        console.error('Erreur ajout exclusion antivirus :', error.message);
        return { status: 'error', message: error.message };
    }
});

let launchWindow = null;

function creerFenetreLancement() {
    if (launchWindow && !launchWindow.isDestroyed()) {
        launchWindow.show();
        launchWindow.focus();
        return;
    }

    launchWindow = new BrowserWindow({
        width: 440,
        height: 130,
        resizable: false,
        movable: true,
        frame: false,
        transparent: true,
        show: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        backgroundColor: '#00000000',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    launchWindow.loadFile(path.join(__dirname, 'launch.html'));

    launchWindow.on('closed', () => {
        launchWindow = null;
    });
}

function envoyerEtatLancement(state, message, nom, image) {
    if (!launchWindow || launchWindow.isDestroyed()) return;

    const cible = launchWindow;
    const envoyer = () => {
        if (!cible.isDestroyed()) {
            cible.webContents.send('launch-state', { state, message, name: nom, image });
        }
    };

    if (cible.webContents.isLoading()) {
        cible.webContents.once('did-finish-load', envoyer);
    } else {
        envoyer();
    }
}

function fermerFenetreLancement() {
    if (launchWindow && !launchWindow.isDestroyed()) {
        launchWindow.close();
    }
}

function verifierSteamActif() {
    return new Promise((resolve) => {
        exec('tasklist /FI "IMAGENAME eq steam.exe" /NH', (error, stdout) => {
            if (error) {
                resolve(false);
                return;
            }
            resolve(/steam\.exe/i.test(stdout));
        });
    });
}

ipcMain.on('launch-steam', () => {
    shell.openExternal('steam://open/main').catch((error) => {
        console.error('Impossible de lancer Steam :', error.message);
    });
});

ipcMain.on('open-external-link', (event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    shell.openExternal(url).catch((error) => {
        console.error('Impossible d\'ouvrir le lien externe :', error.message);
    });
});

ipcMain.handle('copyID', async (event, id) => {
    clipboard.writeText(id)
})
ipcMain.handle('startGame', async (event, nomJeu, gameInfo = {}) => {
    const nomAffiche = (gameInfo && gameInfo.displayName) ? gameInfo.displayName : joliNomJeu(nomJeu);
    const image = (gameInfo && gameInfo.imageUrl) ? gameInfo.imageUrl : '';

    creerFenetreLancement();
    envoyerEtatLancement('checking', 'Checking for Steam…', nomAffiche, image);

    try {
        const dossierJeu = trouverDossierJeuInstalle(nomJeu);

        if (!dossierJeu || !fs.existsSync(dossierJeu)) {
            envoyerEtatLancement('error', 'Game folder not found.', nomAffiche, image);
            return { status: 'error', message: 'Game folder not found.' };
        }

        const steamActif = await verifierSteamActif();
        if (!steamActif) {
            envoyerEtatLancement('steam-required', 'Steam must be running to launch a game.', nomAffiche, image);
            return { status: 'error', message: 'Steam must be running to launch a game.' };
        }

        let appData = {};
        if (fs.existsSync(dataPath)) {
            try {
                appData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            } catch (e) {
                console.error("Erreur de lecture du data.json, création d'un nouveau.");
            }
        }
        
        const clefTemps = extraireNomCoeurJeu(nomJeu) || nomJeu;

        if (!appData[clefTemps]) {
            const ancienneClef = Object.keys(appData).find((k) => k !== clefTemps && extraireNomCoeurJeu(k) === clefTemps);
            appData[clefTemps] = ancienneClef ? appData[ancienneClef] : { tempsDeJeu: 0 };
            if (ancienneClef) delete appData[ancienneClef];
        }

function trouverExe(dir, nomJeuCible) {
    let listeExe = [];

    const dossiersIgnores = [
        '_commonredist', 'redist', 'redistributables', 'directx', 'vcredist',
        'dotnet', 'dotnetfx', 'extras', 'prerequisites', 'prereq',
        'support', 'thirdparty', 'crashreportclient', '_redist'
    ];

    const motsInterdits = [
        'unins', 'crash', 'setup', 'config', 'server',
        'tool', 'reporter', 'benchmark', 'updater', 'redist',
        'redistributable', 'directx', 'vcredist', 'vc_redist', 'dotnetfx',
        'prereq', 'dxsetup', 'dxwebsetup', 'oalinst', 'crashpad',
        'crashhandler', 'installer', 'uninstall', 'vcruntime', 'dependencies'
    ];

    function scannerDossier(dossierActuel) {
        const fichiers = fs.readdirSync(dossierActuel, { withFileTypes: true });

        for (const fichier of fichiers) {
            const cheminComplet = path.join(dossierActuel, fichier.name);

            if (fichier.isDirectory()) {
                if (!dossiersIgnores.includes(fichier.name.toLowerCase())) {
                    scannerDossier(cheminComplet);
                }
            } else if (fichier.name.toLowerCase().endsWith('.exe')) {
                const nomFichier = fichier.name.toLowerCase();
                const contientMotInterdit = motsInterdits.some(mot => nomFichier.includes(mot));

                if (!contientMotInterdit) {
                    listeExe.push(cheminComplet);
                }
            }
        }
    }

    scannerDossier(dir);

    if (listeExe.length === 0) return null;
    if (listeExe.length === 1) return listeExe[0];

    // Plusieurs candidats : on les note plutôt que de trancher au premier
    // indice venu. Le nom du jeu peut correspondre à l'exe lui-même, au
    // dossier qui le contient (souvent le cas quand l'exe est enterré dans
    // "Binaries/Win64/"), et un exe minuscule est presque toujours un
    // utilitaire/launcher léger plutôt que le jeu lui-même.
    const nomJeuNettoye = (nomJeuCible || '').toLowerCase().replace(/[^a-z0-9]/g, "");

    const candidats = listeExe.map((exe) => {
        const nomExeNettoye = path.basename(exe, '.exe').toLowerCase().replace(/[^a-z0-9]/g, "");
        const nomDossierParentNettoye = path.basename(path.dirname(exe)).toLowerCase().replace(/[^a-z0-9]/g, "");

        let score = 0;

        if (nomJeuNettoye) {
            if (nomExeNettoye === nomJeuNettoye) score += 100;
            else if (nomExeNettoye.includes(nomJeuNettoye) || nomJeuNettoye.includes(nomExeNettoye)) score += 60;

            if (nomDossierParentNettoye.includes(nomJeuNettoye) || nomJeuNettoye.includes(nomDossierParentNettoye)) score += 20;
        }

        const profondeur = path.relative(dir, exe).split(path.sep).length;
        score -= profondeur * 2;

        let taille = 0;
        try { taille = fs.statSync(exe).size; } catch (e) {}
        if (taille < 300 * 1024) score -= 50;

        return { exe, score, taille };
    });

    candidats.sort((a, b) => b.score - a.score || b.taille - a.taille);

    return candidats[0].exe;
}

const executable = trouverExe(dossierJeu, nomJeu);

        if (executable) {
            console.log(`🚀 Lancement et tracking du jeu : ${executable}`);

            fermerFenetreLancement();

            const fenetreActive = BrowserWindow.fromWebContents(event.sender);
            if (fenetreActive) {
                fenetreActive.minimize();
            }

            const jeuProcess = spawn(`"${executable}"`, [], {
                cwd: path.dirname(executable),
                shell: true,
                detached: true
            });

            jeuxEnCours[nomJeu] = jeuProcess.pid;
            demarrerActiviteJeuDiscord(nomJeu, image);

            let trackerInterval = setInterval(() => {
                if (jeuProcess && jeuProcess.pid) {
                    try {
                        process.kill(jeuProcess.pid, 0);

                        appData[clefTemps].tempsDeJeu += 3;

                        fs.writeFileSync(dataPath, JSON.stringify(appData, null, 4));

                        event.sender.send('game-status-tracking', {
                            status: 'running',
                            nomJeu: nomJeu,
                            pid: jeuProcess.pid,
                            tempsDeJeu: appData[clefTemps].tempsDeJeu
                        });
                    } catch (e) {
                        clearInterval(trackerInterval);
                        delete jeuxEnCours[nomJeu];
                        arreterActiviteJeuDiscord();
                        event.sender.send('game-status-tracking', { status: 'stopped', nomJeu: nomJeu });

                        if (fenetreActive && fenetreActive.isMinimized()) fenetreActive.restore();
                    }
                } else {
                    delete jeuxEnCours[nomJeu];
                    arreterActiviteJeuDiscord();
                    event.sender.send('game-status-tracking', { status: 'stopped', nomJeu: nomJeu });
                    clearInterval(trackerInterval);
                }
            }, 3000);

            jeuProcess.on('exit', () => {
                clearInterval(trackerInterval);
                delete jeuxEnCours[nomJeu];
                arreterActiviteJeuDiscord();
                event.sender.send('game-status-tracking', { status: 'stopped', nomJeu: nomJeu });
                if (fenetreActive && fenetreActive.isMinimized()) fenetreActive.restore();
            });

            return { status: 'success' };
        } else {
            envoyerEtatLancement('error', 'No executable found for this game.', nomAffiche, image);
            return { status: 'error', message: 'No exe.' };
        }

    } catch (error) {
        console.error("Erreur globale startGame :", error);
        envoyerEtatLancement('error', error.message, nomAffiche, image);
        return { status: 'error', message: error.message };
    }
});

ipcMain.handle('stopGame', async (event, nomJeu) => {
    const pid = jeuxEnCours[nomJeu];

    if (!pid) {
        return { status: 'error', message: 'Aucun jeu en cours pour ce nom.' };
    }

    return new Promise((resolve) => {
        exec(`taskkill /PID ${pid} /T /F`, (error) => {
            delete jeuxEnCours[nomJeu];

            if (error) {
                console.error("Erreur lors de l'arrêt du jeu :", error.message);
                resolve({ status: 'error', message: error.message });
            } else {
                event.sender.send('game-status-tracking', { status: 'stopped', nomJeu: nomJeu });
                resolve({ status: 'success' });
            }
        });
    });
});

ipcMain.handle('stopDownload', async (event, nomJeu) => {
    try {
        const nomSecurise = nomJeu ? nomJeu.toLowerCase().replace(/[^a-zA-Z0-9]/g, "_") : "jeu_telecharge";
        const telechargement = telechargementsActifs[nomSecurise];

        if (!telechargement) {
            return { status: 'error', message: 'Aucun téléchargement actif trouvé.' };
        }

        if (telechargement.progressInterval) clearInterval(telechargement.progressInterval);

        if (telechargement.stream?.destroy) telechargement.stream.destroy();
        if (telechargement.process?.kill) try { telechargement.process.kill('SIGINT'); } catch (e) {}
        if (telechargement.controller) try { telechargement.controller.abort(); } catch (e) {}
        if (telechargement.writeStream) telechargement.writeStream.close();

        await new Promise(resolve => setTimeout(resolve, 800));

        const dossierBase = path.dirname(telechargement.cheminFichier);
        const nomBase = path.basename(telechargement.cheminFichier, path.extname(telechargement.cheminFichier));

        const fichiersASupprimer = fs.readdirSync(dossierBase).filter(file => {
            return file.startsWith(nomBase) && (file.endsWith('.rar') || file.includes('.part'));
        });

        fichiersASupprimer.forEach(file => {
            const p = path.join(dossierBase, file);
            if (fs.existsSync(p)) {
                fs.unlinkSync(p);
                console.log(`🗑️ Supprimé : ${file}`);
            }
        });

        const dossierJeu = path.join(dossierBase, nomSecurise); 
        if (fs.existsSync(dossierJeu) && fs.lstatSync(dossierJeu).isDirectory()) {
            const contenu = fs.readdirSync(dossierJeu);
            if (contenu.length === 0) {
                fs.rmdirSync(dossierJeu);
                console.log(`📁 Dossier vide supprimé : ${dossierJeu}`);
            }
        }

        delete telechargementsActifs[nomSecurise];
        event.sender.send('debut-download', "start");

        return { status: 'success', message: 'Nettoyage complet effectué.' };

    } catch (error) {
        console.error("Erreur lors de l'arrêt :", error);
        return { status: 'error', message: error.message };
    }
});

ipcMain.handle('getGameData', async (event, urlRecue, nom) => {
    try {
        console.log(`[SCRAPING] Récupération des infos via le serveur : ${urlRecue}`);

        let donneesParties = {};
        if (fs.existsSync(dataPath)) {
            try {
                donneesParties = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
            } catch (e) {
                console.error('Erreur de lecture de data.json :', e.message);
            }
        }

        const reponse = await appelScrapeAPI('post', '/game-info', { url: urlRecue });
        if (reponse.status !== 200 || reponse.data?.status !== 'success') {
            throw new Error(reponse.data?.message || `Le serveur a répondu avec le code ${reponse.status}.`);
        }

        const { gameSize, version, servers, mainImage, previews } = reponse.data;

        console.log(`[SUCCÈS] Données récupérées - Size: ${gameSize} | Version: ${version} | Images trouvées: ${(previews || []).length + (mainImage ? 1 : 0)}`);

        let donneesJeu = donneesParties[nom];
        if (!donneesJeu) {
            const coeurCible = extraireNomCoeurJeu(nom);
            const clefTrouvee = Object.keys(donneesParties).find((k) => extraireNomCoeurJeu(k) === coeurCible);
            if (clefTrouvee) donneesJeu = donneesParties[clefTrouvee];
        }

        return {
            success: true,
            gameSize: gameSize || t('info.notFound'),
            version: version || t('info.notFound'),
            servers: servers && servers.length > 0 ? servers : ["/."],
            mainImage: mainImage || t('info.notFound'),
            previews: previews && previews.length > 0 ? previews : [],
            playTime: donneesJeu ? donneesJeu.tempsDeJeu : "0"
        };

    } catch (error) {
        console.error("❌ Erreur lors de la récupération des infos du jeu :", error.message);
        return {
            success: false,
            error: error.message
        };
    }
});

const { autoUpdater } = require("electron-updater");

function sendStartupUpdateState(state, percent, message) {
    const target = splashWindow && !splashWindow.isDestroyed() ? splashWindow : mainWindow;
    if (target && !target.isDestroyed()) {
        target.webContents.send('startup-update-state', { state, percent, message });
    }
}

const catalogueMetaPath = path.join(dossierAppData, 'catalogue-meta.json');

function chargerCatalogueMeta() {
    if (!fs.existsSync(catalogueMetaPath)) return { lastUpdate: null };
    try {
        return JSON.parse(fs.readFileSync(catalogueMetaPath, 'utf-8'));
    } catch (e) {
        return { lastUpdate: null };
    }
}

function sauvegarderCatalogueMeta(meta) {
    fs.writeFileSync(catalogueMetaPath, JSON.stringify(meta, null, 4), 'utf-8');
}

async function mettreAJourCatalogueJeux() {
    const jsonFile = path.join(dossierAppData, 'games.json');
    try {
        const nouveauCatalogue = await fetchSteamRipCatalogue();
        fs.writeFileSync(jsonFile, JSON.stringify(nouveauCatalogue, null, 4), 'utf-8');
        sauvegarderCatalogueMeta({ lastUpdate: new Date().toISOString() });
        console.log(`✅ Catalogue mis à jour : ${Object.keys(nouveauCatalogue).length} jeux.`);
        return { success: true, count: Object.keys(nouveauCatalogue).length };
    } catch (error) {
        console.error("⚠️ Échec de la mise à jour du catalogue, conservation de l'ancien catalogue :", error.message);
        return { success: false, error: error.message };
    }
}

ipcMain.handle('get-catalogue-info', () => {
    const jsonFile = path.join(dossierAppData, 'games.json');
    let count = 0;
    if (fs.existsSync(jsonFile)) {
        try {
            count = Object.keys(JSON.parse(fs.readFileSync(jsonFile, 'utf-8'))).length;
        } catch (e) {}
    }
    return { count, lastUpdate: chargerCatalogueMeta().lastUpdate || null };
});

ipcMain.handle('update-catalogue-manual', async () => {
    return await mettreAJourCatalogueJeux();
});

function startStartupUpdateCheck() {
    let startupHandled = false;
    const finishStartup = async () => {
        if (startupHandled) return;
        startupHandled = true;

        const settingsActuels = chargerSettings();
        if (settingsActuels.updateCatalogueAtStartup !== false) {
            sendStartupUpdateState('catalogue', 90, 'Updating game catalogue...');
            await Promise.race([
                mettreAJourCatalogueJeux(),
                new Promise((resolve) => setTimeout(resolve, 25000))
            ]);
        }

        sendStartupUpdateState('launcher', 100, '');
        openMainLauncher();
    };

    sendStartupUpdateState('searching', 5, 'Searching for update...');

    autoUpdater.on('checking-for-update', () => {
        sendStartupUpdateState('searching', 5, 'Searching for update...');
    });

    autoUpdater.on('update-available', (info) => {
        sendStartupUpdateState('downloading', 15, 'Downloading update...');
    });

    autoUpdater.on('download-progress', (progressObj) => {
        const percent = Math.min(99, Math.max(15, Number(progressObj.percent) || 15));
        sendStartupUpdateState('downloading', percent, 'Downloading update...');
    });

    autoUpdater.on('update-downloaded', () => {
        sendStartupUpdateState('restarting', 100, 'Restarting Kortex...');
        setTimeout(() => {
            finishStartup();
            autoUpdater.quitAndInstall();
        }, 1400);
    });

    autoUpdater.on('update-not-available', () => {
        setTimeout(() => {
            finishStartup();
        }, 500);
    });

    autoUpdater.on('error', (error) => {
        const message = String(error && error.message ? error.message : '');
        const isNoConnection = /network|offline|socket|ECONN|ENOTFOUND|fetch failed|timed out|timeout|connection/i.test(message);
        sendStartupUpdateState(isNoConnection ? 'no-connection' : 'searching', 100, isNoConnection ? 'No connection' : 'Searching for update...');

        setTimeout(() => {
            finishStartup();
        }, isNoConnection ? 1500 : 700);
    });

    setTimeout(() => {
        finishStartup();
    }, 1200);

    autoUpdater.checkForUpdates().catch((error) => {
        const message = String(error && error.message ? error.message : '');
        const isNoConnection = /network|offline|socket|ECONN|ENOTFOUND|fetch failed|timed out|timeout|connection/i.test(message);
        sendStartupUpdateState(isNoConnection ? 'no-connection' : 'searching', 100, isNoConnection ? 'No connection' : 'Searching for update...');

        setTimeout(() => {
            finishStartup();
        }, isNoConnection ? 1500 : 700);
    });
}

ipcMain.on('restart_app', () => {
    autoUpdater.quitAndInstall();
});

ipcMain.on('minimize-window', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.minimize();
});

ipcMain.on('toggle-maximize-window', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

ipcMain.handle('is-window-maximized', () => {
  const win = BrowserWindow.getFocusedWindow();
  return win ? win.isMaximized() : false;
});

ipcMain.on('openFolder', async () => {
    const cheminDossierGames = path.join(app.getPath('userData'), 'games');

    console.log(`📂 [Main] Tentative d'ouverture du dossier : ${cheminDossierGames}`);

    try {
        if (!fs.existsSync(cheminDossierGames)) {
            fs.mkdirSync(cheminDossierGames, { recursive: true });
            console.log("📁 Le dossier 'games' n'existait pas, il a été créé avec succès.");
        }

        await shell.openPath(cheminDossierGames);

    } catch (error) {
        console.error("❌ Impossible d'ouvrir ou de créer le dossier :", error);
    }
});

ipcMain.handle('charger-games-json', async () => {
    const userDataPath = app.getPath('userData');
    const jsonFile = path.join(userDataPath, 'games.json');

    if (fs.existsSync(jsonFile)) {
        try {
            const data = fs.readFileSync(jsonFile, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            console.error("Erreur lors de la lecture du JSON :", error);
            return {};
        }
    }
    return {};
});

ipcMain.handle('charger-temps-jeu', () => {
    if (!fs.existsSync(dataPath)) return {};

    try {
        return JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    } catch (error) {
        console.error('Erreur lors de la lecture des temps de jeu :', error);
        return {};
    }
});
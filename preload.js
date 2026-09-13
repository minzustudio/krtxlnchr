const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  envoyerMessage: async (donnee, name) => {
    return await ipcRenderer.invoke('canal-securise', donnee, name);
  },
  getGameData: async (donnee, name, nom) => {
    return await ipcRenderer.invoke('getGameData', donnee, name, nom);
  },
  startGame: async (nom, gameInfo) => {
    return await ipcRenderer.invoke('startGame', nom, gameInfo);
  },
  stopGame: async (nom) => {
    return await ipcRenderer.invoke('stopGame', nom);
  },
  uninstallGame: async (nom) => {
    return await ipcRenderer.invoke('uninstallGame', nom);
  },
  stopDownload: async (nom) => {
    return await ipcRenderer.invoke('stopDownload', nom);
  },
  copyID: async (id) => {
    return await ipcRenderer.invoke('copyID', id);
  },
  chargerSettings: async () => {
    return await ipcRenderer.invoke('charger-settings');
  },
  sauvegarderSettings: async (settings) => {
    return await ipcRenderer.invoke('sauvegarder-settings', settings);
  },
  resetSettings: async () => {
    return await ipcRenderer.invoke('reset-settings');
  },
  getStorageStats: async () => {
    return await ipcRenderer.invoke('get-storage-stats');
  },
  getAppInfo: async () => {
    return await ipcRenderer.invoke('get-app-info');
  },
  checkForUpdatesManual: async () => {
    return await ipcRenderer.invoke('check-for-updates-manual');
  },
  getCatalogueInfo: async () => {
    return await ipcRenderer.invoke('get-catalogue-info');
  },
  updateCatalogueManual: async () => {
    return await ipcRenderer.invoke('update-catalogue-manual');
  },
  exporterBibliotheque: async () => {
    return await ipcRenderer.invoke('exporter-bibliotheque');
  },
  importerBibliotheque: async () => {
    return await ipcRenderer.invoke('importer-bibliotheque');
  },
  envoyerSupport: async (donnees) => {
    return await ipcRenderer.invoke('envoyer-support', donnees);
  },
  ajouterExclusionAntivirus: async () => {
    return await ipcRenderer.invoke('ajouter-exclusion-antivirus');
  }
});

contextBridge.exposeInMainWorld('electronAPI', {
    onDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (event, data) => callback(data)),
    downloadstart: (callback) => ipcRenderer.on('debut-download', (event, message) => callback(message)),
    listerDossiersJeux: () => ipcRenderer.invoke('lister-dossiers-jeux'),
    onGameStatus: (callback) => ipcRenderer.on('game-status-tracking', callback),
    minimize: () => ipcRenderer.send('minimize-window'),
    toggleMaximize: () => ipcRenderer.send('toggle-maximize-window'),
    isMaximized: () => ipcRenderer.invoke('is-window-maximized'),
    onMaximizedChange: (callback) => ipcRenderer.on('window-maximized-state', (event, isMaximized) => callback(isMaximized)),
    openFolder: () => ipcRenderer.send('openFolder'),
    onUpdateAvailable: (callback) => ipcRenderer.on('update_available', callback),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update_downloaded', callback),
    onStartupUpdateState: (callback) => ipcRenderer.on('startup-update-state', (event, data) => callback(data)),
    onLaunchState: (callback) => ipcRenderer.on('launch-state', (event, data) => callback(data)),
    launchSteam: () => ipcRenderer.send('launch-steam'),
    onNoServerFound: (callback) => ipcRenderer.on('no-server-found', (event, data) => callback(data)),
    choisirLangue: (langue) => ipcRenderer.send('choisir-langue', langue),
    openExternalLink: (url) => ipcRenderer.send('open-external-link', url),
    restartApp: () => ipcRenderer.send('restart_app'),

    demarrerScraping: () => ipcRenderer.send('lancer-scraping'),

    onNouveauJeu: (callback) => ipcRenderer.on('nouveau-jeu', (event, gameObj) => callback(gameObj)),
  chargerGamesJson: () => ipcRenderer.invoke('charger-games-json'),
  chargerTempsJeu: () => ipcRenderer.invoke('charger-temps-jeu'),
  onScrapingTermine: (callback) => ipcRenderer.on('scraping-termine', () => callback()),
    onProgression: (callback) => ipcRenderer.on('progression-scraping', (event, pourcentage) => callback(pourcentage))
});
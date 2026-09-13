let catalogueGames = [];
let nomsInstalleGlobal = [];
let nomsEnRarGlobal = [];
let tempsJeuGlobal = {};
let libraryFilter = 'all';
let libraryView = 'grid';

let listeAfficheeActuelle = [];
let indexAffichage = 0;
const TAILLE_VAGUE = 60;
let observateurSentinelle = null;

const ICONE_PLAY = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none" class="lucide lucide-play-icon lucide-play"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>';
const ICONE_STOP = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-icon lucide-square"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>';
const ICONE_MAXIMIZE = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
const ICONE_RESTORE = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 0.5H9.5V7.5" fill="none" stroke="currentColor" stroke-width="1"/><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/></svg>';

function normaliserNomJeu(nom) {
    return nom.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

// Les noms de jeux scrapés peuvent contenir n'importe quel caractère
// (apostrophes, esperluettes, guillemets...). Sans échappement, ces
// caractères cassent le HTML généré par template literal (attribut coupé
// en plein milieu, chaîne JS mal fermée dans un onclick), rendant la carte
// injouable/incliquable.
function echapperHtml(texte) {
    const div = document.createElement('div');
    div.textContent = String(texte ?? '');
    return div.innerHTML;
}

function echapperPourAttributJs(texte) {
    return String(texte ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/&/g, '&amp;')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function nomJeuAffiche(nom) {
    return String(nom || '')
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s+Free Download\b.*$/i, '')
        .trim();
}

function extraireNomCoeurJeu(chaine) {
    let coeur = normaliserNomJeu(nomJeuAffiche(chaine));

    coeur = coeur
        .replace(/_free_download.*$/i, '')
        .replace(/(_v\d+(_\d+){0,4})+$/i, '')
        .replace(/_multiplayer$/i, '')
        .replace(/_repack$/i, '')
        .replace(/_+$/, '');

    return coeur;
}

function formaterTempsCarte(secondes) {
    const totalSecondes = Math.max(0, Number(secondes) || 0);
    const jours = Math.floor(totalSecondes / 86400);
    const heures = Math.floor((totalSecondes % 86400) / 3600);
    const minutes = Math.floor((totalSecondes % 3600) / 60);

    if (jours > 0) return `${jours}j ${heures}h`;
    if (heures > 0) return `${heures}h ${minutes}min`;
    return `${minutes}min`;
}

function tempsJeuPour(gameName) {
    const nomNormalise = normaliserNomJeu(gameName);
    if (tempsJeuGlobal[nomNormalise]) return tempsJeuGlobal[nomNormalise];

    const coeurCible = extraireNomCoeurJeu(gameName);
    const clefTrouvee = Object.keys(tempsJeuGlobal).find((k) => extraireNomCoeurJeu(k) === coeurCible);
    return clefTrouvee ? tempsJeuGlobal[clefTrouvee] : undefined;
}

function getPoids(gameName) {
    const nom = extraireNomCoeurJeu(gameName);
    if (nomsInstalleGlobal.includes(nom)) return 3;
    if (nomsEnRarGlobal.includes(nom)) return 2;
    return 1;
}

function genererHTMLCarteJeu(gameData, estInstalle, estEnDownload) {
    const nomNormalise = normaliserNomJeu(gameData.gameName);
    const nomAffiche = echapperHtml(nomJeuAffiche(gameData.gameName));
    const urlJs = echapperPourAttributJs(gameData.url);
    const nomJs = echapperPourAttributJs(gameData.gameName);
    const urlAttribut = echapperHtml(gameData.url);
    const imageUrlSure = String(gameData.imageLink || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const tempsAffiche = estInstalle
        ? formaterTempsCarte(tempsJeuPour(gameData.gameName)?.tempsDeJeu)
        : t('card.uninstalled');
    const tempsIcone = estInstalle
        ? '<svg class="game-time-icon" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><title>clock-circle-linear</title><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 8V12L14.5 14.5"/></g></svg>'
        : '';

    return `
        <div class="game-inner-box ${estInstalle ? 'downloaded' : ''}" id="${nomNormalise}" name="${estInstalle ? 'downloaded' : estEnDownload ? "downloading" : 'uninstalled'}" data-gameurl="${urlAttribut}" onclick="gameSelected('${urlJs}','${nomJs}', this)">
            <div class="background-container" id="${nomNormalise}_ingame_scale" style="scale:1; opacity:${estInstalle ? '100%' : '48%'}">
                <div class="background ${estInstalle ? 'downloaded' : ''}" style="background-image: url('${imageUrlSure}');"></div>
                <div class="ingame" id="${nomNormalise}_ingame" style="display: none;"></div>
                <button class="downloadButton" style="display:${!estInstalle && !estEnDownload ? 'flex' : 'none'};" onclick="event.stopPropagation(); downloadgame('${urlJs}', '${nomJs}', this)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download-icon lucide-download"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>
                </button>
                <button class="game-action-btn" data-role="play" onclick="event.stopPropagation(); play('${nomNormalise}', this)" style="display:${estInstalle && !estEnDownload ? 'flex' : 'none'};">${ICONE_PLAY}</button>
                <button class="game-action-btn" onclick="event.stopPropagation(); stopDownload('${nomNormalise}', this)" style="display:${estEnDownload ? 'flex' : 'none'};"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-icon lucide-square"><rect width="18" height="18" x="3" y="3" rx="2"/></svg></button>
                <button onclick="event.stopPropagation(); uninstall('${nomNormalise}', this)" class="uninstall" style="display:${estInstalle ? 'block' : 'none'}; color: red;"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>
            <div class="game-meta">
                <div class="game-name" title="${nomAffiche}">${nomAffiche}</div>
                <div class="game-time-label">${tempsIcone}<span>${tempsAffiche}</span></div>
            </div>
        </div>
    `;
}

async function loadCatalogue() {
    closegame()
    const games = await window.electronAPI.chargerGamesJson();
    const dossierJeuxExistants = await window.electronAPI.listerDossiersJeux();
    tempsJeuGlobal = await window.electronAPI.chargerTempsJeu();
    
    nomsInstalleGlobal = dossierJeuxExistants
        .filter(d => !d.endsWith('.rar'))
        .map(d => extraireNomCoeurJeu(d));

    nomsEnRarGlobal = dossierJeuxExistants
        .filter(d => d.endsWith('.rar.part0'))
        .map(d => extraireNomCoeurJeu(d.replace('.rar.part0', '')));

    catalogueGames = Object.values(games).sort((a, b) => getPoids(b.gameName) - getPoids(a.gameName));

    renderCatalogue();
}

function renderCatalogue(filterText = '') {
    const q = String(filterText || '').trim().toLowerCase();
    const sortByNameCheckbox = document.getElementById('sortByName');

    let liste = catalogueGames.slice();
    if (q.length) {
        liste = liste.filter(g => g.gameName.toLowerCase().includes(q));
    }

    if (libraryFilter === 'installed') {
        liste = liste.filter(gameData => {
            return nomsInstalleGlobal.includes(extraireNomCoeurJeu(gameData.gameName));
        });
    }

    if (sortByNameCheckbox && sortByNameCheckbox.checked) {
        liste.sort((a, b) => a.gameName.localeCompare(b.gameName, 'fr', { sensitivity: 'base' }));
    } else {
        liste.sort((a, b) => getPoids(b.gameName) - getPoids(a.gameName));
    }

    listeAfficheeActuelle = liste;
    indexAffichage = 0;

    document.getElementById('library-header-container').innerHTML = `
        <div class="library-header">
            <div class="library-heading">
                <span class="library-title">${t('library.title')}</span>
                <span class="library-count">${liste.length}</span>
            </div>
            <div class="library-controls-row">
                <div class="library-filter ${libraryFilter === 'all' ? 'filter-all' : ''}">
                    <span class="library-filter-thumb"></span>
                    <button class="library-filter-button ${libraryFilter === 'installed' ? 'is-selected' : ''}" onclick="setLibraryFilter('installed')">${t('library.installed')}</button>
                    <button class="library-filter-button ${libraryFilter === 'all' ? 'is-selected': ''}" onclick="setLibraryFilter('all')">${t('library.all')}</button>
                </div>
                <div class="library-view-toggle ${libraryView === 'list' ? 'view-list' : ''}">
                    <span class="library-view-thumb"></span>
                    <button class="library-view-button ${libraryView === 'grid' ? 'is-selected' : ''}" onclick="setLibraryView('grid')" title="${t('library.viewGrid')}" aria-label="${t('library.viewGrid')}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
                    </button>
                    <button class="library-view-button ${libraryView === 'list' ? 'is-selected' : ''}" onclick="setLibraryView('list')" title="${t('library.viewList')}" aria-label="${t('library.viewList')}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/></svg>
                    </button>
                </div>
            </div>
        </div>
    `;

    document.getElementById('catalogue').innerHTML = `
        <div id="grid-container-jeux" class="grid-container-jeux ${libraryView === 'list' ? 'list-view' : ''}">
            ${liste.length ? '' : `<div class="library-empty"><strong>${t('library.empty.title')}</strong><span>${t('library.empty.desc')}</span></div>`}
        </div>

        <div id="sentinelle-scroll" style="height: 50px; width: 100%; clear: both;"></div>
    `;

    sectionsRenderState = {
        library: { list: liste, index: 0 }
    };

    injecterProchaineVague();
    activerInfiniteScroll();
}

function setLibraryFilter(filter) {
    libraryFilter = filter === 'installed' ? 'installed' : 'all';
    const searchInput = document.getElementById('search');
    renderCatalogue(searchInput ? searchInput.value : '');
}

function setLibraryView(view) {
    libraryView = view === 'list' ? 'list' : 'grid';
    const searchInput = document.getElementById('search');
    renderCatalogue(searchInput ? searchInput.value : '');
}

let currentPage = 'library';

const PAGES_VALIDES = ['library', 'downloads', 'stats', 'settings', 'support'];

function setPage(page) {
    currentPage = PAGES_VALIDES.includes(page) ? page : 'library';

    PAGES_VALIDES.forEach((nomPage) => {
        const bouton = document.getElementById(`nav-${nomPage}`);
        if (bouton) bouton.classList.toggle('is-active', currentPage === nomPage);

        const conteneur = document.getElementById(nomPage === 'library' ? 'catalogue-container' : `${nomPage}-container`);
        if (conteneur) conteneur.style.display = currentPage === nomPage ? 'block' : 'none';
    });

    const searchWrap = document.getElementById('search-wrap');
    if (searchWrap) searchWrap.style.display = currentPage === 'library' ? 'flex' : 'none';

    if (currentPage === 'downloads') renderDownloadsPage();
    if (currentPage === 'stats') renderStatsPage();
}

let sectionsRenderState = {
    library: { list: [], index: 0 }
};

function tronquerTitresJeux(elements) {
    elements.forEach((el) => {
        if (el.dataset.titreComplet === undefined) {
            el.dataset.titreComplet = el.textContent;
        }
        const original = el.dataset.titreComplet;
        el.textContent = original;
        if (el.scrollWidth <= el.clientWidth) return;

        let texte = original;
        while (texte.length > 1 && el.scrollWidth > el.clientWidth) {
            texte = texte.slice(0, -1);
            el.textContent = texte + '..';
        }
    });
}

function injecterProchaineVague() {
    const conteneurLibrary = document.getElementById('grid-container-jeux');
    if (!conteneurLibrary) return;

    const chargeVague = (grid, sectionKey, games) => {
        if (!grid || !games || !games.length) return false;

        const state = sectionsRenderState[sectionKey];
        if (state.index >= games.length) return false;

        const debut = state.index;
        const fin = Math.min(state.index + TAILLE_VAGUE, games.length);
        let htmlVague = '';

        for (let i = debut; i < fin; i++) {
            const gameData = games[i];
            const nomCoeur = extraireNomCoeurJeu(gameData.gameName);
            const estInstalle = nomsInstalleGlobal.includes(nomCoeur);
            const estEnDownload = nomsEnRarGlobal.includes(nomCoeur);

            htmlVague += genererHTMLCarteJeu(gameData, estInstalle, estEnDownload);
        }

        grid.insertAdjacentHTML('beforeend', htmlVague);
        state.index = fin;

        const nouvellesCartes = Array.from(grid.children).slice(debut, fin);
        const titres = nouvellesCartes.flatMap((carte) => Array.from(carte.querySelectorAll('.game-name')));
        tronquerTitresJeux(titres);

        return true;
    };

    const aCharge = chargeVague(conteneurLibrary, 'library', sectionsRenderState.library.list);

    if (!aCharge) {
        const sentinelle = document.getElementById('sentinelle-scroll');
        if (sentinelle && observateurSentinelle) {
            observateurSentinelle.unobserve(sentinelle);
        }
    }
}

function activerInfiniteScroll() {
    if (observateurSentinelle) {
        observateurSentinelle.disconnect();
    }

    const sentinelle = document.getElementById('sentinelle-scroll');
    if (!sentinelle) return;

    const options = {
        root: document.getElementById('catalogue-container'),
        rootMargin: '400px',
        threshold: 0.01
    };

    observateurSentinelle = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                injecterProchaineVague();

                const toutCharge =
                    sectionsRenderState.library.index >= sectionsRenderState.library.list.length;

                if (toutCharge) {
                    observateurSentinelle.unobserve(sentinelle);
                }
            }
        });
    }, options);

    observateurSentinelle.observe(sentinelle);
}

function setStartupUpdateState(data = {}) {
    const overlay = document.getElementById('update-content');
    const loadingText = document.getElementById('loadingTexte');
    const loadingPercent = document.getElementById('loadingpourcentage');
    const progressFill = document.getElementById('update-progress-fill');
    const appContent = document.getElementById('app-content');

    const state = data.state || 'searching';
    const percent = Math.min(100, Math.max(0, Number(data.percent) || 0));
    const message = data.message || 'Searching for update...';

    if (loadingText) loadingText.textContent = message;
    if (loadingPercent) loadingPercent.textContent = `${Math.round(percent)}%`;
    if (progressFill) progressFill.style.width = `${percent}%`;

    if (state === 'launcher') {
        if (overlay) overlay.classList.add('hidden');
        if (appContent) appContent.style.opacity = '1';
        return;
    }

    if (overlay) overlay.classList.remove('hidden');
    if (appContent) appContent.style.opacity = '0.2';
}

document.addEventListener('DOMContentLoaded', async () => {
    const appContent = document.getElementById('app-content');
    const searchInput = document.getElementById('search');
    const sortByName = document.getElementById('sortByName');

    if (appContent) {
        appContent.style.opacity = '1';
    }

    const startupOverlay = document.getElementById('update-content');
    if (startupOverlay) {
        startupOverlay.classList.add('hidden');
    }

    if (searchInput) {
        searchInput.addEventListener('input', (e) => renderCatalogue(e.target.value));
        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                searchInput.value = '';
                renderCatalogue();
                searchInput.blur();
            }
        });
    }
    if (sortByName) {
        sortByName.addEventListener('change', () => renderCatalogue(searchInput ? searchInput.value : ''));
    }

    const maximizeBtn = document.getElementById('maximize-btn');
    if (maximizeBtn && window.electronAPI) {
        const appliquerEtatMaximise = (estMaximise) => {
            maximizeBtn.innerHTML = estMaximise ? ICONE_RESTORE : ICONE_MAXIMIZE;
            maximizeBtn.title = t(estMaximise ? 'caption.restore' : 'caption.maximize');
        };
        if (window.electronAPI.isMaximized) {
            window.electronAPI.isMaximized().then(appliquerEtatMaximise);
        }
        if (window.electronAPI.onMaximizedChange) {
            window.electronAPI.onMaximizedChange(appliquerEtatMaximise);
        }
    }

    const settingsContainer = document.getElementById('settings-container');
    if (settingsContainer) {
        settingsContainer.addEventListener('change', () => sauvegarderParametresUI());
        settingsContainer.addEventListener('click', (event) => {
            const swatch = event.target.closest('.settings-swatch');
            if (swatch) {
                appliquerAccentColor(swatch.dataset.color);
                sauvegarderParametresUI();
                return;
            }
            const segBtn = event.target.closest('.settings-segmented-btn');
            if (segBtn) {
                if (segBtn.closest('#languageSegmented')) {
                    appliquerLangue(segBtn.dataset.value);
                } else {
                    appliquerVueParDefaut(segBtn.dataset.value);
                }
                sauvegarderParametresUI();
            }
        });
    }
    await chargerParametresUI();
    demarrerEchantillonnageVitesse();

    loadCatalogue();
});

const PALETTES_ACCENT = {
    terracotta: { accent: '#C1704A', strong: '#A8583A', soft: 'rgba(193, 112, 74, 0.16)' },
    sage: { accent: '#7A9B6E', strong: '#5F7D55', soft: 'rgba(122, 155, 110, 0.16)' },
    dustyblue: { accent: '#6E8CA0', strong: '#547085', soft: 'rgba(110, 140, 160, 0.16)' },
    gold: { accent: '#C9A24B', strong: '#A9843A', soft: 'rgba(201, 162, 75, 0.16)' },
    rose: { accent: '#B5707D', strong: '#976074', soft: 'rgba(181, 112, 125, 0.16)' }
};

function appliquerAccentColor(nomCouleur) {
    const palette = PALETTES_ACCENT[nomCouleur] || PALETTES_ACCENT.terracotta;
    const racine = document.documentElement;
    racine.style.setProperty('--accent', palette.accent);
    racine.style.setProperty('--accent-strong', palette.strong);
    racine.style.setProperty('--accent-soft', palette.soft);

    document.querySelectorAll('.settings-swatch').forEach((bouton) => {
        bouton.classList.toggle('is-selected', bouton.dataset.color === nomCouleur);
    });
}

function appliquerVueParDefaut(valeur) {
    const segmented = document.getElementById('defaultViewSegmented');
    if (!segmented) return;
    segmented.classList.toggle('value-list', valeur === 'list');
    segmented.querySelectorAll('.settings-segmented-btn').forEach((bouton) => {
        bouton.classList.toggle('is-selected', bouton.dataset.value === valeur);
    });
}

let langueCourante = 'en';

function t(cle, params) {
    if (window.i18n && window.i18n.translate) {
        return window.i18n.translate(langueCourante, cle, params);
    }
    return cle;
}

function appliquerTraductions() {
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}

function appliquerLangueSegmented(langue) {
    const segmented = document.getElementById('languageSegmented');
    if (!segmented) return;
    segmented.classList.toggle('value-list', langue === 'fr');
    segmented.querySelectorAll('.settings-segmented-btn').forEach((bouton) => {
        bouton.classList.toggle('is-selected', bouton.dataset.value === langue);
    });
}

function appliquerLangue(langue) {
    langueCourante = langue === 'fr' ? 'fr' : 'en';
    appliquerLangueSegmented(langueCourante);
    appliquerTraductions();
    chargerInfosCatalogue();
    renderCatalogue(document.getElementById('search')?.value || '');
}

async function chargerParametresUI() {
    if (!window.api || !window.api.chargerSettings) return;

    const settings = await window.api.chargerSettings();

    const sortByNameInput = document.getElementById('sortByName');
    if (sortByNameInput) sortByNameInput.checked = !!settings.sortByName;

    const launchAtStartup = document.getElementById('launchAtStartup');
    if (launchAtStartup) launchAtStartup.checked = !!settings.launchAtStartup;

    const minimizeToTray = document.getElementById('minimizeToTray');
    if (minimizeToTray) minimizeToTray.checked = !!settings.minimizeToTray;

    const autoOpenFolderAfterInstall = document.getElementById('autoOpenFolderAfterInstall');
    if (autoOpenFolderAfterInstall) autoOpenFolderAfterInstall.checked = !!settings.autoOpenFolderAfterInstall;

    const notifyOnDownloadComplete = document.getElementById('notifyOnDownloadComplete');
    if (notifyOnDownloadComplete) notifyOnDownloadComplete.checked = settings.notifyOnDownloadComplete !== false;

    const updateCatalogueAtStartup = document.getElementById('updateCatalogueAtStartup');
    if (updateCatalogueAtStartup) updateCatalogueAtStartup.checked = settings.updateCatalogueAtStartup !== false;

    const discordEnabled = document.getElementById('discordEnabled');
    if (discordEnabled) discordEnabled.checked = settings.discordRichPresence.enabled !== false;

    appliquerAccentColor(settings.accentColor || 'terracotta');
    appliquerVueParDefaut(settings.defaultLibraryView || 'grid');
    libraryView = settings.defaultLibraryView === 'list' ? 'list' : 'grid';

    langueCourante = settings.language === 'fr' ? 'fr' : 'en';
    appliquerLangueSegmented(langueCourante);
    appliquerTraductions();

    chargerStatsStockage();
    chargerInfosApp();
    chargerInfosCatalogue();
}

async function sauvegarderParametresUI() {
    if (!window.api || !window.api.sauvegarderSettings) return;

    const segmented = document.getElementById('defaultViewSegmented');
    const selectedSwatch = document.querySelector('.settings-swatch.is-selected');

    const settings = {
        sortByName: document.getElementById('sortByName')?.checked || false,
        launchAtStartup: document.getElementById('launchAtStartup')?.checked || false,
        notifyOnDownloadComplete: document.getElementById('notifyOnDownloadComplete')?.checked || false,
        updateCatalogueAtStartup: document.getElementById('updateCatalogueAtStartup')?.checked || false,
        minimizeToTray: document.getElementById('minimizeToTray')?.checked || false,
        autoOpenFolderAfterInstall: document.getElementById('autoOpenFolderAfterInstall')?.checked || false,
        defaultLibraryView: segmented?.querySelector('.settings-segmented-btn.is-selected')?.dataset.value || 'grid',
        language: langueCourante,
        accentColor: selectedSwatch?.dataset.color || 'terracotta',
        discordRichPresence: {
            enabled: document.getElementById('discordEnabled')?.checked || false
        }
    };

    await window.api.sauvegarderSettings(settings);
}

async function chargerStatsStockage() {
    if (!window.api || !window.api.getStorageStats) return;

    const valueEl = document.getElementById('storageValue');
    const countEl = document.getElementById('storageCount');
    if (valueEl) valueEl.textContent = '…';

    const stats = await window.api.getStorageStats();

    if (valueEl) valueEl.textContent = stats.jeuxFormatte;
    if (countEl) countEl.textContent = stats.nbJeux;

    const segGames = document.getElementById('segGames');
    const segOther = document.getElementById('segOther');
    const segFree = document.getElementById('segFree');
    if (segGames) segGames.style.width = `${stats.jeuxPourcent}%`;
    if (segOther) segOther.style.width = `${stats.autrePourcent}%`;
    if (segFree) segFree.style.width = `${stats.librePourcent}%`;

    const legendGames = document.getElementById('legendGames');
    const legendOther = document.getElementById('legendOther');
    const legendFree = document.getElementById('legendFree');
    if (legendGames) legendGames.textContent = `${stats.jeuxFormatte} (${stats.jeuxPourcent.toFixed(1)}%)`;
    if (legendOther) legendOther.textContent = `${stats.autreFormatte} (${stats.autrePourcent.toFixed(1)}%)`;
    if (legendFree) legendFree.textContent = `${stats.libreFormatte} (${stats.librePourcent.toFixed(1)}%)`;
}

async function chargerInfosApp() {
    if (!window.api || !window.api.getAppInfo) return;

    const infos = await window.api.getAppInfo();
    const versionEl = document.getElementById('appVersionLabel');
    if (versionEl) versionEl.textContent = `v${infos.version}`;
}

function formaterDateCatalogue(iso) {
    if (!iso) return t('settings.catalogue.never');
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return t('settings.catalogue.never');
    return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function chargerInfosCatalogue() {
    if (!window.api || !window.api.getCatalogueInfo) return;

    const infos = await window.api.getCatalogueInfo();
    const countEl = document.getElementById('catalogueCount');
    const lastUpdateEl = document.getElementById('catalogueLastUpdate');
    if (countEl) countEl.textContent = infos.count;
    if (lastUpdateEl) lastUpdateEl.textContent = formaterDateCatalogue(infos.lastUpdate);
}

async function lancerMiseAJourCatalogue() {
    const bouton = document.getElementById('updateCatalogueBtn');
    if (!window.api || !window.api.updateCatalogueManual) return;

    if (bouton) {
        bouton.disabled = true;
        bouton.textContent = t('settings.catalogue.updating');
    }

    const resultat = await window.api.updateCatalogueManual();

    if (resultat && resultat.success) {
        await chargerInfosCatalogue();
        loadCatalogue();
    } else {
        afficherToast({
            title: t('toast.catalogue.failedTitle'),
            desc: (resultat && resultat.error) ? resultat.error : t('toast.catalogue.failedDesc')
        });
    }

    if (bouton) {
        bouton.disabled = false;
        bouton.textContent = t('settings.catalogue.updateNow');
    }
}

async function verifierMisesAJour() {
    const bouton = document.getElementById('checkUpdatesBtn');
    const statutEl = document.getElementById('updateStatusLabel');
    if (!window.api || !window.api.checkForUpdatesManual) return;

    if (bouton) {
        bouton.disabled = true;
        bouton.textContent = t('settings.updates.checking');
    }

    const resultat = await window.api.checkForUpdatesManual();

    if (statutEl) {
        if (resultat.status === 'update-available') {
            statutEl.textContent = t('settings.updates.available');
        } else if (resultat.status === 'up-to-date') {
            statutEl.textContent = t('settings.updates.upToDate');
        } else {
            statutEl.textContent = t('settings.updates.failed');
        }
    }

    if (bouton) {
        bouton.disabled = false;
        bouton.textContent = t('settings.updates.checkBtn');
    }
}

async function reinitialiserParametres() {
    if (!window.api || !window.api.resetSettings) return;
    await window.api.resetSettings();
    await chargerParametresUI();
}

async function ajouterExclusionAntivirusUI() {
    const bouton = document.getElementById('defenderExclusionBtn');
    if (!window.api || !window.api.ajouterExclusionAntivirus) return;

    const confirme = confirm(t('settings.defender.confirm'));
    if (!confirme) return;

    if (bouton) { bouton.disabled = true; bouton.textContent = t('settings.defender.adding'); }

    const resultat = await window.api.ajouterExclusionAntivirus();

    if (resultat.status === 'success') {
        afficherToast({ title: t('toast.defender.successTitle'), desc: t('toast.defender.successDesc') });
    } else {
        afficherToast({ title: t('toast.defender.failTitle'), desc: resultat.message || t('toast.defender.failDesc') });
    }

    if (bouton) { bouton.disabled = false; bouton.textContent = t('settings.defender.btn'); }
}

const ICONE_ANNULER = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

let telechargementsActifsUI = {};
let telechargementsAnnules = new Set();

function mettreAJourTelechargementUI(data) {
    if (telechargementsAnnules.has(data.name)) return;

    const pourcentageNombre = parseFloat(data.pourcentage) || 0;

    if (pourcentageNombre >= 100) {
        if (telechargementsActifsUI[data.name]) {
            telechargementsActifsUI[data.name] = { ...data, pourcentageNombre, vitesseNombre: 0 };
            renderDownloadsPage();
        }
        setTimeout(() => {
            delete telechargementsActifsUI[data.name];
            renderDownloadsPage();
        }, 1500);
        return;
    }

    const gameData = catalogueGames.find((g) => normaliserNomJeu(g.gameName) === data.name);

    telechargementsActifsUI[data.name] = {
        ...data,
        pourcentageNombre,
        vitesseNombre: parseFloat(data.vitesse) || 0,
        nomAffiche: gameData ? nomJeuAffiche(gameData.gameName) : data.name,
        image: gameData ? gameData.imageLink : ''
    };

    renderDownloadsPage();
}

function annulerTelechargementUI(nomDuJeu) {
    telechargementsAnnules.add(nomDuJeu);
    stopDownload(nomDuJeu);
    delete telechargementsActifsUI[nomDuJeu];
    renderDownloadsPage();

    setTimeout(() => telechargementsAnnules.delete(nomDuJeu), 5000);
}

function renderDownloadsPage() {
    const liste = Object.values(telechargementsActifsUI);

    const badge = document.getElementById('downloadsBadge');
    if (badge) {
        badge.textContent = liste.length;
        badge.hidden = liste.length === 0;
    }

    const conteneurListe = document.getElementById('downloadsList');
    const conteneurVide = document.getElementById('downloadsEmpty');
    if (!conteneurListe || !conteneurVide) return;

    conteneurVide.style.display = liste.length ? 'none' : 'flex';

    const nomsActuels = new Set(liste.map((t) => t.name));

    Array.from(conteneurListe.children).forEach((ligne) => {
        if (!nomsActuels.has(ligne.dataset.name)) {
            ligne.remove();
        }
    });

    liste.forEach((telechargement) => {
        let ligne = conteneurListe.querySelector(`.download-row[data-name="${telechargement.name}"]`);

        if (!ligne) {
            ligne = document.createElement('div');
            ligne.className = 'download-row';
            ligne.dataset.name = telechargement.name;
            ligne.innerHTML = `
                <div class="download-thumb"></div>
                <div class="download-info">
                    <span class="download-name"></span>
                    <div class="download-progress-shell"><span class="download-progress-fill"></span></div>
                    <span class="download-meta"></span>
                </div>
                <button class="download-cancel-btn" title="Annuler" aria-label="Annuler">${ICONE_ANNULER}</button>
            `;
            ligne.querySelector('.download-cancel-btn').onclick = () => annulerTelechargementUI(telechargement.name);
            conteneurListe.appendChild(ligne);
        }

        ligne.querySelector('.download-thumb').style.backgroundImage = `url('${telechargement.image || ''}')`;
        ligne.querySelector('.download-name').textContent = telechargement.nomAffiche;
        ligne.querySelector('.download-progress-fill').style.width = `${telechargement.pourcentageNombre}%`;
        ligne.querySelector('.download-meta').textContent = `${telechargement.actuel || ''} / ${telechargement.total || ''} • ${telechargement.pourcentage || '0%'}`;
    });

    dessinerGraphiqueVitesse();
}

let historiqueVitesse = [];
let echantillonnageVitesseDemarre = false;

function demarrerEchantillonnageVitesse() {
    if (echantillonnageVitesseDemarre) return;
    echantillonnageVitesseDemarre = true;

    setInterval(() => {
        const vitesseTotale = Object.values(telechargementsActifsUI)
            .reduce((total, dl) => total + (dl.vitesseNombre || 0), 0);

        const maintenant = Date.now();
        historiqueVitesse.push({ t: maintenant, v: vitesseTotale });

        const seuil = maintenant - 60000;
        historiqueVitesse = historiqueVitesse.filter((point) => point.t >= seuil);

        if (currentPage === 'downloads') dessinerGraphiqueVitesse();
    }, 1000);
}

function dessinerGraphiqueVitesse() {
    const svgLigne = document.getElementById('downloadsChartLine');
    const svgAire = document.getElementById('downloadsChartArea');
    if (!svgLigne || !svgAire) return;

    const largeur = 600;
    const basY = 122;
    const hautY = 10;
    const fenetre = 60000;
    const maintenant = Date.now();

    const points = historiqueVitesse.length
        ? historiqueVitesse
        : [{ t: maintenant - fenetre, v: 0 }, { t: maintenant, v: 0 }];

    const vitesseMax = Math.max(1, ...points.map((p) => p.v)) * 1.25;

    const coords = points.map((p) => {
        const x = Math.max(0, Math.min(largeur, largeur - ((maintenant - p.t) / fenetre) * largeur));
        const y = basY - (p.v / vitesseMax) * (basY - hautY);
        return [x, y];
    });

    const cheminLigne = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
    const dernier = coords[coords.length - 1];
    const premier = coords[0];
    const cheminAire = `${cheminLigne} L${dernier[0].toFixed(1)},${basY} L${premier[0].toFixed(1)},${basY} Z`;

    svgLigne.setAttribute('d', cheminLigne);
    svgAire.setAttribute('d', cheminAire);

    const vitesseActuelle = points[points.length - 1].v;
    const vitessePic = Math.max(0, ...points.map((p) => p.v));
    const nbActifs = Object.keys(telechargementsActifsUI).length;
    const octetsEnCours = Object.values(telechargementsActifsUI)
        .reduce((total, dl) => total + (parseFloat(dl.actuel) || 0), 0);

    const currentEl = document.getElementById('chartCurrentSpeed');
    if (currentEl) currentEl.textContent = vitesseActuelle > 0.01 ? `${vitesseActuelle.toFixed(1)} MB/s` : t('downloads.idle');

    const peakEl = document.getElementById('chartPeakSpeed');
    if (peakEl) peakEl.textContent = `${vitessePic.toFixed(1)} MB/s`;

    const activeCountEl = document.getElementById('chartActiveCount');
    if (activeCountEl) activeCountEl.textContent = nbActifs;

    const inProgressEl = document.getElementById('chartInProgress');
    if (inProgressEl) inProgressEl.textContent = `${octetsEnCours.toFixed(1)} MB`;
}

const DEFINITIONS_BADGES = [
    { id: 'first_install', icon: '🎮', nameKey: 'badges.firstInstall.name', descKey: 'badges.firstInstall.desc', condition: (ctx) => ctx.nbInstalles >= 1 },
    { id: 'collector', icon: '📚', nameKey: 'badges.collector.name', descKey: 'badges.collector.desc', condition: (ctx) => ctx.nbInstalles >= 5 },
    { id: 'librarian', icon: '🏛️', nameKey: 'badges.librarian.name', descKey: 'badges.librarian.desc', condition: (ctx) => ctx.nbInstalles >= 15 },
    { id: 'first_hour', icon: '⏱️', nameKey: 'badges.firstHour.name', descKey: 'badges.firstHour.desc', condition: (ctx) => ctx.totalSecondes >= 3600 },
    { id: 'marathon', icon: '🔥', nameKey: 'badges.marathon.name', descKey: 'badges.marathon.desc', condition: (ctx) => ctx.totalSecondes >= 36000 },
    { id: 'legend', icon: '👑', nameKey: 'badges.legend.name', descKey: 'badges.legend.desc', condition: (ctx) => ctx.totalSecondes >= 360000 },
    { id: 'explorer', icon: '🧭', nameKey: 'badges.explorer.name', descKey: 'badges.explorer.desc', condition: (ctx) => ctx.jeuxJoues >= 5 },
    { id: 'devoted', icon: '💎', nameKey: 'badges.devoted.name', descKey: 'badges.devoted.desc', condition: (ctx) => ctx.maxJeuSecondes >= 36000 }
];

function renderBadges(totalSecondes) {
    const grille = document.getElementById('statsBadgesGrid');
    if (!grille) return;

    const valeursJeux = Object.values(tempsJeuGlobal).map((jeu) => jeu?.tempsDeJeu || 0);

    const contexte = {
        totalSecondes,
        nbInstalles: nomsInstalleGlobal.length,
        jeuxJoues: valeursJeux.filter((secondes) => secondes > 0).length,
        maxJeuSecondes: valeursJeux.reduce((max, secondes) => Math.max(max, secondes), 0)
    };

    grille.innerHTML = DEFINITIONS_BADGES.map((badge) => {
        const debloque = badge.condition(contexte);
        return `
            <div class="stats-badge ${debloque ? 'is-unlocked' : ''}" title="${t(badge.descKey)}">
                <span class="stats-badge-icon">${badge.icon}</span>
                <span class="stats-badge-name">${t(badge.nameKey)}</span>
            </div>
        `;
    }).join('');
}

function renderStatsPage() {
    const totalSecondes = Object.values(tempsJeuGlobal).reduce((total, jeu) => total + (jeu?.tempsDeJeu || 0), 0);

    const totalTimeEl = document.getElementById('statsTotalTime');
    if (totalTimeEl) totalTimeEl.textContent = formaterTempsCarte(totalSecondes);

    const installedCountEl = document.getElementById('statsInstalledCount');
    if (installedCountEl) installedCountEl.textContent = nomsInstalleGlobal.length;

    const catalogCountEl = document.getElementById('statsCatalogCount');
    if (catalogCountEl) catalogCountEl.textContent = catalogueGames.length;

    renderBadges(totalSecondes);

    const classement = catalogueGames
        .map((gameData) => {
            return {
                gameData,
                tempsDeJeu: tempsJeuPour(gameData.gameName)?.tempsDeJeu || 0
            };
        })
        .filter((entree) => entree.tempsDeJeu > 0)
        .sort((a, b) => b.tempsDeJeu - a.tempsDeJeu)
        .slice(0, 8);

    const listeEl = document.getElementById('statsLeaderboard');
    if (!listeEl) return;

    if (!classement.length) {
        listeEl.innerHTML = `
            <div class="stats-empty">
                <strong>No playtime yet</strong>
                <span>Launch a game from your library to start tracking stats.</span>
            </div>
        `;
        return;
    }

    const tempsMax = classement[0].tempsDeJeu;

    listeEl.innerHTML = classement.map((entree, index) => `
        <div class="stats-rank-row">
            <span class="stats-rank-num">${index + 1}</span>
            <div class="stats-rank-thumb" style="background-image:url('${String(entree.gameData.imageLink || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');"></div>
            <div class="stats-rank-info">
                <span class="stats-rank-name">${echapperHtml(nomJeuAffiche(entree.gameData.gameName))}</span>
                <div class="stats-rank-bar"><span class="stats-rank-bar-fill" style="width:${(entree.tempsDeJeu / tempsMax) * 100}%;"></span></div>
            </div>
            <span class="stats-rank-time">${formaterTempsCarte(entree.tempsDeJeu)}</span>
        </div>
    `).join('');
}

document.addEventListener('keydown', (event) => {
    const searchInput = document.getElementById('search');
    if (!searchInput || event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;

    event.preventDefault();
    searchInput.focus();
    searchInput.select();
});




async function downloadgame(nomDuJeu, name, element = null) {
    window.api.envoyerMessage(nomDuJeu, name);
    element.style.scale = 0;
    



        
        
}

async function finalDownload(nomDuJeu, name, element){
    try {
        window.api.envoyerMessage(nomDuJeu, name);
    } catch (error) {
        console.error("Erreur lors de la communication :", error);
    }
}

function formaterTemps(secondes) {
    const jours = Math.floor(secondes / (3600 * 24));
    const heures = Math.floor((secondes % (3600 * 24)) / 3600);
    const minutes = Math.floor((secondes % 3600) / 60);

    let resultat = [];

    if (jours > 0) resultat.push(`${jours}j`);
    if (heures > 0) resultat.push(`${heures}h`);
    if (minutes > 0) resultat.push(`${minutes}min`);

    return resultat.length > 0 ? resultat.join(' ') : "0min";
}

function couperTexte(texte) {
    if (texte.length > 30) {
        return texte.substring(0, 30) + "...";
    }
    return texte;
}


async function updateData(nomDuJeu, name){
    try {
        const data = await window.api.getGameData(nomDuJeu, normaliserNomJeu(name));
        

        if (data && data.success) {
            document.getElementById('copyID').onclick = function() {
                copygamename(`${normaliserNomJeu(name)}`)
            }
            document.getElementById('game-size').innerHTML = data.gameSize || "/.";
            document.getElementById('game-version').innerHTML = couperTexte(data.version) || "/.";
            document.getElementById('game-server').innerHTML = couperTexte(data.servers.join(", ")) || "/.";
            document.getElementById('pv').style.backgroundImage = `url('${data.mainImage}')` || "";
            document.getElementById('pv1').style.backgroundImage = `url('${data.previews[0]}')` || "";
            document.getElementById('pv2').style.backgroundImage = `url('${data.previews[1]}')` || "";
            document.getElementById('game-id').innerHTML = couperTexte(normaliserNomJeu(name));
            document.getElementById('game-time').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock8-icon lucide-clock-8"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l-4 2"/></svg>${formaterTemps(data.playTime)}`
        } else {
            console.error("Le scraping a échoué :", data.error);
        }
    } catch (err) {
        console.error("Erreur updateData :", err);
    }
}

async function copygamename(id) {
    await window.api.copyID(id);
    document.getElementById('copyID').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>`
    setTimeout(()=>{
        document.getElementById('copyID').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy-icon lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
    },1000)
}

function gameSelected(url, name, game) { 
    document.querySelectorAll('.game-inner-box.is-selected').forEach((card) => {
        card.classList.remove('is-selected');
    });
    if (game && game.closest('.game-inner-box')) {
        game.closest('.game-inner-box').classList.add('is-selected');
    }

    document.getElementById('uninstallbtn').onclick = function() {
        uninstall(normaliserNomJeu(name))
    }
    document.getElementById('startbtn').onclick = function() {
        window.api.startGame(normaliserNomJeu(name));
    }
    document.getElementById('stopdownloadbtn').onclick = function() {
        closegame()
        window.api.stopDownload(normaliserNomJeu(name));
    }
    document.getElementById('downloadbtn').onclick = function() {
        const gameName = normaliserNomJeu(name)
        closegame()
        window.api.envoyerMessage(document.getElementById(gameName).dataset.gameurl, gameName);
    }
    if ( document.getElementById(normaliserNomJeu(name)).getAttribute('name') == "downloaded" ) {
        document.getElementById('uninstallbtn').style.display = "inline-flex"
        document.getElementById('startbtn').style.display = "inline-flex"
        document.getElementById('downloadbtn').style.display = "none"
        document.getElementById('stopdownloadbtn').style.display = "none"
    } else if ( document.getElementById(normaliserNomJeu(name)).getAttribute('name') == "downloading" ) {
        document.getElementById('uninstallbtn').style.display = "none"
        document.getElementById('startbtn').style.display = "none"
        document.getElementById('downloadbtn').style.display = "none"
        document.getElementById('stopdownloadbtn').style.display = "inline-flex"
    } else {
        document.getElementById('uninstallbtn').style.display = "none"
        document.getElementById('startbtn').style.display = "none"
        document.getElementById('downloadbtn').style.display = "inline-flex"
        document.getElementById('stopdownloadbtn').style.display = "none"
    }
    document.getElementById('game-info').style.pointerEvents = "all";
            document.getElementById('game-info').style.opacity = 1;
    updateData(url, name)
} 

function closegame(){
    document.querySelectorAll('.game-inner-box.is-selected').forEach((card) => {
        card.classList.remove('is-selected');
    });
    document.getElementById('game-info').style.opacity = 0;
    setTimeout(()=>{
        document.getElementById('game-size').innerHTML = "/.";
        document.getElementById('game-version').innerHTML = "/.";
        document.getElementById('game-server').innerHTML = "/.";
        document.getElementById('pv').style.backgroundImage = "";
        document.getElementById('pv1').style.backgroundImage = "";
        document.getElementById('pv2').style.backgroundImage = "";
        document.getElementById('game-id').innerHTML = "";
        document.getElementById('game-info').style.pointerEvents = "none";
    },400)
}


async function uninstall(nomDuJeu, element = null) {
    window.api.uninstallGame(nomDuJeu);
    closegame()
    element.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="loadingsvg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-circle-icon lucide-loader-circle"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
}

async function play(nomDuJeu, element) {
    const gameData = catalogueGames.find((g) => normaliserNomJeu(g.gameName) === nomDuJeu);
    window.api.startGame(nomDuJeu, {
        displayName: gameData ? nomJeuAffiche(gameData.gameName) : nomDuJeu,
        imageUrl: gameData ? gameData.imageLink : ''
    });
}

async function stopGame(nomDuJeu) {
    window.api.stopGame(nomDuJeu);
}

async function stopDownload(nomDuJeu, element) {
    window.api.stopDownload(nomDuJeu);
}

function openkofi(url) {
    if (window.electronAPI && window.electronAPI.openExternalLink) {
        window.electronAPI.openExternalLink(url);
    }
}





window.electronAPI.onDownloadProgress((data) => {
    const carteImage = document.getElementById(data.name);
    if (carteImage) {
        carteImage.style.setProperty('--chargement-pourcent', 100 - parseFloat(data.pourcentage) + '%');
    }

    mettreAJourTelechargementUI(data);
});

window.electronAPI.downloadstart((message) => {
    loadCatalogue()
});

function afficherToast({ title, desc, duree = 6000 }) {
    const conteneur = document.getElementById('toast-container');
    if (!conteneur) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <div class="toast-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div class="toast-body">
            <div class="toast-title">${title}</div>
            <div class="toast-desc">${desc}</div>
        </div>
        <button class="toast-close" aria-label="Fermer">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
    `;

    const retirerToast = () => {
        if (!toast.isConnected) return;
        toast.classList.add('is-leaving');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    toast.querySelector('.toast-close').addEventListener('click', retirerToast);
    conteneur.appendChild(toast);
    setTimeout(retirerToast, duree);
}

if (window.electronAPI.onNoServerFound) {
    window.electronAPI.onNoServerFound((data) => {
        afficherToast({
            title: t('toast.noServer.title'),
            desc: data && data.nomJeu
                ? t('toast.noServer.desc', { game: data.nomJeu })
                : t('toast.noServer.descGeneric')
        });
        // Recharge la bibliothèque pour que l'affichage (installé/en
        // téléchargement/non installé) reflète bien l'état réel après l'échec.
        loadCatalogue();
    });
}

window.electronAPI.onGameStatus((event, data) => {
    const carte = document.getElementById(data.nomJeu);
    const boutonPlay = carte ? carte.querySelector('[data-role="play"]') : null;

    if (data.status === 'running') {
        document.getElementById(`${data.nomJeu}_ingame`).style.display = "block";
        document.getElementById(`${data.nomJeu}_ingame_scale`).style.scale = "0.98";
        if (boutonPlay) {
            boutonPlay.innerHTML = ICONE_STOP;
            boutonPlay.onclick = (e) => { e.stopPropagation(); stopGame(data.nomJeu); };
        }
    }
    else if (data.status === 'stopped') {
        document.getElementById(`${data.nomJeu}_ingame`).style.display = "none";
        document.getElementById(`${data.nomJeu}_ingame_scale`).style.scale = "";
        if (boutonPlay) {
            boutonPlay.innerHTML = ICONE_PLAY;
            boutonPlay.onclick = (e) => { e.stopPropagation(); play(data.nomJeu, boutonPlay); };
        }
    }
});

window.electronAPI.onUpdateAvailable(() => {
    alert(t('alert.updateAvailable'));
});

window.electronAPI.onUpdateDownloaded(() => {
    if(confirm(t('confirm.updateReady'))) {
        window.electronAPI.restartApp();
    }
});

function updateGame(element) {
    document.getElementById('update-content').classList.remove('hidden');
    document.getElementById('catalogue-container').style.opacity = "0";
    document.getElementById('catalogue-container').style.scale = "0.95";
    document.getElementById('search-wrap').style.opacity = "0";
    document.getElementById('search-wrap').style.scale = "0.95";
    setTimeout(()=>{document.getElementById('catalogue-container').style.pointerEvents = "none";},0)
    setTimeout(()=>{document.getElementById('catalogue-container').style.display = "none";},200)
    setTimeout(()=>{
        document.getElementById('update-content').style.opacity = "1";
        document.getElementById('update-content').style.scale = "1";
    },200)
    setTimeout(()=>{
        window.electronAPI.demarrerScraping();
    },1000)
}

window.electronAPI.onScrapingTermine(() => {
    document.getElementById('catalogue-container').style.display = "block";
    setTimeout(()=>{
        document.getElementById('update-content').style.opacity = "";
        document.getElementById('update-content').style.scale = "";
    },400)
    setTimeout(()=>{
        document.getElementById('catalogue-container').style.pointerEvents = "all";
        document.getElementById('catalogue-container').style.opacity = "";
        document.getElementById('catalogue-container').style.scale = "";
        document.getElementById('search-wrap').style.opacity = "";
        document.getElementById('search-wrap').style.scale = "";
    },1000)
});

const fileAttenteJeux = [];

window.electronAPI.onNouveauJeu((gameObj) => {
    if (Math.random() < 0.125) {
        fileAttenteJeux.push(gameObj);
    }
});

setInterval(() => {
    if (fileAttenteJeux.length > 0) {
        const prochainJeu = fileAttenteJeux.shift();
        propulserCarteJeu(prochainJeu);
    }
}, 10);


function propulserCarteJeu(gameObj) {
    const REGLAGES = {
        forceMonteeMin: 10,
        forceMonteeMax: 17,
        gravite: 0.14,

        vitesseGaucheDroiteMin: 0.3,
        vitesseGaucheDroiteMax: 2,

        angleInitialMax: 15,
        vitesseSpinMin: 0.15,
        vitesseSpinMax: 0.6
    };

    let overlay = document.getElementById('animation-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'animation-overlay';
        document.body.appendChild(overlay);
    }

    const card = document.createElement('div');
    card.className = 'confetti-game-card';
    card.style.backgroundImage = `url('${gameObj.data.imageLink}')`;

    const couleursGlow = ['#00f2fe', '#4facfe', '#ff007f', '#ff00ff', '#00ff87', '#f9d423'];
    const couleurAleatoire = couleursGlow[Math.floor(Math.random() * couleursGlow.length)];
    card.style.setProperty('--glow-color', couleurAleatoire);

    overlay.appendChild(card);

    const largeurEcran = window.innerWidth;
    const hauteurEcran = window.innerHeight;

    let x = (largeurEcran / 2) - 65; 
    let y = hauteurEcran + 50; 

    const partADroite = Math.random() > 0.5;

    
    let vitesseX = (Math.random() * (REGLAGES.vitesseGaucheDroiteMax - REGLAGES.vitesseGaucheDroiteMin) + REGLAGES.vitesseGaucheDroiteMin) * (partADroite ? 1 : -1);

    let vitesseY = -(Math.random() * (REGLAGES.forceMonteeMax - REGLAGES.forceMonteeMin) + REGLAGES.forceMonteeMin); 

    let angleRotation = (Math.random() * REGLAGES.angleInitialMax) * (partADroite ? 1 : -1); 
    let vitesseRotation = (Math.random() * (REGLAGES.vitesseSpinMax - REGLAGES.vitesseSpinMin) + REGLAGES.vitesseSpinMin) * (partADroite ? 1 : -1); 

    let aQuitteLeBas = false;

    function loop() {
        x += vitesseX;
        vitesseY += REGLAGES.gravite;
        y += vitesseY;
        angleRotation += vitesseRotation;

        card.style.transform = `translate(${x}px, ${y}px) rotate(${angleRotation}deg)`;

        if (y < hauteurEcran) {
            aQuitteLeBas = true;
        }

        if (aQuitteLeBas && y > hauteurEcran + 250) {
            card.remove(); 
        } else {
            requestAnimationFrame(loop); 
        }
    }

    requestAnimationFrame(loop);
}

window.electronAPI.onProgression((pourcentage) => {
    console.log(`📊 Progression : ${pourcentage}%`);
    const textePourcent = document.getElementById('loadingpourcentage')
    if (textePourcent) {
        textePourcent.innerText = `${pourcentage}%`;
    }
});


async function exporterBibliotheque() {
    const bouton = document.getElementById('exportLibraryBtn');
    if (!window.api || !window.api.exporterBibliotheque) return;

    if (bouton) bouton.disabled = true;
    const resultat = await window.api.exporterBibliotheque();

    if (resultat.status === 'success') {
        afficherToast({ title: t('toast.backup.exportTitle'), desc: t('toast.backup.exportDesc') });
    } else if (resultat.status === 'error') {
        afficherToast({ title: t('toast.backup.exportFailTitle'), desc: resultat.message });
    }

    if (bouton) bouton.disabled = false;
}

document.addEventListener('input', (event) => {
    if (event.target && event.target.id === 'supportDescription') {
        const compteur = document.getElementById('supportCharCount');
        if (compteur) compteur.textContent = `${event.target.value.length} / 1500`;
    }
});

async function envoyerSupportMessage() {
    const bouton = document.getElementById('supportSendBtn');
    const titreInput = document.getElementById('supportTitle');
    const descriptionInput = document.getElementById('supportDescription');
    const categorieSelect = document.getElementById('supportCategory');

    if (!titreInput || !descriptionInput || !categorieSelect || !window.api || !window.api.envoyerSupport) return;

    const titre = titreInput.value.trim();
    const description = descriptionInput.value.trim();

    if (!titre || !description) {
        afficherToast({ title: t('toast.support.missingFieldsTitle'), desc: t('toast.support.missingFieldsDesc') });
        return;
    }

    bouton.disabled = true;
    const texteOriginalBouton = bouton.textContent;
    bouton.textContent = t('support.sending');

    const resultat = await window.api.envoyerSupport({
        title: titre,
        description,
        category: categorieSelect.value
    });

    if (resultat.status === 'success') {
        afficherToast({ title: t('toast.support.successTitle'), desc: t('toast.support.successDesc') });
        titreInput.value = '';
        descriptionInput.value = '';
        const compteur = document.getElementById('supportCharCount');
        if (compteur) compteur.textContent = '0 / 1500';
    } else if (resultat.status === 'rate_limited') {
        afficherToast({ title: t('toast.support.rateLimitedTitle'), desc: t('toast.support.rateLimitedDesc') });
    } else {
        afficherToast({ title: t('toast.support.failTitle'), desc: t('toast.support.failDesc') });
    }

    bouton.disabled = false;
    bouton.textContent = texteOriginalBouton;
}


async function importerBibliotheque() {
    const bouton = document.getElementById('importLibraryBtn');
    if (!window.api || !window.api.importerBibliotheque) return;

    if (bouton) bouton.disabled = true;
    const resultat = await window.api.importerBibliotheque();

    if (resultat.status === 'success') {
        afficherToast({ title: t('toast.backup.importTitle'), desc: t('toast.backup.importDesc') });
        await chargerParametresUI();
        await loadCatalogue();
    } else if (resultat.status === 'error') {
        const description = resultat.message === 'invalidFile' ? t('toast.backup.invalidFile') : resultat.message;
        afficherToast({ title: t('toast.backup.importFailTitle'), desc: description });
    }

    if (bouton) bouton.disabled = false;
}

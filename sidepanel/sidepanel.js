// Side panel: VertiTab-style grouped vertical tabs with two view modes
// (compact list / favicon gallery card grid). Domain grouping reuses
// shared.js; tab actions go through the existing service-worker messages.

import { extractDomain, getDisplayName, isInternalUrl, domainHash } from '../shared.js';

const VIEW_KEY = 'sidepanelView';
const CUSTOM_SITES_KEY = 'customSites';
const APPEARANCE_KEY = 'sidepanelAppearance';

const DEFAULT_APPEARANCE = {
  theme: 'sage',            // 'sage' | 'light' | 'dark'
  density: 'cozy',          // 'cozy' | 'compact'
  accent: 'amber',          // amber/blue/green/rose/purple
  showQuickLinks: true,
  galleryColumns: 3,        // 2 | 3 | 4
  iconSize: 'medium',       // 'small' | 'medium' | 'large'
  iconShape: 'rounded',     // 'circle' | 'rounded' | 'square'
  titleSize: 'medium',      // 'small' | 'medium' | 'large'
  titleWeight: '500',       // '400' | '500' | '600'
  titleLines: 1,            // 1 | 2
  subtitle: 'muted',        // 'hidden' | 'muted'
};

const ACCENT_VALUES = {
  amber: '#c8713a',
  blue: '#4a6b9a',
  green: '#5a7a62',
  rose: '#b35a5a',
  purple: '#8a6a9a',
};

const ICON_SIZE_PX = { small: 12, medium: 16, large: 20 };
const TITLE_SIZE_PX = { small: 12, medium: 13, large: 14 };

const CARD_ACCENT_COLORS = [
  '#4285f4', '#ea4335', '#f5b400', '#34a853',
  '#e91e8f', '#a142f4', '#24c1e0', '#fa7b17',
];

function domainColorIndex(domain) {
  const hash = domainHash(domain);
  return ((hash % CARD_ACCENT_COLORS.length) + CARD_ACCENT_COLORS.length) % CARD_ACCENT_COLORS.length;
}

function extractPath(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const query = u.search ? u.search.slice(0, 30) : '';
    const full = path + query;
    return full.length > 48 ? full.slice(0, 48) + '…' : full;
  } catch {
    return '';
  }
}

// Short title for the primary label; the rest becomes muted description
function shortenTitle(title) {
  const t = (title || '').trim();
  if (t.length <= 28) return t;
  return t.slice(0, 28).trimEnd() + '…';
}

function getShortName(url) {
  try {
    const host = new URL(url).hostname;
    const parts = host.replace(/^www\./, '').split('.');
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  } catch {
    return url;
  }
}

// "just now" / "5 min ago" / "2 h ago" — like VertiTab's row subtitle
function relativeTime(lastAccessed) {
  if (!lastAccessed) return '';
  const diff = Date.now() - lastAccessed;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

function groupTabsByDomain(tabs) {
  const groups = new Map();
  for (const tab of tabs) {
    const domain = extractDomain(tab.url);
    const existing = groups.get(domain);
    if (existing) existing.push(tab);
    else groups.set(domain, [tab]);
  }
  // Keep the browser's window order — stable across tab switches
  return Array.from(groups.entries())
    .map(([domain, domainTabs]) => ({
      domain,
      displayName: getDisplayName(domain),
      favicon: domainTabs[0].favIconUrl || '',
      colorIndex: domainColorIndex(domain),
      // In-window position within each group
      tabs: domainTabs.sort((a, b) => a.index - b.index),
    }))
    .sort((a, b) => a.tabs[0].index - b.tabs[0].index);
}

function showToast(text) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = text;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

class PanelApp {
  constructor() {
    this.listEl = document.getElementById('domainList');
    this.emptyEl = document.getElementById('emptyState');
    this.searchEl = document.getElementById('searchInput');
    this.quickLinksEl = document.getElementById('quickLinks');
    this.allTabs = [];
    this.refreshTimer = null;
    this.view = 'list';          // 'list' | 'gallery'
    this.query = '';             // search filter
    this.sites = [];             // quick links (shared with dashboard)
    this.expanded = new Set();   // manually expanded domains survive refreshes

    this.listViewBtn = document.getElementById('btnListView');
    this.galleryViewBtn = document.getElementById('btnGalleryView');
    this.dedupeBtn = document.getElementById('btnCloseDups');

    this.listViewBtn.addEventListener('click', () => this.setView('list'));
    this.galleryViewBtn.addEventListener('click', () => this.setView('gallery'));
    this.dedupeBtn.addEventListener('click', () => this.closeDuplicates());
    this.searchEl.addEventListener('input', () => {
      this.query = this.searchEl.value.trim().toLowerCase();
      this.render();
    });
    this.setupNavButtons();
    this.setupSiteModal();
    this.setupSettings();
    this.setupBottomBar();
    this.setupQuickAccessToggle();

    this.loadView();
    this.loadAppearance();
    this.loadQuickLinks();
    this.init();
  }

  setupQuickAccessToggle() {
    const section = document.getElementById('qaSection');
    const chevron = document.getElementById('qaChevron');
    document.getElementById('qaHeader').addEventListener('click', () => {
      const collapsed = section.classList.toggle('collapsed');
      chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    });
    // Window section headers are created dynamically in render()
  }

  setupBottomBar() {
    document.getElementById('bbSettings').addEventListener('click', () => {
      document.getElementById('settingsOverlay').hidden = false;
    });
    document.getElementById('bbDedupe').addEventListener('click', () => this.closeDuplicates());
  }

  async loadAppearance() {
    try {
      const result = await chrome.storage.local.get(APPEARANCE_KEY);
      this.appearance = { ...DEFAULT_APPEARANCE, ...(result[APPEARANCE_KEY] || {}) };
    } catch (_) {
      this.appearance = { ...DEFAULT_APPEARANCE };
    }
    this.applyAppearance();
  }

  applyAppearance() {
    const a = this.appearance;
    const root = document.documentElement;
    root.dataset.theme = a.theme;
    root.dataset.density = a.density;
    root.dataset.galleryColumns = String(a.galleryColumns);
    root.dataset.iconSize = a.iconSize;
    root.dataset.iconShape = a.iconShape;
    root.dataset.titleSize = a.titleSize;
    root.dataset.subtitle = a.subtitle;
    root.dataset.titleLines = String(a.titleLines);
    root.style.setProperty('--accent', ACCENT_VALUES[a.accent] || ACCENT_VALUES.amber);
    root.style.setProperty('--icon-size', `${ICON_SIZE_PX[a.iconSize] || 16}px`);
    root.style.setProperty('--title-size', `${TITLE_SIZE_PX[a.titleSize] || 13}px`);
    root.style.setProperty('--title-weight', a.titleWeight);
    document.getElementById('qaSection').hidden = !a.showQuickLinks;
    const segMap = {
      themeSeg: 'theme',
      densitySeg: 'density',
      columnsSeg: 'galleryColumns',
      iconSizeSeg: 'iconSize', iconShapeSeg: 'iconShape', titleSizeSeg: 'titleSize',
      titleWeightSeg: 'titleWeight', titleLinesSeg: 'titleLines', subtitleSeg: 'subtitle',
    };
    for (const [segId, key] of Object.entries(segMap)) {
      for (const btn of document.querySelectorAll(`#${segId} button`)) {
        btn.classList.toggle('active', btn.dataset.value === String(a[key]));
      }
    }
    for (const btn of document.querySelectorAll('#accentColors button')) {
      btn.classList.toggle('active', btn.dataset.value === a.accent);
    }
    document.getElementById('optQuickLinks').checked = a.showQuickLinks;
  }

  async saveAppearance(patch) {
    this.appearance = { ...this.appearance, ...patch };
    try {
      await chrome.storage.local.set({ [APPEARANCE_KEY]: this.appearance });
    } catch (_) {}
    this.applyAppearance();
    this.render();
  }

  setupSettings() {
    const overlay = document.getElementById('settingsOverlay');
    document.getElementById('btnSettings').addEventListener('click', () => {
      overlay.hidden = false;
    });
    document.getElementById('settingsClose').addEventListener('click', () => {
      overlay.hidden = true;
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') overlay.hidden = true;
    });

    document.getElementById('themeSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) this.saveAppearance({ theme: btn.dataset.value });
    });
    document.getElementById('densitySeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) this.saveAppearance({ density: btn.dataset.value });
    });
    document.getElementById('columnsSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) this.saveAppearance({ galleryColumns: Number(btn.dataset.value) });
    });
    document.getElementById('accentColors').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) this.saveAppearance({ accent: btn.dataset.value });
    });
    document.getElementById('iconSizeSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) this.saveAppearance({ iconSize: btn.dataset.value });
    });
    document.getElementById('iconShapeSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) this.saveAppearance({ iconShape: btn.dataset.value });
    });
    document.getElementById('titleSizeSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) this.saveAppearance({ titleSize: btn.dataset.value });
    });
    document.getElementById('titleWeightSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) this.saveAppearance({ titleWeight: btn.dataset.value });
    });
    document.getElementById('titleLinesSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) this.saveAppearance({ titleLines: Number(btn.dataset.value) });
    });
    document.getElementById('subtitleSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) this.saveAppearance({ subtitle: btn.dataset.value });
    });
    document.getElementById('optQuickLinks').addEventListener('change', (e) => {
      this.saveAppearance({ showQuickLinks: e.target.checked });
    });
  }

  setupNavButtons() {
    const activeTab = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab;
    };
    document.getElementById('btnBack').addEventListener('click', async () => {
      const tab = await activeTab();
      if (tab) chrome.tabs.goBack(tab.id).catch(() => {});
    });
    document.getElementById('btnForward').addEventListener('click', async () => {
      const tab = await activeTab();
      if (tab) chrome.tabs.goForward(tab.id).catch(() => {});
    });
    document.getElementById('btnReload').addEventListener('click', async () => {
      const tab = await activeTab();
      if (tab) chrome.tabs.reload(tab.id).catch(() => {});
    });
  }

  setupSiteModal() {
    this.overlay = document.getElementById('siteModalOverlay');
    this.urlInput = document.getElementById('siteModalUrl');
    document.getElementById('btnAddSite').addEventListener('click', () => {
      this.overlay.hidden = false;
      this.urlInput.value = '';
      this.urlInput.focus();
    });
    document.getElementById('siteModalCancel').addEventListener('click', () => {
      this.overlay.hidden = true;
    });
    document.getElementById('siteModalSave').addEventListener('click', () => this.saveSite());
    this.overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.overlay.hidden = true;
      if (e.key === 'Enter') this.saveSite();
    });
  }

  async saveSite() {
    let url = this.urlInput.value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const site = { id: Date.now().toString(36), name: getShortName(url), url };
    if (this.sites.some(s => s.url === site.url)) {
      showToast('Already in Quick Links');
      this.overlay.hidden = true;
      return;
    }
    this.sites = [...this.sites, site];
    try {
      await chrome.storage.local.set({ [CUSTOM_SITES_KEY]: this.sites });
    } catch (_) {}
    this.renderQuickLinks();
    this.overlay.hidden = true;
    showToast(`Added ${site.name}`);
  }

  async loadQuickLinks() {
    try {
      const result = await chrome.storage.local.get(CUSTOM_SITES_KEY);
      this.sites = result[CUSTOM_SITES_KEY] || [];
    } catch (_) {
      this.sites = [];
    }
    this.renderQuickLinks();

    // Keep in sync with the dashboard's Quick Links editor
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[CUSTOM_SITES_KEY]) {
        this.sites = changes[CUSTOM_SITES_KEY].newValue || [];
        this.renderQuickLinks();
      }
    });
  }

  renderQuickLinks() {
    this.quickLinksEl.innerHTML = '';
    for (const site of this.sites.slice(0, 12)) {
      const link = document.createElement('button');
      link.className = 'quick-link';
      link.title = site.name;
      const favicon = document.createElement('img');
      favicon.className = 'quick-link__img';
      favicon.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(site.url)}&size=64`;
      favicon.alt = '';
      favicon.onerror = () => { favicon.style.visibility = 'hidden'; };
      link.addEventListener('click', () => {
        chrome.tabs.create({ url: site.url });
      });
      link.appendChild(favicon);
      this.quickLinksEl.appendChild(link);
    }
  }

  async loadView() {
    try {
      const result = await chrome.storage.local.get(VIEW_KEY);
      if (result[VIEW_KEY] === 'gallery' || result[VIEW_KEY] === 'list') {
        this.view = result[VIEW_KEY];
      }
    } catch (_) {}
    this.applyViewButtons();
  }

  async setView(view) {
    this.view = view;
    this.applyViewButtons();
    try {
      await chrome.storage.local.set({ [VIEW_KEY]: view });
    } catch (_) {}
    this.render();
  }

  applyViewButtons() {
    this.listViewBtn.classList.toggle('active', this.view === 'list');
    this.galleryViewBtn.classList.toggle('active', this.view === 'gallery');
    this.listEl.classList.toggle('gallery-mode', this.view === 'gallery');
  }

  async init() {
    await this.refreshNow();
    chrome.tabs.onRemoved.addListener(() => this.refresh());
    chrome.tabs.onCreated.addListener(() => this.refresh());
    chrome.tabs.onActivated.addListener(() => this.refresh());
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
      if (changeInfo.title || changeInfo.url || changeInfo.favIconUrl) this.refresh();
    });
    // Native group collapse changes (from the browser tab strip) flow back in
    if (chrome.tabGroups?.onUpdated) {
      chrome.tabGroups.onUpdated.addListener((group) => {
        if ('collapsed' in group) this.refresh();
      });
    }
  }

  async refreshNow() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_TABS' });
      this.allTabs = (response || []).filter(tab => !isInternalUrl(tab.url));
    } catch (_) {
      this.allTabs = [];
    }
    try {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.activeTabId = active ? active.id : null;
      this.activeWindowId = active ? active.windowId : null;
    } catch (_) {
      this.activeTabId = null;
      this.activeWindowId = null;
    }
    // Window ordering: active window first, then by window creation id
    try {
      const wins = await chrome.windows.getAll();
      this.windowOrder = wins
        .sort((a, b) => (a.id === this.activeWindowId ? -1 : b.id === this.activeWindowId ? 1 : a.id - b.id))
        .map(w => w.id);
    } catch (_) {
      this.windowOrder = this.activeWindowId ? [this.activeWindowId] : [];
    }
    // Native tab groups, for expand/collapse two-way sync
    try {
      this.nativeGroups = await chrome.tabGroups.query({});
    } catch (_) {
      this.nativeGroups = [];
    }
    this.render();
  }

  refresh() {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.refreshNow();
    }, 200);
  }

  closeDuplicates() {
    const seen = new Set();
    const dupeIds = [];
    for (const tab of this.allTabs) {
      if (seen.has(tab.url)) dupeIds.push(tab.id);
      else seen.set(tab.url, tab.id);
    }
    if (dupeIds.length === 0) {
      showToast('No duplicate tabs');
      return;
    }
    for (const id of dupeIds) {
      chrome.runtime.sendMessage({ type: 'CLOSE_TAB', tabId: id });
    }
    showToast(`Closed ${dupeIds.length} duplicate${dupeIds.length > 1 ? 's' : ''}`);
  }

  render() {
    const tabs = this.query
      ? this.allTabs.filter(tab =>
          (tab.title || '').toLowerCase().includes(this.query) ||
          tab.url.toLowerCase().includes(this.query))
      : this.allTabs;
    const total = tabs.length;
    // Duplicate badge: number of redundant tabs Dedupe would close
    const seenUrls = new Set();
    let dupeCount = 0;
    for (const tab of this.allTabs) {
      if (seenUrls.has(tab.url)) dupeCount++;
      else seenUrls.add(tab.url);
    }
    const badge = document.getElementById('dupeBadge');
    if (badge) {
      badge.hidden = dupeCount === 0;
      badge.textContent = String(dupeCount);
    }
    this.listEl.innerHTML = '';

    if (total === 0) {
      this.emptyEl.hidden = false;
      return;
    }
    this.emptyEl.hidden = true;

    // One section per window, active window first ("Current Window")
    const byWindow = new Map();
    for (const tab of tabs) {
      const list = byWindow.get(tab.windowId);
      if (list) list.push(tab);
      else byWindow.set(tab.windowId, [tab]);
    }
    const windowIds = [...byWindow.keys()].sort((a, b) => {
      const ia = this.windowOrder.indexOf(a), ib = this.windowOrder.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    windowIds.forEach((windowId, winIdx) => {
      const winTabs = byWindow.get(windowId);
      const section = document.createElement('section');
      section.className = 'cw-section window-section';

      const header = document.createElement('div');
      header.className = 'section-header cw-header';
      const isCurrent = windowId === this.activeWindowId;
      const winLabel = isCurrent ? 'Current' : `Window ${winIdx + 1}`;

      const groups = groupTabsByDomain(winTabs);
      const groupCount = groups.filter(g => g.tabs.length > 1).length;
      const singleCount = groups.filter(g => g.tabs.length === 1).reduce((n, g) => n + g.tabs.length, 0);

      header.innerHTML = `
        <span class="section-chevron">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>
        </span>
        <svg class="section-icon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"/></svg>
        <span class="section-title">${winLabel}</span>
        <button class="win-switch-btn" title="Switch window">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 6.878V6a2.25 2.25 0 0 1 2.25-2.25h7.5A2.25 2.25 0 0 1 18 6v.878m2.25 4.622V18a2.25 2.25 0 0 1-2.25 2.25h-7.5A2.25 2.25 0 0 1 6 18v-6.5m12.75 0H5.25A2.25 2.25 0 0 0 3 13.5m18.75-2.25a2.25 2.25 0 0 0-2.25-2.25H5.25a2.25 2.25 0 0 0-2.25 2.25"/></svg>
        </button>
        <span class="section-stats">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"/></svg>
          <span>${groupCount}</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75"/></svg>
          <span>${singleCount}</span>
        </span>`;
      header.querySelector('.win-switch-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.showWindowSwitcher(e.currentTarget, windowId);
      });
      header.addEventListener('click', () => {
        const collapsed = section.classList.toggle('collapsed');
        header.querySelector('.section-chevron').style.transform = collapsed ? 'rotate(-90deg)' : '';
      });
      section.appendChild(header);

      const list = document.createElement('div');
      list.className = 'domain-list';
      for (const group of groups) {
        list.appendChild(this.createDomainItem(group, windowId));
      }
      section.appendChild(list);
      this.listEl.appendChild(section);
    });
  }

  // Window switcher popover: list windows, switch focus, close others' windows
  showWindowSwitcher(anchor, currentWindowId) {
    this.closeWindowSwitcher();
    const pop = document.createElement('div');
    pop.className = 'win-switcher';

    const wins = [...new Set(this.allTabs.map(t => t.windowId))]
      .sort((a, b) => {
        const ia = this.windowOrder.indexOf(a), ib = this.windowOrder.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });

    for (const windowId of wins) {
      const winTabs = this.allTabs.filter(t => t.windowId === windowId);
      const active = winTabs.find(t => t.id === this.activeTabId && windowId === this.activeWindowId);
      const summary = active ? active.title : (winTabs[0] ? winTabs[0].title : '');
      const isCurrent = windowId === currentWindowId;

      const item = document.createElement('button');
      item.className = 'win-switcher__item' + (isCurrent ? ' current' : '');
      item.innerHTML = `
        <span class="win-switcher__mark">${isCurrent
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>'
          : '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"/></svg>'}</span>
        <span class="win-switcher__text">
          <span class="win-switcher__name">Window ${this.windowOrder.indexOf(windowId) + 1}</span>
          <span class="win-switcher__sub">${escapeHtml(summary)}${winTabs.length > 1 ? ` and ${winTabs.length - 1} more tabs` : ''}</span>
        </span>`;
      item.addEventListener('click', () => {
        this.closeWindowSwitcher();
        if (!isCurrent) this.focusWindow(windowId);
      });

      // Close button for non-current windows
      const closeBtn = document.createElement('button');
      closeBtn.className = 'win-switcher__close';
      closeBtn.title = 'Close window';
      closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>`;
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeWindowSwitcher();
        chrome.windows.remove(windowId).catch(() => {});
      });
      item.appendChild(closeBtn);
      pop.appendChild(item);
    }

    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    pop.style.top = `${rect.bottom + 6}px`;
    pop.style.left = `${Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)}px`;

    setTimeout(() => {
      this.outsideCloseHandler = (e) => {
        if (!pop.contains(e.target)) this.closeWindowSwitcher();
      };
      document.addEventListener('click', this.outsideCloseHandler);
    }, 0);
    this.winSwitcherEl = pop;
  }

  closeWindowSwitcher() {
    if (this.winSwitcherEl) {
      this.winSwitcherEl.remove();
      this.winSwitcherEl = null;
      if (this.outsideCloseHandler) {
        document.removeEventListener('click', this.outsideCloseHandler);
        this.outsideCloseHandler = null;
      }
    }
  }

  async focusWindow(windowId) {
    try {
      const tabs = await chrome.tabs.query({ windowId, active: true });
      if (tabs[0]) {
        await chrome.tabs.update(tabs[0].id, { active: true });
      }
      await chrome.windows.update(windowId, { focused: true });
    } catch (_) {}
  }

  // Find the native group for a domain group in a given window
  // (SW names groups "Name (N)")
  findNativeGroup(displayName, windowId) {
    return (this.nativeGroups || []).find(g =>
      g.windowId === windowId
      && (g.title || '').replace(/\s*\(\d+\)$/, '') === displayName);
  }

  createDomainItem(group, windowId) {
    const item = document.createElement('div');
    item.className = 'domain-item';
    // Chrome-group-style rotating pill color
    item.style.setProperty('--pill-bg', `var(--pill-${(group.colorIndex % 8) + 1}-bg)`);
    item.style.setProperty('--pill-ink', `var(--pill-${(group.colorIndex % 8) + 1}-ink)`);

    const header = document.createElement('button');
    // Multi-tab domains get the Chrome-group pill; single-tab domains are a
    // plain row that switches directly.
    header.className = group.tabs.length > 1 ? 'domain-header pill' : 'domain-header';

    const favicon = document.createElement('img');
    favicon.className = 'domain-favicon';
    favicon.src = group.favicon;
    favicon.alt = '';
    favicon.onerror = () => { favicon.style.visibility = 'hidden'; };

    const name = document.createElement('span');
    name.className = 'domain-name';
    name.textContent = group.displayName;
    name.title = group.domain;

    const count = document.createElement('span');
    count.className = 'domain-count';
    count.textContent = `(${group.tabs.length})`;

    const countBadge = document.createElement('span');
    countBadge.className = 'domain-count-badge';
    countBadge.textContent = String(group.tabs.length);

    const closeAll = document.createElement('span');
    closeAll.className = 'domain-close';
    closeAll.title = `Close all ${group.displayName} tabs`;
    closeAll.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>`;
    closeAll.addEventListener('click', (e) => {
      e.stopPropagation();
      for (const tab of group.tabs) {
        chrome.runtime.sendMessage({ type: 'CLOSE_TAB', tabId: tab.id });
      }
      showToast(`Closed ${group.tabs.length} ${group.displayName} tab${group.tabs.length > 1 ? 's' : ''}`);
    });

    header.appendChild(favicon);
    header.appendChild(name);
    header.appendChild(count);
    header.appendChild(countBadge);
    header.appendChild(closeAll);

    const body = document.createElement('div');
    body.className = 'domain-body';

    // Pill + trailing mini-favicons on one row (VertiTab style)
    const headRow = document.createElement('div');
    headRow.className = 'domain-head-row';
    headRow.appendChild(header);
    if (group.tabs.length > 1) {
      const minis = document.createElement('span');
      minis.className = 'domain-minis';
      for (const tab of group.tabs.slice(0, 6)) {
        const img = document.createElement('img');
        img.className = 'domain-mini';
        img.src = tab.favIconUrl || '';
        img.alt = '';
        img.title = tab.title;
        img.onerror = () => { img.style.visibility = 'hidden'; };
        minis.appendChild(img);
      }
      headRow.appendChild(minis);
    }

    const isOpen = this.expanded.has(group.domain);

    if (group.tabs.length === 1) {
      // Single-tab domain switches directly, no chevron
      header.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          type: 'SWITCH_TO_TAB',
          tabId: group.tabs[0].id,
          windowId: group.tabs[0].windowId,
        });
      });
    } else {
      // Chevron leads the row (leftmost)
      const chevron = document.createElement('span');
      chevron.className = 'domain-chevron';
      chevron.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m9 18 6-6-6-6"/></svg>`;
      header.insertBefore(chevron, header.firstChild);
      // Expand state mirrors the native browser group when one exists;
      // otherwise falls back to the manual per-domain state.
      const native = this.findNativeGroup(group.displayName, windowId);
      const open = this.query ? true : (native ? !native.collapsed : isOpen);
      item.classList.toggle('open', open);
      header.addEventListener('click', () => {
        const nowOpen = item.classList.toggle('open');
        if (nowOpen) this.expanded.add(group.domain);
        else this.expanded.delete(group.domain);
        // Sync to the native tab strip group
        if (native) {
          chrome.tabGroups.update(native.id, { collapsed: !nowOpen }).catch(() => {});
        }
      });
      if (this.view === 'gallery') {
        const grid = document.createElement('div');
        grid.className = 'gallery-grid';
        for (const tab of group.tabs) {
          grid.appendChild(this.createGalleryCard(tab, group));
        }
        body.appendChild(grid);
      } else {
        for (const tab of group.tabs) {
          body.appendChild(this.createListRow(tab));
        }
      }
    }

    item.appendChild(headRow);
    item.appendChild(body);
    return item;
  }

  createListRow(tab) {
    const row = document.createElement('div');
    row.className = 'tab-row';
    row.title = tab.url;
    if (tab.id === this.activeTabId) row.classList.add('active');

    const favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.src = tab.favIconUrl || '';
    favicon.alt = '';
    favicon.onerror = () => { favicon.style.visibility = 'hidden'; };

    const num = document.createElement('span');
    num.className = 'tab-num';
    num.textContent = String((tab.index ?? 0) + 1);

    const main = document.createElement('div');
    main.className = 'tab-main';

    const title = document.createElement('div');
    title.className = 'tab-title';
    title.textContent = shortenTitle(tab.title) || tab.url;

    const sub = document.createElement('div');
    sub.className = 'tab-sub';
    const host = extractDomain(tab.url);
    const when = relativeTime(tab.lastAccessed);
    sub.textContent = when ? `${host} · ${when}` : host;

    main.appendChild(title);
    main.appendChild(sub);

    const actions = document.createElement('div');
    actions.className = 'tab-actions';

    // Reload
    const reload = document.createElement('button');
    reload.className = 'tab-action';
    reload.title = 'Reload tab';
    reload.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>`;
    reload.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.reload(tab.id).catch(() => {});
    });

    // Close
    const close = document.createElement('button');
    close.className = 'tab-action';
    close.title = 'Close tab';
    close.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>`;
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'CLOSE_TAB', tabId: tab.id });
    });

    actions.appendChild(reload);
    actions.appendChild(close);

    row.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'SWITCH_TO_TAB',
        tabId: tab.id,
        windowId: tab.windowId,
      });
    });

    row.appendChild(favicon);
    row.appendChild(num);
    row.appendChild(main);
    row.appendChild(actions);
    return row;
  }

  createGalleryCard(tab, group) {
    const card = document.createElement('button');
    card.className = 'gallery-card';
    card.title = tab.url;
    card.style.setProperty('--card-accent', CARD_ACCENT_COLORS[group.colorIndex]);

    const num = document.createElement('span');
    num.className = 'tab-num gallery-card__num';
    num.textContent = String((tab.index ?? 0) + 1);

    const favicon = document.createElement('img');
    favicon.className = 'gallery-card__favicon';
    favicon.src = tab.favIconUrl || '';
    favicon.alt = '';
    favicon.onerror = () => { favicon.style.visibility = 'hidden'; };

    const title = document.createElement('span');
    title.className = 'gallery-card__title';
    title.textContent = tab.title || tab.url;

    const path = extractPath(tab.url);
    const pathEl = document.createElement('span');
    pathEl.className = 'gallery-card__path';
    pathEl.textContent = path;

    const close = document.createElement('span');
    close.className = 'gallery-card__close';
    close.title = 'Close tab';
    close.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>`;
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'CLOSE_TAB', tabId: tab.id });
    });

    card.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'SWITCH_TO_TAB',
        tabId: tab.id,
        windowId: tab.windowId,
      });
    });

    card.appendChild(close);
    card.appendChild(num);
    card.appendChild(favicon);
    card.appendChild(title);
    if (path) card.appendChild(pathEl);
    return card;
  }
}

new PanelApp();

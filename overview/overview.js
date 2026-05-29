import { extractDomain, getDisplayName, domainHash } from '../shared.js';

const VISIBLE_TAB_LIMIT = 8;

const CARD_ACCENT_COLORS = [
  '#4285f4', '#ea4335', '#f5b400', '#34a853',
  '#e91e8f', '#a142f4', '#24c1e0', '#fa7b17',
];

function extractPath(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const query = u.search ? u.search.slice(0, 30) : '';
    const full = path + query;
    return full.length > 60 ? full.slice(0, 60) + '…' : full;
  } catch {
    return '';
  }
}

function domainColorIndex(domain) {
  const hash = domainHash(domain);
  return ((hash % CARD_ACCENT_COLORS.length) + CARD_ACCENT_COLORS.length) % CARD_ACCENT_COLORS.length;
}

function groupTabsByDomain(tabs) {
  const groups = new Map();
  for (const tab of tabs) {
    const domain = extractDomain(tab.url);
    const existing = groups.get(domain);
    if (existing) {
      existing.push(tab);
    } else {
      groups.set(domain, [tab]);
    }
  }
  return Array.from(groups.entries())
    .sort(([, a], [, b]) => b.length - a.length)
    .map(([domain, domainTabs]) => ({
      domain,
      displayName: getDisplayName(domain),
      favicon: domainTabs[0].favIconUrl || '',
      tabs: domainTabs,
      colorIndex: domainColorIndex(domain),
    }));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const QUOTES = [
  { en: 'Simplicity is the ultimate sophistication.', zh: '至繁归于至简。', author: 'Leonardo da Vinci' },
  { en: 'Stay hungry, stay foolish.', zh: '求知若饥，虚心若愚。', author: 'Steve Jobs' },
  { en: 'Less is more.', zh: '少即是多。', author: 'Mies van der Rohe' },
  { en: 'Talk is cheap. Show me the code.', zh: '废话少说，放码过来。', author: 'Linus Torvalds' },
  { en: 'The best way to predict the future is to invent it.', zh: '预测未来的最好方式就是去创造它。', author: 'Alan Kay' },
  { en: 'Make it work, make it right, make it fast.', zh: '先让它跑起来，再让它正确，最后让它快。', author: 'Kent Beck' },
];

function getDailyQuote() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  return QUOTES[dayOfYear % QUOTES.length];
}

function showToast(text) {
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toastText');
  toastText.textContent = text;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

// --- Tab Preview Popup ---

class TabPreview {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'tab-preview';
    document.body.appendChild(this.el);
    this.hideTimer = null;
    this.showTimer = null;
    this.currentTabId = null;
  }

  show(tab, rect) {
    if (this.currentTabId === tab.id) return;
    this.currentTabId = tab.id;

    clearTimeout(this.hideTimer);
    clearTimeout(this.showTimer);

    this.showTimer = setTimeout(() => {
      this.render(tab);
      this.position(rect);
      this.el.classList.add('tab-preview--visible');
    }, 300);
  }

  hide() {
    clearTimeout(this.showTimer);
    this.hideTimer = setTimeout(() => {
      this.el.classList.remove('tab-preview--visible');
      this.currentTabId = null;
    }, 80);
  }

  render(tab) {
    const domain = extractDomain(tab.url);
    const tags = [];
    if (tab.pinned) tags.push('<span class="tab-preview__tag tab-preview__tag--pinned">Pinned</span>');
    if (tab.audible) tags.push('<span class="tab-preview__tag tab-preview__tag--audible">Playing</span>');

    this.el.innerHTML = `
      <div class="tab-preview__header">
        <img class="tab-preview__favicon" src="${tab.favIconUrl || ''}" alt="" onerror="this.style.display='none'">
        <span class="tab-preview__domain">${escapeHtml(domain)}</span>
        ${tags.length ? '<div class="tab-preview__tags">' + tags.join('') + '</div>' : ''}
      </div>
      <div class="tab-preview__title">${escapeHtml(tab.title)}</div>
      <div class="tab-preview__url">${escapeHtml(tab.url)}</div>
    `;
  }

  position(rect) {
    const gap = 8;
    const el = this.el;
    el.style.left = '0';
    el.style.top = '0';
    el.style.visibility = 'hidden';
    el.style.display = 'block';

    const pw = el.offsetWidth;
    const ph = el.offsetHeight;

    let left = rect.right + gap;
    let top = rect.top;

    if (left + pw > window.innerWidth) {
      left = rect.left - pw - gap;
    }
    if (left < gap) {
      left = rect.left;
      top = rect.bottom + gap;
    }
    if (top + ph > window.innerHeight) {
      top = window.innerHeight - ph - gap;
    }
    if (top < gap) top = gap;

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = '';
    el.style.display = '';
  }
}

// --- Sidebar (Custom Quick Links with drag reorder) ---

function getShortName(url) {
  try {
    const host = new URL(url).hostname;
    const parts = host.replace(/^www\./, '').split('.');
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  } catch {
    return url;
  }
}

const CUSTOM_SITES_KEY = 'customSites';

class Sidebar {
  constructor() {
    this.listEl = document.getElementById('top-sites');
    this.sites = [];
    this.dragSrcIndex = null;
    this.editingId = null;
    this.setupModal();
    this.load();
  }

  async load() {
    try {
      const result = await chrome.storage.local.get(CUSTOM_SITES_KEY);
      this.sites = result[CUSTOM_SITES_KEY] || [];
    } catch (_) {
      this.sites = [];
    }
    this.render();
  }

  async save() {
    await chrome.storage.local.set({ [CUSTOM_SITES_KEY]: this.sites });
  }

  setupModal() {
    this.overlay = document.getElementById('siteModalOverlay');
    this.modalTitle = document.getElementById('siteModalTitle');
    this.urlInput = document.getElementById('siteModalUrl');

    document.getElementById('siteModalCancel').addEventListener('click', () => this.closeModal());
    document.getElementById('siteModalSave').addEventListener('click', () => this.handleSave());

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.closeModal();
    });

    this.overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeModal();
      if (e.key === 'Enter') this.handleSave();
    });
  }

  openModal(site = null) {
    this.editingId = site ? site.id : null;
    this.modalTitle.textContent = site ? 'Edit site' : 'Add site';
    this.urlInput.value = site ? site.url : '';
    this.overlay.hidden = false;
    this.urlInput.focus();
  }

  closeModal() {
    this.overlay.hidden = true;
    this.editingId = null;
    this.urlInput.value = '';
  }

  handleSave() {
    let url = this.urlInput.value.trim();
    if (!url) return;

    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    const name = getShortName(url);

    if (this.editingId) {
      this.sites = this.sites.map(s =>
        s.id === this.editingId ? { ...s, name, url } : s
      );
    } else {
      this.sites = [...this.sites, { id: Date.now().toString(36), name, url }];
    }

    this.save();
    this.render();
    this.closeModal();
    showToast(this.editingId ? 'Site updated' : 'Site added');
  }

  addSiteFromUrl(url) {
    const exists = this.sites.some(s => s.url === url);
    if (exists) {
      showToast('Already in Quick Links');
      return;
    }
    const name = getShortName(url);
    this.sites = [...this.sites, { id: Date.now().toString(36), name, url }];
    this.save();
    this.render();
    showToast(`Added ${name} to Quick Links`);
  }

  deleteSite(id) {
    this.sites = this.sites.filter(s => s.id !== id);
    this.save();
    this.render();
    showToast('Site removed');
  }

  render() {
    this.listEl.innerHTML = '';

    if (this.sites.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'top-sites__empty';
      empty.textContent = 'Add your first site';
      this.listEl.appendChild(empty);
    }

    this.sites.forEach((site, index) => {
      const faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(site.url)}&size=64`;

      const item = document.createElement('a');
      item.className = 'top-site-item';
      item.href = site.url;
      item.title = site.url;
      item.draggable = true;
      item.dataset.index = String(index);

      item.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: site.url });
      });

      // Drag events
      item.addEventListener('dragstart', (e) => {
        this.dragSrcIndex = index;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        this.listEl.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('drag-over');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const targetIndex = index;
        if (this.dragSrcIndex === null || this.dragSrcIndex === targetIndex) return;
        const moved = this.sites[this.dragSrcIndex];
        const updated = this.sites.filter((_, i) => i !== this.dragSrcIndex);
        updated.splice(targetIndex, 0, moved);
        this.sites = updated;
        this.dragSrcIndex = null;
        this.save();
        this.render();
      });

      // Favicon
      const favicon = document.createElement('img');
      favicon.className = 'top-site-item__favicon';
      favicon.src = faviconUrl;
      favicon.alt = '';
      favicon.onerror = () => {
        favicon.src = '';
        favicon.style.background = 'var(--warm-gray)';
      };

      // Name
      const nameEl = document.createElement('div');
      nameEl.className = 'top-site-item__name';
      nameEl.textContent = site.name;

      // Hover overlay (edit + delete)
      const overlay = document.createElement('div');
      overlay.className = 'top-site-item__overlay';

      const editBtn = document.createElement('button');
      editBtn.className = 'top-site-item__action';
      editBtn.title = 'Edit';
      editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z"/></svg>`;
      editBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openModal(site);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'top-site-item__action top-site-item__action--delete';
      deleteBtn.title = 'Delete';
      deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>`;
      deleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.deleteSite(site.id);
      });

      overlay.appendChild(editBtn);
      overlay.appendChild(deleteBtn);

      item.appendChild(favicon);
      item.appendChild(nameEl);
      item.appendChild(overlay);
      this.listEl.appendChild(item);
    });

    // Add button
    const addBtn = document.createElement('button');
    addBtn.className = 'top-site-add';
    addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>Add`;
    addBtn.addEventListener('click', () => this.openModal());
    this.listEl.appendChild(addBtn);
  }
}

// --- App ---

class OverviewApp {
  constructor() {
    this.container = document.getElementById('tabContainer');
    this.emptyState = document.getElementById('emptyState');
    this.countEl = document.getElementById('tabCount');
    this.statEl = document.getElementById('statTabs');
    this.allTabs = [];
    this.refreshTimer = null;
    this.preview = new TabPreview();
    this.sidebar = new Sidebar();

    document.getElementById('greeting').textContent = getGreeting();
    document.getElementById('dateDisplay').textContent = getDateDisplay();
    this.loadQuote();
    this.setupHeaderActions();
    this.init();
  }

  loadQuote() {
    const quote = getDailyQuote();
    const el = document.getElementById('headerQuote');
    el.textContent = `"${quote.en}" — ${quote.author}`;
  }

  setupHeaderActions() {
    const collapseBtn = document.getElementById('btnCollapseAll');
    const collapseLabelNode = collapseBtn.lastChild;
    collapseBtn.addEventListener('click', () => {
      const cards = this.container.querySelectorAll('.mission-card');
      const allCollapsed = [...cards].every(c => c.classList.contains('collapsed'));
      cards.forEach(c => c.classList.toggle('collapsed', !allCollapsed));
      collapseLabelNode.textContent = allCollapsed ? ' Collapse' : ' Expand';
      showToast(allCollapsed ? 'Expanded all cards' : 'Collapsed all cards');
    });

    document.getElementById('btnCloseDups').addEventListener('click', async () => {
      const seen = new Map();
      const dupeIds = [];
      for (const tab of this.allTabs) {
        if (seen.has(tab.url)) {
          dupeIds.push(tab.id);
        } else {
          seen.set(tab.url, tab.id);
        }
      }
      if (dupeIds.length === 0) {
        showToast('No duplicate tabs found');
        return;
      }
      for (const id of dupeIds) {
        await chrome.runtime.sendMessage({ type: 'CLOSE_TAB', tabId: id });
      }
      showToast(`Closed ${dupeIds.length} duplicate tab${dupeIds.length > 1 ? 's' : ''}`);
    });
  }

  async init() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_TABS' });
      this.allTabs = this.filterSelf(response || []);
      this.renderAndUpdate();
    } catch (err) {
      this.container.innerHTML = '';
    }
    this.listenForTabChanges();
  }

  filterSelf(tabs) {
    const selfUrl = chrome.runtime.getURL('overview/overview.html');
    return tabs.filter(tab => !tab.url.startsWith(selfUrl));
  }

  renderAndUpdate() {
    const total = this.allTabs.length;
    this.countEl.textContent = `${total} tabs`;
    this.statEl.textContent = String(total);
    this.renderTabs(this.allTabs);
    this.renderStatBars();
  }

  renderTabs(tabs) {
    this.container.innerHTML = '';
    if (tabs.length === 0) {
      this.emptyState.hidden = false;
      return;
    }
    this.emptyState.hidden = true;
    const groups = groupTabsByDomain(tabs);

    groups.forEach((group, i) => {
      const card = this.createCard(group, i);
      card.style.animationDelay = `${0.25 + i * 0.05}s`;
      this.container.appendChild(card);
    });
  }

  createCard(group, index) {
    const card = document.createElement('div');
    card.className = 'mission-card';
    card.dataset.domain = group.domain;
    card.style.setProperty('--card-accent', CARD_ACCENT_COLORS[group.colorIndex]);

    const top = document.createElement('div');
    top.className = 'mission-top';

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'mission-collapse';
    collapseBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>`;
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.toggle('collapsed');
    });

    const favicon = document.createElement('img');
    favicon.className = 'mission-favicon';
    favicon.src = group.favicon;
    favicon.alt = '';
    favicon.onerror = () => { favicon.style.display = 'none'; };

    const name = document.createElement('span');
    name.className = 'mission-name';
    name.textContent = group.displayName;
    name.title = group.domain;

    const tag = document.createElement('span');
    tag.className = 'mission-tag';
    tag.textContent = `${group.tabs.length} tabs`;

    const addLinkBtn = document.createElement('button');
    addLinkBtn.className = 'mission-add-link';
    addLinkBtn.dataset.tooltip = 'Add to Quick Links';
    addLinkBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>`;
    addLinkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = group.tabs[0].url;
      this.sidebar.addSiteFromUrl(url);
    });

    top.addEventListener('click', () => {
      card.classList.toggle('collapsed');
    });

    top.appendChild(collapseBtn);
    top.appendChild(favicon);
    top.appendChild(name);
    top.appendChild(addLinkBtn);
    top.appendChild(tag);

    const pages = document.createElement('div');
    pages.className = 'mission-pages';

    const visibleTabs = group.tabs.slice(0, VISIBLE_TAB_LIMIT);
    const hiddenTabs = group.tabs.slice(VISIBLE_TAB_LIMIT);

    for (const tab of visibleTabs) {
      pages.appendChild(this.createTabRow(tab));
    }

    if (hiddenTabs.length > 0) {
      const overflow = document.createElement('div');
      overflow.className = 'page-chip-overflow';
      overflow.textContent = `+ ${hiddenTabs.length} more`;

      overflow.addEventListener('click', (e) => {
        e.stopPropagation();
        overflow.remove();
        for (const tab of hiddenTabs) {
          const row = this.createTabRow(tab);
          row.style.animation = 'fadeUp 0.25s ease both';
          pages.appendChild(row);
        }
      });

      pages.appendChild(overflow);
    }

    const closeAllBtn = document.createElement('button');
    closeAllBtn.className = 'mission-close-all';
    closeAllBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg> Close all`;
    closeAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.add('closing');
      const tabIds = group.tabs.map(t => t.id);
      setTimeout(() => {
        card.remove();
        this.handleBulkClose(tabIds);
      }, 250);
      for (const id of tabIds) {
        chrome.runtime.sendMessage({ type: 'CLOSE_TAB', tabId: id });
      }
      showToast(`Closed ${tabIds.length} ${group.displayName} tabs`);
    });

    card.appendChild(top);
    card.appendChild(pages);
    card.appendChild(closeAllBtn);

    return card;
  }

  createTabRow(tab) {
    const row = document.createElement('div');
    row.className = 'page-chip';
    row.dataset.tabId = String(tab.id);

    const activityOpacity = this.getActivityOpacity(tab.lastAccessed);
    row.style.setProperty('--activity-opacity', String(activityOpacity));

    const favicon = document.createElement('img');
    favicon.className = 'chip-favicon';
    favicon.src = tab.favIconUrl || '';
    favicon.alt = '';
    favicon.onerror = () => { favicon.style.display = 'none'; };

    const content = document.createElement('div');
    content.className = 'chip-content';

    const text = document.createElement('span');
    text.className = 'chip-text';
    text.textContent = tab.title || tab.url;
    text.title = tab.url;

    const meta = document.createElement('div');
    meta.className = 'chip-meta';

    const path = extractPath(tab.url);
    if (path) {
      const pathEl = document.createElement('span');
      pathEl.className = 'chip-path';
      pathEl.textContent = path;
      meta.appendChild(pathEl);
    }

    if (tab.pinned) {
      const badge = document.createElement('span');
      badge.className = 'chip-badge chip-badge--pinned';
      badge.textContent = 'Pinned';
      meta.appendChild(badge);
    }

    if (tab.audible) {
      const badge = document.createElement('span');
      badge.className = 'chip-badge chip-badge--audible';
      badge.textContent = 'Playing';
      meta.appendChild(badge);
    }

    if (tab.status === 'loading') {
      const badge = document.createElement('span');
      badge.className = 'chip-badge chip-badge--loading';
      badge.textContent = 'Loading';
      meta.appendChild(badge);
    }

    content.appendChild(text);
    if (meta.children.length > 0) {
      content.appendChild(meta);
    }

    const actions = document.createElement('div');
    actions.className = 'chip-actions';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'chip-action chip-close';
    closeBtn.title = 'Close tab';
    closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`;

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      row.style.opacity = '0';
      row.style.transform = 'translateX(20px)';
      row.style.transition = '0.25s ease';
      setTimeout(() => {
        row.remove();
        this.handleTabClosed(tab.id);
        const card = this.container.querySelector(`[data-domain="${extractDomain(tab.url)}"]`);
        if (card) {
          const remaining = card.querySelectorAll('.page-chip').length;
          const tagEl = card.querySelector('.mission-tag');
          if (tagEl) tagEl.textContent = `${remaining} tabs`;
          if (remaining === 0) {
            card.classList.add('closing');
            setTimeout(() => card.remove(), 250);
          }
        }
      }, 250);
      chrome.runtime.sendMessage({ type: 'CLOSE_TAB', tabId: tab.id });
    });

    actions.appendChild(closeBtn);

    row.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SWITCH_TO_TAB', tabId: tab.id, windowId: tab.windowId });
    });

    row.addEventListener('mouseenter', () => {
      this.preview.show(tab, row.getBoundingClientRect());
    });
    row.addEventListener('mouseleave', () => this.preview.hide());

    row.appendChild(favicon);
    row.appendChild(content);
    row.appendChild(actions);

    return row;
  }

  getActivityOpacity(lastAccessed) {
    if (!lastAccessed) return 0.1;
    const ageMs = Date.now() - lastAccessed;
    const hourMs = 60 * 60 * 1000;
    if (ageMs < hourMs) return 0.9;
    if (ageMs < 4 * hourMs) return 0.6;
    if (ageMs < 24 * hourMs) return 0.35;
    return 0.1;
  }

  handleTabClosed(tabId) {
    this.allTabs = this.allTabs.filter(t => t.id !== tabId);
    this.updateCount(this.allTabs.length, this.allTabs.length);
  }

  handleBulkClose(tabIds) {
    this.allTabs = this.allTabs.filter(t => !tabIds.includes(t.id));
    this.updateCount(this.allTabs.length, this.allTabs.length);
  }

  listenForTabChanges() {
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.handleTabClosed(tabId);
      const row = this.container.querySelector(`[data-tab-id="${tabId}"]`);
      if (row) {
        row.style.opacity = '0';
        row.style.transform = 'translateX(20px)';
        row.style.transition = '0.25s ease';
        setTimeout(() => row.remove(), 250);
      }
    });
    chrome.tabs.onCreated.addListener(() => this.refresh());
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
      if (changeInfo.title || changeInfo.url || changeInfo.favIconUrl) {
        this.refresh();
      }
    });
  }

  refresh() {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(async () => {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_TABS' });
      this.allTabs = this.filterSelf(response || []);
      this.renderAndUpdate();
    }, 300);
  }

  renderStatBars() {
    const barsEl = document.getElementById('statBars');
    barsEl.innerHTML = '';
    const groups = groupTabsByDomain(this.allTabs);
    const top = groups.slice(0, 8);
    if (top.length === 0) return;
    const max = top[0].tabs.length;

    for (const group of top) {
      const bar = document.createElement('div');
      bar.className = 'stat-bar';
      bar.title = `${group.displayName}: ${group.tabs.length}`;
      const height = Math.max(4, (group.tabs.length / max) * 32);
      bar.style.height = `${height}px`;
      bar.style.background = CARD_ACCENT_COLORS[group.colorIndex];
      barsEl.appendChild(bar);
    }
  }

}

new OverviewApp();

'use strict';

// --- Domain Utils ---

const KNOWN_NAMES = {
  'github.com': 'GitHub',
  'stackoverflow.com': 'Stack Overflow',
  'google.com': 'Google',
  'youtube.com': 'YouTube',
  'twitter.com': 'Twitter',
  'x.com': 'X',
  'reddit.com': 'Reddit',
  'linkedin.com': 'LinkedIn',
  'notion.so': 'Notion',
  'figma.com': 'Figma',
  'slack.com': 'Slack',
  'discord.com': 'Discord',
  'medium.com': 'Medium',
  'npmjs.com': 'npm',
  'vercel.com': 'Vercel',
  'aws.amazon.com': 'AWS',
  'mail.google.com': 'Gmail',
  'docs.google.com': 'Google Docs',
  'drive.google.com': 'Google Drive',
  'calendar.google.com': 'Google Calendar',
};


function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'other';
  }
}

function getDisplayName(domain) {
  if (KNOWN_NAMES[domain]) return KNOWN_NAMES[domain];
  const parts = domain.split('.');
  if (parts.length >= 1) {
    const name = parts[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return domain;
}

function getPathDescription(url) {
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (path === '/' || path === '') return u.hostname;
    const clean = path.replace(/\/$/, '').split('/').filter(Boolean);
    if (clean.length === 0) return u.hostname;
    return u.hostname + '/' + clean.join('/');
  } catch {
    return url;
  }
}

function groupTabsByDomain(tabs) {
  const groups = new Map();
  for (const tab of tabs) {
    const domain = tab.domain || extractDomain(tab.url);
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
    }));
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
    const domain = tab.domain || extractDomain(tab.url);
    const tags = [];
    if (tab.pinned) tags.push('<span class="tab-preview__tag tab-preview__tag--pinned">Pinned</span>');
    if (tab.audible) tags.push('<span class="tab-preview__tag tab-preview__tag--audible">Playing</span>');

    this.el.innerHTML = `
      <div class="tab-preview__header">
        <img class="tab-preview__favicon" src="${tab.favIconUrl || ''}" alt="" onerror="this.style.display='none'">
        <span class="tab-preview__domain">${domain}</span>
        ${tags.length ? '<div class="tab-preview__tags">' + tags.join('') + '</div>' : ''}
      </div>
      <div class="tab-preview__title">${this.escapeHtml(tab.title)}</div>
      <div class="tab-preview__url">${this.escapeHtml(tab.url)}</div>
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

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// --- Sidebar (Top Sites) ---

class Sidebar {
  constructor() {
    this.listEl = document.getElementById('top-sites');
    this.loadTopSites();
  }

  async loadTopSites() {
    if (!chrome.topSites) {
      this.listEl.innerHTML = '<div class="top-sites__empty">Top Sites not available</div>';
      return;
    }
    try {
      const sites = await new Promise((resolve, reject) => {
        chrome.topSites.get((result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(result);
          }
        });
      });
      if (sites && sites.length > 0) {
        this.render(sites);
      } else {
        this.listEl.innerHTML = '<div class="top-sites__empty">No top sites yet</div>';
      }
    } catch (_) {
      this.listEl.innerHTML = '<div class="top-sites__empty">Unable to load top sites</div>';
    }
  }

  render(sites) {
    this.listEl.innerHTML = '';
    const seenDomains = new Set();
    for (const site of sites) {
      const domain = extractDomain(site.url);
      if (seenDomains.has(domain)) continue;
      seenDomains.add(domain);
      const faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(site.url)}&size=64`;

      const item = document.createElement('a');
      item.className = 'top-site-item';
      item.href = site.url;
      item.title = site.url;
      item.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: site.url });
      });

      const favicon = document.createElement('img');
      favicon.className = 'top-site-item__favicon';
      favicon.src = faviconUrl;
      favicon.alt = '';
      favicon.onerror = () => {
        favicon.src = '';
        favicon.style.background = 'var(--accent-light)';
      };

      const info = document.createElement('div');
      info.className = 'top-site-item__info';

      const name = document.createElement('div');
      name.className = 'top-site-item__name';
      name.textContent = getDisplayName(domain);
      name.title = site.title || site.url;

      info.appendChild(name);

      item.appendChild(favicon);
      item.appendChild(info);
      this.listEl.appendChild(item);
    }
  }
}

// --- Kanban Column ---

function createColumn(group, onTabClose, onCloseAll, preview) {
  const column = document.createElement('div');
  column.className = 'kanban-column';
  column.dataset.domain = group.domain;

  const header = document.createElement('div');
  header.className = 'kanban-column__header';

  const favicon = document.createElement('img');
  favicon.className = 'kanban-column__favicon';
  favicon.src = group.favicon;
  favicon.alt = '';
  favicon.onerror = () => { favicon.style.display = 'none'; };

  const title = document.createElement('span');
  title.className = 'kanban-column__title';
  title.textContent = group.displayName;
  title.title = group.domain;

  const count = document.createElement('span');
  count.className = 'kanban-column__count';
  count.textContent = String(group.tabs.length);

  const closeAllBtn = document.createElement('button');
  closeAllBtn.className = 'kanban-column__close-all';
  closeAllBtn.textContent = 'Close';
  closeAllBtn.title = `Close all ${group.displayName} tabs`;

  header.appendChild(favicon);
  header.appendChild(title);
  header.appendChild(count);
  header.appendChild(closeAllBtn);


  const list = document.createElement('div');
  list.className = 'kanban-column__list';

  for (const tab of group.tabs) {
    list.appendChild(createTabItem(tab, onTabClose, preview));
  }

  column.appendChild(header);
  column.appendChild(list);

  closeAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const tabIds = group.tabs.map(t => t.id);
    column.style.opacity = '0.3';
    column.style.transform = 'scale(0.97)';
    column.style.transition = '0.2s ease';
    setTimeout(() => {
      column.remove();
      onCloseAll(tabIds);
    }, 180);
    for (const id of tabIds) {
      chrome.runtime.sendMessage({ type: 'CLOSE_TAB', tabId: id });
    }
  });

  return column;
}

// --- Tab Item ---

function createTabItem(tab, onTabClose, preview) {
  const item = document.createElement('div');
  item.className = 'tab-item';
  item.setAttribute('tabindex', '0');
  item.dataset.tabId = String(tab.id);

  const favicon = document.createElement('img');
  favicon.className = 'tab-item__favicon';
  favicon.src = tab.favIconUrl || '';
  favicon.alt = '';
  favicon.onerror = () => { favicon.style.display = 'none'; };

  const content = document.createElement('div');
  content.className = 'tab-item__content';

  const title = document.createElement('div');
  title.className = 'tab-item__title';
  title.textContent = tab.title;
  title.title = tab.title;

  const url = document.createElement('div');
  url.className = 'tab-item__url';
  url.textContent = getPathDescription(tab.url);
  url.title = tab.url;

  content.appendChild(title);
  content.appendChild(url);

  // Meta info line
  const meta = document.createElement('div');
  meta.className = 'tab-item__meta';
  const parts = [];
  if (tab.pinned) parts.push('Pinned');
  if (tab.audible) parts.push('Playing audio');
  if (tab.status === 'loading') parts.push('Loading...');
  parts.push(`Window ${tab.windowId}`);

  meta.innerHTML = parts.join('<span class="tab-item__meta-dot"></span>');
  content.appendChild(meta);

  if (tab.pinned || tab.audible) {
    const badges = document.createElement('div');
    badges.className = 'tab-item__badges';
    if (tab.pinned) {
      const b = document.createElement('span');
      b.className = 'tab-item__badge tab-item__badge--pinned';
      b.textContent = 'Pinned';
      badges.appendChild(b);
    }
    if (tab.audible) {
      const b = document.createElement('span');
      b.className = 'tab-item__badge tab-item__badge--audible';
      b.textContent = 'Playing';
      badges.appendChild(b);
    }
    content.appendChild(badges);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-item__close';
  closeBtn.innerHTML = '&#10005;';

  item.appendChild(favicon);
  item.appendChild(content);
  item.appendChild(closeBtn);

  // Hover preview
  item.addEventListener('mouseenter', () => {
    preview.show(tab, item.getBoundingClientRect());
  });
  item.addEventListener('mouseleave', () => preview.hide());

  // Click
  item.addEventListener('click', (e) => {
    if (e.target.closest('.tab-item__close')) {
      e.stopPropagation();
      item.classList.add('tab-item--exiting');
      item.addEventListener('animationend', () => {
        item.remove();
        onTabClose(tab.id);
        const col = document.querySelector(`[data-domain="${tab.domain}"]`);
        if (col) {
          const remaining = col.querySelector('.kanban-column__list').children.length;
          col.querySelector('.kanban-column__count').textContent = String(remaining);
          if (remaining === 0) col.remove();
        }
      }, { once: true });
      chrome.runtime.sendMessage({ type: 'CLOSE_TAB', tabId: tab.id });
      return;
    }
    chrome.runtime.sendMessage({ type: 'SWITCH_TO_TAB', tabId: tab.id, windowId: tab.windowId });
  });

  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      chrome.runtime.sendMessage({ type: 'SWITCH_TO_TAB', tabId: tab.id, windowId: tab.windowId });
    }
  });

  return item;
}

// --- Overview App ---

class OverviewApp {
  constructor() {
    this.container = document.querySelector('.tab-container');
    this.emptyState = document.querySelector('.empty-state');
    this.inputEl = document.querySelector('.search-bar__input');
    this.countEl = document.querySelector('.search-bar__count');
    this.preview = new TabPreview();
    this.sidebar = new Sidebar();
    this.allTabs = [];
    this.debounceTimer = null;

    this.inputEl.addEventListener('input', () => this.handleSearch());
    this.init();
  }

  async init() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_TABS' });
      this.allTabs = this.filterSelf(response || []);
      this.renderAndUpdate();
    } catch (err) {
      console.error('Failed to load tabs:', err);
    }

    this.listenForTabChanges();
    this.setupKeyboardNav();
  }

  filterSelf(tabs) {
    const selfUrl = chrome.runtime.getURL('overview/overview.html');
    return tabs.filter(tab => !tab.url.startsWith(selfUrl));
  }

  renderAndUpdate() {
    this.updateCount(this.allTabs.length, this.allTabs.length);
    this.renderTabs(this.allTabs);
  }

  handleSearch() {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      const filtered = this.filter(this.inputEl.value);
      this.updateCount(filtered.length, this.allTabs.length);
      this.renderTabs(filtered);
    }, 150);
  }

  filter(query) {
    const trimmed = query.trim();
    if (!trimmed) return this.allTabs;
    const terms = trimmed.toLowerCase().split(/\s+/);
    return this.allTabs.filter(tab => {
      const haystack = `${tab.title} ${tab.url} ${tab.domain}`.toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }

  updateCount(visible, total) {
    this.countEl.textContent = visible === total
      ? `${total} tabs`
      : `${visible} / ${total}`;
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
      const col = createColumn(
        group,
        (tabId) => this.handleTabClosed(tabId),
        (tabIds) => this.handleBulkClose(tabIds),
        this.preview
      );
      col.style.animationDelay = `${i * 40}ms`;
      this.container.appendChild(col);
    });
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
      const item = this.container.querySelector(`[data-tab-id="${tabId}"]`);
      if (item) {
        item.classList.add('tab-item--exiting');
        item.addEventListener('animationend', () => item.remove(), { once: true });
      }
    });
    chrome.tabs.onCreated.addListener(() => this.refresh());
    chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
      if (changeInfo.title || changeInfo.url || changeInfo.favIconUrl) {
        this.refresh();
      }
    });
  }

  async refresh() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_TABS' });
    this.allTabs = this.filterSelf(response || []);
    this.renderAndUpdate();
  }

  setupKeyboardNav() {
    document.addEventListener('keydown', (e) => {
      const isSearchFocused = document.activeElement === this.inputEl;
      if (e.key === '/' && !isSearchFocused) {
        e.preventDefault();
        this.inputEl.focus();
        return;
      }
      if (e.key === 'Escape' && isSearchFocused) {
        this.inputEl.value = '';
        this.inputEl.blur();
        this.renderAndUpdate();
      }
    });
  }
}

new OverviewApp();

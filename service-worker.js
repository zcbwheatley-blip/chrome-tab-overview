'use strict';

const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];

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
  'mail.google.com': 'Gmail',
  'docs.google.com': 'Google Docs',
};

// --- Action: open overview ---

chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({
    url: chrome.runtime.getURL('overview/overview.html')
  });
});

// --- Message handling ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_ALL_TABS':
      return getAllTabs();

    case 'SWITCH_TO_TAB':
      if (message.tabId !== undefined && message.windowId !== undefined) {
        await chrome.tabs.update(message.tabId, { active: true });
        await chrome.windows.update(message.windowId, { focused: true });
      }
      return { success: true };

    case 'CLOSE_TAB':
      if (message.tabId !== undefined) {
        try { await chrome.tabs.remove(message.tabId); } catch (_) {}
      }
      return { success: true };

    case 'GROUP_ALL_TABS':
      await groupAllTabs();
      return { success: true };

    case 'UNGROUP_ALL_TABS':
      await ungroupAllTabs();
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

// --- Tab queries ---

async function getAllTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map(tab => ({
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || 'Untitled',
    url: tab.url || '',
    domain: extractDomain(tab.url || ''),
    favIconUrl: tab.favIconUrl || '',
    pinned: tab.pinned || false,
    audible: tab.audible || false,
    status: tab.status || 'complete',
    groupId: tab.groupId || -1,
  }));
}

// --- Auto Grouping ---

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.url && tab.url !== 'chrome://newtab/') {
    setTimeout(() => autoGroupByTab(tab.id), 500);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    setTimeout(() => autoGroupByTab(tabId), 300);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) {
    setTimeout(() => cleanupGroups(removeInfo.windowId), 300);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  setTimeout(groupAllTabs, 1000);
});

chrome.runtime.onStartup.addListener(() => {
  setTimeout(groupAllTabs, 1000);
});

async function autoGroupByTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url || tab.pinned) return;
    if (isInternalUrl(tab.url)) return;

    const domain = extractDomain(tab.url);
    await groupTabsForDomain(domain, tab.windowId);
  } catch (_) {}
}

async function groupTabsForDomain(domain, windowId) {
  const allTabs = await chrome.tabs.query({ windowId });
  const domainTabs = allTabs.filter(t =>
    !t.pinned && !isInternalUrl(t.url || '') && extractDomain(t.url || '') === domain
  );

  if (domainTabs.length < 2) {
    for (const t of domainTabs) {
      if (t.groupId && t.groupId !== -1) {
        try { await chrome.tabs.ungroup(t.id); } catch (_) {}
      }
    }
    return;
  }

  const tabIds = domainTabs.map(t => t.id);
  const count = domainTabs.length;
  const title = `${getDisplayName(domain)} (${count})`;
  const existingGroupId = await findExistingGroup(domain, windowId);

  if (existingGroupId !== null) {
    try {
      await chrome.tabs.group({ tabIds, groupId: existingGroupId });
      await chrome.tabGroups.update(existingGroupId, { title });
    } catch (_) {}
  } else {
    try {
      const color = await getNextColor(windowId);
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, { title, color });
    } catch (_) {}
  }
}

async function findExistingGroup(domain, windowId) {
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    const displayName = getDisplayName(domain);
    const match = groups.find(g => g.title === displayName || g.title === domain);
    return match ? match.id : null;
  } catch (_) {
    return null;
  }
}

async function cleanupGroups(windowId) {
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    for (const group of groups) {
      const tabs = await chrome.tabs.query({ groupId: group.id });
      if (tabs.length <= 1) {
        for (const t of tabs) {
          try { await chrome.tabs.ungroup(t.id); } catch (_) {}
        }
      }
    }
  } catch (_) {}
}

async function groupAllTabs() {
  const windows = await chrome.windows.getAll();
  for (const win of windows) {
    const tabs = await chrome.tabs.query({ windowId: win.id });
    const domainMap = new Map();

    for (const tab of tabs) {
      if (tab.pinned || isInternalUrl(tab.url || '')) continue;
      const domain = extractDomain(tab.url || '');
      const list = domainMap.get(domain) || [];
      list.push(tab);
      domainMap.set(domain, list);
    }

    for (const [domain, domainTabs] of domainMap) {
      if (domainTabs.length >= 2) {
        await groupTabsForDomain(domain, win.id);
      }
    }
  }
}

async function ungroupAllTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.groupId && tab.groupId !== -1) {
      try { await chrome.tabs.ungroup(tab.id); } catch (_) {}
    }
  }
}

// --- Utils ---

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

function isInternalUrl(url) {
  return url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:');
}

async function getNextColor(windowId) {
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    const usedColors = groups.map(g => g.color);
    for (const color of GROUP_COLORS) {
      if (!usedColors.includes(color)) return color;
    }
    return GROUP_COLORS[groups.length % GROUP_COLORS.length];
  } catch (_) {
    return GROUP_COLORS[0];
  }
}

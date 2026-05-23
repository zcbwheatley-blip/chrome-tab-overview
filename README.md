# Tab Overview

A Chrome extension that provides a kanban-style tab manager with automatic domain grouping, search, and quick access to frequently visited sites.

## Features

### Kanban Tab Overview
- **Masonry layout** — Tabs are grouped by domain and displayed in a 4-column waterfall layout
- **Real-time search** — Filter tabs by title or URL with instant results
- **Tab management** — Click to switch, close individual tabs, or close all tabs in a domain group
- **Hover preview** — Hover over any tab card to see full title and URL details

### Auto Tab Grouping
- **Automatic domain grouping** — Tabs from the same domain are automatically grouped in Chrome's native tab bar
- **Color-coded groups** — Each domain gets a consistent color for easy identification
- **Smart cleanup** — Groups are automatically removed when only one tab remains in a domain

### Quick Access Sidebar
- **Top Sites** — Right sidebar shows your most visited sites in a card grid layout
- **One-click open** — Click any site card to open it in a new tab
- **Deduplicated** — Same-domain sites are merged into a single entry

## Triggers

- **Keyboard shortcut**: `Cmd+Shift+E` (Mac) / `Ctrl+Shift+E` (Windows/Linux)
- **Toolbar icon**: Click the extension icon
- **New tab page**: Automatically replaces Chrome's default new tab page

## Installation

### From Source (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/zcbwheatley-blip/chrome-tab-overview.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable **Developer mode** (toggle in the top-right corner)

4. Click **Load unpacked**

5. Select the `tab-overview` folder from the cloned repository

6. The extension is now active — open a new tab or press `Cmd+Shift+E` to see the overview

### Permissions

The extension requires the following permissions:
- `tabs` — Access tab information (title, URL, favicon)
- `tabGroups` — Create and manage tab groups in the browser tab bar
- `topSites` — Display your most frequently visited sites
- `favicon` — Load website favicons for display

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+E` / `Ctrl+Shift+E` | Open Tab Overview |
| `/` | Focus search bar |
| `Escape` | Clear search and blur |

## Tech Stack

- **Pure JavaScript** — No build step, no dependencies
- **Chrome Extension Manifest V3**
- **CSS Custom Properties** — Modern design tokens
- **Chrome APIs** — tabs, tabGroups, topSites, favicon

## Project Structure

```
tab-overview/
├── manifest.json          # Extension configuration
├── service-worker.js      # Background: auto-grouping, message handling
├── overview/
│   ├── overview.html      # Main UI page
│   ├── overview.js        # App logic: rendering, search, interactions
│   └── overview.css       # Styles (modern, Linear-inspired design)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## License

MIT

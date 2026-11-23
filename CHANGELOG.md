# Changelog

All notable changes to Expired Domains are documented here.

## [Unreleased]

### Added

- **Live start steps** — while the list is empty, the side panel follows the active tab: open ExpiredDomains.net and sign in → open a domain list (a button opens Deleted .com) → save the page, with a "Save this page" button and the auto-capture switch right in the side panel. A site tab opened before installation gets a hint to reload it. No new permissions

## [0.1.1] - 2026-11-21

### Added

- **Compact list** — one line per domain: the name with its zone dimmed (a long name wraps, never cut), the list kind and a country flag (a globe for generic zones) in a column on the right, the full list name in the tooltip; status as a small coloured icon, up to two tags and the note on a second line only when there are any
- **Delete** the selected domains (bulk actions) or one domain from its card; **clear one list** in "Data and backup" — domains also captured from other lists stay. Each asks first and offers a backup
- **Auto-capture indicator** — while auto-capture is on, the collapsed on-page panel's button is filled, and when a page added new domains a shimmer runs across it (or across "Save page" when the panel is expanded)
- **301.st icon set** across the side panel, the welcome page and the on-page panel; the side panel footer is a row of icon links (how it works, rate, GitHub, 301.st, support chat)

### Changed

- Theme: light or dark, following the system until you switch; the separate "system" choice is gone
- "Clear" in "Data and backup" is now "Clear all"

### Fixed

- After the extension was updated or reloaded, an open expireddomains.net tab no longer throws "Extension context invalidated"; the panel asks to reload the page

## [0.1.0] - 2026-11-20

First public version.

### Added

- **Save page and auto-capture** — a small panel on expireddomains.net list pages saves the domain table of the page you opened; with auto-capture on, every list page you open is saved after it loads. The extension never opens pages or sends requests by itself
- **One collection** — domains from all pages and lists, without duplicates, with every table column, up to 10,000 domains
- **Side panel** in Chrome, Edge and Firefox (the toolbar icon opens it; there is no popup) — updates live while you browse
- **Filters** in a slide-out panel — text or `/regex/`, status, tags, list, available/registered, data age, drop and deletion dates, running auctions, BL/DP and archive thresholds, zones, name length, no digits, no hyphens; built-in and up to 20 own presets
- **Statuses, tags and notes** per domain, with bulk actions for the whole selection
- **Export** of the filtered list to CSV (UTF-8 with BOM, opens in Excel), TXT or the clipboard
- **Backup and restore** of everything as a JSON file (merge or replace)
- **Welcome page** on install — what the site is, why a free account is needed, and the steps
- **English and Russian** interface; light, dark and system theme

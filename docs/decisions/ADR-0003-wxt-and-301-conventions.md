---
type: decision
status: accepted
tags: [architecture, build, design-system, i18n]
project: expired-domains-saver
---

# ADR-0003: WXT и оформление как в остальных расширениях 301.st

Дата: 2026-11-19. Меняет ADR-0001 в части «плоский JS без сборки» и раздел 8 SPEC v0.3
(один пакет MV3 для всех браузеров). Детали — [SPEC](../SPEC.md): разделы 8, 8.2, Н3–Н5.

## Контекст
- Набросок — плоский JS: ручной `manifest.json`, свой `popup.css`, один пакет MV3 для
  Chrome, Edge и Firefox.
- Уже есть семейство расширений 301.st (`investblog/redirect-inspector`,
  `investblog/agent-readiness-inspector`, `investblog/cloudflare-tools`,
  `investblog/spintax-extension` и др.). Все они сделаны одинаково:
  - WXT 0.19, TypeScript, vanilla DOM;
  - Biome, vitest;
  - токены дизайн-системы 301-ui;
  - `_locales` с хелпером `t()`;
  - три сборки: `chrome-mv3`, `edge-mv3`, `firefox-mv2`.
- Решение пользователя (2026-11-19): «оформляем как остальные наши расширения — стили и
  т.п.», «переводи на WXT как в остальных».

## Решение
- **Сборка.** Проект на WXT по образцу `redirect-inspector` (popup) и `agent-readiness`:
  `srcDir: 'src'`, `outDir: 'dist'`, манифест в `wxt.config.ts`, скрипты
  `check`/`zip:all`, Node 22.
- **Firefox — MV2**, как во всех расширениях семейства (поведение WXT по умолчанию). У
  каждого браузера свой манифест, поэтому `minimum_chrome_version` снижается до 116, как
  у остальных.
- **Оформление.** Токены 301-ui копируются по значению. В popup — шапка и подвал, как в
  `redirect-inspector`. В панели на странице — те же токены на `:host` в `px`, тема только
  по `prefers-color-scheme`.
- **Языки.** `en` (по умолчанию) и `ru`.
- **Что не переносится** из общего шаблона, потому что нарушает capture-only (ADR-0001,
  SPEC I1/I4/I5):
  - новости 301.sh (сетевой запрос, `notifications`, `optional_host_permissions`).
- **Боковая панель обязательна** (уточнение пользователя в тот же день: «стандарт
  наших расширений и в Chrome-Edge, и в Firefox — Must Have»). Используется та же
  страница `popup.html?sidepanel=1`. В Chrome/Edge добавляется право `sidePanel` (без
  предупреждения при установке), в Firefox — `sidebar_action` (без права). SPEC Ф13а,
  I4. **Уточнено [ADR-0005](ADR-0005-sidepanel-only.md):** popup убран, единственная
  страница — `sidepanel.html`.
- **Что отложено** (лишний шаг, а пользы в v1 нет):
  - страница `welcome` (взята 2026-11-20, SPEC Ф13б);
  - блок `gecko_android`.
- **Репозиторий публичный** (`investblog`). Агентские файлы (`.agents/`, `AGENTS.md`,
  `CLAUDE.md`, `.claude/`…) в него не попадают. Лицензия — Apache-2.0, как у
  `redirect-inspector` и `agent-readiness`. Политика конфиденциальности — общая
  `https://301.st/apps-privacy`.

## Альтернативы
- **Оставить плоский JS** (SPEC v0.3). Нет сборщика, и для AMO не нужен архив
  исходников. Отклонено: расширение выпадает из семейства — свои стили, своя сборка,
  свой релизный процесс. Пользователь выбрал единообразие.
- **Firefox MV3 через WXT** (`manifestVersion: 3`). Можно сделать, но во всём семействе
  этого нет, и релизные процессы рассчитаны на `firefox-mv2`. Пересмотреть, если AMO
  потребует MV3.

## Последствия
- **Проверки — на собранных пакетах.** A1 сканирует `dist/*` (в пакет входит рантайм
  WXT), A2 проверяет три манифеста.
- **AMO.** Нужны архив исходников и `AMO_BUILD.md`.
- **CSS панели.** Встраивается строкой в бандл content script. `createShadowRootUi` и
  `web_accessible_resources` не используются.
- **Firefox.** Background — постоянная страница MV2. Протокол очереди Ф10–Ф11 рассчитан
  на остановку в любой момент и остаётся без изменений.
- **`unlimitedStorage` в Firefox** остаётся (решение 2026-11-20, SPEC М2): возможная
  строка в окне установки допускается, а матрица прав для A2 заморожена.

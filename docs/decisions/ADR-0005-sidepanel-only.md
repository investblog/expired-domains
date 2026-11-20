---
type: decision
status: accepted
tags: [architecture, ui, firefox, sidepanel]
project: expired-domains-saver
---

# ADR-0005: только боковая панель, без popup

Дата: 2026-11-20. Уточняет [ADR-0003](ADR-0003-wxt-and-301-conventions.md) в части «одна
страница `popup.html` в двух режимах». Детали — [SPEC](../SPEC.md): Ф13а, Ф16а, I4, A2.

## Контекст
- В v0.7 одна страница работала в двух режимах: popup и боковая панель
  (`popup.html?sidepanel=1`). В Chrome и Edge иконка открывала боковую панель, а в Firefox
  открывался popup с кнопкой «Закрепить сбоку».
- В последних расширениях семейства 301.st (`geo-tier-builder`, `cloudflare-tools`,
  `dark-theme-generator`) от popup отказались: есть только точка входа `sidepanel`, и
  иконка открывает боковую панель во всех браузерах.
- Решение пользователя (2026-11-20): «попап в Firefox — лишнее, достаточно боковой панели».

## Решение
- Единственная страница расширения — точка входа WXT `sidepanel` (`sidepanel.html`). По ней
  WXT строит `side_panel` (Chrome/Edge) и `sidebar_action` (Firefox).
- **Chrome / Edge:** `sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` в
  background при каждом запуске worker.
- **Firefox:** `browser_action` без `default_popup`; `browserAction.onClicked` →
  `sidebarAction.open()` прямо в обработчике клика. Плюс команда
  `_execute_sidebar_action` — сочетание клавиш для показа и скрытия панели.
- Режим popup удалён вместе с кнопкой «Закрепить сбоку» и обходным путём «восстановление
  из копии — только в боковой панели»: восстановление теперь доступно всегда.

## Последствия
- Права не меняются (I4). В Firefox в манифесте появляется ключ `commands`; A2 его
  проверяет.
- Открытый вопрос «закрывается ли popup Firefox при выборе файла» (Ф27) снят.
- Проверка A8 в Firefox проще: нет отдельного контекста popup.

## Альтернативы
- **Оставить popup в Firefox.** Отклонено: второй вид той же страницы с другой высотой и
  шириной, лишний шаг до боковой панели, расходится с семейством.

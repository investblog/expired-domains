---
type: runbook
status: draft
tags: [release, store, chrome, edge, firefox]
project: expired-domains-saver
---

# Первая подача в магазины — v0.1.1

Подготовлено 2026-11-20, обновлено 2026-11-21. v0.1.0 вышел только как GitHub Release; в магазины первой идёт v0.1.1. Требования — [SPEC](../SPEC.md) М1–М9; раскладка как в
`agent-readiness`.

## Что куда загружать

| Поле | Chrome Web Store | Edge Add-ons | Firefox AMO |
|---|---|---|---|
| Пакет (из GitHub Release) | `expired-domains-<v>-chrome.zip` | `expired-domains-<v>-edge.zip` | `expired-domains-<v>-firefox.zip` + `-sources.zip` (сборка: `AMO_BUILD.md`) |
| Описание | `chrome/{en,ru}.txt` | `edge/{en,ru}.txt` | `firefox/{en,ru}.md` |
| Ключевые слова | — | `edge/search-terms.txt` (7 терминов, ≤ 30 знаков, ≤ 21 слово) | — |
| Краткое описание | из манифеста (`extDescription`, ≤ 132 символа — проверяет тест) | то же | то же (summary) |
| Иконка | `store-assets/icon-128.png` (128×128, рисунок 96×96 + 16 px прозрачных полей; `npm run icons`) | `store-assets/logo-300.png` | из пакета |
| Скриншоты 1280×800 | `store-assets/screenshot-{1..4}-*.png`; `store-assets/ru/` — если кабинет даёт картинки по языкам (не проверено) | те же | те же |
| Малая плитка 440×280 | `store-assets/promo-small-440x280.png` (обязательна) | по желанию, тот же файл | нет |
| Большая плитка 1400×560 | `store-assets/promo-marquee-1400x560.png` (по желанию) | по желанию | нет |
| Видео | `https://www.youtube.com/watch?v=8EgHA3YYxhk` (полный адрес youtube.com, не `youtu.be`) | то же | нет |
| Заметки ревьюеру | поле Test instructions (≤ 500 знаков) — раздел «TEST STEPS — SHORT» из `reviewer-notes.txt`; логин и пароль пустые — ревьюер регистрирует свой аккаунт (М9) | `edge/certification-notes.txt` + аккаунт | `reviewer-notes.txt` + аккаунт |
| Поддержка | `support@301.st` | то же | то же |
| Лицензия | — | — | Apache-2.0 |

Все картинки — 24-битный PNG без альфа-канала (CWS принимает JPEG или 24-битный PNG),
кроме иконок `icon-128.png` и `logo-300.png` (прозрачный фон: так требуют правила CWS для
иконки, Edge его допускает).

## Скриншоты и плитки

- **1 — список** (тёмная тема), **2 — фильтры** в выезжающей панели, **3 — выбор и
  экспорт** (светлая тема), **4 — стартовая страница**.
- Слева подпись, справа настоящий интерфейс боковой панели на выдуманных нейтральных
  доменах — без сайта, аккаунта и личных данных.
- Пересъёмка:
  1. `npm run store:harness` (сборка + стенд на `http://127.0.0.1:5179`);
  2. в браузере при окне 1280×800 открыть `/shot.html?n=1..3&lang=en|ru&theme=dark|light`
     и `/welcome.html?lang=…&act=fit`, снять кадр. Без ручной работы — headless Chrome по
     одному кадру за раз: `chrome --headless=new --user-data-dir=<временная папка>
     --hide-scrollbars --force-device-scale-factor=1 --window-size=1280,800
     --virtual-time-budget=4000 --screenshot=<файл.png> "<адрес>"` (кадры 1–2 и стартовая —
     `theme=dark`, кадр 3 — `theme=light`);
  3. остановить стенд (Ctrl+C);
  4. `npm run promo` — плитки (большая берёт панель из `screenshot-1`).
- **Видео (англ., 60 с, 1920×1080, с озвучкой и `.srt`):** сначала голос, потом картинка.
  1. Озвучка: `PIPER_PYTHON=<python с piper-tts 1.8> PIPER_VOICES=<папка с голосом>
     node scripts/video/voice.mjs <папка фраз>` — фразы из `scripts/video/narration.json`, голос
     `en_US-ljspeech-high` (public domain). Сцены в `timeline.js` рассчитаны на длину фраз +
     1,15 с; новая фраза длиннее — поправить времена сцен.
  2. `npm run build`, затем `node scripts/video/server.mjs` (стенд на
     `http://127.0.0.1:5180/video.html`; в окне 1280×720 играет вживую, без звука).
  3. `node scripts/video/capture.mjs "http://127.0.0.1:5180/video.html?hold" 60.2 <папка кадров>`.
  4. `node scripts/video/render.mjs <папка кадров> <папка фраз>
     store-assets/video/expired-domains-promo-en.mp4` — H.264 + AAC, −16 LUFS, рядом `.srt`.

  Папка `store-assets/video/` (ролик, `.srt`, фоны) в git не входит и живёт только на машине
  владельца. Фоны — `store-assets/video/art/` (Recraft, `scripts/video/recraft.mjs`; первая карточка — `301-full.svg` из `301-ui/public/img/`). CWS принимает видео
  ссылкой на YouTube — загружает владелец (`.srt` — субтитры к загрузке). Загружено
  2026-11-22: `https://www.youtube.com/watch?v=8EgHA3YYxhk`; описание для YouTube — в
  `store-assets/video/youtube-description.txt`, к нему вернуться после публикации в магазинах
  (ссылки на магазины вместо «coming soon»).
- **Кадр на реальном сайте** (панель «На странице: 25» поверх списка + боковая панель)
  делает только владелец аккаунта: сайт запрещает автоматизацию, а имя аккаунта, баланс
  и прочее вне таблицы в кадр попадать не должны. Он необязателен: пятый слот в CWS
  свободен.

## Формы приватности

- **Chrome / Edge:** обрабатываемые данные — «Website content» (таблица доменов открытой
  страницы) и «Web history» (адрес списка как источник). Всё хранится локально,
  разработчику ничего не передаётся, не продаётся, не используется для рекламы.
  Remote code — нет. Поля вкладки Privacy в CWS (тексты — из `reviewer-notes.txt`):
  - *Single purpose* — раздел SINGLE PURPOSE;
  - *storage*, *unlimitedStorage*, *sidePanel* — одноимённые абзацы раздела PERMISSIONS;
  - *Host permission justification* — абзац «Content script on …» из PERMISSIONS:
    `host_permissions` в манифесте нет, но CWS считает доступом к хостам адреса
    `content_scripts.matches` (`*://expireddomains.net/*`, `*://*.expireddomains.net/*`);
  - *Are you using remote code?* — No (раздел DATA AND REMOTE CODE).
- **Firefox:** `data_collection_permissions: { required: ["none"] }` — расширение ничего
  не собирает.
- **Privacy policy URL:** `https://301.st/apps-privacy` — сначала добавить туда Expired
  Domains (см. «Блокеры»).

## Блокеры перед подачей

1. **Политика приватности:** раздел про Expired Domains на `https://301.st/apps-privacy`
   (репозиторий 301-ui; SPEC М3).
2. **Аккаунт для ревьюеров** (М9, решение 2026-11-20). Без входа таблиц нет, а ED шлёт
   код на почту при каждом входе с нового устройства, поэтому общий тестовый аккаунт не
   работает. Ревьюер регистрирует свой бесплатный аккаунт; для одноразового адреса в
   заметках рекомендован MailBot (наш, расширение во всех трёх магазинах + Telegram).
   Проверено 2026-11-20: ED принимает адрес MailBot, письмо доходит, аккаунт активируется
   («Your account was successfully activated»). Блокер снят.
3. **Ручные проверки A6–A11** на реальном сайте в трёх браузерах (A11 — скачивание в
   Firefox — блокирует релиз).
4. **Публичный репозиторий** `github.com/investblog/expired-domains` — опубликован 2026-11-20.
5. **Пакеты только из CI** (как в остальных расширениях): Actions → **Cut release** с полем
   `submit` = **none** (у магазинов ещё нет ID расширения — первая подача ручная) → тег после полной проверки на
   Linux → **Release** кладёт три пакета, архив исходников и `SHA256SUMS.txt` в GitHub
   Release. Локальный zip в магазин не загружать. Версия в `package.json` и `wxt.config.ts`
   должна совпадать — workflow это проверяет (М8).
6. **Автоподача со следующих версий:** после первой ручной подачи внести в секреты
   репозитория ID расширений и ключи API (список — в заголовке общего
   `investblog/geo-tier-builder/.github/workflows/store-submit.yml`); тогда **Submit to
   stores** подаёт Chrome и Edge по тегу, Firefox — только ручным запуском.

## Порядок

Chrome и Edge — черновиками, описания и картинки по языкам, затем публикация.
Firefox — последним: у AMO нет черновика, номер версии сгорает навсегда.

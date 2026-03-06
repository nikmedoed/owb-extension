# OWB Tools Chrome Extension (MV3)

Отдельное Chrome-расширение для Ozon/WB на базе ваших Tampermonkey-скриптов.

## Что внутри

- `content/exporter.js` - перенос `Product-card-extract-OZON-WB.user.js`
- `content/price-monitor.js` - сбор цен + график + бейджи минимума на карточках
- `content/mp-core.js` - общий core с адаптацией `GM_*` в bridge расширения
- `background/service-worker.js` - storage API, IndexedDB истории цен, экспорт/импорт, сетевые JSON-запросы, двунаправленный sync с сервером
- `popup/` - быстрый статус и настройки
- `options/` - дефолты + экспорт/импорт всей БД расширения

## Источники, откуда перенесено

- `C:\clouds\Dropbox\programming\myTampermonkeyScripts\OZON-WB-tools`
- `C:\clouds\Dropbox\programming\myTampermonkeyScripts\Product-card-extract-OZON-WB.user.js`
- `C:\clouds\Dropbox\programming\myTampermonkeyScripts\icons\ozon-wb-download.png`

## Хранилище и синхронизация истории цен

История цен хранится в **extension-side IndexedDB**:

- DB: `owb-price-history-ext`
- Stores:
  - `intervals` — интервалы цен (`firstTs`/`lastTs`)
  - `products` — сводка по товару (последняя цена + минимальная)

Логика записи: одинаковая цена подряд обновляет `lastTs`, новая цена создаёт новый интервал.

При включении режима `sync`:

- локальные интервалы отправляются на сервер (`POST /api/intervals/bulk`);
- изменения с сервера подтягиваются в локальную БД (`GET /api/changes`);
- запрос минимумов карточек использует выборочную загрузку (`POST /api/min-batch`);
- запрос истории товара использует выборочную загрузку (`GET /api/history?pidKey=...`).

## Запуск

1. Откройте `chrome://extensions`
2. Включите `Developer mode`
3. `Load unpacked` -> выберите папку `extension`
4. Откройте карточку Ozon/WB и используйте popup расширения

## Примечания

- Для новых профилей задайте дефолты в `Options`
- Экспорт/импорт в `Options` работает напрямую с БД расширения (без необходимости открывать карточку товара)

# OWB Tools Chrome Extension (MV3)

Chrome-расширение для Ozon/WB/AliExpress на базе ваших Tampermonkey-скриптов.

Эта папка должна быть самодостаточной для `Load unpacked`. Generated artifacts пересобираются из этой папки:

```powershell
npm install
npm run build:local
```

После скачивания репозитория можно сразу использовать `Load unpacked` -> `extension`. Пересборка нужна только после изменения исходников.

## Структура

- `src/` - JS-исходники, которые собираются через `esbuild`.
- `build/` - готовые load-unpacked файлы, которые подключает `manifest.json`.
- `scripts/` - local/dev/release сборка.
- `manifest.json` - Manifest V3 с путями на файлы из `build/`.

`build/content/*.js`, `build/background/service-worker.js`, `build/popup/*.js`, `build/options/*.js` и `build/history/*.js` пересобираются из `src/**`. Статические `html/css/icons` лежат только в `build/**`.

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

`manifest.key` закрепляет extension ID для unpacked-установки. Это важно для IndexedDB: Chrome хранит историю цен отдельно для каждого ID расширения. Если переносите историю из старой копии, используйте `Options` -> `Экспорт базы`, затем в новой копии `Дополнить базу` или `Заменить базу`.

## Запуск

1. Откройте `chrome://extensions`
2. Включите `Developer mode`
3. `Load unpacked` -> выберите папку `extension`
4. Откройте карточку Ozon/WB/AliExpress и используйте popup расширения

## Примечания

- Все Node.js-зависимости и scripts живут в этой папке.
- Для новых профилей задайте дефолты в `Options`
- Экспорт/импорт в `Options` работает напрямую с БД расширения (без необходимости открывать карточку товара)

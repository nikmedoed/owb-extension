# OZON/WB Price Monitor

Проект состоит из:
- Tampermonkey userscript `Price-monitor-OZON-WB.user.js`
- локального сервера `local_price_server.py` (SQLite)

Скрипт умеет работать в двух режимах:
- `local` — только браузерный IndexedDB, без сети
- `sync` — двусторонняя синхронизация с сервером (push + pull)

## Модель хранения
История хранится **интервалами цены**, а не точечными сэмплами:
- `pidKey` (`{market}:{productId}`)
- `pid`
- `price`
- `currency`
- `firstTs`
- `lastTs`

Это уменьшает размер БД и сохраняет момент смены цены.

## Что реализовано
- Сбор цены с карточки товара Ozon/WB.
- Локальный график истории на карточке.
- Фоновая синхронизация между устройствами через сервер.
- Автоматическая миграция старых snapshot-записей в интервалы (и на сервере, и в userscript).
- Минимумы и графики считаются отдельно по активной валюте товара, без смешивания `RUB` и `AMD`.

## Установка userscript
Установить:

https://github.com/nikmedoed/myTampermonkeyScripts/raw/main/OZON-WB-tools/Price-monitor-OZON-WB.user.js

## Запуск сервера

```bash
python local_price_server.py
```

По умолчанию:
- URL: `http://127.0.0.1:8765`
- База: `price_history.sqlite`

### Переменные окружения
- `PRICE_SERVER_HOST` (default `127.0.0.1`)
- `PRICE_SERVER_PORT` (default `8765`)
- `PRICE_SERVER_DB` (путь к sqlite)
- `PRICE_SERVER_MAX_BULK` (default `2000`)

Пример:

```bash
PRICE_SERVER_HOST=0.0.0.0 PRICE_SERVER_PORT=8765 python local_price_server.py
```

## API сервера
- `GET /ping`
- `POST /api/price` — запись наблюдения цены `{pidKey,pid,price,currency,ts?}`
- `POST /api/intervals/bulk` — bulk upsert интервалов `{intervals:[...]}`
- `GET /api/history?pidKey=...` — история интервалов по товару
- `POST /api/min-batch` — минимумы по товарам `{pidKeys:[...], preferredCurrencies?: { [pidKey]: currency }}`
- `GET /api/changes?since=...&limit=...` — инкрементальная выдача изменений для pull-синхронизации

## Режимы в Tampermonkey меню
- `OZON/WB: Set server URL`
- `OZON/WB: Enable sync mode`
- `OZON/WB: Local-only mode`
- `OZON/WB: Sync now`
- `OZON/WB: Show sync status`

## Как работает синхронизация
1. Скрипт пишет интервалы в IndexedDB.
2. В режиме `sync` отправляет локально изменённые интервалы на сервер (`/api/intervals/bulk`).
3. Подтягивает изменения с сервера (`/api/changes`) и объединяет их с локальными.
4. Для активной карточки товара догружает историю через `/api/history`.

Если сервер недоступен, скрипт продолжает работать локально.

## Примечания
- Аутентификации в сервере нет: используйте в доверенной сети.
- Регулярно бэкапьте `price_history.sqlite`.
- Формат ключа товара: `ozon:123456` / `wb:123456`.

'use strict';

const STORAGE_KEYS = {
    mode: 'owb-default-sync-mode',
    url: 'owb-default-server-url',
};

const modeEl = document.getElementById('defaultMode');
const urlEl = document.getElementById('defaultUrl');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('saveBtn');
const applyBtn = document.getElementById('applyBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFileEl = document.getElementById('importFile');
const inspectMetaEl = document.getElementById('inspectMeta');
const inspectHealthEl = document.getElementById('inspectHealth');
const inspectTotalProductsEl = document.getElementById('inspectTotalProducts');
const inspectTotalIntervalsEl = document.getElementById('inspectTotalIntervals');
const inspectAvgPerProductEl = document.getElementById('inspectAvgPerProduct');
const inspectMarketsEl = document.getElementById('inspectMarkets');
const inspectProductsListEl = document.getElementById('inspectProductsList');
const inspectIntervalsListEl = document.getElementById('inspectIntervalsList');

const setStatus = (text, isError = false) => {
    statusEl.textContent = text;
    statusEl.style.color = isError ? '#b42318' : '#1f2328';
};

const storageGet = (keys) => new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
        const err = chrome.runtime.lastError;
        if (err) {
            reject(new Error(err.message || 'Storage get failed'));
            return;
        }
        resolve(result || {});
    });
});

const storageSet = (value) => new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
        const err = chrome.runtime.lastError;
        if (err) {
            reject(new Error(err.message || 'Storage set failed'));
            return;
        }
        resolve();
    });
});

const sendRuntimeMessage = (message) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
            reject(new Error(err.message || 'Cannot send message'));
            return;
        }
        resolve(response);
    });
});

const withBusy = (busy) => {
    saveBtn.disabled = busy;
    applyBtn.disabled = busy;
    exportBtn.disabled = busy;
    importBtn.disabled = busy;
    modeEl.disabled = busy;
    urlEl.disabled = busy;
};

const readForm = () => ({
    mode: modeEl.value === 'sync' ? 'sync' : 'local',
    url: urlEl.value.trim(),
});

const loadDefaults = async () => {
    const saved = await storageGet([STORAGE_KEYS.mode, STORAGE_KEYS.url]);
    if (saved[STORAGE_KEYS.mode]) modeEl.value = saved[STORAGE_KEYS.mode];
    if (saved[STORAGE_KEYS.url]) urlEl.value = saved[STORAGE_KEYS.url];
};
const sendMonitor = async (action, payload = null) => {
    const actionMap = {
        'monitor:set-config': 'owb:price-set-config',
        'monitor:export-db': 'owb:price-export',
        'monitor:import-db': 'owb:price-import',
        'monitor:inspect-db': 'owb:price-inspect',
    };
    const type = actionMap[action];
    if (!type) throw new Error('Неизвестное действие');
    const message = { type };
    if (action === 'monitor:inspect-db') message.options = payload || {};
    else message.payload = payload || {};
    const response = await sendRuntimeMessage(message);
    if (!response || !response.ok) throw new Error(response && response.error ? response.error : 'Операция не поддерживается');
    return { data: response.data };
};

const formatTs = (value) => {
    const ts = Number(value);
    if (!Number.isFinite(ts) || ts <= 0) return '';
    try {
        return new Date(ts).toLocaleString('ru-RU');
    } catch (_) {
        return '';
    }
};

const formatNumber = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('ru-RU');
};

const resetList = (el) => {
    while (el.firstChild) el.removeChild(el.firstChild);
};

const renderList = (el, rows, emptyText) => {
    resetList(el);
    if (!rows.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = emptyText;
        el.appendChild(li);
        return;
    }
    rows.forEach((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        el.appendChild(li);
    });
};

const renderInspect = (data) => {
    const counts = data && data.counts ? data.counts : {};
    const totals = data && data.totals ? data.totals : {};
    const marketStats = Array.isArray(data?.marketStats) ? data.marketStats : [];
    const products = Array.isArray(data?.newestProducts) ? data.newestProducts : [];
    const intervals = Array.isArray(data?.newestIntervals) ? data.newestIntervals : [];
    const productsCount = Number(counts.products) || 0;
    const intervalsCount = Number(counts.intervals) || 0;
    const avgIntervalsPerProduct = Number.isFinite(Number(totals.avgIntervalsPerProduct))
        ? Number(totals.avgIntervalsPerProduct)
        : (productsCount > 0 ? (intervalsCount / productsCount) : 0);
    const fallbackLastActivityTs = Math.max(
        ...marketStats.map((item) => Number(item.lastUpdatedTs) || 0),
        ...products.map((item) => Number(item.updatedAt) || 0),
        ...intervals.map((item) => Number(item.updatedAt) || 0),
        0,
    );
    const lastActivityTs = Math.max(Number(totals.lastActivityTs) || 0, fallbackLastActivityTs);
    const inspectedAtText = formatTs(data?.inspectedAt);

    inspectMetaEl.textContent = [
        `БД: ${data?.dbName || 'owb-price-history-ext'} v${data?.dbVersion || 1}`,
        `Extension ID: ${chrome.runtime.id}`,
        inspectedAtText ? `проверено ${inspectedAtText}` : '',
    ].filter(Boolean).join(' · ');

    inspectTotalProductsEl.textContent = formatNumber(productsCount);
    inspectTotalIntervalsEl.textContent = formatNumber(intervalsCount);
    inspectAvgPerProductEl.textContent = productsCount > 0 ? avgIntervalsPerProduct.toFixed(2) : '0';

    const healthClassNames = ['diag-health'];
    let healthText = 'Нет данных: пока не зафиксированы товары и цены.';
    if (productsCount > 0 && intervalsCount > 0) {
        const isFresh = lastActivityTs > 0 && (Date.now() - lastActivityTs) <= (1000 * 60 * 60 * 24 * 7);
        healthClassNames.push(isFresh ? 'ok' : 'warn');
        healthText = isFresh
            ? `База активна: есть данные, последняя активность ${formatTs(lastActivityTs)}.`
            : `База заполнена, но давно не обновлялась: последняя активность ${formatTs(lastActivityTs)}.`;
    } else if (productsCount > 0 || intervalsCount > 0) {
        healthClassNames.push('warn');
        healthText = 'Данные частично заполнены: идёт накопление истории.';
    } else {
        healthClassNames.push('empty');
    }
    inspectHealthEl.className = healthClassNames.join(' ');
    inspectHealthEl.textContent = healthText;

    const marketRows = marketStats.map((item) => {
        const marketLabel = item.market === 'ozon' ? 'Ozon' : item.market === 'wb' ? 'WB' : 'Unknown';
        const marketProducts = Number(item.products) || 0;
        const marketIntervals = Number(item.intervals) || 0;
        const avg = marketProducts > 0 ? (marketIntervals / marketProducts).toFixed(2) : '0';
        const updated = formatTs(item.lastUpdatedTs);
        return `${marketLabel}: товаров ${formatNumber(marketProducts)}, интервалов ${formatNumber(marketIntervals)}, ср. ${avg}${updated ? `, обновлено ${updated}` : ''}`;
    });
    renderList(inspectMarketsEl, marketRows, 'Нет данных по маркетплейсам');

    const productRows = products.slice(0, 8).map((item) => {
        const last = Number.isFinite(Number(item.lastPrice)) ? `${item.lastPrice} ${item.lastCurrency || ''}`.trim() : '—';
        const min = Number.isFinite(Number(item.minPrice)) ? `${item.minPrice} ${item.minCurrency || ''}`.trim() : '—';
        const seen = formatTs(item.lastTs) || formatTs(item.updatedAt) || '—';
        return `${item.pidKey || 'unknown'} · последняя ${last} · минимум ${min} · ${seen}`;
    });
    renderList(inspectProductsListEl, productRows, 'Товары пока не собраны');

    const intervalRows = intervals.slice(0, 12).map((item) => {
        const price = Number.isFinite(Number(item.price)) ? `${item.price} ${item.currency || ''}`.trim() : '—';
        const first = formatTs(item.firstTs);
        const last = formatTs(item.lastTs);
        const range = first && last ? `${first} → ${last}` : (last || first || '—');
        return `${item.pidKey || 'unknown'} · ${price} · ${range}`;
    });
    renderList(inspectIntervalsListEl, intervalRows, 'Интервалы цен пока не собраны');
};

const inspectDb = async () => {
    withBusy(true);
    setStatus('Читаю содержимое БД...');
    try {
        const { data } = await sendMonitor('monitor:inspect-db', {
            productLimit: 40,
            intervalLimit: 60,
        });
        renderInspect(data || {});
        setStatus('Просмотр БД обновлён');
    } catch (err) {
        const message = String(err && err.message ? err.message : err);
        setStatus(message, true);
        inspectMetaEl.textContent = 'Не удалось прочитать БД расширения';
        inspectHealthEl.className = 'diag-health warn';
        inspectHealthEl.textContent = `Ошибка диагностики: ${message}`;
        renderList(inspectMarketsEl, [], 'Нет данных по маркетплейсам');
        renderList(inspectProductsListEl, [], 'Товары пока не собраны');
        renderList(inspectIntervalsListEl, [], 'Интервалы цен пока не собраны');
        inspectTotalProductsEl.textContent = '—';
        inspectTotalIntervalsEl.textContent = '—';
        inspectAvgPerProductEl.textContent = '—';
    } finally {
        withBusy(false);
    }
};

saveBtn.addEventListener('click', async () => {
    withBusy(true);
    setStatus('Сохраняю...');
    try {
        const values = readForm();
        await storageSet({
            [STORAGE_KEYS.mode]: values.mode,
            [STORAGE_KEYS.url]: values.url,
        });
        setStatus('Дефолты сохранены');
    } catch (err) {
        setStatus(String(err && err.message ? err.message : err), true);
    } finally {
        withBusy(false);
    }
});

applyBtn.addEventListener('click', async () => {
    withBusy(true);
    setStatus('Применяю...');
    try {
        const values = readForm();
        await sendMonitor('monitor:set-config', {
            mode: values.mode,
            url: values.url,
        });
        setStatus('Настройки сохранены в расширении');
    } catch (err) {
        setStatus(String(err && err.message ? err.message : err), true);
    } finally {
        withBusy(false);
    }
});

exportBtn.addEventListener('click', async () => {
    withBusy(true);
    setStatus('Экспортирую историю...');
    try {
        const { data } = await sendMonitor('monitor:export-db');
        const json = JSON.stringify(data || {}, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const a = document.createElement('a');
        a.href = url;
        a.download = `owb-price-history-all-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1200);
        setStatus('Экспорт сохранен');
    } catch (err) {
        setStatus(String(err && err.message ? err.message : err), true);
    } finally {
        withBusy(false);
    }
});

importBtn.addEventListener('click', () => {
    importFileEl.value = '';
    importFileEl.click();
});

importFileEl.addEventListener('change', async () => {
    const file = importFileEl.files && importFileEl.files[0];
    if (!file) return;
    withBusy(true);
    setStatus('Импортирую историю...');
    try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const { data } = await sendMonitor('monitor:import-db', payload);
        const imported = data && Number.isFinite(data.imported) ? data.imported : 0;
        const products = data && Number.isFinite(data.products) ? data.products : 0;
        setStatus(`Импорт завершен: ${imported} записей, ${products} товаров`);
    } catch (err) {
        setStatus(String(err && err.message ? err.message : err), true);
    } finally {
        withBusy(false);
    }
});

withBusy(true);
setStatus('Загружаю...');
loadDefaults().then(() => {
    return inspectDb();
}).catch((err) => {
    setStatus(String(err && err.message ? err.message : err), true);
}).finally(() => {
    withBusy(false);
});

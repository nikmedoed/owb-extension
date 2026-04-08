'use strict';

const STORAGE_KEYS = {
    mode: 'owb-default-sync-mode',
    url: 'owb-default-server-url',
    restoreSingle: 'owb-export-restore-single',
    restoreBatch: 'owb-export-restore-batch',
    pageMark: 'owb-export-page-mark',
};
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8765';

const syncEnabledEl = document.getElementById('syncEnabled');
const urlEl = document.getElementById('defaultUrl');
const modeTitleEl = document.getElementById('modeTitle');
const setupHelpEl = document.getElementById('setupHelp');
const syncStatusEl = document.getElementById('syncStatus');
const dbStatusEl = document.getElementById('dbStatus');
const restoreSingleEl = document.getElementById('restoreSingle');
const restoreBatchEl = document.getElementById('restoreBatch');
const pageMarkEl = document.getElementById('pageMark');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const exportBtn = document.getElementById('exportBtn');
const importAppendBtn = document.getElementById('importAppendBtn');
const importReplaceBtn = document.getElementById('importReplaceBtn');
const importFileEl = document.getElementById('importFile');
const copyServerCmdBtn = document.getElementById('copyServerCmdBtn');
const inspectMetaEl = document.getElementById('inspectMeta');
const inspectHealthEl = document.getElementById('inspectHealth');
const inspectTotalRecordsEl = document.getElementById('inspectTotalRecords');
const inspectTotalProductsEl = document.getElementById('inspectTotalProducts');
const inspectTotalIntervalsEl = document.getElementById('inspectTotalIntervals');
const inspectAvgPerProductEl = document.getElementById('inspectAvgPerProduct');
const inspectOzonProductsEl = document.getElementById('inspectOzonProducts');
const inspectWbProductsEl = document.getElementById('inspectWbProducts');
const inspectLastActivityEl = document.getElementById('inspectLastActivity');
let pendingImportMode = 'append';

const setStatus = (el, text, isError = false) => {
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? '#b42318' : '#1f2328';
};
const setSyncStatus = (text, isError = false) => setStatus(syncStatusEl, text, isError);
const setDbStatus = (text, isError = false) => setStatus(dbStatusEl, text, isError);

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

const copyTextToClipboard = async (text) => {
    const payload = String(text || '');
    try {
        await navigator.clipboard.writeText(payload);
        return true;
    } catch (_) {}
    const ta = document.createElement('textarea');
    ta.value = payload;
    ta.setAttribute('readonly', 'readonly');
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('Не удалось скопировать команду');
    return true;
};

const withBusy = (busy) => {
    saveBtn.disabled = busy;
    testBtn.disabled = busy;
    exportBtn.disabled = busy;
    importAppendBtn.disabled = busy;
    importReplaceBtn.disabled = busy;
    syncEnabledEl.disabled = busy;
    urlEl.disabled = busy;
    if (restoreSingleEl) restoreSingleEl.disabled = busy;
    if (restoreBatchEl) restoreBatchEl.disabled = busy;
    if (pageMarkEl) pageMarkEl.disabled = busy;
};

const readForm = () => ({
    syncEnabled: !!syncEnabledEl.checked,
    url: urlEl.value.trim(),
    restoreSingle: restoreSingleEl ? !!restoreSingleEl.checked : true,
    restoreBatch: restoreBatchEl ? !!restoreBatchEl.checked : true,
    pageMark: pageMarkEl ? !!pageMarkEl.checked : true,
});
const toMode = (values) => (values.syncEnabled && values.url ? 'sync' : 'local');
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const probeServer = async (baseUrl, timeoutMs = 900) => {
    const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!clean) return false;
    if (!/^https?:\/\//i.test(clean)) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(400, Number(timeoutMs) || 1500));
    try {
        const res = await fetch(`${clean}/ping`, {
            method: 'GET',
            cache: 'no-store',
            credentials: 'omit',
            signal: ctrl.signal,
        });
        if (!res.ok) return false;
        const data = await res.json().catch(() => null);
        return !!(data && data.status === 'ok');
    } catch (_) {
        return false;
    } finally {
        clearTimeout(timer);
    }
};

const renderModeTitle = () => {
    modeTitleEl.textContent = syncEnabledEl.checked ? 'режим: sync' : 'режим: local';
};

const applySyncState = (state) => {
    switch (state) {
    case 'disabled':
        setSyncStatus('Синхронизация выключена.');
        setupHelpEl.hidden = true;
        return;
    case 'empty-url':
        setSyncStatus('Адрес сервера пустой. Синхронизации не будет.', true);
        setupHelpEl.hidden = false;
        return;
    case 'reachable':
        setSyncStatus('Сервер доступен. Синхронизация работает.');
        setupHelpEl.hidden = true;
        return;
    case 'unreachable':
        setSyncStatus('Сервер недоступен. Синхронизации не будет.', true);
        setupHelpEl.hidden = false;
        return;
    case 'not-checked':
    default:
        setSyncStatus('Сервер не проверен. Проверка при сохранении или по кнопке.');
        setupHelpEl.hidden = true;
        return;
    }
};

const resolveSyncStateNoProbe = () => {
    const values = readForm();
    if (!values.syncEnabled) return 'disabled';
    if (!values.url) return 'empty-url';
    return 'not-checked';
};

const resolveSyncStateWithProbe = async () => {
    const values = readForm();
    if (!values.syncEnabled) return 'disabled';
    if (!values.url) return 'empty-url';
    const reachable = await probeServer(values.url);
    return reachable ? 'reachable' : 'unreachable';
};
const resolveProbeStateAny = async () => {
    const values = readForm();
    if (!values.url) return 'empty-url';
    const reachable = await probeServer(values.url);
    return reachable ? 'reachable' : 'unreachable';
};

const loadDefaults = async () => {
    const saved = await storageGet([
        STORAGE_KEYS.mode,
        STORAGE_KEYS.url,
        STORAGE_KEYS.restoreSingle,
        STORAGE_KEYS.restoreBatch,
        STORAGE_KEYS.pageMark,
    ]);
    const savedMode = hasOwn(saved, STORAGE_KEYS.mode) ? saved[STORAGE_KEYS.mode] : '';
    const savedUrl = hasOwn(saved, STORAGE_KEYS.url) ? String(saved[STORAGE_KEYS.url] || '').trim() : '';
    urlEl.value = savedUrl || DEFAULT_SERVER_URL;
    syncEnabledEl.checked = savedMode === 'sync' && !!savedUrl;
    if (restoreSingleEl) {
        restoreSingleEl.checked = hasOwn(saved, STORAGE_KEYS.restoreSingle)
            ? !!saved[STORAGE_KEYS.restoreSingle]
            : true;
    }
    if (restoreBatchEl) {
        restoreBatchEl.checked = hasOwn(saved, STORAGE_KEYS.restoreBatch)
            ? !!saved[STORAGE_KEYS.restoreBatch]
            : true;
    }
    if (pageMarkEl) {
        pageMarkEl.checked = hasOwn(saved, STORAGE_KEYS.pageMark)
            ? !!saved[STORAGE_KEYS.pageMark]
            : true;
    }
    renderModeTitle();
    applySyncState(resolveSyncStateNoProbe());
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

const formatNumber = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('ru-RU');
};
const formatTs = (ts) => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return new Date(n).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const PRICE_DB = {
    name: 'owb-price-history-ext',
    version: 1,
    intervals: 'intervals',
    products: 'products',
};
const toInt = (value, fallback = 0) => {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) ? n : fallback;
};
const idbReq = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});
const txDone = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
});
const openLocalPriceDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(PRICE_DB.name, PRICE_DB.version);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Не удалось открыть IndexedDB'));
});
const countByPidPrefix = (store, prefix) => new Promise((resolve) => {
    const start = String(prefix || '').trim();
    if (!start) {
        resolve(0);
        return;
    }
    let req = null;
    try {
        const range = IDBKeyRange.bound(start, `${start}\uffff`);
        req = store.count(range);
    } catch (_) {
        resolve(0);
        return;
    }
    req.onsuccess = () => resolve(Number(req.result) || 0);
    req.onerror = () => resolve(0);
});
const readLastUpdatedTs = (store) => new Promise((resolve) => {
    let req = null;
    try {
        if (store.indexNames && Array.from(store.indexNames).includes('byUpdated')) {
            req = store.index('byUpdated').openCursor(null, 'prev');
        }
    } catch (_) {}
    if (!req) req = store.openCursor(null, 'prev');
    req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
            resolve(0);
            return;
        }
        const item = cursor.value || {};
        resolve(Math.max(toInt(item.updatedAt, 0), toInt(item.lastTs, 0)));
    };
    req.onerror = () => resolve(0);
});
const inspectDbDirect = async () => {
    const db = await openLocalPriceDb();
    try {
        const hasProducts = db.objectStoreNames.contains(PRICE_DB.products);
        const hasIntervals = db.objectStoreNames.contains(PRICE_DB.intervals);
        if (!hasProducts && !hasIntervals) {
            return {
                schema: 'owb-price-history-ext-v1',
                inspectedAt: Date.now(),
                dbName: PRICE_DB.name,
                dbVersion: db.version || PRICE_DB.version,
                counts: { products: 0, intervals: 0 },
                totals: { avgIntervalsPerProduct: 0, lastActivityTs: 0 },
                marketStats: [],
                newestProducts: [],
                newestIntervals: [],
            };
        }

        const txStores = [hasProducts ? PRICE_DB.products : null, hasIntervals ? PRICE_DB.intervals : null].filter(Boolean);
        const tx = db.transaction(txStores, 'readonly');
        const productsStore = hasProducts ? tx.objectStore(PRICE_DB.products) : null;
        const intervalsStore = hasIntervals ? tx.objectStore(PRICE_DB.intervals) : null;

        const productsCountPromise = productsStore ? idbReq(productsStore.count()) : Promise.resolve(0);
        const intervalsCountPromise = intervalsStore ? idbReq(intervalsStore.count()) : Promise.resolve(0);
        const ozonProductsPromise = productsStore ? countByPidPrefix(productsStore, 'ozon:') : Promise.resolve(0);
        const wbProductsPromise = productsStore ? countByPidPrefix(productsStore, 'wb:') : Promise.resolve(0);
        const productsLastTsPromise = productsStore ? readLastUpdatedTs(productsStore) : Promise.resolve(0);
        const intervalsLastTsPromise = intervalsStore ? readLastUpdatedTs(intervalsStore) : Promise.resolve(0);

        const [productsCountRaw, intervalsCountRaw, ozonProductsRaw, wbProductsRaw, productsLastTsRaw, intervalsLastTsRaw] = await Promise.all([
            productsCountPromise,
            intervalsCountPromise,
            ozonProductsPromise,
            wbProductsPromise,
            productsLastTsPromise,
            intervalsLastTsPromise,
        ]);
        await txDone(tx);

        const productsCount = Number(productsCountRaw) || 0;
        const intervalsCount = Number(intervalsCountRaw) || 0;
        const ozonProducts = Number(ozonProductsRaw) || 0;
        const wbProducts = Number(wbProductsRaw) || 0;
        const unknownProducts = Math.max(0, productsCount - ozonProducts - wbProducts);
        const productsLastTs = Number(productsLastTsRaw) || 0;
        const intervalsLastTs = Number(intervalsLastTsRaw) || 0;
        const lastActivityTs = Math.max(productsLastTs, intervalsLastTs);
        const marketStats = [
            { market: 'ozon', products: ozonProducts, intervals: 0, lastUpdatedTs: productsLastTs },
            { market: 'wb', products: wbProducts, intervals: 0, lastUpdatedTs: productsLastTs },
        ];
        if (unknownProducts > 0) {
            marketStats.push({ market: 'unknown', products: unknownProducts, intervals: 0, lastUpdatedTs: productsLastTs });
        }

        return {
            schema: 'owb-price-history-ext-v1',
            inspectedAt: Date.now(),
            dbName: PRICE_DB.name,
            dbVersion: db.version,
            counts: {
                products: productsCount,
                intervals: intervalsCount,
            },
            totals: {
                avgIntervalsPerProduct: productsCount > 0 ? Number((intervalsCount / productsCount).toFixed(2)) : 0,
                lastActivityTs,
            },
            marketStats,
            newestProducts: [],
            newestIntervals: [],
        };
    } finally {
        db.close();
    }
};

const renderInspect = (data) => {
    const counts = data && data.counts ? data.counts : {};
    const totals = data && data.totals ? data.totals : {};
    const marketStats = Array.isArray(data?.marketStats) ? data.marketStats : [];
    const productsCount = Number(counts.products) || 0;
    const intervalsCount = Number(counts.intervals) || 0;
    const totalRecords = productsCount + intervalsCount;
    const avgIntervalsPerProduct = Number.isFinite(Number(totals.avgIntervalsPerProduct))
        ? Number(totals.avgIntervalsPerProduct)
        : (productsCount > 0 ? (intervalsCount / productsCount) : 0);
    const lastActivityTs = Number(totals.lastActivityTs) || 0;

    inspectMetaEl.textContent = `${data?.dbName || 'owb-price-history-ext'} v${data?.dbVersion || 1}`;

    if (inspectTotalRecordsEl) inspectTotalRecordsEl.textContent = formatNumber(totalRecords);
    inspectTotalProductsEl.textContent = formatNumber(productsCount);
    inspectTotalIntervalsEl.textContent = formatNumber(intervalsCount);
    inspectAvgPerProductEl.textContent = productsCount > 0 ? avgIntervalsPerProduct.toFixed(2) : '0';
    const marketMap = new Map(marketStats.map((item) => [String(item.market || '').toLowerCase(), item]));
    const ozonProducts = Number(marketMap.get('ozon')?.products || 0);
    const wbProducts = Number(marketMap.get('wb')?.products || 0);
    const ozonShare = productsCount > 0 ? (ozonProducts / productsCount) * 100 : 0;
    const wbShare = productsCount > 0 ? (wbProducts / productsCount) * 100 : 0;
    if (inspectOzonProductsEl) inspectOzonProductsEl.textContent = `${formatNumber(ozonProducts)} (${ozonShare.toFixed(1)}%)`;
    if (inspectWbProductsEl) inspectWbProductsEl.textContent = `${formatNumber(wbProducts)} (${wbShare.toFixed(1)}%)`;
    if (inspectLastActivityEl) {
        const formatted = formatTs(lastActivityTs);
        inspectLastActivityEl.textContent = formatted;
        inspectLastActivityEl.title = formatted;
    }
    inspectHealthEl.textContent = totalRecords > 0 ? 'OK' : 'Пусто';
};

const inspectDb = async () => {
    withBusy(true);
    try {
        const data = await inspectDbDirect();
        renderInspect(data || {});
        setDbStatus('');
    } catch (err) {
        const message = String(err && err.message ? err.message : err);
        setDbStatus(message, true);
        inspectMetaEl.textContent = 'Не удалось прочитать БД расширения';
        inspectHealthEl.textContent = 'Ошибка';
        if (inspectTotalRecordsEl) inspectTotalRecordsEl.textContent = '—';
        inspectTotalProductsEl.textContent = '—';
        inspectTotalIntervalsEl.textContent = '—';
        inspectAvgPerProductEl.textContent = '—';
        if (inspectOzonProductsEl) inspectOzonProductsEl.textContent = '—';
        if (inspectWbProductsEl) inspectWbProductsEl.textContent = '—';
        if (inspectLastActivityEl) inspectLastActivityEl.textContent = '—';
    } finally {
        withBusy(false);
    }
};

saveBtn.addEventListener('click', async () => {
    withBusy(true);
    setSyncStatus('Сохраняю...');
    try {
        const values = readForm();
        const mode = toMode(values);
        await storageSet({
            [STORAGE_KEYS.mode]: mode,
            [STORAGE_KEYS.url]: values.url,
            [STORAGE_KEYS.restoreSingle]: !!values.restoreSingle,
            [STORAGE_KEYS.restoreBatch]: !!values.restoreBatch,
            [STORAGE_KEYS.pageMark]: !!values.pageMark,
        });
        await sendMonitor('monitor:set-config', {
            mode,
            url: values.url,
        });
        renderModeTitle();
        const state = await resolveSyncStateWithProbe();
        applySyncState(state);
    } catch (err) {
        setSyncStatus(String(err && err.message ? err.message : err), true);
    } finally {
        withBusy(false);
    }
});

testBtn.addEventListener('click', async () => {
    withBusy(true);
    setSyncStatus('Проверяю сервер...');
    try {
        renderModeTitle();
        const probeState = await resolveProbeStateAny();
        if (probeState === 'empty-url') {
            applySyncState('empty-url');
            return;
        }
        if (probeState === 'reachable') {
            setSyncStatus(syncEnabledEl.checked ? 'Сервер доступен. Синхронизация работает.' : 'Сервер доступен. Синхронизация выключена.');
            setupHelpEl.hidden = true;
            return;
        }
        setSyncStatus(syncEnabledEl.checked ? 'Сервер недоступен. Синхронизации не будет.' : 'Сервер недоступен.', true);
        setupHelpEl.hidden = false;
    } catch (err) {
        setSyncStatus(String(err && err.message ? err.message : err), true);
    } finally {
        withBusy(false);
    }
});

exportBtn.addEventListener('click', async () => {
    withBusy(true);
    setDbStatus('Экспортирую историю...');
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
        setDbStatus('Экспорт сохранен');
    } catch (err) {
        setDbStatus(String(err && err.message ? err.message : err), true);
    } finally {
        withBusy(false);
    }
});

importAppendBtn.addEventListener('click', () => {
    pendingImportMode = 'append';
    importFileEl.value = '';
    importFileEl.click();
});

importReplaceBtn.addEventListener('click', () => {
    pendingImportMode = 'replace';
    importFileEl.value = '';
    importFileEl.click();
});

importFileEl.addEventListener('change', async () => {
    const file = importFileEl.files && importFileEl.files[0];
    if (!file) return;
    withBusy(true);
    setDbStatus('Импортирую историю...');
    try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const mode = pendingImportMode === 'replace' ? 'replace' : 'append';
        const { data } = await sendMonitor('monitor:import-db', { mode, data: payload });
        const imported = data && Number.isFinite(data.imported) ? data.imported : 0;
        const products = data && Number.isFinite(data.products) ? data.products : 0;
        const modeText = mode === 'replace' ? 'замена' : 'дополнение';
        await inspectDb();
        setDbStatus(`Импорт (${modeText}) завершен: ${imported} записей, ${products} товаров`);
    } catch (err) {
        setDbStatus(String(err && err.message ? err.message : err), true);
    } finally {
        withBusy(false);
    }
});

syncEnabledEl.addEventListener('change', () => {
    renderModeTitle();
    applySyncState(resolveSyncStateNoProbe());
});
urlEl.addEventListener('input', () => {
    applySyncState(resolveSyncStateNoProbe());
});
if (copyServerCmdBtn) {
    copyServerCmdBtn.addEventListener('click', async () => {
        try {
            await copyTextToClipboard('python local_price_server.py');
            setSyncStatus('Команда скопирована.');
        } catch (err) {
            setSyncStatus(String(err && err.message ? err.message : err), true);
        }
    });
}

withBusy(true);
loadDefaults().then(() => {
    return inspectDb();
}).catch((err) => {
    setSyncStatus(String(err && err.message ? err.message : err), true);
}).finally(() => {
    withBusy(false);
});

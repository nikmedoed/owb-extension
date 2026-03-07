'use strict';

const DEFAULT_DOWNLOAD_NAME = 'export.txt';
const PRICE_DB = {
    name: 'owb-price-history-ext',
    version: 1,
    intervals: 'intervals',
    products: 'products',
};
const CONFIG_KEYS = {
    mode: 'owb-default-sync-mode',
    url: 'owb-default-server-url',
    cursor: 'owb-default-sync-cursor',
    pullCursor: 'owb-sync-pull-cursor',
    pullCursorId: 'owb-sync-pull-cursor-id',
    pushCursor: 'owb-sync-push-cursor',
    pushCursorKey: 'owb-sync-push-cursor-key',
    lastSyncTs: 'owb-sync-last-ts',
};
const SYNC_CFG = {
    requestTimeoutMs: 1800,
    maxPushBatch: 800,
    maxPullBatch: 1200,
    maxSyncLoops: 12,
    autoSyncCooldownMs: 15000,
    minFetchTtlMs: 20000,
    historyFetchTtlMs: 15000,
};
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8765';

const sanitizeFilename = (name) => {
    const base = String(name || DEFAULT_DOWNLOAD_NAME).trim() || DEFAULT_DOWNLOAD_NAME;
    const safe = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
    return safe || DEFAULT_DOWNLOAD_NAME;
};
const asNumber = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const toInt = (value, fallback = 0) => {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) ? n : fallback;
};
const eq = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;
const now = () => Date.now();
const priceNorm = (value) => Math.round(Number(value) * 10000);

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
const storageSet = (payload) => new Promise((resolve, reject) => {
    chrome.storage.local.set(payload, () => {
        const err = chrome.runtime.lastError;
        if (err) {
            reject(new Error(err.message || 'Storage set failed'));
            return;
        }
        resolve(true);
    });
});

const downloadFile = (options) => new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
        const err = chrome.runtime.lastError;
        if (err) {
            reject(new Error(err.message || 'Download failed'));
            return;
        }
        resolve(downloadId);
    });
});

const handleDownloadText = async (message) => {
    const filename = sanitizeFilename(message.name);
    const text = String(message.text || '');
    const url = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
    const downloadId = await downloadFile({
        url,
        filename,
        saveAs: false,
        conflictAction: 'uniquify',
    });
    return { ok: true, downloadId };
};

const handleJsonRequest = async (message) => {
    const method = String(message.method || 'GET').toUpperCase();
    const url = String(message.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Invalid URL' };

    const timeoutMs = Math.max(300, asNumber(message.timeout, 2500));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
        const hasBody = message.body !== null && message.body !== undefined;
        const res = await fetch(url, {
            method,
            headers: hasBody ? { 'Content-Type': 'application/json' } : {},
            body: hasBody ? JSON.stringify(message.body) : undefined,
            signal: ctrl.signal,
            cache: 'no-store',
            credentials: 'omit',
        });
        const text = await res.text();
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status, text };
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (_) {
            data = null;
        }
        return { ok: true, data, status: res.status };
    } catch (err) {
        const timeout = err && err.name === 'AbortError';
        return { ok: false, error: timeout ? 'timeout' : String(err && err.message ? err.message : err) };
    } finally {
        clearTimeout(timer);
    }
};

const trimServerUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
const makeServerUrl = (baseUrl, path) => `${trimServerUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
const serverFetchJson = async (baseUrl, path, options = {}) => {
    const url = makeServerUrl(baseUrl, path);
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'invalid-server-url' };
    const method = String(options.method || 'GET').toUpperCase();
    const timeoutMs = Math.max(350, asNumber(options.timeoutMs, SYNC_CFG.requestTimeoutMs));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const hasBody = options.body !== null && options.body !== undefined;
        const response = await fetch(url, {
            method,
            headers: hasBody ? { 'Content-Type': 'application/json' } : {},
            body: hasBody ? JSON.stringify(options.body) : undefined,
            signal: ctrl.signal,
            cache: 'no-store',
            credentials: 'omit',
        });
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (_) {
            data = null;
        }
        if (!response.ok) return { ok: false, error: `HTTP ${response.status}`, status: response.status, data };
        return { ok: true, status: response.status, data };
    } catch (err) {
        const timeout = err && err.name === 'AbortError';
        return { ok: false, error: timeout ? 'timeout' : String(err && err.message ? err.message : err) };
    } finally {
        clearTimeout(timer);
    }
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

const ensurePriceDbSchema = (db, tx) => {
    const hasStore = (name) => db.objectStoreNames.contains(name);
    const getStore = (name) => {
        try {
            return tx ? tx.objectStore(name) : null;
        } catch (_) {
            return null;
        }
    };
    const hasIndex = (store, name) => {
        try {
            return !!store.indexNames && Array.from(store.indexNames).includes(name);
        } catch (_) {
            return false;
        }
    };
    const ensureIndex = (store, name, keyPath) => {
        if (!store) return;
        if (hasIndex(store, name)) return;
        store.createIndex(name, keyPath, { unique: false });
    };

    if (!hasStore(PRICE_DB.intervals)) {
        const store = db.createObjectStore(PRICE_DB.intervals, { keyPath: 'key' });
        store.createIndex('byPidFirst', ['pidKey', 'firstTs'], { unique: false });
        store.createIndex('byPidLast', ['pidKey', 'lastTs'], { unique: false });
        store.createIndex('byUpdated', 'updatedAt', { unique: false });
    } else {
        const store = getStore(PRICE_DB.intervals);
        ensureIndex(store, 'byPidFirst', ['pidKey', 'firstTs']);
        ensureIndex(store, 'byPidLast', ['pidKey', 'lastTs']);
        ensureIndex(store, 'byUpdated', 'updatedAt');
    }

    if (!hasStore(PRICE_DB.products)) {
        const store = db.createObjectStore(PRICE_DB.products, { keyPath: 'pidKey' });
        store.createIndex('byUpdated', 'updatedAt', { unique: false });
    } else {
        ensureIndex(getStore(PRICE_DB.products), 'byUpdated', 'updatedAt');
    }
};

let priceDbPromise = null;
const openPriceDb = () => {
    if (priceDbPromise) return priceDbPromise;
    priceDbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(PRICE_DB.name, PRICE_DB.version);
        req.onupgradeneeded = () => {
            ensurePriceDbSchema(req.result, req.transaction);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }).catch((err) => {
        priceDbPromise = null;
        throw err;
    });
    return priceDbPromise;
};

const normalizePriceRecord = (raw) => {
    if (!raw) return null;
    const pidKey = String(raw.pidKey || '').trim();
    const price = Number(raw.price);
    if (!pidKey || !Number.isFinite(price)) return null;
    const ts = toInt(raw.ts, now());
    const pid = String(raw.pid || '');
    const currency = String(raw.currency || '');
    const market = String(raw.market || pidKey.split(':')[0] || '');
    return { pidKey, pid, price, currency, ts, market };
};

const normalizeIntervalRecord = (raw) => {
    if (!raw) return null;
    const pidKey = String(raw.pidKey || '').trim();
    const price = Number(raw.price);
    const firstTs = toInt(raw.firstTs != null ? raw.firstTs : raw.ts, NaN);
    const lastTs = toInt(raw.lastTs != null ? raw.lastTs : raw.ts, NaN);
    if (!pidKey || !Number.isFinite(price) || !Number.isFinite(firstTs) || !Number.isFinite(lastTs)) return null;
    return {
        pidKey,
        pid: String(raw.pid || ''),
        currency: String(raw.currency || ''),
        price,
        firstTs: Math.min(firstTs, lastTs),
        lastTs: Math.max(firstTs, lastTs),
    };
};

const makeIntervalKey = (record) => `${record.pidKey}:${record.ts}:${priceNorm(record.price)}:${Math.random().toString(36).slice(2, 9)}`;

const capturePriceBatch = async (records) => {
    const clean = (Array.isArray(records) ? records : [])
        .map(normalizePriceRecord)
        .filter(Boolean)
        .sort((a, b) => a.ts - b.ts);
    if (!clean.length) return { captured: 0, created: 0, touched: 0, products: 0 };

    const db = await openPriceDb();
    const tx = db.transaction([PRICE_DB.intervals, PRICE_DB.products], 'readwrite');
    const intervalsStore = tx.objectStore(PRICE_DB.intervals);
    const productsStore = tx.objectStore(PRICE_DB.products);

    const stateCache = new Map();
    const intervalCache = new Map();
    const dirtyStates = new Set();
    const dirtyIntervals = new Set();
    let created = 0;
    let touched = 0;

    const getState = async (pidKey) => {
        if (stateCache.has(pidKey)) return stateCache.get(pidKey);
        const state = await idbReq(productsStore.get(pidKey));
        stateCache.set(pidKey, state || null);
        return state || null;
    };
    const getInterval = async (key) => {
        if (!key) return null;
        if (intervalCache.has(key)) return intervalCache.get(key);
        const interval = await idbReq(intervalsStore.get(key));
        intervalCache.set(key, interval || null);
        return interval || null;
    };

    for (const record of clean) {
        const touchedAt = now();
        let state = await getState(record.pidKey);
        let tailInterval = null;
        if (state && state.lastIntervalKey && eq(state.lastPrice, record.price) && String(state.lastCurrency || '') === record.currency) {
            tailInterval = await getInterval(state.lastIntervalKey);
        }

        if (tailInterval) {
            tailInterval.lastTs = Math.max(toInt(tailInterval.lastTs, record.ts), record.ts);
            tailInterval.updatedAt = touchedAt;
            intervalCache.set(tailInterval.key, tailInterval);
            dirtyIntervals.add(tailInterval.key);
            touched += 1;

            state.lastTs = Math.max(toInt(state.lastTs, record.ts), record.ts);
            state.updatedAt = touchedAt;
            state.pid = record.pid || state.pid || '';
            if (state.minIntervalKey === tailInterval.key) {
                state.minLastTs = Math.max(toInt(state.minLastTs, tailInterval.lastTs), tailInterval.lastTs);
            }
            stateCache.set(record.pidKey, state);
            dirtyStates.add(record.pidKey);
            continue;
        }

        const key = makeIntervalKey(record);
        const interval = {
            key,
            pidKey: record.pidKey,
            pid: record.pid,
            market: record.market,
            price: record.price,
            priceNorm: priceNorm(record.price),
            currency: record.currency,
            firstTs: record.ts,
            lastTs: record.ts,
            updatedAt: touchedAt,
        };
        intervalCache.set(key, interval);
        dirtyIntervals.add(key);
        created += 1;

        if (!state) {
            state = {
                pidKey: record.pidKey,
                pid: record.pid || '',
                market: record.market || '',
                createdAt: touchedAt,
            };
        }
        state.lastIntervalKey = key;
        state.lastPrice = record.price;
        state.lastCurrency = record.currency;
        state.lastTs = record.ts;
        state.updatedAt = touchedAt;
        if (!Number.isFinite(Number(state.minPrice)) || record.price < Number(state.minPrice)) {
            state.minPrice = record.price;
            state.minCurrency = record.currency;
            state.minIntervalKey = key;
            state.minFirstTs = record.ts;
            state.minLastTs = record.ts;
        } else if (eq(record.price, Number(state.minPrice))) {
            state.minFirstTs = state.minFirstTs ? Math.min(state.minFirstTs, record.ts) : record.ts;
            state.minLastTs = state.minLastTs ? Math.max(state.minLastTs, record.ts) : record.ts;
        }
        stateCache.set(record.pidKey, state);
        dirtyStates.add(record.pidKey);
    }

    for (const key of dirtyIntervals) {
        const interval = intervalCache.get(key);
        if (interval) intervalsStore.put(interval);
    }
    for (const pidKey of dirtyStates) {
        const state = stateCache.get(pidKey);
        if (state) productsStore.put(state);
    }

    await txDone(tx);
    return {
        captured: clean.length,
        created,
        touched,
        products: dirtyStates.size,
    };
};

const getIntervalsByPid = async (pidKey, limit = 2000) => {
    const cleanPidKey = String(pidKey || '').trim();
    if (!cleanPidKey) return [];
    const db = await openPriceDb();
    const tx = db.transaction(PRICE_DB.intervals, 'readonly');
    const store = tx.objectStore(PRICE_DB.intervals);
    const idx = store.index('byPidFirst');
    const range = IDBKeyRange.bound([cleanPidKey, 0], [cleanPidKey, Number.MAX_SAFE_INTEGER]);
    const out = [];
    await new Promise((resolve, reject) => {
        const req = idx.openCursor(range, 'next');
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor || out.length >= limit) {
                resolve(true);
                return;
            }
            out.push(cursor.value);
            cursor.continue();
        };
        req.onerror = () => reject(req.error);
    });
    await txDone(tx);
    return out;
};

const getMinBatch = async (pidKeys) => {
    const keys = [...new Set((Array.isArray(pidKeys) ? pidKeys : []).map((k) => String(k || '').trim()).filter(Boolean))];
    if (!keys.length) return {};
    const db = await openPriceDb();
    const tx = db.transaction(PRICE_DB.products, 'readonly');
    const store = tx.objectStore(PRICE_DB.products);
    const out = {};
    for (const pidKey of keys) {
        const state = await idbReq(store.get(pidKey));
        if (!state || !Number.isFinite(Number(state.minPrice))) continue;
        out[pidKey] = {
            pidKey,
            price: Number(state.minPrice),
            currency: String(state.minCurrency || ''),
            firstTs: toInt(state.minFirstTs, 0),
            lastTs: toInt(state.minLastTs, 0),
        };
    }
    await txDone(tx);
    return out;
};

const getIntervalsUpdatedSince = async (sinceTs = 0, sinceKey = '', limit = SYNC_CFG.maxPushBatch) => {
    const since = Math.max(0, toInt(sinceTs, 0));
    const sinceRowKey = String(sinceKey || '');
    const max = Math.max(1, Math.min(5000, toInt(limit, SYNC_CFG.maxPushBatch)));
    const db = await openPriceDb();
    const tx = db.transaction(PRICE_DB.intervals, 'readonly');
    const store = tx.objectStore(PRICE_DB.intervals);
    const idx = store.index('byUpdated');
    const range = IDBKeyRange.lowerBound(since);
    const out = [];
    await new Promise((resolve, reject) => {
        const req = idx.openCursor(range, 'next');
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor || out.length >= max) {
                resolve(true);
                return;
            }
            const row = cursor.value || {};
            const updatedTs = toInt(row.updatedAt, 0);
            const rowKey = String(row.key || '');
            if (updatedTs < since || (updatedTs === since && sinceRowKey && rowKey <= sinceRowKey)) {
                cursor.continue();
                return;
            }
            out.push({
                key: rowKey,
                pidKey: String(row.pidKey || ''),
                pid: String(row.pid || ''),
                market: String(row.market || ''),
                price: Number(row.price),
                currency: String(row.currency || ''),
                firstTs: toInt(row.firstTs, 0),
                lastTs: toInt(row.lastTs, 0),
                updatedTs,
            });
            cursor.continue();
        };
        req.onerror = () => reject(req.error);
    });
    await txDone(tx);
    return out.filter((row) => row.key && row.pidKey && Number.isFinite(row.price) && row.firstTs > 0 && row.lastTs > 0);
};

const normalizeSyncInterval = (raw) => {
    if (!raw) return null;
    const pidKey = String(raw.pidKey || raw.pid_key || '').trim();
    if (!pidKey) return null;
    const price = Number(raw.price);
    if (!Number.isFinite(price)) return null;
    const firstTs = toInt(raw.firstTs != null ? raw.firstTs : raw.first_ts, NaN);
    const lastTs = toInt(raw.lastTs != null ? raw.lastTs : raw.last_ts, NaN);
    if (!Number.isFinite(firstTs) || !Number.isFinite(lastTs)) return null;
    const minTs = Math.min(firstTs, lastTs);
    const maxTs = Math.max(firstTs, lastTs);
    return {
        pidKey,
        pid: String(raw.pid || ''),
        market: String(raw.market || pidKey.split(':')[0] || ''),
        price,
        currency: String(raw.currency || ''),
        firstTs: minTs,
        lastTs: maxTs,
        updatedAt: Math.max(toInt(raw.updatedAt != null ? raw.updatedAt : raw.updatedTs, 0), 0),
    };
};

const makeIntervalKeyFromRange = (record) => `${record.pidKey}:${record.firstTs}:${priceNorm(record.price)}:${Math.random().toString(36).slice(2, 9)}`;

const upsertIntervalsFromSync = async (records) => {
    const normalized = (Array.isArray(records) ? records : [])
        .map(normalizeSyncInterval)
        .filter(Boolean)
        .sort((a, b) => {
            const byPid = String(a.pidKey).localeCompare(String(b.pidKey));
            if (byPid !== 0) return byPid;
            return toInt(a.firstTs, 0) - toInt(b.firstTs, 0);
        });
    if (!normalized.length) return { accepted: 0, inserted: 0, merged: 0, updated: 0, products: 0 };

    const db = await openPriceDb();
    const tx = db.transaction([PRICE_DB.intervals, PRICE_DB.products], 'readwrite');
    const intervalsStore = tx.objectStore(PRICE_DB.intervals);
    const productsStore = tx.objectStore(PRICE_DB.products);
    const idxByPid = intervalsStore.index('byPidFirst');

    const intervalsByPid = new Map();
    const affectedPidKeys = new Set();
    let inserted = 0;
    let merged = 0;
    let updated = 0;

    const loadPidIntervals = async (pidKey) => {
        if (intervalsByPid.has(pidKey)) return intervalsByPid.get(pidKey);
        const range = IDBKeyRange.bound([pidKey, 0], [pidKey, Number.MAX_SAFE_INTEGER]);
        const list = await idbReq(idxByPid.getAll(range));
        const rows = (Array.isArray(list) ? list : []).filter(Boolean).sort((a, b) => {
            const byFirst = toInt(a.firstTs, 0) - toInt(b.firstTs, 0);
            if (byFirst !== 0) return byFirst;
            return toInt(a.lastTs, 0) - toInt(b.lastTs, 0);
        });
        intervalsByPid.set(pidKey, rows);
        return rows;
    };

    const isOverlap = (base, item) => {
        if (!base || !item) return false;
        return toInt(item.lastTs, 0) >= (toInt(base.firstTs, 0) - 1)
            && toInt(item.firstTs, 0) <= (toInt(base.lastTs, 0) + 1);
    };

    for (const rec of normalized) {
        const list = await loadPidIntervals(rec.pidKey);
        const samePrice = list.filter((item) => eq(item.price, rec.price) && String(item.currency || '') === String(rec.currency || ''));
        const overlaps = samePrice.filter((item) => isOverlap(rec, item));
        const touchTs = Math.max(toInt(rec.updatedAt, 0), now());

        if (!overlaps.length) {
            const row = {
                key: makeIntervalKeyFromRange(rec),
                pidKey: rec.pidKey,
                pid: rec.pid || '',
                market: rec.market || rec.pidKey.split(':')[0] || '',
                price: rec.price,
                priceNorm: priceNorm(rec.price),
                currency: rec.currency || '',
                firstTs: rec.firstTs,
                lastTs: rec.lastTs,
                updatedAt: touchTs,
            };
            intervalsStore.put(row);
            list.push(row);
            list.sort((a, b) => toInt(a.firstTs, 0) - toInt(b.firstTs, 0));
            inserted += 1;
        } else {
            const keep = overlaps[0];
            let changed = false;
            let mergedFirst = Math.min(toInt(rec.firstTs, 0), ...overlaps.map((item) => toInt(item.firstTs, 0)));
            let mergedLast = Math.max(toInt(rec.lastTs, 0), ...overlaps.map((item) => toInt(item.lastTs, 0)));
            if (mergedFirst !== toInt(keep.firstTs, 0)) {
                keep.firstTs = mergedFirst;
                changed = true;
            }
            if (mergedLast !== toInt(keep.lastTs, 0)) {
                keep.lastTs = mergedLast;
                changed = true;
            }
            if (rec.pid && !keep.pid) {
                keep.pid = rec.pid;
                changed = true;
            }
            if (!keep.market) {
                keep.market = rec.market || rec.pidKey.split(':')[0] || '';
                changed = true;
            }
            if (touchTs > toInt(keep.updatedAt, 0)) {
                keep.updatedAt = touchTs;
                changed = true;
            }
            if (changed) {
                intervalsStore.put(keep);
                updated += 1;
            }

            const remove = overlaps.slice(1);
            if (remove.length) {
                remove.forEach((item) => {
                    intervalsStore.delete(item.key);
                    const idx = list.findIndex((it) => it.key === item.key);
                    if (idx >= 0) list.splice(idx, 1);
                });
                merged += remove.length;
            }

            let chainMerged = true;
            while (chainMerged) {
                chainMerged = false;
                const chained = list.filter((item) => item.key !== keep.key && eq(item.price, keep.price) && String(item.currency || '') === String(keep.currency || '') && isOverlap(keep, item));
                if (!chained.length) break;
                chained.forEach((item) => {
                    keep.firstTs = Math.min(toInt(keep.firstTs, 0), toInt(item.firstTs, 0));
                    keep.lastTs = Math.max(toInt(keep.lastTs, 0), toInt(item.lastTs, 0));
                    keep.updatedAt = Math.max(toInt(keep.updatedAt, 0), toInt(item.updatedAt, 0), touchTs);
                    if (!keep.pid && item.pid) keep.pid = item.pid;
                    intervalsStore.delete(item.key);
                    const idx = list.findIndex((it) => it.key === item.key);
                    if (idx >= 0) list.splice(idx, 1);
                });
                intervalsStore.put(keep);
                merged += chained.length;
                chainMerged = true;
            }

            const keepIdx = list.findIndex((it) => it.key === keep.key);
            if (keepIdx >= 0) list[keepIdx] = keep;
            else list.push(keep);
            list.sort((a, b) => toInt(a.firstTs, 0) - toInt(b.firstTs, 0));
        }

        affectedPidKeys.add(rec.pidKey);
    }

    for (const pidKey of affectedPidKeys) {
        const list = (await loadPidIntervals(pidKey)).slice().sort((a, b) => {
            const byLast = toInt(a.lastTs, 0) - toInt(b.lastTs, 0);
            if (byLast !== 0) return byLast;
            return toInt(a.firstTs, 0) - toInt(b.firstTs, 0);
        });
        if (!list.length) {
            productsStore.delete(pidKey);
            continue;
        }
        const prev = await idbReq(productsStore.get(pidKey));
        const latest = list[list.length - 1];
        let minInterval = list[0];
        list.forEach((item) => {
            if (Number(item.price) < Number(minInterval.price)) minInterval = item;
            else if (eq(item.price, minInterval.price) && toInt(item.firstTs, 0) < toInt(minInterval.firstTs, 0)) minInterval = item;
        });
        const minPriceValue = Number(minInterval.price);
        let minFirstTs = toInt(minInterval.firstTs, 0);
        let minLastTs = toInt(minInterval.lastTs, 0);
        list.forEach((item) => {
            if (!eq(item.price, minPriceValue)) return;
            minFirstTs = Math.min(minFirstTs, toInt(item.firstTs, 0));
            minLastTs = Math.max(minLastTs, toInt(item.lastTs, 0));
        });
        productsStore.put({
            pidKey,
            pid: String(latest.pid || prev?.pid || ''),
            market: String(latest.market || pidKey.split(':')[0] || prev?.market || ''),
            createdAt: toInt(prev?.createdAt, now()),
            updatedAt: Math.max(
                ...list.map((item) => toInt(item.updatedAt, 0)),
                toInt(prev?.updatedAt, 0),
                now(),
            ),
            lastIntervalKey: String(latest.key || ''),
            lastPrice: Number(latest.price),
            lastCurrency: String(latest.currency || ''),
            lastTs: toInt(latest.lastTs, 0),
            minPrice: minPriceValue,
            minCurrency: String(minInterval.currency || ''),
            minIntervalKey: String(minInterval.key || ''),
            minFirstTs,
            minLastTs,
        });
    }

    await txDone(tx);
    return {
        accepted: normalized.length,
        inserted,
        merged,
        updated,
        products: affectedPidKeys.size,
    };
};

const resetPriceHistoryByPid = async (pidKey) => {
    const cleanPidKey = String(pidKey || '').trim();
    if (!cleanPidKey) return { pidKey: '', deletedIntervals: 0, deletedProduct: false };

    const db = await openPriceDb();
    const tx = db.transaction([PRICE_DB.intervals, PRICE_DB.products], 'readwrite');
    const intervalsStore = tx.objectStore(PRICE_DB.intervals);
    const productsStore = tx.objectStore(PRICE_DB.products);
    const idx = intervalsStore.index('byPidFirst');
    const range = IDBKeyRange.bound([cleanPidKey, 0], [cleanPidKey, Number.MAX_SAFE_INTEGER]);

    let deletedIntervals = 0;
    await new Promise((resolve, reject) => {
        const req = idx.openCursor(range, 'next');
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) {
                resolve(true);
                return;
            }
            intervalsStore.delete(cursor.primaryKey);
            deletedIntervals += 1;
            cursor.continue();
        };
        req.onerror = () => reject(req.error);
    });

    const existingProduct = await idbReq(productsStore.get(cleanPidKey));
    const deletedProduct = !!existingProduct;
    if (deletedProduct) productsStore.delete(cleanPidKey);

    await txDone(tx);
    return { pidKey: cleanPidKey, deletedIntervals, deletedProduct };
};

const readNewestByIndex = (store, indexName, limit = 20) => new Promise((resolve, reject) => {
    const out = [];
    const idx = store.index(indexName);
    const req = idx.openCursor(null, 'prev');
    req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || out.length >= limit) {
            resolve(out);
            return;
        }
        out.push(cursor.value);
        cursor.continue();
    };
    req.onerror = () => reject(req.error);
});

const resolveMarket = (value, pidKey = '') => {
    const direct = String(value || '').trim().toLowerCase();
    if (direct === 'ozon' || direct === 'wb') return direct;
    const prefix = String(pidKey || '').split(':')[0].trim().toLowerCase();
    if (prefix === 'ozon' || prefix === 'wb') return prefix;
    return 'unknown';
};

const collectMarketStats = (store, kind) => new Promise((resolve, reject) => {
    const stats = {};
    const req = store.openCursor();
    req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
            resolve(stats);
            return;
        }
        const item = cursor.value || {};
        const market = resolveMarket(item.market, item.pidKey);
        if (!stats[market]) {
            stats[market] = {
                market,
                products: 0,
                intervals: 0,
                lastUpdatedTs: 0,
            };
        }
        if (kind === 'products') stats[market].products += 1;
        if (kind === 'intervals') stats[market].intervals += 1;
        const updated = toInt(item.updatedAt, 0);
        if (updated > stats[market].lastUpdatedTs) stats[market].lastUpdatedTs = updated;
        cursor.continue();
    };
    req.onerror = () => reject(req.error);
});

const inspectPriceDb = async (opts = {}) => {
    const productLimit = Math.max(1, Math.min(200, toInt(opts.productLimit, 30)));
    const intervalLimit = Math.max(1, Math.min(400, toInt(opts.intervalLimit, 120)));
    const db = await openPriceDb();
    const tx = db.transaction([PRICE_DB.intervals, PRICE_DB.products], 'readonly');
    const intervalsStore = tx.objectStore(PRICE_DB.intervals);
    const productsStore = tx.objectStore(PRICE_DB.products);

    const intervalsCountReq = intervalsStore.count();
    const productsCountReq = productsStore.count();
    const newestProductsPromise = readNewestByIndex(productsStore, 'byUpdated', productLimit);
    const newestIntervalsPromise = readNewestByIndex(intervalsStore, 'byUpdated', intervalLimit);
    const productStatsPromise = collectMarketStats(productsStore, 'products');
    const intervalStatsPromise = collectMarketStats(intervalsStore, 'intervals');

    const [newestProducts, newestIntervals, productStats, intervalStats] = await Promise.all([
        newestProductsPromise,
        newestIntervalsPromise,
        productStatsPromise,
        intervalStatsPromise,
    ]);
    const intervalsCount = await idbReq(intervalsCountReq);
    const productsCount = await idbReq(productsCountReq);
    await txDone(tx);

    const mergedMarketStatsMap = new Map();
    [productStats, intervalStats].forEach((source) => {
        Object.keys(source || {}).forEach((market) => {
            const prev = mergedMarketStatsMap.get(market) || { market, products: 0, intervals: 0, lastUpdatedTs: 0 };
            const next = source[market] || {};
            const merged = {
                market,
                products: Number(prev.products || 0) + Number(next.products || 0),
                intervals: Number(prev.intervals || 0) + Number(next.intervals || 0),
                lastUpdatedTs: Math.max(Number(prev.lastUpdatedTs || 0), Number(next.lastUpdatedTs || 0)),
            };
            merged.avgIntervalsPerProduct = merged.products > 0 ? Number((merged.intervals / merged.products).toFixed(2)) : 0;
            mergedMarketStatsMap.set(market, merged);
        });
    });
    const marketStats = [...mergedMarketStatsMap.values()].sort((a, b) => {
        const rank = { ozon: 1, wb: 2, unknown: 3 };
        return (rank[a.market] || 9) - (rank[b.market] || 9);
    });
    const totalProducts = Number(productsCount) || 0;
    const totalIntervals = Number(intervalsCount) || 0;
    const lastActivityTs = marketStats.reduce((maxTs, item) => Math.max(maxTs, Number(item.lastUpdatedTs) || 0), 0);

    return {
        schema: 'owb-price-history-ext-v1',
        inspectedAt: now(),
        dbName: PRICE_DB.name,
        dbVersion: db.version,
        counts: {
            products: totalProducts,
            intervals: totalIntervals,
        },
        totals: {
            avgIntervalsPerProduct: totalProducts > 0 ? Number((totalIntervals / totalProducts).toFixed(2)) : 0,
            lastActivityTs,
        },
        marketStats,
        newestProducts,
        newestIntervals,
    };
};

const exportPriceDb = async () => {
    const db = await openPriceDb();
    const tx = db.transaction([PRICE_DB.intervals, PRICE_DB.products], 'readonly');
    const intervals = await idbReq(tx.objectStore(PRICE_DB.intervals).getAll());
    const products = await idbReq(tx.objectStore(PRICE_DB.products).getAll());
    await txDone(tx);
    return {
        schema: 'owb-price-history-ext-v1',
        exportedAt: now(),
        dbName: PRICE_DB.name,
        dbVersion: db.version,
        intervals: { count: intervals.length, records: intervals },
        products: { count: products.length, records: products },
    };
};

const clearPriceDb = async () => {
    const db = await openPriceDb();
    const tx = db.transaction([PRICE_DB.intervals, PRICE_DB.products], 'readwrite');
    tx.objectStore(PRICE_DB.intervals).clear();
    tx.objectStore(PRICE_DB.products).clear();
    await txDone(tx);
};

const importPriceDb = async (payload) => {
    const mode = payload?.mode === 'replace' ? 'replace' : 'append';
    const source = payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
        ? payload.data
        : payload;
    const events = [];
    const addEvent = (raw) => {
        const n = normalizePriceRecord(raw);
        if (n) events.push(n);
    };
    const addIntervalAsEvents = (raw) => {
        const n = normalizeIntervalRecord(raw);
        if (!n) return;
        addEvent({ pidKey: n.pidKey, pid: n.pid, price: n.price, currency: n.currency, ts: n.firstTs });
        if (n.lastTs !== n.firstTs) addEvent({ pidKey: n.pidKey, pid: n.pid, price: n.price, currency: n.currency, ts: n.lastTs });
    };

    const snapshots = [
        source?.prices?.records,
        source?.snapshots,
        source?.history,
        source?.records,
    ];
    snapshots.forEach((list) => {
        if (Array.isArray(list)) list.forEach(addEvent);
    });
    if (Array.isArray(source?.intervals?.records)) source.intervals.records.forEach(addIntervalAsEvents);

    events.sort((a, b) => a.ts - b.ts);
    if (mode === 'replace') {
        await clearPriceDb();
    }
    const stats = await capturePriceBatch(events);
    return {
        mode,
        imported: events.length,
        created: stats.created,
        touched: stats.touched,
        products: stats.products,
    };
};

const SYNC_STATE = {
    running: false,
    lastAutoAttemptTs: 0,
    lastResult: null,
    minFetchedAt: new Map(),
    historyFetchedAt: new Map(),
};

const loadSyncConfig = async () => {
    const raw = await storageGet([
        CONFIG_KEYS.mode,
        CONFIG_KEYS.url,
        CONFIG_KEYS.cursor,
        CONFIG_KEYS.pullCursor,
        CONFIG_KEYS.pullCursorId,
        CONFIG_KEYS.pushCursor,
        CONFIG_KEYS.pushCursorKey,
        CONFIG_KEYS.lastSyncTs,
    ]);
    const mode = raw[CONFIG_KEYS.mode] === 'sync' ? 'sync' : 'local';
    const rawUrl = Object.prototype.hasOwnProperty.call(raw || {}, CONFIG_KEYS.url)
        ? raw[CONFIG_KEYS.url]
        : DEFAULT_SERVER_URL;
    const serverUrl = trimServerUrl(rawUrl || '');
    const legacyCursor = toInt(raw[CONFIG_KEYS.cursor], 0);
    const pullCursorTs = Math.max(toInt(raw[CONFIG_KEYS.pullCursor], legacyCursor), legacyCursor);
    const pullCursorId = Math.max(0, toInt(raw[CONFIG_KEYS.pullCursorId], 0));
    const pushCursorTs = Math.max(0, toInt(raw[CONFIG_KEYS.pushCursor], 0));
    const pushCursorKey = String(raw[CONFIG_KEYS.pushCursorKey] || '');
    const lastSyncTs = toInt(raw[CONFIG_KEYS.lastSyncTs], 0);
    return {
        mode,
        serverUrl,
        pullCursorTs,
        pullCursorId,
        pushCursorTs,
        pushCursorKey,
        lastSyncTs,
    };
};

const saveSyncConfig = async (cfg = {}) => {
    const payload = {};
    if (cfg.mode != null) payload[CONFIG_KEYS.mode] = cfg.mode === 'sync' ? 'sync' : 'local';
    if (cfg.serverUrl != null || cfg.url != null) payload[CONFIG_KEYS.url] = trimServerUrl(cfg.serverUrl != null ? cfg.serverUrl : cfg.url);
    if (cfg.pullCursorTs != null || cfg.pullCursor != null) {
        const pull = Math.max(0, toInt(cfg.pullCursorTs != null ? cfg.pullCursorTs : cfg.pullCursor, 0));
        payload[CONFIG_KEYS.pullCursor] = pull;
        payload[CONFIG_KEYS.cursor] = pull;
    }
    if (cfg.pullCursorId != null) payload[CONFIG_KEYS.pullCursorId] = Math.max(0, toInt(cfg.pullCursorId, 0));
    if (cfg.pushCursorTs != null || cfg.pushCursor != null) payload[CONFIG_KEYS.pushCursor] = Math.max(0, toInt(cfg.pushCursorTs != null ? cfg.pushCursorTs : cfg.pushCursor, 0));
    if (cfg.pushCursorKey != null) payload[CONFIG_KEYS.pushCursorKey] = String(cfg.pushCursorKey || '');
    if (cfg.lastSyncTs != null) payload[CONFIG_KEYS.lastSyncTs] = Math.max(0, toInt(cfg.lastSyncTs, 0));
    if (!Object.keys(payload).length) return;
    await storageSet(payload);
};

const pingServer = async (serverUrl) => {
    const res = await serverFetchJson(serverUrl, '/ping', { timeoutMs: Math.min(1000, SYNC_CFG.requestTimeoutMs) });
    return !!(res.ok && res.data && res.data.status === 'ok');
};

const syncPushIntervals = async (serverUrl, pushCursorTs, pushCursorKey, batchLimit) => {
    const changed = await getIntervalsUpdatedSince(pushCursorTs, pushCursorKey, batchLimit);
    if (!changed.length) {
        return {
            pushed: 0,
            nextPushCursorTs: pushCursorTs,
            nextPushCursorKey: pushCursorKey,
            done: true,
        };
    }
    const response = await serverFetchJson(serverUrl, '/api/intervals/bulk', {
        method: 'POST',
        timeoutMs: Math.max(SYNC_CFG.requestTimeoutMs, 3000),
        body: {
            intervals: changed.map((item) => ({
                pidKey: item.pidKey,
                pid: item.pid,
                market: item.market,
                price: item.price,
                currency: item.currency,
                firstTs: item.firstTs,
                lastTs: item.lastTs,
                updatedTs: item.updatedTs,
            })),
        },
    });
    if (!response.ok || response.data?.status !== 'ok') {
        throw new Error(response.error || response.data?.error || 'push-failed');
    }
    const tail = changed[changed.length - 1];
    return {
        pushed: changed.length,
        nextPushCursorTs: toInt(tail?.updatedTs, pushCursorTs),
        nextPushCursorKey: String(tail?.key || pushCursorKey || ''),
        done: changed.length < batchLimit,
    };
};

const syncPullIntervals = async (serverUrl, pullCursorTs, pullCursorId, batchLimit) => {
    const path = `/api/changes?since=${Math.max(0, pullCursorTs)}&sinceId=${Math.max(0, pullCursorId)}&limit=${Math.max(1, batchLimit)}`;
    const response = await serverFetchJson(serverUrl, path, {
        method: 'GET',
        timeoutMs: Math.max(SYNC_CFG.requestTimeoutMs, 3000),
    });
    if (!response.ok || response.data?.status !== 'ok') {
        throw new Error(response.error || response.data?.error || 'pull-failed');
    }
    const changes = Array.isArray(response.data?.changes) ? response.data.changes : [];
    const mergeStats = await upsertIntervalsFromSync(changes);
    let nextPullCursorTs = Math.max(toInt(response.data?.nextSince, pullCursorTs), pullCursorTs);
    let nextPullCursorId = Math.max(toInt(response.data?.nextSinceId, pullCursorId), pullCursorId);
    if (changes.length) {
        const last = changes[changes.length - 1] || {};
        const lastTs = toInt(last.updatedTs, pullCursorTs);
        const lastId = Math.max(0, toInt(last.id, pullCursorId));
        if (lastTs > nextPullCursorTs) {
            nextPullCursorTs = lastTs;
            nextPullCursorId = lastId;
        } else if (lastTs === nextPullCursorTs) {
            nextPullCursorId = Math.max(nextPullCursorId, lastId);
        }
    }
    return {
        pulled: changes.length,
        mergeStats,
        nextPullCursorTs,
        nextPullCursorId,
        done: changes.length < batchLimit,
    };
};

const runSyncNow = async (opts = {}) => {
    if (SYNC_STATE.running) {
        const prev = SYNC_STATE.lastResult || { status: 'busy', pushed: 0, pulled: 0 };
        return { ...prev, status: 'busy' };
    }
    SYNC_STATE.running = true;
    try {
        const cfg = await loadSyncConfig();
        if (cfg.mode !== 'sync' || !cfg.serverUrl) {
            const result = {
                status: 'disabled',
                pushed: 0,
                pulled: 0,
                reachable: false,
                pushCursor: cfg.pushCursorTs,
                pushCursorKey: cfg.pushCursorKey,
                pullCursor: cfg.pullCursorTs,
                pullCursorId: cfg.pullCursorId,
                serverUrl: cfg.serverUrl,
            };
            SYNC_STATE.lastResult = result;
            return result;
        }

        const reachable = await pingServer(cfg.serverUrl);
        if (!reachable) {
            const result = {
                status: 'offline',
                pushed: 0,
                pulled: 0,
                reachable: false,
                pushCursor: cfg.pushCursorTs,
                pushCursorKey: cfg.pushCursorKey,
                pullCursor: cfg.pullCursorTs,
                pullCursorId: cfg.pullCursorId,
                serverUrl: cfg.serverUrl,
            };
            SYNC_STATE.lastResult = result;
            return result;
        }

        let pushCursorTs = cfg.pushCursorTs;
        let pushCursorKey = cfg.pushCursorKey;
        let pullCursorTs = cfg.pullCursorTs;
        let pullCursorId = cfg.pullCursorId;
        let pushed = 0;
        let pulled = 0;
        let merged = 0;

        for (let i = 0; i < SYNC_CFG.maxSyncLoops; i += 1) {
            const res = await syncPushIntervals(
                cfg.serverUrl,
                pushCursorTs,
                pushCursorKey,
                Math.max(1, toInt(opts.maxPush, SYNC_CFG.maxPushBatch)),
            );
            pushed += res.pushed;
            pushCursorTs = res.nextPushCursorTs;
            pushCursorKey = res.nextPushCursorKey;
            if (res.done) break;
        }

        for (let i = 0; i < SYNC_CFG.maxSyncLoops; i += 1) {
            const res = await syncPullIntervals(
                cfg.serverUrl,
                pullCursorTs,
                pullCursorId,
                Math.max(1, toInt(opts.maxPull, SYNC_CFG.maxPullBatch)),
            );
            pulled += res.pulled;
            merged += toInt(res.mergeStats?.inserted, 0) + toInt(res.mergeStats?.merged, 0) + toInt(res.mergeStats?.updated, 0);
            pullCursorTs = res.nextPullCursorTs;
            pullCursorId = res.nextPullCursorId;
            if (res.done) break;
        }

        const syncedAt = now();
        await saveSyncConfig({
            pushCursorTs,
            pushCursorKey,
            pullCursorTs,
            pullCursorId,
            lastSyncTs: syncedAt,
        });
        const result = {
            status: 'ok',
            pushed,
            pulled,
            merged,
            reachable: true,
            pushCursor: pushCursorTs,
            pushCursorKey,
            pullCursor: pullCursorTs,
            pullCursorId,
            lastSyncTs: syncedAt,
            serverUrl: cfg.serverUrl,
        };
        SYNC_STATE.lastResult = result;
        return result;
    } catch (err) {
        const result = {
            status: 'error',
            pushed: 0,
            pulled: 0,
            reachable: false,
            error: String(err && err.message ? err.message : err),
        };
        SYNC_STATE.lastResult = result;
        return result;
    } finally {
        SYNC_STATE.running = false;
    }
};

const maybeAutoSync = async (reason = 'auto') => {
    const ts = now();
    if (SYNC_STATE.running) return;
    if ((ts - SYNC_STATE.lastAutoAttemptTs) < SYNC_CFG.autoSyncCooldownMs) return;
    SYNC_STATE.lastAutoAttemptTs = ts;
    try {
        await runSyncNow({ reason });
    } catch (_) {
    }
};

const canProbeServer = () => {
    if (SYNC_STATE.running) return false;
    if (SYNC_STATE.lastResult?.status !== 'offline') return true;
    return (now() - toInt(SYNC_STATE.lastAutoAttemptTs, 0)) >= SYNC_CFG.autoSyncCooldownMs;
};

const fetchServerHistoryForPid = async (cfg, pidKey) => {
    const response = await serverFetchJson(cfg.serverUrl, `/api/history?pidKey=${encodeURIComponent(pidKey)}`, {
        method: 'GET',
        timeoutMs: Math.max(SYNC_CFG.requestTimeoutMs, 3000),
    });
    if (!response.ok || response.data?.status !== 'ok') return { ok: false };
    const rows = Array.isArray(response.data?.history) ? response.data.history : [];
    if (!rows.length) return { ok: true, merged: { accepted: 0, inserted: 0, merged: 0, updated: 0, products: 0 } };
    const merged = await upsertIntervalsFromSync(rows);
    return { ok: true, merged };
};

const fetchServerMinsForPidKeys = async (cfg, pidKeys) => {
    const response = await serverFetchJson(cfg.serverUrl, '/api/min-batch', {
        method: 'POST',
        timeoutMs: Math.max(SYNC_CFG.requestTimeoutMs, 3000),
        body: { pidKeys },
    });
    if (!response.ok || response.data?.status !== 'ok') return { ok: false };
    const minsPayload = response.data?.mins;
    const rows = [];
    if (Array.isArray(minsPayload)) {
        minsPayload.forEach((item) => rows.push(item));
    } else if (minsPayload && typeof minsPayload === 'object') {
        Object.keys(minsPayload).forEach((pidKey) => {
            const item = minsPayload[pidKey];
            if (!item || typeof item !== 'object') return;
            rows.push({ pidKey, ...item });
        });
    }
    if (!rows.length) return { ok: true, merged: { accepted: 0, inserted: 0, merged: 0, updated: 0, products: 0 } };
    const merged = await upsertIntervalsFromSync(rows);
    return { ok: true, merged };
};

const getMergedHistoryByPid = async (pidKey, limit = 5000) => {
    const cleanPidKey = String(pidKey || '').trim();
    if (!cleanPidKey) return [];
    const cfg = await loadSyncConfig();
    if (cfg.mode === 'sync' && cfg.serverUrl) {
        await maybeAutoSync('history-request');
        const lastFetch = toInt(SYNC_STATE.historyFetchedAt.get(cleanPidKey), 0);
        if ((now() - lastFetch) >= SYNC_CFG.historyFetchTtlMs && canProbeServer()) {
            const fetched = await fetchServerHistoryForPid(cfg, cleanPidKey);
            if (fetched.ok) SYNC_STATE.historyFetchedAt.set(cleanPidKey, now());
        }
    }
    return getIntervalsByPid(cleanPidKey, limit);
};

const getMergedMinBatch = async (pidKeys) => {
    const keys = [...new Set((Array.isArray(pidKeys) ? pidKeys : []).map((k) => String(k || '').trim()).filter(Boolean))];
    if (!keys.length) return {};

    const localMins = await getMinBatch(keys);
    const cfg = await loadSyncConfig();
    if (cfg.mode === 'sync' && cfg.serverUrl) {
        await maybeAutoSync('min-request');
        const ts = now();
        const toFetch = keys.filter((pidKey) => {
            const local = localMins[pidKey];
            if (!local) return true;
            const lastFetched = toInt(SYNC_STATE.minFetchedAt.get(pidKey), 0);
            return (ts - lastFetched) >= SYNC_CFG.minFetchTtlMs;
        });
        if (toFetch.length && canProbeServer()) {
            const fetched = await fetchServerMinsForPidKeys(cfg, toFetch);
            if (fetched.ok) toFetch.forEach((pidKey) => SYNC_STATE.minFetchedAt.set(pidKey, ts));
        }
    }
    return getMinBatch(keys);
};

const LAST_EXTRACT_SESSION_KEY = 'owb-last-extract-session';
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tabsQuery = (queryInfo) => new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
        const err = chrome.runtime.lastError;
        if (err) {
            reject(new Error(err.message || 'Cannot query tabs'));
            return;
        }
        resolve(Array.isArray(tabs) ? tabs : []);
    });
});
const tabsUpdate = (tabId, updateProps) => new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProps, (tab) => {
        const err = chrome.runtime.lastError;
        if (err) {
            reject(new Error(err.message || 'Cannot update tab'));
            return;
        }
        resolve(tab || null);
    });
});
const tabsGet = (tabId) => new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
        const err = chrome.runtime.lastError;
        if (err) {
            reject(new Error(err.message || 'Cannot get tab'));
            return;
        }
        resolve(tab || null);
    });
});
const sendMessageToTab = (tabId, message) => new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
            reject(new Error(err.message || 'Cannot communicate with tab'));
            return;
        }
        resolve(response);
    });
});
const waitTabComplete = async (tabId, timeoutMs = 25000) => {
    const current = await tabsGet(tabId).catch(() => null);
    if (!current || current.status === 'complete') return true;
    return new Promise((resolve) => {
        let done = false;
        let timer = null;
        const finish = () => {
            if (done) return;
            done = true;
            if (timer) clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve(true);
        };
        const onUpdated = (updatedTabId, changeInfo) => {
            if (updatedTabId !== tabId) return;
            if (changeInfo.status === 'complete') finish();
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        timer = setTimeout(() => finish(), Math.max(3000, Number(timeoutMs) || 25000));
    });
};
const MARKET_HOST_RE = /(^|\.)((ozon\.(ru|com|kz|by|uz|am|kg|ge))|(wildberries\.(ru|by|kz|uz|am|kg|ge))|(wb\.ru))$/i;
const parseMarketProductFromUrl = (url) => {
    try {
        const u = new URL(String(url || ''));
        if (!/^https?:$/i.test(u.protocol)) return null;
        const host = String(u.hostname || '').toLowerCase();
        const path = String(u.pathname || '');
        if (!MARKET_HOST_RE.test(host)) return null;
        if (host.includes('ozon')) {
            const m = path.match(/\/product\/[^/]*?(\d{5,})(?:\/|$)/) || path.match(/\/product\/(\d{5,})(?:\/|$)/);
            if (!m) return null;
            return { market: 'ozon', pid: m[1], pidKey: `ozon:${m[1]}` };
        }
        if (host.includes('wildberries') || host.endsWith('wb.ru')) {
            const m = path.match(/\/catalog\/(\d{4,})\/detail/i) || path.match(/\/catalog\/(\d{4,})\/feedbacks/i);
            if (!m) return null;
            return { market: 'wb', pid: m[1], pidKey: `wb:${m[1]}` };
        }
        return null;
    } catch (_) {
        return null;
    }
};
const collectWindowProductTabs = async (windowId = null) => {
    const queryInfo = (Number.isFinite(Number(windowId)) && Number(windowId) >= 0)
        ? { windowId: Number(windowId) }
        : { currentWindow: true };
    const tabs = await tabsQuery(queryInfo);
    return tabs
        .map((tab) => ({ tab, product: parseMarketProductFromUrl(tab.url) }))
        .filter((item) => !!item.product && Number.isFinite(Number(item.tab && item.tab.id)));
};
const buildCombinedText = (items) => items
    .map((item, idx) => {
        const title = String(item.title || item.pidKey || item.url || `card-${idx + 1}`).trim();
        const url = String(item.url || '').trim();
        return `### ${idx + 1}. ${title}${url ? `\nURL: ${url}` : ''}\n\n${item.text || ''}`;
    })
    .join('\n\n---\n\n');
const getLastExtractSession = async () => {
    const raw = await storageGet([LAST_EXTRACT_SESSION_KEY]);
    return raw[LAST_EXTRACT_SESSION_KEY] || null;
};
const runWindowExportBatch = async (opts = {}) => {
    const mode = opts.mode === 'copy' ? 'copy' : 'download';
    const allReviews = opts.allReviews === true;
    const includeReviews = opts.includeReviews !== false;
    const tabPairs = await collectWindowProductTabs(opts.windowId);
    const originalActive = tabPairs.find((item) => item.tab && item.tab.active)?.tab || null;
    const successes = [];
    const failures = [];

    for (let i = 0; i < tabPairs.length; i += 1) {
        const { tab, product } = tabPairs[i];
        try {
            await tabsUpdate(tab.id, { active: true });
            await waitTabComplete(tab.id, 25000);
            await sleepMs(450);
            const response = await sendMessageToTab(tab.id, {
                scope: 'owb-export',
                action: 'export-card',
                options: {
                    includeReviews,
                    allReviews,
                },
            });
            if (!response || !response.ok || !response.data || !response.data.text) {
                throw new Error(response && response.error ? response.error : 'Empty export response');
            }
            const data = response.data;
            const filename = sanitizeFilename(data.filename || `${product.pidKey || `card_${tab.id}`}.txt`);
            const item = {
                tabId: tab.id,
                market: data.market || product.market,
                pidKey: data.pidKey || product.pidKey,
                title: data.title || tab.title || product.pidKey,
                url: data.url || tab.url,
                filename,
                text: String(data.text || ''),
            };
            if (mode === 'download') {
                await handleDownloadText({
                    name: filename,
                    text: item.text,
                });
            }
            successes.push(item);
        } catch (err) {
            failures.push({
                tabId: tab.id,
                url: tab.url || '',
                pidKey: product && product.pidKey ? product.pidKey : '',
                error: String(err && err.message ? err.message : err),
            });
        }
    }

    if (originalActive && Number.isFinite(Number(originalActive.id))) {
        await tabsUpdate(originalActive.id, { active: true }).catch(() => null);
    }

    const combinedText = buildCombinedText(successes);
    const maxStoredChars = 900000;
    const storedText = combinedText.length > maxStoredChars
        ? `${combinedText.slice(0, maxStoredChars)}\n\n[...ОБРЕЗАНО ДЛЯ ХРАНЕНИЯ В СЕССИИ...]`
        : combinedText;
    const session = {
        createdAt: now(),
        mode,
        allReviews,
        totalTabs: tabPairs.length,
        successCount: successes.length,
        failCount: failures.length,
        failures,
        items: successes.map((item) => ({
            tabId: item.tabId,
            market: item.market,
            pidKey: item.pidKey,
            title: item.title,
            url: item.url,
            filename: item.filename,
        })),
        text: storedText,
        storedTruncated: storedText.length !== combinedText.length,
    };
    await storageSet({ [LAST_EXTRACT_SESSION_KEY]: session });
    return {
        ...session,
        combinedText,
    };
};

const getPriceStatus = async () => {
    const cfg = await loadSyncConfig();
    let reachable = false;
    if (cfg.mode === 'sync' && cfg.serverUrl) {
        reachable = await pingServer(cfg.serverUrl);
    }
    return {
        mode: cfg.mode,
        serverUrl: cfg.serverUrl,
        cursor: cfg.pullCursorTs,
        pullCursor: cfg.pullCursorTs,
        pullCursorId: cfg.pullCursorId,
        pushCursor: cfg.pushCursorTs,
        pushCursorKey: cfg.pushCursorKey,
        reachable,
        legacyMode: false,
        lastSyncTs: cfg.lastSyncTs || toInt(SYNC_STATE.lastResult?.lastSyncTs, 0),
        lastSyncStatus: String(SYNC_STATE.lastResult?.status || ''),
    };
};
const setPriceConfig = async (payload) => {
    const mode = payload && payload.mode === 'sync' ? 'sync' : 'local';
    const url = trimServerUrl(payload?.url || '');
    await saveSyncConfig({
        mode,
        serverUrl: url,
    });
    if (mode === 'sync' && url) {
        await maybeAutoSync('set-config');
    }
    return getPriceStatus();
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string' || !message.type.startsWith('owb:')) return undefined;
    (async () => {
        switch (message.type) {
        case 'owb:download-text':
            return handleDownloadText(message);
        case 'owb:request-json':
            return handleJsonRequest(message);
        case 'owb:price-capture-batch':
        {
            const data = await capturePriceBatch(message.records || []);
            maybeAutoSync('capture').catch(() => {});
            return { ok: true, data };
        }
        case 'owb:price-history':
            return { ok: true, data: { pidKey: message.pidKey || '', intervals: await getMergedHistoryByPid(message.pidKey, message.limit || 5000) } };
        case 'owb:price-min-batch':
            return { ok: true, data: await getMergedMinBatch(message.pidKeys || []) };
        case 'owb:price-export':
            return { ok: true, data: await exportPriceDb() };
        case 'owb:price-inspect':
            return { ok: true, data: await inspectPriceDb((message.options || message.payload || {})) };
        case 'owb:price-import':
            return { ok: true, data: await importPriceDb(message.payload || {}) };
        case 'owb:price-reset-product':
            return { ok: true, data: await resetPriceHistoryByPid(message.pidKey || message.payload?.pidKey || '') };
        case 'owb:price-get-status':
            return { ok: true, data: await getPriceStatus() };
        case 'owb:price-set-config':
            return { ok: true, data: await setPriceConfig(message.payload || {}) };
        case 'owb:price-sync-now':
            return { ok: true, data: await runSyncNow({ reason: 'manual' }) };
        case 'owb:batch-run-window-export':
            return { ok: true, data: await runWindowExportBatch(message.payload || {}) };
        case 'owb:batch-get-last-session':
            return { ok: true, data: await getLastExtractSession() };
        default:
            return { ok: false, error: `Unknown message type: ${message.type}` };
        }
    })().then(sendResponse).catch((err) => {
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
    });
    return true;
});

if (chrome.runtime && chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(() => {
        maybeAutoSync('startup').catch(() => {});
    });
}
if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
        maybeAutoSync('installed').catch(() => {});
    });
}

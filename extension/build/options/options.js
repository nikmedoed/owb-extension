"use strict";
(() => {
  // src/options/options.js
  var STORAGE_KEYS = {
    mode: "owb-default-sync-mode",
    url: "owb-default-server-url",
    restoreSingle: "owb-export-restore-single",
    restoreBatch: "owb-export-restore-batch",
    pageMark: "owb-export-page-mark"
  };
  var DEFAULT_SERVER_URL = "http://127.0.0.1:8765";
  var syncEnabledEl = document.getElementById("syncEnabled");
  var urlEl = document.getElementById("defaultUrl");
  var modeTitleEl = document.getElementById("modeTitle");
  var setupHelpEl = document.getElementById("setupHelp");
  var syncStatusEl = document.getElementById("syncStatus");
  var dbStatusEl = document.getElementById("dbStatus");
  var restoreSingleEl = document.getElementById("restoreSingle");
  var restoreBatchEl = document.getElementById("restoreBatch");
  var pageMarkEl = document.getElementById("pageMark");
  var saveBtn = document.getElementById("saveBtn");
  var testBtn = document.getElementById("testBtn");
  var exportBtn = document.getElementById("exportBtn");
  var importAppendBtn = document.getElementById("importAppendBtn");
  var importReplaceBtn = document.getElementById("importReplaceBtn");
  var importFileEl = document.getElementById("importFile");
  var resetMarketBtns = [...document.querySelectorAll("[data-reset-market]")];
  var copyServerCmdBtn = document.getElementById("copyServerCmdBtn");
  var inspectMetaEl = document.getElementById("inspectMeta");
  var inspectTotalRecordsEl = document.getElementById("inspectTotalRecords");
  var inspectTotalProductsEl = document.getElementById("inspectTotalProducts");
  var inspectTotalIntervalsEl = document.getElementById("inspectTotalIntervals");
  var inspectAvgPerProductEl = document.getElementById("inspectAvgPerProduct");
  var inspectOzonProductsEl = document.getElementById("inspectOzonProducts");
  var inspectWbProductsEl = document.getElementById("inspectWbProducts");
  var inspectAliExpressProductsEl = document.getElementById("inspectAliExpressProducts");
  var inspectAmazonProductsEl = document.getElementById("inspectAmazonProducts");
  var inspectLastActivityEl = document.getElementById("inspectLastActivity");
  var pendingImportMode = "append";
  var setStatus = (el, text, isError = false) => {
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? "#b42318" : "#1f2328";
  };
  var setSyncStatus = (text, isError = false) => setStatus(syncStatusEl, text, isError);
  var setDbStatus = (text, isError = false) => setStatus(dbStatusEl, text, isError);
  var storageGet = (keys) => new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "Storage get failed"));
        return;
      }
      resolve(result || {});
    });
  });
  var storageSet = (value) => new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "Storage set failed"));
        return;
      }
      resolve();
    });
  });
  var sendRuntimeMessage = (message) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "Cannot send message"));
        return;
      }
      resolve(response);
    });
  });
  var copyTextToClipboard = async (text) => {
    const payload = String(text || "");
    try {
      await navigator.clipboard.writeText(payload);
      return true;
    } catch (_) {
    }
    const ta = document.createElement("textarea");
    ta.value = payload;
    ta.setAttribute("readonly", "readonly");
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u043E\u043C\u0430\u043D\u0434\u0443");
    return true;
  };
  var withBusy = (busy) => {
    saveBtn.disabled = busy;
    testBtn.disabled = busy;
    exportBtn.disabled = busy;
    importAppendBtn.disabled = busy;
    importReplaceBtn.disabled = busy;
    resetMarketBtns.forEach((btn) => {
      btn.disabled = busy;
    });
    syncEnabledEl.disabled = busy;
    urlEl.disabled = busy;
    if (restoreSingleEl) restoreSingleEl.disabled = busy;
    if (restoreBatchEl) restoreBatchEl.disabled = busy;
    if (pageMarkEl) pageMarkEl.disabled = busy;
  };
  var readForm = () => ({
    syncEnabled: !!syncEnabledEl.checked,
    url: urlEl.value.trim(),
    restoreSingle: restoreSingleEl ? !!restoreSingleEl.checked : true,
    restoreBatch: restoreBatchEl ? !!restoreBatchEl.checked : true,
    pageMark: pageMarkEl ? !!pageMarkEl.checked : true
  });
  var toMode = (values) => values.syncEnabled && values.url ? "sync" : "local";
  var hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
  var probeServer = async (baseUrl, timeoutMs = 900) => {
    const clean = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!clean) return false;
    if (!/^https?:\/\//i.test(clean)) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(400, Number(timeoutMs) || 1500));
    try {
      const res = await fetch(`${clean}/ping`, {
        method: "GET",
        cache: "no-store",
        credentials: "omit",
        signal: ctrl.signal
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      return !!(data && data.status === "ok");
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
  var renderModeTitle = () => {
    modeTitleEl.textContent = syncEnabledEl.checked ? "\u0440\u0435\u0436\u0438\u043C: sync" : "\u0440\u0435\u0436\u0438\u043C: local";
  };
  var applySyncState = (state) => {
    switch (state) {
      case "disabled":
        setSyncStatus("\u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u0430.");
        setupHelpEl.hidden = true;
        return;
      case "empty-url":
        setSyncStatus("\u0410\u0434\u0440\u0435\u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 \u043F\u0443\u0441\u0442\u043E\u0439. \u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442.", true);
        setupHelpEl.hidden = false;
        return;
      case "reachable":
        setSyncStatus("\u0421\u0435\u0440\u0432\u0435\u0440 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D. \u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442.");
        setupHelpEl.hidden = true;
        return;
      case "unreachable":
        setSyncStatus("\u0421\u0435\u0440\u0432\u0435\u0440 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D. \u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442.", true);
        setupHelpEl.hidden = false;
        return;
      case "not-checked":
      default:
        setSyncStatus("\u0421\u0435\u0440\u0432\u0435\u0440 \u043D\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D. \u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043F\u0440\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0438 \u0438\u043B\u0438 \u043F\u043E \u043A\u043D\u043E\u043F\u043A\u0435.");
        setupHelpEl.hidden = true;
        return;
    }
  };
  var resolveSyncStateNoProbe = () => {
    const values = readForm();
    if (!values.syncEnabled) return "disabled";
    if (!values.url) return "empty-url";
    return "not-checked";
  };
  var resolveSyncStateWithProbe = async () => {
    const values = readForm();
    if (!values.syncEnabled) return "disabled";
    if (!values.url) return "empty-url";
    const reachable = await probeServer(values.url);
    return reachable ? "reachable" : "unreachable";
  };
  var resolveProbeStateAny = async () => {
    const values = readForm();
    if (!values.url) return "empty-url";
    const reachable = await probeServer(values.url);
    return reachable ? "reachable" : "unreachable";
  };
  var loadDefaults = async () => {
    const saved = await storageGet([
      STORAGE_KEYS.mode,
      STORAGE_KEYS.url,
      STORAGE_KEYS.restoreSingle,
      STORAGE_KEYS.restoreBatch,
      STORAGE_KEYS.pageMark
    ]);
    const savedMode = hasOwn(saved, STORAGE_KEYS.mode) ? saved[STORAGE_KEYS.mode] : "";
    const savedUrl = hasOwn(saved, STORAGE_KEYS.url) ? String(saved[STORAGE_KEYS.url] || "").trim() : "";
    urlEl.value = savedUrl || DEFAULT_SERVER_URL;
    syncEnabledEl.checked = savedMode === "sync" && !!savedUrl;
    if (restoreSingleEl) {
      restoreSingleEl.checked = hasOwn(saved, STORAGE_KEYS.restoreSingle) ? !!saved[STORAGE_KEYS.restoreSingle] : true;
    }
    if (restoreBatchEl) {
      restoreBatchEl.checked = hasOwn(saved, STORAGE_KEYS.restoreBatch) ? !!saved[STORAGE_KEYS.restoreBatch] : true;
    }
    if (pageMarkEl) {
      pageMarkEl.checked = hasOwn(saved, STORAGE_KEYS.pageMark) ? !!saved[STORAGE_KEYS.pageMark] : true;
    }
    renderModeTitle();
    applySyncState(resolveSyncStateNoProbe());
  };
  var sendMonitor = async (action, payload = null) => {
    const actionMap = {
      "monitor:set-config": "owb:price-set-config",
      "monitor:export-db": "owb:price-export",
      "monitor:import-db": "owb:price-import",
      "monitor:inspect-db": "owb:price-inspect",
      "monitor:reset-market": "owb:price-reset-market"
    };
    const type = actionMap[action];
    if (!type) throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435");
    const message = { type };
    if (action === "monitor:inspect-db") message.options = payload || {};
    else message.payload = payload || {};
    const response = await sendRuntimeMessage(message);
    if (!response || !response.ok) throw new Error(response && response.error ? response.error : "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u044F \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F");
    return { data: response.data };
  };
  var formatNumber = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return n.toLocaleString("ru-RU");
  };
  var formatTs = (ts) => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "\u2014";
    return new Date(n).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  };
  var PRICE_DB = {
    name: "owb-price-history-ext",
    version: 1,
    intervals: "intervals",
    products: "products"
  };
  var toInt = (value, fallback = 0) => {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) ? n : fallback;
  };
  var idbReq = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  var txDone = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  var ensureLocalPriceDbSchema = (db, tx) => {
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
        return !!store && !!store.indexNames && Array.from(store.indexNames).includes(name);
      } catch (_) {
        return false;
      }
    };
    const ensureIndex = (store, name, keyPath) => {
      if (!store || hasIndex(store, name)) return;
      store.createIndex(name, keyPath, { unique: false });
    };
    if (!hasStore(PRICE_DB.intervals)) {
      const store = db.createObjectStore(PRICE_DB.intervals, { keyPath: "key" });
      store.createIndex("byPidFirst", ["pidKey", "firstTs"], { unique: false });
      store.createIndex("byPidLast", ["pidKey", "lastTs"], { unique: false });
      store.createIndex("byUpdated", "updatedAt", { unique: false });
    } else {
      const store = getStore(PRICE_DB.intervals);
      ensureIndex(store, "byPidFirst", ["pidKey", "firstTs"]);
      ensureIndex(store, "byPidLast", ["pidKey", "lastTs"]);
      ensureIndex(store, "byUpdated", "updatedAt");
    }
    if (!hasStore(PRICE_DB.products)) {
      const store = db.createObjectStore(PRICE_DB.products, { keyPath: "pidKey" });
      store.createIndex("byUpdated", "updatedAt", { unique: false });
    } else {
      ensureIndex(getStore(PRICE_DB.products), "byUpdated", "updatedAt");
    }
  };
  var openLocalPriceDbRaw = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(PRICE_DB.name, PRICE_DB.version);
    req.onupgradeneeded = () => ensureLocalPriceDbSchema(req.result, req.transaction);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u044B\u0442\u044C IndexedDB"));
  });
  var deleteLocalPriceDb = () => new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(PRICE_DB.name);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u0441\u043E\u0437\u0434\u0430\u0442\u044C IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB \u0437\u0430\u043D\u044F\u0442\u0430 \u0434\u0440\u0443\u0433\u043E\u0439 \u0432\u043A\u043B\u0430\u0434\u043A\u043E\u0439. \u0417\u0430\u043A\u0440\u043E\u0439\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u0438\u043C\u043F\u043E\u0440\u0442."));
  });
  var openLocalPriceDb = async () => {
    const db = await openLocalPriceDbRaw();
    if (db.objectStoreNames.contains(PRICE_DB.intervals) && db.objectStoreNames.contains(PRICE_DB.products)) {
      return db;
    }
    db.close();
    await deleteLocalPriceDb();
    return openLocalPriceDbRaw();
  };
  var countByPidPrefix = (store, prefix) => new Promise((resolve) => {
    const start = String(prefix || "").trim();
    if (!start) {
      resolve(0);
      return;
    }
    let req = null;
    try {
      const range = IDBKeyRange.bound(start, `${start}\uFFFF`);
      req = store.count(range);
    } catch (_) {
      resolve(0);
      return;
    }
    req.onsuccess = () => resolve(Number(req.result) || 0);
    req.onerror = () => resolve(0);
  });
  var readLastUpdatedTs = (store) => new Promise((resolve) => {
    let req = null;
    try {
      if (store.indexNames && Array.from(store.indexNames).includes("byUpdated")) {
        req = store.index("byUpdated").openCursor(null, "prev");
      }
    } catch (_) {
    }
    if (!req) req = store.openCursor(null, "prev");
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
  var inspectDbDirect = async () => {
    const db = await openLocalPriceDb();
    try {
      const hasProducts = db.objectStoreNames.contains(PRICE_DB.products);
      const hasIntervals = db.objectStoreNames.contains(PRICE_DB.intervals);
      if (!hasProducts && !hasIntervals) {
        return {
          schema: "owb-price-history-ext-v1",
          inspectedAt: Date.now(),
          dbName: PRICE_DB.name,
          dbVersion: db.version || PRICE_DB.version,
          counts: { products: 0, intervals: 0 },
          totals: { avgIntervalsPerProduct: 0, lastActivityTs: 0 },
          marketStats: [],
          newestProducts: [],
          newestIntervals: []
        };
      }
      const txStores = [hasProducts ? PRICE_DB.products : null, hasIntervals ? PRICE_DB.intervals : null].filter(Boolean);
      const tx = db.transaction(txStores, "readonly");
      const productsStore = hasProducts ? tx.objectStore(PRICE_DB.products) : null;
      const intervalsStore = hasIntervals ? tx.objectStore(PRICE_DB.intervals) : null;
      const productsCountPromise = productsStore ? idbReq(productsStore.count()) : Promise.resolve(0);
      const intervalsCountPromise = intervalsStore ? idbReq(intervalsStore.count()) : Promise.resolve(0);
      const ozonProductsPromise = productsStore ? countByPidPrefix(productsStore, "ozon:") : Promise.resolve(0);
      const wbProductsPromise = productsStore ? countByPidPrefix(productsStore, "wb:") : Promise.resolve(0);
      const aliExpressProductsPromise = productsStore ? countByPidPrefix(productsStore, "aliexpress:") : Promise.resolve(0);
      const amazonProductsPromise = productsStore ? countByPidPrefix(productsStore, "amazon:") : Promise.resolve(0);
      const productsLastTsPromise = productsStore ? readLastUpdatedTs(productsStore) : Promise.resolve(0);
      const intervalsLastTsPromise = intervalsStore ? readLastUpdatedTs(intervalsStore) : Promise.resolve(0);
      const [productsCountRaw, intervalsCountRaw, ozonProductsRaw, wbProductsRaw, aliExpressProductsRaw, amazonProductsRaw, productsLastTsRaw, intervalsLastTsRaw] = await Promise.all([
        productsCountPromise,
        intervalsCountPromise,
        ozonProductsPromise,
        wbProductsPromise,
        aliExpressProductsPromise,
        amazonProductsPromise,
        productsLastTsPromise,
        intervalsLastTsPromise
      ]);
      await txDone(tx);
      const productsCount = Number(productsCountRaw) || 0;
      const intervalsCount = Number(intervalsCountRaw) || 0;
      const ozonProducts = Number(ozonProductsRaw) || 0;
      const wbProducts = Number(wbProductsRaw) || 0;
      const aliExpressProducts = Number(aliExpressProductsRaw) || 0;
      const amazonProducts = Number(amazonProductsRaw) || 0;
      const unknownProducts = Math.max(0, productsCount - ozonProducts - wbProducts - aliExpressProducts - amazonProducts);
      const productsLastTs = Number(productsLastTsRaw) || 0;
      const intervalsLastTs = Number(intervalsLastTsRaw) || 0;
      const lastActivityTs = Math.max(productsLastTs, intervalsLastTs);
      const marketStats = [
        { market: "ozon", products: ozonProducts, intervals: 0, lastUpdatedTs: productsLastTs },
        { market: "wb", products: wbProducts, intervals: 0, lastUpdatedTs: productsLastTs },
        { market: "aliexpress", products: aliExpressProducts, intervals: 0, lastUpdatedTs: productsLastTs },
        { market: "amazon", products: amazonProducts, intervals: 0, lastUpdatedTs: productsLastTs }
      ];
      if (unknownProducts > 0) {
        marketStats.push({ market: "unknown", products: unknownProducts, intervals: 0, lastUpdatedTs: productsLastTs });
      }
      return {
        schema: "owb-price-history-ext-v1",
        inspectedAt: Date.now(),
        dbName: PRICE_DB.name,
        dbVersion: db.version,
        counts: {
          products: productsCount,
          intervals: intervalsCount
        },
        totals: {
          avgIntervalsPerProduct: productsCount > 0 ? Number((intervalsCount / productsCount).toFixed(2)) : 0,
          lastActivityTs
        },
        marketStats,
        newestProducts: [],
        newestIntervals: []
      };
    } finally {
      db.close();
    }
  };
  var readAllFromStore = (store) => new Promise((resolve, reject) => {
    const out = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      out.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error || new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C IndexedDB"));
  });
  var exportDbDirect = async () => {
    const db = await openLocalPriceDb();
    try {
      const tx = db.transaction([PRICE_DB.intervals, PRICE_DB.products], "readonly");
      const intervalsStore = tx.objectStore(PRICE_DB.intervals);
      const productsStore = tx.objectStore(PRICE_DB.products);
      const [intervals, products] = await Promise.all([
        readAllFromStore(intervalsStore),
        readAllFromStore(productsStore)
      ]);
      await txDone(tx);
      return {
        schema: "owb-price-history-ext-v1",
        exportedAt: Date.now(),
        dbName: PRICE_DB.name,
        dbVersion: db.version,
        intervals: { count: intervals.length, records: intervals },
        products: { count: products.length, records: products }
      };
    } finally {
      db.close();
    }
  };
  var clearDbDirect = async (db) => {
    const tx = db.transaction([PRICE_DB.intervals, PRICE_DB.products], "readwrite");
    tx.objectStore(PRICE_DB.intervals).clear();
    tx.objectStore(PRICE_DB.products).clear();
    await txDone(tx);
  };
  var putRecordsInBatches = async (db, storeName, records, batchSize = 1e3) => {
    const list = Array.isArray(records) ? records : [];
    let stored = 0;
    for (let i = 0; i < list.length; i += batchSize) {
      const batch = list.slice(i, i + batchSize).filter(Boolean);
      if (!batch.length) continue;
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      batch.forEach((record) => store.put(record));
      await txDone(tx);
      stored += batch.length;
    }
    return stored;
  };
  var importDbDirect = async (payload, mode = "append") => {
    const source = payload && typeof payload === "object" && payload.data && typeof payload.data === "object" ? payload.data : payload;
    const intervalRecords = Array.isArray(source?.intervals?.records) ? source.intervals.records : [];
    const productRecords = Array.isArray(source?.products?.records) ? source.products.records : [];
    if (!intervalRecords.length && !productRecords.length) {
      throw new Error("\u0424\u0430\u0439\u043B \u043D\u0435 \u043F\u043E\u0445\u043E\u0436 \u043D\u0430 \u044D\u043A\u0441\u043F\u043E\u0440\u0442 OWB Tools: \u043D\u0435\u0442 intervals.records/products.records");
    }
    const db = await openLocalPriceDb();
    try {
      if (mode === "replace") {
        await clearDbDirect(db);
      }
      const importedIntervals = await putRecordsInBatches(db, PRICE_DB.intervals, intervalRecords);
      const importedProducts = await putRecordsInBatches(db, PRICE_DB.products, productRecords);
      return {
        mode,
        imported: importedIntervals + importedProducts,
        intervals: importedIntervals,
        products: importedProducts
      };
    } finally {
      db.close();
    }
  };
  var renderInspect = (data) => {
    const counts = data && data.counts ? data.counts : {};
    const totals = data && data.totals ? data.totals : {};
    const marketStats = Array.isArray(data?.marketStats) ? data.marketStats : [];
    const productsCount = Number(counts.products) || 0;
    const intervalsCount = Number(counts.intervals) || 0;
    const totalRecords = productsCount + intervalsCount;
    const avgIntervalsPerProduct = Number.isFinite(Number(totals.avgIntervalsPerProduct)) ? Number(totals.avgIntervalsPerProduct) : productsCount > 0 ? intervalsCount / productsCount : 0;
    const lastActivityTs = Number(totals.lastActivityTs) || 0;
    inspectMetaEl.textContent = `${data?.dbName || "owb-price-history-ext"} v${data?.dbVersion || 1}`;
    if (inspectTotalRecordsEl) inspectTotalRecordsEl.textContent = formatNumber(totalRecords);
    inspectTotalProductsEl.textContent = formatNumber(productsCount);
    inspectTotalIntervalsEl.textContent = formatNumber(intervalsCount);
    inspectAvgPerProductEl.textContent = productsCount > 0 ? avgIntervalsPerProduct.toFixed(2) : "0";
    const marketMap = new Map(marketStats.map((item) => [String(item.market || "").toLowerCase(), item]));
    const ozonProducts = Number(marketMap.get("ozon")?.products || 0);
    const wbProducts = Number(marketMap.get("wb")?.products || 0);
    const aliExpressProducts = Number(marketMap.get("aliexpress")?.products || 0);
    const amazonProducts = Number(marketMap.get("amazon")?.products || 0);
    const ozonShare = productsCount > 0 ? ozonProducts / productsCount * 100 : 0;
    const wbShare = productsCount > 0 ? wbProducts / productsCount * 100 : 0;
    const aliExpressShare = productsCount > 0 ? aliExpressProducts / productsCount * 100 : 0;
    const amazonShare = productsCount > 0 ? amazonProducts / productsCount * 100 : 0;
    if (inspectOzonProductsEl) inspectOzonProductsEl.textContent = `${formatNumber(ozonProducts)} (${ozonShare.toFixed(1)}%)`;
    if (inspectWbProductsEl) inspectWbProductsEl.textContent = `${formatNumber(wbProducts)} (${wbShare.toFixed(1)}%)`;
    if (inspectAliExpressProductsEl) inspectAliExpressProductsEl.textContent = `${formatNumber(aliExpressProducts)} (${aliExpressShare.toFixed(1)}%)`;
    if (inspectAmazonProductsEl) inspectAmazonProductsEl.textContent = `${formatNumber(amazonProducts)} (${amazonShare.toFixed(1)}%)`;
    if (inspectLastActivityEl) {
      const formatted = formatTs(lastActivityTs);
      inspectLastActivityEl.textContent = formatted;
      inspectLastActivityEl.title = formatted;
    }
  };
  var inspectDb = async () => {
    withBusy(true);
    try {
      const data = await inspectDbDirect();
      renderInspect(data || {});
      setDbStatus("");
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      setDbStatus(message, true);
      inspectMetaEl.textContent = "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u0411\u0414 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F";
      if (inspectTotalRecordsEl) inspectTotalRecordsEl.textContent = "\u2014";
      inspectTotalProductsEl.textContent = "\u2014";
      inspectTotalIntervalsEl.textContent = "\u2014";
      inspectAvgPerProductEl.textContent = "\u2014";
      if (inspectOzonProductsEl) inspectOzonProductsEl.textContent = "\u2014";
      if (inspectWbProductsEl) inspectWbProductsEl.textContent = "\u2014";
      if (inspectAliExpressProductsEl) inspectAliExpressProductsEl.textContent = "\u2014";
      if (inspectAmazonProductsEl) inspectAmazonProductsEl.textContent = "\u2014";
      if (inspectLastActivityEl) inspectLastActivityEl.textContent = "\u2014";
    } finally {
      withBusy(false);
    }
  };
  var marketLabels = {
    ozon: "Ozon",
    wb: "Wildberries",
    aliexpress: "AliExpress",
    amazon: "Amazon"
  };
  var resetSelectedMarket = async (marketValue) => {
    const market = String(marketValue || "").trim().toLowerCase();
    const label = marketLabels[market] || market;
    if (!market || !marketLabels[market]) {
      setDbStatus("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u0435\u0440\u0432\u0438\u0441 \u0434\u043B\u044F \u0441\u0431\u0440\u043E\u0441\u0430", true);
      return;
    }
    const ok = window.confirm(`\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u0441\u044E \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u0443\u044E \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0446\u0435\u043D \u0434\u043B\u044F ${label}? \u042D\u0442\u043E \u0443\u0434\u0430\u043B\u0438\u0442 \u0442\u043E\u0432\u0430\u0440\u044B \u0438 \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u044D\u0442\u043E\u0433\u043E \u0441\u0435\u0440\u0432\u0438\u0441\u0430.`);
    if (!ok) return;
    withBusy(true);
    setDbStatus(`\u0423\u0434\u0430\u043B\u044F\u044E \u0438\u0441\u0442\u043E\u0440\u0438\u044E ${label}...`);
    try {
      const { data } = await sendMonitor("monitor:reset-market", { market });
      await inspectDb();
      const deletedProducts = Number(data?.deletedProducts || 0);
      const deletedIntervals = Number(data?.deletedIntervals || 0);
      setDbStatus(`\u0418\u0441\u0442\u043E\u0440\u0438\u044F ${label} \u0443\u0434\u0430\u043B\u0435\u043D\u0430: \u0442\u043E\u0432\u0430\u0440\u043E\u0432 ${deletedProducts}, \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u043E\u0432 ${deletedIntervals}`);
    } catch (err) {
      setDbStatus(String(err && err.message ? err.message : err), true);
    } finally {
      withBusy(false);
    }
  };
  saveBtn.addEventListener("click", async () => {
    withBusy(true);
    setSyncStatus("\u0421\u043E\u0445\u0440\u0430\u043D\u044F\u044E...");
    try {
      const values = readForm();
      const mode = toMode(values);
      await storageSet({
        [STORAGE_KEYS.mode]: mode,
        [STORAGE_KEYS.url]: values.url,
        [STORAGE_KEYS.restoreSingle]: !!values.restoreSingle,
        [STORAGE_KEYS.restoreBatch]: !!values.restoreBatch,
        [STORAGE_KEYS.pageMark]: !!values.pageMark
      });
      await sendMonitor("monitor:set-config", {
        mode,
        url: values.url
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
  testBtn.addEventListener("click", async () => {
    withBusy(true);
    setSyncStatus("\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E \u0441\u0435\u0440\u0432\u0435\u0440...");
    try {
      renderModeTitle();
      const probeState = await resolveProbeStateAny();
      if (probeState === "empty-url") {
        applySyncState("empty-url");
        return;
      }
      if (probeState === "reachable") {
        setSyncStatus(syncEnabledEl.checked ? "\u0421\u0435\u0440\u0432\u0435\u0440 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D. \u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442." : "\u0421\u0435\u0440\u0432\u0435\u0440 \u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D. \u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u044F \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u0430.");
        setupHelpEl.hidden = true;
        return;
      }
      setSyncStatus(syncEnabledEl.checked ? "\u0421\u0435\u0440\u0432\u0435\u0440 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D. \u0421\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0430\u0446\u0438\u0438 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442." : "\u0421\u0435\u0440\u0432\u0435\u0440 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D.", true);
      setupHelpEl.hidden = false;
    } catch (err) {
      setSyncStatus(String(err && err.message ? err.message : err), true);
    } finally {
      withBusy(false);
    }
  });
  exportBtn.addEventListener("click", async () => {
    withBusy(true);
    setDbStatus("\u042D\u043A\u0441\u043F\u043E\u0440\u0442\u0438\u0440\u0443\u044E \u0438\u0441\u0442\u043E\u0440\u0438\u044E...");
    try {
      const data = await exportDbDirect();
      const json = JSON.stringify(data || {}, null, 2);
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      const a = document.createElement("a");
      a.href = url;
      a.download = `owb-price-history-all-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
      setDbStatus("\u042D\u043A\u0441\u043F\u043E\u0440\u0442 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D");
    } catch (err) {
      setDbStatus(String(err && err.message ? err.message : err), true);
    } finally {
      withBusy(false);
    }
  });
  importAppendBtn.addEventListener("click", () => {
    pendingImportMode = "append";
    importFileEl.value = "";
    importFileEl.click();
  });
  importReplaceBtn.addEventListener("click", () => {
    pendingImportMode = "replace";
    importFileEl.value = "";
    importFileEl.click();
  });
  importFileEl.addEventListener("change", async () => {
    const file = importFileEl.files && importFileEl.files[0];
    if (!file) return;
    withBusy(true);
    setDbStatus("\u0418\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u0443\u044E \u0438\u0441\u0442\u043E\u0440\u0438\u044E...");
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const mode = pendingImportMode === "replace" ? "replace" : "append";
      const data = await importDbDirect(payload, mode);
      const imported = data && Number.isFinite(data.imported) ? data.imported : 0;
      const products = data && Number.isFinite(data.products) ? data.products : 0;
      const intervals = data && Number.isFinite(data.intervals) ? data.intervals : 0;
      const modeText = mode === "replace" ? "\u0437\u0430\u043C\u0435\u043D\u0430" : "\u0434\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435";
      await inspectDb();
      setDbStatus(`\u0418\u043C\u043F\u043E\u0440\u0442 (${modeText}) \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D: ${imported} \u0437\u0430\u043F\u0438\u0441\u0435\u0439, \u0442\u043E\u0432\u0430\u0440\u043E\u0432 ${products}, \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u043E\u0432 ${intervals}`);
    } catch (err) {
      setDbStatus(String(err && err.message ? err.message : err), true);
    } finally {
      withBusy(false);
    }
  });
  resetMarketBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      resetSelectedMarket(btn.dataset.resetMarket).catch((err) => {
        setDbStatus(String(err && err.message ? err.message : err), true);
      });
    });
  });
  syncEnabledEl.addEventListener("change", () => {
    renderModeTitle();
    applySyncState(resolveSyncStateNoProbe());
  });
  urlEl.addEventListener("input", () => {
    applySyncState(resolveSyncStateNoProbe());
  });
  if (copyServerCmdBtn) {
    copyServerCmdBtn.addEventListener("click", async () => {
      try {
        await copyTextToClipboard("python local_price_server.py");
        setSyncStatus("\u041A\u043E\u043C\u0430\u043D\u0434\u0430 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0430.");
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
})();

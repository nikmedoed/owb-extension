"use strict";
(() => {
  // src/popup/popup.js
  var statusLineEl = document.getElementById("statusLine");
  var metaLineEl = document.getElementById("metaLine");
  var openOptionsBtn = document.getElementById("openOptionsBtn");
  var quickChartEl = document.getElementById("quickChart");
  var chartTitleEl = document.getElementById("chartTitle");
  var chartMetaEl = document.getElementById("chartMeta");
  var chartCanvasEl = document.getElementById("chartCanvas");
  var chartHintEl = document.getElementById("chartHint");
  var resetProductBtn = document.getElementById("resetProductBtn");
  var editHistoryBtn = document.getElementById("editHistoryBtn");
  var batchDownloadBtn = document.getElementById("batchDownloadBtn");
  var batchDownloadAllBtn = document.getElementById("batchDownloadAllBtn");
  var batchCopyBtn = document.getElementById("batchCopyBtn");
  var batchCopyAllBtn = document.getElementById("batchCopyAllBtn");
  var closeDuplicatesBtn = document.getElementById("closeDuplicatesBtn");
  var batchMetaLineEl = document.getElementById("batchMetaLine");
  var lastSessionTextEl = document.getElementById("lastSessionText");
  var copyLastSessionBtn = document.getElementById("copyLastSessionBtn");
  var MARKET_HOST_RE = /(^|\.)((ozon\.(ru|com|kz|by|uz|am|kg|ge))|(wildberries\.(ru|by|kz|uz|am|kg|ge))|(wb\.ru)|(aliexpress\.(ru|com))|(amazon\.com))$/i;
  var currentProduct = null;
  var currentIntervalCount = 0;
  var sendRuntimeMessage = (message) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "Cannot communicate with extension"));
        return;
      }
      resolve(response);
    });
  });
  var queryTabs = (queryInfo) => new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "Cannot query tabs"));
        return;
      }
      resolve(tabs || []);
    });
  });
  var sendMessageToTab = (tabId, message) => new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "Cannot communicate with tab"));
        return;
      }
      resolve(response);
    });
  });
  var updateResetButtonState = (busy = false) => {
    if (!resetProductBtn) return;
    const hasCurrentProduct = !!(currentProduct && currentProduct.pidKey);
    resetProductBtn.hidden = !hasCurrentProduct;
    resetProductBtn.disabled = busy || !hasCurrentProduct;
  };
  var updateEditHistoryButtonState = (busy = false) => {
    if (!editHistoryBtn) return;
    const hasCurrentProduct = !!(currentProduct && currentProduct.pidKey);
    editHistoryBtn.hidden = !hasCurrentProduct;
    editHistoryBtn.disabled = busy || !hasCurrentProduct;
  };
  var withBusy = (busy) => {
    if (batchDownloadBtn) batchDownloadBtn.disabled = busy;
    if (batchDownloadAllBtn) batchDownloadAllBtn.disabled = busy;
    if (batchCopyBtn) batchCopyBtn.disabled = busy;
    if (batchCopyAllBtn) batchCopyAllBtn.disabled = busy;
    if (closeDuplicatesBtn) closeDuplicatesBtn.disabled = busy;
    if (copyLastSessionBtn) copyLastSessionBtn.disabled = busy;
    updateResetButtonState(busy);
    updateEditHistoryButtonState(busy);
  };
  var setBatchMeta = (text) => {
    if (!batchMetaLineEl) return;
    batchMetaLineEl.textContent = String(text || "");
  };
  var setStatus = (line, meta = "", isError = false) => {
    const text = String(line || "");
    const details = String(meta || "");
    if (statusLineEl) {
      statusLineEl.textContent = text;
      statusLineEl.style.color = isError ? "#b42318" : "#1f2328";
    }
    if (metaLineEl) metaLineEl.textContent = details;
    if (!statusLineEl && !metaLineEl) {
      setBatchMeta([text, details].filter(Boolean).join(" \xB7 "));
    }
  };
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
    if (!ok) throw new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0442\u0435\u043A\u0441\u0442");
    return true;
  };
  var renderLastSession = (session) => {
    if (!lastSessionTextEl) return;
    if (!session || typeof session !== "object") {
      lastSessionTextEl.value = "";
      setBatchMeta("");
      return;
    }
    const modeLabel = session.mode === "copy" ? "\u0431\u0443\u0444\u0435\u0440" : "\u0444\u0430\u0439\u043B\u044B";
    const whenText = session.createdAt ? new Date(Number(session.createdAt)).toLocaleString("ru-RU") : "";
    const totals = `\u0423\u0441\u043F\u0435\u0445: ${session.successCount || 0}/${session.totalTabs || 0}, \u043E\u0448\u0438\u0431\u043E\u043A: ${session.failCount || 0}`;
    const extra = session.storedTruncated ? " \xB7 \u0442\u0435\u043A\u0441\u0442 \u0432 \u0441\u0435\u0441\u0441\u0438\u0438 \u043E\u0431\u0440\u0435\u0437\u0430\u043D" : "";
    setBatchMeta([whenText, modeLabel, totals].filter(Boolean).join(" \xB7 ") + extra);
    lastSessionTextEl.value = String(session.combinedText || session.text || "");
  };
  var callMonitor = async (action, payload = null) => {
    const actionMap = {
      "monitor:get-status": "owb:price-get-status",
      "batch:run-window-export": "owb:batch-run-window-export",
      "batch:get-last-session": "owb:batch-get-last-session",
      "tabs:close-duplicates": "owb:tabs-close-duplicates"
    };
    const type = actionMap[action];
    if (!type) throw new Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435");
    const response = await sendRuntimeMessage({
      type,
      payload: payload || {}
    });
    if (!response) throw new Error("\u041D\u0435\u0442 \u043E\u0442\u0432\u0435\u0442\u0430 \u043E\u0442 background");
    if (!response.ok) throw new Error(response.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438");
    return response.data;
  };
  var getActiveTab = async () => {
    const tabs = await queryTabs({ active: true, currentWindow: true });
    return tabs[0] || null;
  };
  var parseProductFromUrl = (url) => {
    try {
      const u = new URL(String(url || ""));
      if (!/^https?:$/i.test(u.protocol)) return null;
      const host = String(u.hostname || "").toLowerCase();
      const path = String(u.pathname || "");
      if (!MARKET_HOST_RE.test(host)) return null;
      if (host.includes("ozon")) {
        const m = path.match(/\/product\/[^/]*?(\d{5,})(?:\/|$)/) || path.match(/\/product\/(\d{5,})(?:\/|$)/);
        if (!m) return null;
        return { market: "ozon", pid: m[1], pidKey: `ozon:${m[1]}` };
      }
      if (host.includes("wildberries") || host.endsWith("wb.ru")) {
        const m = path.match(/\/catalog\/(\d{4,})\/detail/i) || path.match(/\/catalog\/(\d{4,})\/feedbacks/i);
        if (!m) return null;
        return { market: "wb", pid: m[1], pidKey: `wb:${m[1]}` };
      }
      if (host.includes("aliexpress")) {
        const m = path.match(/\/item\/(\d{8,})(?:\.html)?(?:\/|$)/i) || path.match(/\/i\/(\d{8,})(?:\.html)?(?:\/|$)/i);
        if (!m) return null;
        return { market: "aliexpress", pid: m[1], pidKey: `aliexpress:${m[1]}` };
      }
      if (host.includes("amazon.")) {
        const m = path.match(/\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
        if (!m) return null;
        const asin = String(m[1] || "").toUpperCase();
        return { market: "amazon", pid: asin, pidKey: `amazon:${asin}` };
      }
      return null;
    } catch (_) {
      return null;
    }
  };
  var requestCurrentProductFromTab = async (tabId) => {
    if (!tabId) return null;
    try {
      const res = await sendMessageToTab(tabId, { scope: "owb", action: "monitor:get-current-product" });
      if (!res || !res.ok || !res.data) return null;
      const pidKey = String(res.data.pidKey || "").trim();
      if (!pidKey) return null;
      return {
        market: String(res.data.market || "").trim(),
        pid: String(res.data.pid || "").trim(),
        pidKey,
        currency: String(res.data.currency || "").trim()
      };
    } catch (_) {
      return null;
    }
  };
  var intervalsToSeries = (intervals) => {
    const out = [];
    (Array.isArray(intervals) ? intervals : []).forEach((item) => {
      const price = Number(item && item.price);
      const firstTs = Number(item && item.firstTs);
      const lastTs = Number(item && item.lastTs);
      if (!Number.isFinite(price) || !Number.isFinite(firstTs) || !Number.isFinite(lastTs)) return;
      const base = { price, currency: String(item.currency || "") };
      out.push({ ...base, ts: Math.min(firstTs, lastTs) });
      if (lastTs !== firstTs) out.push({ ...base, ts: Math.max(firstTs, lastTs) });
    });
    const map = /* @__PURE__ */ new Map();
    out.forEach((p) => {
      map.set(`${p.ts}:${Math.round(p.price * 1e4)}:${String(p.currency || "")}`, p);
    });
    return [...map.values()].sort((a, b) => a.ts - b.ts);
  };
  var formatPrice = (value, currency = "") => {
    if (!Number.isFinite(Number(value))) return "\u2014";
    const text = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value));
    return currency ? `${text} ${currency}` : text;
  };
  var clearQuickChart = (title, meta, hint) => {
    currentIntervalCount = 0;
    quickChartEl.hidden = false;
    chartTitleEl.textContent = title || "\u0413\u0440\u0430\u0444\u0438\u043A \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u0442\u043E\u0432\u0430\u0440\u0430";
    chartMetaEl.textContent = meta || "";
    chartHintEl.textContent = hint || "";
    const ctx = chartCanvasEl.getContext("2d");
    ctx.clearRect(0, 0, chartCanvasEl.width, chartCanvasEl.height);
  };
  var drawQuickChart = (points, currency) => {
    const width = Math.max(220, Math.floor(chartCanvasEl.clientWidth || 296));
    const height = 96;
    const dpr = window.devicePixelRatio || 1;
    chartCanvasEl.width = width * dpr;
    chartCanvasEl.height = height * dpr;
    const ctx = chartCanvasEl.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!points.length) return;
    const prices = points.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const minTs = points[0].ts;
    const maxTs = points[points.length - 1].ts;
    const pad = max - min === 0 ? Math.max(1, min * 0.05) : (max - min) * 0.1;
    const minVal = min - pad;
    const maxVal = max + pad;
    const tsRange = Math.max(1, maxTs - minTs);
    const left = 6;
    const right = 6;
    const top = 8;
    const bottom = 14;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const graphPoints = points.map((p) => ({
      x: left + (p.ts - minTs) / tsRange * plotW,
      y: top + (1 - (p.price - minVal) / (maxVal - minVal || 1)) * plotH,
      ts: p.ts,
      price: p.price
    }));
    const area = ctx.createLinearGradient(0, top, 0, height);
    area.addColorStop(0, "rgba(26,115,232,0.22)");
    area.addColorStop(1, "rgba(26,115,232,0.03)");
    ctx.beginPath();
    ctx.moveTo(graphPoints[0].x, graphPoints[0].y);
    graphPoints.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(graphPoints[graphPoints.length - 1].x, top + plotH);
    ctx.lineTo(graphPoints[0].x, top + plotH);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(graphPoints[0].x, graphPoints[0].y);
    graphPoints.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = "#1a73e8";
    ctx.lineWidth = 2;
    ctx.stroke();
    const last = graphPoints[graphPoints.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = "#1a73e8";
    ctx.fill();
    const currentPrice = points[points.length - 1].price;
    chartMetaEl.textContent = `\u0422\u0435\u043A\u0443\u0449\u0430\u044F ${formatPrice(currentPrice, currency)} \xB7 \u041C\u0438\u043D ${formatPrice(min, currency)} \xB7 \u041C\u0430\u043A\u0441 ${formatPrice(max, currency)}`;
    chartHintEl.textContent = `${currentIntervalCount || points.length} \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u043E\u0432 \xB7 ${new Date(minTs).toLocaleDateString("ru-RU")} \u2014 ${new Date(maxTs).toLocaleDateString("ru-RU")}`;
  };
  var loadQuickChart = async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.url) {
      currentProduct = null;
      updateResetButtonState();
      updateEditHistoryButtonState();
      clearQuickChart("\u0413\u0440\u0430\u0444\u0438\u043A \u0442\u0435\u043A\u0443\u0449\u0435\u0433\u043E \u0442\u043E\u0432\u0430\u0440\u0430", "", "\u0410\u043A\u0442\u0438\u0432\u043D\u0430\u044F \u0432\u043A\u043B\u0430\u0434\u043A\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430");
      return;
    }
    const fromUrl = parseProductFromUrl(tab.url);
    const fromTab = await requestCurrentProductFromTab(tab.id);
    const current = fromTab && fromTab.pidKey ? { ...fromUrl || {}, ...fromTab } : fromUrl;
    if (!current || !current.pidKey) {
      currentProduct = null;
      updateResetButtonState();
      updateEditHistoryButtonState();
      quickChartEl.hidden = true;
      return;
    }
    currentProduct = current;
    currentIntervalCount = 0;
    updateResetButtonState();
    updateEditHistoryButtonState();
    quickChartEl.hidden = false;
    chartTitleEl.textContent = `\u0413\u0440\u0430\u0444\u0438\u043A: ${current.pidKey}`;
    chartMetaEl.textContent = "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...";
    chartHintEl.textContent = "";
    const response = await sendRuntimeMessage({
      type: "owb:price-history",
      pidKey: current.pidKey,
      limit: 5e3,
      preferredCurrency: String(current.currency || "")
    });
    if (!response || !response.ok) {
      clearQuickChart(`\u0413\u0440\u0430\u0444\u0438\u043A: ${current.pidKey}`, "", response && response.error ? response.error : "\u041E\u0448\u0438\u0431\u043A\u0430 \u0447\u0442\u0435\u043D\u0438\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u0438");
      return;
    }
    const intervals = Array.isArray(response.data?.intervals) ? response.data.intervals : [];
    const cleanIntervals = intervals.filter((item) => item && Number.isFinite(Number(item.price)) && Number.isFinite(Number(item.firstTs)) && Number.isFinite(Number(item.lastTs))).sort((a, b) => Number(a.firstTs || 0) - Number(b.firstTs || 0));
    currentIntervalCount = cleanIntervals.length;
    const points = intervalsToSeries(cleanIntervals);
    if (!points.length) {
      clearQuickChart(`\u0413\u0440\u0430\u0444\u0438\u043A: ${current.pidKey}`, "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u0430\u044F", "\u041E\u0442\u043A\u0440\u043E\u0439 \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0443 \u0442\u043E\u0432\u0430\u0440\u0430 \u0438 \u043F\u043E\u0434\u043E\u0436\u0434\u0438 \u0441\u0431\u043E\u0440 \u0446\u0435\u043D\u044B");
      return;
    }
    const currency = points[points.length - 1].currency || "\u20BD";
    drawQuickChart(points, currency);
  };
  var openHistoryEditor = async () => {
    const pidKey = currentProduct && currentProduct.pidKey ? String(currentProduct.pidKey) : "";
    if (!pidKey) return;
    const response = await sendRuntimeMessage({
      type: "owb:price-open-history-editor",
      payload: {
        pidKey,
        currency: String(currentProduct.currency || "").trim()
      }
    });
    if (!response || !response.ok) throw new Error(response && response.error ? response.error : "\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043A\u0440\u044B\u0442\u0438\u044F \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440\u0430");
  };
  var refreshStatus = async () => {
    withBusy(true);
    try {
      await callMonitor("monitor:get-status");
    } catch (err) {
      setStatus(String(err.message || err), "", true);
    } finally {
      withBusy(false);
    }
  };
  var loadLastExportSession = async () => {
    try {
      const session = await callMonitor("batch:get-last-session");
      renderLastSession(session || null);
    } catch (_) {
      renderLastSession(null);
    }
  };
  var runWindowBatchExport = async (options = {}) => {
    const allReviews = options.allReviews === true;
    const mode = options.mode === "copy" ? "copy" : "download";
    const activeTab = await getActiveTab();
    const windowId = activeTab && Number.isFinite(Number(activeTab.windowId)) ? Number(activeTab.windowId) : null;
    withBusy(true);
    setStatus("\u0417\u0430\u043A\u0440\u044B\u0432\u0430\u044E \u043F\u043E\u0432\u0442\u043E\u0440\u044B \u043F\u0435\u0440\u0435\u0434 \u0437\u0430\u043F\u0443\u0441\u043A\u043E\u043C...");
    setBatchMeta("\u041F\u043E\u0434\u0433\u043E\u0442\u0430\u0432\u043B\u0438\u0432\u0430\u044E \u043E\u043A\u043D\u043E: \u0443\u0434\u0430\u043B\u044F\u044E \u0434\u0443\u0431\u043B\u0438\u043A\u0430\u0442\u044B \u0432\u043A\u043B\u0430\u0434\u043E\u043A");
    try {
      await callMonitor("tabs:close-duplicates", { windowId });
      setStatus("\u041E\u0431\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u044E \u0432\u043A\u043B\u0430\u0434\u043A\u0438 \u043E\u043A\u043D\u0430...");
      setBatchMeta("\u041F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u044E \u0432\u043A\u043B\u0430\u0434\u043A\u0438 \u0438 \u0441\u043E\u0431\u0438\u0440\u0430\u044E \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0438...");
      const result = await callMonitor("batch:run-window-export", {
        mode,
        allReviews,
        includeReviews: true,
        windowId
      });
      const combinedText = String(result && result.combinedText ? result.combinedText : "");
      let copyOk = mode !== "copy";
      let copyError = "";
      if (mode === "copy") {
        copyOk = !!(result && result.clipboard && result.clipboard.ok);
        copyError = String(result && result.clipboard && result.clipboard.error ? result.clipboard.error : "");
        if (!copyOk && combinedText) {
          try {
            await copyTextToClipboard(combinedText);
            copyOk = true;
            copyError = "";
          } catch (err) {
            copyError = String(err && err.message ? err.message : err);
          }
        }
        if (!copyOk && !copyError) {
          copyError = "\u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u043F\u0438\u0441\u0438 \u0432 \u0431\u0443\u0444\u0435\u0440";
        }
      }
      renderLastSession(result || null);
      const success = Number(result && result.successCount) || 0;
      const total = Number(result && result.totalTabs) || 0;
      const fails = Number(result && result.failCount) || 0;
      if (mode === "copy" && !copyOk) {
        const details = `\u0441\u043E\u0431\u0440\u0430\u043D\u043E, \u043D\u043E \u043D\u0435 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u0432 \u0431\u0443\u0444\u0435\u0440${copyError ? `: ${copyError}` : ""}${fails ? `, \u043E\u0448\u0438\u0431\u043E\u043A: ${fails}` : ""}`;
        setStatus(`\u0413\u043E\u0442\u043E\u0432\u043E: ${success}/${total} \u043A\u0430\u0440\u0442\u043E\u0447\u0435\u043A`, details, true);
        return;
      }
      const actionText = mode === "copy" ? "\u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u0432 \u0431\u0443\u0444\u0435\u0440" : "\u0441\u043A\u0430\u0447\u0430\u043D\u043E \u0444\u0430\u0439\u043B\u0430\u043C\u0438";
      setStatus(`\u0413\u043E\u0442\u043E\u0432\u043E: ${success}/${total} \u043A\u0430\u0440\u0442\u043E\u0447\u0435\u043A`, `${actionText}${fails ? `, \u043E\u0448\u0438\u0431\u043E\u043A: ${fails}` : ""}`, fails > 0);
    } catch (err) {
      setStatus(String(err && err.message ? err.message : err), "", true);
    } finally {
      withBusy(false);
    }
  };
  var closeDuplicatesInWindow = async () => {
    const activeTab = await getActiveTab();
    const windowId = activeTab && Number.isFinite(Number(activeTab.windowId)) ? Number(activeTab.windowId) : null;
    withBusy(true);
    setStatus("\u0418\u0449\u0443 \u043F\u043E\u0432\u0442\u043E\u0440\u044B \u0432\u043E \u0432\u043A\u043B\u0430\u0434\u043A\u0430\u0445...");
    setBatchMeta("\u041F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442: \u043C\u0430\u0433\u0430\u0437\u0438\u043D + \u0430\u0440\u0442\u0438\u043A\u0443\u043B, \u0437\u0430\u0442\u0435\u043C \u043E\u0434\u0438\u043D\u0430\u043A\u043E\u0432\u0430\u044F \u0441\u0441\u044B\u043B\u043A\u0430");
    try {
      const result = await callMonitor("tabs:close-duplicates", { windowId });
      const closedCount = Number(result && result.closedCount) || 0;
      const duplicateGroups = Number(result && result.duplicateGroups) || 0;
      const byPidKey = Number(result && result.byPidKey) || 0;
      const byUrlKey = Number(result && result.byUrlKey) || 0;
      const consideredTabs = Number(result && result.consideredTabs) || 0;
      const totalTabs = Number(result && result.totalTabs) || 0;
      if (closedCount <= 0) {
        setStatus("\u041F\u043E\u0432\u0442\u043E\u0440\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B", `\u041F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043E ${consideredTabs}/${totalTabs} \u0432\u043A\u043B\u0430\u0434\u043E\u043A`);
        return;
      }
      setStatus(`\u0417\u0430\u043A\u0440\u044B\u0442\u043E \u043F\u043E\u0432\u0442\u043E\u0440\u043E\u0432: ${closedCount}`, `\u0413\u0440\u0443\u043F\u043F: ${duplicateGroups} \xB7 \u043A\u043B\u044E\u0447\u0435\u0439 \u043F\u043E \u0430\u0440\u0442\u0438\u043A\u0443\u043B\u0443: ${byPidKey} \xB7 \u043F\u043E URL: ${byUrlKey}`);
    } catch (err) {
      setStatus(String(err && err.message ? err.message : err), "", true);
    } finally {
      withBusy(false);
    }
  };
  if (batchDownloadBtn) {
    batchDownloadBtn.addEventListener("click", () => {
      runWindowBatchExport({ mode: "download", allReviews: false }).catch((err) => {
        setStatus(String(err && err.message ? err.message : err), "", true);
      });
    });
  }
  if (batchDownloadAllBtn) {
    batchDownloadAllBtn.addEventListener("click", () => {
      runWindowBatchExport({ mode: "download", allReviews: true }).catch((err) => {
        setStatus(String(err && err.message ? err.message : err), "", true);
      });
    });
  }
  if (batchCopyBtn) {
    batchCopyBtn.addEventListener("click", () => {
      runWindowBatchExport({ mode: "copy", allReviews: false }).catch((err) => {
        setStatus(String(err && err.message ? err.message : err), "", true);
      });
    });
  }
  if (batchCopyAllBtn) {
    batchCopyAllBtn.addEventListener("click", () => {
      runWindowBatchExport({ mode: "copy", allReviews: true }).catch((err) => {
        setStatus(String(err && err.message ? err.message : err), "", true);
      });
    });
  }
  if (closeDuplicatesBtn) {
    closeDuplicatesBtn.addEventListener("click", () => {
      closeDuplicatesInWindow().catch((err) => {
        setStatus(String(err && err.message ? err.message : err), "", true);
      });
    });
  }
  if (editHistoryBtn) {
    editHistoryBtn.addEventListener("click", () => {
      openHistoryEditor().catch((err) => {
        setStatus(String(err && err.message ? err.message : err), "", true);
      });
    });
  }
  if (copyLastSessionBtn) {
    copyLastSessionBtn.addEventListener("click", async () => {
      const text = String(lastSessionTextEl && lastSessionTextEl.value || "").trim();
      if (!text) {
        setStatus("\u0412 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0439 \u0441\u0435\u0441\u0441\u0438\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0442\u0435\u043A\u0441\u0442\u0430");
        return;
      }
      try {
        await copyTextToClipboard(text);
        setStatus("\u0422\u0435\u043A\u0441\u0442 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0439 \u0441\u0435\u0441\u0441\u0438\u0438 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D");
      } catch (err) {
        setStatus(String(err && err.message ? err.message : err), "", true);
      }
    });
  }
  if (resetProductBtn) {
    resetProductBtn.addEventListener("click", async () => {
      const pidKey = currentProduct && currentProduct.pidKey ? String(currentProduct.pidKey) : "";
      if (!pidKey) return;
      const confirmed = globalThis.confirm(`\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0446\u0435\u043D \u0434\u043B\u044F ${pidKey}?`);
      if (!confirmed) return;
      withBusy(true);
      setStatus("\u0423\u0434\u0430\u043B\u044F\u044E \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0442\u043E\u0432\u0430\u0440\u0430...");
      try {
        const response = await sendRuntimeMessage({ type: "owb:price-reset-product", pidKey });
        if (!response || !response.ok) throw new Error(response && response.error ? response.error : "\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u0438");
        const deletedIntervals = Number(response.data?.deletedIntervals) || 0;
        const deletedProduct = response.data?.deletedProduct ? "\u0434\u0430" : "\u043D\u0435\u0442";
        const server = response.data?.server;
        const serverText = server && server.ok === false ? ` \xB7 \u0441\u0435\u0440\u0432\u0435\u0440 \u043D\u0435 \u043E\u0447\u0438\u0449\u0435\u043D: ${server.error || "\u043E\u0448\u0438\u0431\u043A\u0430"}` : server && !server.skipped ? ` \xB7 \u0441\u0435\u0440\u0432\u0435\u0440: ${Number(server.deletedIntervals) || 0}` : "";
        setStatus("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0443\u0434\u0430\u043B\u0435\u043D\u0430", `pidKey: ${pidKey} \xB7 \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u043E\u0432: ${deletedIntervals} \xB7 \u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0430: ${deletedProduct}${serverText}`, !!(server && server.ok === false));
        await loadQuickChart();
      } catch (err) {
        setStatus(String(err && err.message ? err.message : err), "", true);
      } finally {
        withBusy(false);
      }
    });
  }
  openOptionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  updateResetButtonState();
  Promise.allSettled([
    refreshStatus(),
    loadQuickChart(),
    loadLastExportSession()
  ]).catch((err) => {
    setStatus(String(err && err.message ? err.message : err), "", true);
  });
})();

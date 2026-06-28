"use strict";
(() => {
  // src/history/history.js
  var subtitleEl = document.getElementById("subtitle");
  var pidKeyInputEl = document.getElementById("pidKeyInput");
  var currencyInputEl = document.getElementById("currencyInput");
  var loadBtn = document.getElementById("loadBtn");
  var reloadBtn = document.getElementById("reloadBtn");
  var resetBtn = document.getElementById("resetBtn");
  var statusLineEl = document.getElementById("statusLine");
  var metaLineEl = document.getElementById("metaLine");
  var countLineEl = document.getElementById("countLine");
  var selectAllBoxEl = document.getElementById("selectAllBox");
  var deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
  var chartCanvasEl = document.getElementById("chartCanvas");
  var intervalListEl = document.getElementById("intervalList");
  var currentPidKey = "";
  var currentCurrency = "";
  var currentIntervals = [];
  var selectedIntervalIds = /* @__PURE__ */ new Set();
  var busy = false;
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
  var toInt = (value, fallback = 0) => {
    const n = Math.trunc(Number(value));
    return Number.isFinite(n) ? n : fallback;
  };
  var priceNorm = (value) => Math.round(Number(value) * 1e4);
  var intervalId = (interval) => {
    if (!interval) return "";
    if (interval.key) return `key:${interval.key}`;
    return [
      interval.pidKey,
      interval.firstTs,
      interval.lastTs,
      priceNorm(interval.price),
      String(interval.currency || "")
    ].join(":");
  };
  var trashIcon = () => `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6h18"></path>
      <path d="M8 6V4h8v2"></path>
      <path d="M6 6l1 15h10l1-15"></path>
      <path d="M10 10v7"></path>
      <path d="M14 10v7"></path>
    </svg>
`;
  var updateBulkControls = () => {
    const selectedCount = selectedIntervalIds.size;
    if (deleteSelectedBtn) {
      deleteSelectedBtn.disabled = busy || selectedCount <= 0;
      deleteSelectedBtn.textContent = selectedCount > 0 ? `\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435 (${selectedCount})` : "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435";
    }
    if (selectAllBoxEl) {
      const total = currentIntervals.length;
      selectAllBoxEl.disabled = busy || total <= 0;
      selectAllBoxEl.checked = total > 0 && selectedCount === total;
      selectAllBoxEl.indeterminate = selectedCount > 0 && selectedCount < total;
    }
  };
  var setBusy = (nextBusy) => {
    busy = !!nextBusy;
    [loadBtn, reloadBtn, resetBtn, deleteSelectedBtn].forEach((button) => {
      if (button) button.disabled = busy;
    });
    updateBulkControls();
    intervalListEl.querySelectorAll("button").forEach((button) => {
      button.disabled = busy;
    });
    intervalListEl.querySelectorAll("input").forEach((input) => {
      input.disabled = busy;
    });
  };
  var setStatus = (line, meta = "", isError = false) => {
    if (statusLineEl) {
      statusLineEl.textContent = String(line || "");
      statusLineEl.style.color = isError ? "#b42318" : "#1f2328";
    }
    if (metaLineEl) metaLineEl.textContent = String(meta || "");
  };
  var formatPrice = (value, currency = "") => {
    if (!Number.isFinite(Number(value))) return "-";
    const text = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value));
    return currency ? `${text} ${currency}` : text;
  };
  var formatDateTime = (ts) => {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return "-";
    return new Date(n).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  };
  var formatDuration = (firstTs, lastTs) => {
    const first = toInt(firstTs, 0);
    const last = toInt(lastTs, first);
    const diff = Math.max(0, last - first);
    if (!diff) return "\u0442\u043E\u0447\u043A\u0430";
    const minutes = Math.round(diff / 6e4);
    if (minutes < 60) return `${minutes} \u043C\u0438\u043D`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} \u0447`;
    return `${Math.round(hours / 24)} \u0434`;
  };
  var normalizeInterval = (item) => {
    if (!item) return null;
    const pidKey = String(item.pidKey || "").trim();
    const price = Number(item.price);
    const firstTs = toInt(item.firstTs, NaN);
    const lastTs = toInt(item.lastTs, NaN);
    if (!pidKey || !Number.isFinite(price) || !Number.isFinite(firstTs) || !Number.isFinite(lastTs)) return null;
    return {
      key: String(item.key || ""),
      pidKey,
      pid: String(item.pid || ""),
      price,
      currency: String(item.currency || ""),
      firstTs: Math.min(firstTs, lastTs),
      lastTs: Math.max(firstTs, lastTs),
      updatedAt: toInt(item.updatedAt != null ? item.updatedAt : item.updatedTs, 0)
    };
  };
  var intervalsToSeries = (intervals) => {
    const out = [];
    intervals.forEach((item) => {
      const base = { price: item.price, currency: item.currency };
      out.push({ ...base, ts: item.firstTs });
      if (item.lastTs !== item.firstTs) out.push({ ...base, ts: item.lastTs });
    });
    const map = /* @__PURE__ */ new Map();
    out.forEach((point) => {
      map.set(`${point.ts}:${priceNorm(point.price)}:${String(point.currency || "")}`, point);
    });
    return [...map.values()].sort((a, b) => a.ts - b.ts);
  };
  var clearChart = () => {
    const ctx = chartCanvasEl.getContext("2d");
    ctx.clearRect(0, 0, chartCanvasEl.width, chartCanvasEl.height);
  };
  var drawChart = (points, currency) => {
    const width = Math.max(480, Math.floor(chartCanvasEl.clientWidth || 960));
    const height = 220;
    const dpr = window.devicePixelRatio || 1;
    chartCanvasEl.width = width * dpr;
    chartCanvasEl.height = height * dpr;
    const ctx = chartCanvasEl.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!points.length) return;
    const prices = points.map((point) => point.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const minTs = points[0].ts;
    const maxTs = points[points.length - 1].ts;
    const pad = max - min === 0 ? Math.max(1, min * 0.05) : (max - min) * 0.1;
    const minVal = min - pad;
    const maxVal = max + pad;
    const tsRange = Math.max(1, maxTs - minTs);
    const left = 42;
    const right = 14;
    const top = 18;
    const bottom = 34;
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const graphPoints = points.map((point) => ({
      x: left + (point.ts - minTs) / tsRange * plotW,
      y: top + (1 - (point.price - minVal) / (maxVal - minVal || 1)) * plotH,
      price: point.price
    }));
    ctx.strokeStyle = "#e1e7ef";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i += 1) {
      const y = top + plotH * i / 3;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(width - right, y);
      ctx.stroke();
    }
    ctx.fillStyle = "#5f6b7a";
    ctx.font = "12px Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(formatPrice(max, currency), 0, top + 4);
    ctx.fillText(formatPrice(min, currency), 0, top + plotH);
    ctx.fillText(new Date(minTs).toLocaleDateString("ru-RU"), left, height - 10);
    ctx.textAlign = "right";
    ctx.fillText(new Date(maxTs).toLocaleDateString("ru-RU"), width - right, height - 10);
    const area = ctx.createLinearGradient(0, top, 0, height);
    area.addColorStop(0, "rgba(26,115,232,0.22)");
    area.addColorStop(1, "rgba(26,115,232,0.03)");
    ctx.beginPath();
    ctx.moveTo(graphPoints[0].x, graphPoints[0].y);
    graphPoints.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(graphPoints[graphPoints.length - 1].x, top + plotH);
    ctx.lineTo(graphPoints[0].x, top + plotH);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(graphPoints[0].x, graphPoints[0].y);
    graphPoints.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.strokeStyle = "#1a73e8";
    ctx.lineWidth = 2;
    ctx.stroke();
    const last = graphPoints[graphPoints.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#1a73e8";
    ctx.fill();
  };
  var renderIntervals = () => {
    intervalListEl.textContent = "";
    selectedIntervalIds = new Set([...selectedIntervalIds].filter((id) => currentIntervals.some((interval) => intervalId(interval) === id)));
    updateBulkControls();
    if (countLineEl) countLineEl.textContent = currentIntervals.length ? `${currentIntervals.length} \u0448\u0442.` : "";
    if (!currentIntervals.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = currentPidKey ? "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0443\u0441\u0442\u0430" : "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 pidKey \u0438 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0438\u0441\u0442\u043E\u0440\u0438\u044E";
      intervalListEl.appendChild(empty);
      return;
    }
    [...currentIntervals].sort((a, b) => b.lastTs - a.lastTs || b.firstTs - a.firstTs).forEach((interval) => {
      const id = intervalId(interval);
      const row = document.createElement("div");
      row.className = "interval-row";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "row-check";
      check.checked = selectedIntervalIds.has(id);
      check.addEventListener("change", () => {
        if (check.checked) selectedIntervalIds.add(id);
        else selectedIntervalIds.delete(id);
        updateBulkControls();
      });
      const price = document.createElement("div");
      price.className = "interval-price";
      price.textContent = formatPrice(interval.price, interval.currency);
      const dates = document.createElement("div");
      dates.className = "interval-dates";
      const first = formatDateTime(interval.firstTs);
      const last = formatDateTime(interval.lastTs);
      dates.textContent = first === last ? first : `${first} - ${last}`;
      const meta = document.createElement("div");
      meta.className = "interval-meta";
      meta.textContent = formatDuration(interval.firstTs, interval.lastTs);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "icon-danger";
      del.title = "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B";
      del.setAttribute("aria-label", "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B");
      del.innerHTML = trashIcon();
      del.addEventListener("click", () => {
        deleteInterval(interval).catch((err) => {
          setStatus(String(err && err.message ? err.message : err), "", true);
          setBusy(false);
        });
      });
      row.append(check, price, dates, meta, del);
      intervalListEl.appendChild(row);
    });
  };
  var updateUrl = () => {
    const params = new URLSearchParams();
    if (currentPidKey) params.set("pidKey", currentPidKey);
    if (currentCurrency) params.set("currency", currentCurrency);
    const next = `${location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
    history.replaceState(null, "", next);
  };
  var loadHistory = async () => {
    const pidKey = String(pidKeyInputEl.value || "").trim();
    const preferredCurrency = String(currencyInputEl.value || "").trim();
    currentPidKey = pidKey;
    currentCurrency = preferredCurrency;
    updateUrl();
    if (subtitleEl) subtitleEl.textContent = pidKey || "";
    if (!pidKey) {
      currentIntervals = [];
      clearChart();
      renderIntervals();
      setStatus("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 pidKey");
      return;
    }
    setBusy(true);
    setStatus("\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0438\u0441\u0442\u043E\u0440\u0438\u044E...");
    try {
      const response = await sendRuntimeMessage({
        type: "owb:price-history",
        pidKey,
        limit: 1e4,
        preferredCurrency
      });
      if (!response || !response.ok) throw new Error(response && response.error ? response.error : "\u041E\u0448\u0438\u0431\u043A\u0430 \u0447\u0442\u0435\u043D\u0438\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u0438");
      currentIntervals = (Array.isArray(response.data?.intervals) ? response.data.intervals : []).map(normalizeInterval).filter(Boolean).sort((a, b) => a.firstTs - b.firstTs || a.lastTs - b.lastTs);
      const points = intervalsToSeries(currentIntervals);
      const currency = preferredCurrency || points[points.length - 1]?.currency || currentIntervals[currentIntervals.length - 1]?.currency || "";
      drawChart(points, currency);
      renderIntervals();
      if (!currentIntervals.length) {
        setStatus("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0443\u0441\u0442\u0430", pidKey);
        return;
      }
      const prices = currentIntervals.map((item) => item.price);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      setStatus(
        `\u0418\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u043E\u0432: ${currentIntervals.length}`,
        `\u041C\u0438\u043D ${formatPrice(min, currency)} \xB7 \u041C\u0430\u043A\u0441 ${formatPrice(max, currency)}`
      );
    } catch (err) {
      setStatus(String(err && err.message ? err.message : err), "", true);
    } finally {
      setBusy(false);
    }
  };
  var deleteInterval = async (interval) => {
    if (!interval || !interval.pidKey || busy) return;
    setBusy(true);
    setStatus("\u0423\u0434\u0430\u043B\u044F\u044E \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B...");
    try {
      const response = await sendRuntimeMessage({
        type: "owb:price-delete-interval",
        payload: {
          pidKey: interval.pidKey,
          key: interval.key || "",
          price: interval.price,
          currency: interval.currency || "",
          firstTs: interval.firstTs,
          lastTs: interval.lastTs
        }
      });
      if (!response || !response.ok) throw new Error(response && response.error ? response.error : "\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u0430");
      const localDeleted = Number(response.data?.deletedIntervals) || 0;
      const server = response.data?.server;
      const serverText = server && server.ok === false ? `\u0441\u0435\u0440\u0432\u0435\u0440 \u043D\u0435 \u043E\u0447\u0438\u0449\u0435\u043D: ${server.error || "\u043E\u0448\u0438\u0431\u043A\u0430"}` : server && !server.skipped ? `\u0441\u0435\u0440\u0432\u0435\u0440: ${Number(server.deletedIntervals) || 0}` : "";
      setStatus("\u0418\u043D\u0442\u0435\u0440\u0432\u0430\u043B \u0443\u0434\u0430\u043B\u0435\u043D", [`\u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E: ${localDeleted}`, serverText].filter(Boolean).join(" \xB7 "), !!(server && server.ok === false));
      selectedIntervalIds.delete(intervalId(interval));
      await loadHistory();
    } finally {
      setBusy(false);
    }
  };
  var deleteSelectedIntervals = async () => {
    if (busy || !selectedIntervalIds.size) return;
    const selected = currentIntervals.filter((interval) => selectedIntervalIds.has(intervalId(interval)));
    if (!selected.length) return;
    const confirmed = globalThis.confirm(`\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u044B: ${selected.length} \u0448\u0442.?`);
    if (!confirmed) return;
    setBusy(true);
    setStatus(`\u0423\u0434\u0430\u043B\u044F\u044E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u044B: ${selected.length}...`);
    let localDeleted = 0;
    let serverDeleted = 0;
    let serverError = "";
    try {
      for (const interval of selected) {
        const response = await sendRuntimeMessage({
          type: "owb:price-delete-interval",
          payload: {
            pidKey: interval.pidKey,
            key: interval.key || "",
            price: interval.price,
            currency: interval.currency || "",
            firstTs: interval.firstTs,
            lastTs: interval.lastTs
          }
        });
        if (!response || !response.ok) throw new Error(response && response.error ? response.error : "\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u0430");
        localDeleted += Number(response.data?.deletedIntervals) || 0;
        const server = response.data?.server;
        if (server && server.ok === false && !serverError) serverError = server.error || "\u043E\u0448\u0438\u0431\u043A\u0430";
        if (server && server.ok !== false && !server.skipped) serverDeleted += Number(server.deletedIntervals) || 0;
        selectedIntervalIds.delete(intervalId(interval));
      }
      const serverText = serverError ? `\u0441\u0435\u0440\u0432\u0435\u0440 \u043D\u0435 \u043E\u0447\u0438\u0449\u0435\u043D: ${serverError}` : serverDeleted ? `\u0441\u0435\u0440\u0432\u0435\u0440: ${serverDeleted}` : "";
      setStatus("\u0412\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435 \u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B\u044B \u0443\u0434\u0430\u043B\u0435\u043D\u044B", [`\u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E: ${localDeleted}`, serverText].filter(Boolean).join(" \xB7 "), !!serverError);
      await loadHistory();
    } finally {
      setBusy(false);
    }
  };
  var resetProductHistory = async () => {
    const pidKey = String(pidKeyInputEl.value || "").trim();
    if (!pidKey || busy) return;
    const confirmed = globalThis.confirm(`\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u0441\u044E \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0446\u0435\u043D \u0434\u043B\u044F ${pidKey}?`);
    if (!confirmed) return;
    setBusy(true);
    setStatus("\u0423\u0434\u0430\u043B\u044F\u044E \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0442\u043E\u0432\u0430\u0440\u0430...");
    try {
      const response = await sendRuntimeMessage({ type: "owb:price-reset-product", pidKey });
      if (!response || !response.ok) throw new Error(response && response.error ? response.error : "\u041E\u0448\u0438\u0431\u043A\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F \u0438\u0441\u0442\u043E\u0440\u0438\u0438");
      const localDeleted = Number(response.data?.deletedIntervals) || 0;
      const server = response.data?.server;
      const serverText = server && server.ok === false ? `\u0441\u0435\u0440\u0432\u0435\u0440 \u043D\u0435 \u043E\u0447\u0438\u0449\u0435\u043D: ${server.error || "\u043E\u0448\u0438\u0431\u043A\u0430"}` : server && !server.skipped ? `\u0441\u0435\u0440\u0432\u0435\u0440: ${Number(server.deletedIntervals) || 0}` : "";
      setStatus("\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0443\u0434\u0430\u043B\u0435\u043D\u0430", [`\u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E: ${localDeleted}`, serverText].filter(Boolean).join(" \xB7 "), !!(server && server.ok === false));
      await loadHistory();
    } finally {
      setBusy(false);
    }
  };
  var initFromUrl = () => {
    const params = new URLSearchParams(location.search);
    const pidKey = String(params.get("pidKey") || "").trim();
    const currency = String(params.get("currency") || "").trim();
    pidKeyInputEl.value = pidKey;
    currencyInputEl.value = currency;
    currentPidKey = pidKey;
    currentCurrency = currency;
    if (subtitleEl) subtitleEl.textContent = pidKey || "";
  };
  loadBtn.addEventListener("click", () => loadHistory());
  reloadBtn.addEventListener("click", () => loadHistory());
  selectAllBoxEl.addEventListener("change", () => {
    if (selectAllBoxEl.checked) selectedIntervalIds = new Set(currentIntervals.map(intervalId));
    else selectedIntervalIds.clear();
    renderIntervals();
  });
  deleteSelectedBtn.addEventListener("click", () => {
    deleteSelectedIntervals().catch((err) => {
      setStatus(String(err && err.message ? err.message : err), "", true);
      setBusy(false);
    });
  });
  resetBtn.addEventListener("click", () => {
    resetProductHistory().catch((err) => {
      setStatus(String(err && err.message ? err.message : err), "", true);
      setBusy(false);
    });
  });
  pidKeyInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadHistory();
  });
  currencyInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadHistory();
  });
  initFromUrl();
  renderIntervals();
  loadHistory().catch((err) => {
    setStatus(String(err && err.message ? err.message : err), "", true);
    setBusy(false);
  });
})();

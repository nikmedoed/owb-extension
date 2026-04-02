'use strict';

const statusLineEl = document.getElementById('statusLine');
const metaLineEl = document.getElementById('metaLine');
const openOptionsBtn = document.getElementById('openOptionsBtn');
const quickChartEl = document.getElementById('quickChart');
const chartTitleEl = document.getElementById('chartTitle');
const chartMetaEl = document.getElementById('chartMeta');
const chartCanvasEl = document.getElementById('chartCanvas');
const chartHintEl = document.getElementById('chartHint');
const resetProductBtn = document.getElementById('resetProductBtn');
const batchDownloadBtn = document.getElementById('batchDownloadBtn');
const batchDownloadAllBtn = document.getElementById('batchDownloadAllBtn');
const batchCopyBtn = document.getElementById('batchCopyBtn');
const batchCopyAllBtn = document.getElementById('batchCopyAllBtn');
const closeDuplicatesBtn = document.getElementById('closeDuplicatesBtn');
const batchMetaLineEl = document.getElementById('batchMetaLine');
const lastSessionTextEl = document.getElementById('lastSessionText');
const copyLastSessionBtn = document.getElementById('copyLastSessionBtn');

const MARKET_HOST_RE = /(^|\.)((ozon\.(ru|com|kz|by|uz|am|kg|ge))|(wildberries\.(ru|by|kz|uz|am|kg|ge))|(wb\.ru))$/i;
let currentProduct = null;

const sendRuntimeMessage = (message) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
            reject(new Error(err.message || 'Cannot communicate with extension'));
            return;
        }
        resolve(response);
    });
});

const queryTabs = (queryInfo) => new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
        const err = chrome.runtime.lastError;
        if (err) {
            reject(new Error(err.message || 'Cannot query tabs'));
            return;
        }
        resolve(tabs || []);
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

const updateResetButtonState = (busy = false) => {
    if (!resetProductBtn) return;
    const hasCurrentProduct = !!(currentProduct && currentProduct.pidKey);
    resetProductBtn.hidden = !hasCurrentProduct;
    resetProductBtn.disabled = busy || !hasCurrentProduct;
};

const withBusy = (busy) => {
    if (batchDownloadBtn) batchDownloadBtn.disabled = busy;
    if (batchDownloadAllBtn) batchDownloadAllBtn.disabled = busy;
    if (batchCopyBtn) batchCopyBtn.disabled = busy;
    if (batchCopyAllBtn) batchCopyAllBtn.disabled = busy;
    if (closeDuplicatesBtn) closeDuplicatesBtn.disabled = busy;
    if (copyLastSessionBtn) copyLastSessionBtn.disabled = busy;
    updateResetButtonState(busy);
};

const setBatchMeta = (text) => {
    if (!batchMetaLineEl) return;
    batchMetaLineEl.textContent = String(text || '');
};
const setStatus = (line, meta = '', isError = false) => {
    const text = String(line || '');
    const details = String(meta || '');
    if (statusLineEl) {
        statusLineEl.textContent = text;
        statusLineEl.style.color = isError ? '#b42318' : '#1f2328';
    }
    if (metaLineEl) metaLineEl.textContent = details;
    if (!statusLineEl && !metaLineEl) {
        setBatchMeta([text, details].filter(Boolean).join(' · '));
    }
};
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
    if (!ok) throw new Error('Не удалось скопировать текст');
    return true;
};
const renderLastSession = (session) => {
    if (!lastSessionTextEl) return;
    if (!session || typeof session !== 'object') {
        lastSessionTextEl.value = '';
        setBatchMeta('');
        return;
    }
    const modeLabel = session.mode === 'copy' ? 'буфер' : 'файлы';
    const whenText = session.createdAt ? new Date(Number(session.createdAt)).toLocaleString('ru-RU') : '';
    const totals = `Успех: ${session.successCount || 0}/${session.totalTabs || 0}, ошибок: ${session.failCount || 0}`;
    const extra = session.storedTruncated ? ' · текст в сессии обрезан' : '';
    setBatchMeta([whenText, modeLabel, totals].filter(Boolean).join(' · ') + extra);
    lastSessionTextEl.value = String(session.combinedText || session.text || '');
};

const callMonitor = async (action, payload = null) => {
    const actionMap = {
        'monitor:get-status': 'owb:price-get-status',
        'batch:run-window-export': 'owb:batch-run-window-export',
        'batch:get-last-session': 'owb:batch-get-last-session',
        'tabs:close-duplicates': 'owb:tabs-close-duplicates',
    };
    const type = actionMap[action];
    if (!type) throw new Error('Неизвестное действие');
    const response = await sendRuntimeMessage({
        type,
        payload: payload || {},
    });
    if (!response) throw new Error('Нет ответа от background');
    if (!response.ok) throw new Error(response.error || 'Ошибка операции');
    return response.data;
};

const applyStatus = (status) => {
    if (!status || typeof status !== 'object') return;
};

const getActiveTab = async () => {
    const tabs = await queryTabs({ active: true, currentWindow: true });
    return tabs[0] || null;
};

const parseProductFromUrl = (url) => {
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

const requestCurrentProductFromTab = async (tabId) => {
    if (!tabId) return null;
    try {
        const res = await sendMessageToTab(tabId, { scope: 'owb', action: 'monitor:get-current-product' });
        if (!res || !res.ok || !res.data) return null;
        const pidKey = String(res.data.pidKey || '').trim();
        if (!pidKey) return null;
        return {
            market: String(res.data.market || '').trim(),
            pid: String(res.data.pid || '').trim(),
            pidKey,
        };
    } catch (_) {
        return null;
    }
};

const intervalsToSeries = (intervals) => {
    const out = [];
    (Array.isArray(intervals) ? intervals : []).forEach((item) => {
        const price = Number(item && item.price);
        const firstTs = Number(item && item.firstTs);
        const lastTs = Number(item && item.lastTs);
        if (!Number.isFinite(price) || !Number.isFinite(firstTs) || !Number.isFinite(lastTs)) return;
        out.push({ ts: Math.min(firstTs, lastTs), price, currency: String(item.currency || '') });
        if (lastTs !== firstTs) out.push({ ts: Math.max(firstTs, lastTs), price, currency: String(item.currency || '') });
    });
    const map = new Map();
    out.forEach((p) => {
        map.set(`${p.ts}:${Math.round(p.price * 10000)}`, p);
    });
    return [...map.values()].sort((a, b) => a.ts - b.ts);
};

const formatPrice = (value, currency = '') => {
    if (!Number.isFinite(Number(value))) return '—';
    const text = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value));
    return currency ? `${text} ${currency}` : text;
};

const clearQuickChart = (title, meta, hint) => {
    quickChartEl.hidden = false;
    chartTitleEl.textContent = title || 'График текущего товара';
    chartMetaEl.textContent = meta || '';
    chartHintEl.textContent = hint || '';
    const ctx = chartCanvasEl.getContext('2d');
    ctx.clearRect(0, 0, chartCanvasEl.width, chartCanvasEl.height);
};

const drawQuickChart = (points, currency) => {
    const width = Math.max(220, Math.floor(chartCanvasEl.clientWidth || 296));
    const height = 96;
    const dpr = window.devicePixelRatio || 1;
    chartCanvasEl.width = width * dpr;
    chartCanvasEl.height = height * dpr;
    const ctx = chartCanvasEl.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!points.length) return;
    const prices = points.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const minTs = points[0].ts;
    const maxTs = points[points.length - 1].ts;
    const pad = (max - min) === 0 ? Math.max(1, min * 0.05) : (max - min) * 0.1;
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
        x: left + ((p.ts - minTs) / tsRange) * plotW,
        y: top + (1 - ((p.price - minVal) / (maxVal - minVal || 1))) * plotH,
        ts: p.ts,
        price: p.price,
    }));

    const area = ctx.createLinearGradient(0, top, 0, height);
    area.addColorStop(0, 'rgba(26,115,232,0.22)');
    area.addColorStop(1, 'rgba(26,115,232,0.03)');
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
    ctx.strokeStyle = '#1a73e8';
    ctx.lineWidth = 2;
    ctx.stroke();

    const last = graphPoints[graphPoints.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = '#1a73e8';
    ctx.fill();

    const currentPrice = points[points.length - 1].price;
    chartMetaEl.textContent = `Текущая ${formatPrice(currentPrice, currency)} · Мин ${formatPrice(min, currency)} · Макс ${formatPrice(max, currency)}`;
    chartHintEl.textContent = `${points.length} точек · ${new Date(minTs).toLocaleDateString('ru-RU')} — ${new Date(maxTs).toLocaleDateString('ru-RU')}`;
};

const loadQuickChart = async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.url) {
        currentProduct = null;
        updateResetButtonState();
        clearQuickChart('График текущего товара', '', 'Активная вкладка не найдена');
        return;
    }
    const fromUrl = parseProductFromUrl(tab.url);
    const current = fromUrl || await requestCurrentProductFromTab(tab.id);
    if (!current || !current.pidKey) {
        currentProduct = null;
        updateResetButtonState();
        quickChartEl.hidden = true;
        return;
    }
    currentProduct = current;
    updateResetButtonState();

    quickChartEl.hidden = false;
    chartTitleEl.textContent = `График: ${current.pidKey}`;
    chartMetaEl.textContent = 'Загрузка...';
    chartHintEl.textContent = '';

    const response = await sendRuntimeMessage({
        type: 'owb:price-history',
        pidKey: current.pidKey,
        limit: 5000,
    });
    if (!response || !response.ok) {
        clearQuickChart(`График: ${current.pidKey}`, '', response && response.error ? response.error : 'Ошибка чтения истории');
        return;
    }
    const intervals = Array.isArray(response.data?.intervals) ? response.data.intervals : [];
    const points = intervalsToSeries(intervals);
    if (!points.length) {
        clearQuickChart(`График: ${current.pidKey}`, 'История пока пустая', 'Открой карточку товара и подожди сбор цены');
        return;
    }
    const currency = points[points.length - 1].currency || '₽';
    drawQuickChart(points, currency);
};

const refreshStatus = async () => {
    withBusy(true);
    try {
        await callMonitor('monitor:get-status');
    } catch (err) {
        setStatus(String(err.message || err), '', true);
    } finally {
        withBusy(false);
    }
};

const loadLastExportSession = async () => {
    try {
        const session = await callMonitor('batch:get-last-session');
        renderLastSession(session || null);
    } catch (_) {
        renderLastSession(null);
    }
};

const runWindowBatchExport = async (options = {}) => {
    const allReviews = options.allReviews === true;
    const mode = options.mode === 'copy' ? 'copy' : 'download';
    const activeTab = await getActiveTab();
    const windowId = activeTab && Number.isFinite(Number(activeTab.windowId)) ? Number(activeTab.windowId) : null;

    withBusy(true);
    setStatus('Закрываю повторы перед запуском...');
    setBatchMeta('Подготавливаю окно: удаляю дубликаты вкладок');
    try {
        await callMonitor('tabs:close-duplicates', { windowId });
        setStatus('Обрабатываю вкладки окна...');
        setBatchMeta('Переключаю вкладки и собираю карточки...');
        const result = await callMonitor('batch:run-window-export', {
            mode,
            allReviews,
            includeReviews: true,
            windowId,
        });
        const combinedText = String(result && result.combinedText ? result.combinedText : '');
        let copyOk = mode !== 'copy';
        let copyError = '';
        if (mode === 'copy') {
            copyOk = !!(result && result.clipboard && result.clipboard.ok);
            copyError = String(result && result.clipboard && result.clipboard.error ? result.clipboard.error : '');
            if (!copyOk && combinedText) {
                try {
                    await copyTextToClipboard(combinedText);
                    copyOk = true;
                    copyError = '';
                } catch (err) {
                    copyError = String(err && err.message ? err.message : err);
                }
            }
            if (!copyOk && !copyError) {
                copyError = 'неизвестная ошибка записи в буфер';
            }
        }
        renderLastSession(result || null);
        const success = Number(result && result.successCount) || 0;
        const total = Number(result && result.totalTabs) || 0;
        const fails = Number(result && result.failCount) || 0;
        if (mode === 'copy' && !copyOk) {
            const details = `собрано, но не скопировано в буфер${copyError ? `: ${copyError}` : ''}${fails ? `, ошибок: ${fails}` : ''}`;
            setStatus(`Готово: ${success}/${total} карточек`, details, true);
            return;
        }
        const actionText = mode === 'copy' ? 'скопировано в буфер' : 'скачано файлами';
        setStatus(`Готово: ${success}/${total} карточек`, `${actionText}${fails ? `, ошибок: ${fails}` : ''}`, fails > 0);
    } catch (err) {
        setStatus(String(err && err.message ? err.message : err), '', true);
    } finally {
        withBusy(false);
    }
};

const closeDuplicatesInWindow = async () => {
    const activeTab = await getActiveTab();
    const windowId = activeTab && Number.isFinite(Number(activeTab.windowId)) ? Number(activeTab.windowId) : null;

    withBusy(true);
    setStatus('Ищу повторы во вкладках...');
    setBatchMeta('Приоритет: магазин + артикул, затем одинаковая ссылка');
    try {
        const result = await callMonitor('tabs:close-duplicates', { windowId });
        const closedCount = Number(result && result.closedCount) || 0;
        const duplicateGroups = Number(result && result.duplicateGroups) || 0;
        const byPidKey = Number(result && result.byPidKey) || 0;
        const byUrlKey = Number(result && result.byUrlKey) || 0;
        const consideredTabs = Number(result && result.consideredTabs) || 0;
        const totalTabs = Number(result && result.totalTabs) || 0;

        if (closedCount <= 0) {
            setStatus('Повторы не найдены', `Проверено ${consideredTabs}/${totalTabs} вкладок`);
            return;
        }
        setStatus(`Закрыто повторов: ${closedCount}`, `Групп: ${duplicateGroups} · ключей по артикулу: ${byPidKey} · по URL: ${byUrlKey}`);
    } catch (err) {
        setStatus(String(err && err.message ? err.message : err), '', true);
    } finally {
        withBusy(false);
    }
};

if (batchDownloadBtn) {
    batchDownloadBtn.addEventListener('click', () => {
        runWindowBatchExport({ mode: 'download', allReviews: false }).catch((err) => {
            setStatus(String(err && err.message ? err.message : err), '', true);
        });
    });
}
if (batchDownloadAllBtn) {
    batchDownloadAllBtn.addEventListener('click', () => {
        runWindowBatchExport({ mode: 'download', allReviews: true }).catch((err) => {
            setStatus(String(err && err.message ? err.message : err), '', true);
        });
    });
}
if (batchCopyBtn) {
    batchCopyBtn.addEventListener('click', () => {
        runWindowBatchExport({ mode: 'copy', allReviews: false }).catch((err) => {
            setStatus(String(err && err.message ? err.message : err), '', true);
        });
    });
}
if (batchCopyAllBtn) {
    batchCopyAllBtn.addEventListener('click', () => {
        runWindowBatchExport({ mode: 'copy', allReviews: true }).catch((err) => {
            setStatus(String(err && err.message ? err.message : err), '', true);
        });
    });
}
if (closeDuplicatesBtn) {
    closeDuplicatesBtn.addEventListener('click', () => {
        closeDuplicatesInWindow().catch((err) => {
            setStatus(String(err && err.message ? err.message : err), '', true);
        });
    });
}
if (copyLastSessionBtn) {
    copyLastSessionBtn.addEventListener('click', async () => {
        const text = String((lastSessionTextEl && lastSessionTextEl.value) || '').trim();
        if (!text) {
            setStatus('В последней сессии пока нет текста');
            return;
        }
        try {
            await copyTextToClipboard(text);
            setStatus('Текст последней сессии скопирован');
        } catch (err) {
            setStatus(String(err && err.message ? err.message : err), '', true);
        }
    });
}

if (resetProductBtn) {
    resetProductBtn.addEventListener('click', async () => {
        const pidKey = currentProduct && currentProduct.pidKey ? String(currentProduct.pidKey) : '';
        if (!pidKey) return;
        const confirmed = globalThis.confirm(`Удалить историю цен для ${pidKey}?`);
        if (!confirmed) return;

        withBusy(true);
        setStatus('Удаляю историю товара...');
        try {
            const response = await sendRuntimeMessage({ type: 'owb:price-reset-product', pidKey });
            if (!response || !response.ok) throw new Error(response && response.error ? response.error : 'Ошибка удаления истории');
            const deletedIntervals = Number(response.data?.deletedIntervals) || 0;
            const deletedProduct = response.data?.deletedProduct ? 'да' : 'нет';
            setStatus('История удалена', `pidKey: ${pidKey} · интервалов: ${deletedIntervals} · карточка: ${deletedProduct}`);
            await loadQuickChart();
        } catch (err) {
            setStatus(String(err && err.message ? err.message : err), '', true);
        } finally {
            withBusy(false);
        }
    });
}

openOptionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

updateResetButtonState();

Promise.allSettled([
    refreshStatus(),
    loadQuickChart(),
    loadLastExportSession(),
]).catch((err) => {
    setStatus(String(err && err.message ? err.message : err), '', true);
});

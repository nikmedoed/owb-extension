(function () {
    'use strict';

    const MP = window.MP;
    if (!MP) return;

    const {
        addStyleOnce,
        parsePriceValue,
        detectCurrency,
        formatPriceValue,
        extractDigits,
        findArticleByLabel,
        findBlockAnchor,
        findPriceInCard,
    } = MP;

const CFG = {
    productPollMs: 2500,
    cardPollMs: 3500,
    renderHeartbeatMs: 8000,
    captureHeartbeatMs: 60000,
    maxCardGroups: 220,
};

    const now = () => Date.now();
    const eq = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;
    const hasRuntime = () => !!(globalThis.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function');
    const toInt = (value, fallback = 0) => {
        const n = Math.trunc(Number(value));
        return Number.isFinite(n) ? n : fallback;
    };

    const sendRuntimeMessage = (payload, timeoutMs = 15000) => new Promise((resolve, reject) => {
        if (!hasRuntime()) {
            reject(new Error('Extension runtime is unavailable'));
            return;
        }
        let timer = null;
        const done = (fn, value) => {
            if (timer) clearTimeout(timer);
            fn(value);
        };
        timer = setTimeout(() => done(reject, new Error('Runtime message timeout')), Math.max(1500, Number(timeoutMs) || 15000));
        try {
            chrome.runtime.sendMessage(payload, (response) => {
                const err = chrome.runtime.lastError;
                if (err) {
                    done(reject, new Error(err.message || 'Runtime message failed'));
                    return;
                }
                done(resolve, response);
            });
        } catch (err) {
            done(reject, err instanceof Error ? err : new Error(String(err)));
        }
    });

    const callBg = async (type, extra = {}, timeoutMs = 15000) => {
        const response = await sendRuntimeMessage({ type, ...extra }, timeoutMs);
        if (!response || response.ok !== true) throw new Error((response && response.error) || 'Background request failed');
        return response.data;
    };
    const bgCaptureBatch = async (records) => callBg('owb:price-capture-batch', { records }, 20000);
    const bgGetHistory = async (pidKey) => {
        const data = await callBg('owb:price-history', { pidKey, limit: 5000 }, 15000);
        return Array.isArray(data?.intervals) ? data.intervals : [];
    };
    const bgGetMinBatch = async (pidKeys) => callBg('owb:price-min-batch', { pidKeys }, 15000);
    const bgExport = async () => callBg('owb:price-export', {}, 20000);
    const bgImport = async (payload) => callBg('owb:price-import', { payload }, 20000);
    const bgGetStatus = async () => callBg('owb:price-get-status', {}, 10000);
    const bgSetConfig = async (payload) => callBg('owb:price-set-config', { payload }, 10000);
    const bgSyncNow = async () => callBg('owb:price-sync-now', {}, 10000);

    const ensureChartStyles = () => addStyleOnce(`
        .mp-price-chart{margin-top:8px;margin-bottom:8px;padding:8px 10px 10px;border-radius:10px;border:1px solid rgba(0,0,0,0.08);background:linear-gradient(135deg,#f7f7f7,#ffffff);box-shadow:0 6px 16px rgba(0,0,0,0.08);color:#222;max-width:420px;width:100%;box-sizing:border-box;min-width:0;font-size:12px;line-height:1.3}
        .mp-price-chart__row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px}
        .mp-price-chart__title{font-weight:600;font-size:12px}
        .mp-price-chart__stats{font-size:11px;color:#555;text-align:right}
        .mp-price-chart__canvas-wrap{position:relative}
        .mp-price-chart canvas{width:100%;height:120px;display:block;max-width:100%}
        .mp-price-chart__dates{display:flex;justify-content:space-between;font-size:10px;color:#666;margin-top:4px}
        .mp-price-tooltip{position:absolute;pointer-events:none;background:rgba(17,17,17,0.92);color:#fff;padding:4px 6px;border-radius:4px;font-size:10px;transform:translate(-50%,-100%);white-space:nowrap;opacity:0;transition:opacity 0.1s ease}
        .mp-price-chart--floating{position:fixed;right:24px;bottom:90px;width:280px;z-index:2147483646}
        .mp-min-price-anchor{position:relative}
        .mp-min-price-badge{position:absolute;top:6px;left:6px;background:rgba(17,17,17,0.84);color:#fff;font-size:11px;line-height:1.2;padding:4px 6px;border-radius:6px;font-weight:600;letter-spacing:0.2px;box-shadow:0 6px 12px rgba(0,0,0,0.22);z-index:6;pointer-events:none}
        .mp-min-price-badge--empty{display:none}
    `, 'mp-price-monitor');

    const ensureChartContainer = (container, anchor, floating) => {
        ensureChartStyles();
        if (!container) {
            container = document.createElement('div');
            container.className = 'mp-price-chart';
            container.innerHTML = `
                <div class="mp-price-chart__row">
                    <div class="mp-price-chart__title">История цены</div>
                    <div class="mp-price-chart__stats"></div>
                </div>
                <div class="mp-price-chart__canvas-wrap">
                    <canvas></canvas>
                    <div class="mp-price-tooltip"></div>
                </div>
                <div class="mp-price-chart__dates"><span></span><span></span></div>
            `;
        }
        let targetAnchor = anchor;
        if (targetAnchor && targetAnchor.tagName === 'SPAN') targetAnchor = targetAnchor.parentElement || targetAnchor;
        if (floating || !targetAnchor) {
            container.classList.add('mp-price-chart--floating');
            if (!container.isConnected) document.body.appendChild(container);
            return container;
        }
        container.classList.remove('mp-price-chart--floating');
        if (container.previousElementSibling !== targetAnchor) {
            targetAnchor.insertAdjacentElement('afterend', container);
        }
        return container;
    };

    const intervalsToSeries = (intervals) => {
        const out = [];
        const list = [...(intervals || [])].filter(Boolean).sort((a, b) => toInt(a.firstTs, 0) - toInt(b.firstTs, 0));
        for (const interval of list) {
            const price = Number(interval.price);
            if (!Number.isFinite(price)) continue;
            const firstTs = toInt(interval.firstTs != null ? interval.firstTs : interval.ts, NaN);
            const lastTs = toInt(interval.lastTs != null ? interval.lastTs : interval.ts, NaN);
            if (!Number.isFinite(firstTs) || !Number.isFinite(lastTs)) continue;
            out.push({ ts: Math.min(firstTs, lastTs), price, currency: String(interval.currency || '') });
            if (lastTs !== firstTs) out.push({ ts: Math.max(firstTs, lastTs), price, currency: String(interval.currency || '') });
        }
        const dedupe = new Map();
        out.forEach((p) => {
            const key = `${p.ts}:${Math.round(p.price * 10000)}`;
            dedupe.set(key, p);
        });
        return [...dedupe.values()].sort((a, b) => a.ts - b.ts);
    };

    const renderChart = (container, history, opts = {}) => {
        if (!container) return;
        const canvas = container.querySelector('canvas');
        const stats = container.querySelector('.mp-price-chart__stats');
        const dates = container.querySelectorAll('.mp-price-chart__dates span');
        const tooltip = container.querySelector('.mp-price-tooltip');
        const currency = opts.currency || '₽';
        const data = [...(history || [])].filter(Boolean).sort((a, b) => a.ts - b.ts);
        if (!data.length) {
            stats.textContent = 'Нет данных';
            if (dates[0]) dates[0].textContent = '';
            if (dates[1]) dates[1].textContent = '';
            if (tooltip) tooltip.style.opacity = '0';
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        const styles = getComputedStyle(container);
        const padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
        const innerWidth = (container.clientWidth || 0) - padX;
        const width = innerWidth > 0 ? Math.floor(innerWidth) : 280;
        const height = 120;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const prices = data.map((item) => item.price);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const range = max - min;
        const pad = range === 0 ? Math.max(1, min * 0.05) : range * 0.1;
        const minVal = min - pad;
        const maxVal = max + pad;
        const minTs = data[0].ts;
        const maxTs = data[data.length - 1].ts;
        const tsRange = Math.max(1, maxTs - minTs);

        stats.textContent = `Мин ${formatPriceValue(min, currency)} · Макс ${formatPriceValue(max, currency)}`;
        if (dates[0]) dates[0].textContent = new Date(minTs).toLocaleDateString('ru-RU');
        if (dates[1]) dates[1].textContent = new Date(maxTs).toLocaleDateString('ru-RU');

        const left = 8;
        const right = 8;
        const top = 10;
        const bottom = 18;
        const plotW = width - left - right;
        const plotH = height - top - bottom;
        const points = data.map((item) => {
            const x = left + ((item.ts - minTs) / tsRange) * plotW;
            const t = (item.price - minVal) / (maxVal - minVal || 1);
            const y = top + (1 - t) * plotH;
            return { x, y, ts: item.ts, price: item.price };
        });

        const area = ctx.createLinearGradient(0, top, 0, height);
        area.addColorStop(0, 'rgba(26,115,232,0.22)');
        area.addColorStop(1, 'rgba(26,115,232,0.02)');

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.lineTo(points[points.length - 1].x, top + plotH);
        ctx.lineTo(points[0].x, top + plotH);
        ctx.closePath();
        ctx.fillStyle = area;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        points.forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.strokeStyle = '#1a73e8';
        ctx.lineWidth = 2;
        ctx.stroke();

        const findLastIndexByPrice = (target) => {
            let idx = 0;
            for (let i = 0; i < prices.length; i += 1) {
                if (prices[i] === target) idx = i;
            }
            return idx;
        };
        const drawMark = (idx, color) => {
            const point = points[idx];
            if (!point) return;
            ctx.beginPath();
            ctx.arc(point.x, point.y, 3.6, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();
        };
        drawMark(findLastIndexByPrice(min), '#00a86b');
        drawMark(findLastIndexByPrice(max), '#d93025');
        drawMark(points.length - 1, '#1a73e8');

        container.__mpChartPoints = points;
        container.__mpChartCurrency = currency;
        if (!container.__mpChartAttached) {
            container.__mpChartAttached = true;
            canvas.addEventListener('mousemove', (event) => {
                const pts = container.__mpChartPoints || [];
                if (!pts.length) return;
                const rect = canvas.getBoundingClientRect();
                const x = event.clientX - rect.left;
                let best = pts[0];
                let dist = Math.abs(pts[0].x - x);
                for (let i = 1; i < pts.length; i += 1) {
                    const d = Math.abs(pts[i].x - x);
                    if (d < dist) {
                        dist = d;
                        best = pts[i];
                    }
                }
                const tsLabel = new Date(best.ts).toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                });
                tooltip.textContent = `${tsLabel} · ${formatPriceValue(best.price, container.__mpChartCurrency || currency)}`;
                tooltip.style.left = `${best.x}px`;
                tooltip.style.top = `${best.y}px`;
                tooltip.style.opacity = '1';
            });
            canvas.addEventListener('mouseleave', () => {
                tooltip.style.opacity = '0';
            });
        }
    };

    const ensureBadge = (card) => {
        if (!card) return null;
        ensureChartStyles();
        card.classList.add('mp-min-price-anchor');
        let badge = card.querySelector('.mp-min-price-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'mp-min-price-badge mp-min-price-badge--empty';
            card.appendChild(badge);
        }
        return badge;
    };
    const renderBadge = (card, record) => {
        const badge = ensureBadge(card);
        if (!badge) return;
        if (!record || !Number.isFinite(Number(record.price))) {
            badge.textContent = '';
            badge.classList.add('mp-min-price-badge--empty');
            return;
        }
        const text = `Мин ${formatPriceValue(Number(record.price), record.currency || '₽')}`;
        if (badge.textContent !== text) badge.textContent = text;
        badge.classList.remove('mp-min-price-badge--empty');
    };

    const toCaptureRecord = (pidKey, pid, priceInfo, ts = now()) => {
        const price = priceInfo && priceInfo.price != null ? Number(priceInfo.price) : NaN;
        if (!pidKey || !Number.isFinite(price)) return null;
        const currency = String(priceInfo?.currency || '') || detectCurrency(String(priceInfo?.text || '')) || '₽';
        return { pidKey, pid: String(pid || ''), price, currency, ts };
    };

    const startProductTracker = (opts) => {
        const state = {
            running: false,
            pidKey: '',
            chart: null,
            lastPrice: NaN,
            lastCurrency: '',
            lastCaptureTs: 0,
            lastRenderTs: 0,
        };
        const tick = async () => {
            if (state.running) return;
            state.running = true;
            try {
                const onProductPage = typeof opts.isProductPage === 'function' ? !!opts.isProductPage() : true;
                if (!onProductPage) {
                    if (state.chart && state.chart.isConnected) state.chart.remove();
                    state.chart = null;
                    state.pidKey = '';
                    state.lastPrice = NaN;
                    state.lastCurrency = '';
                    state.lastCaptureTs = 0;
                    state.lastRenderTs = 0;
                    return;
                }

                const pid = await opts.getPid();
                if (pid) state.pidKey = `${opts.market}:${pid}`;
                const priceInfo = opts.getPrice();
                const anchor = opts.getAnchor ? opts.getAnchor() : null;
                state.chart = ensureChartContainer(state.chart, anchor, !anchor);

                const record = toCaptureRecord(state.pidKey, pid, priceInfo);
                let captured = false;
                if (record) {
                    const changed = !eq(state.lastPrice, record.price) || state.lastCurrency !== record.currency;
                    const heartbeat = !state.lastCaptureTs || (now() - state.lastCaptureTs) >= CFG.captureHeartbeatMs;
                    if (changed || heartbeat) {
                        await bgCaptureBatch([record]);
                        state.lastPrice = record.price;
                        state.lastCurrency = record.currency;
                        state.lastCaptureTs = now();
                        captured = true;
                    }
                }

                const t = now();
                if (state.pidKey && (captured || !state.lastRenderTs || (t - state.lastRenderTs) >= CFG.renderHeartbeatMs)) {
                    const intervals = await bgGetHistory(state.pidKey);
                    const history = intervalsToSeries(intervals);
                    renderChart(state.chart, history, { currency: record?.currency || state.lastCurrency || '₽' });
                    state.lastRenderTs = t;
                } else if (!state.pidKey) {
                    renderChart(state.chart, [], { currency: '₽' });
                }
            } catch (err) {
                console.warn('[OWB] product tracker failed:', err);
            } finally {
                state.running = false;
            }
        };
        setInterval(tick, CFG.productPollMs);
        tick();
    };

    const isBadgeCardCandidate = (card, market) => {
        if (!card || !card.isConnected) return false;
        const rect = card.getBoundingClientRect();
        const minSize = market === 'ozon' ? 90 : 120;
        if ((rect.width || 0) < minSize || (rect.height || 0) < minSize) return false;

        const inOzonSkuGrid = market === 'ozon' && !!card.closest('[data-widget="skuGrid"]');
        if (!inOzonSkuGrid && card.closest('#section-reviews, #section-questions, #product-feedbacks, [id*="reviews"], [id*="questions"]')) return false;
        if (market === 'ozon' && !inOzonSkuGrid && card.closest('[data-widget*="review" i], [data-widget*="question" i], [data-widget*="variant" i]')) return false;
        if (market === 'wb' && card.closest('[class*="review" i], [class*="feedback" i], [class*="question" i], .comments')) return false;

        const hasProductLink = !!card.querySelector('a[href*="/product/"], a[href*="/catalog/"][href*="/detail"]');
        const hasPidHint = !!(
            card.getAttribute('data-sku')
            || card.getAttribute('data-nm-id')
            || card.getAttribute('data-popup-nm-id')
            || card.querySelector('[data-sku], [data-nm-id], [data-popup-nm-id], [favlistslink*="sku="], a[href*="/product/"], a[href*="/catalog/"][href*="/detail"]')
            || card.getAttribute('favlistslink')
        );
        const hasImage = !!card.querySelector('img, picture');
        if (!hasImage) return false;
        if (!hasProductLink && !hasPidHint) return false;
        return true;
    };

    const collectGroupsFromCards = (opts) => {
        const groups = new Map();
        const cards = [...document.querySelectorAll(opts.cardSelector)].slice(0, 2000);
        const isCandidate = typeof opts.isCardCandidate === 'function'
            ? (card) => !!opts.isCardCandidate(card)
            : (card) => isBadgeCardCandidate(card, opts.market);
        for (const card of cards) {
            if (!isCandidate(card)) continue;
            const pid = opts.getPid(card);
            if (!pid) continue;
            const pidKey = `${opts.market}:${pid}`;
            if (!groups.has(pidKey)) groups.set(pidKey, { pid, pidKey, cards: [], priceInfo: null });
            const group = groups.get(pidKey);
            if (!group.cards.includes(card)) group.cards.push(card);
            const info = opts.getPrice(card);
            if (info && Number.isFinite(Number(info.price))) {
                if (!group.priceInfo || Number(info.price) < Number(group.priceInfo.price)) {
                    group.priceInfo = { price: Number(info.price), currency: info.currency || opts.defaultCurrency || '₽', text: card.textContent || '' };
                }
            }
        }
        return [...groups.values()].slice(0, CFG.maxCardGroups);
    };

    const startCardScanner = (opts) => {
        let running = false;
        const captureState = new Map();
        let renderedCards = new Set();
        const tick = async () => {
            if (running) return;
            running = true;
            try {
                const groups = opts.collectGroups();
                if (!groups.length) return;

                const captures = [];
                const pidKeys = [];
                const t = now();
                groups.forEach((group) => {
                    pidKeys.push(group.pidKey);
                    const rec = toCaptureRecord(group.pidKey, group.pid, group.priceInfo, t);
                    if (!rec) return;
                    const prev = captureState.get(group.pidKey) || { price: NaN, currency: '', ts: 0 };
                    const changed = !eq(prev.price, rec.price) || prev.currency !== rec.currency;
                    const heartbeat = !prev.ts || (t - prev.ts) >= CFG.captureHeartbeatMs;
                    if (!changed && !heartbeat) return;
                    captureState.set(group.pidKey, { price: rec.price, currency: rec.currency, ts: t });
                    captures.push(rec);
                });
                if (captures.length) await bgCaptureBatch(captures);

                const minMap = await bgGetMinBatch(pidKeys);
                const nextRendered = new Set();
                groups.forEach((group) => {
                    const min = minMap && typeof minMap === 'object' ? minMap[group.pidKey] : null;
                    group.cards.forEach((card) => {
                        const target = typeof opts.getBadgeTarget === 'function' ? (opts.getBadgeTarget(card) || card) : card;
                        nextRendered.add(target);
                        renderBadge(target, min);
                    });
                });
                renderedCards.forEach((card) => {
                    if (nextRendered.has(card)) return;
                    const badge = card && card.querySelector ? card.querySelector('.mp-min-price-badge') : null;
                    if (!badge) return;
                    badge.textContent = '';
                    badge.classList.add('mp-min-price-badge--empty');
                });
                renderedCards = nextRendered;
            } catch (err) {
                console.warn('[OWB] card scanner failed:', err);
            } finally {
                running = false;
            }
        };
        setInterval(tick, CFG.cardPollMs);
        tick();
    };
    let currentProductDetector = null;
    const setCurrentProductDetector = (detector) => {
        currentProductDetector = typeof detector === 'function' ? detector : null;
    };

    const initBridge = () => {
        if (!(globalThis.chrome && chrome.runtime && chrome.runtime.onMessage)) return;
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (!message || message.scope !== 'owb') return undefined;
            (async () => {
                switch (String(message.action || '')) {
                case 'monitor:get-status':
                    return bgGetStatus();
                case 'monitor:set-config':
                    return bgSetConfig(message.payload || {});
                case 'monitor:sync-now':
                    return bgSyncNow();
                case 'monitor:ping':
                    return bgGetStatus();
                case 'monitor:export-db':
                    return bgExport();
                case 'monitor:import-db':
                    return bgImport(message.payload || {});
                case 'monitor:get-current-product':
                    return currentProductDetector ? currentProductDetector() : null;
                default:
                    return null;
                }
            })().then((data) => sendResponse({ ok: true, data })).catch((err) => {
                sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
            });
            return true;
        });
    };

    initBridge();

    window.OWBPriceMonitor = {
        setCurrentProductDetector,
        startProductTracker,
        startCardScanner,
        collectGroupsFromCards,
        isBadgeCardCandidate,
        parsePriceValue,
        detectCurrency,
        extractDigits,
        findArticleByLabel,
        findBlockAnchor,
        findPriceInCard,
    };
})();

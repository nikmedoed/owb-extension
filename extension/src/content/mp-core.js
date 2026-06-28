(() => {
    'use strict';

    const MP = window.MP || (window.MP = {});
    const hasRuntime = () => !!(globalThis.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function');

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
        timer = setTimeout(() => done(reject, new Error('Runtime message timeout')), Math.max(1000, Number(timeoutMs) || 15000));
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

    const requestViaFetch = async (method, url, body, timeoutMs = 2500) => {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), Math.max(300, Number(timeoutMs) || 2500));
        try {
            const res = await fetch(url, {
                method,
                headers: body ? { 'Content-Type': 'application/json' } : {},
                body: body ? JSON.stringify(body) : undefined,
                signal: ctrl.signal,
            });
            const text = await res.text();
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            try {
                return text ? JSON.parse(text) : null;
            } catch (_) {
                return null;
            }
        } finally {
            clearTimeout(timeout);
        }
    };

    MP.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    MP.slug = (s) =>
        (s || 'export')
            .toLowerCase()
            .replace(/[^a-z0-9\u0400-\u04ff]+/gi, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 60);

    MP.wait = async (sel, t = 8000, step = 200) => {
        const start = Date.now();
        while (Date.now() - start < t) {
            const el = document.querySelector(sel);
            if (el) return el;
            await MP.sleep(step);
        }
        return null;
    };
    MP.smooth = async (el) => {
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await MP.sleep(400);
    };
    MP.ensureScrollTopButton = (() => {
        let btn = null;
        let scrollAttached = false;
        const position = { bottom: '24px', right: '24px' };
        const toCssUnit = (value) => (typeof value === 'number' ? `${value}px` : value);
        const applyPosition = () => {
            if (!btn) return;
            btn.style.bottom = toCssUnit(position.bottom);
            btn.style.right = toCssUnit(position.right);
        };
        const toggle = () => {
            if (!btn) return;
            const shouldShow = window.scrollY > window.innerHeight * 0.5;
            btn.style.opacity = shouldShow ? '1' : '0';
            btn.style.pointerEvents = shouldShow ? 'auto' : 'none';
        };
        return (opts = {}) => {
            if (opts.bottom !== undefined) position.bottom = opts.bottom;
            if (opts.right !== undefined) position.right = opts.right;
            if (!btn) {
                btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'mp-scroll-top-btn';
                btn.innerHTML = '&#8593;';
                btn.style.cssText = 'position:fixed;width:46px;height:46px;border-radius:50%;border:none;background:#1a73e8;color:#fff;font-size:24px;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(0,0,0,0.2);cursor:pointer;opacity:0;pointer-events:none;transition:opacity 0.2s ease;z-index:2147483647;';
                btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
                document.body.appendChild(btn);
                applyPosition();
                requestAnimationFrame(toggle);
            } else {
                applyPosition();
            }
            if (!scrollAttached) {
                scrollAttached = true;
                window.addEventListener('scroll', toggle, { passive: true });
                window.addEventListener('resize', toggle);
            }
            toggle();
            return btn;
        };
    })();
    MP.createBtn = (node, fn) => {
        if (!node || node.parentElement.querySelector('.mp-export-btn')) return;
        const b = document.createElement('button');
        b.textContent = 'Скачать';
        b.className = 'mp-export-btn';
        b.style.cssText = 'margin-left:8px;padding:4px 8px;font-size:14px;background:#4caf50;color:#fff;border:none;border-radius:4px;cursor:pointer;';
        b.addEventListener('click', fn);
        node.insertAdjacentElement('afterend', b);
    };
    MP.downloadTextFile = (name, text) => {
        const bom = '\uFEFF';
        const payloadText = `${bom}${text || ''}`;
        const fallback = () => {
            try {
                const blob = new Blob([payloadText], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = name || 'export.txt';
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1500);
            } catch (err) {
                console.warn('Download fallback failed:', err);
            }
        };

        if (!hasRuntime()) {
            fallback();
            return;
        }

        sendRuntimeMessage({
            type: 'owb:download-text',
            name: name || 'export.txt',
            text: payloadText,
        }).then((res) => {
            if (!res || !res.ok) fallback();
        }).catch(() => fallback());
    };
    MP.requestJson = async (method, base, path, body, timeout = 2500) => {
        const url = `${base}${path}`;
        if (!hasRuntime()) return requestViaFetch(method, url, body, timeout);
        const res = await sendRuntimeMessage({
            type: 'owb:request-json',
            method,
            url,
            body: body ?? null,
            timeout,
        }, Math.max(2000, (Number(timeout) || 2500) + 1500));
        if (res && res.ok) return res.data;
        throw new Error((res && res.error) || 'Request failed');
    };
    MP.addStyleOnce = (() => {
        const injected = new Set();
        return (css, key = css) => {
            if (injected.has(key)) return;
            injected.add(key);
            const s = document.createElement('style');
            s.textContent = css;
            document.head.appendChild(s);
        };
    })();
    MP.toBullets = (text) => {
        if (!text || text === '—') return ['—'];
        return text
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => `- ${l}`);
    };
    MP.cleanText = (value) => String(value || '').replace(/[\u00A0\u202F]/g, ' ').replace(/\s+/g, ' ').trim();
    MP.parsePriceValue = (text) => {
        if (!text) return null;
        const normalizedText = String(text).replace(/[\u00A0\u202F]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!normalizedText) return null;
        const escapedCurrencyChars = '₽€\\$£¥֏₸₺₴₹₩';
        const numberPattern = '\\d[\\d\\s.,]*';
        const afterCurrency = normalizedText.match(new RegExp(`[${escapedCurrencyChars}]\\s*(${numberPattern})`));
        const beforeCurrency = normalizedText.match(new RegExp(`(${numberPattern})\\s*[${escapedCurrencyChars}]`));
        const rawNumber = (afterCurrency && afterCurrency[1]) || (beforeCurrency && beforeCurrency[1]) || (normalizedText.match(/(\d[\d\s.,]*)/) || [])[1] || '';
        if (!rawNumber) return null;
        const compact = rawNumber.replace(/\s+/g, '');
        const comma = compact.lastIndexOf(',');
        const dot = compact.lastIndexOf('.');
        let prepared = compact;
        if (comma >= 0 && dot >= 0) {
            const decimalSep = comma > dot ? ',' : '.';
            const thousandsSep = decimalSep === ',' ? '.' : ',';
            prepared = compact.split(thousandsSep).join('').replace(decimalSep, '.');
        } else if (comma >= 0 || dot >= 0) {
            const sep = comma >= 0 ? ',' : '.';
            const parts = compact.split(sep);
            const last = parts[parts.length - 1] || '';
            prepared = parts.length > 2 || last.length === 3
                ? parts.join('')
                : compact.replace(sep, '.');
        }
        const direct = /^\d+(?:\.\d+)?$/.test(prepared) ? prepared : ((prepared.match(/\d+(?:\.\d+)?/) || [])[0] || '');
        if (!direct) return null;
        const value = Number(direct);
        return Number.isFinite(value) ? value : null;
    };
    MP.detectCurrency = (text) => {
        if (!text) return '';
        const raw = String(text);
        if (raw.includes('₽')) return '₽';
        if (raw.includes('€')) return '€';
        if (raw.includes('$')) return '$';
        if (raw.includes('£')) return '£';
        if (raw.includes('¥')) return '¥';
        if (raw.includes('֏')) return '֏';
        if (raw.includes('₸')) return '₸';
        if (raw.includes('₺')) return '₺';
        if (raw.includes('₴')) return '₴';
        if (raw.includes('₹')) return '₹';
        if (raw.includes('₩')) return '₩';
        const upper = raw.toUpperCase();
        if (/\b(USD|US)\b/.test(upper)) return '$';
        if (/\b(RUB|RUR)\b/.test(upper)) return '₽';
        if (/\bEUR\b/.test(upper)) return '€';
        if (/\bGBP\b/.test(upper)) return '£';
        if (/\b(CNY|RMB|JPY)\b/.test(upper)) return '¥';
        if (/\bKZT\b/.test(upper)) return '₸';
        if (/\bAMD\b/.test(upper)) return '֏';
        if (/\bTRY\b/.test(upper)) return '₺';
        if (/\bUAH\b/.test(upper)) return '₴';
        if (/\bINR\b/.test(upper)) return '₹';
        if (/\bKRW\b/.test(upper)) return '₩';
        return '';
    };
    MP.normalizeCurrency = (value) => {
        const raw = String(value || '').trim();
        const detected = MP.detectCurrency(raw);
        return detected || raw;
    };
    MP.getAliProductIdFromText = (text) => {
        const raw = String(text || '');
        const m = raw.match(/(?:productId|item_id|itemId|ae_object_value)[^\d]{0,20}(\d{8,})/i)
            || raw.match(/\b(100\d{10,}|[1-9]\d{9,})\b/);
        return m ? m[1] : '';
    };
    MP.getAliProductIdFromHref = (href, base = '') => {
        try {
            const url = new URL(String(href || ''), base || location.href);
            const path = String(url.pathname || '');
            const m = path.match(/\/item\/(\d{8,})(?:\.html)?(?:\/|$)/i)
                || path.match(/\/item\/(\d{8,})\/reviews(?:\/|$)/i)
                || path.match(/\/i\/(\d{8,})(?:\.html)?(?:\/|$)/i);
            return m ? m[1] : '';
        } catch (_) {
            return MP.getAliProductIdFromText(href);
        }
    };
    MP.getAliProductIdFromDocument = (root = document, href = '') => {
        const fromHref = MP.getAliProductIdFromHref(href || location.href);
        if (fromHref) return fromHref;
        const params = new URLSearchParams(location.search || '');
        const fromQuery = params.get('productId') || params.get('item_id') || params.get('itemId');
        if (fromQuery && /^\d{8,}$/.test(fromQuery)) return fromQuery;
        const source = root && root.querySelectorAll ? root : document;
        return MP.getAliProductIdFromText([
            ...source.querySelectorAll('[ae_object_value], [exp_product], [href*="/item/"], [href*="/i/"]'),
        ].map((el) => [
            el.getAttribute('ae_object_value'),
            el.getAttribute('exp_product'),
            el.getAttribute('href'),
        ].filter(Boolean).join(' ')).join(' '));
    };
    MP.getAliCurrencyFromAttrs = (root = document) => {
        const source = root && root.querySelector ? root : document;
        const attrNode = source.querySelector('[exp_attribute*="currency:"], [exp_attribute*="currency%3A"]')
            || document.querySelector('[exp_attribute*="currency:"], [exp_attribute*="currency%3A"]');
        const raw = attrNode?.getAttribute('exp_attribute') || '';
        const decoded = (() => {
            try { return decodeURIComponent(raw); } catch (_) { return raw; }
        })();
        const m = decoded.match(/currency\s*:\s*([A-Z]{3}|US)/i);
        return MP.normalizeCurrency(m && m[1]);
    };
    MP.formatPriceValue = (value, currency = '') => {
        if (!Number.isFinite(value)) return '—';
        const formatted = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
        return currency ? `${formatted} ${currency}` : formatted;
    };
    MP.extractDigits = (text) => {
        if (!text) return '';
        const match = text.match(/(\d{4,})/);
        return match ? match[1] : '';
    };
    MP.findArticleByLabel = (root, labelRe = /артикул|article|sku|код товара/i) => {
        if (!root) return '';
        const fromDl = [...root.querySelectorAll('dl')].find((dl) => labelRe.test(dl.querySelector('dt')?.textContent || ''));
        if (fromDl) {
            const val = MP.extractDigits(fromDl.querySelector('dd')?.textContent || '');
            if (val) return val;
        }
        const fromTable = [...root.querySelectorAll('tr')].find((tr) => labelRe.test(tr.querySelector('th')?.textContent || ''));
        if (fromTable) {
            const val = MP.extractDigits(fromTable.querySelector('td')?.textContent || '');
            if (val) return val;
        }
        const labeledNode = [...root.querySelectorAll('span, div, li, p')].find((n) => labelRe.test(n.textContent || ''));
        if (labeledNode) {
            const inline = MP.extractDigits(labeledNode.textContent || '');
            if (inline) return inline;
            const next = MP.extractDigits(labeledNode.nextElementSibling?.textContent || '');
            if (next) return next;
            const parentText = MP.extractDigits(labeledNode.parentElement?.textContent || '');
            if (parentText) return parentText;
        }
        const qaNode = root.querySelector('[data-qaid*="article"], [data-qaid*="sku"], [data-qaid*="product-article"]');
        return MP.extractDigits(qaNode?.textContent || '');
    };
    MP.findBlockAnchor = (node, classRe) => {
        let cur = node;
        while (cur && cur !== document.body) {
            if ((cur.tagName === 'DIV' || cur.tagName === 'SECTION' || cur.tagName === 'ARTICLE') && classRe.test(cur.className || '')) {
                return cur;
            }
            cur = cur.parentElement;
        }
        return node?.parentElement || node;
    };
    MP.findPriceInCard = (card, opts = {}) => {
        if (!card) return null;
        const nodes = [...card.querySelectorAll('ins, span, div, p, strong, b, del')];
        let best = null;
        const isPerUnitPriceText = (text) => {
            if (!text) return false;
            const t = String(text).replace(/[\u00A0\u202F]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
            if (!t) return false;
            if (/([₽€$£¥֏₸₺₴₹₩].*?\bза\b|\bза\b.*?[₽€$£¥֏₸₺₴₹₩])/.test(t) && /(г|гр|кг|мл|л|шт|шту|уп|упак|пак|таб|капс|доз|порц)/.test(t)) return true;
            if (/(?:\/|за)\s*\d+[.,]?\d*\s*(г|гр|кг|мл|л|шт|шту|уп|упак|пак|таб|капс|доз|порц)\b/.test(t)) return true;
            return false;
        };
        for (const n of nodes) {
            if (n.closest('.mp-min-price-badge')) continue;
            const text = (n.textContent || '').trim();
            if (!text || !/[₽€$£¥֏₸₺₴₹₩]/.test(text) || !/\d/.test(text)) continue;
            if (opts.ignorePerUnit !== false && isPerUnitPriceText(text)) continue;
            const price = MP.parsePriceValue(text);
            if (!Number.isFinite(price)) continue;
            const isOld = n.tagName === 'DEL' || n.closest('del') || /line-through/i.test(n.style.textDecoration || '');
            const currency = MP.detectCurrency(text) || opts.defaultCurrency || '₽';
            const cand = { price, currency, old: !!isOld };
            if (!best || (best.old && !cand.old) || (cand.old === best.old && cand.price < best.price)) {
                best = cand;
            }
        }
        return best;
    };
})();

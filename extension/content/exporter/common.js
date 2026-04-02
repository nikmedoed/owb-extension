(() => {
    'use strict';

    const MP = window.MP;
    if (!MP) {
        console.error('MP core not loaded');
        return;
    }
    if (window.OWBExporter && window.OWBExporter.__initialized) return;

    const { addStyleOnce } = MP;
    const state = {
        runExport: null,
        restoreFocus: null,
    };

    const hasRuntime = () => !!(globalThis.chrome && chrome.runtime && chrome.runtime.onMessage);

    const ensureActionButtonsStyles = () => addStyleOnce(`
        .mp-export-actions{display:inline-flex;flex-wrap:wrap;gap:6px;margin-left:8px;vertical-align:middle}
        .mp-export-actions .mp-export-btn{padding:4px 8px;font-size:13px;border:none;border-radius:6px;cursor:pointer;color:#fff;background:#2d7dd7}
        .mp-export-actions .mp-export-btn[data-kind="lite"]{background:#2f9e44}
        .mp-export-actions .mp-export-btn[data-kind="full"]{background:#1c7ed6}
        .mp-export-actions .mp-export-btn[data-kind="all"]{background:#f08c00}
        .mp-export-actions .mp-export-btn[data-kind="copy"]{background:#6f42c1}
        .mp-export-actions .mp-export-btn:disabled{opacity:.65;cursor:default}
    `, 'mp-export-actions');

    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) {}
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', 'readonly');
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('Clipboard write failed');
        return true;
    };
    const saveLastExtractSessionFromItem = async (item, options = {}) => {
        if (!hasRuntime() || !item || typeof item !== 'object') return false;
        const payload = {
            mode: options.mode === 'copy' ? 'copy' : 'download',
            allReviews: options.allReviews === true,
            tabId: Number.isFinite(Number(options.tabId)) ? Number(options.tabId) : null,
            item: {
                market: String(item.market || ''),
                pidKey: String(item.pidKey || ''),
                url: String(item.url || ''),
                title: String(item.title || ''),
                filename: String(item.filename || ''),
                text: String(item.text || ''),
            },
        };
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'owb:extract-save-last-session', payload }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve(false);
                    return;
                }
                resolve(!!(response && response.ok));
            });
        });
    };

    const attachActionButtons = (anchor, key, actions) => {
        if (!anchor || !anchor.parentElement || !Array.isArray(actions) || !actions.length) return;
        ensureActionButtonsStyles();
        if (anchor.parentElement.querySelector(`.mp-export-actions[data-key="${key}"]`)) return;

        const wrap = document.createElement('span');
        wrap.className = 'mp-export-actions';
        wrap.dataset.key = key;

        const setBusy = (busy) => {
            wrap.dataset.busy = busy ? '1' : '0';
            wrap.querySelectorAll('button').forEach((btn) => {
                btn.disabled = !!busy;
            });
        };
        const flash = (btn, original, textValue) => {
            btn.textContent = textValue;
            setTimeout(() => {
                btn.textContent = original;
            }, 1100);
        };
        const showNotice = (() => {
            let el = null;
            let timer = null;
            return (text, isError = false) => {
                const msg = String(text || '').trim();
                if (!msg) return;
                if (!el) {
                    el = document.createElement('div');
                    el.className = 'mp-export-notice';
                    el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:min(90vw,560px);padding:9px 12px;border-radius:10px;background:rgba(24,28,33,.94);color:#fff;font:600 13px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.26);pointer-events:none;opacity:0;transition:opacity .16s ease;';
                    document.body.appendChild(el);
                }
                el.textContent = msg;
                el.style.background = isError ? 'rgba(176,43,43,.96)' : 'rgba(24,28,33,.94)';
                el.style.opacity = '1';
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    if (el) el.style.opacity = '0';
                }, 1500);
            };
        })();

        actions.forEach((action) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mp-export-btn';
            btn.textContent = action.label;
            btn.dataset.kind = action.kind || 'full';
            btn.addEventListener('click', async () => {
                if (wrap.dataset.busy === '1') return;
                const original = btn.textContent;
                setBusy(true);
                btn.textContent = String(action.pendingText || '...');
                try {
                    await action.run();
                    flash(btn, original, String(action.successText || 'Готово'));
                    if (action.toastSuccess) showNotice(String(action.toastSuccess || ''));
                } catch (err) {
                    console.error('Export action failed:', err);
                    flash(btn, original, String(action.errorText || 'Ошибка'));
                    if (action.toastError) showNotice(String(action.toastError || ''), true);
                } finally {
                    setBusy(false);
                }
            });
            wrap.appendChild(btn);
        });
        anchor.insertAdjacentElement('afterend', wrap);
    };

    if (hasRuntime()) {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (!message || message.scope !== 'owb-export') return undefined;
            const action = String(message.action || '');
            if (action !== 'export-card' && action !== 'copy-text' && action !== 'restore-card-focus') return undefined;
            (async () => {
                if (action === 'copy-text') {
                    const text = String(message.payload && message.payload.text ? message.payload.text : '');
                    await copyToClipboard(text);
                    return { copied: true };
                }
                if (action === 'restore-card-focus') {
                    if (typeof state.restoreFocus === 'function') {
                        await state.restoreFocus(message.options || {});
                    }
                    return { restored: true };
                }
                if (typeof state.runExport !== 'function') throw new Error('Экспорт на текущей вкладке недоступен');
                return state.runExport(message.options || {});
            })().then((data) => {
                sendResponse({ ok: true, data });
            }).catch((err) => {
                sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
            });
            return true;
        });
    }

    window.OWBExporter = {
        __initialized: true,
        hasRuntime,
        attachActionButtons,
        copyToClipboard,
        saveLastExtractSessionFromItem,
        setRunExport: (handler) => {
            state.runExport = typeof handler === 'function' ? handler : null;
        },
        setRestoreFocus: (handler) => {
            state.restoreFocus = typeof handler === 'function' ? handler : null;
        },
    };
})();

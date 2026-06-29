(() => {
  // src/content/mp-core.js
  (() => {
    "use strict";
    const MP = window.MP || (window.MP = {});
    const hasRuntime = () => !!(globalThis.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === "function");
    const sendRuntimeMessage = (payload, timeoutMs = 15e3) => new Promise((resolve, reject) => {
      if (!hasRuntime()) {
        reject(new Error("Extension runtime is unavailable"));
        return;
      }
      let timer = null;
      const done = (fn, value) => {
        if (timer) clearTimeout(timer);
        fn(value);
      };
      timer = setTimeout(() => done(reject, new Error("Runtime message timeout")), Math.max(1e3, Number(timeoutMs) || 15e3));
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            done(reject, new Error(err.message || "Runtime message failed"));
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
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : void 0,
          signal: ctrl.signal
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
    MP.slug = (s) => (s || "export").toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60);
    MP.wait = async (sel, t = 8e3, step = 200) => {
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
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      await MP.sleep(400);
    };
    MP.ensureScrollTopButton = /* @__PURE__ */ (() => {
      let btn = null;
      let scrollAttached = false;
      const position = { bottom: "24px", right: "24px" };
      const toCssUnit = (value) => typeof value === "number" ? `${value}px` : value;
      const applyPosition = () => {
        if (!btn) return;
        btn.style.bottom = toCssUnit(position.bottom);
        btn.style.right = toCssUnit(position.right);
      };
      const toggle = () => {
        if (!btn) return;
        const shouldShow = window.scrollY > window.innerHeight * 0.5;
        btn.style.opacity = shouldShow ? "1" : "0";
        btn.style.pointerEvents = shouldShow ? "auto" : "none";
      };
      return (opts = {}) => {
        if (opts.bottom !== void 0) position.bottom = opts.bottom;
        if (opts.right !== void 0) position.right = opts.right;
        if (!btn) {
          btn = document.createElement("button");
          btn.type = "button";
          btn.className = "mp-scroll-top-btn";
          btn.innerHTML = "&#8593;";
          btn.style.cssText = "position:fixed;width:46px;height:46px;border-radius:50%;border:none;background:#1a73e8;color:#fff;font-size:24px;line-height:1;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(0,0,0,0.2);cursor:pointer;opacity:0;pointer-events:none;transition:opacity 0.2s ease;z-index:2147483647;";
          btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
          document.body.appendChild(btn);
          applyPosition();
          requestAnimationFrame(toggle);
        } else {
          applyPosition();
        }
        if (!scrollAttached) {
          scrollAttached = true;
          window.addEventListener("scroll", toggle, { passive: true });
          window.addEventListener("resize", toggle);
        }
        toggle();
        return btn;
      };
    })();
    MP.createBtn = (node, fn) => {
      if (!node || node.parentElement.querySelector(".mp-export-btn")) return;
      const b = document.createElement("button");
      b.textContent = "\u0421\u043A\u0430\u0447\u0430\u0442\u044C";
      b.className = "mp-export-btn";
      b.style.cssText = "margin-left:8px;padding:4px 8px;font-size:14px;background:#4caf50;color:#fff;border:none;border-radius:4px;cursor:pointer;";
      b.addEventListener("click", fn);
      node.insertAdjacentElement("afterend", b);
    };
    MP.downloadTextFile = (name, text) => {
      const bom = "\uFEFF";
      const payloadText = `${bom}${text || ""}`;
      const fallback = () => {
        try {
          const blob = new Blob([payloadText], { type: "text/plain;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = name || "export.txt";
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        } catch (err) {
          console.warn("Download fallback failed:", err);
        }
      };
      if (!hasRuntime()) {
        fallback();
        return;
      }
      sendRuntimeMessage({
        type: "owb:download-text",
        name: name || "export.txt",
        text: payloadText
      }).then((res) => {
        if (!res || !res.ok) fallback();
      }).catch(() => fallback());
    };
    MP.requestJson = async (method, base, path, body, timeout = 2500) => {
      const url = `${base}${path}`;
      if (!hasRuntime()) return requestViaFetch(method, url, body, timeout);
      const res = await sendRuntimeMessage({
        type: "owb:request-json",
        method,
        url,
        body: body ?? null,
        timeout
      }, Math.max(2e3, (Number(timeout) || 2500) + 1500));
      if (res && res.ok) return res.data;
      throw new Error(res && res.error || "Request failed");
    };
    MP.addStyleOnce = /* @__PURE__ */ (() => {
      const injected = /* @__PURE__ */ new Set();
      return (css, key = css) => {
        if (injected.has(key)) return;
        injected.add(key);
        const s = document.createElement("style");
        s.textContent = css;
        document.head.appendChild(s);
      };
    })();
    MP.toBullets = (text) => {
      if (!text || text === "\u2014") return ["\u2014"];
      return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => `- ${l}`);
    };
    MP.cleanText = (value) => String(value || "").replace(/[\u00A0\u202F]/g, " ").replace(/\s+/g, " ").trim();
    MP.parsePriceValue = (text) => {
      if (!text) return null;
      const normalizedText = String(text).replace(/[\u00A0\u202F]/g, " ").replace(/\s+/g, " ").trim();
      if (!normalizedText) return null;
      const escapedCurrencyChars = "\u20BD\u20AC\\$\xA3\xA5\u058F\u20B8\u20BA\u20B4\u20B9\u20A9";
      const numberPattern = "\\d[\\d\\s.,]*";
      const afterCurrency = normalizedText.match(new RegExp(`[${escapedCurrencyChars}]\\s*(${numberPattern})`));
      const beforeCurrency = normalizedText.match(new RegExp(`(${numberPattern})\\s*[${escapedCurrencyChars}]`));
      const rawNumber = afterCurrency && afterCurrency[1] || beforeCurrency && beforeCurrency[1] || (normalizedText.match(/(\d[\d\s.,]*)/) || [])[1] || "";
      if (!rawNumber) return null;
      const compact = rawNumber.replace(/\s+/g, "");
      const comma = compact.lastIndexOf(",");
      const dot = compact.lastIndexOf(".");
      let prepared = compact;
      if (comma >= 0 && dot >= 0) {
        const decimalSep = comma > dot ? "," : ".";
        const thousandsSep = decimalSep === "," ? "." : ",";
        prepared = compact.split(thousandsSep).join("").replace(decimalSep, ".");
      } else if (comma >= 0 || dot >= 0) {
        const sep = comma >= 0 ? "," : ".";
        const parts = compact.split(sep);
        const last = parts[parts.length - 1] || "";
        prepared = parts.length > 2 || last.length === 3 ? parts.join("") : compact.replace(sep, ".");
      }
      const direct = /^\d+(?:\.\d+)?$/.test(prepared) ? prepared : (prepared.match(/\d+(?:\.\d+)?/) || [])[0] || "";
      if (!direct) return null;
      const value = Number(direct);
      return Number.isFinite(value) ? value : null;
    };
    MP.detectCurrency = (text) => {
      if (!text) return "";
      const raw = String(text);
      if (raw.includes("\u20BD")) return "\u20BD";
      if (raw.includes("\u20AC")) return "\u20AC";
      if (raw.includes("$")) return "$";
      if (raw.includes("\xA3")) return "\xA3";
      if (raw.includes("\xA5")) return "\xA5";
      if (raw.includes("\u058F")) return "\u058F";
      if (raw.includes("\u20B8")) return "\u20B8";
      if (raw.includes("\u20BA")) return "\u20BA";
      if (raw.includes("\u20B4")) return "\u20B4";
      if (raw.includes("\u20B9")) return "\u20B9";
      if (raw.includes("\u20A9")) return "\u20A9";
      const upper = raw.toUpperCase();
      if (/\b(USD|US)\b/.test(upper)) return "$";
      if (/\b(RUB|RUR)\b/.test(upper)) return "\u20BD";
      if (/\bEUR\b/.test(upper)) return "\u20AC";
      if (/\bGBP\b/.test(upper)) return "\xA3";
      if (/\b(CNY|RMB|JPY)\b/.test(upper)) return "\xA5";
      if (/\bKZT\b/.test(upper)) return "\u20B8";
      if (/\bAMD\b/.test(upper)) return "\u058F";
      if (/\bTRY\b/.test(upper)) return "\u20BA";
      if (/\bUAH\b/.test(upper)) return "\u20B4";
      if (/\bINR\b/.test(upper)) return "\u20B9";
      if (/\bKRW\b/.test(upper)) return "\u20A9";
      return "";
    };
    MP.normalizeCurrency = (value) => {
      const raw = String(value || "").trim();
      const detected = MP.detectCurrency(raw);
      return detected || raw;
    };
    MP.getAliProductIdFromText = (text) => {
      const raw = String(text || "");
      const m = raw.match(/(?:productId|item_id|itemId|ae_object_value)[^\d]{0,20}(\d{8,})/i) || raw.match(/\b(100\d{10,}|[1-9]\d{9,})\b/);
      return m ? m[1] : "";
    };
    MP.getAliProductIdFromHref = (href, base = "") => {
      try {
        const url = new URL(String(href || ""), base || location.href);
        const path = String(url.pathname || "");
        const m = path.match(/\/item\/(\d{8,})(?:\.html)?(?:\/|$)/i) || path.match(/\/item\/(\d{8,})\/reviews(?:\/|$)/i) || path.match(/\/i\/(\d{8,})(?:\.html)?(?:\/|$)/i);
        return m ? m[1] : "";
      } catch (_) {
        return MP.getAliProductIdFromText(href);
      }
    };
    MP.getAliProductIdFromDocument = (root = document, href = "") => {
      const fromHref = MP.getAliProductIdFromHref(href || location.href);
      if (fromHref) return fromHref;
      const params = new URLSearchParams(location.search || "");
      const fromQuery = params.get("productId") || params.get("item_id") || params.get("itemId");
      if (fromQuery && /^\d{8,}$/.test(fromQuery)) return fromQuery;
      const source = root && root.querySelectorAll ? root : document;
      return MP.getAliProductIdFromText([
        ...source.querySelectorAll('[ae_object_value], [exp_product], [href*="/item/"], [href*="/i/"]')
      ].map((el) => [
        el.getAttribute("ae_object_value"),
        el.getAttribute("exp_product"),
        el.getAttribute("href")
      ].filter(Boolean).join(" ")).join(" "));
    };
    MP.getAliCurrencyFromAttrs = (root = document) => {
      const source = root && root.querySelector ? root : document;
      const attrNode = source.querySelector('[exp_attribute*="currency:"], [exp_attribute*="currency%3A"]') || document.querySelector('[exp_attribute*="currency:"], [exp_attribute*="currency%3A"]');
      const raw = attrNode?.getAttribute("exp_attribute") || "";
      const decoded = (() => {
        try {
          return decodeURIComponent(raw);
        } catch (_) {
          return raw;
        }
      })();
      const m = decoded.match(/currency\s*:\s*([A-Z]{3}|US)/i);
      return MP.normalizeCurrency(m && m[1]);
    };
    MP.formatPriceValue = (value, currency = "") => {
      if (!Number.isFinite(value)) return "\u2014";
      const formatted = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
      return currency ? `${formatted} ${currency}` : formatted;
    };
    MP.extractDigits = (text) => {
      if (!text) return "";
      const match = text.match(/(\d{4,})/);
      return match ? match[1] : "";
    };
    MP.findArticleByLabel = (root, labelRe = /артикул|article|sku|код товара/i) => {
      if (!root) return "";
      const fromDl = [...root.querySelectorAll("dl")].find((dl) => labelRe.test(dl.querySelector("dt")?.textContent || ""));
      if (fromDl) {
        const val = MP.extractDigits(fromDl.querySelector("dd")?.textContent || "");
        if (val) return val;
      }
      const fromTable = [...root.querySelectorAll("tr")].find((tr) => labelRe.test(tr.querySelector("th")?.textContent || ""));
      if (fromTable) {
        const val = MP.extractDigits(fromTable.querySelector("td")?.textContent || "");
        if (val) return val;
      }
      const labeledNode = [...root.querySelectorAll("span, div, li, p")].find((n) => labelRe.test(n.textContent || ""));
      if (labeledNode) {
        const inline = MP.extractDigits(labeledNode.textContent || "");
        if (inline) return inline;
        const next = MP.extractDigits(labeledNode.nextElementSibling?.textContent || "");
        if (next) return next;
        const parentText = MP.extractDigits(labeledNode.parentElement?.textContent || "");
        if (parentText) return parentText;
      }
      const qaNode = root.querySelector('[data-qaid*="article"], [data-qaid*="sku"], [data-qaid*="product-article"]');
      return MP.extractDigits(qaNode?.textContent || "");
    };
    MP.findBlockAnchor = (node, classRe) => {
      let cur = node;
      while (cur && cur !== document.body) {
        if ((cur.tagName === "DIV" || cur.tagName === "SECTION" || cur.tagName === "ARTICLE") && classRe.test(cur.className || "")) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return node?.parentElement || node;
    };
    MP.findPriceInCard = (card, opts = {}) => {
      if (!card) return null;
      const nodes = [...card.querySelectorAll("ins, span, div, p, strong, b, del")];
      let best = null;
      const isPerUnitPriceText = (text) => {
        if (!text) return false;
        const t = String(text).replace(/[\u00A0\u202F]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
        if (!t) return false;
        if (/([₽€$£¥֏₸₺₴₹₩].*?\bза\b|\bза\b.*?[₽€$£¥֏₸₺₴₹₩])/.test(t) && /(г|гр|кг|мл|л|шт|шту|уп|упак|пак|таб|капс|доз|порц)/.test(t)) return true;
        if (/(?:\/|за)\s*\d+[.,]?\d*\s*(г|гр|кг|мл|л|шт|шту|уп|упак|пак|таб|капс|доз|порц)\b/.test(t)) return true;
        return false;
      };
      for (const n of nodes) {
        if (n.closest(".mp-min-price-badge")) continue;
        const text = (n.textContent || "").trim();
        if (!text || !/[₽€$£¥֏₸₺₴₹₩]/.test(text) || !/\d/.test(text)) continue;
        if (opts.ignorePerUnit !== false && isPerUnitPriceText(text)) continue;
        const price = MP.parsePriceValue(text);
        if (!Number.isFinite(price)) continue;
        const isOld = n.tagName === "DEL" || n.closest("del") || /line-through/i.test(n.style.textDecoration || "");
        const currency = MP.detectCurrency(text) || opts.defaultCurrency || "\u20BD";
        const cand = { price, currency, old: !!isOld };
        if (!best || best.old && !cand.old || cand.old === best.old && cand.price < best.price) {
          best = cand;
        }
      }
      return best;
    };
  })();

  // src/content/exporter/common.js
  (() => {
    "use strict";
    const MP = window.MP;
    if (!MP) {
      console.error("MP core not loaded");
      return;
    }
    if (window.OWBExporter && window.OWBExporter.__initialized) return;
    const { addStyleOnce } = MP;
    const EXPORT_UI_KEYS = {
      restoreSingle: "owb-export-restore-single",
      restoreBatch: "owb-export-restore-batch",
      pageMark: "owb-export-page-mark"
    };
    const EXPORT_UI_DEFAULTS = {
      restoreSingle: true,
      restoreBatch: true,
      pageMark: true
    };
    const state = {
      runExport: null,
      restoreFocus: null
    };
    const hasRuntime = () => !!(globalThis.chrome && chrome.runtime && chrome.runtime.onMessage);
    const hasStorage = () => !!(globalThis.chrome && chrome.storage && chrome.storage.local);
    const ensureActionButtonsStyles = () => addStyleOnce(`
        .mp-export-actions{display:inline-flex;flex-wrap:wrap;gap:6px;margin-left:8px;vertical-align:middle}
        .mp-export-actions .mp-export-btn{padding:4px 8px;font-size:13px;border:none;border-radius:6px;cursor:pointer;color:#fff;background:#2d7dd7}
        .mp-export-actions .mp-export-btn[data-kind="lite"]{background:#2f9e44}
        .mp-export-actions .mp-export-btn[data-kind="full"]{background:#1c7ed6}
        .mp-export-actions .mp-export-btn[data-kind="all"]{background:#f08c00}
        .mp-export-actions .mp-export-btn[data-kind="copy"]{background:#6f42c1}
        .mp-export-actions .mp-export-btn[data-kind="copy_all"]{background:#6f42c1}
        .mp-export-actions .mp-export-btn:disabled{opacity:.65;cursor:default}
    `, "mp-export-actions");
    const readExportUiPrefs = async () => {
      if (!hasStorage()) return { ...EXPORT_UI_DEFAULTS };
      return new Promise((resolve) => {
        try {
          chrome.storage.local.get([
            EXPORT_UI_KEYS.restoreSingle,
            EXPORT_UI_KEYS.restoreBatch,
            EXPORT_UI_KEYS.pageMark
          ], (raw) => {
            if (chrome.runtime.lastError) {
              resolve({ ...EXPORT_UI_DEFAULTS });
              return;
            }
            const hasOwn = (key) => Object.prototype.hasOwnProperty.call(raw || {}, key);
            resolve({
              restoreSingle: hasOwn(EXPORT_UI_KEYS.restoreSingle) ? !!raw[EXPORT_UI_KEYS.restoreSingle] : EXPORT_UI_DEFAULTS.restoreSingle,
              restoreBatch: hasOwn(EXPORT_UI_KEYS.restoreBatch) ? !!raw[EXPORT_UI_KEYS.restoreBatch] : EXPORT_UI_DEFAULTS.restoreBatch,
              pageMark: hasOwn(EXPORT_UI_KEYS.pageMark) ? !!raw[EXPORT_UI_KEYS.pageMark] : EXPORT_UI_DEFAULTS.pageMark
            });
          });
        } catch (_) {
          resolve({ ...EXPORT_UI_DEFAULTS });
        }
      });
    };
    const shouldRestoreFocus = async (scope = "single") => {
      try {
        const prefs = await readExportUiPrefs();
        return String(scope || "").toLowerCase() === "batch" ? !!prefs.restoreBatch : !!prefs.restoreSingle;
      } catch (_) {
        return true;
      }
    };
    const showExportMark = /* @__PURE__ */ (() => {
      let badge = null;
      let pulseTimer = null;
      let count = 0;
      const ensureStyles = () => addStyleOnce(`
            .mp-export-mark{
                position:fixed;
                right:14px;
                bottom:14px;
                width:24px;
                height:24px;
                border-radius:999px;
                background:#1f7a42;
                color:#fff;
                display:flex;
                align-items:center;
                justify-content:center;
                font:700 11px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;
                box-shadow:0 6px 16px rgba(0,0,0,.24);
                border:1px solid rgba(255,255,255,.28);
                z-index:2147483647;
                pointer-events:none;
                opacity:.86;
                transform:scale(1);
                transition:transform .16s ease, opacity .22s ease;
            }
            .mp-export-mark[data-mode="copy"]{background:#6f42c1}
            .mp-export-mark[data-mode="download"]{background:#1f7a42}
        `, "mp-export-mark");
      return async (options = {}) => {
        let prefs = { ...EXPORT_UI_DEFAULTS };
        try {
          prefs = await readExportUiPrefs();
        } catch (_) {
        }
        if (!prefs.pageMark) return false;
        ensureStyles();
        if (!badge) {
          badge = document.createElement("div");
          badge.className = "mp-export-mark";
          badge.setAttribute("aria-hidden", "true");
          badge.textContent = "1";
          const root = document.body || document.documentElement;
          if (!root) return false;
          root.appendChild(badge);
        }
        count += 1;
        const mode = String(options.mode || "").toLowerCase() === "copy" ? "copy" : "download";
        badge.dataset.mode = mode;
        badge.textContent = count > 99 ? "99+" : String(count);
        const modeLabel = mode === "copy" ? "\u0431\u0443\u0444\u0435\u0440" : "\u0444\u0430\u0439\u043B";
        const scope = String(options.scope || "single").toLowerCase() === "batch" ? "\u043C\u0430\u0441\u0441\u043E\u0432\u044B\u0439" : "\u0448\u0442\u0443\u0447\u043D\u044B\u0439";
        badge.title = `OWB: ${modeLabel}, ${scope}, ${(/* @__PURE__ */ new Date()).toLocaleTimeString("ru-RU")}`;
        badge.style.opacity = ".98";
        badge.style.transform = "scale(1.14)";
        if (pulseTimer) clearTimeout(pulseTimer);
        pulseTimer = setTimeout(() => {
          if (!badge) return;
          badge.style.opacity = ".86";
          badge.style.transform = "scale(1)";
        }, 220);
        return true;
      };
    })();
    const copyToClipboard = async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
      }
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "readonly");
      ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) throw new Error("Clipboard write failed");
      return true;
    };
    const saveLastExtractSessionFromItem = async (item, options = {}) => {
      if (!hasRuntime() || !item || typeof item !== "object") return false;
      const payload = {
        mode: options.mode === "copy" ? "copy" : "download",
        allReviews: options.allReviews === true,
        tabId: Number.isFinite(Number(options.tabId)) ? Number(options.tabId) : null,
        item: {
          market: String(item.market || ""),
          pidKey: String(item.pidKey || ""),
          url: String(item.url || ""),
          title: String(item.title || ""),
          filename: String(item.filename || ""),
          text: String(item.text || "")
        }
      };
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "owb:extract-save-last-session", payload }, (response) => {
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
      const wrap = document.createElement("span");
      wrap.className = "mp-export-actions";
      wrap.dataset.key = key;
      const setBusy = (busy) => {
        wrap.dataset.busy = busy ? "1" : "0";
        wrap.querySelectorAll("button").forEach((btn) => {
          btn.disabled = !!busy;
        });
      };
      const flash = (btn, original, textValue) => {
        btn.textContent = textValue;
        setTimeout(() => {
          btn.textContent = original;
        }, 1100);
      };
      const showNotice = /* @__PURE__ */ (() => {
        let el = null;
        let timer = null;
        return (text, isError = false) => {
          const msg = String(text || "").trim();
          if (!msg) return;
          if (!el) {
            el = document.createElement("div");
            el.className = "mp-export-notice";
            el.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:min(90vw,560px);padding:9px 12px;border-radius:10px;background:rgba(24,28,33,.94);color:#fff;font:600 13px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.26);pointer-events:none;opacity:0;transition:opacity .16s ease;";
            document.body.appendChild(el);
          }
          el.textContent = msg;
          el.style.background = isError ? "rgba(176,43,43,.96)" : "rgba(24,28,33,.94)";
          el.style.opacity = "1";
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (el) el.style.opacity = "0";
          }, 1500);
        };
      })();
      actions.forEach((action) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mp-export-btn";
        btn.textContent = action.label;
        btn.dataset.kind = action.kind || "full";
        btn.addEventListener("click", async () => {
          if (wrap.dataset.busy === "1") return;
          const original = btn.textContent;
          setBusy(true);
          btn.textContent = String(action.pendingText || "...");
          try {
            await action.run();
            flash(btn, original, String(action.successText || "\u0413\u043E\u0442\u043E\u0432\u043E"));
            if (action.toastSuccess) showNotice(String(action.toastSuccess || ""));
          } catch (err) {
            console.error("Export action failed:", err);
            flash(btn, original, String(action.errorText || "\u041E\u0448\u0438\u0431\u043A\u0430"));
            if (action.toastError) showNotice(String(action.toastError || ""), true);
          } finally {
            setBusy(false);
          }
        });
        wrap.appendChild(btn);
      });
      anchor.insertAdjacentElement("afterend", wrap);
    };
    if (hasRuntime()) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || message.scope !== "owb-export") return void 0;
        const action = String(message.action || "");
        if (action !== "export-card" && action !== "copy-text" && action !== "restore-card-focus") return void 0;
        (async () => {
          if (action === "copy-text") {
            const text = String(message.payload && message.payload.text ? message.payload.text : "");
            await copyToClipboard(text);
            return { copied: true };
          }
          if (action === "restore-card-focus") {
            const options = message.options || {};
            try {
              await showExportMark(options);
            } catch (_) {
            }
            const scope = String(options.scope || "batch").toLowerCase() === "single" ? "single" : "batch";
            let allowed = true;
            try {
              allowed = await shouldRestoreFocus(scope);
            } catch (_) {
              allowed = true;
            }
            if (allowed && typeof state.restoreFocus === "function") {
              await state.restoreFocus(options);
            }
            return { restored: true };
          }
          if (typeof state.runExport !== "function") throw new Error("\u042D\u043A\u0441\u043F\u043E\u0440\u0442 \u043D\u0430 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0432\u043A\u043B\u0430\u0434\u043A\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D");
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
      shouldRestoreFocus,
      showExportMark,
      setRunExport: (handler) => {
        state.runExport = typeof handler === "function" ? handler : null;
      },
      setRestoreFocus: (handler) => {
        state.restoreFocus = typeof handler === "function" ? handler : null;
      }
    };
  })();

  // src/content/exporter/aliexpress.js
  (() => {
    "use strict";
    const MP = window.MP;
    const Exporter = window.OWBExporter;
    if (!MP || !Exporter) return;
    const {
      sleep,
      slug,
      ensureScrollTopButton,
      downloadTextFile,
      toBullets,
      cleanText,
      parsePriceValue,
      detectCurrency,
      normalizeCurrency,
      findPriceInCard,
      getAliProductIdFromDocument,
      getAliCurrencyFromAttrs
    } = MP;
    const {
      attachActionButtons,
      copyToClipboard,
      saveLastExtractSessionFromItem,
      setRunExport,
      setRestoreFocus,
      shouldRestoreFocus: shouldRestoreFocusMaybe = async () => true,
      showExportMark: showExportMarkMaybe = async () => false
    } = Exporter;
    const ALI_DEFAULT_MAX_REVIEWS = 100;
    const ALI_REVIEWS_COLLECT_TIMEOUT_MS = 75e3;
    let aliReturnUrl = "";
    let aliLastReviewsTotal = 0;
    const clean = cleanText;
    const parseCount = (value) => {
      const raw = String(value || "").replace(/[\u00A0\u202F]/g, " ").trim();
      const compact = raw.match(/(\d+(?:[.,]\d+)?)\s*([kкmм])\b/i);
      if (compact) {
        const n = Number(compact[1].replace(",", "."));
        const mult = /[mм]/i.test(compact[2]) ? 1e6 : 1e3;
        return Number.isFinite(n) ? Math.round(n * mult) : 0;
      }
      const m = raw.match(/(\d[\d\s,.'’]*)/);
      if (!m) return 0;
      const digits = m[1].replace(/[^\d]/g, "");
      return digits ? Number(digits) || 0 : 0;
    };
    const getAliProductId = () => getAliProductIdFromDocument(document, location.href);
    const getDescriptionRoot = () => document.querySelector('[data-product-description="true"]') || document;
    const getTitleNode = () => getDescriptionRoot().querySelector("h1") || document.querySelector("h1");
    const getPriceRoot = () => document.querySelector('[data-testid="HazeProductPrice"] [data-unformatted-price], [data-testid="HazeProductPrice"][data-unformatted-price]') || document.querySelector('[style*="--area:price"] [data-unformatted-price], [style*="--area:price"][data-unformatted-price]') || document.querySelector('#buyNowButton [exp_attribute*="finalPrice:"]') || document.querySelector('[data-testid="HazeProductPrice"]') || document.querySelector("[data-unformatted-price]") || document.querySelector("#buyNowButton")?.closest("div") || null;
    const getPriceArea = () => {
      const root = getPriceRoot();
      if (!root) return null;
      return root.closest('[style*="--area:price"]') || root.closest('[data-testid="HazeProductPrice"]')?.parentElement || root.parentElement || null;
    };
    const parsePriceFromExpAttribute = (root) => {
      const raw = root?.getAttribute?.("exp_attribute") || "";
      if (!raw) return null;
      const decoded = (() => {
        try {
          return decodeURIComponent(raw);
        } catch (_) {
          return raw;
        }
      })();
      const m = decoded.match(/finalPrice\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i) || decoded.match(/price\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
      if (!m) return null;
      const price = Number(String(m[1]).replace(",", "."));
      if (!Number.isFinite(price)) return null;
      const currencyMatch = decoded.match(/currency\s*:\s*([A-Z]{3}|US)/i);
      return {
        price,
        currency: normalizeCurrency(currencyMatch && currencyMatch[1]),
        text: decoded
      };
    };
    const parsePriceFromRoot = (root, defaultCurrency = "", options = {}) => {
      if (!root) return null;
      const allowGeneric = options.allowGeneric !== false;
      const attrValue = root.getAttribute("data-unformatted-price");
      const attrPrice = attrValue != null ? Number(String(attrValue).replace(",", ".")) : NaN;
      const text = clean(root.textContent || "");
      const attrCurrency = getAliCurrencyFromAttrs(root);
      if (Number.isFinite(attrPrice)) {
        return {
          price: attrPrice,
          currency: attrCurrency || normalizeCurrency(detectCurrency(text)),
          text
        };
      }
      const expPrice = parsePriceFromExpAttribute(root);
      if (expPrice) {
        return {
          price: expPrice.price,
          currency: expPrice.currency || attrCurrency || normalizeCurrency(detectCurrency(text) || defaultCurrency),
          text: expPrice.text || text
        };
      }
      if (!allowGeneric) return null;
      const info = findPriceInCard(root, { defaultCurrency: attrCurrency || "" });
      if (info && Number.isFinite(Number(info.price))) {
        return { price: Number(info.price), currency: normalizeCurrency(info.currency || attrCurrency || defaultCurrency), text };
      }
      const parsed = parsePriceValue(text);
      return Number.isFinite(parsed) ? { price: parsed, currency: normalizeCurrency(detectCurrency(text) || attrCurrency || defaultCurrency), text } : null;
    };
    const getLeafNodes = (root) => [...root?.querySelectorAll?.("span, div, p, strong, b") || []].filter((node) => !node.children || node.children.length === 0);
    const parseMoneyLeaf = (node, defaultCurrency = "") => {
      const text = clean([
        node?.getAttribute?.("title") || "",
        node?.textContent || ""
      ].filter(Boolean).join(" "));
      if (!text || !/\d/.test(text) || /%/.test(text)) return null;
      const currency = normalizeCurrency(detectCurrency(text) || defaultCurrency);
      if (!currency) return null;
      const price = parsePriceValue(text);
      if (!Number.isFinite(price)) return null;
      return { price, currency, text };
    };
    const parseDeliveryPrice = (root, preferredCurrency = "") => {
      if (!root) return null;
      const text = clean(root.textContent || "");
      if (!text) return null;
      if (/\bfree\b|бесплат/i.test(text)) {
        return { price: 0, currency: preferredCurrency || normalizeCurrency(detectCurrency(text)), text };
      }
      const deliveryLeaves = getLeafNodes(root);
      if (!root.children || root.children.length === 0) deliveryLeaves.unshift(root);
      const leaves = deliveryLeaves.map((node) => {
        const leafText = clean([
          node?.getAttribute?.("title") || "",
          node?.textContent || ""
        ].filter(Boolean).join(" "));
        if (!detectCurrency(leafText)) return null;
        return parseMoneyLeaf(node, preferredCurrency);
      }).filter((item) => item && Number.isFinite(Number(item.price)));
      if (!leaves.length) return null;
      const scoped = preferredCurrency ? leaves.filter((item) => !item.currency || item.currency === preferredCurrency) : leaves;
      return (scoped.length ? scoped : leaves).sort((a, b) => a.price - b.price)[0] || null;
    };
    const findDeliveryRoot = () => {
      const priceArea = getPriceArea();
      return priceArea?.querySelector?.('[data-testid="RedProductDelivery"]') || document.querySelector('[data-testid="RedProductDelivery"]') || [...document.querySelectorAll("div, section, span, p")].filter((node) => /delivery|shipping|достав/i.test(clean(node.textContent || ""))).sort((a, b) => clean(a.textContent || "").length - clean(b.textContent || "").length)[0] || null;
    };
    const getPagePriceBreakdown = () => {
      const priceRoot = getPriceRoot();
      const product = parsePriceFromRoot(priceRoot, "", { allowGeneric: false }) || parsePriceFromRoot(priceRoot, "", { allowGeneric: true });
      if (!product || !Number.isFinite(Number(product.price))) {
        return { product: null, delivery: null, total: null };
      }
      const delivery = parseDeliveryPrice(findDeliveryRoot(), product.currency || "");
      const deliveryPrice = delivery && Number.isFinite(Number(delivery.price)) ? Number(delivery.price) : NaN;
      const total = Number.isFinite(deliveryPrice) ? {
        price: Number(product.price) + deliveryPrice,
        currency: product.currency || delivery?.currency || "",
        text: `${product.text || ""}; delivery:${delivery?.text || ""}`
      } : null;
      return { product, delivery, total };
    };
    const formatPrice = (info) => {
      if (!info || !Number.isFinite(Number(info.price))) return "\u2014";
      const value = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(info.price));
      return `${value}${info.currency ? ` ${info.currency}` : ""}`;
    };
    const findButtonByText = (root, re) => [...(root || document).querySelectorAll('button, [role="button"], a')].find((el) => re.test(clean(el.textContent || "")));
    const isAliReviewsRoute = () => /\/item\/\d{8,}\/reviews(?:\/|$)/i.test(String(location.pathname || ""));
    const buildAliReviewsUrl = () => {
      const pid = getAliProductId();
      if (!pid) return "";
      const url = new URL(location.href);
      url.pathname = `/item/${pid}/reviews`;
      const skuId = new URLSearchParams(location.search || "").get("sku_id");
      url.search = "";
      url.searchParams.set("filters", "");
      if (skuId) url.searchParams.set("sku_id", skuId);
      url.hash = "";
      return url.href;
    };
    const requestAliReviewsInTempTab = async (reviewsUrl, options = {}) => {
      if (!reviewsUrl || !(globalThis.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === "function")) {
        return null;
      }
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({
            type: "owb:ali-collect-reviews",
            payload: {
              url: reviewsUrl,
              maxReviews: options.maxReviews || ALI_DEFAULT_MAX_REVIEWS,
              reviewsTotal: options.reviewsTotal || ""
            }
          }, (response) => {
            if (chrome.runtime.lastError || !response || !response.ok) {
              resolve(null);
              return;
            }
            resolve(response.data || null);
          });
        } catch (_) {
          resolve(null);
        }
      });
    };
    const getVisibleDocY = (el) => {
      if (!el || typeof el.getBoundingClientRect !== "function") return Infinity;
      const rect = el.getBoundingClientRect();
      return window.scrollY + rect.top;
    };
    const waitForAliCondition = (predicate, timeoutMs = 12e3) => new Promise((resolve) => {
      let done = false;
      let timer = null;
      let interval = null;
      let observer = null;
      const finish = (value) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (interval) clearInterval(interval);
        if (observer) observer.disconnect();
        resolve(value || null);
      };
      const check = () => {
        let value = null;
        try {
          value = predicate();
        } catch (_) {
          value = null;
        }
        if (value) finish(value);
      };
      observer = new MutationObserver(check);
      try {
        observer.observe(document.documentElement || document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "disabled", "aria-disabled"]
        });
      } catch (_) {
      }
      interval = setInterval(check, 220);
      timer = setTimeout(() => finish(null), Math.max(400, Number(timeoutMs) || 12e3));
      check();
    });
    const getAliReviewsRoot = () => {
      if (!isAliReviewsRoute()) return null;
      const listNode = document.querySelector('ul[class*="ReviewList__reviewList"], ul[class*="reviewList"][class*="ReviewList"]');
      const list = listNode?.closest('[class*="RedReviewsProductFeedbackList"], [class*="ProductFeedbackList"]') || listNode?.parentElement;
      if (list) return list;
      const item = document.querySelector("li[data-review-id]");
      if (item) return item.closest('[class*="RedReviewsProductFeedbackList"], [class*="ProductFeedbackList"]') || item.parentElement;
      return document.querySelector('[class*="RedReviewsProductFeedbackList__reviewList"], [class*="ProductFeedbackList__reviewList"]');
    };
    const getAliReviewNodes = () => {
      const seen = /* @__PURE__ */ new Set();
      return [...document.querySelectorAll("li[data-review-id]")].filter((node) => {
        const id = node.getAttribute("data-review-id") || "";
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      }).sort((a, b) => getVisibleDocY(a) - getVisibleDocY(b));
    };
    const isAliReviewsPage = () => {
      return isAliReviewsRoute();
    };
    const findAliAllReviewsButton = () => {
      const exactSelectors = [
        'button[aria-label="allReviewsButton"]',
        '[style*="--area:showAllButton"] button'
      ];
      for (const sel of exactSelectors) {
        const node = document.querySelector(sel);
        const target = node?.closest?.('button, a, [role="button"]') || node?.querySelector?.('button, a, [role="button"]') || node;
        if (target) return target;
      }
      const textButton = [...document.querySelectorAll('button, a, [role="button"]')].map((el) => ({ el, text: clean(el.textContent || "") })).filter(({ text }) => text && /(all reviews|all feedback|все отзывы|все оценки|показать все отзывы|смотреть все отзывы)/i.test(text)).sort((a, b) => getVisibleDocY(a.el) - getVisibleDocY(b.el))[0];
      if (textButton?.el) return textButton.el;
      const classFallback = document.querySelector('[class*="showAllButton"] button');
      if (classFallback) return classFallback;
      const structuralFallback = document.querySelector("#__aer_root__ > div > div:nth-child(1) > div:nth-child(8) > div > div:nth-child(6) > div > div > div > div > ul > li:nth-child(1) > div > div > div:nth-child(4)");
      return structuralFallback?.closest?.('button, a, [role="button"]') || structuralFallback || null;
    };
    const findAliAllReviewsButtonWithScroll = async () => {
      let btn = findAliAllReviewsButton();
      for (let i = 0; !btn && i < 26; i += 1) {
        window.scrollBy({ top: Math.max(360, Math.round(window.innerHeight * 0.55)), behavior: "smooth" });
        await sleep(260);
        btn = findAliAllReviewsButton();
      }
      return btn;
    };
    const waitForAliReviewsRoot = async (timeoutMs = 15e3) => {
      const root = await waitForAliCondition(() => {
        const root2 = getAliReviewsRoot();
        if (root2 && getAliReviewNodes().length) return root2;
        if (root2) return root2;
        return null;
      }, timeoutMs);
      return root || null;
    };
    const clickAliReviewExpanders = async (root = document) => {
      const buttons = [...(root || document).querySelectorAll('button, [role="button"]')].filter((btn) => {
        const text = clean(btn.textContent || "");
        if (!text || /show original|показать оригинал/i.test(text)) return false;
        return /read more|show more|see more|читать далее|показать полностью|ещ[её]/i.test(text);
      }).slice(0, 80);
      for (const btn of buttons) {
        try {
          btn.click();
        } catch (_) {
        }
        await sleep(25);
      }
    };
    const findAliLoadMoreButton = (root = document) => {
      const scope = root || document;
      const buttons = [...scope.querySelectorAll('button, [role="button"]')];
      return buttons.find((btn) => /loadMoreButton|refresh/i.test(String(btn.className || ""))) || buttons.find((btn) => /reload|load more|show more|показать|загруз|ещ[её]/i.test(clean(btn.textContent || "")));
    };
    const getAliScrollableContainers = (root) => {
      if (!root) return [];
      return [root, ...root.querySelectorAll("*")].filter((el) => {
        if (!el || el === document.body || el === document.documentElement) return false;
        const max = el.scrollHeight - el.clientHeight;
        if (max <= 80) return false;
        const style = getComputedStyle(el);
        const overflow = `${style.overflowY || ""} ${style.overflow || ""}`.toLowerCase();
        return /(auto|scroll|overlay)/.test(overflow) || max > 500;
      }).sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight)).slice(0, 4);
    };
    const focusAliReviewsViewport = async (root) => {
      try {
        window.focus();
      } catch (_) {
      }
      const target = root || getAliReviewsRoot() || document.documentElement;
      try {
        if (!target.hasAttribute?.("tabindex")) target.setAttribute?.("tabindex", "-1");
        target.focus?.({ preventScroll: true });
      } catch (_) {
      }
      const containers = getAliScrollableContainers(target);
      containers.forEach((el) => {
        try {
          if (!el.hasAttribute?.("tabindex")) el.setAttribute?.("tabindex", "-1");
          el.focus?.({ preventScroll: true });
        } catch (_) {
        }
      });
      await sleep(40);
    };
    const scrollAliReviewsForward = async (root, nodes) => {
      await focusAliReviewsViewport(root);
      const last = nodes[nodes.length - 1] || root;
      try {
        last.scrollIntoView({ block: "end", behavior: "auto" });
      } catch (_) {
      }
      window.scrollBy(0, Math.max(520, Math.round(window.innerHeight * 0.78)));
      const containers = getAliScrollableContainers(root);
      containers.forEach((el) => {
        try {
          el.focus?.({ preventScroll: true });
          el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + Math.max(520, Math.round(el.clientHeight * 0.95)));
          el.dispatchEvent(new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY: Math.max(520, Math.round(el.clientHeight * 0.95))
          }));
        } catch (_) {
        }
      });
      await sleep(240);
    };
    const waitForAliReviewProgress = async (previousCount, timeoutMs = 2600) => {
      const value = await waitForAliCondition(() => {
        const count = getAliReviewNodes().length;
        return count > previousCount ? count : null;
      }, timeoutMs);
      return Number(value) || getAliReviewNodes().length;
    };
    const goToAliReviewsPage = async () => {
      if (isAliReviewsRoute()) {
        return await waitForAliReviewsRoot(16e3);
      }
      const btn = await findAliAllReviewsButtonWithScroll();
      if (!btn) return null;
      aliReturnUrl = location.href;
      aliLastReviewsTotal = parseCount(btn.textContent || "") || aliLastReviewsTotal;
      try {
        btn.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (_) {
      }
      await sleep(220);
      const clickTarget = btn.closest?.('button, a, [role="button"]') || btn.querySelector?.('button, a, [role="button"]') || btn;
      try {
        clickTarget.click();
      } catch (_) {
      }
      const root = await waitForAliReviewsRoot(16e3);
      if (root) {
        try {
          root.scrollIntoView({ block: "start", behavior: "auto" });
        } catch (_) {
        }
        await sleep(280);
      }
      return root;
    };
    const textFromNode = (node) => {
      if (!node) return "";
      const clone = node.cloneNode(true);
      clone.querySelectorAll("button, svg, script, style, noscript").forEach((n) => n.remove());
      return clean(clone.innerText || clone.textContent || "");
    };
    const parseAliStars = (root) => {
      const stars = root?.querySelectorAll?.('[class*="StarGroup__wrapper"] svg, [class*="StarGroup"] svg') || [];
      if (stars.length >= 1 && stars.length <= 5) return String(stars.length);
      const aria = root?.querySelector?.('[aria-label*="5"]')?.getAttribute("aria-label") || "";
      const m = aria.match(/([1-5](?:[.,]\d)?)/);
      return m ? m[1].replace(",", ".") : "\u2014";
    };
    const getAliHeader = (root) => {
      const header = root?.querySelector?.('[class*="Header__wrapper"]') || root;
      return {
        author: clean(header?.querySelector?.('[class*="Header__title"]')?.textContent || ""),
        date: clean(header?.querySelector?.('[class*="Header__subtitle"]')?.textContent || "")
      };
    };
    const getAliContentText = (root) => {
      const isCommentRoot = !!root?.closest?.('[class*="CommentList__commentList"]');
      const isContainerRoot = !!root?.matches?.('[class*="Container__container"]');
      const nodes = [...root?.querySelectorAll?.('[class*="Content__text"]') || []].filter((node) => isCommentRoot || !node.closest('[class*="CommentList__commentList"]')).filter((node) => !isContainerRoot || node.closest('[class*="Container__container"]') === root);
      const texts = nodes.map(textFromNode).filter(Boolean);
      return [...new Set(texts)].join(" ");
    };
    const getAliImageCount = (root) => {
      const isContainerRoot = !!root?.matches?.('[class*="Container__container"]');
      const gallery = [...root?.querySelectorAll?.('[class*="HScrollWrapper__gallery"], [class*="ImageCarousel"]') || []].find((node) => !isContainerRoot || node.closest('[class*="Container__container"]') === root);
      if (!gallery) return 0;
      const items = gallery.querySelectorAll('[class*="imageItem"]');
      if (items.length) return items.length;
      return gallery.querySelectorAll("img, source[srcset]").length || 0;
    };
    const parseAliReviewNode = (li, idx) => {
      const wrapper = li.querySelector('[class*="ReviewListItem__wrapper"]') || li;
      const commentList = wrapper.querySelector('[class*="CommentList__commentList"]');
      const containers = [...wrapper.querySelectorAll('[class*="Container__container"]')];
      const topContainers = containers.filter((node) => !node.closest('[class*="CommentList__commentList"]'));
      const main = topContainers[0] || wrapper;
      const { author, date } = getAliHeader(main);
      const rating = parseAliStars(main);
      const sku = clean(main.querySelector('[class*="SubHeader__skuProperties"]')?.getAttribute("title") || main.querySelector('[class*="SubHeader__skuProperties"]')?.textContent || "");
      const text = getAliContentText(main) || "\u0411\u0435\u0437 \u0442\u0435\u043A\u0441\u0442\u0430";
      const parts = [];
      if (rating && rating !== "\u2014") parts.push(`${rating}\u2605`);
      if (author) parts.push(`\u0410\u0432\u0442\u043E\u0440: ${author}`);
      if (sku) parts.push(sku);
      parts.push(`\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439: ${text}`);
      const imageCount = getAliImageCount(main);
      if (imageCount) parts.push(`\u0424\u043E\u0442\u043E: ${imageCount}`);
      topContainers.slice(1).forEach((extra) => {
        const extraHead = getAliHeader(extra);
        const extraText = getAliContentText(extra);
        if (extraText) parts.push(`\u0414\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435${extraHead.date ? ` (${extraHead.date})` : ""}: ${extraText}`);
      });
      [...commentList?.querySelectorAll("li") || []].forEach((commentNode) => {
        const cRoot = commentNode.querySelector('[class*="Container__container"]') || commentNode;
        const cHead = getAliHeader(cRoot);
        const cText = getAliContentText(cRoot);
        if (cText) {
          const by = cHead.author ? `, ${cHead.author}` : "";
          parts.push(`\u041E\u0442\u0432\u0435\u0442${cHead.date ? ` (${cHead.date}${by})` : by ? ` (${cHead.author})` : ""}: ${cText}`);
        }
      });
      return `\u041E\u0442\u0437\u044B\u0432 ${idx + 1} (${date || "\u2014"}): ${parts.join("; ")}`;
    };
    const loadAliReviews = async (maxReviews = 100, opts = {}) => {
      const root = await goToAliReviewsPage();
      const declared = Math.max(parseCount(opts.reviewsTotal || ""), aliLastReviewsTotal || 0);
      const maxLimit = Number(maxReviews);
      const limit = Number.isFinite(maxLimit) && maxLimit > 0 ? maxLimit : declared || ALI_DEFAULT_MAX_REVIEWS;
      const target = Math.max(1, Math.min(limit, declared || limit));
      if (!root) return { header: "\u041E\u0442\u0437\u044B\u0432\u044B: \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u0431\u043B\u043E\u043A \u043E\u0442\u0437\u044B\u0432\u043E\u0432", items: [], unavailable: true };
      let prev = 0;
      let idle = 0;
      const startedAt = Date.now();
      await focusAliReviewsViewport(root);
      for (let loops = 0; loops < 160 && Date.now() - startedAt < ALI_REVIEWS_COLLECT_TIMEOUT_MS; loops += 1) {
        const currentRoot = getAliReviewsRoot() || root;
        const nodes2 = getAliReviewNodes();
        await clickAliReviewExpanders(currentRoot);
        if (nodes2.length >= target) break;
        await scrollAliReviewsForward(currentRoot, nodes2);
        const btn = findAliLoadMoreButton(currentRoot);
        if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") {
          try {
            btn.scrollIntoView({ block: "center", behavior: "auto" });
          } catch (_) {
          }
          await focusAliReviewsViewport(currentRoot);
          await sleep(120);
          try {
            btn.click();
          } catch (_) {
          }
          await waitForAliReviewProgress(nodes2.length, 3600);
        } else {
          await waitForAliReviewProgress(nodes2.length, 2600);
        }
        const now = getAliReviewNodes().length;
        if (now > prev) {
          prev = now;
          idle = 0;
        } else {
          idle += 1;
          if (idle >= 7) break;
        }
      }
      await clickAliReviewExpanders(root);
      const nodes = getAliReviewNodes().slice(0, target);
      const items = nodes.map(parseAliReviewNode);
      const total = Math.max(declared || 0, items.length);
      return {
        header: `\u041E\u0442\u0437\u044B\u0432\u044B (\u0432\u044B\u0433\u0440\u0443\u0436\u0435\u043D\u043E ${items.length}${total ? ` \u0438\u0437 ${total}` : ""})`,
        items
      };
    };
    const collectAliReviewsForProduct = async (maxReviews = 100, opts = {}) => {
      if (isAliReviewsRoute()) {
        return loadAliReviews(maxReviews, opts);
      }
      const reviewsUrl = buildAliReviewsUrl();
      const fromTempTab = await requestAliReviewsInTempTab(reviewsUrl, {
        maxReviews,
        reviewsTotal: opts.reviewsTotal || ""
      });
      if (fromTempTab && Array.isArray(fromTempTab.items)) return fromTempTab;
      return loadAliReviews(maxReviews, opts);
    };
    const clickExpanders = async () => {
      const descBtn = document.querySelector('button[ae_button_type*="full_description" i], button[data-spm="veiw_full"]') || findButtonByText(document.querySelector("#content_anchor")?.parentElement || document, /full description|полное описание|показать полностью|show more/i);
      if (descBtn) {
        try {
          descBtn.click();
        } catch (_) {
        }
        await sleep(350);
      }
      const specRoot = document.querySelector("#characteristics_anchor");
      const specBtn = document.querySelector('button[ae_button_type*="full_spec" i]') || findButtonByText(specRoot?.parentElement || document, /view all|показать все|все характеристики|all/i);
      if (specBtn) {
        try {
          specBtn.click();
        } catch (_) {
        }
        await sleep(350);
      }
    };
    const getStore = () => {
      const root = getDescriptionRoot();
      const link = root.querySelector('a[href*="/store/"]') || document.querySelector('#storeInfo a[href*="/store/"], a[href*="/store/"]');
      const name = clean(link?.textContent || "");
      const url = link?.href || "";
      return { name: name || "\u2014", url };
    };
    const getRatingInfo = () => {
      const floor = document.querySelector('[data-spm="title_floor"]') || getDescriptionRoot();
      const text = clean(floor.textContent || "");
      const rating = (text.match(/\b([0-5][.,]\d{1,2})\b/) || text.match(/\b([1-5])\b/))?.[1]?.replace(",", ".") || "\u2014";
      const reviewsText = clean(floor.querySelector('a[href="#reviews_anchor"], a[href*="reviews_anchor"]')?.textContent || "");
      const reviews = (reviewsText.match(/(\d[\d\s,.'’]*)/) || text.match(/(\d[\d\s,.'’]*)\s*(?:reviews?|отзыв|оцен)/i) || [])[1] || "0";
      const bought = (text.match(/(\d[\d\s,.'’]*)\s*(?:bought|купил|заказ)/i) || [])[1] || "";
      return {
        rating,
        reviews: clean(reviews).replace(/\s+/g, " ") || "0",
        bought: clean(bought).replace(/\s+/g, " ")
      };
    };
    const collectDescription = () => {
      const root = document.querySelector("#content_anchor");
      if (!root) return { text: "\u2014", images: [] };
      const images = [...root.querySelectorAll("img[src], img[data-src]")].map((img) => img.getAttribute("src") || img.getAttribute("data-src") || "").map((src) => clean(src)).filter(Boolean);
      const clone = root.cloneNode(true);
      clone.querySelectorAll("script, style, noscript, button, svg, img").forEach((n) => n.remove());
      const lines = clean(clone.innerText || clone.textContent || "").split(/\n+/).map((line) => clean(line)).filter((line) => line && !/^modname\s*=/i.test(line) && !/^(description|описание)$/i.test(line));
      return {
        text: lines.length ? lines.join("\n") : "\u2014",
        images: [...new Set(images)]
      };
    };
    const collectSpecs = () => {
      const root = document.querySelector("#characteristics_anchor");
      if (!root) return "\u2014";
      const rows = [];
      const add = (name, value) => {
        const k = clean(name).replace(/[:\s]+$/, "");
        const v = clean(value);
        if (!k || !v || k === v) return;
        const low = k.toLowerCase();
        if (/^(characteristics|характеристики|view all|показать все)$/i.test(low)) return;
        const row = `${k}: ${v}`;
        if (!rows.includes(row)) rows.push(row);
      };
      root.querySelectorAll("tr").forEach((tr) => {
        add(tr.querySelector("th")?.textContent, tr.querySelector("td")?.textContent);
      });
      root.querySelectorAll("dl").forEach((dl) => {
        add(dl.querySelector("dt")?.textContent, dl.querySelector("dd")?.textContent);
      });
      root.querySelectorAll("div").forEach((div) => {
        const spans = [...div.children].filter((child) => child.tagName === "SPAN");
        if (spans.length === 2) add(spans[0].textContent, spans[1].textContent);
      });
      return rows.length ? rows.join("\n") : "\u2014";
    };
    const buildAliExpressExportPackage = async (opts = {}) => {
      const includeReviews = opts.includeReviews !== false;
      const maxReviews = Number(opts.maxReviews) || ALI_DEFAULT_MAX_REVIEWS;
      await clickExpanders();
      const url = location.href;
      aliReturnUrl = url;
      const title = clean(getTitleNode()?.textContent || document.title || "\u2014");
      const store = getStore();
      const rating = getRatingInfo();
      const priceInfo = getPagePriceBreakdown();
      const description = collectDescription();
      const chars = collectSpecs();
      const pid = getAliProductId();
      const lines = [
        "=== CARD SUMMARY (ALIEXPRESS) ===",
        `URL: ${url}`,
        `\u041C\u0430\u0433\u0430\u0437\u0438\u043D: ${store.name}`,
        store.url ? `\u0421\u0441\u044B\u043B\u043A\u0430 \u043C\u0430\u0433\u0430\u0437\u0438\u043D\u0430: ${store.url}` : "",
        `\u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A: ${title}`,
        `\u0426\u0435\u043D\u0430 \u0442\u043E\u0432\u0430\u0440\u0430: ${formatPrice(priceInfo.product)}`,
        `\u0414\u043E\u0441\u0442\u0430\u0432\u043A\u0430: ${formatPrice(priceInfo.delivery)}`,
        `\u0421\u0443\u043C\u043C\u0430 \u0441 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u043E\u0439: ${formatPrice(priceInfo.total)}`,
        `\u0420\u0435\u0439\u0442\u0438\u043D\u0433: ${rating.rating} (${rating.reviews} \u043E\u0442\u0437\u044B\u0432\u043E\u0432)`,
        rating.bought ? `\u041A\u0443\u043F\u0438\u043B\u0438: ${rating.bought}` : "",
        "",
        "=== \u041E\u041F\u0418\u0421\u0410\u041D\u0418\u0415 ===",
        description.text
      ].filter((line) => line !== "");
      if (description.images.length) {
        lines.push("", "=== \u0418\u0417\u041E\u0411\u0420\u0410\u0416\u0415\u041D\u0418\u042F \u041E\u041F\u0418\u0421\u0410\u041D\u0418\u042F ===", ...description.images.map((src) => `- ${src}`));
      }
      lines.push("", "=== \u0425\u0410\u0420\u0410\u041A\u0422\u0415\u0420\u0418\u0421\u0422\u0418\u041A\u0418 ===", ...toBullets(chars));
      if (includeReviews) {
        const reviews = await collectAliReviewsForProduct(maxReviews, { reviewsTotal: rating.reviews });
        lines.push("", "=== \u041E\u0422\u0417\u042B\u0412\u042B ===", reviews.header);
        if (reviews.items.length) {
          lines.push(...reviews.items.map((item) => `- ${item}`));
        } else if (reviews.unavailable) {
          lines.push("\u041E\u0442\u0437\u044B\u0432\u044B \u043D\u0435 \u0432\u044B\u0433\u0440\u0443\u0436\u0435\u043D\u044B");
        } else {
          lines.push("\u041D\u0435\u0442 \u043E\u0442\u0437\u044B\u0432\u043E\u0432");
        }
      }
      const text = lines.join("\n");
      return {
        market: "aliexpress",
        pidKey: pid ? `aliexpress:${pid}` : "",
        url,
        title,
        filename: `${slug(title || pid || "aliexpress")}.txt`,
        text
      };
    };
    const restoreCardFocus = async () => {
      if (isAliReviewsPage()) {
        if (window.history.length > 1) {
          try {
            window.history.back();
            await sleep(420);
            return;
          } catch (_) {
          }
        }
        if (aliReturnUrl && aliReturnUrl !== location.href) {
          location.assign(aliReturnUrl);
          return;
        }
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      await sleep(220);
    };
    const exportAliExpress = async (opts = {}) => {
      const includeReviews = opts.includeReviews !== false;
      const pack = await buildAliExpressExportPackage(opts);
      if (opts.copyOnly) {
        await copyToClipboard(pack.text);
        await saveLastExtractSessionFromItem(pack, { mode: "copy", allReviews: includeReviews });
        try {
          await showExportMarkMaybe({ mode: "copy", scope: "single", market: "aliexpress" });
        } catch (_) {
        }
      } else {
        downloadTextFile(pack.filename, pack.text);
        await saveLastExtractSessionFromItem(pack, { mode: "download", allReviews: includeReviews });
        try {
          await showExportMarkMaybe({ mode: "download", scope: "single", market: "aliexpress" });
        } catch (_) {
        }
      }
      let shouldRestore = true;
      try {
        shouldRestore = await shouldRestoreFocusMaybe("single");
      } catch (_) {
        shouldRestore = true;
      }
      if (shouldRestore) await restoreCardFocus();
    };
    function initAliExpress() {
      ensureScrollTopButton();
      setRestoreFocus(restoreCardFocus);
      if (globalThis.chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
          if (!message || message.scope !== "owb-ali-reviews") return void 0;
          if (String(message.action || "") !== "collect-reviews") return void 0;
          (async () => {
            if (!isAliReviewsRoute()) throw new Error("Current page is not AliExpress reviews route");
            return loadAliReviews(Number(message.payload?.maxReviews) || ALI_DEFAULT_MAX_REVIEWS, {
              reviewsTotal: message.payload?.reviewsTotal || ""
            });
          })().then((data) => {
            sendResponse({ ok: true, data });
          }).catch((err) => {
            sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
          });
          return true;
        });
      }
      setRunExport((opts = {}) => buildAliExpressExportPackage({
        includeReviews: opts.includeReviews !== false,
        maxReviews: Number(opts.maxReviews) || ALI_DEFAULT_MAX_REVIEWS
      }));
      setInterval(() => {
        attachActionButtons(getTitleNode(), "aliexpress", [
          { label: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u0441 \u043E\u0442\u0437\u044B\u0432\u0430\u043C\u0438", kind: "full", run: () => exportAliExpress({ includeReviews: true, copyOnly: false, maxReviews: ALI_DEFAULT_MAX_REVIEWS }) },
          { label: "\u0432 \u0431\u0443\u0444\u0435\u0440", kind: "copy", pendingText: "\u041A\u043E\u043F\u0438\u0440\u0443\u044E...", successText: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E", toastSuccess: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u0432 \u0431\u0443\u0444\u0435\u0440", run: () => exportAliExpress({ includeReviews: false, copyOnly: true }) },
          { label: "\u0432 \u0431\u0443\u0444\u0435\u0440 \u0441 \u043E\u0442\u0437\u044B\u0432\u0430\u043C\u0438", kind: "copy_all", pendingText: "\u041A\u043E\u043F\u0438\u0440\u0443\u044E...", successText: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E", toastSuccess: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u0432 \u0431\u0443\u0444\u0435\u0440", run: () => exportAliExpress({ includeReviews: true, copyOnly: true, maxReviews: ALI_DEFAULT_MAX_REVIEWS }) }
        ]);
      }, 1e3);
    }
    initAliExpress();
  })();

  // src/content/price-monitor/common.js
  (function() {
    "use strict";
    const MP = window.MP;
    if (!MP) return;
    const {
      addStyleOnce,
      cleanText,
      parsePriceValue,
      detectCurrency,
      normalizeCurrency,
      formatPriceValue,
      extractDigits,
      findArticleByLabel,
      findBlockAnchor,
      findPriceInCard,
      getAliProductIdFromText,
      getAliProductIdFromHref,
      getAliProductIdFromDocument,
      getAliCurrencyFromAttrs
    } = MP;
    const CFG = {
      productUpdateDebounceMs: 700,
      cardUpdateDebounceMs: 900,
      updateMinGapMs: 1800,
      productStableMs: 2200,
      productStableSamples: 2,
      renderHeartbeatMs: 8e3,
      captureHeartbeatMs: 6e4,
      maxCardGroups: 220
    };
    const now = () => Date.now();
    const eq = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;
    const hasRuntime = () => !!(globalThis.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === "function");
    const toInt = (value, fallback = 0) => {
      const n = Math.trunc(Number(value));
      return Number.isFinite(n) ? n : fallback;
    };
    const errorText = (err) => String(err && err.message ? err.message : err);
    const isRuntimeInvalidatedError = (err) => /Extension context invalidated|message channel closed|Extension runtime is unavailable/i.test(errorText(err));
    const isRuntimeTransientError = (err) => /Runtime message timeout|Receiving end does not exist|The message port closed before a response was received/i.test(errorText(err));
    const isElementNode = (node) => node && node.nodeType === Node.ELEMENT_NODE;
    const isOwnMonitorNode = (node) => {
      const el = isElementNode(node) ? node : node?.parentElement;
      return !!(el && el.closest && el.closest(".mp-price-chart, .mp-min-price-badge"));
    };
    const hasElementChanges = (mutation) => {
      if (!mutation) return false;
      if (mutation.type !== "childList") return false;
      if (isOwnMonitorNode(mutation.target)) return false;
      return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => isElementNode(node) && !isOwnMonitorNode(node));
    };
    const patchHistoryUpdateEvents = /* @__PURE__ */ (() => {
      let patched = false;
      return () => {
        if (patched) return;
        patched = true;
        const notify = () => {
          try {
            window.dispatchEvent(new CustomEvent("owb:page-updated"));
          } catch (_) {
          }
        };
        ["pushState", "replaceState"].forEach((name) => {
          const original = history[name];
          if (typeof original !== "function") return;
          history[name] = function(...args) {
            const result = original.apply(this, args);
            setTimeout(notify, 0);
            return result;
          };
        });
        window.addEventListener("popstate", notify);
        window.addEventListener("hashchange", notify);
      };
    })();
    const watchPageUpdates = (callback, opts = {}) => {
      const debounceMs = Math.max(100, Number(opts.debounceMs) || 800);
      const minGapMs = Math.max(0, Number(opts.minGapMs) || CFG.updateMinGapMs);
      let stopped = false;
      let timer = null;
      let lastRunTs = 0;
      let pendingReason = "init";
      const run = () => {
        if (stopped) return;
        timer = null;
        lastRunTs = now();
        callback(pendingReason);
        pendingReason = "update";
      };
      const schedule = (reason = "update", immediate = false) => {
        if (stopped) return;
        pendingReason = reason;
        const t = now();
        const sinceLastRun = t - lastRunTs;
        const waitForGap = Math.max(0, minGapMs - sinceLastRun);
        const delay = immediate ? 0 : Math.max(debounceMs, waitForGap);
        if (timer) clearTimeout(timer);
        timer = setTimeout(run, delay);
      };
      const observer = new MutationObserver((mutations) => {
        if (mutations.some(hasElementChanges)) schedule("dom");
      });
      const observeRoot = () => {
        const root = document.body || document.documentElement;
        if (!root) return false;
        observer.observe(root, {
          childList: true,
          subtree: true
        });
        return true;
      };
      if (!observeRoot()) {
        document.addEventListener("DOMContentLoaded", () => observeRoot(), { once: true });
      }
      patchHistoryUpdateEvents();
      const onPageUpdated = () => schedule("navigation", true);
      const onVisible = () => {
        if (!document.hidden) schedule("visible", true);
      };
      window.addEventListener("owb:page-updated", onPageUpdated);
      window.addEventListener("pageshow", onPageUpdated);
      document.addEventListener("visibilitychange", onVisible);
      schedule("init", true);
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        observer.disconnect();
        window.removeEventListener("owb:page-updated", onPageUpdated);
        window.removeEventListener("pageshow", onPageUpdated);
        document.removeEventListener("visibilitychange", onVisible);
      };
    };
    const sendRuntimeMessage = (payload, timeoutMs = 15e3) => new Promise((resolve, reject) => {
      if (!hasRuntime()) {
        reject(new Error("Extension runtime is unavailable"));
        return;
      }
      let timer = null;
      const done = (fn, value) => {
        if (timer) clearTimeout(timer);
        fn(value);
      };
      timer = setTimeout(() => done(reject, new Error("Runtime message timeout")), Math.max(1500, Number(timeoutMs) || 15e3));
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            done(reject, new Error(err.message || "Runtime message failed"));
            return;
          }
          done(resolve, response);
        });
      } catch (err) {
        done(reject, err instanceof Error ? err : new Error(String(err)));
      }
    });
    const callBg = async (type, extra = {}, timeoutMs = 15e3) => {
      const response = await sendRuntimeMessage({ type, ...extra }, timeoutMs);
      if (!response || response.ok !== true) throw new Error(response && response.error || "Background request failed");
      return response.data;
    };
    const bgCaptureBatch = async (records) => callBg("owb:price-capture-batch", { records }, 2e4);
    const bgGetHistory = async (pidKey, preferredCurrency = "") => {
      const data = await callBg("owb:price-history", { pidKey, limit: 5e3, preferredCurrency }, 15e3);
      return Array.isArray(data?.intervals) ? data.intervals : [];
    };
    const bgGetMinBatch = async (pidKeys, preferredCurrencies = {}) => callBg("owb:price-min-batch", { pidKeys, preferredCurrencies }, 15e3);
    const bgExport = async () => callBg("owb:price-export", {}, 2e4);
    const bgImport = async (payload) => callBg("owb:price-import", { payload }, 2e4);
    const bgGetStatus = async () => callBg("owb:price-get-status", {}, 1e4);
    const bgSetConfig = async (payload) => callBg("owb:price-set-config", { payload }, 1e4);
    const bgSyncNow = async () => callBg("owb:price-sync-now", {}, 1e4);
    const bgOpenHistoryEditor = async (pidKey, currency = "") => callBg("owb:price-open-history-editor", { payload: { pidKey, currency } }, 1e4);
    const ensureChartStyles = () => addStyleOnce(`
        .mp-price-chart{margin-top:8px;margin-bottom:8px;padding:8px 10px 10px;border-radius:10px;border:1px solid rgba(0,0,0,0.08);background:linear-gradient(135deg,#f7f7f7,#ffffff);box-shadow:0 6px 16px rgba(0,0,0,0.08);color:#222;max-width:420px;width:100%;box-sizing:border-box;min-width:0;font-size:12px;line-height:1.3}
        .mp-price-chart__row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px}
        .mp-price-chart__title{font-weight:600;font-size:12px}
        .mp-price-chart__actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;min-width:0}
        .mp-price-chart__edit{border:1px solid rgba(26,115,232,0.35);border-radius:5px;background:#fff;color:#1a73e8;font:inherit;font-size:10px;line-height:1;padding:3px 5px;cursor:pointer;white-space:nowrap}
        .mp-price-chart__edit:hover{border-color:#1a73e8}
        .mp-price-chart__edit[hidden]{display:none}
        .mp-price-chart__stats{font-size:11px;color:#555;text-align:right}
        .mp-price-chart__canvas-wrap{position:relative}
        .mp-price-chart canvas{width:100%;height:120px;display:block;max-width:100%}
        .mp-price-chart__dates{display:flex;justify-content:space-between;font-size:10px;color:#666;margin-top:4px}
        .mp-price-tooltip{position:absolute;pointer-events:none;background:rgba(17,17,17,0.92);color:#fff;padding:4px 6px;border-radius:4px;font-size:10px;transform:translate(-50%,-100%);white-space:nowrap;opacity:0;transition:opacity 0.1s ease}
        .mp-price-chart--floating{position:fixed;right:24px;bottom:90px;width:280px;z-index:2147483646}
        .mp-min-price-anchor{position:relative}
        .mp-min-price-badge{position:absolute;top:6px;left:6px;background:rgba(17,17,17,0.84);color:#fff;font-size:11px;line-height:1.2;padding:4px 6px;border-radius:6px;font-weight:600;letter-spacing:0.2px;box-shadow:0 6px 12px rgba(0,0,0,0.22);z-index:6;pointer-events:none;white-space:nowrap}
        .mp-min-price-anchor--below{position:static}
        .mp-min-price-anchor--below .mp-min-price-badge{position:static;display:inline-flex;align-items:center;max-width:100%;margin-top:8px}
        .mp-min-price-anchor--below-center{position:static}
        .mp-min-price-anchor--below-center .mp-min-price-badge{position:static;display:flex;align-items:center;justify-content:center;width:max-content;max-width:100%;margin:8px auto 0}
        .mp-min-price-anchor--photo{position:relative}
        .mp-min-price-anchor--photo .mp-min-price-badge{position:absolute;top:calc(100% - 12px);left:50%;transform:translateX(-50%);width:max-content;max-width:100%;margin:0}
        .mp-min-price-anchor--photo-inside{position:relative}
        .mp-min-price-anchor--photo-inside .mp-min-price-badge{position:absolute;left:50%;bottom:6px;top:auto;transform:translateX(-50%);width:max-content;max-width:calc(100% - 8px);margin:0}
        .mp-min-price-badge--empty{display:none}
    `, "mp-price-monitor");
    const ensureChartEditorButton = (container) => {
      if (!container) return null;
      let button = container.querySelector(".mp-price-chart__edit");
      if (!button) {
        const row = container.querySelector(".mp-price-chart__row");
        const stats = container.querySelector(".mp-price-chart__stats");
        let actions = container.querySelector(".mp-price-chart__actions");
        if (!actions) {
          actions = document.createElement("div");
          actions.className = "mp-price-chart__actions";
          if (stats) actions.appendChild(stats);
          if (row) row.appendChild(actions);
        }
        button = document.createElement("button");
        button.type = "button";
        button.className = "mp-price-chart__edit";
        button.textContent = "\u041F\u0440\u0430\u0432\u0438\u0442\u044C";
        actions.appendChild(button);
      }
      if (!button.__mpHistoryEditorAttached) {
        button.__mpHistoryEditorAttached = true;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const target = container.__mpHistoryEditorTarget || {};
          const pidKey = String(target.pidKey || "").trim();
          if (!pidKey) return;
          bgOpenHistoryEditor(pidKey, String(target.currency || "")).catch((err) => {
            console.warn("[OWB] cannot open history editor:", err);
          });
        });
      }
      return button;
    };
    const setChartEditorTarget = (container, pidKey, currency = "") => {
      if (!container) return;
      const cleanPidKey = String(pidKey || "").trim();
      container.__mpHistoryEditorTarget = {
        pidKey: cleanPidKey,
        currency: String(currency || "")
      };
      const button = ensureChartEditorButton(container);
      if (button) button.hidden = !cleanPidKey;
    };
    const ensureChartContainer = (container, anchor, floating) => {
      ensureChartStyles();
      if (!container) {
        container = document.createElement("div");
        container.className = "mp-price-chart";
        container.innerHTML = `
                <div class="mp-price-chart__row">
                    <div class="mp-price-chart__title">\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0446\u0435\u043D\u044B</div>
                    <div class="mp-price-chart__actions">
                        <div class="mp-price-chart__stats"></div>
                        <button type="button" class="mp-price-chart__edit" hidden>\u041F\u0440\u0430\u0432\u0438\u0442\u044C</button>
                    </div>
                </div>
                <div class="mp-price-chart__canvas-wrap">
                    <canvas></canvas>
                    <div class="mp-price-tooltip"></div>
                </div>
                <div class="mp-price-chart__dates"><span></span><span></span></div>
            `;
      }
      ensureChartEditorButton(container);
      let targetAnchor = anchor;
      if (targetAnchor && targetAnchor.tagName === "SPAN") targetAnchor = targetAnchor.parentElement || targetAnchor;
      if (floating || !targetAnchor) {
        container.classList.add("mp-price-chart--floating");
        if (!container.isConnected) document.body.appendChild(container);
        return container;
      }
      container.classList.remove("mp-price-chart--floating");
      if (container.previousElementSibling !== targetAnchor) {
        targetAnchor.insertAdjacentElement("afterend", container);
      }
      return container;
    };
    const intervalsToSeries = (intervals) => {
      const out = [];
      const list = [...intervals || []].filter(Boolean).sort((a, b) => toInt(a.firstTs, 0) - toInt(b.firstTs, 0));
      for (const interval of list) {
        const price = Number(interval.price);
        if (!Number.isFinite(price)) continue;
        const firstTs = toInt(interval.firstTs != null ? interval.firstTs : interval.ts, NaN);
        const lastTs = toInt(interval.lastTs != null ? interval.lastTs : interval.ts, NaN);
        if (!Number.isFinite(firstTs) || !Number.isFinite(lastTs)) continue;
        out.push({ ts: Math.min(firstTs, lastTs), price, currency: String(interval.currency || "") });
        if (lastTs !== firstTs) out.push({ ts: Math.max(firstTs, lastTs), price, currency: String(interval.currency || "") });
      }
      const dedupe = /* @__PURE__ */ new Map();
      out.forEach((p) => {
        const key = `${p.ts}:${Math.round(p.price * 1e4)}:${String(p.currency || "")}`;
        dedupe.set(key, p);
      });
      return [...dedupe.values()].sort((a, b) => a.ts - b.ts);
    };
    const renderChart = (container, history2, opts = {}) => {
      if (!container) return;
      const canvas = container.querySelector("canvas");
      const stats = container.querySelector(".mp-price-chart__stats");
      const dates = container.querySelectorAll(".mp-price-chart__dates span");
      const tooltip = container.querySelector(".mp-price-tooltip");
      const currency = opts.currency || "\u20BD";
      const data = [...history2 || []].filter(Boolean).sort((a, b) => a.ts - b.ts);
      if (!data.length) {
        stats.textContent = "\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445";
        if (dates[0]) dates[0].textContent = "";
        if (dates[1]) dates[1].textContent = "";
        if (tooltip) tooltip.style.opacity = "0";
        const ctx2 = canvas.getContext("2d");
        ctx2.clearRect(0, 0, canvas.width, canvas.height);
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
      const ctx = canvas.getContext("2d");
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
      stats.textContent = `\u041C\u0438\u043D ${formatPriceValue(min, currency)} \xB7 \u041C\u0430\u043A\u0441 ${formatPriceValue(max, currency)}`;
      if (dates[0]) dates[0].textContent = new Date(minTs).toLocaleDateString("ru-RU");
      if (dates[1]) dates[1].textContent = new Date(maxTs).toLocaleDateString("ru-RU");
      const left = 8;
      const right = 8;
      const top = 10;
      const bottom = 18;
      const plotW = width - left - right;
      const plotH = height - top - bottom;
      const points = data.map((item) => {
        const x = left + (item.ts - minTs) / tsRange * plotW;
        const t = (item.price - minVal) / (maxVal - minVal || 1);
        const y = top + (1 - t) * plotH;
        return { x, y, ts: item.ts, price: item.price };
      });
      const area = ctx.createLinearGradient(0, top, 0, height);
      area.addColorStop(0, "rgba(26,115,232,0.22)");
      area.addColorStop(1, "rgba(26,115,232,0.02)");
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
      ctx.strokeStyle = "#1a73e8";
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
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.stroke();
      };
      drawMark(findLastIndexByPrice(min), "#00a86b");
      drawMark(findLastIndexByPrice(max), "#d93025");
      drawMark(points.length - 1, "#1a73e8");
      container.__mpChartPoints = points;
      container.__mpChartCurrency = currency;
      if (!container.__mpChartAttached) {
        container.__mpChartAttached = true;
        canvas.addEventListener("mousemove", (event) => {
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
          const tsLabel = new Date(best.ts).toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
          });
          tooltip.textContent = `${tsLabel} \xB7 ${formatPriceValue(best.price, container.__mpChartCurrency || currency)}`;
          tooltip.style.left = `${best.x}px`;
          tooltip.style.top = `${best.y}px`;
          tooltip.style.opacity = "1";
        });
        canvas.addEventListener("mouseleave", () => {
          tooltip.style.opacity = "0";
        });
      }
    };
    const ensureBadge = (card) => {
      if (!card) return null;
      ensureChartStyles();
      card.classList.add("mp-min-price-anchor");
      let badge = card.querySelector(".mp-min-price-badge");
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "mp-min-price-badge mp-min-price-badge--empty";
        card.appendChild(badge);
      }
      return badge;
    };
    const renderBadge = (card, record) => {
      const badge = ensureBadge(card);
      if (!badge) return;
      if (!record || !Number.isFinite(Number(record.price))) {
        badge.textContent = "";
        badge.classList.add("mp-min-price-badge--empty");
        return;
      }
      const text = `\u041C\u0438\u043D ${formatPriceValue(Number(record.price), record.currency || "\u20BD")}`;
      if (badge.textContent !== text) badge.textContent = text;
      badge.classList.remove("mp-min-price-badge--empty");
    };
    const toCaptureRecord = (pidKey, pid, priceInfo, ts = now()) => {
      const price = priceInfo && priceInfo.price != null ? Number(priceInfo.price) : NaN;
      if (!pidKey || !Number.isFinite(price)) return null;
      const currency = String(priceInfo?.currency || "") || detectCurrency(String(priceInfo?.text || "")) || "";
      return { pidKey, pid: String(pid || ""), price, currency, ts };
    };
    const sameCaptureRecord = (a, b) => !!(a && b && String(a.pidKey || "") === String(b.pidKey || "") && eq(a.price, b.price) && String(a.currency || "") === String(b.currency || ""));
    const startProductTracker = (opts) => {
      const state = {
        running: false,
        pidKey: "",
        chart: null,
        lastPrice: NaN,
        lastCurrency: "",
        lastRecordPidKey: "",
        lastCaptureTs: 0,
        lastRenderTs: 0,
        pendingRecord: null,
        pendingFirstSeenTs: 0,
        pendingSamples: 0,
        pendingTimer: null,
        stopped: false
      };
      const clearPendingCapture = () => {
        if (state.pendingTimer) clearTimeout(state.pendingTimer);
        state.pendingTimer = null;
        state.pendingRecord = null;
        state.pendingFirstSeenTs = 0;
        state.pendingSamples = 0;
      };
      const schedulePendingCaptureCheck = () => {
        if (state.pendingTimer) clearTimeout(state.pendingTimer);
        state.pendingTimer = setTimeout(() => {
          state.pendingTimer = null;
          tick();
        }, CFG.productStableMs);
      };
      const captureStableRecord = async (record) => {
        if (!record) {
          clearPendingCapture();
          return false;
        }
        const currentCaptured = {
          pidKey: state.lastRecordPidKey,
          price: state.lastPrice,
          currency: state.lastCurrency
        };
        const sameAsCaptured = sameCaptureRecord(record, currentCaptured);
        const heartbeat = sameAsCaptured && state.lastCaptureTs && now() - state.lastCaptureTs >= CFG.captureHeartbeatMs;
        if (sameAsCaptured && !heartbeat) {
          clearPendingCapture();
          return false;
        }
        if (!heartbeat) {
          if (!sameCaptureRecord(state.pendingRecord, record)) {
            state.pendingRecord = { ...record };
            state.pendingFirstSeenTs = now();
            state.pendingSamples = 1;
            schedulePendingCaptureCheck();
            return false;
          }
          state.pendingSamples += 1;
          const stableEnough = now() - state.pendingFirstSeenTs >= CFG.productStableMs && state.pendingSamples >= CFG.productStableSamples;
          if (!stableEnough) {
            schedulePendingCaptureCheck();
            return false;
          }
        }
        await bgCaptureBatch([{ ...record, ts: now() }]);
        state.lastRecordPidKey = record.pidKey;
        state.lastPrice = record.price;
        state.lastCurrency = record.currency;
        state.lastCaptureTs = now();
        clearPendingCapture();
        return true;
      };
      const tick = async () => {
        if (state.stopped) return;
        if (state.running) return;
        state.running = true;
        try {
          const onProductPage = typeof opts.isProductPage === "function" ? !!opts.isProductPage() : true;
          if (!onProductPage) {
            if (state.chart && state.chart.isConnected) state.chart.remove();
            state.chart = null;
            state.pidKey = "";
            state.lastPrice = NaN;
            state.lastCurrency = "";
            state.lastRecordPidKey = "";
            state.lastCaptureTs = 0;
            state.lastRenderTs = 0;
            clearPendingCapture();
            return;
          }
          const pid = await opts.getPid();
          const pidKey = typeof opts.getPidKey === "function" ? opts.getPidKey(pid) : "";
          const nextPidKey = pidKey || (pid ? `${opts.market}:${pid}` : "");
          if (nextPidKey && nextPidKey !== state.pidKey) {
            state.pidKey = nextPidKey;
            state.lastRenderTs = 0;
            clearPendingCapture();
          }
          const priceInfo = opts.getPrice();
          const anchor = opts.getAnchor ? opts.getAnchor() : null;
          state.chart = ensureChartContainer(state.chart, anchor, !anchor);
          setChartEditorTarget(state.chart, state.pidKey, priceInfo?.currency || state.lastCurrency || "");
          const record = toCaptureRecord(state.pidKey, pid, priceInfo);
          const captured = await captureStableRecord(record);
          const t = now();
          if (state.pidKey && (captured || !state.lastRenderTs || t - state.lastRenderTs >= CFG.renderHeartbeatMs)) {
            const intervals = await bgGetHistory(state.pidKey, record?.currency || state.lastCurrency || "");
            const history2 = intervalsToSeries(intervals);
            renderChart(state.chart, history2, { currency: record?.currency || state.lastCurrency || "\u20BD" });
            state.lastRenderTs = t;
          } else if (!state.pidKey) {
            renderChart(state.chart, [], { currency: "\u20BD" });
          }
        } catch (err) {
          if (isRuntimeInvalidatedError(err)) {
            state.stopped = true;
            clearPendingCapture();
            if (state.stopWatching) state.stopWatching();
            return;
          }
          if (isRuntimeTransientError(err)) return;
          console.warn("[OWB] product tracker failed:", err);
        } finally {
          state.running = false;
        }
      };
      state.stopWatching = watchPageUpdates(tick, {
        debounceMs: CFG.productUpdateDebounceMs,
        minGapMs: CFG.updateMinGapMs
      });
    };
    const isBadgeCardCandidate = (card, market) => {
      if (!card || !card.isConnected) return false;
      const rect = card.getBoundingClientRect();
      const minSize = market === "ozon" ? 90 : 120;
      if ((rect.width || 0) < minSize || (rect.height || 0) < minSize) return false;
      const inOzonSkuGrid = market === "ozon" && !!card.closest('[data-widget="skuGrid"]');
      if (!inOzonSkuGrid && card.closest('#section-reviews, #section-questions, #product-feedbacks, [id*="reviews"], [id*="questions"]')) return false;
      if (market === "ozon" && !inOzonSkuGrid && card.closest('[data-widget*="review" i], [data-widget*="question" i], [data-widget*="variant" i]')) return false;
      if (market === "wb" && card.closest('[class*="review" i], [class*="feedback" i], [class*="question" i], .comments')) return false;
      const hasProductLink = !!card.querySelector('a[href*="/product/"], a[href*="/catalog/"][href*="/detail"]');
      const hasPidHint = !!(card.getAttribute("data-sku") || card.getAttribute("data-nm-id") || card.getAttribute("data-popup-nm-id") || card.querySelector('[data-sku], [data-nm-id], [data-popup-nm-id], [favlistslink*="sku="], a[href*="/product/"], a[href*="/catalog/"][href*="/detail"]') || card.getAttribute("favlistslink"));
      const hasImage = !!card.querySelector("img, picture");
      if (!hasImage) return false;
      if (!hasProductLink && !hasPidHint) return false;
      return true;
    };
    const collectGroupsFromCards = (opts) => {
      const groups = /* @__PURE__ */ new Map();
      const cards = [...document.querySelectorAll(opts.cardSelector)].slice(0, 2e3);
      const isCandidate = typeof opts.isCardCandidate === "function" ? (card) => !!opts.isCardCandidate(card) : (card) => isBadgeCardCandidate(card, opts.market);
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
            group.priceInfo = { price: Number(info.price), currency: info.currency || opts.defaultCurrency || "\u20BD", text: card.textContent || "" };
          }
        }
      }
      return [...groups.values()].slice(0, CFG.maxCardGroups);
    };
    const startCardScanner = (opts) => {
      let running = false;
      let stopped = false;
      const captureState = /* @__PURE__ */ new Map();
      let renderedCards = /* @__PURE__ */ new Set();
      const tick = async () => {
        if (stopped) return;
        if (running) return;
        running = true;
        try {
          const groups = opts.collectGroups();
          if (!groups.length) return;
          const captures = [];
          const pidKeys = [];
          const preferredCurrencies = {};
          const t = now();
          groups.forEach((group) => {
            pidKeys.push(group.pidKey);
            const rec = toCaptureRecord(group.pidKey, group.pid, group.priceInfo, t);
            if (!rec) return;
            preferredCurrencies[group.pidKey] = rec.currency;
            if (typeof opts.shouldCaptureGroup === "function" && opts.shouldCaptureGroup(group) === false) return;
            const prev = captureState.get(group.pidKey) || { price: NaN, currency: "", ts: 0 };
            const changed = !eq(prev.price, rec.price) || prev.currency !== rec.currency;
            const heartbeat = !prev.ts || t - prev.ts >= CFG.captureHeartbeatMs;
            if (!changed && !heartbeat) return;
            captureState.set(group.pidKey, { price: rec.price, currency: rec.currency, ts: t });
            captures.push(rec);
          });
          if (captures.length) await bgCaptureBatch(captures);
          const minMap = await bgGetMinBatch(pidKeys, preferredCurrencies);
          const nextRendered = /* @__PURE__ */ new Set();
          groups.forEach((group) => {
            const min = minMap && typeof minMap === "object" ? minMap[group.pidKey] : null;
            group.cards.forEach((card) => {
              const target = typeof opts.getBadgeTarget === "function" ? opts.getBadgeTarget(card) || card : card;
              nextRendered.add(target);
              renderBadge(target, min);
            });
          });
          renderedCards.forEach((card) => {
            if (nextRendered.has(card)) return;
            const badge = card && card.querySelector ? card.querySelector(".mp-min-price-badge") : null;
            if (!badge) return;
            badge.textContent = "";
            badge.classList.add("mp-min-price-badge--empty");
          });
          renderedCards = nextRendered;
        } catch (err) {
          if (isRuntimeInvalidatedError(err)) {
            stopped = true;
            if (stopWatching) stopWatching();
            return;
          }
          if (isRuntimeTransientError(err)) return;
          console.warn("[OWB] card scanner failed:", err);
        } finally {
          running = false;
        }
      };
      const stopWatching = watchPageUpdates(tick, {
        debounceMs: CFG.cardUpdateDebounceMs,
        minGapMs: CFG.updateMinGapMs
      });
    };
    let currentProductDetector = null;
    const setCurrentProductDetector = (detector) => {
      currentProductDetector = typeof detector === "function" ? detector : null;
    };
    const initBridge = () => {
      if (!(globalThis.chrome && chrome.runtime && chrome.runtime.onMessage)) return;
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || message.scope !== "owb") return void 0;
        (async () => {
          switch (String(message.action || "")) {
            case "monitor:get-status":
              return bgGetStatus();
            case "monitor:set-config":
              return bgSetConfig(message.payload || {});
            case "monitor:sync-now":
              return bgSyncNow();
            case "monitor:ping":
              return bgGetStatus();
            case "monitor:export-db":
              return bgExport();
            case "monitor:import-db":
              return bgImport(message.payload || {});
            case "monitor:get-current-product":
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
      cleanText,
      parsePriceValue,
      detectCurrency,
      normalizeCurrency,
      extractDigits,
      findArticleByLabel,
      findBlockAnchor,
      findPriceInCard,
      getAliProductIdFromText,
      getAliProductIdFromHref,
      getAliProductIdFromDocument,
      getAliCurrencyFromAttrs
    };
  })();

  // src/content/price-monitor/aliexpress.js
  (() => {
    "use strict";
    const PM = window.OWBPriceMonitor;
    if (!PM) return;
    const {
      startProductTracker,
      startCardScanner,
      setCurrentProductDetector,
      cleanText,
      parsePriceValue,
      detectCurrency,
      normalizeCurrency,
      findPriceInCard,
      getAliProductIdFromHref,
      getAliProductIdFromDocument,
      getAliCurrencyFromAttrs
    } = PM;
    const clean = cleanText;
    const getPidFromHref = (href) => getAliProductIdFromHref(href, location.href);
    const getCurrencyFromAttrs = getAliCurrencyFromAttrs;
    const getPidFromCard = (card) => {
      const direct = card?.getAttribute?.("data-product-id") || card?.dataset?.productId || "";
      if (/^\d{8,}$/.test(String(direct))) return String(direct);
      const href = card?.querySelector?.('a[href*="/item/"], a[href*="/i/"]')?.getAttribute("href") || "";
      return getPidFromHref(href);
    };
    const getPid = () => {
      return getAliProductIdFromDocument(document, location.href);
    };
    const getPriceRoot = () => document.querySelector('[data-testid="HazeProductPrice"] [data-unformatted-price], [data-testid="HazeProductPrice"][data-unformatted-price]') || document.querySelector('[style*="--area:price"] [data-unformatted-price], [style*="--area:price"][data-unformatted-price]') || document.querySelector('#buyNowButton [exp_attribute*="finalPrice:"]') || document.querySelector("[data-unformatted-price]") || document.querySelector('#buyNowButton [data-testid="buynowBtn"]') || null;
    const getPriceArea = () => {
      const root = getPriceRoot();
      if (!root) return null;
      return root.closest('[style*="--area:price"]') || root.closest('[data-testid="HazeProductPrice"]')?.parentElement || root.parentElement || null;
    };
    const getOrCreateChartAnchor = () => {
      const area = getPriceArea();
      if (!area) return null;
      const anchors = [...area.children].filter((node) => node.classList?.contains("mp-ali-price-chart-anchor"));
      let anchor = anchors[0] || null;
      anchors.slice(1).forEach((extra) => extra.remove());
      if (!anchor) {
        anchor = document.createElement("div");
        anchor.className = "mp-ali-price-chart-anchor";
        anchor.setAttribute("aria-hidden", "true");
        anchor.style.cssText = "display:block;width:100%;height:0;overflow:hidden;";
        const primaryBox = getPriceRoot()?.closest('[style*="--border"], [style*="--bgColor"]');
        if (primaryBox && primaryBox.parentElement && area.contains(primaryBox)) {
          primaryBox.insertAdjacentElement("afterend", anchor);
        } else {
          area.appendChild(anchor);
        }
      }
      return anchor;
    };
    const hashSkuSignature = (value) => {
      let hash = 5381;
      const text = String(value || "");
      for (let i = 0; i < text.length; i += 1) {
        hash = (hash << 5) + hash ^ text.charCodeAt(i);
      }
      return (hash >>> 0).toString(36);
    };
    const getSelectedSkuSignature = () => {
      const skuRoot = document.querySelector('[style*="--area:sku"] [data-spm="sku_floor"], [data-spm="sku_floor"]');
      if (!skuRoot) return "";
      const parts = [...skuRoot.querySelectorAll('[class*="SkuPropertyItem__skuProp"]')].map((prop, index) => {
        const labels = [...prop.querySelectorAll('[class*="SkuPropertyItem__propName"]')].map((node) => clean(node.textContent || "").replace(/:$/, "")).filter(Boolean);
        const name = labels[0] || `prop${index + 1}`;
        const selected = labels.slice(1).join(" ") || clean(prop.querySelector('[data-testid="skuProp"][class*="optionActive"]')?.textContent || "");
        const active = prop.querySelector('[data-testid="skuProp"][class*="optionActive"]');
        const image = active?.querySelector?.("img")?.getAttribute("src") || "";
        const activeIndex = active ? [...prop.querySelectorAll('[data-testid="skuProp"]')].indexOf(active) : -1;
        return [name, selected, image, activeIndex].filter((item) => item !== "" && item !== -1).join("=");
      }).filter(Boolean);
      return parts.length ? parts.join("|") : "";
    };
    const getPidKey = (pid = getPid()) => {
      if (!pid) return "";
      const skuSignature = getSelectedSkuSignature();
      return skuSignature ? `aliexpress:${pid}:sku:${hashSkuSignature(skuSignature)}` : `aliexpress:${pid}`;
    };
    const parsePriceFromExpAttribute = (root) => {
      const raw = root?.getAttribute?.("exp_attribute") || "";
      if (!raw) return null;
      const decoded = (() => {
        try {
          return decodeURIComponent(raw);
        } catch (_) {
          return raw;
        }
      })();
      const m = decoded.match(/finalPrice\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i) || decoded.match(/price\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
      if (!m) return null;
      const price = Number(String(m[1]).replace(",", "."));
      if (!Number.isFinite(price)) return null;
      const currencyMatch = decoded.match(/currency\s*:\s*([A-Z]{3}|US)/i);
      return {
        price,
        currency: normalizeCurrency(currencyMatch && currencyMatch[1]),
        text: decoded
      };
    };
    const parsePriceFromRoot = (root, defaultCurrency = "", options = {}) => {
      if (!root) return null;
      const allowGeneric = options.allowGeneric !== false;
      const text = clean(root.textContent || "");
      const attrValue = root.getAttribute?.("data-unformatted-price");
      const attrPrice = attrValue != null ? Number(String(attrValue).replace(",", ".")) : NaN;
      const attrCurrency = getCurrencyFromAttrs(root) || normalizeCurrency(detectCurrency(text)) || defaultCurrency;
      if (Number.isFinite(attrPrice)) return { price: attrPrice, currency: attrCurrency, text };
      const expPrice = parsePriceFromExpAttribute(root);
      if (expPrice) return {
        price: expPrice.price,
        currency: expPrice.currency || attrCurrency,
        text: expPrice.text || text
      };
      if (!allowGeneric) return null;
      const info = findPriceInCard(root, { defaultCurrency: attrCurrency || defaultCurrency });
      if (info && Number.isFinite(Number(info.price))) {
        return { price: Number(info.price), currency: normalizeCurrency(info.currency || attrCurrency || defaultCurrency), text };
      }
      const parsed = parsePriceValue(text);
      if (!Number.isFinite(parsed)) return null;
      return { price: parsed, currency: attrCurrency || defaultCurrency, text };
    };
    const isStruckPriceNode = (node, root) => {
      let cur = node;
      while (cur && cur !== root && cur !== document.body) {
        const raw = `${cur.tagName || ""} ${cur.className || ""} ${cur.getAttribute?.("style") || ""}`.toLowerCase();
        if (/\bdel\b|strike|strikethrough|line[-_]?through|linethrough|originalprice|oldprice|priceold/i.test(raw)) return true;
        cur = cur.parentElement;
      }
      return false;
    };
    const isShippingText = (text) => /delivery|shipping|достав|post office|courier/i.test(String(text || ""));
    const getNodeContext = (node, boundary) => {
      const parts = [];
      let cur = node;
      for (let i = 0; cur && cur !== document.body && i < 5; i += 1) {
        parts.push(cur.getAttribute?.("title") || "");
        parts.push(cur.textContent || "");
        parts.push(String(cur.className || ""));
        if (i <= 2 && cur.querySelectorAll) {
          [...cur.querySelectorAll("img")].slice(0, 4).forEach((img) => {
            parts.push(img.getAttribute("src") || "");
            parts.push(img.getAttribute("data-src") || "");
            parts.push(img.getAttribute("alt") || "");
          });
        }
        if (cur === boundary) break;
        cur = cur.parentElement;
      }
      return clean(parts.filter(Boolean).join(" "));
    };
    const parseMoneyLeaf = (node, defaultCurrency = "") => {
      const text = clean([
        node?.getAttribute?.("title") || "",
        node?.textContent || ""
      ].filter(Boolean).join(" "));
      if (!text || !/\d/.test(text) || /%/.test(text)) return null;
      const currency = normalizeCurrency(detectCurrency(text) || defaultCurrency);
      if (!currency) return null;
      const price = parsePriceValue(text);
      if (!Number.isFinite(price)) return null;
      return {
        price,
        currency,
        text
      };
    };
    const getLeafNodes = (root) => [...root?.querySelectorAll?.("span, div, p, strong, b") || []].filter((node) => !node.closest(".mp-min-price-badge") && (!node.children || node.children.length === 0));
    const hasMoneyText = (text) => /\d/.test(String(text || "")) && !!detectCurrency(text);
    const findCompactMoneyAncestor = (node, boundary) => {
      let cur = node;
      for (let i = 0; cur && cur !== document.body && i < 5; i += 1) {
        const text = clean(cur.textContent || "");
        if (hasMoneyText(text) && text.length <= 140) return cur;
        if (cur === boundary) break;
        cur = cur.parentElement;
      }
      return null;
    };
    const findListingDeliveryRoots = (card) => {
      if (!card?.querySelectorAll) return [];
      const roots = /* @__PURE__ */ new Set();
      [...card.querySelectorAll("div, span, p")].forEach((node) => {
        const context = `${node.getAttribute?.("title") || ""} ${node.textContent || ""} ${String(node.className || "")}`;
        const text = clean(node.textContent || "");
        if (!isShippingText(context) || !hasMoneyText(text) || text.length > 180) return;
        roots.add(node);
      });
      [...card.querySelectorAll("img")].forEach((img) => {
        const imgContext = [
          img.getAttribute("src") || "",
          img.getAttribute("data-src") || "",
          img.getAttribute("alt") || "",
          String(img.className || "")
        ].join(" ");
        if (!isShippingText(imgContext)) return;
        const root = findCompactMoneyAncestor(img.parentElement || img, card);
        if (root) roots.add(root);
      });
      return [...roots];
    };
    const parseListingCardPrice = (card) => {
      if (!card) return null;
      const leaves = getLeafNodes(card);
      const productCandidates = [];
      const shippingCandidates = [];
      let hasFreeShipping = false;
      leaves.forEach((node) => {
        const context = getNodeContext(node, card);
        if (/free/i.test(context) && isShippingText(context)) hasFreeShipping = true;
        const money = parseMoneyLeaf(node);
        if (!money) return;
        if (isShippingText(context)) {
          shippingCandidates.push(money);
          return;
        }
        if (isStruckPriceNode(node, card)) return;
        productCandidates.push({
          ...money,
          score: (() => {
            const style = getComputedStyle(node);
            const fontSize = parseFloat(style.fontSize) || 0;
            const weight = parseFloat(style.fontWeight) || 0;
            return fontSize + (weight >= 600 ? 4 : 0);
          })()
        });
      });
      productCandidates.sort((a, b) => b.score - a.score || b.price - a.price);
      const product = productCandidates[0] || null;
      if (!product) return null;
      findListingDeliveryRoots(card).forEach((root) => {
        const delivery = parseDeliveryPrice(root, product.currency || "");
        if (delivery && Number.isFinite(Number(delivery.price))) shippingCandidates.push(delivery);
      });
      const sameCurrencyShipping = shippingCandidates.filter((item) => !product.currency || !item.currency || item.currency === product.currency).sort((a, b) => a.price - b.price);
      const shipping = sameCurrencyShipping[0] || null;
      const shippingPrice = shipping && Number(shipping.price) < 100 ? Number(shipping.price) : hasFreeShipping ? 0 : 0;
      return {
        price: Number(product.price) + shippingPrice,
        currency: product.currency || shipping?.currency || "",
        text: shipping ? `product:${product.text}; shipping:${shipping.text}` : `product:${product.text}; shipping:${hasFreeShipping ? "free" : "unknown"}`
      };
    };
    const parseDeliveryPrice = (root, preferredCurrency = "") => {
      if (!root) return null;
      const text = clean(root.textContent || "");
      if (!text) return null;
      if (/\bfree\b|бесплат/i.test(text)) {
        return { price: 0, currency: preferredCurrency || normalizeCurrency(detectCurrency(text)), text };
      }
      const deliveryLeaves = getLeafNodes(root);
      if (!root.children || root.children.length === 0) deliveryLeaves.unshift(root);
      const leaves = deliveryLeaves.map((node) => {
        const leafText = clean([
          node?.getAttribute?.("title") || "",
          node?.textContent || ""
        ].filter(Boolean).join(" "));
        if (!detectCurrency(leafText)) return null;
        return parseMoneyLeaf(node, preferredCurrency);
      }).filter((item) => item && Number.isFinite(Number(item.price)));
      if (!leaves.length) return null;
      const scoped = preferredCurrency ? leaves.filter((item) => !item.currency || item.currency === preferredCurrency) : leaves;
      return (scoped.length ? scoped : leaves).filter((item) => Number(item.price) < 100).sort((a, b) => a.price - b.price)[0] || null;
    };
    const getPagePrice = () => {
      const product = parsePriceFromRoot(getPriceRoot(), "", { allowGeneric: false });
      if (!product || !Number.isFinite(Number(product.price))) return product;
      const priceArea = getPriceArea();
      const deliveryRoot = priceArea?.querySelector?.('[data-testid="RedProductDelivery"]') || document.querySelector('[data-testid="RedProductDelivery"]');
      const delivery = parseDeliveryPrice(deliveryRoot, product.currency || "");
      const deliveryPrice = delivery && Number.isFinite(Number(delivery.price)) ? Number(delivery.price) : 0;
      return {
        price: Number(product.price) + deliveryPrice,
        currency: product.currency || delivery?.currency || "",
        text: delivery ? `product:${product.text}; shipping:${delivery.text}` : `product:${product.text}; shipping:unknown`
      };
    };
    const getAnchor = () => getOrCreateChartAnchor();
    const isProductPage = () => !!getPidFromHref(location.href) || !!document.querySelector('[data-product-description="true"] h1');
    const getRootProductPids = (root) => {
      if (!root || !root.querySelectorAll) return [];
      return [...new Set([...root.querySelectorAll('a[href*="/item/"], a[href*="/i/"]')].map((a) => getPidFromHref(a.getAttribute("href") || a.href || "")).filter(Boolean))];
    };
    const getMainImage = (root) => {
      if (!root || !root.querySelectorAll) return null;
      const images = [...root.querySelectorAll("picture img, img")].filter((img) => {
        if (!img || img.closest(".mp-min-price-badge")) return false;
        const rect = img.getBoundingClientRect();
        const width = rect.width || img.naturalWidth || 0;
        const height = rect.height || img.naturalHeight || 0;
        if (width < 70 || height < 70) return false;
        const src = String(img.currentSrc || img.src || img.getAttribute("src") || "");
        if (/sprite|icon|logo|avatar|badge/i.test(src)) return false;
        return true;
      }).map((img) => {
        const rect = img.getBoundingClientRect();
        return {
          img,
          area: (rect.width || img.naturalWidth || 0) * (rect.height || img.naturalHeight || 0)
        };
      }).sort((a, b) => b.area - a.area);
      return images[0]?.img || null;
    };
    const findCardRoot = (link, pid) => {
      let cur = link;
      let best = link;
      for (let i = 0; cur && cur !== document.body && i < 8; i += 1) {
        const pids = getRootProductPids(cur);
        if (pids.length > 1 && (!pid || pids.some((item) => item !== pid))) break;
        const hasImage = !!getMainImage(cur);
        const hasPrice = !!parsePriceFromRoot(cur, "", { allowGeneric: true });
        if (hasImage && hasPrice) best = cur;
        cur = cur.parentElement;
      }
      return best || link;
    };
    const findBadgeTarget = (card) => {
      if (!card || !card.querySelector) return null;
      const outerLink = card.closest?.('a[href*="/item/"], a[href*="/i/"]');
      if (outerLink && getMainImage(outerLink)) {
        const image = getMainImage(card) || getMainImage(outerLink);
        const imageBox = image?.closest?.('[data-type="Element-Gallery"], [class*="Gallery__gallery"], [class*="picListWrapper"]') || (image?.parentElement?.tagName === "PICTURE" ? image.parentElement.parentElement : image?.parentElement);
        if (imageBox && outerLink.contains(imageBox)) return imageBox;
        return outerLink;
      }
      const cartImageLink = card.querySelector('a[data-testid="productImageLink"][href*="/item/"]');
      if (cartImageLink && getMainImage(cartImageLink)) return cartImageLink;
      const links = [...card.querySelectorAll('a[href*="/item/"], a[href*="/i/"]')];
      const withImages = links.filter((link) => !!getMainImage(link)).map((link) => {
        const rect = link.getBoundingClientRect();
        return { link, area: (rect.width || 0) * (rect.height || 0), rect };
      }).filter((item) => (item.rect.width || 0) >= 80 && (item.rect.height || 0) >= 80).sort((a, b) => b.area - a.area);
      return withImages[0]?.link || null;
    };
    const findCartItemRootFromImageLink = (link) => {
      const closestItem = link?.closest?.('[id^="cart-item-"], [data-testid="productContainer"]');
      if (closestItem?.querySelector?.("[data-product-unformatted-price]")) return closestItem;
      let cur = link;
      for (let i = 0; cur && cur !== document.body && i < 8; i += 1) {
        if (cur.querySelector?.("[data-product-unformatted-price]") && cur.querySelector?.('[data-testid="productImageLink"]')) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    };
    const getCartCards = () => {
      const out = [];
      const seen = /* @__PURE__ */ new Set();
      [...document.querySelectorAll('a[data-testid="productImageLink"][href*="/item/"]')].forEach((link) => {
        const root = findCartItemRootFromImageLink(link);
        if (!root || seen.has(root)) return;
        seen.add(root);
        out.push(root);
      });
      return out;
    };
    const findCartDeliveryRoot = (card, priceNode) => {
      if (!card?.querySelectorAll) return null;
      const nodes = [...card.querySelectorAll("div, span, p")].filter((node) => {
        if (priceNode && node.contains?.(priceNode)) return false;
        const text = clean(node.textContent || "");
        if (!text || !/delivery|shipping|достав/i.test(text)) return false;
        return text.length <= 180;
      }).map((node) => ({
        node,
        text: clean(node.textContent || ""),
        className: String(node.className || "")
      }));
      const preferred = nodes.filter((item) => /ProductShipping|ShippingInfo|delivery|shipping/i.test(item.className)).sort((a, b) => a.text.length - b.text.length)[0];
      return preferred?.node || nodes.sort((a, b) => a.text.length - b.text.length)[0]?.node || null;
    };
    const parseCartCardPrice = (card) => {
      const priceNode = card?.querySelector?.("[data-product-unformatted-price]");
      const rawPrice = priceNode?.getAttribute?.("data-product-unformatted-price");
      const productPrice = rawPrice != null ? Number(String(rawPrice).replace(",", ".")) : NaN;
      if (!Number.isFinite(productPrice)) return null;
      const productText = clean(priceNode?.textContent || "");
      const deliveryRoot = findCartDeliveryRoot(card, priceNode);
      const productCurrency = normalizeCurrency(detectCurrency(productText) || detectCurrency(deliveryRoot?.textContent || "") || detectCurrency(card?.textContent || ""));
      const delivery = parseDeliveryPrice(deliveryRoot, productCurrency || "");
      const deliveryPrice = delivery && Number.isFinite(Number(delivery.price)) ? Number(delivery.price) : 0;
      return {
        price: productPrice + deliveryPrice,
        currency: productCurrency || delivery?.currency || "",
        text: delivery ? `product:${productText || rawPrice}; shipping:${delivery.text}` : `product:${productText || rawPrice}; shipping:unknown`
      };
    };
    const collectAliGroups = () => {
      const onProductPage = isProductPage();
      const groups = /* @__PURE__ */ new Map();
      const seenRoots = /* @__PURE__ */ new Set();
      const getCardScore = (root) => {
        const img = getMainImage(root);
        const imgRect = img?.getBoundingClientRect?.() || { width: 0, height: 0 };
        const rootRect = root?.getBoundingClientRect?.() || { width: 0, height: 0 };
        return (imgRect.width || 0) * (imgRect.height || 0) + Math.min(2e4, (rootRect.width || 0) * (rootRect.height || 0) * 0.02);
      };
      const cartCards = getCartCards().slice(0, 1200);
      const directCards = [...document.querySelectorAll("[data-product-id]")].slice(0, 1200);
      const fallbackLinks = cartCards.length || directCards.length || onProductPage ? [] : [...document.querySelectorAll('a[href*="/item/"], a[href*="/i/"]')].slice(0, 1200);
      const candidates = cartCards.length ? cartCards.map((card) => ({ card, pid: getPidFromCard(card), mode: "cart" })) : directCards.length ? directCards.map((card) => ({ card, pid: getPidFromCard(card), mode: "snippet" })) : fallbackLinks.map((link) => ({ card: findCardRoot(link, getPidFromHref(link.getAttribute("href") || link.href || "")), pid: getPidFromHref(link.getAttribute("href") || link.href || ""), mode: "snippet" }));
      candidates.forEach(({ card: root, pid, mode }) => {
        if (!pid) return;
        if (!root || seenRoots.has(root)) return;
        seenRoots.add(root);
        const rect = root.getBoundingClientRect();
        if ((rect.width || 0) < 80 || (rect.height || 0) < 80) return;
        if (!findBadgeTarget(root)) return;
        const priceInfo = mode === "cart" ? parseCartCardPrice(root) : parseListingCardPrice(root);
        if (!priceInfo || !Number.isFinite(Number(priceInfo.price))) return;
        const pidKey = `aliexpress:${pid}`;
        if (!groups.has(pidKey)) groups.set(pidKey, { pid, pidKey, cards: [], priceInfo: null, cardScore: -1 });
        const group = groups.get(pidKey);
        const cardScore = getCardScore(root);
        if (!group.cards.length || cardScore > group.cardScore) {
          group.cards = [root];
          group.cardScore = cardScore;
        }
        if (!group.priceInfo || Number(priceInfo.price) < Number(group.priceInfo.price)) {
          group.priceInfo = priceInfo;
        }
      });
      return [...groups.values()].map((group) => ({
        pid: group.pid,
        pidKey: group.pidKey,
        cards: group.cards,
        priceInfo: group.priceInfo
      })).slice(0, 220);
    };
    const getBadgeTarget = (card) => {
      const target = findBadgeTarget(card) || card;
      target.classList.remove("mp-min-price-anchor--below-center");
      target.classList.remove("mp-min-price-anchor--below");
      target.classList.add("mp-min-price-anchor--photo-inside");
      return target || card;
    };
    const detectCurrentProduct = () => {
      const pid = getPid();
      if (!pid) return null;
      const priceInfo = getPagePrice();
      return {
        market: "aliexpress",
        pid,
        pidKey: getPidKey(pid),
        currency: priceInfo?.currency || ""
      };
    };
    setCurrentProductDetector(detectCurrentProduct);
    startProductTracker({ market: "aliexpress", getPid, getPidKey, getPrice: getPagePrice, getAnchor, isProductPage });
    startCardScanner({
      collectGroups: collectAliGroups,
      getBadgeTarget
    });
  })();
})();

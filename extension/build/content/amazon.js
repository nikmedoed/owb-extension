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

  // src/content/exporter/amazon.js
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
      findPriceInCard
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
    const clean = cleanText;
    const AMAZON_ASIN_RE = /^[A-Z0-9]{10}$/;
    const AMAZON_DEFAULT_MAX_REVIEWS = 100;
    const AMAZON_ALL_MAX_REVIEWS = 300;
    const isProductPage = () => /\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/[A-Z0-9]{10}(?:[/?#]|$)/i.test(location.pathname || "") || !!document.querySelector("#dp, #centerCol #title, #ppd #title");
    const normalizeAsin = (value) => {
      const raw = String(value || "").trim().toUpperCase();
      return AMAZON_ASIN_RE.test(raw) ? raw : "";
    };
    const getAsinFromHref = (href) => {
      try {
        const url = new URL(String(href || ""), location.href);
        const path = String(url.pathname || "");
        const m = path.match(/\/(?:dp|gp\/product|exec\/obidos\/ASIN|product-reviews)\/([A-Z0-9]{10})(?:[/?#]|$)/i) || path.match(/\/([A-Z0-9]{10})(?:[/?#]|$)/i);
        return normalizeAsin(m && m[1]);
      } catch (_) {
        return "";
      }
    };
    const getAsin = () => {
      const fromUrl = getAsinFromHref(location.href);
      if (fromUrl) return fromUrl;
      const selectors = [
        'input[name="asin"]',
        "input#ASIN",
        "input#asin",
        "#averageCustomerReviews[data-asin]",
        "[data-csa-c-asin]",
        "[data-asin]"
      ];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        const value = node?.value || node?.getAttribute?.("data-asin") || node?.getAttribute?.("data-csa-c-asin") || "";
        const asin = normalizeAsin(value);
        if (asin) return asin;
      }
      const canonical = document.querySelector('link[rel="canonical"]')?.href || "";
      return getAsinFromHref(canonical);
    };
    const getPidKey = () => {
      const asin = getAsin();
      return asin ? `amazon:${asin}` : "";
    };
    const getCanonicalUrl = (asin = getAsin()) => asin ? `${location.origin}/dp/${asin}` : location.href;
    const isAmazonReviewsRoute = () => /\/(?:product-reviews|portal\/customer-reviews)\/[A-Z0-9]{10}(?:[/?#]|$)/i.test(location.pathname || "");
    const buildAmazonReviewsUrl = (asin = getAsin(), page = 1) => {
      if (!asin) return "";
      const url = new URL(`/product-reviews/${asin}`, location.origin);
      url.searchParams.set("reviewerType", "all_reviews");
      url.searchParams.set("sortBy", "recent");
      url.searchParams.set("pageNumber", String(Math.max(1, Number(page) || 1)));
      return url.href;
    };
    const getTitleNode = () => document.querySelector("#title #productTitle, h1#title span#productTitle, h1#title, #productTitle");
    const getTitle = () => clean(getTitleNode()?.textContent || document.querySelector('input[name="productTitle"]')?.value || document.title || "\u2014");
    const getBrand = () => {
      const byline = clean(document.querySelector("#bylineInfo")?.textContent || "");
      const fromByline = byline.replace(/^visit\s+the\s+/i, "").replace(/\s+store$/i, "").replace(/^brand:\s*/i, "").trim();
      if (fromByline) return fromByline;
      const row = [...document.querySelectorAll("#productDetails_feature_div tr, #prodDetails tr")].find((tr) => /^brand$/i.test(clean(tr.querySelector("th")?.textContent || "")));
      return clean(row?.querySelector("td")?.textContent || "\u2014");
    };
    const isOldPriceNode = (node) => !!(node && (node.closest('.a-text-price, [data-a-strike="true"], del') || /line-through/i.test(node.closest("[style]")?.getAttribute("style") || "")));
    const parsePriceNode = (node) => {
      if (!node) return null;
      const text = clean(node.getAttribute?.("aria-label") || node.textContent || "");
      const price = parsePriceValue(text);
      if (!Number.isFinite(price)) return null;
      return { price, currency: normalizeCurrency(detectCurrency(text) || "$"), text };
    };
    const getAmazonCurrency = () => {
      const explicit = document.querySelector('input#priceSymbol, input[name="priceSymbol"]')?.value || document.querySelector("input#currencyOfPreference")?.value || "";
      const fromState = [...document.querySelectorAll('script[type="a-state"]')].map((node) => node.textContent || "").find((text) => /"currencyOfPreference"\s*:/.test(text));
      return normalizeCurrency(detectCurrency(explicit) || explicit || fromState && (fromState.match(/"currencyOfPreference"\s*:\s*"([^"]+)"/) || [])[1] || "USD") || "$";
    };
    const parseFromPriceText = (text) => {
      const cleaned = clean(text);
      if (!/\b(from|starting\s+at|starts\s+at|options?\s+from)\b/i.test(cleaned)) return null;
      const price = parsePriceValue(cleaned);
      if (!Number.isFinite(price)) return null;
      return { price, currency: normalizeCurrency(detectCurrency(cleaned) || getAmazonCurrency()), text: cleaned };
    };
    const parseDeliveryCostFromText = (text) => {
      const cleaned = clean(text);
      if (!/\b(ship(?:ping)?|delivery)\b/i.test(cleaned)) return null;
      if (/\bfree\b.{0,30}\b(ship(?:ping)?|delivery)\b/i.test(cleaned) || /\b(ship(?:ping)?|delivery)\b.{0,30}\bfree\b/i.test(cleaned)) return null;
      if (/\b(shipping cost|delivery date|order total|shown at checkout|does not include|including shipping|when shipping)\b/i.test(cleaned)) return null;
      const patterns = [
        /(?:\+|plus|add)\s*([₽€$£¥֏₸₺₴₹₩]\s*\d[\d\s.,]*|\d[\d\s.,]*\s*[₽€$£¥֏₸₺₴₹₩])\s*(?:for\s*)?(?:ship(?:ping)?|delivery)\b/i,
        /\b(?:ship(?:ping)?|delivery)\b(?:\s*(?:cost|fee|charge|from|is|:))?\s*([₽€$£¥֏₸₺₴₹₩]\s*\d[\d\s.,]*|\d[\d\s.,]*\s*[₽€$£¥֏₸₺₴₹₩])/i,
        /([₽€$£¥֏₸₺₴₹₩]\s*\d[\d\s.,]*|\d[\d\s.,]*\s*[₽€$£¥֏₸₺₴₹₩])\s*(?:for\s*)?(?:ship(?:ping)?|delivery)\b/i
      ];
      for (const re of patterns) {
        const m = cleaned.match(re);
        const price = parsePriceValue(m && m[1]);
        if (Number.isFinite(price) && price > 0) {
          return { price, currency: normalizeCurrency(detectCurrency(m[1]) || detectCurrency(cleaned) || getAmazonCurrency()), text: cleaned };
        }
      }
      return null;
    };
    const getDeliveryCost = (root = document) => {
      const source = root && root.querySelectorAll ? root : document;
      const selectors = [
        "#deliveryBlockMessage",
        "#mir-layout-DELIVERY_BLOCK",
        "#shippingMessageInsideBuyBox_feature_div",
        "#amazonGlobal_feature_div",
        "#exportsTaxMessage_feature_div",
        "#dynamicDeliveryMessage"
      ].join(", ");
      const nodes = [...source.querySelectorAll(selectors)].filter((node) => !node.closest?.(".mp-min-price-badge"));
      for (const node of nodes) {
        const info = parseDeliveryCostFromText(node.textContent || "");
        if (info) return info;
      }
      return null;
    };
    const withDeliveryCost = (info, root = document) => {
      if (!info || !Number.isFinite(Number(info.price))) return info;
      const delivery = getDeliveryCost(root);
      if (!delivery || !Number.isFinite(Number(delivery.price))) return info;
      const infoCurrency = info.currency || delivery.currency || "$";
      const deliveryCurrency = delivery.currency || infoCurrency;
      if (infoCurrency && deliveryCurrency && infoCurrency !== deliveryCurrency) return info;
      return {
        price: Number(info.price) + Number(delivery.price),
        currency: infoCurrency,
        text: `${info.text || ""} + delivery ${delivery.text || delivery.price}`.trim()
      };
    };
    const getSelectedVariationPrice = () => {
      const selected = [
        ...document.querySelectorAll(
          [
            '#twister-plus-inline-twister li[data-initiallyselected="true"]',
            "#twister-plus-inline-twister .a-button-selected",
            '#twister-plus-inline-twister input[aria-checked="true"]',
            "#variation_size_name .a-button-selected",
            "#variation_color_name .a-button-selected",
            "#twister .a-button-selected",
            '#twister input[aria-checked="true"]'
          ].join(", ")
        )
      ].map((node) => node.closest?.("li, .a-button, .swatchElement, [data-asin]") || node).filter((node, index, list) => node && list.indexOf(node) === index);
      for (const node of selected) {
        const preferred = node.querySelector?.(".twister_swatch_price, .inline-twister-swatch-price, .dimension-slot-info, .a-price");
        const fromPreferred = preferred && (parseFromPriceText(preferred.textContent || "") || findPriceInCard(preferred, { defaultCurrency: "$" }));
        if (fromPreferred && Number.isFinite(Number(fromPreferred.price))) {
          return withDeliveryCost({ price: Number(fromPreferred.price), currency: fromPreferred.currency || "$", text: preferred.textContent || "" });
        }
        const info = parseFromPriceText(node.textContent || "") || findPriceInCard(node, { defaultCurrency: "$" });
        if (info && Number.isFinite(Number(info.price))) {
          return withDeliveryCost({ price: Number(info.price), currency: info.currency || "$", text: node.textContent || "" });
        }
      }
      return null;
    };
    const getPriceRoot = () => document.querySelector("#corePriceDisplay_desktop_feature_div") || document.querySelector("#corePrice_feature_div") || document.querySelector("#apex_desktop") || document.querySelector("#buybox") || document.querySelector("#centerCol") || null;
    const getPagePrice = () => {
      const hiddenValue = document.querySelector('input#priceValue, input[name="priceValue"]')?.value;
      const hiddenPrice = Number(String(hiddenValue || "").replace(",", "."));
      if (Number.isFinite(hiddenPrice) && hiddenPrice > 0) {
        const symbol = document.querySelector('input#priceSymbol, input[name="priceSymbol"]')?.value || "$";
        const currency = normalizeCurrency(symbol || document.querySelector("input#currencyOfPreference")?.value || "USD") || "$";
        return withDeliveryCost({ price: hiddenPrice, currency, text: `${symbol}${hiddenValue}` });
      }
      const root = getPriceRoot();
      const preferred = [
        "#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen",
        '#corePriceDisplay_desktop_feature_div [data-a-color="price"] .a-offscreen',
        "#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen",
        "#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen",
        "#apex_desktop .a-price:not(.a-text-price) .a-offscreen",
        "#buybox .a-price:not(.a-text-price) .a-offscreen"
      ];
      for (const selector of preferred) {
        const nodes = [...document.querySelectorAll(selector)].filter((node) => !isOldPriceNode(node));
        for (const node of nodes) {
          const parsed = parsePriceNode(node);
          if (parsed) return withDeliveryCost(parsed);
        }
      }
      const selectedVariationPrice = getSelectedVariationPrice();
      if (selectedVariationPrice) return selectedVariationPrice;
      const info = findPriceInCard(root || document.body, { defaultCurrency: "$" });
      return info && Number.isFinite(Number(info.price)) ? withDeliveryCost({ price: Number(info.price), currency: info.currency || "$", text: root?.textContent || "" }) : withDeliveryCost({ price: 1, currency: getAmazonCurrency(), text: "Amazon price fallback" });
    };
    const formatPrice = (info) => {
      if (!info || !Number.isFinite(Number(info.price))) return "\u2014";
      return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(info.price))} ${info.currency || "$"}`;
    };
    const parseCount = (value) => {
      const compact = clean(value).match(/(\d+(?:[.,]\d+)?)\s*([km])\b/i);
      if (compact) {
        const n = Number(compact[1].replace(",", "."));
        return Number.isFinite(n) ? Math.round(n * (/m/i.test(compact[2]) ? 1e6 : 1e3)) : 0;
      }
      const digits = clean(value).replace(/[^\d]/g, "");
      return digits ? Number(digits) || 0 : 0;
    };
    const getRatingInfo = () => {
      const ratingText = clean(
        document.querySelector("#acrPopover")?.getAttribute("title") || document.querySelector("#acrPopover .a-icon-alt")?.textContent || document.querySelector('[data-hook="rating-out-of-text"]')?.textContent || ""
      );
      const rating = (ratingText.replace(",", ".").match(/\b([0-5](?:\.\d)?)\b/) || [])[1] || "\u2014";
      const reviewsText = clean(
        document.querySelector("#acrCustomerReviewText")?.getAttribute("aria-label") || document.querySelector("#acrCustomerReviewText")?.textContent || ""
      );
      return {
        rating,
        reviews: parseCount(reviewsText)
      };
    };
    const getSeller = () => {
      const seller = clean(
        document.querySelector("#sellerProfileTriggerId")?.textContent || document.querySelector("#merchant-info a")?.textContent || ""
      );
      if (seller) return seller;
      const merchant = clean(document.querySelector("#merchant-info")?.textContent || "");
      const m = merchant.match(/sold by\s+(.+?)(?:\sand\s+fulfilled|\.)/i);
      return clean(m && m[1] || merchant || "\u2014");
    };
    const getAvailability = () => clean(document.querySelector("#availability")?.textContent || document.querySelector("#outOfStock")?.textContent || "\u2014");
    const collectBullets = () => [...document.querySelectorAll("#feature-bullets li .a-list-item")].map((node) => clean(node.textContent || "")).filter((text) => text && !/^make sure this fits/i.test(text));
    const collectSpecs = () => {
      const rows = [];
      const seen = /* @__PURE__ */ new Set();
      const add = (key, value) => {
        const k = clean(key).replace(/[:\s]+$/, "");
        const v = clean(value);
        if (!k || !v || k === v) return;
        if (/^(customer reviews|best sellers rank)$/i.test(k)) return;
        const row = `${k}: ${v}`;
        const sig = row.toLowerCase();
        if (seen.has(sig)) return;
        seen.add(sig);
        rows.push(row);
      };
      document.querySelectorAll("#productOverview_feature_div tr, #productDetails_feature_div tr, #prodDetails tr, table#productDetails_detailBullets_sections1 tr").forEach((tr) => {
        add(tr.querySelector("th, .a-span3")?.textContent, tr.querySelector("td, .a-span9")?.textContent);
      });
      document.querySelectorAll("#detailBullets_feature_div li").forEach((li) => {
        const bold = li.querySelector(".a-text-bold");
        if (!bold) return;
        const key = clean(bold.textContent).replace(/^[\s:]+|[\s:]+$/g, "");
        const clone = li.cloneNode(true);
        clone.querySelectorAll(".a-text-bold, script, style").forEach((node) => node.remove());
        add(key, clone.textContent);
      });
      return rows.length ? rows.join("\n") : "\u2014";
    };
    const collectVariations = () => {
      const rows = [];
      document.querySelectorAll('[id^="variation_"]').forEach((root) => {
        const label = clean(root.querySelector(".a-form-label")?.textContent || root.id.replace(/^variation_/, ""));
        const selected = clean(root.querySelector(".selection")?.textContent || root.querySelector('[aria-checked="true"]')?.textContent || "");
        if (label && selected) rows.push(`${label.replace(/[:\s]+$/, "")}: ${selected}`);
      });
      return rows.length ? rows.join("\n") : "\u2014";
    };
    const collectDescription = () => {
      const direct = clean(document.querySelector("#productDescription")?.textContent || "");
      if (direct) return direct;
      const aplus = document.querySelector("#aplus, #aplus_feature_div");
      if (!aplus) return "\u2014";
      const clone = aplus.cloneNode(true);
      clone.querySelectorAll("script, style, noscript, svg, button, img").forEach((node) => node.remove());
      const lines = clean(clone.innerText || clone.textContent || "").split(/\n+/).map((line) => clean(line)).filter(Boolean);
      return lines.length ? lines.slice(0, 80).join("\n") : "\u2014";
    };
    const getMainImage = () => {
      const img = document.querySelector("#landingImage, #imgTagWrapperId img, #main-image-container img");
      return clean(img?.currentSrc || img?.src || img?.getAttribute?.("data-old-hires") || "");
    };
    const requestAmazonReviewsInTempTab = async (reviewsUrl, options = {}) => {
      if (!reviewsUrl || !(globalThis.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === "function")) {
        return null;
      }
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({
            type: "owb:amazon-collect-reviews",
            payload: {
              url: reviewsUrl,
              maxReviews: options.maxReviews || AMAZON_DEFAULT_MAX_REVIEWS
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
    const textFromNode = (node) => {
      if (!node) return "";
      const clone = node.cloneNode(true);
      clone.querySelectorAll("script, style, noscript, svg, button").forEach((n) => n.remove());
      return clean(clone.innerText || clone.textContent || "");
    };
    const readReviewsStatePage = (node) => {
      try {
        const raw = node?.getAttribute?.("data-reviews-state-param") || "";
        if (!raw) return 0;
        const data = JSON.parse(raw.replace(/&quot;/g, '"'));
        const n = Number(data.pageNumber);
        return Number.isFinite(n) ? n : 0;
      } catch (_) {
        return 0;
      }
    };
    const isVisibleNode = (node) => {
      if (!node || !node.isConnected) return false;
      if (node.closest("[hidden], .aok-hidden, .a-hidden, .a-button-disabled")) return false;
      if (node.getAttribute("aria-disabled") === "true") return false;
      const rect = node.getBoundingClientRect?.();
      return !rect || rect.width > 0 || rect.height > 0;
    };
    const clickAmazonNode = (node) => {
      if (!node) return false;
      try {
        if (typeof node.click === "function") node.click();
        return true;
      } catch (_) {
        try {
          node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
          node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
          node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          return true;
        } catch (_2) {
          return false;
        }
      }
    };
    const getAmazonReviewBody = (node) => {
      const body = node.querySelector('[data-hook="review-body"], .review-text');
      const full = body?.querySelector?.('.cr-original-review-content, .a-expander-content, [data-expanded="true"]') || node.querySelector('.cr-original-review-content, [data-hook="review-body"] .a-expander-content');
      return (textFromNode(full) || textFromNode(body) || "\u0411\u0435\u0437 \u0442\u0435\u043A\u0441\u0442\u0430").replace(/\s*(Read more|Show less)\s*$/i, "").trim();
    };
    const parseAmazonReviewNode = (node, idx) => {
      const ratingText = clean(
        node.querySelector('[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt, .review-rating .a-icon-alt')?.textContent || ""
      );
      const rating = (ratingText.replace(",", ".").match(/\b([1-5](?:\.\d)?)\b/) || [])[1] || "\u2014";
      const title = textFromNode(node.querySelector('[data-hook="review-title"], .review-title'));
      const date = clean(node.querySelector('[data-hook="review-date"], .review-date')?.textContent || "");
      const author = clean(node.querySelector(".a-profile-name")?.textContent || "");
      const variant = textFromNode(node.querySelector('[data-hook="format-strip"]'));
      const verified = clean(node.querySelector('[data-hook="avp-badge"]')?.textContent || "");
      const body = getAmazonReviewBody(node);
      const imageCount = node.querySelectorAll('[data-hook="review-image-tile"], .review-image-tile, img.review-image-tile').length;
      const parts = [];
      if (rating !== "\u2014") parts.push(`${rating}\u2605`);
      if (author) parts.push(`\u0410\u0432\u0442\u043E\u0440: ${author}`);
      if (title) parts.push(`\u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A: ${title}`);
      if (variant) parts.push(variant);
      if (verified) parts.push(verified);
      parts.push(`\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439: ${body}`);
      if (imageCount) parts.push(`\u0424\u043E\u0442\u043E: ${imageCount}`);
      return `\u041E\u0442\u0437\u044B\u0432 ${idx + 1} (${date || "\u2014"}): ${parts.join("; ")}`;
    };
    const getAmazonReviewNodes = (root = document) => {
      const nodes = [...root.querySelectorAll('[data-hook="review"], .review[data-hook], div[id^="customer_review-"]')];
      return nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
    };
    const collectAmazonReviewsFromDocument = (doc, offset = 0, seen = /* @__PURE__ */ new Set()) => {
      const nodes = getAmazonReviewNodes(doc);
      const items = [];
      nodes.forEach((node) => {
        const id = node.getAttribute("id") || node.getAttribute("data-review-id") || textFromNode(node).slice(0, 120);
        if (!id || seen.has(id)) return;
        seen.add(id);
        items.push(parseAmazonReviewNode(node, offset + items.length));
      });
      return items;
    };
    const getAmazonShowMoreButton = (root = document) => {
      const buttons = [
        ...root.querySelectorAll(
          '[data-hook="show-more-button"], .cm-cr-show-more a, #cm_cr-pagination_bar a, a[data-reftag^="cm_cr_arp_d_paging_btm"]'
        )
      ].filter((node) => !node.matches?.("select, option") && (root !== document || isVisibleNode(node)));
      const candidates = buttons.filter((node) => /show\s+\d+\s+more\s+reviews|show\s+more\s+reviews/i.test(clean(node.textContent || "")) || readReviewsStatePage(node) > 0).sort((a, b) => readReviewsStatePage(b) - readReviewsStatePage(a));
      return candidates[0] || buttons[buttons.length - 1] || null;
    };
    const expandAmazonReviewBodies = async (root = document) => {
      const buttons = getAmazonReviewNodes(root).flatMap((node) => [
        ...node.querySelectorAll(
          'a[data-action="a-expander-toggle"][aria-expanded="false"], .a-expander-header[aria-expanded="false"], [data-hook="review-body"] .a-expander-header, .review-text .a-expander-header'
        )
      ]).filter((node) => isVisibleNode(node));
      for (const button of buttons.slice(0, 300)) {
        button.scrollIntoView({ block: "center", inline: "nearest" });
        await sleep(60);
        clickAmazonNode(button);
      }
      if (buttons.length) await sleep(300);
    };
    const waitForAmazonReviewsCount = async (previousCount, timeoutMs = 15e3) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const count = getAmazonReviewNodes().length;
        if (count > previousCount) return count;
        await sleep(250);
      }
      return getAmazonReviewNodes().length;
    };
    const loadAmazonReviewsByClicking = async (limit) => {
      if (!isAmazonReviewsRoute()) return false;
      let stagnantRounds = 0;
      while (getAmazonReviewNodes().length < limit) {
        const before = getAmazonReviewNodes().length;
        const button = getAmazonShowMoreButton();
        if (!button) break;
        try {
          button.scrollIntoView({ block: "center", inline: "nearest" });
          window.scrollBy(0, Math.round(window.innerHeight * 0.35));
          await sleep(250);
          if (!clickAmazonNode(button)) break;
        } catch (_) {
          break;
        }
        const after = await waitForAmazonReviewsCount(before);
        if (after <= before) {
          stagnantRounds += 1;
          if (stagnantRounds >= 2) break;
        } else {
          stagnantRounds = 0;
        }
        await sleep(220);
      }
      await expandAmazonReviewBodies(document);
      return true;
    };
    const collectAmazonReviewsFromPages = async (maxReviews = AMAZON_DEFAULT_MAX_REVIEWS, asin = getAsin()) => {
      const limit = Math.max(1, Math.min(Number(maxReviews) || AMAZON_DEFAULT_MAX_REVIEWS, 300));
      const seen = /* @__PURE__ */ new Set();
      const items = [];
      if (isAmazonReviewsRoute()) {
        await loadAmazonReviewsByClicking(limit);
        items.push(...collectAmazonReviewsFromDocument(document, 0, seen));
      }
      const parser = new DOMParser();
      for (let page = 1; items.length < limit && page <= 30; page += 1) {
        const url = buildAmazonReviewsUrl(asin, page);
        if (!url) break;
        try {
          const response = await fetch(url, { credentials: "include" });
          if (!response.ok) break;
          const html = await response.text();
          const doc = parser.parseFromString(html, "text/html");
          const before = items.length;
          items.push(...collectAmazonReviewsFromDocument(doc, items.length, seen));
          const hasNext = !!(doc.querySelector("li.a-last a, .a-pagination .a-last a") || getAmazonShowMoreButton(doc));
          if (items.length === before || !hasNext) break;
        } catch (_) {
          break;
        }
        await sleep(180);
      }
      return {
        header: `\u041E\u0442\u0437\u044B\u0432\u044B (\u0432\u044B\u0433\u0440\u0443\u0436\u0435\u043D\u043E ${Math.min(items.length, limit)})`,
        items: items.slice(0, limit),
        unavailable: !items.length
      };
    };
    const collectAmazonReviewsForProduct = async (maxReviews = AMAZON_DEFAULT_MAX_REVIEWS) => {
      const asin = getAsin();
      if (!asin) return { header: "\u041E\u0442\u0437\u044B\u0432\u044B: ASIN \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D", items: [], unavailable: true };
      if (!isAmazonReviewsRoute()) {
        const fromTempTab = await requestAmazonReviewsInTempTab(buildAmazonReviewsUrl(asin, 1), { maxReviews });
        if (fromTempTab && Array.isArray(fromTempTab.items)) return fromTempTab;
      }
      return collectAmazonReviewsFromPages(maxReviews, asin);
    };
    const buildAmazonExportPackage = async (opts = {}) => {
      const includeReviews = opts.includeReviews !== false;
      const maxReviews = opts.allReviews === true ? Number(opts.maxReviews) || AMAZON_ALL_MAX_REVIEWS : Number(opts.maxReviews) || AMAZON_DEFAULT_MAX_REVIEWS;
      const asin = getAsin();
      const url = getCanonicalUrl(asin);
      const title = getTitle();
      const brand = getBrand();
      const rating = getRatingInfo();
      const priceInfo = getPagePrice();
      const bullets = collectBullets();
      const variations = collectVariations();
      const specs = collectSpecs();
      const description = collectDescription();
      const image = getMainImage();
      const lines = [
        "=== CARD SUMMARY (AMAZON) ===",
        `URL: ${url}`,
        `ASIN: ${asin || "\u2014"}`,
        `\u0411\u0440\u0435\u043D\u0434/\u043C\u0430\u0433\u0430\u0437\u0438\u043D: ${brand || "\u2014"}`,
        `\u041F\u0440\u043E\u0434\u0430\u0432\u0435\u0446: ${getSeller()}`,
        `\u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A: ${title}`,
        `\u0426\u0435\u043D\u0430: ${formatPrice(priceInfo)}`,
        `\u041D\u0430\u043B\u0438\u0447\u0438\u0435: ${getAvailability()}`,
        `\u0420\u0435\u0439\u0442\u0438\u043D\u0433: ${rating.rating} (${rating.reviews} \u043E\u0442\u0437\u044B\u0432\u043E\u0432)`,
        image ? `\u0418\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435: ${image}` : "",
        "",
        "=== \u0412\u0410\u0420\u0418\u0410\u041D\u0422 ===",
        variations,
        "",
        "=== \u041E\u041F\u0418\u0421\u0410\u041D\u0418\u0415 / \u0411\u0423\u041B\u041B\u0415\u0422\u042B ===",
        ...bullets.length ? bullets.map((item) => `- ${item}`) : ["\u2014"],
        "",
        "=== \u0425\u0410\u0420\u0410\u041A\u0422\u0415\u0420\u0418\u0421\u0422\u0418\u041A\u0418 ===",
        ...toBullets(specs),
        "",
        "=== PRODUCT DESCRIPTION ===",
        description
      ].filter((line) => line !== "");
      if (includeReviews) {
        const reviews = await collectAmazonReviewsForProduct(maxReviews);
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
        market: "amazon",
        pidKey: asin ? `amazon:${asin}` : "",
        url,
        title,
        filename: `${slug(title || asin || "amazon")}.txt`,
        text
      };
    };
    const restoreCardFocus = async () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      await sleep(220);
    };
    const exportAmazon = async (opts = {}) => {
      const includeReviews = opts.includeReviews !== false;
      const pack = await buildAmazonExportPackage(opts);
      if (opts.copyOnly) {
        await copyToClipboard(pack.text);
        await saveLastExtractSessionFromItem(pack, { mode: "copy", allReviews: includeReviews });
        try {
          await showExportMarkMaybe({ mode: "copy", scope: "single", market: "amazon" });
        } catch (_) {
        }
      } else {
        downloadTextFile(pack.filename, pack.text);
        await saveLastExtractSessionFromItem(pack, { mode: "download", allReviews: includeReviews });
        try {
          await showExportMarkMaybe({ mode: "download", scope: "single", market: "amazon" });
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
    function initAmazon() {
      ensureScrollTopButton();
      setRestoreFocus(restoreCardFocus);
      setRunExport((options = {}) => buildAmazonExportPackage(options));
      if (globalThis.chrome && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
          if (!message || message.scope !== "owb-amazon-reviews") return void 0;
          if (String(message.action || "") !== "collect-reviews") return void 0;
          (async () => {
            if (!isAmazonReviewsRoute()) throw new Error("Current page is not Amazon reviews route");
            return collectAmazonReviewsFromPages(Number(message.payload?.maxReviews) || AMAZON_DEFAULT_MAX_REVIEWS);
          })().then((data) => sendResponse({ ok: true, data })).catch((err) => {
            sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
          });
          return true;
        });
      }
      setInterval(() => {
        if (!isProductPage()) return;
        attachActionButtons(getTitleNode(), "amazon", [
          { label: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C", kind: "full", run: () => exportAmazon({ copyOnly: false, includeReviews: true }) },
          { label: "\u0432\u0441\u0435 \u043E\u0442\u0437\u044B\u0432\u044B", kind: "all", run: () => exportAmazon({ copyOnly: false, includeReviews: true, allReviews: true }) },
          { label: "\u0432 \u0431\u0443\u0444\u0435\u0440", kind: "copy", pendingText: "\u041A\u043E\u043F\u0438\u0440\u0443\u044E...", successText: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E", toastSuccess: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u0432 \u0431\u0443\u0444\u0435\u0440", run: () => exportAmazon({ copyOnly: true, includeReviews: false }) },
          { label: "\u0432 \u0431\u0443\u0444\u0435\u0440 \u0441 \u043E\u0442\u0437\u044B\u0432\u0430\u043C\u0438", kind: "copy_all", pendingText: "\u041A\u043E\u043F\u0438\u0440\u0443\u044E...", successText: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E", toastSuccess: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u0432 \u0431\u0443\u0444\u0435\u0440", run: () => exportAmazon({ copyOnly: true, includeReviews: true }) }
        ]);
      }, 1e3);
    }
    initAmazon();
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

  // src/content/price-monitor/amazon.js
  (() => {
    "use strict";
    const PM = window.OWBPriceMonitor;
    if (!PM) return;
    const {
      startProductTracker,
      startCardScanner,
      collectGroupsFromCards,
      setCurrentProductDetector,
      cleanText,
      parsePriceValue,
      detectCurrency,
      normalizeCurrency,
      findPriceInCard
    } = PM;
    const clean = cleanText;
    const AMAZON_ASIN_RE = /^[A-Z0-9]{10}$/;
    const normalizeAsin = (value) => {
      const raw = String(value || "").trim().toUpperCase();
      return AMAZON_ASIN_RE.test(raw) ? raw : "";
    };
    const getAsinFromHref = (href) => {
      try {
        const url = new URL(String(href || ""), location.href);
        const path = String(url.pathname || "");
        const m = path.match(/\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i) || path.match(/\/([A-Z0-9]{10})(?:[/?#]|$)/i);
        const fromPath = normalizeAsin(m && m[1]);
        if (fromPath) return fromPath;
        for (const key of ["pd_rd_i", "asin", "ASIN"]) {
          const fromQuery = normalizeAsin(url.searchParams.get(key));
          if (fromQuery) return fromQuery;
        }
        return "";
      } catch (_) {
        return "";
      }
    };
    const getAsinFromCsaItemId = (value) => {
      const m = String(value || "").match(/(?:^|[.:])asin\.([A-Z0-9]{10})(?:[.:]|$)/i) || String(value || "").match(/\b([A-Z0-9]{10})\b/i);
      return normalizeAsin(m && m[1]);
    };
    const getPid = () => {
      const fromUrl = getAsinFromHref(location.href);
      if (fromUrl) return fromUrl;
      const selectors = [
        'input[name="asin"]',
        "input#ASIN",
        "input#asin",
        "#averageCustomerReviews[data-asin]",
        "[data-csa-c-asin]",
        "[data-asin]"
      ];
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        const value = node?.value || node?.getAttribute?.("data-asin") || node?.getAttribute?.("data-csa-c-asin") || "";
        const asin = normalizeAsin(value);
        if (asin) return asin;
      }
      return getAsinFromHref(document.querySelector('link[rel="canonical"]')?.href || "");
    };
    const isProductPage = () => /\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/[A-Z0-9]{10}(?:[/?#]|$)/i.test(location.pathname || "") || !!document.querySelector("#dp, #centerCol #title, #ppd #title");
    const getPriceRoot = () => document.querySelector("#corePriceDisplay_desktop_feature_div") || document.querySelector("#corePrice_feature_div") || document.querySelector("#apex_desktop") || document.querySelector("#buybox") || document.querySelector("#centerCol") || null;
    const getAnchor = () => getPriceRoot();
    const isOldPriceNode = (node) => !!(node && (node.closest('.a-text-price, [data-a-strike="true"], del') || /line-through/i.test(node.closest("[style]")?.getAttribute("style") || "")));
    const parsePriceNode = (node) => {
      if (!node) return null;
      const text = clean(node.getAttribute?.("aria-label") || node.textContent || "");
      const price = parsePriceValue(text);
      if (!Number.isFinite(price)) return null;
      return { price, currency: normalizeCurrency(detectCurrency(text) || "$"), text };
    };
    const getAmazonCurrency = () => {
      const explicit = document.querySelector('input#priceSymbol, input[name="priceSymbol"]')?.value || document.querySelector("input#currencyOfPreference")?.value || "";
      const fromState = [...document.querySelectorAll('script[type="a-state"]')].map((node) => node.textContent || "").find((text) => /"currencyOfPreference"\s*:/.test(text));
      return normalizeCurrency(detectCurrency(explicit) || explicit || fromState && (fromState.match(/"currencyOfPreference"\s*:\s*"([^"]+)"/) || [])[1] || "USD") || "$";
    };
    const parseFromPriceText = (text) => {
      const cleaned = clean(text);
      if (!/\b(from|starting\s+at|starts\s+at|options?\s+from)\b/i.test(cleaned)) return null;
      const price = parsePriceValue(cleaned);
      if (!Number.isFinite(price)) return null;
      return { price, currency: normalizeCurrency(detectCurrency(cleaned) || getAmazonCurrency()), text: cleaned };
    };
    const getSelectedVariationPrice = () => {
      const selected = [
        ...document.querySelectorAll(
          [
            '#twister-plus-inline-twister li[data-initiallyselected="true"]',
            "#twister-plus-inline-twister .a-button-selected",
            '#twister-plus-inline-twister input[aria-checked="true"]',
            "#variation_size_name .a-button-selected",
            "#variation_color_name .a-button-selected",
            "#twister .a-button-selected",
            '#twister input[aria-checked="true"]'
          ].join(", ")
        )
      ].map((node) => node.closest?.("li, .a-button, .swatchElement, [data-asin]") || node).filter((node, index, list) => node && list.indexOf(node) === index);
      for (const node of selected) {
        const preferred = node.querySelector?.(".twister_swatch_price, .inline-twister-swatch-price, .dimension-slot-info, .a-price");
        const fromPreferred = preferred && (parseFromPriceText(preferred.textContent || "") || findPriceInCard(preferred, { defaultCurrency: "$" }));
        if (fromPreferred && Number.isFinite(Number(fromPreferred.price))) {
          return { price: Number(fromPreferred.price), currency: fromPreferred.currency || "$", text: preferred.textContent || "" };
        }
        const info = parseFromPriceText(node.textContent || "") || findPriceInCard(node, { defaultCurrency: "$" });
        if (info && Number.isFinite(Number(info.price))) {
          return { price: Number(info.price), currency: info.currency || "$", text: node.textContent || "" };
        }
      }
      return null;
    };
    const getPagePrice = () => {
      const hiddenValue = document.querySelector('input#priceValue, input[name="priceValue"]')?.value;
      const hiddenPrice = Number(String(hiddenValue || "").replace(",", "."));
      if (Number.isFinite(hiddenPrice) && hiddenPrice > 0) {
        const symbol = document.querySelector('input#priceSymbol, input[name="priceSymbol"]')?.value || "$";
        const currency = normalizeCurrency(symbol || document.querySelector("input#currencyOfPreference")?.value || "USD") || "$";
        return { price: hiddenPrice, currency, text: `${symbol}${hiddenValue}` };
      }
      const selectors = [
        "#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen",
        '#corePriceDisplay_desktop_feature_div [data-a-color="price"] .a-offscreen',
        "#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen",
        "#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen",
        "#apex_desktop .a-price:not(.a-text-price) .a-offscreen",
        "#buybox .a-price:not(.a-text-price) .a-offscreen"
      ];
      for (const selector of selectors) {
        const nodes = [...document.querySelectorAll(selector)].filter((node) => !isOldPriceNode(node));
        for (const node of nodes) {
          const parsed = parsePriceNode(node);
          if (parsed) return parsed;
        }
      }
      const selectedVariationPrice = getSelectedVariationPrice();
      if (selectedVariationPrice) return selectedVariationPrice;
      const root = getPriceRoot();
      const info = findPriceInCard(root || document.body, { defaultCurrency: "$" });
      return info && Number.isFinite(Number(info.price)) ? { price: Number(info.price), currency: info.currency || "$", text: root?.textContent || "" } : null;
    };
    const getCardPid = (card) => {
      if (!card) return "";
      const attrs = [
        card.getAttribute("data-asin"),
        card.getAttribute("data-csa-c-asin"),
        card.getAttribute("data-csa-c-item-id"),
        card.querySelector("[data-asin]")?.getAttribute("data-asin"),
        card.querySelector("[data-csa-c-asin]")?.getAttribute("data-csa-c-asin"),
        card.querySelector("[data-csa-c-item-id]")?.getAttribute("data-csa-c-item-id")
      ];
      for (const value of attrs) {
        const asin = getAsinFromCsaItemId(value) || normalizeAsin(value);
        if (asin) return asin;
      }
      const link = card.querySelector('a[href*="/dp/"], a[href*="/gp/product/"], a[href*="pd_rd_i="], a[href*="asin="]');
      return getAsinFromHref(link?.getAttribute("href") || link?.href || "");
    };
    const getCardPrice = (card) => {
      if (!card) return null;
      const dataPrice = Number(String(card.getAttribute("data-price") || "").replace(",", "."));
      if (Number.isFinite(dataPrice) && dataPrice > 0) {
        const text = card.getAttribute("data-price") || "";
        return { price: dataPrice, currency: normalizeCurrency(detectCurrency(text) || "$"), text };
      }
      const selectors = [
        '.a-price:not(.a-text-price):not([data-a-strike="true"]) .a-offscreen',
        '.a-price[data-a-color="price"] .a-offscreen',
        ".dcl-product-price-new .a-offscreen",
        ".sc-apex-cart-price .a-price .a-offscreen",
        '[data-a-color="price"] .a-offscreen'
      ];
      for (const selector of selectors) {
        const nodes = [...card.querySelectorAll(selector)].filter((node) => !isOldPriceNode(node));
        for (const node of nodes) {
          const parsed = parsePriceNode(node);
          if (parsed) return parsed;
        }
      }
      const info = findPriceInCard(card, { defaultCurrency: "$" });
      return info && Number.isFinite(Number(info.price)) ? { price: Number(info.price), currency: info.currency || "$", text: card.textContent || "" } : null;
    };
    const isCardCandidate = (card) => {
      if (!card || !card.isConnected) return false;
      if (card.closest('#customerReviews, #reviewsMedley, [id*="review" i]')) return false;
      const rect = card.getBoundingClientRect();
      if ((rect.width || 0) < 90 || (rect.height || 0) < 90) return false;
      if (!card.querySelector("img, picture")) return false;
      return !!getCardPid(card);
    };
    const getBadgeTarget = (card) => {
      const image = card?.querySelector?.("img.s-image, .s-product-image-container img, .dcl-product-image-container img, img");
      let target = image?.closest?.(".sc-image-wrapper, .s-product-image-container, .dcl-product-image-container, .a-section.aok-relative, .a-carousel-card") || image?.parentElement || card;
      if (!target || !card.contains(target)) target = card;
      target.classList.remove("mp-min-price-anchor--below-center");
      target.classList.remove("mp-min-price-anchor--below");
      target.classList.remove("mp-min-price-anchor--photo");
      target.classList.add("mp-min-price-anchor--photo-inside");
      return target;
    };
    const detectCurrentProduct = () => {
      const pid = getPid();
      if (!pid) return null;
      const priceInfo = getPagePrice();
      return {
        market: "amazon",
        pid,
        pidKey: `amazon:${pid}`,
        currency: priceInfo?.currency || "$"
      };
    };
    setCurrentProductDetector(detectCurrentProduct);
    startProductTracker({ market: "amazon", getPid, getPrice: getPagePrice, getAnchor, isProductPage });
    startCardScanner({
      collectGroups: () => collectGroupsFromCards({
        market: "amazon",
        cardSelector: [
          '[data-component-type="s-search-result"]',
          ".s-result-item[data-asin]",
          ".puis-card-container",
          ".sc-list-item[data-asin]",
          ".dcl-product-wrapper",
          '[data-csa-c-item-type="asin"]',
          '[data-csa-c-item-id*="asin."]',
          ".a-carousel-card"
        ].join(", "),
        getPid: getCardPid,
        getPrice: getCardPrice,
        isCardCandidate,
        defaultCurrency: "$"
      }),
      getBadgeTarget
    });
  })();
})();

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

  // src/content/exporter/ozon.js
  (() => {
    "use strict";
    const MP = window.MP;
    const Exporter = window.OWBExporter;
    if (!MP || !Exporter) return;
    const {
      sleep,
      slug,
      wait,
      ensureScrollTopButton,
      downloadTextFile,
      toBullets
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
    function initOzon() {
      ensureScrollTopButton();
      const clickVariantWhenReady = async (timeout = 2500) => {
        const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
        const isVisible = (el) => {
          if (!el || !el.isConnected || el.disabled || el.getAttribute("aria-disabled") === "true") return false;
          const rect = el.getBoundingClientRect();
          return (rect.width || 0) > 0 && (rect.height || 0) > 0;
        };
        const isSelected = (el) => {
          const raw = [
            el.getAttribute?.("aria-pressed") || "",
            el.getAttribute?.("aria-selected") || "",
            el.getAttribute?.("data-state") || "",
            el.getAttribute?.("class") || ""
          ].join(" ").toLowerCase();
          return /\b(true|selected|active|checked|current)\b/.test(raw);
        };
        const find = () => [...document.querySelectorAll('button,[role="button"],a')].map((el) => {
          const text = normalize(el.innerText || el.textContent || el.getAttribute?.("aria-label") || "");
          return { el, text };
        }).filter(({ el, text }) => {
          if (!text || !isVisible(el) || isSelected(el)) return false;
          if (!/(отзыв|review|вариант)/i.test(text)) return false;
          return /(?:этот|данный|текущ)\s+вариант|только\s+(?:этот|данный|текущ)|this\s+variant/i.test(text);
        }).sort((a, b) => {
          const aExact = /этот вариант товара|только этот вариант/i.test(a.text) ? 0 : 1;
          const bExact = /этот вариант товара|только этот вариант/i.test(b.text) ? 0 : 1;
          return aExact - bExact;
        })[0]?.el || null;
        const clickNode = async (node) => {
          if (!node) return false;
          try {
            node.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
          } catch (_) {
          }
          await sleep(80);
          const targets = [
            node,
            node.querySelector?.('button,[role="button"],a'),
            node.closest?.('button,[role="button"],a')
          ].filter(Boolean);
          for (const target of [...new Set(targets)]) {
            try {
              target.click();
            } catch (_) {
            }
            await sleep(80);
          }
          return true;
        };
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const btn = find();
          if (btn && await clickNode(btn)) return true;
          await sleep(180);
        }
        return false;
      };
      const getRecommendationsTopY = () => {
        const headingMarkers = [...document.querySelectorAll("h2, h3, h4")].filter((el) => /(рекомендуем|похожие товары|с этим товаром|вам может понравиться)/i.test(el.textContent || "")).map((el) => window.scrollY + el.getBoundingClientRect().top);
        const widgetMarkers = [...document.querySelectorAll('[data-widget*="recommend" i], [data-widget*="similar" i]')].map((el) => window.scrollY + el.getBoundingClientRect().top);
        const candidates = [...headingMarkers, ...widgetMarkers].filter((y) => Number.isFinite(y) && y > window.scrollY + 180).sort((a, b) => a - b);
        return candidates.length ? candidates[0] : Infinity;
      };
      const pickClosestForwardNode = (nodes, options = {}) => {
        const list = (nodes || []).filter(Boolean);
        if (!list.length) return null;
        const minDocY = Number.isFinite(Number(options.minDocY)) ? Number(options.minDocY) : Math.max(0, window.scrollY - Math.round(window.innerHeight * 0.75));
        const maxDocY = Number.isFinite(Number(options.maxDocY)) ? Number(options.maxDocY) : Infinity;
        const withPos = list.map((el) => ({ el, y: window.scrollY + el.getBoundingClientRect().top })).filter((x) => Number.isFinite(x.y));
        const below = withPos.filter((x) => x.y >= minDocY && x.y <= maxDocY).sort((a, b) => a.y - b.y);
        if (below.length) return below[0].el;
        return null;
      };
      const findReviewHeaderNode = () => {
        const maxDocY = getRecommendationsTopY();
        const direct = pickClosestForwardNode([
          ...document.querySelectorAll('[data-widget="webListReviews"], #section-reviews, [id*="section-reviews" i]')
        ], { maxDocY });
        if (direct) return direct;
        const byCard = pickClosestForwardNode([...document.querySelectorAll("[data-review-uuid]")], { maxDocY });
        return byCard ? byCard.closest("[data-widget], section, article, div") || byCard : null;
      };
      const findDescriptionSection = () => {
        const maxDocY = getRecommendationsTopY();
        const direct = pickClosestForwardNode([
          ...document.querySelectorAll('[data-widget="webDescription"], #section-description, [id*="section-description"]')
        ], { maxDocY });
        if (direct) return direct;
        return pickClosestForwardNode(
          [...document.querySelectorAll("h2, h3")].filter((n) => /^\s*(описание|о товаре)\s*$/i.test(n.textContent || "")),
          { maxDocY }
        );
      };
      const findCharacteristicsSection = () => {
        const maxDocY = getRecommendationsTopY();
        const direct = pickClosestForwardNode([
          ...document.querySelectorAll('#section-characteristics, [id*="section-characteristics" i], [data-widget="webCharacteristics"], [data-widget*="characteristics" i]')
        ], { maxDocY });
        if (direct) return direct;
        return pickClosestForwardNode(
          [...document.querySelectorAll("h2, h3")].filter((n) => /^\s*характеристик/i.test(n.textContent || "")),
          { maxDocY }
        );
      };
      const stepPageDown = async (stepRatio = 0.32, delay = 300, smoothScroll = true) => {
        const delta = Math.max(240, Math.round(window.innerHeight * stepRatio));
        if (smoothScroll) {
          window.scrollBy({ top: delta, behavior: "smooth" });
        } else {
          window.scrollBy(0, delta);
        }
        await sleep(delay);
      };
      const scrollToElementProgressive = async (el, options = {}) => {
        if (!el) return;
        const block = options.block || "start";
        const rect = el.getBoundingClientRect();
        const topThreshold = Math.round(window.innerHeight * 0.12);
        const bottomThreshold = Math.round(window.innerHeight * 0.88);
        if (rect.top >= topThreshold && rect.bottom <= bottomThreshold) return;
        el.scrollIntoView({ behavior: "smooth", block, inline: "nearest" });
        await sleep(Number(options.settleMs) || 220);
      };
      const restoreCardFocus = async () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
        await sleep(240);
      };
      setRestoreFocus(restoreCardFocus);
      const findWithPageScroll = async (finder, options = {}) => {
        const maxSteps = Number(options.maxSteps) || 24;
        const stepRatio = Number(options.stepRatio) || 0.32;
        const delay = Number(options.delay) || 300;
        let node = finder();
        for (let i = 0; !node && i < maxSteps; i += 1) {
          await stepPageDown(stepRatio, delay, true);
          node = finder();
        }
        return node || null;
      };
      const gotoSection = async (finder, options = {}) => {
        const node = await findWithPageScroll(finder, options);
        if (!node) return null;
        await scrollToElementProgressive(node, {
          block: options.block || "center",
          stepRatio: options.stepRatio || 0.45,
          delay: options.delay || 180,
          maxHops: options.maxHops || 20,
          settleMs: options.settleMs || 240
        });
        return node;
      };
      const parseRatingValue = (text) => {
        const m = String(text || "").replace(",", ".").match(/\b([0-5](?:\.\d)?)\b/);
        return m ? m[1] : "\u2014";
      };
      const parseCount = (text) => {
        const m = String(text || "").replace(/\u00A0/g, " ").match(/(\d[\d\s]{0,8})\s*(оцен|отзыв)/i);
        if (!m) return 0;
        return parseInt(m[1].replace(/\s+/g, ""), 10) || 0;
      };
      const clickExpandButtons = (root) => {
        if (!root) return;
        [...root.querySelectorAll('button, a, [role="button"]')].forEach((el) => {
          const t = (el.textContent || "").toLowerCase().trim();
          if (/ещё|еще|показать|развернуть|подробнее|читать полностью|more|show/i.test(t)) el.click();
        });
      };
      const getScrollableCandidates = (root) => {
        if (!root) return [];
        const all = [root, ...root.querySelectorAll("*")];
        return all.filter((el) => {
          const max = el.scrollHeight - el.clientHeight;
          if (max <= 90) return false;
          const style = getComputedStyle(el);
          const overflowY = String(style.overflowY || "").toLowerCase();
          return /(auto|scroll|overlay)/.test(overflowY) || max > 400;
        }).sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight)).slice(0, 8);
      };
      const scrollInsideElement = async (el) => {
        if (!el) return;
        const max = el.scrollHeight - el.clientHeight;
        if (max <= 20) return;
        const step = Math.max(140, Math.floor(el.clientHeight * 0.6));
        for (let y = 0; y <= max; y += step) {
          el.scrollTo({ top: y, behavior: "auto" });
          await sleep(130);
        }
        el.scrollTo({ top: max, behavior: "auto" });
      };
      async function collectInfo() {
        window.scrollTo({ top: 0, behavior: "auto" });
        await sleep(180);
        const url = location.href;
        const heading = await wait('[data-widget="webProductHeading"]', 12e3).catch(() => null);
        const title = heading?.querySelector("h1")?.innerText.trim() || document.querySelector("h1")?.innerText.trim() || "\u2014";
        const normalizeQuotes = (value) => String(value || "").replace(/[`´‘’‛ʼʻʹʽꞌ＇]/g, "'").replace(/[“”„«»]/g, '"');
        const clean = (value) => normalizeQuotes(value).replace(/\s+/g, " ").trim();
        const normalizeForCompare = (value) => clean(value).toLowerCase().replace(/['"]/g, "").replace(/[^a-zа-яё0-9]+/gi, " ").trim();
        const normalizeEntityText = (value) => clean(value).replace(/\s*Бренд\s*•.*$/i, "").replace(/\s*Витрина бренда.*$/i, "").replace(/\s*О магазине.*$/i, "").replace(/\s*Подписаться.*$/i, "").replace(/\s*Перейти.*$/i, "").trim();
        const isMissing = (value) => !value || value === "\u2014";
        const isNoiseValue = (value) => {
          const t = clean(value);
          if (!t) return true;
          if (/^(бренд|магазин|подписаться|перейти|о магазине|оригинал|все товары|перейти к описанию|заказы|чат|подтвержд[её]нные бренды)$/i.test(t)) return true;
          if (/бренд\s*•|витрина бренда|подписаться|о магазине|перейти к|подтвержд[её]нные бренды/i.test(t)) return true;
          return false;
        };
        const isValidEntity = (value) => {
          const t = normalizeEntityText(value);
          if (!t || isNoiseValue(t)) return false;
          if (!/[a-zа-яё]/i.test(t)) return false;
          if (t.length > 60) return false;
          return true;
        };
        const normalizeFactLabel = (value) => clean(value).replace(/[:\s]+$/, "").trim();
        const getDescriptionFactRows = (maxDocY = Infinity) => {
          const rows = [];
          const nodes = [...document.querySelectorAll('[data-widget="webDescription"], #section-description, [id*="section-description"]')];
          const roots = [...new Set(nodes.map((node) => node.closest('[data-widget="webDescription"]') || node).filter((node) => {
            const y = window.scrollY + node.getBoundingClientRect().top;
            return Number.isFinite(y) && y <= maxDocY;
          }))];
          roots.forEach((root) => {
            root.querySelectorAll("h3").forEach((h) => {
              const k = normalizeFactLabel(h.innerText || h.textContent || "");
              if (!k || /^(описание|о товаре|характеристики)$/i.test(k)) return;
              let next = h.nextElementSibling;
              while (next && /^script|style$/i.test(next.tagName || "")) {
                next = next.nextElementSibling;
              }
              const v = clean(next?.innerText || next?.textContent || "");
              if (v && k !== v && v.length <= 2e3) rows.push(`${k}: ${v}`);
            });
          });
          return rows;
        };
        const textOf = (el) => clean(el?.innerText || el?.textContent || "");
        const getDescriptionRoot = (section) => {
          if (!section) return null;
          return section.closest?.('[data-widget="webDescription"]') || section.querySelector?.('[data-widget="webDescription"]') || section.closest?.('#section-description, [id*="section-description"]') || section.querySelector?.('#section-description, [id*="section-description"]') || section;
        };
        const extractDescriptionFromRoot = (root) => {
          if (!root) return { text: "", images: [] };
          const scope = root.querySelector?.('#section-description, [id*="section-description"]') || root;
          const candidates = [
            ...scope.querySelectorAll?.("p, [class], div") || []
          ].map((el) => ({ el, text: textOf(el) })).filter(({ el, text: text2 }) => {
            if (!text2 || text2.length < 30) return false;
            if (el.matches?.("h1, h2, h3, h4, button, a")) return false;
            if (el.closest?.('[data-widget="webHashtags"], [data-widget="tagList"]')) return false;
            if (/^Описание$/i.test(text2) || /^О товаре$/i.test(text2)) return false;
            return true;
          }).sort((a, b) => b.text.length - a.text.length);
          const rawText = candidates[0]?.text || textOf(scope);
          const text = rawText.replace(/^\s*Описание\s*/i, "").replace(/^\s*О\s*товаре\s*/i, "").replace(/\n{3,}/g, "\n\n").trim();
          const images = [...scope.querySelectorAll?.("img[src], img[data-src], source[srcset]") || []].map((img) => img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("srcset") || "").map((raw) => String(raw || "").split(/\s+/)[0].trim()).filter(Boolean);
          return { text, images: [...new Set(images)] };
        };
        const findLoadedDescriptionRoot = () => getDescriptionRoot(document.querySelector(
          '[data-widget="webDescription"], #section-description, [id*="section-description"]'
        ));
        const getCharacteristicsRoot = (section) => {
          if (!section) return null;
          const direct = section.closest?.('[data-widget="webCharacteristics"], #section-characteristics, [id*="section-characteristics" i]') || section.querySelector?.('[data-widget="webCharacteristics"], #section-characteristics, [id*="section-characteristics" i]');
          if (direct) return direct;
          let cur = section;
          for (let i = 0; cur && i < 6; i += 1, cur = cur.parentElement) {
            if (cur.querySelector?.("dl dt, dl dd, tr th, tr td")) return cur;
          }
          return section;
        };
        const readCharacteristicsRows = (root) => {
          if (!root) return { rows: [], brandFromChars: "" };
          const rows = [];
          let brandValue = "";
          root.querySelectorAll("dl").forEach((dl) => {
            const k = normalizeFactLabel(dl.querySelector("dt")?.innerText || dl.querySelector("dt")?.textContent || "");
            const v = textOf(dl.querySelector("dd"));
            if (k && v) rows.push(`${k}: ${v}`);
            if (!brandValue && /^бренд$/i.test(k) && isValidEntity(v)) {
              brandValue = normalizeEntityText(v);
            }
          });
          root.querySelectorAll("tr").forEach((tr) => {
            const k = normalizeFactLabel(tr.querySelector("th, td:first-child")?.innerText || tr.querySelector("th, td:first-child")?.textContent || "");
            const v = textOf(tr.querySelector("td:last-child"));
            if (k && v && k !== v) rows.push(`${k}: ${v}`);
            if (!brandValue && /^бренд$/i.test(k) && isValidEntity(v)) {
              brandValue = normalizeEntityText(v);
            }
          });
          return { rows, brandFromChars: brandValue };
        };
        const findLoadedCharacteristicsRoot = () => getCharacteristicsRoot(document.querySelector(
          '[data-widget="webCharacteristics"], #section-characteristics, [id*="section-characteristics" i], [data-widget*="characteristics" i]'
        ));
        const scoreEntityNode = (el, text, hint = "") => {
          const cls = String(el?.className || "").toLowerCase();
          const href = String(el?.getAttribute?.("href") || "").toLowerCase();
          let score = 0;
          if (hint === "brand" && /\/brand\//.test(href)) score += 60;
          if (hint === "shop" && /\/(seller|shop|store|brand)\//.test(href)) score += 50;
          if (/seller|shop|store|brand|b35_3_22-b7|compactcontrol500|control500/.test(cls)) score += 30;
          if (/^[A-ZА-ЯЁ0-9 .&'`_-]+$/u.test(text)) score += 12;
          const words = text.split(/\s+/).length;
          if (words <= 3) score += 8;
          if (words > 6) score -= 20;
          if (/подпис|перейти|оригинал|бренд\s*•|витрина|заказы|чат|достав|в корзин/i.test(text)) score -= 60;
          return score;
        };
        const pickBestEntityText = (nodes, hint = "") => {
          const candidates = (nodes || []).map((el) => {
            const text = normalizeEntityText(el?.textContent || el?.innerText || "");
            return { el, text };
          }).filter((x) => isValidEntity(x.text)).map((x) => ({ ...x, score: scoreEntityNode(x.el, x.text, hint) })).sort((a, b) => b.score - a.score || a.text.length - b.text.length);
          return candidates[0]?.text || "";
        };
        const getBrandFromHeaderBlock = () => {
          const bwrap = document.querySelector('[data-widget="webBrand"]');
          if (!bwrap) return "";
          const fromBrandLink = pickBestEntityText([...bwrap.querySelectorAll('a[href*="/brand/"]')], "brand");
          if (fromBrandLink) return fromBrandLink;
          const fromNodes = pickBestEntityText(
            [...bwrap.querySelectorAll('[class*="CompactControl500" i], [class*="Control500" i], [class*="title" i], span, a')],
            "brand"
          );
          if (fromNodes) return fromNodes;
          const href = bwrap.querySelector('a[href*="/brand/"]')?.getAttribute("href") || "";
          const slugMatch = href.match(/\/brand\/([^/?#]+)/i);
          if (!slugMatch?.[1]) return "";
          let fromSlug = slugMatch[1].replace(/-\d+$/, "").replace(/-/g, " ").trim();
          if (/^[a-z0-9 ]+$/i.test(fromSlug) && fromSlug.split(/\s+/).length <= 3) {
            fromSlug = fromSlug.toUpperCase();
          }
          return fromSlug;
        };
        const getBrandFromMeta = () => clean(
          document.querySelector('meta[itemprop="brand"]')?.getAttribute("content") || document.querySelector('meta[name="brand"]')?.getAttribute("content") || ""
        );
        const getBrandFromBreadcrumbByTitle = () => {
          const titleNorm = normalizeForCompare(title);
          if (!titleNorm) return "";
          const crumbs = [...document.querySelectorAll('[data-widget="breadCrumbs"] li span')].map((n) => clean(n.textContent || "")).filter((t) => isValidEntity(t));
          for (let i = crumbs.length - 1; i >= 0; i -= 1) {
            const candidate = crumbs[i];
            const candNorm = normalizeForCompare(candidate);
            if (!candNorm || candNorm.length < 3) continue;
            if (titleNorm.includes(candNorm)) return candidate;
          }
          return "";
        };
        const getShopName = () => {
          const bySellerWidget = pickBestEntityText([
            ...document.querySelectorAll('[data-widget*="seller" i] a, [data-widget*="seller" i] [class*="name" i], [data-widget*="shop" i] a, [class*="sellerInfo" i] a, [class*="sellerInfo" i] [class*="name" i]')
          ]);
          if (bySellerWidget) return bySellerWidget;
          const shopHeader = [...document.querySelectorAll("h2, h3, span, div")].find((el) => /^магазин$/i.test(clean(el.textContent || "")));
          if (!shopHeader) return "";
          const base = shopHeader.closest("div") || shopHeader.parentElement;
          const scopes = [];
          if (base) {
            scopes.push(base);
            if (base.parentElement) scopes.push(base.parentElement);
            let sib = base.nextElementSibling;
            for (let i = 0; sib && i < 5; i += 1) {
              scopes.push(sib);
              sib = sib.nextElementSibling;
            }
            if (base.parentElement?.nextElementSibling) scopes.push(base.parentElement.nextElementSibling);
          }
          for (const scope of [...new Set(scopes.filter(Boolean))]) {
            const fromScope = pickBestEntityText([
              ...scope.querySelectorAll('a[href*="/seller/"], a[href*="/shop/"], a[href*="/store/"], a[href*="/brand/"]'),
              ...scope.querySelectorAll('[class*="b35_3_22-b7" i], [class*="seller" i] [class*="name" i], [class*="shop" i] [class*="name" i], span, a')
            ], "shop");
            if (fromScope) return fromScope;
          }
          return "";
        };
        let brand = getBrandFromHeaderBlock() || getBrandFromMeta() || "";
        if (isMissing(brand)) brand = getBrandFromBreadcrumbByTitle() || "";
        let shop = getShopName() || "\u2014";
        const origMark = document.querySelector('[data-widget="webBrand"] svg path[fill]') ? "\u0414\u0430" : "\u2014";
        const pWrap = await wait('[data-widget="webPrice"]', 12e3).catch(() => null);
        const priceNode = [...pWrap?.querySelectorAll("span, div") || []].find((el) => /[₽$€]/.test(el.textContent || "") && /\d/.test(el.textContent || ""));
        const price = priceNode?.innerText.replace(/\s+/g, " ").trim() || "\u2014";
        const unit = [...pWrap?.querySelectorAll("div, span") || []].map((d) => (d.innerText || "").trim()).find((t) => /за\s*\d*\s*(шт|г|гр|кг|мл|л)\b/i.test(t)) || "";
        const scoreNode = document.querySelector('[data-widget="webSingleProductScore"], [data-widget="webReviewScore"], [itemprop="aggregateRating"]');
        const avgRating = parseRatingValue(
          document.querySelector('[itemprop="ratingValue"]')?.textContent || scoreNode?.textContent || heading?.textContent || ""
        );
        const reviewsTotal = parseCount(
          document.querySelector('[itemprop="reviewCount"]')?.textContent || scoreNode?.textContent || heading?.textContent || ""
        );
        let desc = "\u2014";
        const descSection = await gotoSection(
          () => findDescriptionSection(),
          { maxSteps: 10, stepRatio: 0.32, delay: 280, settleMs: 220, block: "start" }
        );
        if (descSection) {
          const descRoot = getDescriptionRoot(descSection);
          clickExpandButtons(descRoot);
          await sleep(260);
          const scrollables = getScrollableCandidates(descRoot);
          for (const sc of scrollables) await scrollInsideElement(sc);
          const { text, images: uniqImages } = extractDescriptionFromRoot(descRoot);
          if (text && text.length >= 30) {
            desc = text;
            if (uniqImages.length >= 3) {
              desc += `

[\u0418\u043B\u043B\u044E\u0441\u0442\u0440\u0430\u0446\u0438\u0438 longread: ${uniqImages.length} \u0448\u0442.]`;
            }
          } else if (uniqImages.length) {
            const shown = uniqImages.slice(0, 30).map((u) => `- ${u}`);
            desc = `\u041B\u043E\u043D\u0433\u0440\u0438\u0434-\u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0432 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F\u0445 (${uniqImages.length} \u0448\u0442.):
${shown.join("\n")}`;
          }
        }
        if (isMissing(desc)) {
          const { text, images: uniqImages } = extractDescriptionFromRoot(findLoadedDescriptionRoot());
          if (text && text.length >= 30) {
            desc = text;
          } else if (uniqImages.length) {
            const shown = uniqImages.slice(0, 30).map((u) => `- ${u}`);
            desc = `\u041B\u043E\u043D\u0433\u0440\u0438\u0434-\u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0432 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F\u0445 (${uniqImages.length} \u0448\u0442.):
${shown.join("\n")}`;
          }
        }
        let chars = "\u2014";
        let brandFromChars = "";
        let cSec = await gotoSection(
          () => findCharacteristicsSection(),
          { maxSteps: 22, stepRatio: 0.32, delay: 280, settleMs: 240, block: "start" }
        );
        if (cSec) {
          const parsed = readCharacteristicsRows(getCharacteristicsRoot(cSec));
          const rows = parsed.rows;
          brandFromChars = parsed.brandFromChars;
          rows.push(...getDescriptionFactRows(window.scrollY + cSec.getBoundingClientRect().top));
          const uniqRows = [...new Set(rows.filter(Boolean))];
          if (uniqRows.length) chars = uniqRows.join("\n");
        } else {
          const descFactRows = [...new Set(getDescriptionFactRows(getRecommendationsTopY()).filter(Boolean))];
          if (descFactRows.length) chars = descFactRows.join("\n");
        }
        if (isMissing(chars)) {
          const parsed = readCharacteristicsRows(findLoadedCharacteristicsRoot());
          if (!brandFromChars) brandFromChars = parsed.brandFromChars;
          const uniqRows = [...new Set(parsed.rows.filter(Boolean))];
          if (uniqRows.length) chars = uniqRows.join("\n");
        }
        if (isMissing(brand) && brandFromChars) brand = brandFromChars;
        brand = normalizeEntityText(brand);
        shop = normalizeEntityText(shop);
        if (!isValidEntity(brand)) brand = "\u2014";
        if (!isValidEntity(shop)) shop = "\u2014";
        return { url, title, brand, shop, origMark, price, unit, avgRating, reviewsTotal, desc, chars };
      }
      async function loadReviews(max = 100, opts = {}) {
        const switchToVariant = opts.switchToVariant === true;
        const avgFromInfo = opts.avgRating || "\u2014";
        const declaredFromInfo = Number(opts.reviewsTotal) || 0;
        const noProgressTimeoutMs = 3e3;
        const reviewHeaderNode = await gotoSection(
          () => findReviewHeaderNode(),
          { maxSteps: 32, stepRatio: 0.34, delay: 280, settleMs: 260, block: "start" }
        );
        if (!reviewHeaderNode) return { header: `\u041E\u0442\u0437\u044B\u0432\u044B: \u043D\u0435\u0442 \u043E\u0442\u0437\u044B\u0432\u043E\u0432. \u0421\u0440\u0435\u0434\u043D\u044F\u044F \u043E\u0446\u0435\u043D\u043A\u0430: ${avgFromInfo}`, items: [] };
        const reviewSectionSelector = '[data-widget="webListReviews"], #section-reviews, [id*="section-reviews" i]';
        const reviewNodesSelector = "[data-review-uuid], [data-review-id]";
        const resolveReviewSection = (seed = null) => {
          const rooted = seed?.closest(reviewSectionSelector) || seed || null;
          const candidates = [...document.querySelectorAll(reviewSectionSelector)];
          const scored = candidates.map((el) => ({
            el,
            count: el.querySelectorAll(reviewNodesSelector).length,
            top: Math.abs(el.getBoundingClientRect().top)
          })).sort((a, b) => b.count - a.count || a.top - b.top);
          if (scored.length && scored[0].count > 0) return scored[0].el;
          return rooted || null;
        };
        let reviewSection = resolveReviewSection(reviewHeaderNode);
        if (!reviewSection) return { header: `\u041E\u0442\u0437\u044B\u0432\u044B: \u043D\u0435\u0442 \u043E\u0442\u0437\u044B\u0432\u043E\u0432. \u0421\u0440\u0435\u0434\u043D\u044F\u044F \u043E\u0446\u0435\u043D\u043A\u0430: ${avgFromInfo}`, items: [] };
        await sleep(160);
        if (switchToVariant) {
          const switched = await clickVariantWhenReady();
          if (!switched) console.warn("[OWB] Ozon variant reviews switch button was not found");
          await sleep(switched ? 240 : 80);
        }
        reviewSection = resolveReviewSection(reviewSection) || reviewSection;
        const refreshReviewSection = () => {
          const direct = resolveReviewSection(reviewSection);
          if (direct) {
            reviewSection = direct;
            return reviewSection;
          }
          const fallback = document.querySelector(reviewSectionSelector);
          if (fallback) {
            reviewSection = fallback;
            return reviewSection;
          }
          return reviewSection;
        };
        const declared = parseCount(reviewSection.textContent || "") || declaredFromInfo;
        const requestedMax = Number.isFinite(Number(max)) ? Math.max(1, Math.floor(Number(max))) : 100;
        const targetCount = Math.min(100, requestedMax);
        const moreBtn = () => {
          const roots = [refreshReviewSection(), document];
          for (const root of roots) {
            if (!root) continue;
            const found = [...root.querySelectorAll('button, [role="button"], a[role="button"], a')].find((b) => {
              const text = (b.innerText || "").toLowerCase();
              const r = b.getBoundingClientRect();
              if (r.bottom < 0 || r.top > window.innerHeight) return false;
              if (!/(ещё|еще|показать|следующ|загрузить|больше|more)/i.test(text)) return false;
              if (!/(отзыв|коммент|review)/i.test(text)) return false;
              return true;
            });
            if (found) return found;
          }
          return null;
        };
        const isLikelyRatingSvg = (svg) => {
          if (!svg) return false;
          const path = svg.querySelector("path");
          const width = Number(svg.getAttribute("width") || 0);
          const height = Number(svg.getAttribute("height") || 0);
          const viewBox = String(svg.getAttribute("viewBox") || "").trim();
          const raw = [
            svg.getAttribute("style") || "",
            svg.getAttribute("color") || "",
            svg.style?.color || "",
            path?.getAttribute("fill") || "",
            path?.getAttribute("style") || ""
          ].join(" ").toLowerCase();
          if (/graphicrating|graphictertiary|graphicneutral|disabled/.test(raw)) return true;
          if (width === 20 && height === 20 && viewBox === "0 0 24 24") return true;
          const d = String(path?.getAttribute("d") || "").replace(/\s+/g, "");
          if (d.startsWith("M9.3586.136C10.53")) return true;
          return d.includes("2.6433.136") && d.includes("3.8421.457");
        };
        const isFilledStarSvg = (svg) => {
          if (!svg) return null;
          if (!isLikelyRatingSvg(svg)) return null;
          const path = svg.querySelector("path");
          const raw = [
            svg.getAttribute("style") || "",
            svg.getAttribute("color") || "",
            svg.style?.color || "",
            path?.getAttribute("fill") || "",
            path?.getAttribute("style") || ""
          ].join(" ").toLowerCase();
          if (raw.includes("graphicrating")) return true;
          if (raw.includes("graphictertiary") || raw.includes("graphicneutral") || raw.includes("disabled")) return false;
          const computed = getComputedStyle(svg).color || "";
          const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
          if (m) {
            const r = Number(m[1]);
            const g = Number(m[2]);
            const b = Number(m[3]);
            if (r > 150 && g > 120 && b < 140) return true;
            if (Math.abs(r - g) < 18 && Math.abs(g - b) < 18) return false;
          }
          return null;
        };
        const parseRatingFromStarsContainer = (container) => {
          if (!container) return null;
          const stars = [...container.querySelectorAll(":scope > svg")].filter((svg) => isLikelyRatingSvg(svg)).slice(0, 5);
          if (!stars.length || stars.length > 5) return null;
          let filled = 0;
          let unknown = 0;
          stars.forEach((svg) => {
            const state = isFilledStarSvg(svg);
            if (state === true) filled += 1;
            else if (state === null) unknown += 1;
          });
          if (filled >= 1 && filled <= 5) return String(filled);
          if (filled === 0 && unknown > 0 && stars.length >= 1 && stars.length <= 5) return String(stars.length);
          return null;
        };
        const getRatingContainers = (n) => {
          const preferredRoots = [
            n.querySelector('[class*="vk0_"]'),
            n.querySelector('[class*="rating" i]'),
            n.querySelector('[aria-label*="\u0440\u0435\u0439\u0442\u0438\u043D\u0433" i]'),
            n
          ].filter(Boolean);
          const out = [];
          preferredRoots.forEach((root) => {
            [...root.querySelectorAll("div, span")].filter((el) => {
              const svgs = el.querySelectorAll(":scope > svg");
              if (!svgs.length || svgs.length > 5) return false;
              return [...svgs].every((svg) => isLikelyRatingSvg(svg));
            }).forEach((el) => out.push(el));
          });
          return [...new Set(out)];
        };
        const extractReviewRating = (n) => {
          const data = n.getAttribute("data-rate") || n.getAttribute("data-rating") || "";
          if (/^[0-5](?:[.,]\d)?$/.test(String(data).trim())) return String(data).replace(",", ".");
          const aria = n.querySelector('[aria-label*="\u0438\u0437 5" i], [aria-label*="/5"]')?.getAttribute("aria-label") || "";
          const ariaMatch = aria.match(/([0-5](?:[.,]\d)?)/);
          if (ariaMatch) return ariaMatch[1].replace(",", ".");
          const directFilled = n.querySelectorAll('svg[style*="graphicRating" i]').length;
          if (directFilled >= 1 && directFilled <= 5) return String(directFilled);
          const containers = getRatingContainers(n);
          for (const container of containers) {
            const parsed = parseRatingFromStarsContainer(container);
            if (parsed) return parsed;
          }
          const allLikelyStars = [...n.querySelectorAll("svg")].filter((svg) => isLikelyRatingSvg(svg));
          if (allLikelyStars.length >= 1 && allLikelyStars.length <= 5) return String(allLikelyStars.length);
          const textMatch = (n.textContent || "").match(/\b([1-5](?:[.,]\d)?)\s*(?:из\s*5|\/\s*5|★)/i);
          if (textMatch) return textMatch[1].replace(",", ".");
          return "\u2014";
        };
        const getDate = (n) => {
          const attrNode = n.getAttribute("publishedat") || n.getAttribute("publishedAt") || n.querySelector("[publishedat]")?.getAttribute("publishedat") || n.querySelector("[datetime]")?.getAttribute("datetime") || n.querySelector("time")?.getAttribute("datetime");
          if (attrNode) {
            if (/^\d{10,13}$/.test(attrNode)) {
              const ms = attrNode.length === 13 ? +attrNode : +attrNode * 1e3;
              return new Date(ms).toLocaleDateString("ru-RU");
            }
            const iso = attrNode.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
            if (iso) {
              const [y, m, d] = iso.split("-");
              return `${d}.${m}.${y}`;
            }
          }
          const maybe = [...n.querySelectorAll("div, span, time")].map((el) => el.textContent.trim().match(/\d{1,2}\s+\D+\s+\d{4}|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}/)?.[0]).find(Boolean);
          return maybe || "\u2014";
        };
        const getText = (n) => {
          const findPart = (label) => {
            const h = [...n.querySelectorAll("div, span, p")].find((el) => (el.textContent || "").trim().toLowerCase() === label);
            return h ? h.parentElement?.querySelector("span, div, p")?.innerText.trim() : "";
          };
          const looksLikeAuthorName = (raw) => {
            const t = String(raw || "").replace(/\s+/g, " ").trim();
            if (!t) return false;
            if (/[!?;:]/.test(t)) return false;
            if (/\d/.test(t)) return false;
            if (t.length > 40) return false;
            if (/^[A-ZА-ЯЁ][a-zа-яё]{1,24}\s+[A-ZА-ЯЁ]\.$/u.test(t)) return true;
            if (/^[A-ZА-ЯЁ][a-zа-яё]{1,24}(?:\s+[A-ZА-ЯЁ][a-zа-яё]{1,24}){1,2}$/u.test(t)) return true;
            if (/^[A-ZА-ЯЁ][a-zа-яё]{1,24}$/u.test(t)) return true;
            return false;
          };
          const pros = findPart("\u0434\u043E\u0441\u0442\u043E\u0438\u043D\u0441\u0442\u0432\u0430");
          const cons = findPart("\u043D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043A\u0438");
          const comment = findPart("\u043A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439");
          const parts = [];
          if (pros) parts.push(`\u0414\u043E\u0441\u0442\u043E\u0438\u043D\u0441\u0442\u0432\u0430: ${pros}`);
          if (cons) parts.push(`\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043A\u0438: ${cons}`);
          if (comment) parts.push(`\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439: ${comment}`);
          if (parts.length) return parts.join("; ");
          const looksLikeDate = (t) => /^(\d{1,2}[.\/\-]\d{1,2}([.\/\-]\d{2,4})?|\d{1,2}\s+[а-яё]+\s+\d{4})$/i.test(t);
          const span = n.querySelector('span.ro5_30, span[class*="ro5_"]');
          if (span) {
            const t = span.innerText.trim();
            if (t && !looksLikeDate(t) && !looksLikeAuthorName(t)) return t;
          }
          const bodyNode = n.querySelector('[class*="vk1_"], [class*="review-text"], [class*="comment"]');
          if (bodyNode) {
            const bodyText = bodyNode.innerText.trim();
            if (bodyText && bodyText.length >= 8 && !looksLikeAuthorName(bodyText)) return bodyText;
          }
          const BAD = /Вам помог|Размер|Цвет|коммент|вопрос|ответ|Похожие|Да \d+|Нет \d+|покупатель|пользователь/i;
          const leaves = [...n.querySelectorAll("span, div, p")].filter((el) => !el.children.length && !BAD.test(el.innerText));
          const texts = leaves.map((el) => el.innerText.trim()).filter((t) => t.length >= 8 && !looksLikeDate(t) && !looksLikeAuthorName(t));
          texts.sort((a, b) => b.length - a.length);
          return texts[0] || "\u2014";
        };
        const collected = /* @__PURE__ */ new Map();
        const getNodeId = (n) => n?.getAttribute("data-review-uuid") || n?.getAttribute("data-review-id") || n?.getAttribute("id") || "";
        const upsertFromNode = (n) => {
          if (!n) return false;
          const uuid = getNodeId(n);
          if (!uuid) return false;
          const next = {
            uuid,
            date: getDate(n),
            ratingText: extractReviewRating(n),
            text: getText(n).replace(/\s+/g, " "),
            order: Number.isFinite(collected.get(uuid)?.order) ? collected.get(uuid).order : collected.size
          };
          if (!next.text || next.text === "\u2014") next.text = "\u0411\u0435\u0437 \u0442\u0435\u043A\u0441\u0442\u0430";
          const prev = collected.get(uuid);
          if (!prev) {
            if (collected.size >= targetCount) return false;
            collected.set(uuid, next);
            return true;
          }
          const preferRating = prev.ratingText === "\u2014" && next.ratingText !== "\u2014";
          const preferText = (prev.text || "").length < (next.text || "").length;
          const preferDate = prev.date === "\u2014" && next.date !== "\u2014";
          if (preferRating || preferText || preferDate) {
            collected.set(uuid, { ...prev, ...next, order: prev.order });
          }
          return false;
        };
        const getOrderedReviewNodes = () => {
          const seen = /* @__PURE__ */ new Set();
          const nodes2 = [...document.querySelectorAll(reviewNodesSelector)].filter((n) => {
            const id = getNodeId(n);
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
          }).sort((a, b) => {
            const ay = window.scrollY + a.getBoundingClientRect().top;
            const by = window.scrollY + b.getBoundingClientRect().top;
            return ay - by;
          });
          return nodes2;
        };
        const collectNow = () => {
          refreshReviewSection();
          const before = collected.size;
          const nodes2 = getOrderedReviewNodes();
          for (const n of nodes2) {
            upsertFromNode(n);
            if (collected.size >= targetCount) break;
          }
          return { nodes: nodes2, added: collected.size - before };
        };
        const scrollStep = async (waitMs = 160) => {
          refreshReviewSection();
          const nodes2 = getOrderedReviewNodes();
          const lastNode = nodes2.length ? nodes2[nodes2.length - 1] : null;
          const anchor = lastNode || reviewSection;
          if (anchor && typeof anchor.scrollIntoView === "function") {
            anchor.scrollIntoView({ behavior: "auto", block: "end", inline: "nearest" });
          }
          await sleep(waitMs);
        };
        const waitForNewReviews = async (timeoutMs = noProgressTimeoutMs, pollMs = 250) => {
          const startedCount = collected.size;
          const startedAt = Date.now();
          while (Date.now() - startedAt < timeoutMs) {
            await sleep(pollMs);
            const { added } = collectNow();
            if (collected.size > startedCount || added > 0) return true;
          }
          return false;
        };
        collectNow();
        let safetyLoops = 0;
        let staleLoops = 0;
        while (collected.size < targetCount && safetyLoops < 260) {
          safetyLoops += 1;
          const { added } = collectNow();
          if (collected.size >= targetCount) break;
          if (added > 0) {
            staleLoops = 0;
            await scrollStep(140);
            continue;
          }
          const btn = moreBtn();
          if (btn) {
            btn.click();
            const loadedAfterWait = await waitForNewReviews(noProgressTimeoutMs, 250);
            if (loadedAfterWait) {
              staleLoops = 0;
              await scrollStep(140);
              continue;
            }
            staleLoops += 1;
            if (staleLoops >= 2) break;
            await scrollStep(180);
            continue;
          }
          await scrollStep(140);
          const loadedAfterNudge = await waitForNewReviews(700, 250);
          if (loadedAfterNudge) {
            staleLoops = 0;
            continue;
          }
          staleLoops += 1;
          if (staleLoops >= 2) break;
          continue;
        }
        collectNow();
        const nodes = [...collected.values()].sort((a, b) => a.order - b.order).slice(0, targetCount);
        const ratings = [];
        const items = nodes.map((row, i) => {
          const ratingNum = Number(String(row.ratingText).replace(",", "."));
          if (Number.isFinite(ratingNum) && ratingNum > 0) ratings.push(ratingNum);
          return `\u041E\u0442\u0437\u044B\u0432 ${i + 1} (${row.date}): ${row.ratingText}\u2605; ${row.text}`;
        });
        const avgFromReviews = ratings.length ? (ratings.reduce((s, x) => s + x, 0) / ratings.length).toFixed(2) : "";
        const avg = avgFromInfo !== "\u2014" ? avgFromInfo : avgFromReviews || "\u2014";
        const declaredShown = Math.max(Number(declared) || 0, items.length);
        const header = `\u041E\u0442\u0437\u044B\u0432\u044B (\u0432\u044B\u0433\u0440\u0443\u0436\u0435\u043D\u043E ${items.length}${declaredShown ? ` \u0438\u0437 ${declaredShown}` : ""}, \u0441\u0440\u0435\u0434\u043D\u044F\u044F \u043E\u0446\u0435\u043D\u043A\u0430: ${avg})`;
        return { header, items };
      }
      const buildOzonText = (info, rev = null) => {
        const out = [
          "=== CARD SUMMARY (OZON) ===",
          `URL: ${info.url}`,
          `\u0411\u0440\u0435\u043D\u0434: ${info.brand}`,
          `\u041C\u0430\u0433\u0430\u0437\u0438\u043D: ${info.shop || "\u2014"}`,
          `\u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A: ${info.title}`,
          `\u041E\u0440\u0438\u0433\u0438\u043D\u0430\u043B: ${info.origMark}`,
          `\u0426\u0435\u043D\u0430: ${info.price}`,
          `\u0420\u0435\u0439\u0442\u0438\u043D\u0433: ${info.avgRating || "\u2014"} (${info.reviewsTotal || 0} \u043E\u0446\u0435\u043D\u043E\u043A)`
        ];
        if (info.unit) out.push(`\u0426\u0435\u043D\u0430 \u0437\u0430 \u0435\u0434\u0438\u043D\u0438\u0446\u0443: ${info.unit}`);
        out.push(
          "",
          "=== \u041E\u041F\u0418\u0421\u0410\u041D\u0418\u0415 ===",
          info.desc,
          "",
          "=== \u0425\u0410\u0420\u0410\u041A\u0422\u0415\u0420\u0418\u0421\u0422\u0418\u041A\u0418 ===",
          ...toBullets(info.chars)
        );
        if (rev) {
          out.push(
            "",
            "=== \u041E\u0422\u0417\u042B\u0412\u042B ===",
            rev.header,
            ...rev.items.map((i) => `- ${i}`)
          );
        }
        return out.join("\n");
      };
      const getOzonPidKey = () => {
        const path = String(location.pathname || "");
        const m = path.match(/\/product\/[^/]*?(\d{5,})(?:\/|$)/) || path.match(/\/product\/(\d{5,})(?:\/|$)/);
        return m && m[1] ? `ozon:${m[1]}` : "";
      };
      const buildOzonExportPackage = async (opts = {}) => {
        const includeReviews = opts.includeReviews !== false;
        const switchToVariant = opts.switchToVariant === true;
        const info = await collectInfo();
        const maxReviews = 100;
        const rev = includeReviews ? await loadReviews(maxReviews, { switchToVariant, avgRating: info.avgRating, reviewsTotal: info.reviewsTotal }) : null;
        const txt = buildOzonText(info, rev);
        const filenameBase = info.brand && info.brand !== "\u2014" ? `${info.title} ${info.brand}` : info.title;
        const name = `${slug(filenameBase)}.txt`;
        return {
          market: "ozon",
          pidKey: getOzonPidKey(),
          url: info.url,
          title: info.title,
          filename: name,
          text: txt
        };
      };
      async function exportOzon(opts = {}) {
        try {
          const copyOnly = !!opts.copyOnly;
          const pack = await buildOzonExportPackage(opts);
          if (copyOnly) {
            await copyToClipboard(pack.text);
            await saveLastExtractSessionFromItem(pack, {
              mode: "copy",
              allReviews: opts.includeReviews !== false
            });
            try {
              await showExportMarkMaybe({ mode: "copy", scope: "single", market: "ozon" });
            } catch (_) {
            }
            let shouldRestore2 = true;
            try {
              shouldRestore2 = await shouldRestoreFocusMaybe("single");
            } catch (_) {
              shouldRestore2 = true;
            }
            if (shouldRestore2) {
              await restoreCardFocus({ mode: "copy", scope: "single", market: "ozon" });
            }
            return;
          }
          downloadTextFile(pack.filename, pack.text);
          await saveLastExtractSessionFromItem(pack, {
            mode: "download",
            allReviews: opts.includeReviews !== false
          });
          try {
            await showExportMarkMaybe({ mode: "download", scope: "single", market: "ozon" });
          } catch (_) {
          }
          let shouldRestore = true;
          try {
            shouldRestore = await shouldRestoreFocusMaybe("single");
          } catch (_) {
            shouldRestore = true;
          }
          if (shouldRestore) {
            await restoreCardFocus({ mode: "download", scope: "single", market: "ozon" });
          }
        } catch (err) {
          console.error("Ozon exporter:", err);
        }
      }
      setRunExport(async (opts = {}) => {
        const allReviews = opts.allReviews === true;
        return buildOzonExportPackage({
          includeReviews: opts.includeReviews !== false,
          switchToVariant: allReviews ? false : true,
          maxReviews: 100
        });
      });
      setInterval(() => {
        attachActionButtons(document.querySelector('[data-widget="webProductHeading"] h1'), "ozon", [
          { label: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C", kind: "full", run: () => exportOzon({ includeReviews: true, switchToVariant: true, maxReviews: 100 }) },
          { label: "\u0432\u0441\u0435 \u043E\u0442\u0437\u044B\u0432\u044B", kind: "all", run: () => exportOzon({ includeReviews: true, switchToVariant: false, maxReviews: 100 }) },
          { label: "\u0432 \u0431\u0443\u0444\u0435\u0440", kind: "copy", pendingText: "\u041A\u043E\u043F\u0438\u0440\u0443\u044E...", successText: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E", toastSuccess: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u0432 \u0431\u0443\u0444\u0435\u0440", run: () => exportOzon({ includeReviews: false, copyOnly: true }) },
          { label: "\u0432 \u0431\u0443\u0444\u0435\u0440 \u0441 \u043E\u0442\u0437\u044B\u0432\u0430\u043C\u0438", kind: "copy_all", pendingText: "\u041A\u043E\u043F\u0438\u0440\u0443\u044E...", successText: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E", toastSuccess: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u0432 \u0431\u0443\u0444\u0435\u0440", run: () => exportOzon({ includeReviews: true, switchToVariant: true, copyOnly: true, maxReviews: 100 }) }
        ]);
      }, 1e3);
    }
    initOzon();
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

  // src/content/price-monitor/ozon.js
  (() => {
    "use strict";
    const PM = window.OWBPriceMonitor;
    if (!PM) return;
    const {
      startProductTracker,
      startCardScanner,
      collectGroupsFromCards,
      isBadgeCardCandidate,
      setCurrentProductDetector,
      parsePriceValue,
      detectCurrency,
      extractDigits,
      findArticleByLabel,
      findPriceInCard
    } = PM;
    const pickVisible = (nodes) => (nodes || []).find((el) => el && el.isConnected && el.getClientRects && el.getClientRects().length) || nodes && nodes[0] || null;
    const getPriceWidget = () => pickVisible([...document.querySelectorAll('[data-widget="webPrice"]')]);
    const getSaleWidget = () => pickVisible([...document.querySelectorAll('[data-widget="webSale"]')]);
    const isOldPriceNode = (node) => {
      if (!node) return false;
      if (node.closest("del, s")) return true;
      let cur = node;
      while (cur && cur !== document.body) {
        const raw = `${cur.className || ""} ${cur.getAttribute?.("style") || ""}`.toLowerCase();
        if (/old|strike|cross|line-through|linethrough/.test(raw)) return true;
        cur = cur.parentElement;
      }
      try {
        return /line-through/i.test(getComputedStyle(node).textDecoration || "");
      } catch (_) {
        return false;
      }
    };
    const isBadProductPriceText = (text) => {
      const t = String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!t || /%/.test(t)) return true;
      return /балл|кешб|рассроч|достав|возврат|скидк|продав|отзыв|вопрос|единиц|остал|купить|корзин|шт\b|за\s+\d/.test(t);
    };
    const getCurrentPriceFromWidget = (widget) => {
      if (!widget) return null;
      const nodes = [...widget.querySelectorAll("span, div")].filter((node) => !node.closest(".mp-price-chart, .mp-min-price-badge")).map((node) => {
        const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || isBadProductPriceText(text) || isOldPriceNode(node)) return null;
        const price = parsePriceValue(text);
        if (!Number.isFinite(price)) return null;
        const currency = detectCurrency(text) || "\u20BD";
        const cls = String(node.className || "");
        let rect = { width: 0, height: 0 };
        let style = null;
        try {
          rect = node.getBoundingClientRect();
          style = getComputedStyle(node);
        } catch (_) {
        }
        if ((rect.width || 0) <= 0 || (rect.height || 0) <= 0) return null;
        const fontSize = parseFloat(style?.fontSize || "") || 0;
        const weight = parseFloat(style?.fontWeight || "") || 0;
        const headlineScore = /tsHeadline|headline/i.test(cls) ? 40 : 0;
        const score = headlineScore + fontSize + (weight >= 600 ? 10 : 0) - Math.min(20, text.length / 8);
        return { price, currency, text, score };
      }).filter(Boolean).sort((a, b) => b.score - a.score || a.price - b.price);
      return nodes[0] || null;
    };
    const getPagePrice = () => {
      const priceWidget = getPriceWidget();
      if (priceWidget) {
        const current2 = getCurrentPriceFromWidget(priceWidget);
        if (current2) return { price: current2.price, currency: current2.currency || "\u20BD", text: current2.text };
      }
      const saleWidget = getSaleWidget();
      if (!saleWidget) return null;
      const current = getCurrentPriceFromWidget(saleWidget);
      return current ? { price: current.price, currency: current.currency || "\u20BD", text: current.text } : null;
    };
    function initOzon() {
      const getPid = () => {
        const path = location.pathname;
        const fromUrl = path.match(/\/product\/[^/]*?(\d{5,})(?:\/|$)/) || path.match(/\/product\/(\d{5,})(?:\/|$)/);
        if (fromUrl) return fromUrl[1];
        const sku = extractDigits(document.querySelector('[data-widget="webDetailSKU"]')?.textContent || "");
        if (sku) return sku;
        return findArticleByLabel(document.querySelector("#section-characteristics")) || findArticleByLabel(document.body);
      };
      const getAnchor = () => getPriceWidget() || getSaleWidget();
      const isProductPage = () => /\/product\/[^/]*?\d{5,}(?:\/|$)/.test(location.pathname || "");
      startProductTracker({ market: "ozon", getPid, getPrice: getPagePrice, getAnchor, isProductPage });
      const extractIdFromOzonMedia = (value) => {
        const text = String(value || "");
        if (!text) return "";
        const parts = text.split(",");
        for (const rawPart of parts) {
          const part = rawPart.trim();
          if (!part) continue;
          const urlPart = part.split(/\s+/)[0] || "";
          const match = urlPart.match(/\/(\d{7,})(?:\.(?:jpe?g|webp|png)|\/|\?|$)/i);
          if (match) return match[1];
        }
        return "";
      };
      const isDirectCartChild = (card) => {
        const root = card?.closest?.('[data-widget="cartSplit"]');
        return !!(root && card.parentElement === root);
      };
      const isOzonCartCard = (card) => {
        if (!card || !isDirectCartChild(card)) return false;
        if (!card.querySelector("img")) return false;
        const hasTitle = !!card.querySelector(
          'a[href*="/product/"], [class*="checkout_p2"], [class*="tsCompact500"], [class*="tsCompact400"]'
        );
        if (!hasTitle) return false;
        const text = String(card.textContent || "").replace(/\s+/g, " ").trim();
        const hasCartSignals = /купить|похожие|закончился|количество ограничено|осталось\s+\d+/i.test(text);
        const priceInfo = findPriceInCard(card, { defaultCurrency: "\u20BD" });
        return !!(hasCartSignals || priceInfo && Number.isFinite(Number(priceInfo.price)));
      };
      const getCardPid = (card) => {
        if (!card) return "";
        const fav = card.querySelector('[favlistslink*="sku="]')?.getAttribute("favlistslink") || card.getAttribute("favlistslink") || "";
        const favMatch = fav.match(/sku=(\d{5,})/);
        if (favMatch) return favMatch[1];
        const dataSku = card.querySelector("[data-sku]")?.getAttribute("data-sku") || card.getAttribute("data-sku") || "";
        const digits = extractDigits(dataSku);
        if (digits) return digits;
        const href = card.querySelector('a[href*="/product/"]')?.getAttribute("href") || "";
        const m = href.match(/\/product\/[^/]*?(\d{5,})(?:\/|\?|$)/) || href.match(/-(\d{5,})(?:\/|\?|$)/);
        if (m) return m[1];
        if (isOzonCartCard(card)) return "";
        if (card.closest('[data-widget="skuGrid"]')) return "";
        const image = card.querySelector("img");
        const fromImg = extractIdFromOzonMedia(image?.getAttribute("src")) || extractIdFromOzonMedia(image?.getAttribute("srcset")) || extractIdFromOzonMedia(image?.currentSrc);
        if (fromImg) return fromImg;
        return "";
      };
      const getCardPrice = (card) => {
        if (!card) return null;
        if (isOzonCartCard(card)) {
          for (const block of [...card.children]) {
            if (!block || !block.querySelector) continue;
            const info2 = findPriceInCard(block, { defaultCurrency: "\u20BD" });
            if (info2 && Number.isFinite(Number(info2.price))) {
              return {
                price: Number(info2.price),
                currency: info2.currency || "\u20BD",
                text: block.textContent || card.textContent || ""
              };
            }
          }
        }
        const headlineNodes = [...card.querySelectorAll('span[class*="tsHeadline"], div[class*="tsHeadline"]')];
        let headlineBest = null;
        for (const node of headlineNodes) {
          const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
          if (!text || !/\d/.test(text) || /%/.test(text)) continue;
          if (/отзыв|шт\b|остал|рейтинг|балл/i.test(text)) continue;
          if (!/[₽€$֏₸]/.test(text) && !/(^|\D)\d{2,}(\D|$)/.test(text)) continue;
          const price = parsePriceValue(text);
          if (!Number.isFinite(price)) continue;
          const currency = detectCurrency(text) || detectCurrency(card.textContent || "") || "\u20BD";
          const cand = { price, currency, text };
          if (!headlineBest || cand.price < headlineBest.price) headlineBest = cand;
        }
        if (headlineBest) return headlineBest;
        const info = findPriceInCard(card, { defaultCurrency: "\u20BD" });
        return info && Number.isFinite(Number(info.price)) ? { price: Number(info.price), currency: info.currency || "\u20BD", text: card.textContent || "" } : null;
      };
      const getCartBadgeTarget = (card) => {
        const image = card?.querySelector("picture img, img");
        let imageBlock = image?.parentElement;
        if (imageBlock?.tagName === "PICTURE") imageBlock = imageBlock.parentElement;
        if (!imageBlock || !card.contains(imageBlock)) {
          imageBlock = image?.closest("div") || image || card;
        }
        imageBlock.classList.remove("mp-min-price-anchor--below-center");
        imageBlock.classList.remove("mp-min-price-anchor--below");
        imageBlock.classList.remove("mp-min-price-anchor--photo");
        imageBlock.classList.add("mp-min-price-anchor--photo-inside");
        return imageBlock;
      };
      startCardScanner({
        collectGroups: () => collectGroupsFromCards({
          market: "ozon",
          cardSelector: [
            'div[class*="tile-root"]',
            'article[class*="tile"]',
            'div[data-sku][class*="tile"]',
            '[data-widget="cartSplit"] > div',
            '[data-widget="cartSplit"] > section',
            '[data-widget="cartSplit"] > article'
          ].join(", "),
          getPid: getCardPid,
          getPrice: getCardPrice,
          isCardCandidate: (card) => isOzonCartCard(card) || isBadgeCardCandidate(card, "ozon"),
          defaultCurrency: "\u20BD"
        }),
        getBadgeTarget: (card) => {
          if (isOzonCartCard(card)) return getCartBadgeTarget(card);
          return card.querySelector('.checkout_s0, [class*="checkout_s0"]') || card.querySelector('.checkout_r5, [class*="checkout_r5"]') || card;
        },
        shouldCaptureGroup: (group) => {
          const currentPid = (String(location.pathname || "").match(/\/product\/[^/]*?(\d{5,})(?:\/|$)/) || [])[1] || "";
          return !currentPid || group.pidKey !== `ozon:${currentPid}`;
        }
      });
    }
    const detectCurrentProduct = () => {
      const path = String(location.pathname || "");
      const fromUrl = path.match(/\/product\/[^/]*?(\d{5,})(?:\/|$)/) || path.match(/\/product\/(\d{5,})(?:\/|$)/);
      const pid = fromUrl && fromUrl[1] || extractDigits(document.querySelector('[data-widget="webDetailSKU"]')?.textContent || "") || findArticleByLabel(document.querySelector("#section-characteristics")) || "";
      if (!pid) return null;
      const priceInfo = getPagePrice();
      return {
        market: "ozon",
        pid,
        pidKey: `ozon:${pid}`,
        currency: priceInfo?.currency || ""
      };
    };
    setCurrentProductDetector(detectCurrentProduct);
    initOzon();
  })();
})();

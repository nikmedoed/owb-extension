(() => {
    'use strict';

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
        getAliCurrencyFromAttrs,
    } = MP;
    const {
        attachActionButtons,
        copyToClipboard,
        saveLastExtractSessionFromItem,
        setRunExport,
        setRestoreFocus,
        shouldRestoreFocus: shouldRestoreFocusMaybe = async () => true,
        showExportMark: showExportMarkMaybe = async () => false,
    } = Exporter;

    const ALI_DEFAULT_MAX_REVIEWS = 100;
    const ALI_REVIEWS_COLLECT_TIMEOUT_MS = 75000;

    let aliReturnUrl = '';
    let aliLastReviewsTotal = 0;

    const clean = cleanText;
    const parseCount = (value) => {
        const raw = String(value || '').replace(/[\u00A0\u202F]/g, ' ').trim();
        const compact = raw.match(/(\d+(?:[.,]\d+)?)\s*([kкmм])\b/i);
        if (compact) {
            const n = Number(compact[1].replace(',', '.'));
            const mult = /[mм]/i.test(compact[2]) ? 1000000 : 1000;
            return Number.isFinite(n) ? Math.round(n * mult) : 0;
        }
        const m = raw.match(/(\d[\d\s,.'’]*)/);
        if (!m) return 0;
        const digits = m[1].replace(/[^\d]/g, '');
        return digits ? Number(digits) || 0 : 0;
    };
    const getAliProductId = () => getAliProductIdFromDocument(document, location.href);
    const getDescriptionRoot = () => document.querySelector('[data-product-description="true"]') || document;
    const getTitleNode = () => getDescriptionRoot().querySelector('h1') || document.querySelector('h1');
    const getPriceRoot = () => document.querySelector('[data-testid="HazeProductPrice"] [data-unformatted-price], [data-testid="HazeProductPrice"][data-unformatted-price]')
        || document.querySelector('[style*="--area:price"] [data-unformatted-price], [style*="--area:price"][data-unformatted-price]')
        || document.querySelector('#buyNowButton [exp_attribute*="finalPrice:"]')
        || document.querySelector('[data-testid="HazeProductPrice"]')
        || document.querySelector('[data-unformatted-price]')
        || document.querySelector('#buyNowButton')?.closest('div')
        || null;
    const getPriceArea = () => {
        const root = getPriceRoot();
        if (!root) return null;
        return root.closest('[style*="--area:price"]')
            || root.closest('[data-testid="HazeProductPrice"]')?.parentElement
            || root.parentElement
            || null;
    };
    const parsePriceFromExpAttribute = (root) => {
        const raw = root?.getAttribute?.('exp_attribute') || '';
        if (!raw) return null;
        const decoded = (() => {
            try { return decodeURIComponent(raw); } catch (_) { return raw; }
        })();
        const m = decoded.match(/finalPrice\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i)
            || decoded.match(/price\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i);
        if (!m) return null;
        const price = Number(String(m[1]).replace(',', '.'));
        if (!Number.isFinite(price)) return null;
        const currencyMatch = decoded.match(/currency\s*:\s*([A-Z]{3}|US)/i);
        return {
            price,
            currency: normalizeCurrency(currencyMatch && currencyMatch[1]),
            text: decoded,
        };
    };
    const parsePriceFromRoot = (root, defaultCurrency = '', options = {}) => {
        if (!root) return null;
        const allowGeneric = options.allowGeneric !== false;
        const attrValue = root.getAttribute('data-unformatted-price');
        const attrPrice = attrValue != null ? Number(String(attrValue).replace(',', '.')) : NaN;
        const text = clean(root.textContent || '');
        const attrCurrency = getAliCurrencyFromAttrs(root);
        if (Number.isFinite(attrPrice)) {
            return {
                price: attrPrice,
                currency: attrCurrency || normalizeCurrency(detectCurrency(text)),
                text,
            };
        }
        const expPrice = parsePriceFromExpAttribute(root);
        if (expPrice) {
            return {
                price: expPrice.price,
                currency: expPrice.currency || attrCurrency || normalizeCurrency(detectCurrency(text) || defaultCurrency),
                text: expPrice.text || text,
            };
        }
        if (!allowGeneric) return null;
        const info = findPriceInCard(root, { defaultCurrency: attrCurrency || '' });
        if (info && Number.isFinite(Number(info.price))) {
            return { price: Number(info.price), currency: normalizeCurrency(info.currency || attrCurrency || defaultCurrency), text };
        }
        const parsed = parsePriceValue(text);
        return Number.isFinite(parsed)
            ? { price: parsed, currency: normalizeCurrency(detectCurrency(text) || attrCurrency || defaultCurrency), text }
            : null;
    };
    const getLeafNodes = (root) => [...(root?.querySelectorAll?.('span, div, p, strong, b') || [])]
        .filter((node) => !node.children || node.children.length === 0);
    const parseMoneyLeaf = (node, defaultCurrency = '') => {
        const text = clean([
            node?.getAttribute?.('title') || '',
            node?.textContent || '',
        ].filter(Boolean).join(' '));
        if (!text || !/\d/.test(text) || /%/.test(text)) return null;
        const currency = normalizeCurrency(detectCurrency(text) || defaultCurrency);
        if (!currency) return null;
        const price = parsePriceValue(text);
        if (!Number.isFinite(price)) return null;
        return { price, currency, text };
    };
    const parseDeliveryPrice = (root, preferredCurrency = '') => {
        if (!root) return null;
        const text = clean(root.textContent || '');
        if (!text) return null;
        if (/\bfree\b|бесплат/i.test(text)) {
            return { price: 0, currency: preferredCurrency || normalizeCurrency(detectCurrency(text)), text };
        }
        const deliveryLeaves = getLeafNodes(root);
        if (!root.children || root.children.length === 0) deliveryLeaves.unshift(root);
        const leaves = deliveryLeaves
            .map((node) => {
                const leafText = clean([
                    node?.getAttribute?.('title') || '',
                    node?.textContent || '',
                ].filter(Boolean).join(' '));
                if (!detectCurrency(leafText)) return null;
                return parseMoneyLeaf(node, preferredCurrency);
            })
            .filter((item) => item && Number.isFinite(Number(item.price)));
        if (!leaves.length) return null;
        const scoped = preferredCurrency
            ? leaves.filter((item) => !item.currency || item.currency === preferredCurrency)
            : leaves;
        return (scoped.length ? scoped : leaves).sort((a, b) => a.price - b.price)[0] || null;
    };
    const findDeliveryRoot = () => {
        const priceArea = getPriceArea();
        return priceArea?.querySelector?.('[data-testid="RedProductDelivery"]')
            || document.querySelector('[data-testid="RedProductDelivery"]')
            || [...document.querySelectorAll('div, section, span, p')]
                .filter((node) => /delivery|shipping|достав/i.test(clean(node.textContent || '')))
                .sort((a, b) => clean(a.textContent || '').length - clean(b.textContent || '').length)[0]
            || null;
    };
    const getPagePriceBreakdown = () => {
        const priceRoot = getPriceRoot();
        const product = parsePriceFromRoot(priceRoot, '', { allowGeneric: false })
            || parsePriceFromRoot(priceRoot, '', { allowGeneric: true });
        if (!product || !Number.isFinite(Number(product.price))) {
            return { product: null, delivery: null, total: null };
        }
        const delivery = parseDeliveryPrice(findDeliveryRoot(), product.currency || '');
        const deliveryPrice = delivery && Number.isFinite(Number(delivery.price)) ? Number(delivery.price) : NaN;
        const total = Number.isFinite(deliveryPrice)
            ? {
                price: Number(product.price) + deliveryPrice,
                currency: product.currency || delivery?.currency || '',
                text: `${product.text || ''}; delivery:${delivery?.text || ''}`,
            }
            : null;
        return { product, delivery, total };
    };
    const formatPrice = (info) => {
        if (!info || !Number.isFinite(Number(info.price))) return '—';
        const value = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(info.price));
        return `${value}${info.currency ? ` ${info.currency}` : ''}`;
    };
    const findButtonByText = (root, re) => [...(root || document).querySelectorAll('button, [role="button"], a')]
        .find((el) => re.test(clean(el.textContent || '')));
    const isAliReviewsRoute = () => /\/item\/\d{8,}\/reviews(?:\/|$)/i.test(String(location.pathname || ''));
    const buildAliReviewsUrl = () => {
        const pid = getAliProductId();
        if (!pid) return '';
        const url = new URL(location.href);
        url.pathname = `/item/${pid}/reviews`;
        const skuId = new URLSearchParams(location.search || '').get('sku_id');
        url.search = '';
        url.searchParams.set('filters', '');
        if (skuId) url.searchParams.set('sku_id', skuId);
        url.hash = '';
        return url.href;
    };
    const requestAliReviewsInTempTab = async (reviewsUrl, options = {}) => {
        if (!reviewsUrl || !(globalThis.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function')) {
            return null;
        }
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({
                    type: 'owb:ali-collect-reviews',
                    payload: {
                        url: reviewsUrl,
                        maxReviews: options.maxReviews || ALI_DEFAULT_MAX_REVIEWS,
                        reviewsTotal: options.reviewsTotal || '',
                    },
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
        if (!el || typeof el.getBoundingClientRect !== 'function') return Infinity;
        const rect = el.getBoundingClientRect();
        return window.scrollY + rect.top;
    };
    const waitForAliCondition = (predicate, timeoutMs = 12000) => new Promise((resolve) => {
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
            try { value = predicate(); } catch (_) { value = null; }
            if (value) finish(value);
        };
        observer = new MutationObserver(check);
        try {
            observer.observe(document.documentElement || document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'disabled', 'aria-disabled'],
            });
        } catch (_) {}
        interval = setInterval(check, 220);
        timer = setTimeout(() => finish(null), Math.max(400, Number(timeoutMs) || 12000));
        check();
    });
    const getAliReviewsRoot = () => {
        if (!isAliReviewsRoute()) return null;
        const listNode = document.querySelector('ul[class*="ReviewList__reviewList"], ul[class*="reviewList"][class*="ReviewList"]');
        const list = listNode?.closest('[class*="RedReviewsProductFeedbackList"], [class*="ProductFeedbackList"]') || listNode?.parentElement;
        if (list) return list;
        const item = document.querySelector('li[data-review-id]');
        if (item) return item.closest('[class*="RedReviewsProductFeedbackList"], [class*="ProductFeedbackList"]') || item.parentElement;
        return document.querySelector('[class*="RedReviewsProductFeedbackList__reviewList"], [class*="ProductFeedbackList__reviewList"]');
    };
    const getAliReviewNodes = () => {
        const seen = new Set();
        return [...document.querySelectorAll('li[data-review-id]')]
            .filter((node) => {
                const id = node.getAttribute('data-review-id') || '';
                if (!id || seen.has(id)) return false;
                seen.add(id);
                return true;
            })
            .sort((a, b) => getVisibleDocY(a) - getVisibleDocY(b));
    };
    const isAliReviewsPage = () => {
        return isAliReviewsRoute();
    };
    const findAliAllReviewsButton = () => {
        const exactSelectors = [
            'button[aria-label="allReviewsButton"]',
            '[style*="--area:showAllButton"] button',
        ];
        for (const sel of exactSelectors) {
            const node = document.querySelector(sel);
            const target = node?.closest?.('button, a, [role="button"]') || node?.querySelector?.('button, a, [role="button"]') || node;
            if (target) return target;
        }
        const textButton = [...document.querySelectorAll('button, a, [role="button"]')]
            .map((el) => ({ el, text: clean(el.textContent || '') }))
            .filter(({ text }) => text && /(all reviews|all feedback|все отзывы|все оценки|показать все отзывы|смотреть все отзывы)/i.test(text))
            .sort((a, b) => getVisibleDocY(a.el) - getVisibleDocY(b.el))[0];
        if (textButton?.el) return textButton.el;

        const classFallback = document.querySelector('[class*="showAllButton"] button');
        if (classFallback) return classFallback;

        const structuralFallback = document.querySelector('#__aer_root__ > div > div:nth-child(1) > div:nth-child(8) > div > div:nth-child(6) > div > div > div > div > ul > li:nth-child(1) > div > div > div:nth-child(4)');
        return structuralFallback?.closest?.('button, a, [role="button"]') || structuralFallback || null;
    };
    const findAliAllReviewsButtonWithScroll = async () => {
        let btn = findAliAllReviewsButton();
        for (let i = 0; !btn && i < 26; i += 1) {
            window.scrollBy({ top: Math.max(360, Math.round(window.innerHeight * 0.55)), behavior: 'smooth' });
            await sleep(260);
            btn = findAliAllReviewsButton();
        }
        return btn;
    };
    const waitForAliReviewsRoot = async (timeoutMs = 15000) => {
        const root = await waitForAliCondition(() => {
            const root = getAliReviewsRoot();
            if (root && getAliReviewNodes().length) return root;
            if (root) return root;
            return null;
        }, timeoutMs);
        return root || null;
    };
    const clickAliReviewExpanders = async (root = document) => {
        const buttons = [...(root || document).querySelectorAll('button, [role="button"]')]
            .filter((btn) => {
                const text = clean(btn.textContent || '');
                if (!text || /show original|показать оригинал/i.test(text)) return false;
                return /read more|show more|see more|читать далее|показать полностью|ещ[её]/i.test(text);
            })
            .slice(0, 80);
        for (const btn of buttons) {
            try { btn.click(); } catch (_) {}
            await sleep(25);
        }
    };
    const findAliLoadMoreButton = (root = document) => {
        const scope = root || document;
        const buttons = [...scope.querySelectorAll('button, [role="button"]')];
        return buttons.find((btn) => /loadMoreButton|refresh/i.test(String(btn.className || '')))
            || buttons.find((btn) => /reload|load more|show more|показать|загруз|ещ[её]/i.test(clean(btn.textContent || '')));
    };
    const getAliScrollableContainers = (root) => {
        if (!root) return [];
        return [root, ...root.querySelectorAll('*')]
            .filter((el) => {
                if (!el || el === document.body || el === document.documentElement) return false;
                const max = el.scrollHeight - el.clientHeight;
                if (max <= 80) return false;
                const style = getComputedStyle(el);
                const overflow = `${style.overflowY || ''} ${style.overflow || ''}`.toLowerCase();
                return /(auto|scroll|overlay)/.test(overflow) || max > 500;
            })
            .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
            .slice(0, 4);
    };
    const focusAliReviewsViewport = async (root) => {
        try { window.focus(); } catch (_) {}
        const target = root || getAliReviewsRoot() || document.documentElement;
        try {
            if (!target.hasAttribute?.('tabindex')) target.setAttribute?.('tabindex', '-1');
            target.focus?.({ preventScroll: true });
        } catch (_) {}
        const containers = getAliScrollableContainers(target);
        containers.forEach((el) => {
            try {
                if (!el.hasAttribute?.('tabindex')) el.setAttribute?.('tabindex', '-1');
                el.focus?.({ preventScroll: true });
            } catch (_) {}
        });
        await sleep(40);
    };
    const scrollAliReviewsForward = async (root, nodes) => {
        await focusAliReviewsViewport(root);
        const last = nodes[nodes.length - 1] || root;
        try { last.scrollIntoView({ block: 'end', behavior: 'auto' }); } catch (_) {}
        window.scrollBy(0, Math.max(520, Math.round(window.innerHeight * 0.78)));
        const containers = getAliScrollableContainers(root);
        containers.forEach((el) => {
            try {
                el.focus?.({ preventScroll: true });
                el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + Math.max(520, Math.round(el.clientHeight * 0.95)));
                el.dispatchEvent(new WheelEvent('wheel', {
                    bubbles: true,
                    cancelable: true,
                    deltaY: Math.max(520, Math.round(el.clientHeight * 0.95)),
                }));
            } catch (_) {}
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
            return await waitForAliReviewsRoot(16000);
        }
        const btn = await findAliAllReviewsButtonWithScroll();
        if (!btn) return null;

        aliReturnUrl = location.href;
        aliLastReviewsTotal = parseCount(btn.textContent || '') || aliLastReviewsTotal;
        try { btn.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
        await sleep(220);
        const clickTarget = btn.closest?.('button, a, [role="button"]') || btn.querySelector?.('button, a, [role="button"]') || btn;
        try { clickTarget.click(); } catch (_) {}
        const root = await waitForAliReviewsRoot(16000);
        if (root) {
            try { root.scrollIntoView({ block: 'start', behavior: 'auto' }); } catch (_) {}
            await sleep(280);
        }
        return root;
    };
    const textFromNode = (node) => {
        if (!node) return '';
        const clone = node.cloneNode(true);
        clone.querySelectorAll('button, svg, script, style, noscript').forEach((n) => n.remove());
        return clean(clone.innerText || clone.textContent || '');
    };
    const parseAliStars = (root) => {
        const stars = root?.querySelectorAll?.('[class*="StarGroup__wrapper"] svg, [class*="StarGroup"] svg') || [];
        if (stars.length >= 1 && stars.length <= 5) return String(stars.length);
        const aria = root?.querySelector?.('[aria-label*="5"]')?.getAttribute('aria-label') || '';
        const m = aria.match(/([1-5](?:[.,]\d)?)/);
        return m ? m[1].replace(',', '.') : '—';
    };
    const getAliHeader = (root) => {
        const header = root?.querySelector?.('[class*="Header__wrapper"]') || root;
        return {
            author: clean(header?.querySelector?.('[class*="Header__title"]')?.textContent || ''),
            date: clean(header?.querySelector?.('[class*="Header__subtitle"]')?.textContent || ''),
        };
    };
    const getAliContentText = (root) => {
        const isCommentRoot = !!root?.closest?.('[class*="CommentList__commentList"]');
        const isContainerRoot = !!root?.matches?.('[class*="Container__container"]');
        const nodes = [...(root?.querySelectorAll?.('[class*="Content__text"]') || [])]
            .filter((node) => isCommentRoot || !node.closest('[class*="CommentList__commentList"]'))
            .filter((node) => !isContainerRoot || node.closest('[class*="Container__container"]') === root);
        const texts = nodes.map(textFromNode).filter(Boolean);
        return [...new Set(texts)].join(' ');
    };
    const getAliImageCount = (root) => {
        const isContainerRoot = !!root?.matches?.('[class*="Container__container"]');
        const gallery = [...(root?.querySelectorAll?.('[class*="HScrollWrapper__gallery"], [class*="ImageCarousel"]') || [])]
            .find((node) => !isContainerRoot || node.closest('[class*="Container__container"]') === root);
        if (!gallery) return 0;
        const items = gallery.querySelectorAll('[class*="imageItem"]');
        if (items.length) return items.length;
        return gallery.querySelectorAll('img, source[srcset]').length || 0;
    };
    const parseAliReviewNode = (li, idx) => {
        const wrapper = li.querySelector('[class*="ReviewListItem__wrapper"]') || li;
        const commentList = wrapper.querySelector('[class*="CommentList__commentList"]');
        const containers = [...wrapper.querySelectorAll('[class*="Container__container"]')];
        const topContainers = containers.filter((node) => !node.closest('[class*="CommentList__commentList"]'));
        const main = topContainers[0] || wrapper;
        const { author, date } = getAliHeader(main);
        const rating = parseAliStars(main);
        const sku = clean(main.querySelector('[class*="SubHeader__skuProperties"]')?.getAttribute('title')
            || main.querySelector('[class*="SubHeader__skuProperties"]')?.textContent
            || '');
        const text = getAliContentText(main) || 'Без текста';
        const parts = [];
        if (rating && rating !== '—') parts.push(`${rating}★`);
        if (author) parts.push(`Автор: ${author}`);
        if (sku) parts.push(sku);
        parts.push(`Комментарий: ${text}`);
        const imageCount = getAliImageCount(main);
        if (imageCount) parts.push(`Фото: ${imageCount}`);

        topContainers.slice(1).forEach((extra) => {
            const extraHead = getAliHeader(extra);
            const extraText = getAliContentText(extra);
            if (extraText) parts.push(`Дополнение${extraHead.date ? ` (${extraHead.date})` : ''}: ${extraText}`);
        });

        [...(commentList?.querySelectorAll('li') || [])].forEach((commentNode) => {
            const cRoot = commentNode.querySelector('[class*="Container__container"]') || commentNode;
            const cHead = getAliHeader(cRoot);
            const cText = getAliContentText(cRoot);
            if (cText) {
                const by = cHead.author ? `, ${cHead.author}` : '';
                parts.push(`Ответ${cHead.date ? ` (${cHead.date}${by})` : by ? ` (${cHead.author})` : ''}: ${cText}`);
            }
        });

        return `Отзыв ${idx + 1} (${date || '—'}): ${parts.join('; ')}`;
    };
    const loadAliReviews = async (maxReviews = 100, opts = {}) => {
        const root = await goToAliReviewsPage();
        const declared = Math.max(parseCount(opts.reviewsTotal || ''), aliLastReviewsTotal || 0);
        const maxLimit = Number(maxReviews);
        const limit = Number.isFinite(maxLimit) && maxLimit > 0 ? maxLimit : (declared || ALI_DEFAULT_MAX_REVIEWS);
        const target = Math.max(1, Math.min(limit, declared || limit));
        if (!root) return { header: 'Отзывы: не удалось открыть блок отзывов', items: [], unavailable: true };

        let prev = 0;
        let idle = 0;
        const startedAt = Date.now();
        await focusAliReviewsViewport(root);
        for (let loops = 0; loops < 160 && (Date.now() - startedAt) < ALI_REVIEWS_COLLECT_TIMEOUT_MS; loops += 1) {
            const currentRoot = getAliReviewsRoot() || root;
            const nodes = getAliReviewNodes();
            await clickAliReviewExpanders(currentRoot);
            if (nodes.length >= target) break;

            await scrollAliReviewsForward(currentRoot, nodes);

            const btn = findAliLoadMoreButton(currentRoot);
            if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
                try { btn.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (_) {}
                await focusAliReviewsViewport(currentRoot);
                await sleep(120);
                try { btn.click(); } catch (_) {}
                await waitForAliReviewProgress(nodes.length, 3600);
            } else {
                await waitForAliReviewProgress(nodes.length, 2600);
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
            header: `Отзывы (выгружено ${items.length}${total ? ` из ${total}` : ''})`,
            items,
        };
    };
    const collectAliReviewsForProduct = async (maxReviews = 100, opts = {}) => {
        if (isAliReviewsRoute()) {
            return loadAliReviews(maxReviews, opts);
        }
        const reviewsUrl = buildAliReviewsUrl();
        const fromTempTab = await requestAliReviewsInTempTab(reviewsUrl, {
            maxReviews,
            reviewsTotal: opts.reviewsTotal || '',
        });
        if (fromTempTab && Array.isArray(fromTempTab.items)) return fromTempTab;
        return loadAliReviews(maxReviews, opts);
    };
    const clickExpanders = async () => {
        const descBtn = document.querySelector('button[ae_button_type*="full_description" i], button[data-spm="veiw_full"]')
            || findButtonByText(document.querySelector('#content_anchor')?.parentElement || document, /full description|полное описание|показать полностью|show more/i);
        if (descBtn) {
            try { descBtn.click(); } catch (_) {}
            await sleep(350);
        }

        const specRoot = document.querySelector('#characteristics_anchor');
        const specBtn = document.querySelector('button[ae_button_type*="full_spec" i]')
            || findButtonByText(specRoot?.parentElement || document, /view all|показать все|все характеристики|all/i);
        if (specBtn) {
            try { specBtn.click(); } catch (_) {}
            await sleep(350);
        }
    };
    const getStore = () => {
        const root = getDescriptionRoot();
        const link = root.querySelector('a[href*="/store/"]') || document.querySelector('#storeInfo a[href*="/store/"], a[href*="/store/"]');
        const name = clean(link?.textContent || '');
        const url = link?.href || '';
        return { name: name || '—', url };
    };
    const getRatingInfo = () => {
        const floor = document.querySelector('[data-spm="title_floor"]') || getDescriptionRoot();
        const text = clean(floor.textContent || '');
        const rating = (text.match(/\b([0-5][.,]\d{1,2})\b/) || text.match(/\b([1-5])\b/))?.[1]?.replace(',', '.') || '—';
        const reviewsText = clean(floor.querySelector('a[href="#reviews_anchor"], a[href*="reviews_anchor"]')?.textContent || '');
        const reviews = (reviewsText.match(/(\d[\d\s,.'’]*)/) || text.match(/(\d[\d\s,.'’]*)\s*(?:reviews?|отзыв|оцен)/i) || [])[1] || '0';
        const bought = (text.match(/(\d[\d\s,.'’]*)\s*(?:bought|купил|заказ)/i) || [])[1] || '';
        return {
            rating,
            reviews: clean(reviews).replace(/\s+/g, ' ') || '0',
            bought: clean(bought).replace(/\s+/g, ' '),
        };
    };
    const collectDescription = () => {
        const root = document.querySelector('#content_anchor');
        if (!root) return { text: '—', images: [] };
        const images = [...root.querySelectorAll('img[src], img[data-src]')]
            .map((img) => img.getAttribute('src') || img.getAttribute('data-src') || '')
            .map((src) => clean(src))
            .filter(Boolean);
        const clone = root.cloneNode(true);
        clone.querySelectorAll('script, style, noscript, button, svg, img').forEach((n) => n.remove());
        const lines = clean(clone.innerText || clone.textContent || '')
            .split(/\n+/)
            .map((line) => clean(line))
            .filter((line) => line && !/^modname\s*=/i.test(line) && !/^(description|описание)$/i.test(line));
        return {
            text: lines.length ? lines.join('\n') : '—',
            images: [...new Set(images)],
        };
    };
    const collectSpecs = () => {
        const root = document.querySelector('#characteristics_anchor');
        if (!root) return '—';
        const rows = [];
        const add = (name, value) => {
            const k = clean(name).replace(/[:\s]+$/, '');
            const v = clean(value);
            if (!k || !v || k === v) return;
            const low = k.toLowerCase();
            if (/^(characteristics|характеристики|view all|показать все)$/i.test(low)) return;
            const row = `${k}: ${v}`;
            if (!rows.includes(row)) rows.push(row);
        };

        root.querySelectorAll('tr').forEach((tr) => {
            add(tr.querySelector('th')?.textContent, tr.querySelector('td')?.textContent);
        });
        root.querySelectorAll('dl').forEach((dl) => {
            add(dl.querySelector('dt')?.textContent, dl.querySelector('dd')?.textContent);
        });
        root.querySelectorAll('div').forEach((div) => {
            const spans = [...div.children].filter((child) => child.tagName === 'SPAN');
            if (spans.length === 2) add(spans[0].textContent, spans[1].textContent);
        });
        return rows.length ? rows.join('\n') : '—';
    };
    const buildAliExpressExportPackage = async (opts = {}) => {
        const includeReviews = opts.includeReviews !== false;
        const maxReviews = Number(opts.maxReviews) || ALI_DEFAULT_MAX_REVIEWS;
        await clickExpanders();
        const url = location.href;
        aliReturnUrl = url;
        const title = clean(getTitleNode()?.textContent || document.title || '—');
        const store = getStore();
        const rating = getRatingInfo();
        const priceInfo = getPagePriceBreakdown();
        const description = collectDescription();
        const chars = collectSpecs();
        const pid = getAliProductId();

        const lines = [
            '=== CARD SUMMARY (ALIEXPRESS) ===',
            `URL: ${url}`,
            `Магазин: ${store.name}`,
            store.url ? `Ссылка магазина: ${store.url}` : '',
            `Заголовок: ${title}`,
            `Цена товара: ${formatPrice(priceInfo.product)}`,
            `Доставка: ${formatPrice(priceInfo.delivery)}`,
            `Сумма с доставкой: ${formatPrice(priceInfo.total)}`,
            `Рейтинг: ${rating.rating} (${rating.reviews} отзывов)`,
            rating.bought ? `Купили: ${rating.bought}` : '',
            '',
            '=== ОПИСАНИЕ ===',
            description.text,
        ].filter((line) => line !== '');
        if (description.images.length) {
            lines.push('', '=== ИЗОБРАЖЕНИЯ ОПИСАНИЯ ===', ...description.images.map((src) => `- ${src}`));
        }
        lines.push('', '=== ХАРАКТЕРИСТИКИ ===', ...toBullets(chars));

        if (includeReviews) {
            const reviews = await collectAliReviewsForProduct(maxReviews, { reviewsTotal: rating.reviews });
            lines.push('', '=== ОТЗЫВЫ ===', reviews.header);
            if (reviews.items.length) {
                lines.push(...reviews.items.map((item) => `- ${item}`));
            } else if (reviews.unavailable) {
                lines.push('Отзывы не выгружены');
            } else {
                lines.push('Нет отзывов');
            }
        }

        const text = lines.join('\n');
        return {
            market: 'aliexpress',
            pidKey: pid ? `aliexpress:${pid}` : '',
            url,
            title,
            filename: `${slug(title || pid || 'aliexpress')}.txt`,
            text,
        };
    };

    const restoreCardFocus = async () => {
        if (isAliReviewsPage()) {
            if (window.history.length > 1) {
                try {
                    window.history.back();
                    await sleep(420);
                    return;
                } catch (_) {}
            }
            if (aliReturnUrl && aliReturnUrl !== location.href) {
                location.assign(aliReturnUrl);
                return;
            }
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await sleep(220);
    };

    const exportAliExpress = async (opts = {}) => {
        const includeReviews = opts.includeReviews !== false;
        const pack = await buildAliExpressExportPackage(opts);
        if (opts.copyOnly) {
            await copyToClipboard(pack.text);
            await saveLastExtractSessionFromItem(pack, { mode: 'copy', allReviews: includeReviews });
            try { await showExportMarkMaybe({ mode: 'copy', scope: 'single', market: 'aliexpress' }); } catch (_) {}
        } else {
            downloadTextFile(pack.filename, pack.text);
            await saveLastExtractSessionFromItem(pack, { mode: 'download', allReviews: includeReviews });
            try { await showExportMarkMaybe({ mode: 'download', scope: 'single', market: 'aliexpress' }); } catch (_) {}
        }
        let shouldRestore = true;
        try { shouldRestore = await shouldRestoreFocusMaybe('single'); } catch (_) { shouldRestore = true; }
        if (shouldRestore) await restoreCardFocus();
    };

    function initAliExpress() {
        ensureScrollTopButton();
        setRestoreFocus(restoreCardFocus);
        if (globalThis.chrome && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
                if (!message || message.scope !== 'owb-ali-reviews') return undefined;
                if (String(message.action || '') !== 'collect-reviews') return undefined;
                (async () => {
                    if (!isAliReviewsRoute()) throw new Error('Current page is not AliExpress reviews route');
                    return loadAliReviews(Number(message.payload?.maxReviews) || ALI_DEFAULT_MAX_REVIEWS, {
                        reviewsTotal: message.payload?.reviewsTotal || '',
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
            maxReviews: Number(opts.maxReviews) || ALI_DEFAULT_MAX_REVIEWS,
        }));
        setInterval(() => {
            attachActionButtons(getTitleNode(), 'aliexpress', [
                { label: 'Скачать с отзывами', kind: 'full', run: () => exportAliExpress({ includeReviews: true, copyOnly: false, maxReviews: ALI_DEFAULT_MAX_REVIEWS }) },
                { label: 'в буфер', kind: 'copy', pendingText: 'Копирую...', successText: 'Скопировано', toastSuccess: 'Скопировано в буфер', run: () => exportAliExpress({ includeReviews: false, copyOnly: true }) },
                { label: 'в буфер с отзывами', kind: 'copy_all', pendingText: 'Копирую...', successText: 'Скопировано', toastSuccess: 'Скопировано в буфер', run: () => exportAliExpress({ includeReviews: true, copyOnly: true, maxReviews: ALI_DEFAULT_MAX_REVIEWS }) },
            ]);
        }, 1000);
    }

    initAliExpress();
})();

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

    const clean = cleanText;
    const AMAZON_ASIN_RE = /^[A-Z0-9]{10}$/;
    const AMAZON_DEFAULT_MAX_REVIEWS = 100;
    const AMAZON_ALL_MAX_REVIEWS = 300;

    const isProductPage = () => /\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/[A-Z0-9]{10}(?:[/?#]|$)/i.test(location.pathname || '')
        || !!document.querySelector('#dp, #centerCol #title, #ppd #title');
    const normalizeAsin = (value) => {
        const raw = String(value || '').trim().toUpperCase();
        return AMAZON_ASIN_RE.test(raw) ? raw : '';
    };
    const getAsinFromHref = (href) => {
        try {
            const url = new URL(String(href || ''), location.href);
            const path = String(url.pathname || '');
            const m = path.match(/\/(?:dp|gp\/product|exec\/obidos\/ASIN|product-reviews)\/([A-Z0-9]{10})(?:[/?#]|$)/i)
                || path.match(/\/([A-Z0-9]{10})(?:[/?#]|$)/i);
            return normalizeAsin(m && m[1]);
        } catch (_) {
            return '';
        }
    };
    const getAsin = () => {
        const fromUrl = getAsinFromHref(location.href);
        if (fromUrl) return fromUrl;
        const selectors = [
            'input[name="asin"]',
            'input#ASIN',
            'input#asin',
            '#averageCustomerReviews[data-asin]',
            '[data-csa-c-asin]',
            '[data-asin]',
        ];
        for (const selector of selectors) {
            const node = document.querySelector(selector);
            const value = node?.value || node?.getAttribute?.('data-asin') || node?.getAttribute?.('data-csa-c-asin') || '';
            const asin = normalizeAsin(value);
            if (asin) return asin;
        }
        const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
        return getAsinFromHref(canonical);
    };
    const getPidKey = () => {
        const asin = getAsin();
        return asin ? `amazon:${asin}` : '';
    };
    const getCanonicalUrl = (asin = getAsin()) => asin ? `${location.origin}/dp/${asin}` : location.href;
    const isAmazonReviewsRoute = () => /\/(?:product-reviews|portal\/customer-reviews)\/[A-Z0-9]{10}(?:[/?#]|$)/i.test(location.pathname || '');
    const buildAmazonReviewsUrl = (asin = getAsin(), page = 1) => {
        if (!asin) return '';
        const url = new URL(`/product-reviews/${asin}`, location.origin);
        url.searchParams.set('reviewerType', 'all_reviews');
        url.searchParams.set('sortBy', 'recent');
        url.searchParams.set('pageNumber', String(Math.max(1, Number(page) || 1)));
        return url.href;
    };
    const getTitleNode = () => document.querySelector('#title #productTitle, h1#title span#productTitle, h1#title, #productTitle');
    const getTitle = () => clean(getTitleNode()?.textContent || document.querySelector('input[name="productTitle"]')?.value || document.title || '—');
    const getBrand = () => {
        const byline = clean(document.querySelector('#bylineInfo')?.textContent || '');
        const fromByline = byline
            .replace(/^visit\s+the\s+/i, '')
            .replace(/\s+store$/i, '')
            .replace(/^brand:\s*/i, '')
            .trim();
        if (fromByline) return fromByline;
        const row = [...document.querySelectorAll('#productDetails_feature_div tr, #prodDetails tr')]
            .find((tr) => /^brand$/i.test(clean(tr.querySelector('th')?.textContent || '')));
        return clean(row?.querySelector('td')?.textContent || '—');
    };
    const isOldPriceNode = (node) => !!(node && (
        node.closest('.a-text-price, [data-a-strike="true"], del')
        || /line-through/i.test(node.closest('[style]')?.getAttribute('style') || '')
    ));
    const parsePriceNode = (node) => {
        if (!node) return null;
        const text = clean(node.getAttribute?.('aria-label') || node.textContent || '');
        const price = parsePriceValue(text);
        if (!Number.isFinite(price)) return null;
        return { price, currency: normalizeCurrency(detectCurrency(text) || '$'), text };
    };
    const getPriceRoot = () => document.querySelector('#corePriceDisplay_desktop_feature_div')
        || document.querySelector('#corePrice_feature_div')
        || document.querySelector('#apex_desktop')
        || document.querySelector('#buybox')
        || document.querySelector('#centerCol')
        || null;
    const getPagePrice = () => {
        const hiddenValue = document.querySelector('input#priceValue, input[name="priceValue"]')?.value;
        const hiddenPrice = Number(String(hiddenValue || '').replace(',', '.'));
        if (Number.isFinite(hiddenPrice) && hiddenPrice > 0) {
            const symbol = document.querySelector('input#priceSymbol, input[name="priceSymbol"]')?.value || '$';
            const currency = normalizeCurrency(symbol || document.querySelector('input#currencyOfPreference')?.value || 'USD') || '$';
            return { price: hiddenPrice, currency, text: `${symbol}${hiddenValue}` };
        }

        const root = getPriceRoot();
        const preferred = [
            '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
            '#corePriceDisplay_desktop_feature_div [data-a-color="price"] .a-offscreen',
            '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
            '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen',
            '#apex_desktop .a-price:not(.a-text-price) .a-offscreen',
            '#buybox .a-price:not(.a-text-price) .a-offscreen',
        ];
        for (const selector of preferred) {
            const nodes = [...document.querySelectorAll(selector)].filter((node) => !isOldPriceNode(node));
            for (const node of nodes) {
                const parsed = parsePriceNode(node);
                if (parsed) return parsed;
            }
        }
        const info = findPriceInCard(root || document.body, { defaultCurrency: '$' });
        return info && Number.isFinite(Number(info.price))
            ? { price: Number(info.price), currency: info.currency || '$', text: root?.textContent || '' }
            : null;
    };
    const formatPrice = (info) => {
        if (!info || !Number.isFinite(Number(info.price))) return '—';
        return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(info.price))} ${info.currency || '$'}`;
    };
    const parseCount = (value) => {
        const compact = clean(value).match(/(\d+(?:[.,]\d+)?)\s*([km])\b/i);
        if (compact) {
            const n = Number(compact[1].replace(',', '.'));
            return Number.isFinite(n) ? Math.round(n * (/m/i.test(compact[2]) ? 1000000 : 1000)) : 0;
        }
        const digits = clean(value).replace(/[^\d]/g, '');
        return digits ? Number(digits) || 0 : 0;
    };
    const getRatingInfo = () => {
        const ratingText = clean(
            document.querySelector('#acrPopover')?.getAttribute('title')
            || document.querySelector('#acrPopover .a-icon-alt')?.textContent
            || document.querySelector('[data-hook="rating-out-of-text"]')?.textContent
            || '',
        );
        const rating = (ratingText.replace(',', '.').match(/\b([0-5](?:\.\d)?)\b/) || [])[1] || '—';
        const reviewsText = clean(
            document.querySelector('#acrCustomerReviewText')?.getAttribute('aria-label')
            || document.querySelector('#acrCustomerReviewText')?.textContent
            || '',
        );
        return {
            rating,
            reviews: parseCount(reviewsText),
        };
    };
    const getSeller = () => {
        const seller = clean(
            document.querySelector('#sellerProfileTriggerId')?.textContent
            || document.querySelector('#merchant-info a')?.textContent
            || '',
        );
        if (seller) return seller;
        const merchant = clean(document.querySelector('#merchant-info')?.textContent || '');
        const m = merchant.match(/sold by\s+(.+?)(?:\sand\s+fulfilled|\.)/i);
        return clean((m && m[1]) || merchant || '—');
    };
    const getAvailability = () => clean(document.querySelector('#availability')?.textContent || document.querySelector('#outOfStock')?.textContent || '—');
    const collectBullets = () => [...document.querySelectorAll('#feature-bullets li .a-list-item')]
        .map((node) => clean(node.textContent || ''))
        .filter((text) => text && !/^make sure this fits/i.test(text));
    const collectSpecs = () => {
        const rows = [];
        const seen = new Set();
        const add = (key, value) => {
            const k = clean(key).replace(/[:\s]+$/, '');
            const v = clean(value);
            if (!k || !v || k === v) return;
            if (/^(customer reviews|best sellers rank)$/i.test(k)) return;
            const row = `${k}: ${v}`;
            const sig = row.toLowerCase();
            if (seen.has(sig)) return;
            seen.add(sig);
            rows.push(row);
        };
        document.querySelectorAll('#productOverview_feature_div tr, #productDetails_feature_div tr, #prodDetails tr, table#productDetails_detailBullets_sections1 tr').forEach((tr) => {
            add(tr.querySelector('th, .a-span3')?.textContent, tr.querySelector('td, .a-span9')?.textContent);
        });
        document.querySelectorAll('#detailBullets_feature_div li').forEach((li) => {
            const bold = li.querySelector('.a-text-bold');
            if (!bold) return;
            const key = clean(bold.textContent).replace(/^[\s:]+|[\s:]+$/g, '');
            const clone = li.cloneNode(true);
            clone.querySelectorAll('.a-text-bold, script, style').forEach((node) => node.remove());
            add(key, clone.textContent);
        });
        return rows.length ? rows.join('\n') : '—';
    };
    const collectVariations = () => {
        const rows = [];
        document.querySelectorAll('[id^="variation_"]').forEach((root) => {
            const label = clean(root.querySelector('.a-form-label')?.textContent || root.id.replace(/^variation_/, ''));
            const selected = clean(root.querySelector('.selection')?.textContent || root.querySelector('[aria-checked="true"]')?.textContent || '');
            if (label && selected) rows.push(`${label.replace(/[:\s]+$/, '')}: ${selected}`);
        });
        return rows.length ? rows.join('\n') : '—';
    };
    const collectDescription = () => {
        const direct = clean(document.querySelector('#productDescription')?.textContent || '');
        if (direct) return direct;
        const aplus = document.querySelector('#aplus, #aplus_feature_div');
        if (!aplus) return '—';
        const clone = aplus.cloneNode(true);
        clone.querySelectorAll('script, style, noscript, svg, button, img').forEach((node) => node.remove());
        const lines = clean(clone.innerText || clone.textContent || '')
            .split(/\n+/)
            .map((line) => clean(line))
            .filter(Boolean);
        return lines.length ? lines.slice(0, 80).join('\n') : '—';
    };
    const getMainImage = () => {
        const img = document.querySelector('#landingImage, #imgTagWrapperId img, #main-image-container img');
        return clean(img?.currentSrc || img?.src || img?.getAttribute?.('data-old-hires') || '');
    };
    const requestAmazonReviewsInTempTab = async (reviewsUrl, options = {}) => {
        if (!reviewsUrl || !(globalThis.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function')) {
            return null;
        }
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({
                    type: 'owb:amazon-collect-reviews',
                    payload: {
                        url: reviewsUrl,
                        maxReviews: options.maxReviews || AMAZON_DEFAULT_MAX_REVIEWS,
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
    const textFromNode = (node) => {
        if (!node) return '';
        const clone = node.cloneNode(true);
        clone.querySelectorAll('script, style, noscript, svg, button').forEach((n) => n.remove());
        return clean(clone.innerText || clone.textContent || '');
    };
    const readReviewsStatePage = (node) => {
        try {
            const raw = node?.getAttribute?.('data-reviews-state-param') || '';
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
        if (node.closest('[hidden], .aok-hidden, .a-hidden, .a-button-disabled')) return false;
        if (node.getAttribute('aria-disabled') === 'true') return false;
        const rect = node.getBoundingClientRect?.();
        return !rect || rect.width > 0 || rect.height > 0;
    };
    const clickAmazonNode = (node) => {
        if (!node) return false;
        try {
            if (typeof node.click === 'function') node.click();
            return true;
        } catch (_) {
            try {
                node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                return true;
            } catch (_) {
                return false;
            }
        }
    };
    const getAmazonReviewBody = (node) => {
        const body = node.querySelector('[data-hook="review-body"], .review-text');
        const full = body?.querySelector?.('.cr-original-review-content, .a-expander-content, [data-expanded="true"]')
            || node.querySelector('.cr-original-review-content, [data-hook="review-body"] .a-expander-content');
        return (textFromNode(full) || textFromNode(body) || 'Без текста')
            .replace(/\s*(Read more|Show less)\s*$/i, '')
            .trim();
    };
    const parseAmazonReviewNode = (node, idx) => {
        const ratingText = clean(
            node.querySelector('[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt, .review-rating .a-icon-alt')?.textContent || '',
        );
        const rating = (ratingText.replace(',', '.').match(/\b([1-5](?:\.\d)?)\b/) || [])[1] || '—';
        const title = textFromNode(node.querySelector('[data-hook="review-title"], .review-title'));
        const date = clean(node.querySelector('[data-hook="review-date"], .review-date')?.textContent || '');
        const author = clean(node.querySelector('.a-profile-name')?.textContent || '');
        const variant = textFromNode(node.querySelector('[data-hook="format-strip"]'));
        const verified = clean(node.querySelector('[data-hook="avp-badge"]')?.textContent || '');
        const body = getAmazonReviewBody(node);
        const imageCount = node.querySelectorAll('[data-hook="review-image-tile"], .review-image-tile, img.review-image-tile').length;
        const parts = [];
        if (rating !== '—') parts.push(`${rating}★`);
        if (author) parts.push(`Автор: ${author}`);
        if (title) parts.push(`Заголовок: ${title}`);
        if (variant) parts.push(variant);
        if (verified) parts.push(verified);
        parts.push(`Комментарий: ${body}`);
        if (imageCount) parts.push(`Фото: ${imageCount}`);
        return `Отзыв ${idx + 1} (${date || '—'}): ${parts.join('; ')}`;
    };
    const getAmazonReviewNodes = (root = document) => {
        const nodes = [...root.querySelectorAll('[data-hook="review"], .review[data-hook], div[id^="customer_review-"]')];
        return nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
    };
    const collectAmazonReviewsFromDocument = (doc, offset = 0, seen = new Set()) => {
        const nodes = getAmazonReviewNodes(doc);
        const items = [];
        nodes.forEach((node) => {
            const id = node.getAttribute('id') || node.getAttribute('data-review-id') || textFromNode(node).slice(0, 120);
            if (!id || seen.has(id)) return;
            seen.add(id);
            items.push(parseAmazonReviewNode(node, offset + items.length));
        });
        return items;
    };
    const getAmazonShowMoreButton = (root = document) => {
        const buttons = [
            ...root.querySelectorAll(
                '[data-hook="show-more-button"], .cm-cr-show-more a, #cm_cr-pagination_bar a, a[data-reftag^="cm_cr_arp_d_paging_btm"]',
            ),
        ].filter((node) => !node.matches?.('select, option') && (root !== document || isVisibleNode(node)));
        const candidates = buttons
            .filter((node) => /show\s+\d+\s+more\s+reviews|show\s+more\s+reviews/i.test(clean(node.textContent || '')) || readReviewsStatePage(node) > 0)
            .sort((a, b) => readReviewsStatePage(b) - readReviewsStatePage(a));
        return candidates[0]
            || buttons[buttons.length - 1]
            || null;
    };
    const expandAmazonReviewBodies = async (root = document) => {
        const buttons = getAmazonReviewNodes(root)
            .flatMap((node) => [
                ...node.querySelectorAll(
                    'a[data-action="a-expander-toggle"][aria-expanded="false"], .a-expander-header[aria-expanded="false"], [data-hook="review-body"] .a-expander-header, .review-text .a-expander-header',
                ),
            ])
            .filter((node) => isVisibleNode(node));
        for (const button of buttons.slice(0, 300)) {
            button.scrollIntoView({ block: 'center', inline: 'nearest' });
            await sleep(60);
            clickAmazonNode(button);
        }
        if (buttons.length) await sleep(300);
    };
    const waitForAmazonReviewsCount = async (previousCount, timeoutMs = 15000) => {
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
                button.scrollIntoView({ block: 'center', inline: 'nearest' });
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
        const seen = new Set();
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
                const response = await fetch(url, { credentials: 'include' });
                if (!response.ok) break;
                const html = await response.text();
                const doc = parser.parseFromString(html, 'text/html');
                const before = items.length;
                items.push(...collectAmazonReviewsFromDocument(doc, items.length, seen));
                const hasNext = !!(
                    doc.querySelector('li.a-last a, .a-pagination .a-last a')
                    || getAmazonShowMoreButton(doc)
                );
                if (items.length === before || !hasNext) break;
            } catch (_) {
                break;
            }
            await sleep(180);
        }
        return {
            header: `Отзывы (выгружено ${Math.min(items.length, limit)})`,
            items: items.slice(0, limit),
            unavailable: !items.length,
        };
    };
    const collectAmazonReviewsForProduct = async (maxReviews = AMAZON_DEFAULT_MAX_REVIEWS) => {
        const asin = getAsin();
        if (!asin) return { header: 'Отзывы: ASIN не найден', items: [], unavailable: true };
        if (!isAmazonReviewsRoute()) {
            const fromTempTab = await requestAmazonReviewsInTempTab(buildAmazonReviewsUrl(asin, 1), { maxReviews });
            if (fromTempTab && Array.isArray(fromTempTab.items)) return fromTempTab;
        }
        return collectAmazonReviewsFromPages(maxReviews, asin);
    };
    const buildAmazonExportPackage = async (opts = {}) => {
        const includeReviews = opts.includeReviews !== false;
        const maxReviews = opts.allReviews === true
            ? (Number(opts.maxReviews) || AMAZON_ALL_MAX_REVIEWS)
            : (Number(opts.maxReviews) || AMAZON_DEFAULT_MAX_REVIEWS);
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
            '=== CARD SUMMARY (AMAZON) ===',
            `URL: ${url}`,
            `ASIN: ${asin || '—'}`,
            `Бренд/магазин: ${brand || '—'}`,
            `Продавец: ${getSeller()}`,
            `Заголовок: ${title}`,
            `Цена: ${formatPrice(priceInfo)}`,
            `Наличие: ${getAvailability()}`,
            `Рейтинг: ${rating.rating} (${rating.reviews} отзывов)`,
            image ? `Изображение: ${image}` : '',
            '',
            '=== ВАРИАНТ ===',
            variations,
            '',
            '=== ОПИСАНИЕ / БУЛЛЕТЫ ===',
            ...(bullets.length ? bullets.map((item) => `- ${item}`) : ['—']),
            '',
            '=== ХАРАКТЕРИСТИКИ ===',
            ...toBullets(specs),
            '',
            '=== PRODUCT DESCRIPTION ===',
            description,
        ].filter((line) => line !== '');
        if (includeReviews) {
            const reviews = await collectAmazonReviewsForProduct(maxReviews);
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
            market: 'amazon',
            pidKey: asin ? `amazon:${asin}` : '',
            url,
            title,
            filename: `${slug(title || asin || 'amazon')}.txt`,
            text,
        };
    };
    const restoreCardFocus = async () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await sleep(220);
    };
    const exportAmazon = async (opts = {}) => {
        const includeReviews = opts.includeReviews !== false;
        const pack = await buildAmazonExportPackage(opts);
        if (opts.copyOnly) {
            await copyToClipboard(pack.text);
            await saveLastExtractSessionFromItem(pack, { mode: 'copy', allReviews: includeReviews });
            try { await showExportMarkMaybe({ mode: 'copy', scope: 'single', market: 'amazon' }); } catch (_) {}
        } else {
            downloadTextFile(pack.filename, pack.text);
            await saveLastExtractSessionFromItem(pack, { mode: 'download', allReviews: includeReviews });
            try { await showExportMarkMaybe({ mode: 'download', scope: 'single', market: 'amazon' }); } catch (_) {}
        }
        let shouldRestore = true;
        try { shouldRestore = await shouldRestoreFocusMaybe('single'); } catch (_) { shouldRestore = true; }
        if (shouldRestore) await restoreCardFocus();
    };

    function initAmazon() {
        ensureScrollTopButton();
        setRestoreFocus(restoreCardFocus);
        setRunExport((options = {}) => buildAmazonExportPackage(options));
        if (globalThis.chrome && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
                if (!message || message.scope !== 'owb-amazon-reviews') return undefined;
                if (String(message.action || '') !== 'collect-reviews') return undefined;
                (async () => {
                    if (!isAmazonReviewsRoute()) throw new Error('Current page is not Amazon reviews route');
                    return collectAmazonReviewsFromPages(Number(message.payload?.maxReviews) || AMAZON_DEFAULT_MAX_REVIEWS);
                })().then((data) => sendResponse({ ok: true, data })).catch((err) => {
                    sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
                });
                return true;
            });
        }
        setInterval(() => {
            if (!isProductPage()) return;
            attachActionButtons(getTitleNode(), 'amazon', [
                { label: 'Скачать', kind: 'full', run: () => exportAmazon({ copyOnly: false, includeReviews: true }) },
                { label: 'все отзывы', kind: 'all', run: () => exportAmazon({ copyOnly: false, includeReviews: true, allReviews: true }) },
                { label: 'в буфер', kind: 'copy', pendingText: 'Копирую...', successText: 'Скопировано', toastSuccess: 'Скопировано в буфер', run: () => exportAmazon({ copyOnly: true, includeReviews: false }) },
                { label: 'в буфер с отзывами', kind: 'copy_all', pendingText: 'Копирую...', successText: 'Скопировано', toastSuccess: 'Скопировано в буфер', run: () => exportAmazon({ copyOnly: true, includeReviews: true }) },
            ]);
        }, 1000);
    }

    initAmazon();
})();

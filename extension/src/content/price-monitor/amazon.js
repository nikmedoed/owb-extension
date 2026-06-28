(() => {
    'use strict';

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
        findPriceInCard,
    } = PM;

    const clean = cleanText;
    const AMAZON_ASIN_RE = /^[A-Z0-9]{10}$/;
    const normalizeAsin = (value) => {
        const raw = String(value || '').trim().toUpperCase();
        return AMAZON_ASIN_RE.test(raw) ? raw : '';
    };
    const getAsinFromHref = (href) => {
        try {
            const url = new URL(String(href || ''), location.href);
            const path = String(url.pathname || '');
            const m = path.match(/\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i)
                || path.match(/\/([A-Z0-9]{10})(?:[/?#]|$)/i);
            const fromPath = normalizeAsin(m && m[1]);
            if (fromPath) return fromPath;
            for (const key of ['pd_rd_i', 'asin', 'ASIN']) {
                const fromQuery = normalizeAsin(url.searchParams.get(key));
                if (fromQuery) return fromQuery;
            }
            return '';
        } catch (_) {
            return '';
        }
    };
    const getAsinFromCsaItemId = (value) => {
        const m = String(value || '').match(/(?:^|[.:])asin\.([A-Z0-9]{10})(?:[.:]|$)/i)
            || String(value || '').match(/\b([A-Z0-9]{10})\b/i);
        return normalizeAsin(m && m[1]);
    };
    const getPid = () => {
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
        return getAsinFromHref(document.querySelector('link[rel="canonical"]')?.href || '');
    };
    const isProductPage = () => /\/(?:dp|gp\/product|exec\/obidos\/ASIN)\/[A-Z0-9]{10}(?:[/?#]|$)/i.test(location.pathname || '')
        || !!document.querySelector('#dp, #centerCol #title, #ppd #title');
    const getPriceRoot = () => document.querySelector('#corePriceDisplay_desktop_feature_div')
        || document.querySelector('#corePrice_feature_div')
        || document.querySelector('#apex_desktop')
        || document.querySelector('#buybox')
        || document.querySelector('#centerCol')
        || null;
    const getAnchor = () => getPriceRoot();
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
    const getPagePrice = () => {
        const hiddenValue = document.querySelector('input#priceValue, input[name="priceValue"]')?.value;
        const hiddenPrice = Number(String(hiddenValue || '').replace(',', '.'));
        if (Number.isFinite(hiddenPrice) && hiddenPrice > 0) {
            const symbol = document.querySelector('input#priceSymbol, input[name="priceSymbol"]')?.value || '$';
            const currency = normalizeCurrency(symbol || document.querySelector('input#currencyOfPreference')?.value || 'USD') || '$';
            return { price: hiddenPrice, currency, text: `${symbol}${hiddenValue}` };
        }

        const selectors = [
            '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
            '#corePriceDisplay_desktop_feature_div [data-a-color="price"] .a-offscreen',
            '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
            '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen',
            '#apex_desktop .a-price:not(.a-text-price) .a-offscreen',
            '#buybox .a-price:not(.a-text-price) .a-offscreen',
        ];
        for (const selector of selectors) {
            const nodes = [...document.querySelectorAll(selector)].filter((node) => !isOldPriceNode(node));
            for (const node of nodes) {
                const parsed = parsePriceNode(node);
                if (parsed) return parsed;
            }
        }
        const root = getPriceRoot();
        const info = findPriceInCard(root || document.body, { defaultCurrency: '$' });
        return info && Number.isFinite(Number(info.price))
            ? { price: Number(info.price), currency: info.currency || '$', text: root?.textContent || '' }
            : null;
    };

    const getCardPid = (card) => {
        if (!card) return '';
        const attrs = [
            card.getAttribute('data-asin'),
            card.getAttribute('data-csa-c-asin'),
            card.getAttribute('data-csa-c-item-id'),
            card.querySelector('[data-asin]')?.getAttribute('data-asin'),
            card.querySelector('[data-csa-c-asin]')?.getAttribute('data-csa-c-asin'),
            card.querySelector('[data-csa-c-item-id]')?.getAttribute('data-csa-c-item-id'),
        ];
        for (const value of attrs) {
            const asin = getAsinFromCsaItemId(value) || normalizeAsin(value);
            if (asin) return asin;
        }
        const link = card.querySelector('a[href*="/dp/"], a[href*="/gp/product/"], a[href*="pd_rd_i="], a[href*="asin="]');
        return getAsinFromHref(link?.getAttribute('href') || link?.href || '');
    };
    const getCardPrice = (card) => {
        if (!card) return null;
        const dataPrice = Number(String(card.getAttribute('data-price') || '').replace(',', '.'));
        if (Number.isFinite(dataPrice) && dataPrice > 0) {
            const text = card.getAttribute('data-price') || '';
            return { price: dataPrice, currency: normalizeCurrency(detectCurrency(text) || '$'), text };
        }
        const selectors = [
            '.a-price:not(.a-text-price):not([data-a-strike="true"]) .a-offscreen',
            '.a-price[data-a-color="price"] .a-offscreen',
            '.dcl-product-price-new .a-offscreen',
            '.sc-apex-cart-price .a-price .a-offscreen',
            '[data-a-color="price"] .a-offscreen',
        ];
        for (const selector of selectors) {
            const nodes = [...card.querySelectorAll(selector)].filter((node) => !isOldPriceNode(node));
            for (const node of nodes) {
                const parsed = parsePriceNode(node);
                if (parsed) return parsed;
            }
        }
        const info = findPriceInCard(card, { defaultCurrency: '$' });
        return info && Number.isFinite(Number(info.price))
            ? { price: Number(info.price), currency: info.currency || '$', text: card.textContent || '' }
            : null;
    };
    const isCardCandidate = (card) => {
        if (!card || !card.isConnected) return false;
        if (card.closest('#customerReviews, #reviewsMedley, [id*="review" i]')) return false;
        const rect = card.getBoundingClientRect();
        if ((rect.width || 0) < 90 || (rect.height || 0) < 90) return false;
        if (!card.querySelector('img, picture')) return false;
        return !!getCardPid(card);
    };
    const getBadgeTarget = (card) => {
        const image = card?.querySelector?.('img.s-image, .s-product-image-container img, .dcl-product-image-container img, img');
        let target = image?.closest?.('.sc-image-wrapper, .s-product-image-container, .dcl-product-image-container, .a-section.aok-relative, .a-carousel-card')
            || image?.parentElement
            || card;
        if (!target || !card.contains(target)) target = card;
        target.classList.remove('mp-min-price-anchor--below-center');
        target.classList.remove('mp-min-price-anchor--below');
        target.classList.remove('mp-min-price-anchor--photo');
        target.classList.add('mp-min-price-anchor--photo-inside');
        return target;
    };

    const detectCurrentProduct = () => {
        const pid = getPid();
        if (!pid) return null;
        const priceInfo = getPagePrice();
        return {
            market: 'amazon',
            pid,
            pidKey: `amazon:${pid}`,
            currency: priceInfo?.currency || '$',
        };
    };

    setCurrentProductDetector(detectCurrentProduct);
    startProductTracker({ market: 'amazon', getPid, getPrice: getPagePrice, getAnchor, isProductPage });
    startCardScanner({
        collectGroups: () => collectGroupsFromCards({
            market: 'amazon',
            cardSelector: [
                '[data-component-type="s-search-result"]',
                '.s-result-item[data-asin]',
                '.puis-card-container',
                '.sc-list-item[data-asin]',
                '.dcl-product-wrapper',
                '[data-csa-c-item-type="asin"]',
                '[data-csa-c-item-id*="asin."]',
                '.a-carousel-card',
            ].join(', '),
            getPid: getCardPid,
            getPrice: getCardPrice,
            isCardCandidate,
            defaultCurrency: '$',
        }),
        getBadgeTarget,
    });
})();

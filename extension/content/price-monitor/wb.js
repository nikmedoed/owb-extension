(() => {
    'use strict';

    const PM = window.OWBPriceMonitor;
    if (!PM) return;

    const {
        startProductTracker,
        startCardScanner,
        collectGroupsFromCards,
        setCurrentProductDetector,
        parsePriceValue,
        detectCurrency,
        extractDigits,
        findArticleByLabel,
        findBlockAnchor,
        findPriceInCard,
    } = PM;
    function initWB() {
        const getPid = () => {
            const fromUrl = location.pathname.match(/\/catalog\/(\d{4,})\/detail/i);
            if (fromUrl) return fromUrl[1];
            const nmId = document.querySelector('[data-nm-id]')?.getAttribute('data-nm-id');
            if (nmId) return nmId;
            const sku = document.querySelector('meta[itemprop="sku"], meta[name="item_id"]')?.getAttribute('content') || '';
            const digits = extractDigits(sku);
            if (digits) return digits;
            return findArticleByLabel(document.body);
        };
        const getPriceNode = () => document.querySelector('[class^="priceBlockWalletPrice"], [class*=" priceBlockWalletPrice"]')
            || document.querySelector('ins[class^="priceBlockFinalPrice"], ins[class*=" priceBlockFinalPrice"]')
            || document.querySelector('span[class^="priceBlockPrice"], span[class*=" priceBlockPrice"], [class*="priceBlock"] [class*="price"], [class*="orderBlock"] [class*="price"]');
        const getPrice = () => {
            const node = getPriceNode();
            if (!node) return null;
            const text = node.textContent || '';
            const info = findPriceInCard(node.closest('section,article,div') || node.parentElement || node, { defaultCurrency: '₽' });
            if (info && Number.isFinite(Number(info.price))) return { price: Number(info.price), currency: info.currency || '₽', text };
            const parsed = parsePriceValue(text);
            return Number.isFinite(parsed) ? { price: parsed, currency: detectCurrency(text) || '₽', text } : null;
        };
        const getAnchor = () => {
            const node = getPriceNode();
            if (!node) return null;
            let candidate = null;
            let cur = node;
            while (cur && cur !== document.body) {
                if (cur.tagName === 'DIV' || cur.tagName === 'SECTION' || cur.tagName === 'ARTICLE') {
                    const cls = String(cur.className || '');
                    if (/priceBlock/i.test(cls)) {
                        if (!/priceBlockPrice/i.test(cls)) candidate = cur;
                        else if (!candidate) candidate = cur;
                    } else if (/productPrice/i.test(cls)) {
                        candidate = cur;
                    }
                }
                cur = cur.parentElement;
            }
            return candidate || findBlockAnchor(node, /priceBlock|productPrice|productSummary|priceBlockContent|orderBlock|buybox|basket/i) || node.parentElement || node;
        };
        const isProductPage = () => /\/catalog\/\d{4,}\/detail/i.test(location.pathname || '');
        startProductTracker({ market: 'wb', getPid, getPrice, getAnchor, isProductPage });

        const getCardPid = (card) => {
            if (!card) return '';
            const direct = card.getAttribute('data-nm-id')
                || card.getAttribute('data-popup-nm-id')
                || card.dataset.nmId
                || card.dataset.popupNmId;
            if (direct) return direct;
            const href = card.querySelector('a[href*="/catalog/"]')?.getAttribute('href') || '';
            const m = href.match(/\/catalog\/(\d{4,})\/detail/i);
            return m ? m[1] : '';
        };
        const getCardPrice = (card) => {
            if (!card) return null;
            const walletNode = card.querySelector('.list-item__price-wallet, [class*="list-item__price-wallet"], [class*="price-wallet"]');
            if (walletNode) {
                const text = walletNode.textContent || '';
                const price = parsePriceValue(text);
                if (Number.isFinite(price)) return { price, currency: detectCurrency(text) || '₽', text };
            }
            const primaryNode = card.querySelector('.list-item__price > div, [class*="list-item__price"] [class*="red-price"]');
            if (primaryNode) {
                const text = primaryNode.textContent || '';
                const price = parsePriceValue(text);
                if (Number.isFinite(price)) return { price, currency: detectCurrency(text) || '₽', text };
            }
            const info = findPriceInCard(card, { defaultCurrency: '₽' });
            return info && Number.isFinite(Number(info.price)) ? { price: Number(info.price), currency: info.currency || '₽', text: card.textContent || '' } : null;
        };
        startCardScanner({
            collectGroups: () => collectGroupsFromCards({
                market: 'wb',
                cardSelector: [
                    'article.product-card',
                    'article[data-nm-id]',
                    'article[data-popup-nm-id]',
                    'div.product-card[data-nm-id]',
                    'div.product-card[data-popup-nm-id]',
                    '.basket-list .j-b-basket-item',
                    '.basket-list .accordion__list-item.list-item',
                    '.accordion__list .j-b-basket-item',
                ].join(', '),
                getPid: getCardPid,
                getPrice: getCardPrice,
                defaultCurrency: '₽',
            }),
            getBadgeTarget: (card) => card.querySelector('.list-item__good') || card.querySelector('.list-item__good-info') || card,
        });
    }
    const detectCurrentProduct = () => {
        const path = String(location.pathname || '');
        const fromUrl = path.match(/\/catalog\/(\d{4,})\/detail/i) || path.match(/\/catalog\/(\d{4,})\/feedbacks/i);
        const pid = (fromUrl && fromUrl[1])
            || document.querySelector('[data-nm-id]')?.getAttribute('data-nm-id')
            || extractDigits(document.querySelector('meta[itemprop="sku"], meta[name="item_id"]')?.getAttribute('content') || '')
            || '';
        if (!pid) return null;
        return { market: 'wb', pid, pidKey: `wb:${pid}` };
    };

    setCurrentProductDetector(detectCurrentProduct);
    initWB();
})();

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
    const getPriceNode = () => document.querySelector('[class^="priceBlockWalletPrice"], [class*=" priceBlockWalletPrice"]')
        || document.querySelector('ins[class^="priceBlockFinalPrice"], ins[class*=" priceBlockFinalPrice"]')
        || document.querySelector('span[class^="priceBlockPrice"], span[class*=" priceBlockPrice"], [class*="priceBlock"] [class*="price"], [class*="orderBlock"] [class*="price"]');
    const getPagePrice = () => {
        const node = getPriceNode();
        if (!node) return null;
        const text = node.textContent || '';
        const info = findPriceInCard(node.closest('section,article,div') || node.parentElement || node, { defaultCurrency: '₽' });
        if (info && Number.isFinite(Number(info.price))) return { price: Number(info.price), currency: info.currency || '₽', text };
        const parsed = parsePriceValue(text);
        return Number.isFinite(parsed) ? { price: parsed, currency: detectCurrency(text) || '₽', text } : null;
    };
    function initWB() {
        const parseBasketPriceText = (text) => {
            const raw = String(text || '').replace(/[\u00A0\u202F]/g, ' ').replace(/\s+/g, ' ').trim();
            if (!raw) return null;
            const lowered = raw.toLowerCase();
            if (/(?:\/|за)\s*\d*[.,]?\d*\s*(шт|шту|уп|упак|пак|г|гр|кг|мл|л)\b/.test(lowered)) return null;
            if (/(шт|шту|уп|упак|пак|г|гр|кг|мл|л)\b/.test(lowered) && /(?:\/|за|x|×)/.test(lowered)) return null;
            const numberGroups = raw.match(/\d[\d\s.,]*/g) || [];
            if (numberGroups.length > 1) return null;
            const price = parsePriceValue(raw);
            return Number.isFinite(price) ? { price, currency: detectCurrency(raw) || '₽', text: raw } : null;
        };
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
        startProductTracker({ market: 'wb', getPid, getPrice: getPagePrice, getAnchor, isProductPage });

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
            const favoritesNowNode = card.querySelector('ins[class*="goodsCardPriceNow"], ins[class*="walletPrice"], p[class*="goodsCardPrice"] ins');
            const favoritesInfo = parseBasketPriceText(favoritesNowNode?.textContent || '');
            if (favoritesInfo) return favoritesInfo;
            const primaryNode = card.querySelector('.list-item__price > div, [class*="list-item__price"] [class*="red-price"]');
            const walletNode = card.querySelector('.list-item__price-wallet, [class*="list-item__price-wallet"], [class*="price-wallet"]');
            const primaryInfo = parseBasketPriceText(primaryNode?.textContent || '');
            const walletInfo = parseBasketPriceText(walletNode?.textContent || '');
            if (primaryInfo && walletInfo) {
                const low = Math.min(primaryInfo.price, walletInfo.price);
                const high = Math.max(primaryInfo.price, walletInfo.price);
                if (low > 0 && (high / low) >= 2.5) return primaryInfo.price >= walletInfo.price ? primaryInfo : walletInfo;
                return primaryInfo.price <= walletInfo.price ? primaryInfo : walletInfo;
            }
            if (primaryInfo) return primaryInfo;
            if (walletInfo) return walletInfo;
            const info = findPriceInCard(card, { defaultCurrency: '₽' });
            return info && Number.isFinite(Number(info.price)) ? { price: Number(info.price), currency: info.currency || '₽', text: card.textContent || '' } : null;
        };
        const isWbCartCard = (card) => !!(
            card
            && (
                card.matches('.j-b-basket-item, .accordion__list-item.list-item')
                || card.closest('.basket-list, .accordion__list')
            )
            && card.querySelector('img, picture')
        );
        const getCartBadgeTarget = (card) => {
            const image = card.querySelector('picture img, img');
            let imageBlock = image?.closest('.list-item__photo')
                || image?.closest('[class*="photo"]')
                || image?.closest('[class*="img"]')
                || image?.parentElement
                || card;
            while (imageBlock && imageBlock !== card) {
                const text = String(imageBlock.textContent || '').replace(/\s+/g, ' ').trim();
                if (imageBlock.querySelector('img, picture') && text.length <= 40) break;
                imageBlock = imageBlock.parentElement;
            }
            imageBlock = imageBlock && imageBlock !== card ? imageBlock : (image?.parentElement || card);
            imageBlock.classList.remove('mp-min-price-anchor--below-center');
            imageBlock.classList.remove('mp-min-price-anchor--below');
            imageBlock.classList.remove('mp-min-price-anchor--photo');
            imageBlock.classList.add('mp-min-price-anchor--photo-inside');
            return imageBlock;
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
                    'li[class*="goodsCardFavorites"]',
                    'li[id^="fav"][class*="goodsCard"]',
                ].join(', '),
                getPid: getCardPid,
                getPrice: getCardPrice,
                defaultCurrency: '₽',
            }),
            getBadgeTarget: (card) => (isWbCartCard(card) ? getCartBadgeTarget(card) : (
                card.querySelector('.list-item__good')
                || card.querySelector('.list-item__good-info')
                || card.querySelector('[class*="imgWrap"]')
                || card.querySelector('a[href*="/catalog/"][href*="/detail"]')
                || card
            )),
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
        const priceInfo = getPagePrice();
        return {
            market: 'wb',
            pid,
            pidKey: `wb:${pid}`,
            currency: priceInfo?.currency || '',
        };
    };

    setCurrentProductDetector(detectCurrentProduct);
    initWB();
})();

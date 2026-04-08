(() => {
    'use strict';

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
        findPriceInCard,
    } = PM;
    function initOzon() {
        const pickVisible = (nodes) => (nodes || []).find((el) => el && el.isConnected && el.getClientRects && el.getClientRects().length) || (nodes && nodes[0]) || null;
        const getPid = () => {
            const path = location.pathname;
            const fromUrl = path.match(/\/product\/[^/]*?(\d{5,})(?:\/|$)/) || path.match(/\/product\/(\d{5,})(?:\/|$)/);
            if (fromUrl) return fromUrl[1];
            const sku = extractDigits(document.querySelector('[data-widget="webDetailSKU"]')?.textContent || '');
            if (sku) return sku;
            return findArticleByLabel(document.querySelector('#section-characteristics')) || findArticleByLabel(document.body);
        };
        const getPriceWidget = () => pickVisible([...document.querySelectorAll('[data-widget="webPrice"]')]);
        const getSaleWidget = () => pickVisible([...document.querySelectorAll('[data-widget="webSale"]')]);
        const getPrice = () => {
            const priceWidget = getPriceWidget();
            if (priceWidget) {
                const headline = priceWidget.querySelector('span[class*="tsHeadline"], .tsHeadline600Large, .tsHeadline500Medium');
                const headlineText = headline?.textContent || '';
                if (headlineText) {
                    const headlinePrice = parsePriceValue(headlineText);
                    if (Number.isFinite(headlinePrice)) return { price: headlinePrice, currency: detectCurrency(headlineText) || '₽', text: headlineText };
                }
                const text = priceWidget.querySelector('span')?.textContent || priceWidget.textContent || '';
                const info = findPriceInCard(priceWidget, { defaultCurrency: '₽' });
                if (info && Number.isFinite(Number(info.price))) return { price: Number(info.price), currency: info.currency || '₽', text };
                const parsed = parsePriceValue(text);
                if (Number.isFinite(parsed)) return { price: parsed, currency: detectCurrency(text) || '₽', text };
            }
            const saleWidget = getSaleWidget();
            if (!saleWidget) return null;
            const info = findPriceInCard(saleWidget, { defaultCurrency: '₽' });
            if (info && Number.isFinite(Number(info.price))) return { price: Number(info.price), currency: info.currency || '₽', text: saleWidget.textContent || '' };
            return null;
        };
        const getAnchor = () => getPriceWidget() || getSaleWidget();
        const isProductPage = () => /\/product\/[^/]*?\d{5,}(?:\/|$)/.test(location.pathname || '');
        startProductTracker({ market: 'ozon', getPid, getPrice, getAnchor, isProductPage });

        const extractIdFromOzonMedia = (value) => {
            const text = String(value || '');
            if (!text) return '';
            const parts = text.split(',');
            for (const rawPart of parts) {
                const part = rawPart.trim();
                if (!part) continue;
                const urlPart = part.split(/\s+/)[0] || '';
                const match = urlPart.match(/\/(\d{7,})(?:\.(?:jpe?g|webp|png)|\/|\?|$)/i);
                if (match) return match[1];
            }
            return '';
        };
        const isOzonCartCard = (card) => !!(
            card
            && card.querySelector('img')
            && card.querySelector('.checkout_s1, [class*="checkout_s1"]')
            && card.querySelector('.checkout_r5, [class*="checkout_r5"]')
        );
        const getCardPid = (card) => {
            if (!card) return '';
            const fav = card.querySelector('[favlistslink*="sku="]')?.getAttribute('favlistslink') || card.getAttribute('favlistslink') || '';
            const favMatch = fav.match(/sku=(\d{5,})/);
            if (favMatch) return favMatch[1];
            const dataSku = card.querySelector('[data-sku]')?.getAttribute('data-sku') || card.getAttribute('data-sku') || '';
            const digits = extractDigits(dataSku);
            if (digits) return digits;
            const href = card.querySelector('a[href*="/product/"]')?.getAttribute('href') || '';
            const m = href.match(/\/product\/[^/]*?(\d{5,})(?:\/|\?|$)/) || href.match(/-(\d{5,})(?:\/|\?|$)/);
            if (m) return m[1];
            const image = card.querySelector('img');
            const fromImg = extractIdFromOzonMedia(image?.getAttribute('src'))
                || extractIdFromOzonMedia(image?.getAttribute('srcset'))
                || extractIdFromOzonMedia(image?.currentSrc);
            if (fromImg) return fromImg;
            return '';
        };
        const getCardPrice = (card) => {
            if (!card) return null;
            if (isOzonCartCard(card)) {
                const mainPriceNode = card.querySelector(
                    '.checkout_s1 .tsHeadline400Small, .checkout_s1 [class*="tsHeadline"], [class*="checkout_s1"] [class*="tsHeadline"], .checkout_o4 [class*="tsHeadline"]',
                );
                if (mainPriceNode) {
                    const text = mainPriceNode.textContent || '';
                    const price = parsePriceValue(text);
                    if (Number.isFinite(price)) return { price, currency: detectCurrency(text) || '₽', text };
                }
                const checkoutPriceBlock = card.querySelector('.checkout_s1, [class*="checkout_s1"], .checkout_o4, [class*="checkout_o4"]');
                const checkoutInfo = findPriceInCard(checkoutPriceBlock || card, { defaultCurrency: '₽' });
                if (checkoutInfo && Number.isFinite(Number(checkoutInfo.price))) {
                    return {
                        price: Number(checkoutInfo.price),
                        currency: checkoutInfo.currency || '₽',
                        text: checkoutPriceBlock?.textContent || card.textContent || '',
                    };
                }
            }
            // Ozon often renders tile prices via headline typography (including skuGrid cards).
            const headlineNodes = [...card.querySelectorAll('span[class*="tsHeadline"], div[class*="tsHeadline"]')];
            let headlineBest = null;
            for (const node of headlineNodes) {
                const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
                if (!text || !/\d/.test(text) || /%/.test(text)) continue;
                if (/отзыв|шт\b|остал|рейтинг|балл/i.test(text)) continue;
                if (!/[₽€$֏₸]/.test(text) && !/(^|\D)\d{2,}(\D|$)/.test(text)) continue;
                const price = parsePriceValue(text);
                if (!Number.isFinite(price)) continue;
                const currency = detectCurrency(text) || detectCurrency(card.textContent || '') || '₽';
                const cand = { price, currency, text };
                if (!headlineBest || cand.price < headlineBest.price) headlineBest = cand;
            }
            if (headlineBest) return headlineBest;
            const info = findPriceInCard(card, { defaultCurrency: '₽' });
            return info && Number.isFinite(Number(info.price)) ? { price: Number(info.price), currency: info.currency || '₽', text: card.textContent || '' } : null;
        };
        startCardScanner({
            collectGroups: () => collectGroupsFromCards({
                market: 'ozon',
                cardSelector: [
                    'div[class*="tile-root"]',
                    '[data-widget="skuGrid"] [data-index]',
                    'article[class*="tile"]',
                    'div[data-sku][class*="tile"]',
                    '[data-widget="cartSplit"] .checkout_r9',
                    '[data-widget="cartSplit"] [class*="checkout_r9"]',
                ].join(', '),
                getPid: getCardPid,
                getPrice: getCardPrice,
                isCardCandidate: (card) => isOzonCartCard(card) || isBadgeCardCandidate(card, 'ozon'),
                defaultCurrency: '₽',
            }),
            getBadgeTarget: (card) => card.querySelector('.checkout_s0, [class*="checkout_s0"]') || card.querySelector('.checkout_r5, [class*="checkout_r5"]') || card,
        });
    }
    const detectCurrentProduct = () => {
        const path = String(location.pathname || '');
        const fromUrl = path.match(/\/product\/[^/]*?(\d{5,})(?:\/|$)/) || path.match(/\/product\/(\d{5,})(?:\/|$)/);
        const pid = (fromUrl && fromUrl[1])
            || extractDigits(document.querySelector('[data-widget="webDetailSKU"]')?.textContent || '')
            || findArticleByLabel(document.querySelector('#section-characteristics'))
            || '';
        if (!pid) return null;
        const priceInfo = getPrice();
        return {
            market: 'ozon',
            pid,
            pidKey: `ozon:${pid}`,
            currency: priceInfo?.currency || '',
        };
    };

    setCurrentProductDetector(detectCurrentProduct);
    initOzon();
})();

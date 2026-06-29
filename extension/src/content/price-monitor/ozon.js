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
    const pickVisible = (nodes) => (nodes || []).find((el) => el && el.isConnected && el.getClientRects && el.getClientRects().length) || (nodes && nodes[0]) || null;
    const getPriceWidget = () => pickVisible([...document.querySelectorAll('[data-widget="webPrice"]')]);
    const getSaleWidget = () => pickVisible([...document.querySelectorAll('[data-widget="webSale"]')]);
    const isOldPriceNode = (node) => {
        if (!node) return false;
        if (node.closest('del, s')) return true;
        let cur = node;
        while (cur && cur !== document.body) {
            const raw = `${cur.className || ''} ${cur.getAttribute?.('style') || ''}`.toLowerCase();
            if (/old|strike|cross|line-through|linethrough/.test(raw)) return true;
            cur = cur.parentElement;
        }
        try {
            return /line-through/i.test(getComputedStyle(node).textDecoration || '');
        } catch (_) {
            return false;
        }
    };
    const isBadProductPriceText = (text) => {
        const t = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!t || /%/.test(t)) return true;
        return /балл|кешб|рассроч|достав|возврат|скидк|продав|отзыв|вопрос|единиц|остал|купить|корзин|шт\b|за\s+\d/.test(t);
    };
    const getCurrentPriceFromWidget = (widget) => {
        if (!widget) return null;
        const nodes = [...widget.querySelectorAll('span, div')]
            .filter((node) => !node.closest('.mp-price-chart, .mp-min-price-badge'))
            .map((node) => {
                const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
                if (!text || isBadProductPriceText(text) || isOldPriceNode(node)) return null;
                const price = parsePriceValue(text);
                if (!Number.isFinite(price)) return null;
                const currency = detectCurrency(text) || '₽';
                const cls = String(node.className || '');
                let rect = { width: 0, height: 0 };
                let style = null;
                try {
                    rect = node.getBoundingClientRect();
                    style = getComputedStyle(node);
                } catch (_) {}
                if ((rect.width || 0) <= 0 || (rect.height || 0) <= 0) return null;
                const fontSize = parseFloat(style?.fontSize || '') || 0;
                const weight = parseFloat(style?.fontWeight || '') || 0;
                const headlineScore = /tsHeadline|headline/i.test(cls) ? 40 : 0;
                const score = headlineScore + fontSize + (weight >= 600 ? 10 : 0) - Math.min(20, text.length / 8);
                return { price, currency, text, score };
            })
            .filter(Boolean)
            .sort((a, b) => (b.score - a.score) || (a.price - b.price));
        return nodes[0] || null;
    };
    const getPagePrice = () => {
        const priceWidget = getPriceWidget();
        if (priceWidget) {
            const current = getCurrentPriceFromWidget(priceWidget);
            if (current) return { price: current.price, currency: current.currency || '₽', text: current.text };
        }
        const saleWidget = getSaleWidget();
        if (!saleWidget) return null;
        const current = getCurrentPriceFromWidget(saleWidget);
        return current ? { price: current.price, currency: current.currency || '₽', text: current.text } : null;
    };
    function initOzon() {
        const getPid = () => {
            const path = location.pathname;
            const fromUrl = path.match(/\/product\/[^/]*?(\d{5,})(?:\/|$)/) || path.match(/\/product\/(\d{5,})(?:\/|$)/);
            if (fromUrl) return fromUrl[1];
            const sku = extractDigits(document.querySelector('[data-widget="webDetailSKU"]')?.textContent || '');
            if (sku) return sku;
            return findArticleByLabel(document.querySelector('#section-characteristics')) || findArticleByLabel(document.body);
        };
        const getAnchor = () => getPriceWidget() || getSaleWidget();
        const isProductPage = () => /\/product\/[^/]*?\d{5,}(?:\/|$)/.test(location.pathname || '');
        startProductTracker({ market: 'ozon', getPid, getPrice: getPagePrice, getAnchor, isProductPage });

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
        const isDirectCartChild = (card) => {
            const root = card?.closest?.('[data-widget="cartSplit"]');
            return !!(root && card.parentElement === root);
        };
        const isOzonCartCard = (card) => {
            if (!card || !isDirectCartChild(card)) return false;
            if (!card.querySelector('img')) return false;
            const hasTitle = !!card.querySelector(
                'a[href*="/product/"], [class*="checkout_p2"], [class*="tsCompact500"], [class*="tsCompact400"]',
            );
            if (!hasTitle) return false;
            const text = String(card.textContent || '').replace(/\s+/g, ' ').trim();
            const hasCartSignals = /купить|похожие|закончился|количество ограничено|осталось\s+\d+/i.test(text);
            const priceInfo = findPriceInCard(card, { defaultCurrency: '₽' });
            return !!(hasCartSignals || (priceInfo && Number.isFinite(Number(priceInfo.price))));
        };
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
            if (isOzonCartCard(card)) return '';
            if (card.closest('[data-widget="skuGrid"]')) return '';
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
                for (const block of [...card.children]) {
                    if (!block || !block.querySelector) continue;
                    const info = findPriceInCard(block, { defaultCurrency: '₽' });
                    if (info && Number.isFinite(Number(info.price))) {
                        return {
                            price: Number(info.price),
                            currency: info.currency || '₽',
                            text: block.textContent || card.textContent || '',
                        };
                    }
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
        const getCartBadgeTarget = (card) => {
            const image = card?.querySelector('picture img, img');
            let imageBlock = image?.parentElement;
            if (imageBlock?.tagName === 'PICTURE') imageBlock = imageBlock.parentElement;
            if (!imageBlock || !card.contains(imageBlock)) {
                imageBlock = image?.closest('div') || image || card;
            }
            imageBlock.classList.remove('mp-min-price-anchor--below-center');
            imageBlock.classList.remove('mp-min-price-anchor--below');
            imageBlock.classList.remove('mp-min-price-anchor--photo');
            imageBlock.classList.add('mp-min-price-anchor--photo-inside');
            return imageBlock;
        };
        startCardScanner({
            collectGroups: () => collectGroupsFromCards({
                market: 'ozon',
                cardSelector: [
                    'div[class*="tile-root"]',
                    'article[class*="tile"]',
                    'div[data-sku][class*="tile"]',
                    '[data-widget="cartSplit"] > div',
                    '[data-widget="cartSplit"] > section',
                    '[data-widget="cartSplit"] > article',
                ].join(', '),
                getPid: getCardPid,
                getPrice: getCardPrice,
                isCardCandidate: (card) => isOzonCartCard(card) || isBadgeCardCandidate(card, 'ozon'),
                defaultCurrency: '₽',
            }),
            getBadgeTarget: (card) => {
                if (isOzonCartCard(card)) return getCartBadgeTarget(card);
                return card.querySelector('.checkout_s0, [class*="checkout_s0"]') || card.querySelector('.checkout_r5, [class*="checkout_r5"]') || card;
            },
            shouldCaptureGroup: (group) => {
                const currentPid = (String(location.pathname || '').match(/\/product\/[^/]*?(\d{5,})(?:\/|$)/) || [])[1] || '';
                return !currentPid || group.pidKey !== `ozon:${currentPid}`;
            },
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
        const priceInfo = getPagePrice();
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

(() => {
    'use strict';

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
        getAliCurrencyFromAttrs,
    } = PM;

    const clean = cleanText;
    const getPidFromHref = (href) => getAliProductIdFromHref(href, location.href);
    const getCurrencyFromAttrs = getAliCurrencyFromAttrs;
    const getPidFromCard = (card) => {
        const direct = card?.getAttribute?.('data-product-id') || card?.dataset?.productId || '';
        if (/^\d{8,}$/.test(String(direct))) return String(direct);
        const href = card?.querySelector?.('a[href*="/item/"], a[href*="/i/"]')?.getAttribute('href') || '';
        return getPidFromHref(href);
    };
    const getPid = () => {
        return getAliProductIdFromDocument(document, location.href);
    };
    const getPriceRoot = () => document.querySelector('[data-testid="HazeProductPrice"] [data-unformatted-price], [data-testid="HazeProductPrice"][data-unformatted-price]')
        || document.querySelector('[style*="--area:price"] [data-unformatted-price], [style*="--area:price"][data-unformatted-price]')
        || document.querySelector('#buyNowButton [exp_attribute*="finalPrice:"]')
        || document.querySelector('[data-unformatted-price]')
        || document.querySelector('#buyNowButton [data-testid="buynowBtn"]')
        || null;
    const getPriceArea = () => {
        const root = getPriceRoot();
        if (!root) return null;
        return root.closest('[style*="--area:price"]')
            || root.closest('[data-testid="HazeProductPrice"]')?.parentElement
            || root.parentElement
            || null;
    };
    const getOrCreateChartAnchor = () => {
        const area = getPriceArea();
        if (!area) return null;
        const anchors = [...area.children].filter((node) => node.classList?.contains('mp-ali-price-chart-anchor'));
        let anchor = anchors[0] || null;
        anchors.slice(1).forEach((extra) => extra.remove());
        if (!anchor) {
            anchor = document.createElement('div');
            anchor.className = 'mp-ali-price-chart-anchor';
            anchor.setAttribute('aria-hidden', 'true');
            anchor.style.cssText = 'display:block;width:100%;height:0;overflow:hidden;';

            const primaryBox = getPriceRoot()?.closest('[style*="--border"], [style*="--bgColor"]');
            if (primaryBox && primaryBox.parentElement && area.contains(primaryBox)) {
                primaryBox.insertAdjacentElement('afterend', anchor);
            } else {
                area.appendChild(anchor);
            }
        }
        return anchor;
    };
    const hashSkuSignature = (value) => {
        let hash = 5381;
        const text = String(value || '');
        for (let i = 0; i < text.length; i += 1) {
            hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
        }
        return (hash >>> 0).toString(36);
    };
    const getSelectedSkuSignature = () => {
        const skuRoot = document.querySelector('[style*="--area:sku"] [data-spm="sku_floor"], [data-spm="sku_floor"]');
        if (!skuRoot) return '';
        const parts = [...skuRoot.querySelectorAll('[class*="SkuPropertyItem__skuProp"]')]
            .map((prop, index) => {
                const labels = [...prop.querySelectorAll('[class*="SkuPropertyItem__propName"]')]
                    .map((node) => clean(node.textContent || '').replace(/:$/, ''))
                    .filter(Boolean);
                const name = labels[0] || `prop${index + 1}`;
                const selected = labels.slice(1).join(' ') || clean(prop.querySelector('[data-testid="skuProp"][class*="optionActive"]')?.textContent || '');
                const active = prop.querySelector('[data-testid="skuProp"][class*="optionActive"]');
                const image = active?.querySelector?.('img')?.getAttribute('src') || '';
                const activeIndex = active ? [...prop.querySelectorAll('[data-testid="skuProp"]')].indexOf(active) : -1;
                return [name, selected, image, activeIndex].filter((item) => item !== '' && item !== -1).join('=');
            })
            .filter(Boolean);
        return parts.length ? parts.join('|') : '';
    };
    const getPidKey = (pid = getPid()) => {
        if (!pid) return '';
        const skuSignature = getSelectedSkuSignature();
        return skuSignature ? `aliexpress:${pid}:sku:${hashSkuSignature(skuSignature)}` : `aliexpress:${pid}`;
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
        const text = clean(root.textContent || '');
        const attrValue = root.getAttribute?.('data-unformatted-price');
        const attrPrice = attrValue != null ? Number(String(attrValue).replace(',', '.')) : NaN;
        const attrCurrency = getCurrencyFromAttrs(root) || normalizeCurrency(detectCurrency(text)) || defaultCurrency;
        if (Number.isFinite(attrPrice)) return { price: attrPrice, currency: attrCurrency, text };
        const expPrice = parsePriceFromExpAttribute(root);
        if (expPrice) return {
            price: expPrice.price,
            currency: expPrice.currency || attrCurrency,
            text: expPrice.text || text,
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
            const raw = `${cur.tagName || ''} ${cur.className || ''} ${cur.getAttribute?.('style') || ''}`.toLowerCase();
            if (/\bdel\b|strike|strikethrough|line[-_]?through|linethrough|originalprice|oldprice|priceold/i.test(raw)) return true;
            cur = cur.parentElement;
        }
        return false;
    };
    const isShippingText = (text) => /delivery|shipping|достав|post office|courier/i.test(String(text || ''));
    const getNodeContext = (node, boundary) => {
        const parts = [];
        let cur = node;
        for (let i = 0; cur && cur !== document.body && i < 5; i += 1) {
            parts.push(cur.getAttribute?.('title') || '');
            parts.push(cur.textContent || '');
            parts.push(String(cur.className || ''));
            if (i <= 2 && cur.querySelectorAll) {
                [...cur.querySelectorAll('img')].slice(0, 4).forEach((img) => {
                    parts.push(img.getAttribute('src') || '');
                    parts.push(img.getAttribute('data-src') || '');
                    parts.push(img.getAttribute('alt') || '');
                });
            }
            if (cur === boundary) break;
            cur = cur.parentElement;
        }
        return clean(parts.filter(Boolean).join(' '));
    };
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
        return {
            price,
            currency,
            text,
        };
    };
    const getLeafNodes = (root) => [...(root?.querySelectorAll?.('span, div, p, strong, b') || [])]
        .filter((node) => !node.closest('.mp-min-price-badge') && (!node.children || node.children.length === 0));
    const hasMoneyText = (text) => /\d/.test(String(text || '')) && !!detectCurrency(text);
    const findCompactMoneyAncestor = (node, boundary) => {
        let cur = node;
        for (let i = 0; cur && cur !== document.body && i < 5; i += 1) {
            const text = clean(cur.textContent || '');
            if (hasMoneyText(text) && text.length <= 140) return cur;
            if (cur === boundary) break;
            cur = cur.parentElement;
        }
        return null;
    };
    const findListingDeliveryRoots = (card) => {
        if (!card?.querySelectorAll) return [];
        const roots = new Set();
        [...card.querySelectorAll('div, span, p')].forEach((node) => {
            const context = `${node.getAttribute?.('title') || ''} ${node.textContent || ''} ${String(node.className || '')}`;
            const text = clean(node.textContent || '');
            if (!isShippingText(context) || !hasMoneyText(text) || text.length > 180) return;
            roots.add(node);
        });
        [...card.querySelectorAll('img')].forEach((img) => {
            const imgContext = [
                img.getAttribute('src') || '',
                img.getAttribute('data-src') || '',
                img.getAttribute('alt') || '',
                String(img.className || ''),
            ].join(' ');
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
                })(),
            });
        });

        productCandidates.sort((a, b) => (b.score - a.score) || (b.price - a.price));
        const product = productCandidates[0] || null;
        if (!product) return null;

        findListingDeliveryRoots(card).forEach((root) => {
            const delivery = parseDeliveryPrice(root, product.currency || '');
            if (delivery && Number.isFinite(Number(delivery.price))) shippingCandidates.push(delivery);
        });
        const sameCurrencyShipping = shippingCandidates
            .filter((item) => !product.currency || !item.currency || item.currency === product.currency)
            .sort((a, b) => a.price - b.price);
        const shipping = sameCurrencyShipping[0] || null;
        const shippingPrice = shipping && Number(shipping.price) < 100 ? Number(shipping.price) : (hasFreeShipping ? 0 : 0);
        return {
            price: Number(product.price) + shippingPrice,
            currency: product.currency || shipping?.currency || '',
            text: shipping
                ? `product:${product.text}; shipping:${shipping.text}`
                : `product:${product.text}; shipping:${hasFreeShipping ? 'free' : 'unknown'}`,
        };
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
        return (scoped.length ? scoped : leaves)
            .filter((item) => Number(item.price) < 100)
            .sort((a, b) => a.price - b.price)[0] || null;
    };
    const getPagePrice = () => {
        const product = parsePriceFromRoot(getPriceRoot(), '', { allowGeneric: false });
        if (!product || !Number.isFinite(Number(product.price))) return product;
        const priceArea = getPriceArea();
        const deliveryRoot = priceArea?.querySelector?.('[data-testid="RedProductDelivery"]')
            || document.querySelector('[data-testid="RedProductDelivery"]');
        const delivery = parseDeliveryPrice(deliveryRoot, product.currency || '');
        const deliveryPrice = delivery && Number.isFinite(Number(delivery.price)) ? Number(delivery.price) : 0;
        return {
            price: Number(product.price) + deliveryPrice,
            currency: product.currency || delivery?.currency || '',
            text: delivery
                ? `product:${product.text}; shipping:${delivery.text}`
                : `product:${product.text}; shipping:unknown`,
        };
    };
    const getAnchor = () => getOrCreateChartAnchor();
    const isProductPage = () => !!getPidFromHref(location.href) || !!document.querySelector('[data-product-description="true"] h1');

    const getRootProductPids = (root) => {
        if (!root || !root.querySelectorAll) return [];
        return [...new Set([...root.querySelectorAll('a[href*="/item/"], a[href*="/i/"]')]
            .map((a) => getPidFromHref(a.getAttribute('href') || a.href || ''))
            .filter(Boolean))];
    };
    const getMainImage = (root) => {
        if (!root || !root.querySelectorAll) return null;
        const images = [...root.querySelectorAll('picture img, img')]
            .filter((img) => {
                if (!img || img.closest('.mp-min-price-badge')) return false;
                const rect = img.getBoundingClientRect();
                const width = rect.width || img.naturalWidth || 0;
                const height = rect.height || img.naturalHeight || 0;
                if (width < 70 || height < 70) return false;
                const src = String(img.currentSrc || img.src || img.getAttribute('src') || '');
                if (/sprite|icon|logo|avatar|badge/i.test(src)) return false;
                return true;
            })
            .map((img) => {
                const rect = img.getBoundingClientRect();
                return {
                    img,
                    area: (rect.width || img.naturalWidth || 0) * (rect.height || img.naturalHeight || 0),
                };
            })
            .sort((a, b) => b.area - a.area);
        return images[0]?.img || null;
    };
    const findCardRoot = (link, pid) => {
        let cur = link;
        let best = link;
        for (let i = 0; cur && cur !== document.body && i < 8; i += 1) {
            const pids = getRootProductPids(cur);
            if (pids.length > 1 && (!pid || pids.some((item) => item !== pid))) break;
            const hasImage = !!getMainImage(cur);
            const hasPrice = !!parsePriceFromRoot(cur, '', { allowGeneric: true });
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
            const imageBox = image?.closest?.('[data-type="Element-Gallery"], [class*="Gallery__gallery"], [class*="picListWrapper"]')
                || (image?.parentElement?.tagName === 'PICTURE' ? image.parentElement.parentElement : image?.parentElement);
            if (imageBox && outerLink.contains(imageBox)) return imageBox;
            return outerLink;
        }
        const cartImageLink = card.querySelector('a[data-testid="productImageLink"][href*="/item/"]');
        if (cartImageLink && getMainImage(cartImageLink)) return cartImageLink;
        const links = [...card.querySelectorAll('a[href*="/item/"], a[href*="/i/"]')];
        const withImages = links
            .filter((link) => !!getMainImage(link))
            .map((link) => {
                const rect = link.getBoundingClientRect();
                return { link, area: (rect.width || 0) * (rect.height || 0), rect };
            })
            .filter((item) => (item.rect.width || 0) >= 80 && (item.rect.height || 0) >= 80)
            .sort((a, b) => b.area - a.area);
        return withImages[0]?.link || null;
    };
    const findCartItemRootFromImageLink = (link) => {
        const closestItem = link?.closest?.('[id^="cart-item-"], [data-testid="productContainer"]');
        if (closestItem?.querySelector?.('[data-product-unformatted-price]')) return closestItem;

        let cur = link;
        for (let i = 0; cur && cur !== document.body && i < 8; i += 1) {
            if (cur.querySelector?.('[data-product-unformatted-price]') && cur.querySelector?.('[data-testid="productImageLink"]')) {
                return cur;
            }
            cur = cur.parentElement;
        }
        return null;
    };
    const getCartCards = () => {
        const out = [];
        const seen = new Set();
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
        const nodes = [...card.querySelectorAll('div, span, p')]
            .filter((node) => {
                if (priceNode && node.contains?.(priceNode)) return false;
                const text = clean(node.textContent || '');
                if (!text || !/delivery|shipping|достав/i.test(text)) return false;
                return text.length <= 180;
            })
            .map((node) => ({
                node,
                text: clean(node.textContent || ''),
                className: String(node.className || ''),
            }));

        const preferred = nodes
            .filter((item) => /ProductShipping|ShippingInfo|delivery|shipping/i.test(item.className))
            .sort((a, b) => a.text.length - b.text.length)[0];
        return preferred?.node || nodes.sort((a, b) => a.text.length - b.text.length)[0]?.node || null;
    };
    const parseCartCardPrice = (card) => {
        const priceNode = card?.querySelector?.('[data-product-unformatted-price]');
        const rawPrice = priceNode?.getAttribute?.('data-product-unformatted-price');
        const productPrice = rawPrice != null ? Number(String(rawPrice).replace(',', '.')) : NaN;
        if (!Number.isFinite(productPrice)) return null;
        const productText = clean(priceNode?.textContent || '');
        const deliveryRoot = findCartDeliveryRoot(card, priceNode);
        const productCurrency = normalizeCurrency(detectCurrency(productText) || detectCurrency(deliveryRoot?.textContent || '') || detectCurrency(card?.textContent || ''));
        const delivery = parseDeliveryPrice(deliveryRoot, productCurrency || '');
        const deliveryPrice = delivery && Number.isFinite(Number(delivery.price)) ? Number(delivery.price) : 0;
        return {
            price: productPrice + deliveryPrice,
            currency: productCurrency || delivery?.currency || '',
            text: delivery
                ? `product:${productText || rawPrice}; shipping:${delivery.text}`
                : `product:${productText || rawPrice}; shipping:unknown`,
        };
    };
    const collectAliGroups = () => {
        const onProductPage = isProductPage();
        const groups = new Map();
        const seenRoots = new Set();
        const getCardScore = (root) => {
            const img = getMainImage(root);
            const imgRect = img?.getBoundingClientRect?.() || { width: 0, height: 0 };
            const rootRect = root?.getBoundingClientRect?.() || { width: 0, height: 0 };
            return ((imgRect.width || 0) * (imgRect.height || 0)) + Math.min(20000, (rootRect.width || 0) * (rootRect.height || 0) * 0.02);
        };
        const cartCards = getCartCards().slice(0, 1200);
        const directCards = [...document.querySelectorAll('[data-product-id]')].slice(0, 1200);
        const fallbackLinks = (cartCards.length || directCards.length || onProductPage)
            ? []
            : [...document.querySelectorAll('a[href*="/item/"], a[href*="/i/"]')].slice(0, 1200);
        const candidates = cartCards.length
            ? cartCards.map((card) => ({ card, pid: getPidFromCard(card), mode: 'cart' }))
            : (directCards.length
                ? directCards.map((card) => ({ card, pid: getPidFromCard(card), mode: 'snippet' }))
                : fallbackLinks.map((link) => ({ card: findCardRoot(link, getPidFromHref(link.getAttribute('href') || link.href || '')), pid: getPidFromHref(link.getAttribute('href') || link.href || ''), mode: 'snippet' })));
        candidates.forEach(({ card: root, pid, mode }) => {
            if (!pid) return;
            if (!root || seenRoots.has(root)) return;
            seenRoots.add(root);
            const rect = root.getBoundingClientRect();
            if ((rect.width || 0) < 80 || (rect.height || 0) < 80) return;
            if (!findBadgeTarget(root)) return;
            const priceInfo = mode === 'cart'
                ? parseCartCardPrice(root)
                : parseListingCardPrice(root);
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
            priceInfo: group.priceInfo,
        })).slice(0, 220);
    };
    const getBadgeTarget = (card) => {
        const target = findBadgeTarget(card) || card;
        target.classList.remove('mp-min-price-anchor--below-center');
        target.classList.remove('mp-min-price-anchor--below');
        target.classList.add('mp-min-price-anchor--photo-inside');
        return target || card;
    };

    const detectCurrentProduct = () => {
        const pid = getPid();
        if (!pid) return null;
        const priceInfo = getPagePrice();
        return {
            market: 'aliexpress',
            pid,
            pidKey: getPidKey(pid),
            currency: priceInfo?.currency || '',
        };
    };

    setCurrentProductDetector(detectCurrentProduct);
    startProductTracker({ market: 'aliexpress', getPid, getPidKey, getPrice: getPagePrice, getAnchor, isProductPage });
    startCardScanner({
        collectGroups: collectAliGroups,
        getBadgeTarget,
    });
})();

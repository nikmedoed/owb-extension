(() => {
    'use strict';

    const MP = window.MP;
    const Exporter = window.OWBExporter;
    if (!MP || !Exporter) return;

    const {
        sleep,
        slug,
        wait,
        ensureScrollTopButton,
        downloadTextFile,
        toBullets,
    } = MP;
    const {
        attachActionButtons,
        copyToClipboard,
        saveLastExtractSessionFromItem,
        setRunExport,
    } = Exporter;

    function initWB() {
        ensureScrollTopButton({ bottom: 120 });
        const getWBPriceNode = () => document.querySelector('[class^="priceBlockWalletPrice"], [class*=" priceBlockWalletPrice"]')
            || document.querySelector('ins[class^="priceBlockFinalPrice"], ins[class*=" priceBlockFinalPrice"]')
            || document.querySelector('span[class^="priceBlockPrice"], span[class*=" priceBlockPrice"], [class*="priceBlock"] [class*="price"], [class*="orderBlock"] [class*="price"]');
        async function loadWBReviews(max = 100) {
            const DELAY = 550;
            const MAX_IDLE = 10;
            const target = Math.max(1, Number(max) || 100);
            let idle = 0;
            let prev = 0;
            while (true) {
                const items = document.querySelectorAll('li.comments__item');
                if (items.length >= target) break;
                if (items.length) {
                    items[items.length - 1].scrollIntoView({ block: 'end', behavior: 'auto' });
                } else {
                    window.scrollBy(0, 340);
                }
                window.scrollBy(0, Math.max(260, Math.round(window.innerHeight * 0.34)));
                await sleep(DELAY);
                const now = document.querySelectorAll('li.comments__item').length;
                if (now === prev) {
                    idle += 1;
                    const loadNode = document.querySelector('.product-feedbacks__load');
                    if (loadNode) {
                        try { loadNode.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (_) {}
                    }
                    if (idle >= MAX_IDLE) break;
                } else {
                    prev = now;
                    idle = 0;
                }
            }
            return [...document.querySelectorAll('li.comments__item')].slice(0, target);
        }
        const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const getReviewVariantTiles = (root) => {
            if (!root) return [];
            const scope = root.querySelector('.feedbacksColors--NtFag, [class*="feedbacksColors"], [class*="swiperColors"]') || root;
            return [...scope.querySelectorAll('.swiper-wrapper > .swiper-slide:not(.swiper-slide-duplicate)')]
                .map((slide) => slide.querySelector(':scope > div[class*="feedbacksColorsItem"]') || slide.querySelector('div[class*="feedbacksColorsItem"]'))
                .filter((tile) => !!tile && !!tile.querySelector('.option--AtxKZ, [class*="option"]'));
        };
        const isAllVariantTile = (tile) => {
            const cls = [...(tile?.classList || [])].some((c) => /^isAll--/.test(c));
            const txt = normalizeText(tile?.querySelector('.option--AtxKZ, [class*="option"]')?.textContent || tile?.textContent || '');
            return cls || txt === 'все' || txt === 'all';
        };
        const getTileLabel = (tile) => normalizeText(tile?.querySelector('.option--AtxKZ, [class*="option"]')?.textContent || '');
        const getReviewColors = (limit = 14) => [...document.querySelectorAll('li.comments__item')]
            .slice(0, limit)
            .map((el) => normalizeText(el.querySelector('.feedback__params-item--color span, [class*="feedbackParamsColor"] span')?.textContent || ''))
            .filter(Boolean);
        const isReviewsFilteredByLabel = (label) => {
            const colors = getReviewColors(16);
            if (colors.length < 4) return false;
            const uniq = [...new Set(colors)];
            return uniq.length === 1 && (!label || uniq[0] === label);
        };
        const clickVariantTile = async (tile) => {
            if (!tile) return;
            const targets = [
                tile.querySelector('.option--AtxKZ, [class*="option"]'),
                tile.querySelector('img[src], img[data-src], img[data-src-pb]'),
                tile.querySelector('button, [role="button"]'),
                tile,
                tile.closest('.swiper-slide'),
            ].filter(Boolean);
            for (const node of targets) {
                try { node.click(); } catch (_) {}
                await sleep(45);
            }
        };
        const switchWBReviewsToFirstSpecificVariant = async () => {
            const root = document.querySelector('.product-feedbacks__main-wrapper, [class*="product-feedbacks__main"]');
            if (!root) return true;
            const tiles = getReviewVariantTiles(root);
            if (tiles.length < 2 || !isAllVariantTile(tiles[0])) return true;
            const target = tiles[1];
            const label = getTileLabel(target);
            if (!label) return false;
            for (let i = 0; i < 4; i += 1) {
                if (isReviewsFilteredByLabel(label)) return true;
                try { target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' }); } catch (_) {}
                await clickVariantTile(target);
                const start = Date.now();
                while (Date.now() - start < 950) {
                    if (isReviewsFilteredByLabel(label)) return true;
                    await sleep(140);
                }
            }
            return false;
        };

        const getWBPidKey = () => {
            const path = String(location.pathname || '');
            const m = path.match(/\/catalog\/(\d{4,})\/detail/i) || path.match(/\/catalog\/(\d{4,})\/feedbacks/i);
            return m && m[1] ? `wb:${m[1]}` : '';
        };
        async function buildWBExportPackage(opts = {}) {
            const includeReviews = opts.includeReviews !== false;
            const switchToVariant = opts.switchToVariant !== false;
            const url = location.href;
            const header = document.querySelector('[class^="productHeaderWrap"], .product-page__header-wrap');
            if (!header) throw new Error('Карточка WB не распознана');
            const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const digits = (value) => String(value || '').replace(/[^\d]/g, '');
            const normalizeBrand = (value) => clean(value)
                .replace(/\s*В каталог бренда.*$/i, '')
                .replace(/^\s*бренд[:\s]*/i, '')
                .trim();

            // Brand / Title
            const brand = normalizeBrand(
                header.querySelector('[class*="productHeaderBrandText"]')?.textContent
                || header.querySelector('a[href*="/brands/"] [class*="typography"]')?.textContent
                || header.querySelector('a[href*="/brands/"]')?.textContent
                || document.querySelector('[class*="productHeaderBrandText"]')?.textContent
                || document.querySelector('[class*="productHeader"] a[href*="/brands/"] [class*="typography"]')?.textContent
                || document.querySelector('[class*="productHeader"] a[href*="/brands/"]')?.textContent
                || document.querySelector('.product-page__brand-name')?.textContent
                || document.querySelector('[class*="categoryLinkBrand"]')?.textContent
                || '—'
            );
            const titleNode = document.querySelector('[class^="productTitle"], [class*=" productTitle"], .product-page__title');
            const title = clean(titleNode?.innerText || titleNode?.textContent || '—');
            const shop = clean(
                document.querySelector('[class*="sellerInfoNameDefaultText"]')?.textContent
                || document.querySelector('[class*="sellerInfoName"] [class*="typography"]')?.textContent
                || document.querySelector('[class*="sellerInfo"] a[href*="/seller/"] [class*="typography"]')?.textContent
                || '—'
            );

            // Original mark
            const original = document.querySelector('[class^="productHeader"] [class*="original"]') ? 'Да' : '—';

            // Rating + total reviews (robust to hashed classes)
            const ratingText = clean(
                document.querySelector('[class*="productReviewRating"]')?.textContent
                || document.querySelector('[class*="ReviewRating"]')?.textContent
                || document.querySelector('[data-qaid="product-review-rating"]')?.textContent
                || ''
            );
            const rating = ratingText.match(/\b([0-5](?:[.,]\d)?)\b/)?.[1]
                || clean(document.querySelector('[itemprop="ratingValue"]')?.textContent)
                || '—';
            const reviewsTotal = digits(
                ratingText.match(/(\d[\d\s\u00A0]*)\s*оцен/i)?.[1]
                || document.querySelector('[class*="ReviewCount"]')?.textContent
                || document.querySelector('[data-qaid="product-review-count"]')?.textContent
                || document.querySelector('[itemprop="reviewCount"]')?.textContent
                || '0'
            ) || '0';

            // Reviews entry link (new + old + updated layout)
            const reviewsLink = document.querySelector(
                'a[class^="productReview"], a.product-review, #product-feedbacks a.comments__btn-all, #product-feedbacks a.user-opinion__text, a[href*="/feedbacks"]'
            );

            // Price: prefer wallet price, fallback to final price, strip spaces inside digits
            const priceNode = getWBPriceNode();
            let price = '—';
            if (priceNode) {
                const raw = priceNode.textContent.replace(/\s+/g, '');
                price = raw.replace(/([₽€$])/, ' $1');
            }

            // characteristics & description
            const showBtn = [...document.querySelectorAll('button, a')]
                .find(el => /характеристик|описани/i.test(el.innerText));
            if (showBtn) { showBtn.click(); await sleep(400); }

            // Try to locate details container (dialog or legacy popup) without tying to hash classes
            const popup = [...document.querySelectorAll('[role="dialog"], .popup-product-details, [data-testid="product_additional_information"], section')]
                .find(n => /Характеристики|описание/i.test(n.innerText || ''));

            let chars = '—', descr = '—';
            if (popup) {
                // Characteristics: iterate tables with header+body pairs to avoid hash classes
                const rowTexts = [];
                popup.querySelectorAll('table').forEach((tbl) => {
                    tbl.querySelectorAll('tr').forEach((tr) => {
                        const k = (tr.querySelector('th, [class*="cellDecor"], [class*="cellWrapper"]')?.innerText || '').replace(/[:\s]+$/, '').trim();
                        const v = (tr.querySelector('td, [class*="cellValue"], [data-value]')?.innerText || '').trim();
                        if (k && v && k.toLowerCase() !== v.toLowerCase()) rowTexts.push(`${k}: ${v}`);
                    });
                });
                // fallback for definition-list rows
                popup.querySelectorAll('.product-params__row').forEach((r) => {
                    const k = (r.querySelector('th')?.innerText || '').replace(/[:\s]+$/, '').trim();
                    const v = (r.querySelector('td')?.innerText || '').trim();
                    if (k && v && k.toLowerCase() !== v.toLowerCase()) rowTexts.push(`${k}: ${v}`);
                });
                if (rowTexts.length) chars = rowTexts.join('\n');

                // Description: prefer explicit section-description, else heading "Описание"
                const descSection = popup.querySelector('#section-description, [id*="section-description"]');
                const descNode = descSection?.querySelector('p, div') || [...popup.querySelectorAll('h3, h2, h4')]
                    .find(h => /описани/i.test(h.textContent || ''))?.nextElementSibling;
                if (descNode) descr = descNode.innerText.trim();
            }

            const lines = [
                '=== CARD SUMMARY (WILDBERRIES) ===',
                `URL: ${url}`,
                `Бренд: ${brand}`,
                `Магазин: ${shop || '—'}`,
                `Заголовок: ${title}`,
                `Оригинал: ${original}`,
                `Цена: ${price}`,
                `Рейтинг: ${rating} (${reviewsTotal} оценок)`,
                '',
                '=== ОПИСАНИЕ ===',
                descr,
                '',
                '=== ХАРАКТЕРИСТИКИ ===',
                ...toBullets(chars),
            ];

            // reviews
            if (includeReviews && reviewsLink) {
                reviewsLink.click();
                await wait('.product-feedbacks__main, [class*="product-feedbacks__main"]', 10000);
                await sleep(300);
                if (switchToVariant) {
                    const switched = await switchWBReviewsToFirstSpecificVariant();
                    if (!switched) {
                        throw new Error('Не удалось переключить отзывы WB на конкретный вариант (вторая плитка после "Все").');
                    }
                    await sleep(180);
                }
                const expectedReviews = Math.max(1, Math.min(100, Number(reviewsTotal) || 100));
                const revs = await loadWBReviews(expectedReviews);
                const pickBables = (node) => {
                    const res = [];
                    node.querySelectorAll('.feedbacks-bables').forEach((b) => {
                        const title = b.querySelector('.feedbacks-bables__title')?.innerText.trim();
                        const vals = [...b.querySelectorAll('.feedbacks-bables__item')]
                            .map((li) => li.innerText.trim())
                            .filter(Boolean);
                        if (title && vals.length) res.push(`${title}: ${vals.join(', ')}`);
                    });
                    return res;
                };

                lines.push('', '=== ОТЗЫВЫ ===', `Отзывы (выгружено ${revs.length}):`);
                if (revs.length) {
                    revs.forEach((el, idx) => {
                        const date = el.querySelector('.feedback__date')?.innerText.trim() || '—';
                        const star = el.querySelector('.feedback__rating');
                        const cls = star && [...star.classList].find((c) => /^star\d+$/.test(c));
                        const rate = cls ? cls.replace('star', '') + '★' : '—';
                        const purchased = el.querySelector('.feedback__state--text')?.innerText.trim() || '—';
                        const parts = [`${rate}, ${purchased}`];

                        const pros = el.querySelector('.feedback__text--item-pro')?.innerText.replace(/^Достоинства:/, '').trim();
                        if (pros) parts.push(`Достоинства: ${pros}`);
                        const cons = el.querySelector('.feedback__text--item-con')?.innerText.replace(/^Недостатки:/, '').trim();
                        if (cons) parts.push(`Недостатки: ${cons}`);
                        const free = [...el.querySelectorAll('.feedback__text--item')]
                            .find(n => !n.classList.contains('feedback__text--item-pro') && !n.classList.contains('feedback__text--item-con'))
                            ?.innerText.replace(/^Комментарий:/, '').trim();
                        if (free) parts.push(`Комментарий: ${free}`);

                        // new WB layout: bable badges for pros/cons
                        pickBables(el).forEach((t) => parts.push(t));
                        lines.push(`- Отзыв ${idx + 1} (${date}): ${parts.join('; ')}`);
                    });
                } else lines.push('Нет отзывов');
            }

            const txt = lines.join('\n');
            const filenameBase = brand && brand !== '—'
                ? `${title} ${brand}`
                : title;
            const fname = slug(filenameBase) + '.txt';
            return {
                market: 'wb',
                pidKey: getWBPidKey(),
                url,
                title,
                filename: fname,
                text: txt,
            };
        }

        async function exportWB(opts = {}) {
            const copyOnly = !!opts.copyOnly;
            const pack = await buildWBExportPackage(opts);
            if (copyOnly) {
                await copyToClipboard(pack.text);
                await saveLastExtractSessionFromItem(pack, {
                    mode: 'copy',
                    allReviews: opts.includeReviews !== false,
                });
                return;
            }
            downloadTextFile(pack.filename, pack.text);
            await saveLastExtractSessionFromItem(pack, {
                mode: 'download',
                allReviews: opts.includeReviews !== false,
            });
        }
        setRunExport(async (opts = {}) => {
            const allReviews = opts.allReviews === true;
            return buildWBExportPackage({
                includeReviews: opts.includeReviews !== false,
                switchToVariant: allReviews ? false : true,
            });
        });

        // Mount action buttons near the title on WB (supports new hashed classes + old one)
        const wbTitleSelector = '[class^="productTitle"], [class*=" productTitle"], .product-page__title';
        setInterval(() => {
            attachActionButtons(document.querySelector(wbTitleSelector), 'wb', [
                { label: 'Скачать', kind: 'full', run: () => exportWB({ includeReviews: true, switchToVariant: true }) },
                { label: 'все отзывы', kind: 'all', run: () => exportWB({ includeReviews: true, switchToVariant: false }) },
                { label: 'в буфер', kind: 'copy', pendingText: 'Копирую...', successText: 'Скопировано', toastSuccess: 'Скопировано в буфер', run: () => exportWB({ includeReviews: false, copyOnly: true }) },
                { label: 'в буфер с отзывами', kind: 'copy_all', pendingText: 'Копирую...', successText: 'Скопировано', toastSuccess: 'Скопировано в буфер', run: () => exportWB({ includeReviews: true, switchToVariant: true, copyOnly: true }) },
            ]);
        }, 1000);

    }

    initWB();
})();

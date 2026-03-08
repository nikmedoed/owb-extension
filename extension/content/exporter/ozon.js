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
        setRunExport,
    } = Exporter;

    function initOzon() {
        ensureScrollTopButton();

        const clickVariantWhenReady = (timeout = 400) => {
            const find = () => [...document.querySelectorAll('button,[role="button"]')]
                .find(el => /этот вариант товара/i.test(el.textContent?.trim()));
            const btn = find();
            if (btn) { btn.click(); return Promise.resolve(true); }
            return new Promise(resolve => {
                const obs = new MutationObserver(() => {
                    const b = find();
                    if (b) { b.click(); obs.disconnect(); resolve(true); }
                });
                obs.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => { obs.disconnect(); resolve(false); }, timeout);
            });
        };

        const getRecommendationsTopY = () => {
            const headingMarkers = [...document.querySelectorAll('h2, h3, h4')]
                .filter((el) => /(рекомендуем|похожие товары|с этим товаром|вам может понравиться)/i.test(el.textContent || ''))
                .map((el) => window.scrollY + el.getBoundingClientRect().top);
            const widgetMarkers = [...document.querySelectorAll('[data-widget*="recommend" i], [data-widget*="similar" i]')]
                .map((el) => window.scrollY + el.getBoundingClientRect().top);
            const candidates = [...headingMarkers, ...widgetMarkers]
                .filter((y) => Number.isFinite(y) && y > (window.scrollY + 180))
                .sort((a, b) => a - b);
            return candidates.length ? candidates[0] : Infinity;
        };
        const pickClosestForwardNode = (nodes, options = {}) => {
            const list = (nodes || []).filter(Boolean);
            if (!list.length) return null;
            const minDocY = Number.isFinite(Number(options.minDocY))
                ? Number(options.minDocY)
                : Math.max(0, window.scrollY - Math.round(window.innerHeight * 0.75));
            const maxDocY = Number.isFinite(Number(options.maxDocY)) ? Number(options.maxDocY) : Infinity;
            const withPos = list
                .map((el) => ({ el, y: window.scrollY + el.getBoundingClientRect().top }))
                .filter((x) => Number.isFinite(x.y));
            const below = withPos
                .filter((x) => x.y >= minDocY && x.y <= maxDocY)
                .sort((a, b) => a.y - b.y);
            if (below.length) return below[0].el;
            return null;
        };
        const findReviewHeaderNode = () => {
            const maxDocY = getRecommendationsTopY();
            const direct = pickClosestForwardNode([
                ...document.querySelectorAll('[data-widget="webListReviews"], #section-reviews, [id*="section-reviews" i]'),
            ], { maxDocY });
            if (direct) return direct;
            const byCard = pickClosestForwardNode([...document.querySelectorAll('[data-review-uuid]')], { maxDocY });
            return byCard ? (byCard.closest('[data-widget], section, article, div') || byCard) : null;
        };
        const findDescriptionSection = () => {
            const maxDocY = getRecommendationsTopY();
            const direct = pickClosestForwardNode([
                ...document.querySelectorAll('[data-widget="webDescription"], #section-description, [id*="section-description"]'),
            ], { maxDocY });
            if (direct) return direct;
            return pickClosestForwardNode(
                [...document.querySelectorAll('h2, h3')]
                    .filter((n) => /^\s*(описание|о товаре)\s*$/i.test(n.textContent || '')),
                { maxDocY },
            );
        };
        const findCharacteristicsSection = () => {
            const maxDocY = getRecommendationsTopY();
            const direct = pickClosestForwardNode([
                ...document.querySelectorAll('#section-characteristics, [id*="section-characteristics" i], [data-widget="webCharacteristics"], [data-widget*="characteristics" i]'),
            ], { maxDocY });
            if (direct) return direct;
            return pickClosestForwardNode(
                [...document.querySelectorAll('h2, h3')]
                    .filter((n) => /^\s*характеристик/i.test(n.textContent || '')),
                { maxDocY },
            );
        };
        const stepPageDown = async (stepRatio = 0.32, delay = 300, smoothScroll = true) => {
            const delta = Math.max(240, Math.round(window.innerHeight * stepRatio));
            if (smoothScroll) {
                window.scrollBy({ top: delta, behavior: 'smooth' });
            } else {
                window.scrollBy(0, delta);
            }
            await sleep(delay);
        };
        const scrollToElementProgressive = async (el, options = {}) => {
            if (!el) return;
            const block = options.block || 'start';
            const rect = el.getBoundingClientRect();
            const topThreshold = Math.round(window.innerHeight * 0.12);
            const bottomThreshold = Math.round(window.innerHeight * 0.88);
            if (rect.top >= topThreshold && rect.bottom <= bottomThreshold) return;
            el.scrollIntoView({ behavior: 'smooth', block, inline: 'nearest' });
            await sleep(Number(options.settleMs) || 220);
        };
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
                block: options.block || 'center',
                stepRatio: options.stepRatio || 0.45,
                delay: options.delay || 180,
                maxHops: options.maxHops || 20,
                settleMs: options.settleMs || 240,
            });
            return node;
        };
        const parseRatingValue = (text) => {
            const m = String(text || '').replace(',', '.').match(/\b([0-5](?:\.\d)?)\b/);
            return m ? m[1] : '—';
        };
        const parseCount = (text) => {
            const m = String(text || '').replace(/\u00A0/g, ' ').match(/(\d[\d\s]{0,8})\s*(оцен|отзыв)/i);
            if (!m) return 0;
            return parseInt(m[1].replace(/\s+/g, ''), 10) || 0;
        };
        const clickExpandButtons = (root) => {
            if (!root) return;
            [...root.querySelectorAll('button, a, [role="button"]')].forEach((el) => {
                const t = (el.textContent || '').toLowerCase().trim();
                if (/ещё|еще|показать|развернуть|подробнее|читать полностью|more|show/i.test(t)) el.click();
            });
        };
        const getScrollableCandidates = (root) => {
            if (!root) return [];
            const all = [root, ...root.querySelectorAll('*')];
            return all
                .filter((el) => {
                    const max = el.scrollHeight - el.clientHeight;
                    if (max <= 90) return false;
                    const style = getComputedStyle(el);
                    const overflowY = String(style.overflowY || '').toLowerCase();
                    return /(auto|scroll|overlay)/.test(overflowY) || max > 400;
                })
                .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
                .slice(0, 8);
        };
        const scrollInsideElement = async (el) => {
            if (!el) return;
            const max = el.scrollHeight - el.clientHeight;
            if (max <= 20) return;
            const step = Math.max(140, Math.floor(el.clientHeight * 0.6));
            for (let y = 0; y <= max; y += step) {
                el.scrollTo({ top: y, behavior: 'auto' });
                await sleep(130);
            }
            el.scrollTo({ top: max, behavior: 'auto' });
        };

        /* ------- collect product info ------- */
        async function collectInfo() {
            window.scrollTo({ top: 0, behavior: 'auto' });
            await sleep(180);

            const url = location.href;
            const heading = await wait('[data-widget="webProductHeading"]', 12000).catch(() => null);
            const title = heading?.querySelector('h1')?.innerText.trim() || document.querySelector('h1')?.innerText.trim() || '—';

            const normalizeQuotes = (value) => String(value || '')
                .replace(/[`´‘’‛ʼʻʹʽꞌ＇]/g, "'")
                .replace(/[“”„«»]/g, '"');
            const clean = (value) => normalizeQuotes(value).replace(/\s+/g, ' ').trim();
            const normalizeForCompare = (value) => clean(value)
                .toLowerCase()
                .replace(/['"]/g, '')
                .replace(/[^a-zа-яё0-9]+/gi, ' ')
                .trim();
            const normalizeEntityText = (value) => clean(value)
                .replace(/\s*Бренд\s*•.*$/i, '')
                .replace(/\s*Витрина бренда.*$/i, '')
                .replace(/\s*О магазине.*$/i, '')
                .replace(/\s*Подписаться.*$/i, '')
                .replace(/\s*Перейти.*$/i, '')
                .trim();
            const isMissing = (value) => !value || value === '—';
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
            const scoreEntityNode = (el, text, hint = '') => {
                const cls = String(el?.className || '').toLowerCase();
                const href = String(el?.getAttribute?.('href') || '').toLowerCase();
                let score = 0;
                if (hint === 'brand' && /\/brand\//.test(href)) score += 60;
                if (hint === 'shop' && /\/(seller|shop|store|brand)\//.test(href)) score += 50;
                if (/seller|shop|store|brand|b35_3_22-b7|compactcontrol500|control500/.test(cls)) score += 30;
                if (/^[A-ZА-ЯЁ0-9 .&'`_-]+$/u.test(text)) score += 12;
                const words = text.split(/\s+/).length;
                if (words <= 3) score += 8;
                if (words > 6) score -= 20;
                if (/подпис|перейти|оригинал|бренд\s*•|витрина|заказы|чат|достав|в корзин/i.test(text)) score -= 60;
                return score;
            };
            const pickBestEntityText = (nodes, hint = '') => {
                const candidates = (nodes || [])
                    .map((el) => {
                        const text = normalizeEntityText(el?.textContent || el?.innerText || '');
                        return { el, text };
                    })
                    .filter((x) => isValidEntity(x.text))
                    .map((x) => ({ ...x, score: scoreEntityNode(x.el, x.text, hint) }))
                    .sort((a, b) => (b.score - a.score) || (a.text.length - b.text.length));
                return candidates[0]?.text || '';
            };
            const getBrandFromHeaderBlock = () => {
                const bwrap = document.querySelector('[data-widget="webBrand"]');
                if (!bwrap) return '';
                const fromBrandLink = pickBestEntityText([...bwrap.querySelectorAll('a[href*="/brand/"]')], 'brand');
                if (fromBrandLink) return fromBrandLink;
                const fromNodes = pickBestEntityText(
                    [...bwrap.querySelectorAll('[class*="CompactControl500" i], [class*="Control500" i], [class*="title" i], span, a')],
                    'brand',
                );
                if (fromNodes) return fromNodes;

                const href = bwrap.querySelector('a[href*="/brand/"]')?.getAttribute('href') || '';
                const slugMatch = href.match(/\/brand\/([^/?#]+)/i);
                if (!slugMatch?.[1]) return '';
                let fromSlug = slugMatch[1].replace(/-\d+$/, '').replace(/-/g, ' ').trim();
                if (/^[a-z0-9 ]+$/i.test(fromSlug) && fromSlug.split(/\s+/).length <= 3) {
                    fromSlug = fromSlug.toUpperCase();
                }
                return fromSlug;
            };
            const getBrandFromMeta = () => clean(
                document.querySelector('meta[itemprop="brand"]')?.getAttribute('content')
                || document.querySelector('meta[name="brand"]')?.getAttribute('content')
                || '',
            );
            const getBrandFromBreadcrumbByTitle = () => {
                const titleNorm = normalizeForCompare(title);
                if (!titleNorm) return '';
                const crumbs = [...document.querySelectorAll('[data-widget="breadCrumbs"] li span')]
                    .map((n) => clean(n.textContent || ''))
                    .filter((t) => isValidEntity(t));
                for (let i = crumbs.length - 1; i >= 0; i -= 1) {
                    const candidate = crumbs[i];
                    const candNorm = normalizeForCompare(candidate);
                    if (!candNorm || candNorm.length < 3) continue;
                    if (titleNorm.includes(candNorm)) return candidate;
                }
                return '';
            };
            const getShopName = () => {
                const bySellerWidget = pickBestEntityText([
                    ...document.querySelectorAll('[data-widget*="seller" i] a, [data-widget*="seller" i] [class*="name" i], [data-widget*="shop" i] a, [class*="sellerInfo" i] a, [class*="sellerInfo" i] [class*="name" i]'),
                ]);
                if (bySellerWidget) return bySellerWidget;

                const shopHeader = [...document.querySelectorAll('h2, h3, span, div')]
                    .find((el) => /^магазин$/i.test(clean(el.textContent || '')));
                if (!shopHeader) return '';

                const base = shopHeader.closest('div') || shopHeader.parentElement;
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
                        ...scope.querySelectorAll('[class*="b35_3_22-b7" i], [class*="seller" i] [class*="name" i], [class*="shop" i] [class*="name" i], span, a'),
                    ], 'shop');
                    if (fromScope) return fromScope;
                }
                return '';
            };

            let brand = getBrandFromHeaderBlock() || getBrandFromMeta() || '';
            if (isMissing(brand)) brand = getBrandFromBreadcrumbByTitle() || '';
            let shop = getShopName() || '—';

            const origMark = document.querySelector('[data-widget="webBrand"] svg path[fill]') ? 'Да' : '—';

            const pWrap = await wait('[data-widget="webPrice"]', 12000).catch(() => null);
            const priceNode = [...(pWrap?.querySelectorAll('span, div') || [])]
                .find((el) => /[₽$€]/.test(el.textContent || '') && /\d/.test(el.textContent || ''));
            const price = priceNode?.innerText.replace(/\s+/g, ' ').trim() || '—';
            const unit = [...(pWrap?.querySelectorAll('div, span') || [])]
                .map((d) => (d.innerText || '').trim())
                .find((t) => /за\s*\d*\s*(шт|г|гр|кг|мл|л)\b/i.test(t)) || '';

            const scoreNode = document.querySelector('[data-widget="webSingleProductScore"], [data-widget="webReviewScore"], [itemprop="aggregateRating"]');
            const avgRating = parseRatingValue(
                document.querySelector('[itemprop="ratingValue"]')?.textContent
                || scoreNode?.textContent
                || heading?.textContent
                || '',
            );
            const reviewsTotal = parseCount(
                document.querySelector('[itemprop="reviewCount"]')?.textContent
                || scoreNode?.textContent
                || heading?.textContent
                || '',
            );

            let desc = '—';
            const descSection = await gotoSection(
                () => findDescriptionSection(),
                { maxSteps: 10, stepRatio: 0.32, delay: 280, settleMs: 220, block: 'start' },
            );
            if (descSection) {
                const descRoot = descSection.closest('[data-widget="webDescription"]') || descSection;
                clickExpandButtons(descRoot);
                await sleep(260);

                const scrollables = getScrollableCandidates(descRoot);
                for (const sc of scrollables) await scrollInsideElement(sc);

                const text = (descRoot.innerText || '')
                    .replace(/^\s*Описание\s*/i, '')
                    .replace(/^\s*О\s*товаре\s*/i, '')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
                const imageUrls = [...descRoot.querySelectorAll('img[src], img[data-src], source[srcset]')]
                    .map((img) => img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('srcset') || '')
                    .map((raw) => String(raw || '').split(/\s+/)[0].trim())
                    .filter(Boolean);
                const uniqImages = [...new Set(imageUrls)];

                if (text && text.length >= 30) {
                    desc = text;
                    if (uniqImages.length >= 3) {
                        desc += `\n\n[Иллюстрации longread: ${uniqImages.length} шт.]`;
                    }
                } else if (uniqImages.length) {
                    const shown = uniqImages.slice(0, 30).map((u) => `- ${u}`);
                    desc = `Лонгрид-описание в изображениях (${uniqImages.length} шт.):\n${shown.join('\n')}`;
                }
            }

            let chars = '—';
            let brandFromChars = '';
            let cSec = await gotoSection(
                () => findCharacteristicsSection(),
                { maxSteps: 22, stepRatio: 0.32, delay: 280, settleMs: 240, block: 'start' },
            );
            if (cSec) {
                const rows = [];
                cSec.querySelectorAll('dl').forEach((dl) => {
                    const k = dl.querySelector('dt')?.innerText.replace(/[:\s]+$/, '').trim();
                    const v = dl.querySelector('dd')?.innerText.trim();
                    if (k && v) rows.push(`${k}: ${v}`);
                    if (!brandFromChars && /^бренд$/i.test(String(k || '').trim()) && isValidEntity(v)) {
                        brandFromChars = normalizeEntityText(v);
                    }
                });
                cSec.querySelectorAll('tr').forEach((tr) => {
                    const k = tr.querySelector('th, td:first-child')?.innerText.replace(/[:\s]+$/, '').trim();
                    const v = tr.querySelector('td:last-child')?.innerText.trim();
                    if (k && v && k !== v) rows.push(`${k}: ${v}`);
                    if (!brandFromChars && /^бренд$/i.test(String(k || '').trim()) && isValidEntity(v)) {
                        brandFromChars = normalizeEntityText(v);
                    }
                });
                const uniqRows = [...new Set(rows.filter(Boolean))];
                if (uniqRows.length) chars = uniqRows.join('\n');
            }

            if (isMissing(brand) && brandFromChars) brand = brandFromChars;
            brand = normalizeEntityText(brand);
            shop = normalizeEntityText(shop);
            if (!isValidEntity(brand)) brand = '—';
            if (!isValidEntity(shop)) shop = '—';

            return { url, title, brand, shop, origMark, price, unit, avgRating, reviewsTotal, desc, chars };
        }

        /* --------- reviews ---------- */
        async function loadReviews(max = 100, opts = {}) {
            const switchToVariant = opts.switchToVariant === true;
            const avgFromInfo = opts.avgRating || '—';
            const declaredFromInfo = Number(opts.reviewsTotal) || 0;
            const noProgressTimeoutMs = 3000;
            const reviewHeaderNode = await gotoSection(
                () => findReviewHeaderNode(),
                { maxSteps: 32, stepRatio: 0.34, delay: 280, settleMs: 260, block: 'start' },
            );
            if (!reviewHeaderNode) return { header: `Отзывы: нет отзывов. Средняя оценка: ${avgFromInfo}`, items: [] };

            const reviewSectionSelector = '[data-widget="webListReviews"], #section-reviews, [id*="section-reviews" i]';
            const reviewNodesSelector = '[data-review-uuid], [data-review-id]';
            const resolveReviewSection = (seed = null) => {
                const rooted = seed?.closest(reviewSectionSelector) || seed || null;
                const candidates = [...document.querySelectorAll(reviewSectionSelector)];
                const scored = candidates
                    .map((el) => ({
                        el,
                        count: el.querySelectorAll(reviewNodesSelector).length,
                        top: Math.abs(el.getBoundingClientRect().top),
                    }))
                    .sort((a, b) => (b.count - a.count) || (a.top - b.top));
                if (scored.length && scored[0].count > 0) return scored[0].el;
                return rooted || null;
            };

            let reviewSection = resolveReviewSection(reviewHeaderNode);
            if (!reviewSection) return { header: `Отзывы: нет отзывов. Средняя оценка: ${avgFromInfo}`, items: [] };
            await sleep(160);

            if (switchToVariant) {
                await clickVariantWhenReady();
                await sleep(600);
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

            const declared = parseCount(reviewSection.textContent || '') || declaredFromInfo;
            const requestedMax = Number.isFinite(Number(max)) ? Math.max(1, Math.floor(Number(max))) : 100;
            const targetCount = Math.min(100, requestedMax);
            const moreBtn = () => {
                const roots = [refreshReviewSection(), document];
                for (const root of roots) {
                    if (!root) continue;
                    const found = [...root.querySelectorAll('button, [role="button"], a[role="button"], a')]
                        .find((b) => {
                            const text = (b.innerText || '').toLowerCase();
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
                const path = svg.querySelector('path');
                const width = Number(svg.getAttribute('width') || 0);
                const height = Number(svg.getAttribute('height') || 0);
                const viewBox = String(svg.getAttribute('viewBox') || '').trim();
                const raw = [
                    svg.getAttribute('style') || '',
                    svg.getAttribute('color') || '',
                    svg.style?.color || '',
                    path?.getAttribute('fill') || '',
                    path?.getAttribute('style') || '',
                ].join(' ').toLowerCase();
                if (/graphicrating|graphictertiary|graphicneutral|disabled/.test(raw)) return true;
                if (width === 20 && height === 20 && viewBox === '0 0 24 24') return true;
                const d = String(path?.getAttribute('d') || '').replace(/\s+/g, '');
                if (d.startsWith('M9.3586.136C10.53')) return true;
                return d.includes('2.6433.136') && d.includes('3.8421.457');
            };
            const isFilledStarSvg = (svg) => {
                if (!svg) return null;
                if (!isLikelyRatingSvg(svg)) return null;
                const path = svg.querySelector('path');
                const raw = [
                    svg.getAttribute('style') || '',
                    svg.getAttribute('color') || '',
                    svg.style?.color || '',
                    path?.getAttribute('fill') || '',
                    path?.getAttribute('style') || '',
                ].join(' ').toLowerCase();
                if (raw.includes('graphicrating')) return true;
                if (raw.includes('graphictertiary') || raw.includes('graphicneutral') || raw.includes('disabled')) return false;
                const computed = getComputedStyle(svg).color || '';
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
                const stars = [...container.querySelectorAll(':scope > svg')].filter((svg) => isLikelyRatingSvg(svg)).slice(0, 5);
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
                    n.querySelector('[aria-label*="рейтинг" i]'),
                    n,
                ].filter(Boolean);
                const out = [];
                preferredRoots.forEach((root) => {
                    [...root.querySelectorAll('div, span')]
                        .filter((el) => {
                            const svgs = el.querySelectorAll(':scope > svg');
                            if (!svgs.length || svgs.length > 5) return false;
                            return [...svgs].every((svg) => isLikelyRatingSvg(svg));
                        })
                        .forEach((el) => out.push(el));
                });
                return [...new Set(out)];
            };
            const extractReviewRating = (n) => {
                const data = n.getAttribute('data-rate') || n.getAttribute('data-rating') || '';
                if (/^[0-5](?:[.,]\d)?$/.test(String(data).trim())) return String(data).replace(',', '.');

                const aria = n.querySelector('[aria-label*="из 5" i], [aria-label*="/5"]')?.getAttribute('aria-label') || '';
                const ariaMatch = aria.match(/([0-5](?:[.,]\d)?)/);
                if (ariaMatch) return ariaMatch[1].replace(',', '.');

                const directFilled = n.querySelectorAll('svg[style*="graphicRating" i]').length;
                if (directFilled >= 1 && directFilled <= 5) return String(directFilled);

                const containers = getRatingContainers(n);
                for (const container of containers) {
                    const parsed = parseRatingFromStarsContainer(container);
                    if (parsed) return parsed;
                }

                const allLikelyStars = [...n.querySelectorAll('svg')].filter((svg) => isLikelyRatingSvg(svg));
                if (allLikelyStars.length >= 1 && allLikelyStars.length <= 5) return String(allLikelyStars.length);

                const textMatch = (n.textContent || '').match(/\b([1-5](?:[.,]\d)?)\s*(?:из\s*5|\/\s*5|★)/i);
                if (textMatch) return textMatch[1].replace(',', '.');

                return '—';
            };
            const getDate = (n) => {
                const attrNode =
                    n.getAttribute('publishedat') ||
                    n.getAttribute('publishedAt') ||
                    n.querySelector('[publishedat]')?.getAttribute('publishedat') ||
                    n.querySelector('[datetime]')?.getAttribute('datetime') ||
                    n.querySelector('time')?.getAttribute('datetime');

                if (attrNode) {
                    if (/^\d{10,13}$/.test(attrNode)) {
                        const ms = attrNode.length === 13 ? +attrNode : +attrNode * 1000;
                        return new Date(ms).toLocaleDateString('ru-RU');
                    }
                    const iso = attrNode.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
                    if (iso) {
                        const [y, m, d] = iso.split('-');
                        return `${d}.${m}.${y}`;
                    }
                }
                const maybe = [...n.querySelectorAll('div, span, time')]
                    .map((el) => el.textContent.trim().match(/\d{1,2}\s+\D+\s+\d{4}|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}/)?.[0])
                    .find(Boolean);
                return maybe || '—';
            };
            const getText = (n) => {
                const findPart = (label) => {
                    const h = [...n.querySelectorAll('div, span, p')]
                        .find((el) => (el.textContent || '').trim().toLowerCase() === label);
                    return h ? h.parentElement?.querySelector('span, div, p')?.innerText.trim() : '';
                };
                const looksLikeAuthorName = (raw) => {
                    const t = String(raw || '').replace(/\s+/g, ' ').trim();
                    if (!t) return false;
                    if (/[!?;:]/.test(t)) return false;
                    if (/\d/.test(t)) return false;
                    if (t.length > 40) return false;
                    if (/^[A-ZА-ЯЁ][a-zа-яё]{1,24}\s+[A-ZА-ЯЁ]\.$/u.test(t)) return true; // Александр Е.
                    if (/^[A-ZА-ЯЁ][a-zа-яё]{1,24}(?:\s+[A-ZА-ЯЁ][a-zа-яё]{1,24}){1,2}$/u.test(t)) return true; // Лето Навсегда
                    if (/^[A-ZА-ЯЁ][a-zа-яё]{1,24}$/u.test(t)) return true; // Имя
                    return false;
                };
                const pros = findPart('достоинства');
                const cons = findPart('недостатки');
                const comment = findPart('комментарий');
                const parts = [];
                if (pros) parts.push(`Достоинства: ${pros}`);
                if (cons) parts.push(`Недостатки: ${cons}`);
                if (comment) parts.push(`Комментарий: ${comment}`);
                if (parts.length) return parts.join('; ');

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
                const leaves = [...n.querySelectorAll('span, div, p')].filter((el) => !el.children.length && !BAD.test(el.innerText));
                const texts = leaves
                    .map((el) => el.innerText.trim())
                    .filter((t) => t.length >= 8 && !looksLikeDate(t) && !looksLikeAuthorName(t));
                texts.sort((a, b) => b.length - a.length);
                return texts[0] || '—';
            };

            const collected = new Map();
            const getNodeId = (n) =>
                n?.getAttribute('data-review-uuid')
                || n?.getAttribute('data-review-id')
                || n?.getAttribute('id')
                || '';
            const upsertFromNode = (n) => {
                if (!n) return false;
                const uuid = getNodeId(n);
                if (!uuid) return false;
                const next = {
                    uuid,
                    date: getDate(n),
                    ratingText: extractReviewRating(n),
                    text: getText(n).replace(/\s+/g, ' '),
                    order: Number.isFinite(collected.get(uuid)?.order) ? collected.get(uuid).order : collected.size,
                };
                if (!next.text || next.text === '—') next.text = 'Без текста';

                const prev = collected.get(uuid);
                if (!prev) {
                    if (collected.size >= targetCount) return false;
                    collected.set(uuid, next);
                    return true;
                }
                const preferRating = prev.ratingText === '—' && next.ratingText !== '—';
                const preferText = (prev.text || '').length < (next.text || '').length;
                const preferDate = prev.date === '—' && next.date !== '—';
                if (preferRating || preferText || preferDate) {
                    collected.set(uuid, { ...prev, ...next, order: prev.order });
                }
                return false;
            };
            const getOrderedReviewNodes = () => {
                const seen = new Set();
                const nodes = [...document.querySelectorAll(reviewNodesSelector)]
                    .filter((n) => {
                        const id = getNodeId(n);
                        if (!id || seen.has(id)) return false;
                        seen.add(id);
                        return true;
                    })
                    .sort((a, b) => {
                        const ay = window.scrollY + a.getBoundingClientRect().top;
                        const by = window.scrollY + b.getBoundingClientRect().top;
                        return ay - by;
                    });
                return nodes;
            };
            const collectNow = () => {
                refreshReviewSection();
                const before = collected.size;
                const nodes = getOrderedReviewNodes();
                for (const n of nodes) {
                    upsertFromNode(n);
                    if (collected.size >= targetCount) break;
                }
                return { nodes, added: collected.size - before };
            };
            const scrollStep = async (waitMs = 160) => {
                refreshReviewSection();
                const nodes = getOrderedReviewNodes();
                const lastNode = nodes.length ? nodes[nodes.length - 1] : null;
                const anchor = lastNode || reviewSection;
                if (anchor && typeof anchor.scrollIntoView === 'function') {
                    anchor.scrollIntoView({ behavior: 'auto', block: 'end', inline: 'nearest' });
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

            const nodes = [...collected.values()]
                .sort((a, b) => a.order - b.order)
                .slice(0, targetCount);
            const ratings = [];
            const items = nodes.map((row, i) => {
                const ratingNum = Number(String(row.ratingText).replace(',', '.'));
                if (Number.isFinite(ratingNum) && ratingNum > 0) ratings.push(ratingNum);
                return `Отзыв ${i + 1} (${row.date}): ${row.ratingText}★; ${row.text}`;
            });
            const avgFromReviews = ratings.length ? (ratings.reduce((s, x) => s + x, 0) / ratings.length).toFixed(2) : '';
            const avg = avgFromInfo !== '—' ? avgFromInfo : (avgFromReviews || '—');
            const declaredShown = Math.max(Number(declared) || 0, items.length);
            const header = `Отзывы (выгружено ${items.length}${declaredShown ? ` из ${declaredShown}` : ''}, средняя оценка: ${avg})`;
            return { header, items };
        }

        const buildOzonText = (info, rev = null) => {
            const out = [
                '=== CARD SUMMARY (OZON) ===',
                `URL: ${info.url}`,
                `Бренд: ${info.brand}`,
                `Магазин: ${info.shop || '—'}`,
                `Заголовок: ${info.title}`,
                `Оригинал: ${info.origMark}`,
                `Цена: ${info.price}`,
                `Рейтинг: ${info.avgRating || '—'} (${info.reviewsTotal || 0} оценок)`,
            ];
            if (info.unit) out.push(`Цена за единицу: ${info.unit}`);
            out.push(
                '',
                '=== ОПИСАНИЕ ===',
                info.desc,
                '',
                '=== ХАРАКТЕРИСТИКИ ===',
                ...toBullets(info.chars)
            );
            if (rev) {
                out.push(
                    '',
                    '=== ОТЗЫВЫ ===',
                    rev.header,
                    ...rev.items.map((i) => `- ${i}`)
                );
            }
            return out.join('\n');
        };

        const getOzonPidKey = () => {
            const path = String(location.pathname || '');
            const m = path.match(/\/product\/[^/]*?(\d{5,})(?:\/|$)/) || path.match(/\/product\/(\d{5,})(?:\/|$)/);
            return m && m[1] ? `ozon:${m[1]}` : '';
        };
            const buildOzonExportPackage = async (opts = {}) => {
                const includeReviews = opts.includeReviews !== false;
                const switchToVariant = opts.switchToVariant === true;
                const info = await collectInfo();
                const maxReviews = 100;
                const rev = includeReviews
                    ? await loadReviews(maxReviews, { switchToVariant, avgRating: info.avgRating, reviewsTotal: info.reviewsTotal })
                    : null;
            const txt = buildOzonText(info, rev);
            const filenameBase = info.brand && info.brand !== '—'
                ? `${info.title} ${info.brand}`
                : info.title;
            const name = `${slug(filenameBase)}.txt`;
            return {
                market: 'ozon',
                pidKey: getOzonPidKey(),
                url: info.url,
                title: info.title,
                filename: name,
                text: txt,
            };
        };

        async function exportOzon(opts = {}) {
            try {
                const copyOnly = !!opts.copyOnly;
                const pack = await buildOzonExportPackage(opts);
                if (copyOnly) {
                    await copyToClipboard(pack.text);
                    return;
                }
                downloadTextFile(pack.filename, pack.text);
            } catch (err) {
                console.error('Ozon exporter:', err);
            }
        }
        setRunExport(async (opts = {}) => {
            return buildOzonExportPackage({
                includeReviews: opts.includeReviews !== false,
                switchToVariant: false,
                maxReviews: 100,
            });
        });
        setInterval(() => {
            attachActionButtons(document.querySelector('[data-widget="webProductHeading"] h1'), 'ozon', [
                { label: 'Скачать', kind: 'full', run: () => exportOzon({ includeReviews: true, switchToVariant: true, maxReviews: 100 }) },
                { label: 'без отзывов', kind: 'lite', run: () => exportOzon({ includeReviews: false }) },
                { label: 'все отзывы', kind: 'all', run: () => exportOzon({ includeReviews: true, switchToVariant: false, maxReviews: 100 }) },
                { label: 'в буфер', kind: 'copy', run: () => exportOzon({ includeReviews: false, copyOnly: true }) },
            ]);
        }, 1000);

    }

    initOzon();
})();

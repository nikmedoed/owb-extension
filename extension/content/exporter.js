(function () {
    'use strict';

    const MP = window.MP;
    if (!MP) {
        console.error('MP core not loaded');
        return;
    }
    const {
        sleep,
        slug,
        wait,
        smooth,
        ensureScrollTopButton,
        addStyleOnce,
        downloadTextFile,
        toBullets,
    } = MP;
    const runtimeBridge = {
        runExport: null,
    };
    const hasRuntime = () => !!(globalThis.chrome && chrome.runtime && chrome.runtime.onMessage);

    const ensureActionButtonsStyles = () => addStyleOnce(`
        .mp-export-actions{display:inline-flex;flex-wrap:wrap;gap:6px;margin-left:8px;vertical-align:middle}
        .mp-export-actions .mp-export-btn{padding:4px 8px;font-size:13px;border:none;border-radius:6px;cursor:pointer;color:#fff;background:#2d7dd7}
        .mp-export-actions .mp-export-btn[data-kind="lite"]{background:#2f9e44}
        .mp-export-actions .mp-export-btn[data-kind="full"]{background:#1c7ed6}
        .mp-export-actions .mp-export-btn[data-kind="all"]{background:#f08c00}
        .mp-export-actions .mp-export-btn[data-kind="copy"]{background:#6f42c1}
        .mp-export-actions .mp-export-btn:disabled{opacity:.65;cursor:default}
    `, 'mp-export-actions');

    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) {}
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', 'readonly');
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('Clipboard write failed');
        return true;
    };

    const attachActionButtons = (anchor, key, actions) => {
        if (!anchor || !anchor.parentElement || !Array.isArray(actions) || !actions.length) return;
        ensureActionButtonsStyles();
        if (anchor.parentElement.querySelector(`.mp-export-actions[data-key="${key}"]`)) return;

        const wrap = document.createElement('span');
        wrap.className = 'mp-export-actions';
        wrap.dataset.key = key;

        const setBusy = (busy) => {
            wrap.dataset.busy = busy ? '1' : '0';
            wrap.querySelectorAll('button').forEach((btn) => { btn.disabled = !!busy; });
        };
        const flash = (btn, original, text) => {
            btn.textContent = text;
            setTimeout(() => {
                btn.textContent = original;
            }, 1100);
        };

        actions.forEach((action) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mp-export-btn';
            btn.textContent = action.label;
            btn.dataset.kind = action.kind || 'full';
            btn.addEventListener('click', async () => {
                if (wrap.dataset.busy === '1') return;
                const original = btn.textContent;
                setBusy(true);
                btn.textContent = '...';
                try {
                    await action.run();
                    flash(btn, original, 'Готово');
                } catch (err) {
                    console.error('Export action failed:', err);
                    flash(btn, original, 'Ошибка');
                } finally {
                    setBusy(false);
                }
            });
            wrap.appendChild(btn);
        });
        anchor.insertAdjacentElement('afterend', wrap);
    };

    /* =========================================================
        OZON SECTION
  ========================================================= */
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

        const pickClosestForwardNode = (nodes) => {
            const list = (nodes || []).filter(Boolean);
            if (!list.length) return null;
            const minDocY = Math.max(0, window.scrollY - 24);
            const withPos = list
                .map((el) => ({ el, y: window.scrollY + el.getBoundingClientRect().top }))
                .filter((x) => Number.isFinite(x.y));
            const below = withPos
                .filter((x) => x.y >= minDocY)
                .sort((a, b) => a.y - b.y);
            if (below.length) return below[0].el;
            return null;
        };
        const findReviewHeaderNode = () => {
            const direct = pickClosestForwardNode([
                ...document.querySelectorAll('[data-widget="webListReviews"], #section-reviews, [id*="section-reviews" i]'),
            ]);
            if (direct) return direct;
            const byCard = pickClosestForwardNode([...document.querySelectorAll('[data-review-uuid]')]);
            return byCard ? (byCard.closest('[data-widget], section, article, div') || byCard) : null;
        };
        const findDescriptionSection = () => {
            const direct = pickClosestForwardNode([
                ...document.querySelectorAll('[data-widget="webDescription"], #section-description, [id*="section-description"]'),
            ]);
            if (direct) return direct;
            return pickClosestForwardNode(
                [...document.querySelectorAll('h2, h3')]
                    .filter((n) => /^\s*(описание|о товаре)\s*$/i.test(n.textContent || '')),
            );
        };
        const findCharacteristicsSection = () => {
            const direct = pickClosestForwardNode([
                ...document.querySelectorAll('#section-characteristics, [id*="section-characteristics" i], [data-widget="webCharacteristics"], [data-widget*="characteristics" i]'),
            ]);
            if (direct) return direct;
            return pickClosestForwardNode(
                [...document.querySelectorAll('h2, h3')]
                    .filter((n) => /^\s*характеристик/i.test(n.textContent || '')),
            );
        };
        const stepPageDown = async (stepRatio = 0.5, delay = 260, smoothScroll = true) => {
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
            const stepRatio = Number(options.stepRatio) || 0.5;
            const delay = Number(options.delay) || 260;
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
            await sleep(120);

            const url = location.href;
            const heading = await wait('[data-widget="webProductHeading"]', 12000).catch(() => null);
            const title = heading?.querySelector('h1')?.innerText.trim() || document.querySelector('h1')?.innerText.trim() || '—';

            let brand = '—';
            const bc = document.querySelector('[data-widget="breadCrumbs"] ol');
            if (bc) {
                const spans = bc.querySelectorAll('li span');
                if (spans.length) brand = spans[spans.length - 1].innerText.trim();
            }
            if (brand === '—') {
                const bwrap = document.querySelector('[data-widget="webBrand"]');
                const bnode = bwrap?.querySelector('a, span, div');
                if (bnode) brand = bnode.innerText.trim();
            }

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
                { maxSteps: 14, stepRatio: 0.44, delay: 220, settleMs: 220, block: 'start' },
            );
            if (descSection) {
                const descRoot = descSection.closest('[data-widget="webDescription"]') || descSection;
                await smooth(descRoot);
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
            let cSec = await gotoSection(
                () => findCharacteristicsSection(),
                { maxSteps: 120, stepRatio: 0.42, delay: 230, settleMs: 240, block: 'start' },
            );
            if (cSec) {
                await smooth(cSec);
                const rows = [];
                cSec.querySelectorAll('dl').forEach((dl) => {
                    const k = dl.querySelector('dt')?.innerText.replace(/[:\s]+$/, '').trim();
                    const v = dl.querySelector('dd')?.innerText.trim();
                    if (k && v) rows.push(`${k}: ${v}`);
                });
                cSec.querySelectorAll('tr').forEach((tr) => {
                    const k = tr.querySelector('th, td:first-child')?.innerText.replace(/[:\s]+$/, '').trim();
                    const v = tr.querySelector('td:last-child')?.innerText.trim();
                    if (k && v && k !== v) rows.push(`${k}: ${v}`);
                });
                const uniqRows = [...new Set(rows.filter(Boolean))];
                if (uniqRows.length) chars = uniqRows.join('\n');
            }

            return { url, title, brand, origMark, price, unit, avgRating, reviewsTotal, desc, chars };
        }

        /* --------- reviews ---------- */
        async function loadReviews(max = 100, opts = {}) {
            const switchToVariant = opts.switchToVariant === true;
            const avgFromInfo = opts.avgRating || '—';
            const declaredFromInfo = Number(opts.reviewsTotal) || 0;
            const noProgressTimeoutMs = Math.max(3000, Number(opts.noProgressTimeoutMs) || 3000);
            const reviewHeaderNode = await gotoSection(
                () => findReviewHeaderNode(),
                { maxSteps: 140, stepRatio: 0.42, delay: 240, settleMs: 260, block: 'start' },
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
            await smooth(reviewSection);
            await sleep(180);

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
            const targetCount = requestedMax;
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
            const scrollStep = async (ratio = 0.9, waitMs = 140) => {
                const total = Math.max(260, Math.round(window.innerHeight * ratio));
                window.scrollBy(0, total);
                await sleep(waitMs);
            };

            collectNow();
            let safetyLoops = 0;
            let extraStepTried = false;
            let lastCollectedCount = collected.size;
            let noProgressSince = Date.now();
            while (collected.size < targetCount && safetyLoops < 500) {
                safetyLoops += 1;
                const { added } = collectNow();
                if (collected.size >= targetCount) break;

                if (collected.size > lastCollectedCount || added > 0) {
                    lastCollectedCount = collected.size;
                    noProgressSince = Date.now();
                    extraStepTried = false;
                    await scrollStep(0.86, 120);
                    continue;
                }

                const btn = moreBtn();
                if (btn) {
                    btn.click();
                    await sleep(120);
                }
                await scrollStep(0.92, 140);
                collectNow();
                if (collected.size > lastCollectedCount) {
                    lastCollectedCount = collected.size;
                    noProgressSince = Date.now();
                    extraStepTried = false;
                    continue;
                }

                if (Date.now() - noProgressSince < noProgressTimeoutMs) continue;
                if (!extraStepTried) {
                    extraStepTried = true;
                    await scrollStep(1.02, 200);
                    collectNow();
                    if (collected.size > lastCollectedCount) {
                        lastCollectedCount = collected.size;
                        noProgressSince = Date.now();
                        extraStepTried = false;
                        continue;
                    }
                }
                break;
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
                `Производитель: ${info.brand}`,
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
                const requestedMax = Number(opts.maxReviews);
                let maxReviews = Number.isFinite(requestedMax) && requestedMax > 0 ? Math.floor(requestedMax) : 100;
                if (opts.maxReviews === 'all' || opts.allReviews === true) {
                    maxReviews = Math.max(100, Number(info.reviewsTotal) || 5000);
                }
                const rev = includeReviews
                    ? await loadReviews(maxReviews, { switchToVariant, avgRating: info.avgRating, reviewsTotal: info.reviewsTotal })
                    : null;
            const txt = buildOzonText(info, rev);
            const name = slug(info.brand + ' ' + info.title) + '.txt';
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
        runtimeBridge.runExport = async (opts = {}) => {
            const allReviews = opts.allReviews === true;
            return buildOzonExportPackage({
                includeReviews: opts.includeReviews !== false,
                switchToVariant: false,
                maxReviews: allReviews ? 'all' : opts.maxReviews,
                allReviews,
            });
        };
        setInterval(() => {
            attachActionButtons(document.querySelector('[data-widget="webProductHeading"] h1'), 'ozon', [
                { label: 'Скачать', kind: 'full', run: () => exportOzon({ includeReviews: true, switchToVariant: true, maxReviews: 100 }) },
                { label: 'без отзывов', kind: 'lite', run: () => exportOzon({ includeReviews: false }) },
                { label: 'все отзывы', kind: 'all', run: () => exportOzon({ includeReviews: true, switchToVariant: false, maxReviews: 'all', allReviews: true }) },
                { label: 'в буфер', kind: 'copy', run: () => exportOzon({ includeReviews: false, copyOnly: true }) },
            ]);
        }, 1000);

    }

    

    /* =========================================================
        WILDBERRIES SECTION
  ========================================================= */
    function initWB() {
        ensureScrollTopButton({ bottom: 120 });
        const getWBPriceNode = () => document.querySelector('[class^="priceBlockWalletPrice"], [class*=" priceBlockWalletPrice"]')
            || document.querySelector('ins[class^="priceBlockFinalPrice"], ins[class*=" priceBlockFinalPrice"]')
            || document.querySelector('span[class^="priceBlockPrice"], span[class*=" priceBlockPrice"], [class*="priceBlock"] [class*="price"], [class*="orderBlock"] [class*="price"]');
        async function loadWBReviews(max = 100) {
            const DELAY = 600, MAX_IDLE = 6;
            let idle = 0, prev = 0;
            while (true) {
                const items = document.querySelectorAll('li.comments__item');
                if (items.length >= max) break;
                if (items.length) items[items.length - 1].scrollIntoView({ block: 'end', behavior: 'smooth' });
                else window.scrollBy(0, 300);
                await sleep(DELAY);
                const now = document.querySelectorAll('li.comments__item').length;
                if (now === prev) { if (++idle >= MAX_IDLE) break; } else { prev = now; idle = 0; }
            }
            return [...document.querySelectorAll('li.comments__item')].slice(0, max);
        }

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

            // Brand / Title
            const brand = (document.querySelector('[class^="productHeaderBrand"]')?.innerText || '—').trim();
            const titleNode = document.querySelector('[class^="productTitle"], [class*=" productTitle"], .product-page__title');
            const title = (titleNode?.innerText || titleNode?.textContent || '—').trim();

            // Original mark
            const original = document.querySelector('[class^="productHeader"] [class*="original"]') ? 'Да' : '—';

            // Rating + total reviews (robust to hashed classes)
            const rating = (document.querySelector('[class*="ReviewRating"], [data-qaid="product-review-rating"], [itemprop="ratingValue"]')?.textContent || '—').trim();
            const reviewsTotal = (document.querySelector('[class*="ReviewCount"], [data-qaid="product-review-count"], [itemprop="reviewCount"]')?.textContent || '')
                .replace(/\D+/g, '') || '0';

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
                `Производитель: ${brand}`,
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
                    const variant = [...document.querySelectorAll('.product-feedbacks__tabs .product-feedbacks__title, [class*="product-feedbacks__title"]')]
                        .find(el => /этот вариант товара/i.test(el.innerText));
                    if (variant) { variant.click(); await sleep(300); }
                }
                const revs = await loadWBReviews(100);
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
            const fname = slug(brand + ' ' + title) + '.txt';
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
                return;
            }
            downloadTextFile(pack.filename, pack.text);
        }
        runtimeBridge.runExport = async (opts = {}) => {
            const allReviews = opts.allReviews === true;
            return buildWBExportPackage({
                includeReviews: opts.includeReviews !== false,
                switchToVariant: allReviews ? false : true,
            });
        };

        // Mount action buttons near the title on WB (supports new hashed classes + old one)
        const wbTitleSelector = '[class^="productTitle"], [class*=" productTitle"], .product-page__title';
        setInterval(() => {
            attachActionButtons(document.querySelector(wbTitleSelector), 'wb', [
                { label: 'Скачать', kind: 'full', run: () => exportWB({ includeReviews: true, switchToVariant: true }) },
                { label: 'без отзывов', kind: 'lite', run: () => exportWB({ includeReviews: false }) },
                { label: 'все отзывы', kind: 'all', run: () => exportWB({ includeReviews: true, switchToVariant: false }) },
                { label: 'в буфер', kind: 'copy', run: () => exportWB({ includeReviews: false, copyOnly: true }) },
            ]);
        }, 1000);

    }

    

    /* =========================================================
        ENTRY POINT
  ========================================================= */
    if (hasRuntime()) {
        chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
            if (!message || message.scope !== 'owb-export') return undefined;
            if (String(message.action || '') !== 'export-card') return undefined;
            (async () => {
                if (!runtimeBridge.runExport) throw new Error('Экспорт на текущей вкладке недоступен');
                const data = await runtimeBridge.runExport(message.options || {});
                return data;
            })().then((data) => {
                sendResponse({ ok: true, data });
            }).catch((err) => {
                sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
            });
            return true;
        });
    }

    const host = String(location.hostname || '').toLowerCase();
    if (host.includes('ozon')) {
        initOzon();
    } else if (host.includes('wildberries') || host.endsWith('wb.ru')) {
        initWB();
    }
})();

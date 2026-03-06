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

        const findReviewHeaderNode = () => {
            const direct = document.querySelector('[data-widget="webListReviews"]');
            if (direct) return direct;
            return [...document.querySelectorAll('span, h2, h3, div')]
                .find((s) => /Отзывы о товаре|Отзывы/i.test((s.textContent || '').trim())) || null;
        };
        const findDescriptionSection = () => document.querySelector('[data-widget="webDescription"]')
            || document.querySelector('#section-description')
            || document.querySelector('[id*="section-description"]');
        const findCharacteristicsSection = () => document.querySelector('#section-characteristics')
            || document.querySelector('[data-widget*="characteristics" i]')
            || [...document.querySelectorAll('h2, h3, span, div')].find((n) => /Характеристики/i.test((n.textContent || '').trim()))?.closest('section, div');
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
            const descSection = await wait('[data-widget="webDescription"], #section-description, [id*="section-description"]', 12000).catch(() => null);
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
            const cSec = await wait('#section-characteristics, [data-widget*="characteristics" i]', 12000).catch(() => null) || findCharacteristicsSection();
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
            const switchToVariant = opts.switchToVariant !== false;
            const avgFromInfo = opts.avgRating || '—';
            const declaredFromInfo = Number(opts.reviewsTotal) || 0;
            const reviewHeaderNode = findReviewHeaderNode();
            if (!reviewHeaderNode) return { header: `Отзывы: нет отзывов. Средняя оценка: ${avgFromInfo}`, items: [] };

            const reviewSection = reviewHeaderNode.closest('[data-widget="webListReviews"]') || reviewHeaderNode;
            await smooth(reviewSection);

            if (switchToVariant) {
                await clickVariantWhenReady();
                await sleep(600);
            }

            const declared = parseCount(reviewSection.textContent || '') || declaredFromInfo;
            const moreBtn = () => [...reviewSection.querySelectorAll('button, [role="button"]')]
                .find((b) => /ещё|еще|показать|следующ|загрузить/i.test((b.innerText || '').toLowerCase()));

            const DELAY = 700;
            const MAX_IDLE = 7;
            let idle = 0;
            const reviewNodesSelector = '[data-review-uuid]';
            while (reviewSection.querySelectorAll(reviewNodesSelector).length < Math.min(max, declared || max) && idle < MAX_IDLE) {
                const before = reviewSection.querySelectorAll(reviewNodesSelector).length;
                const btn = moreBtn();
                if (btn) btn.click();
                else window.scrollBy(0, Math.round(window.innerHeight * 0.8));
                await sleep(DELAY);
                const after = reviewSection.querySelectorAll(reviewNodesSelector).length;
                idle = after === before ? idle + 1 : 0;
            }

            const nodes = [...reviewSection.querySelectorAll(reviewNodesSelector)].slice(0, max);
            const isFilledStarSvg = (svg) => {
                if (!svg) return null;
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
            const extractReviewRating = (n) => {
                const data = n.getAttribute('data-rate') || n.getAttribute('data-rating') || '';
                if (/^[0-5](?:[.,]\d)?$/.test(String(data).trim())) return String(data).replace(',', '.');

                const aria = n.querySelector('[aria-label*="из 5" i], [aria-label*="/5"]')?.getAttribute('aria-label') || '';
                const ariaMatch = aria.match(/([0-5](?:[.,]\d)?)/);
                if (ariaMatch) return ariaMatch[1].replace(',', '.');

                const directFilled = n.querySelectorAll('svg[style*="graphicRating" i], path[fill*="graphicRating" i]').length;
                if (directFilled >= 1 && directFilled <= 5) return String(directFilled);

                const candidates = [...n.querySelectorAll('div, span')]
                    .map((el) => ({ el, svgs: el.querySelectorAll('svg') }))
                    .filter((x) => x.svgs.length >= 3 && x.svgs.length <= 6)
                    .sort((a, b) => a.svgs.length - b.svgs.length);

                for (const cand of candidates) {
                    const svgs = [...cand.svgs].slice(0, 5);
                    let filled = 0;
                    let unknown = 0;
                    svgs.forEach((svg) => {
                        const state = isFilledStarSvg(svg);
                        if (state === true) filled += 1;
                        else if (state === null) unknown += 1;
                    });
                    if (filled >= 1 && filled <= 5) return String(filled);
                    if (!filled && unknown === 0 && svgs.length >= 1 && svgs.length <= 5) return String(svgs.length);
                }

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
                    if (t && !looksLikeDate(t)) return t;
                }
                const bodyNode = n.querySelector('[class*="vk1_"], [class*="review-text"], [class*="comment"]');
                if (bodyNode) {
                    const bodyText = bodyNode.innerText.trim();
                    if (bodyText && bodyText.length >= 8) return bodyText;
                }
                const BAD = /Вам помог|Размер|Цвет|коммент|вопрос|ответ|Похожие|Да \d+|Нет \d+/i;
                const leaves = [...n.querySelectorAll('span, div, p')].filter((el) => !el.children.length && !BAD.test(el.innerText));
                const texts = leaves
                    .map((el) => el.innerText.trim())
                    .filter((t) => t.length >= 10 && !looksLikeDate(t));
                texts.sort((a, b) => b.length - a.length);
                return texts[0] || '—';
            };

            const ratings = [];
            const items = nodes.map((n, i) => {
                const ratingText = extractReviewRating(n);
                const ratingNum = Number(String(ratingText).replace(',', '.'));
                if (Number.isFinite(ratingNum) && ratingNum > 0) ratings.push(ratingNum);
                return `Отзыв ${i + 1} (${getDate(n)}): ${ratingText}★; ${getText(n).replace(/\s+/g, ' ')}`;
            });
            const avgFromReviews = ratings.length ? (ratings.reduce((s, x) => s + x, 0) / ratings.length).toFixed(2) : '';
            const avg = avgFromInfo !== '—' ? avgFromInfo : (avgFromReviews || '—');
            const header = `Отзывы (выгружено ${items.length}${declared ? ` из ${declared}` : ''}, средняя оценка: ${avg})`;
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

        async function exportOzon(opts = {}) {
            try {
                const includeReviews = opts.includeReviews !== false;
                const switchToVariant = opts.switchToVariant !== false;
                const copyOnly = !!opts.copyOnly;

                const info = await collectInfo();
                const rev = includeReviews
                    ? await loadReviews(100, { switchToVariant, avgRating: info.avgRating, reviewsTotal: info.reviewsTotal })
                    : null;
                const txt = buildOzonText(info, rev);
                const name = slug(info.brand + ' ' + info.title) + '.txt';
                if (copyOnly) {
                    await copyToClipboard(txt);
                    return;
                }
                downloadTextFile(name, txt);
            } catch (err) {
                console.error('Ozon exporter:', err);
            }
        }
        setInterval(() => {
            attachActionButtons(document.querySelector('[data-widget="webProductHeading"] h1'), 'ozon', [
                { label: 'Скачать', kind: 'full', run: () => exportOzon({ includeReviews: true, switchToVariant: true }) },
                { label: 'без отзывов', kind: 'lite', run: () => exportOzon({ includeReviews: false }) },
                { label: 'все отзывы', kind: 'all', run: () => exportOzon({ includeReviews: true, switchToVariant: false }) },
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

        async function exportWB(opts = {}) {
            const includeReviews = opts.includeReviews !== false;
            const switchToVariant = opts.switchToVariant !== false;
            const copyOnly = !!opts.copyOnly;
            const url = location.href;
            const header = document.querySelector('[class^="productHeaderWrap"], .product-page__header-wrap');
            if (!header) return;

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
            if (copyOnly) {
                await copyToClipboard(txt);
                return;
            }
            const fname = slug(brand + ' ' + title) + '.txt';
            downloadTextFile(fname, txt);
        }

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
    const host = String(location.hostname || '').toLowerCase();
    if (host.includes('ozon')) {
        initOzon();
    } else if (host.includes('wildberries') || host.endsWith('wb.ru')) {
        initWB();
    }
})();

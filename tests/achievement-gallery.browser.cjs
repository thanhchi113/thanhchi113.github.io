const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://achievement-gallery.test';
const output = process.env.TEST_OUTPUT_DIR || path.resolve(root, '../..');

function mockSdk() {
    const evidence = Array.from({ length: 12 }, (_, index) => ({
        id: `evidence-${index + 1}`, title: `Minh chứng ${index + 1}`, student_name: `Học sinh minh chứng ${index + 1}`,
        course_name: 'Luyện thi vào 10', school_name: 'THPT Minh Họa', result_summary: '9 điểm',
        description: 'Học sinh tiến bộ qua quá trình ôn tập và tự luyện.', image_path: `evidence-${index + 1}.svg`, group_key: 'grade10', published: true
    }));
    evidence.push({ ...evidence[0], id: 'feedback', title: 'Phản hồi duy nhất', group_key: 'feedback' });
    const scores = Array.from({ length: 12 }, (_, index) => ({
        id: `score-${index + 1}`, student_name: index === 3 ? 'TÊN RIÊNG TƯ KHÔNG ĐƯỢC LỘ' : `Học sinh điểm ${index + 1}`,
        hide_student_name: index === 3, score: index === 0 ? 8.5 : 5 + index / 10,
        period: index % 2 ? 'ck1' : 'gk1', grade: 12, class_name: index < 6 ? '12A1' : '12A2',
        school_year: '2026-2027', evidence_image_path: index === 1 ? 'scores/delayed.svg' : index === 2 ? 'scores/current.svg' : index === 3 ? 'scores/private.svg' : null,
        published: true, created_at: `2026-09-${String(13 - index).padStart(2, '0')}T00:00:00Z`
    }));
    const mock = window.galleryMock = { writes: [], signs: [], held: [], holdImage: false };
    mock.releaseImages = () => { mock.holdImage = false; mock.held.splice(0).forEach(resolve => resolve()); };
    const client = {
        auth: { async getUser() { return { data: { user: null }, error: null }; }, onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
        async rpc(name, params) {
            if (name === 'get_published_exam_scores') return { data: scores.slice(params.page_offset, params.page_offset + params.page_limit), error: null };
            throw new Error(`Unexpected RPC ${name}`);
        },
        from(table) {
            const filters = [];
            let single = false;
            const finish = () => {
                let data = table === 'achievement_evidence' ? evidence.filter(row => filters.every(([key, value]) => row[key] === value)) : table === 'site_configuration' ? null : table === 'exam_score_settings' ? { id: 1, statistics_enabled: false, enabled_periods: ['gk1', 'ck1', 'gk2', 'ck2'] } : [];
                if (single && Array.isArray(data)) data = data[0] || null;
                return Promise.resolve({ data, error: null });
            };
            const query = new Proxy({}, { get: (_, key) => {
                if (key === 'then') return (resolve, reject) => finish().then(resolve, reject);
                if (key === 'maybeSingle' || key === 'single') return () => { single = true; return finish(); };
                return (...args) => {
                    if (key === 'eq') filters.push(args);
                    if (['insert', 'update', 'upsert', 'delete'].includes(key)) { mock.writes.push([table, key]); throw new Error('Public gallery must never write data'); }
                    return query;
                };
            } });
            return query;
        },
        storage: { from(bucket) { return {
            getPublicUrl(file) { return { data: { publicUrl: `${location.origin}/fixture/${file}` } }; },
            async createSignedUrl(file) {
                mock.signs.push({ bucket, file });
                if (file === 'scores/delayed.svg' && mock.holdImage) await new Promise(resolve => mock.held.push(resolve));
                return { data: { signedUrl: `${location.origin}/fixture/${file}?token=mock` }, error: null };
            }
        }; } }
    };
    window.supabase = { createClient: () => client };
}

const image = '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="400"><rect width="560" height="400" fill="white"/><text x="30" y="50" fill="#21334f" font-size="25">KẾT QUẢ HỌC TẬP</text><path d="M60 245H500M280 80V340" stroke="#334155"/><path d="M90 330C200 -30 300 450 460 120" fill="none" stroke="#6554b8" stroke-width="4"/><text x="360" y="340" fill="#334155" font-size="28">8,5 / 10</text></svg>';

async function installIsolation(context) {
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
        // Every production request is blocked; fixtures run the actual local application scripts/styles.
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith('/fixture/')) return route.fulfill({ contentType: 'image/svg+xml', body: image });
        const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
        return route.fulfill({ contentType: types[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
    });
}

async function count(page, current, total) {
    await page.waitForFunction(([current, total]) => document.getElementById('achievementGalleryCount')?.textContent === `${current} / ${total}`, [current, total]);
}
async function opened(page) {
    await page.locator('#achievementGallery').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#achievementGallery').getAttribute('role'), 'dialog');
    assert.equal(await page.locator('#achievementGallery').getAttribute('aria-modal'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'achievementGalleryClose');
    assert(await page.locator('.evidence-page').evaluate(node => node.inert));
    assert(await page.locator('#siteHeader').evaluate(node => node.inert));
    assert.equal(await page.locator('body').evaluate(node => node.style.overflow), 'hidden');
}
async function closed(page, trigger, scrollY) {
    await page.locator('#achievementGallery').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.evidence-page').evaluate(node => node.inert), false);
    assert.equal(await page.locator('#siteHeader').evaluate(node => node.inert), false);
    assert.equal(await page.locator('body').evaluate(node => node.style.overflow), '');
    assert(await trigger.evaluate(node => node === document.activeElement || node.contains(document.activeElement)), 'Closing restores focus to the original card or its zoom button');
    if (scrollY !== undefined) assert(Math.abs(await page.evaluate(() => window.scrollY) - scrollY) <= 2, 'Closing restores the exact list scroll position');
}
async function noOverflow(page) {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow');
    assert(await page.locator('#achievementGallery').evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'No horizontal gallery overflow');
    assert(await page.locator('#achievementGalleryContent').evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'The entire card fits the gallery width');
}
async function sky(page) {
    return page.locator('.site-galaxy').evaluate(scene => {
        const canvas = scene.querySelector('canvas[data-galaxy-background-initialized]'), shade = scene.querySelector('.milky-way-shade');
        const css = node => { const style = getComputedStyle(node); return [style.background, style.opacity, style.filter, style.backdropFilter]; };
        return { scene: css(scene), canvas: css(canvas), shade: css(shade), count: scene.querySelectorAll('canvas').length };
    });
}
async function gallerySky(page, before, canvas) {
    assert.deepEqual(await sky(page), before, 'Opening/navigating cards preserves the existing galaxy styles and canvas count');
    assert(await canvas.evaluate(node => node.isConnected), 'The original renderer is retained');
    const style = await page.locator('#achievementGallery').evaluate(node => { const css = getComputedStyle(node); return { backdrop: css.backdropFilter, background: css.backgroundColor }; });
    assert.deepEqual(style, { backdrop: 'none', background: 'rgba(0, 0, 0, 0)' });
}
async function screenshot(page, name) {
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#achievementGalleryContent > *')).opacity) >= .99);
    await page.screenshot({ path: path.join(output, `achievement-gallery-${name}.png`) });
}

(async () => {
    const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
    try {
        for (const mobile of [false, true]) {
            const label = mobile ? 'mobile' : 'desktop';
            const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, isMobile: mobile, hasTouch: mobile });
            await installIsolation(context);
            const page = await context.newPage(), errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`${origin}/achievements.html?type=grade10`);
            await page.locator('#evidenceGrid .evidence-card').first().waitFor();
            assert.equal(await page.locator('#evidenceGrid .evidence-card').count(), 10);
            await page.waitForFunction(() => document.querySelector('[data-galaxy-background-initialized]')?.dataset.galaxyTextureReady === 'true');
            const background = await sky(page), canvas = await page.locator('[data-galaxy-background-initialized]').elementHandle();
            const evidence = page.locator('#evidenceGrid .evidence-card').first();
            await evidence.locator('h2').scrollIntoViewIfNeeded();
            const originalScroll = await page.evaluate(() => scrollY);
            await evidence.locator('h2').click();
            await opened(page);
            await count(page, 1, 12);
            assert(await page.locator('#achievementGalleryPrev').isDisabled());
            assert.match(await page.locator('#achievementGalleryContent').textContent(), /Minh chứng 1.*Học sinh minh chứng 1.*Luyện thi vào 10.*THPT Minh Họa.*9 điểm/s);
            assert(await page.locator('#achievementGalleryContent .evidence-image-wrap img').isVisible());
            assert.equal(await page.locator('#achievementGalleryContent .evidence-zoom').count(), 0);
            await noOverflow(page);
            await gallerySky(page, background, canvas);
            await screenshot(page, `evidence-${label}`);
            await page.keyboard.press('ArrowLeft');
            await count(page, 1, 12);
            for (let number = 2; number <= 12; number++) {
                if (number % 2) await page.locator('#achievementGalleryNext').click(); else await page.keyboard.press('ArrowRight');
                await count(page, number, 12);
                assert.equal(await page.locator('#achievementGalleryContent h2').textContent(), `Minh chứng ${number}`);
            }
            assert(await page.locator('#achievementGalleryNext').isDisabled());
            await page.keyboard.press('ArrowRight');
            await count(page, 12, 12);
            await page.locator('#achievementGalleryPrev').click();
            await count(page, 11, 12);
            await page.keyboard.press('ArrowLeft');
            await count(page, 10, 12);
            await page.locator('#achievementGalleryClose').click();
            await closed(page, evidence, originalScroll);
            assert.equal(await page.locator('#evidenceGrid .evidence-card').first().locator('h2').textContent(), 'Minh chứng 1', 'Viewer navigation does not replace the underlying list page');
            for (const key of ['Enter', 'Space']) {
                await evidence.focus();
                await page.keyboard.press(key);
                await opened(page);
                await page.keyboard.press('Escape');
                await closed(page, evidence);
            }
            await evidence.locator('img').click();
            await opened(page);
            await page.locator('#achievementGallery').click({ position: { x: 3, y: 80 } });
            await closed(page, evidence);
            await page.locator('#evidencePagination [data-evidence-page="2"]').first().click();
            const secondPageEvidence = page.locator('#evidenceGrid .evidence-card').first();
            await secondPageEvidence.locator('.evidence-zoom').click();
            await count(page, 11, 12);
            await page.keyboard.press('Escape');
            await closed(page, secondPageEvidence);
            await page.locator('[data-type="feedback"]').click();
            await page.locator('#evidenceGrid .evidence-card h2').filter({ hasText: 'Phản hồi duy nhất' }).waitFor();
            await page.locator('#evidenceGrid .evidence-card').click();
            await opened(page);
            await count(page, 1, 1);
            assert(await page.locator('#achievementGalleryPrev').isDisabled());
            assert(await page.locator('#achievementGalleryNext').isDisabled());
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'achievementGalleryClose');
            await page.keyboard.press('Shift+Tab');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'achievementGalleryClose');
            await page.keyboard.press('Escape');

            await page.locator('[data-type="scores"]').click();
            await page.locator('#scoreStudentCards .exam-student-card').first().waitFor();
            const score = page.locator('#scoreStudentCards .exam-student-card').first();
            const url = page.url(), tabs = context.pages().length;
            await score.locator('.exam-score-paper').click();
            await opened(page);
            await count(page, 1, 12);
            assert.match(await page.locator('#achievementGalleryContent').textContent(), /Giữa kỳ 1.*Học sinh điểm 1.*8,5.*12A1.*12.*2026-2027/s);
            assert.equal(await page.locator('#achievementGalleryContent .exam-score-paper').getAttribute('data-score-display'), '8,5');
            assert(await page.locator('#achievementGalleryContent .exam-student-info').isVisible());
            assert(await page.locator('#achievementGalleryContent .exam-student-media').isVisible());
            await noOverflow(page);
            await gallerySky(page, background, canvas);
            await screenshot(page, `score-${label}`);
            await page.keyboard.press('Tab');
            assert(await page.evaluate(() => document.getElementById('achievementGallery').contains(document.activeElement)));
            await page.keyboard.press('Shift+Tab');
            assert(await page.evaluate(() => document.getElementById('achievementGallery').contains(document.activeElement)));
            await page.keyboard.press('Escape');
            await closed(page, score);
            for (const key of ['Enter', 'Space']) {
                await score.focus();
                await page.keyboard.press(key);
                await opened(page);
                await page.keyboard.press('Escape');
                await closed(page, score);
            }
            await score.locator('h3').click();
            await opened(page);
            for (let number = 2; number <= 12; number++) {
                await page.keyboard.press('ArrowRight');
                await count(page, number, 12);
                if (number === 4) {
                    assert.match(await page.locator('#achievementGalleryContent').textContent(), /Đã ẩn tên/);
                    assert(!await page.locator('body').evaluate(node => node.innerHTML.includes('TÊN RIÊNG TƯ KHÔNG ĐƯỢC LỘ') || node.innerHTML.includes('scores/private.svg')), 'Hidden student name/path never enter the DOM or accessible labels');
                    assert.equal(await page.locator('#achievementGalleryContent img').count(), 0);
                } else assert.equal(await page.locator('#achievementGalleryContent h3').textContent(), `Học sinh điểm ${number}`);
            }
            assert(await page.locator('#achievementGalleryNext').isDisabled());
            assert.equal(await page.evaluate(() => galleryMock.signs.some(item => item.file.includes('private'))), false, 'Private evidence is never signed');
            await page.keyboard.press('Escape');
            await page.locator('#scoreStudentPagination [data-student-page="2"]').first().click();
            await page.locator('#scoreStudentCards .exam-student-card').first().click();
            await count(page, 11, 12);
            await page.keyboard.press('ArrowLeft');
            await count(page, 10, 12);
            await page.keyboard.press('Escape');
            await page.selectOption('#scoreClassFilter', '12A2');
            assert.equal(await page.locator('#scoreStudentCards .exam-student-card').count(), 6);
            await page.locator('#scoreStudentCards .exam-student-card').first().click();
            await count(page, 1, 6);
            for (let number = 1; number <= 6; number++) {
                assert.equal(await page.locator('#achievementGalleryContent h3').textContent(), `Học sinh điểm ${number + 6}`);
                assert.match(await page.locator('#achievementGalleryContent').textContent(), /12A2/);
                if (number < 6) await page.keyboard.press('ArrowRight');
            }
            assert(await page.locator('#achievementGalleryNext').isDisabled());
            await page.keyboard.press('Escape');
            await page.selectOption('#scoreClassFilter', 'all');
            await page.evaluate(() => { galleryMock.holdImage = true; });
            await page.locator('#scoreStudentCards .exam-student-card').nth(1).locator('h3').click();
            await count(page, 2, 12);
            await page.waitForFunction(() => galleryMock.held.length > 0);
            await page.locator('#achievementGalleryNext').click();
            await count(page, 3, 12);
            await page.waitForFunction(() => document.querySelector('#achievementGalleryContent img')?.naturalWidth > 0);
            await page.evaluate(() => galleryMock.releaseImages());
            await page.waitForTimeout(80);
            assert.equal(await page.locator('#achievementGalleryContent h3').textContent(), 'Học sinh điểm 3');
            assert.match(await page.locator('#achievementGalleryContent img').getAttribute('src'), /scores\/current\.svg/);
            assert.equal(await page.locator('#achievementGalleryContent a').count(), 0, 'An enlarged score image does not open a raw storage tab');
            await page.locator('#achievementGalleryContent img').click();
            assert.equal(page.url(), url);
            assert.equal(context.pages().length, tabs);
            await noOverflow(page);
            await screenshot(page, `image-${label}`);
            await page.keyboard.press('Escape');
            if (mobile) {
                await page.setViewportSize({ width: 320, height: 700 });
                await score.click();
                await noOverflow(page);
                await page.keyboard.press('Escape');
            }
            assert.deepEqual(await page.evaluate(() => galleryMock.writes), []);
            assert.deepEqual(errors, []);
            await context.close();
            console.log(`PASS ${label}: whole-card text/image/LED and keyboard opening, bounds/arrows, both lists beyond 10, filtered subset, privacy, stale image safety, focus/scroll, unchanged sky and mobile fit`);
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://evidence-display.test';

function mockSdk() {
    const mock = window.evidenceMock = { signs: [], reads: [], rpcs: [], held: [], hold: false, fail: false };
    mock.release = () => { mock.hold = false; mock.held.splice(0).forEach(resolve => resolve()); };
    const rows = Array.from({ length: 12 }, (_, index) => ({
        id: `evidence-${index}`, title: `Minh chứng ${index + 1}`, group_key: 'grade10',
        student_name: `Học sinh ${index + 1}`, course_name: 'Lớp Toán 10', school_name: 'THPT Minh Họa',
        result_summary: 'Đạt mục tiêu', description: 'Nội dung phản hồi', image_path: null
    }));
    Object.assign(rows[0], {
        student_name: 'HIDDEN_NAME', course_name: 'HIDDEN_COURSE', school_name: 'HIDDEN_SCHOOL',
        result_summary: 'HIDDEN_RESULT', description: 'HIDDEN_DESCRIPTION',
        show_student_name: false, show_course_name: false, show_school_name: false,
        show_result_summary: false, show_description: false
    });
    Object.assign(rows[1], { image_path: 'private.jpg', show_image: false, result_summary: '9' });
    Object.assign(rows[2], { image_path: 'public.svg', result_summary: '9,5 điểm Toán' });
    Object.assign(rows[3], { image_path: 'missing.svg', result_summary: 'Đạt 8,75 điểm Toán' });
    rows[4].image_path = 'delayed.svg';
    Object.assign(rows[6], { result_summary: '9,75', show_result_summary: false });
    rows[7].result_summary = 'Đậu nguyện vọng trường Quốc Học Quy Nhơn';
    rows[8].result_summary = 'Năm học 2025-2026';
    const client = {
        auth: { async getUser() { return { data: { user: null }, error: null }; } },
        async rpc(name, params) {
            mock.rpcs.push({ name, params });
            if (name !== 'get_published_achievement_evidence') throw new Error(`Unexpected RPC ${name}`);
            if (mock.fail) return { data: null, error: { code: 'PGRST202', message: 'RPC missing' } };
            return { data: params.evidence_group === 'grade10' ? rows.slice(params.page_offset, params.page_offset + params.page_limit) : [], error: null };
        },
        from(table) {
            mock.reads.push(table);
            if (table === 'achievement_evidence') throw new Error('Raw public evidence reads leak hidden fields');
            const result = () => Promise.resolve({ data: table === 'site_configuration' ? null : [], error: null });
            const query = new Proxy({}, { get: (_, key) => key === 'then' ? (resolve, reject) => result().then(resolve, reject) : () => query });
            return query;
        },
        storage: { from(bucket) { return {
            getPublicUrl() { throw new Error('Evidence bucket must remain private'); },
            async createSignedUrl(file, duration) {
                mock.signs.push({ bucket, file, duration });
                if (file === 'delayed.svg' && mock.hold) await new Promise(resolve => mock.held.push(resolve));
                return { data: { signedUrl: `${location.origin}/fixture/${file}?token=short-lived` }, error: null };
            }
        }; } }
    };
    window.supabase = { createClient: () => client };
}

async function isolated(context) {
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith('/fixture/')) return route.fulfill(url.pathname.endsWith('missing.svg') ? { status: 404, body: '' } : { contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="240"><rect width="300" height="240" fill="#83b3df"/></svg>' });
        const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
        return route.fulfill({ contentType: types[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
    });
}

(async () => {
    const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
    try {
        for (const mobile of [false, true]) {
            const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 }, isMobile: mobile, hasTouch: mobile });
            await isolated(context);
            const page = await context.newPage(), errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`${origin}/achievements.html?type=grade10`);
            await page.waitForFunction(() => document.querySelectorAll('#evidenceGrid .evidence-card').length === 10);
            if (!mobile) {
                const values = ['0', '10/10', 'Điểm Toán: 9', '11', '-1', 'Toán 9 điểm, Lý 8 điểm', '', null];
                const displays = await page.evaluate(values => values.map(result_summary => {
                    const template = document.createElement('template');
                    template.innerHTML = EvidenceDisplay.illustration({ result_summary });
                    return template.content.querySelector('[data-score-display]')?.getAttribute('data-score-display') ?? null;
                }), values);
                assert.deepEqual(displays, ['0', '10', '9', null, null, null, null, null], 'Score parsing keeps valid endpoints and rejects out-of-range, negative and ambiguous results');
            }
            const cards = page.locator('#evidenceGrid .evidence-card');
            assert.equal(await cards.first().locator('.evidence-math-paper').count(), 1);
            assert.equal(await cards.first().locator('img, .esp-led, [data-score-display]').count(), 0, 'Text-only evidence must not fabricate a score');
            assert.equal(await cards.nth(1).locator('[data-score-display]').getAttribute('data-score-display'), '9', 'A numeric evidence result appears in the right illustration');
            assert.equal(await cards.nth(1).locator('.evidence-fact').filter({ hasText: /^Điểm/ }).count(), 1, 'The public score field is labelled Điểm');
            for (const index of [6, 7, 8]) assert.equal(await cards.nth(index).locator('.esp-led, [data-score-display]').count(), 0, 'Hidden scores and non-score text do not produce LED digits');
            assert(!(await cards.nth(6).innerHTML()).includes('9,75'), 'A hidden score cannot leak into SVG markup or attributes');
            assert(!(await page.content()).includes('HIDDEN_'), 'Hidden fields never appear in content, HTML attributes, or accessible labels');
            assert.match(await cards.first().textContent(), /Đã ẩn tên/);
            await cards.first().locator('h2').click();
            await page.locator('#achievementGallery').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#achievementGalleryContent .evidence-math-paper').count(), 1);
            assert.equal(await page.locator('#achievementGalleryCount').textContent(), '1 / 12');
            const layout = await page.locator('#achievementGalleryContent .evidence-card').evaluate(card => {
                const info = card.querySelector('.evidence-content').getBoundingClientRect();
                const media = card.querySelector('.evidence-media').getBoundingClientRect();
                return { infoX: info.x, infoBottom: info.bottom, mediaX: media.x, mediaTop: media.top, mediaWidth: media.width, mediaHeight: media.height, width: innerWidth, scrollWidth: document.documentElement.scrollWidth };
            });
            assert(layout.mediaWidth > 170 && layout.mediaHeight >= 260, 'Illustration is visible at readable size');
            assert(mobile ? layout.mediaTop >= layout.infoBottom - 1 : layout.mediaX > layout.infoX, 'Content stays left / first, illustration right / below');
            assert(layout.scrollWidth <= layout.width + 1, 'No horizontal page overflow');
            await page.screenshot({ path: path.resolve(root, '../..', `evidence-optional-${mobile ? 'mobile' : 'desktop'}.png`) });
            await page.keyboard.press('ArrowRight');
            assert.equal(await page.locator('#achievementGalleryContent img').count(), 0);
            assert.equal(await page.locator('#achievementGalleryContent .evidence-math-paper').count(), 1);
            assert.equal(await page.locator('#achievementGalleryContent [data-score-display]').getAttribute('data-score-display'), '9', 'Gallery carries the same student score as the card');
            const scorePhases = await page.locator('#achievementGalleryContent .evidence-math-paper').evaluate(svg => {
                const animations = svg.getAnimations({ subtree: true });
                const sample = time => {
                    for (const animation of animations) { animation.pause(); animation.currentTime = time; }
                    return { led: getComputedStyle(svg.querySelector('.esp-led')).opacity, quartic: getComputedStyle(svg.querySelector('.esp-scene-quartic')).opacity };
                };
                return { graph: sample(18000), led: sample(22000) };
            });
            assert.equal(scorePhases.graph.led, '0', 'LED waits until the graph sequence has completed');
            assert.deepEqual(scorePhases.led, { led: '1', quartic: '0' }, 'Completed graph gives way to the LED score without overlap');
            await page.locator('#achievementGalleryContent .evidence-card').evaluate(card => card.getAnimations().forEach(animation => animation.finish()));
            if (mobile) await page.locator('#achievementGalleryContent .evidence-media').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.resolve(root, '../..', `evidence-led-${mobile ? 'mobile' : 'desktop'}.png`) });
            await page.emulateMedia({ reducedMotion: 'reduce' });
            const staticScore = await page.locator('#achievementGalleryContent .evidence-math-paper').evaluate(svg => ({ led: getComputedStyle(svg.querySelector('.esp-led')).opacity, graph: getComputedStyle(svg.querySelector('.esp-graph')).opacity }));
            assert.deepEqual(staticScore, { led: '1', graph: '0' }, 'Reduced motion retains the readable score without overlapping drawings');
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            await page.keyboard.press('ArrowRight');
            await page.waitForFunction(() => document.querySelector('#achievementGalleryContent img')?.naturalWidth > 0);
            assert.match(await page.locator('#achievementGalleryContent img').getAttribute('src'), /public\.svg/);
            assert.equal(await page.locator('#achievementGalleryContent .esp-led').count(), 0, 'An uploaded image is preserved in the right column');
            await page.keyboard.press('ArrowRight');
            await page.waitForFunction(() => evidenceMock.signs.some(row => row.file === 'missing.svg'));
            assert.equal(await page.locator('#achievementGalleryContent .evidence-math-paper').count(), 1, 'Broken image keeps the animated illustration');
            assert.equal(await page.locator('#achievementGalleryContent [data-score-display]').getAttribute('data-score-display'), '8,75', 'A score embedded in Vietnamese text is extracted without losing decimal precision');
            await page.evaluate(() => { evidenceMock.hold = true; });
            await page.keyboard.press('ArrowRight');
            await page.waitForFunction(() => evidenceMock.held.length > 0);
            await page.keyboard.press('ArrowRight');
            await page.evaluate(() => evidenceMock.release());
            await page.waitForTimeout(100);
            assert.equal(await page.locator('#achievementGalleryContent h2').textContent(), 'Minh chứng 6');
            assert.equal(await page.locator('#achievementGalleryContent img').count(), 0, 'Discarded async image cannot overwrite another card');
            const finalGraph = await page.locator('#achievementGalleryContent .evidence-math-paper').evaluate(svg => {
                for (const animation of svg.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 22000; }
                return { quartic: getComputedStyle(svg.querySelector('.esp-scene-quartic')).opacity, curve: parseFloat(getComputedStyle(svg.querySelector('.esp-scene-quartic .esp-curve')).strokeDashoffset) };
            });
            assert.deepEqual(finalGraph, { quartic: '1', curve: 0 }, 'The last completed graph remains during the old LED phase');
            await page.emulateMedia({ reducedMotion: 'reduce' });
            const staticGraph = await page.locator('#achievementGalleryContent .evidence-math-paper').evaluate(svg => ({
                graph: getComputedStyle(svg.querySelector('.esp-graph')).opacity,
                parabola: getComputedStyle(svg.querySelector('.esp-scene-parabola')).opacity,
                curve: Number.parseFloat(getComputedStyle(svg.querySelector('.esp-scene-parabola .esp-curve')).strokeDashoffset),
                cubic: getComputedStyle(svg.querySelector('.esp-scene-cubic')).opacity
            }));
            assert.deepEqual(staticGraph, { graph: '1', parabola: '1', curve: 0, cubic: '0' });
            await page.keyboard.press('Escape');
            await page.locator('#evidencePagination [data-evidence-page="2"]').first().click();
            assert.equal(await cards.count(), 2);
            await cards.first().locator('h2').click();
            assert.equal(await page.locator('#achievementGalleryCount').textContent(), '11 / 12');
            await page.keyboard.press('Escape');
            await page.locator('[data-type="grade12"]').click();
            await page.locator('#evidenceGrid .evidence-empty').waitFor();
            assert.match(await page.locator('#evidenceGrid').textContent(), /Chưa có kết quả được đăng/);
            assert.equal(await cards.count(), 0, 'The THPT group must not inject an undeletable sample');
            await page.evaluate(() => { evidenceMock.fail = true; });
            await page.locator('[data-type="grade12"]').click();
            await page.locator('#evidenceGrid .evidence-empty').waitFor();
            assert.match(await page.locator('#evidenceGrid').textContent(), /Chưa thể tải kết quả/);
            assert.equal(await page.evaluate(() => evidenceMock.reads.includes('achievement_evidence')), false, 'Missing RPC never falls back to exposing the table');
            const signs = await page.evaluate(() => evidenceMock.signs);
            assert(signs.every(row => row.bucket === 'achievement-evidence' && row.duration === 60));
            assert(!signs.some(row => row.file === 'private.jpg'), 'Hidden images must not be signed or fetched');
            assert.deepEqual(errors, []);
            await context.close();
        }
        console.log('Evidence display: desktop/mobile, numeric and text-derived LED scores, animation phases, hidden fields, optional/private/broken images, gallery, stale image guard, pagination, safe RPC failure and reduced motion passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

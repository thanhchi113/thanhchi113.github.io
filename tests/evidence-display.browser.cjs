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
    Object.assign(rows[1], { image_path: 'private.jpg', show_image: false });
    rows[2].image_path = 'public.svg';
    rows[3].image_path = 'missing.svg';
    rows[4].image_path = 'delayed.svg';
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
            const cards = page.locator('#evidenceGrid .evidence-card');
            assert.equal(await cards.first().locator('.evidence-math-paper').count(), 1);
            assert.equal(await cards.first().locator('img, .esp-led, [data-score-display]').count(), 0, 'Text-only evidence must not fabricate a score');
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
            await page.keyboard.press('ArrowRight');
            await page.waitForFunction(() => document.querySelector('#achievementGalleryContent img')?.naturalWidth > 0);
            assert.match(await page.locator('#achievementGalleryContent img').getAttribute('src'), /public\.svg/);
            await page.keyboard.press('ArrowRight');
            await page.waitForFunction(() => evidenceMock.signs.some(row => row.file === 'missing.svg'));
            assert.equal(await page.locator('#achievementGalleryContent .evidence-math-paper').count(), 1, 'Broken image keeps the animated illustration');
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
            assert.match(await page.locator('#evidenceGrid').textContent(), /Chưa có minh chứng được đăng/);
            assert.equal(await cards.count(), 0, 'The THPT group must not inject an undeletable sample');
            await page.evaluate(() => { evidenceMock.fail = true; });
            await page.locator('[data-type="grade12"]').click();
            await page.locator('#evidenceGrid .evidence-empty').waitFor();
            assert.match(await page.locator('#evidenceGrid').textContent(), /Chưa thể tải minh chứng/);
            assert.equal(await page.evaluate(() => evidenceMock.reads.includes('achievement_evidence')), false, 'Missing RPC never falls back to exposing the table');
            const signs = await page.evaluate(() => evidenceMock.signs);
            assert(signs.every(row => row.bucket === 'achievement-evidence' && row.duration === 60));
            assert(!signs.some(row => row.file === 'private.jpg'), 'Hidden images must not be signed or fetched');
            assert.deepEqual(errors, []);
            await context.close();
        }
        console.log('Evidence display: desktop/mobile, hidden fields, optional/private/broken images, gallery, stale image guard, pagination, safe RPC failure and reduced motion passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

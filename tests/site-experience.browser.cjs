const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), origin = 'https://experience.test';
function sdk() {
    const callbacks = [];
    const client = {
        auth: { async getUser() { return { data: { user: { id: 'test-admin', email: 'admin@example.test' } }, error: null }; }, onAuthStateChange(fn) { callbacks.push(fn); return { data: { subscription: { unsubscribe() {} } } }; } },
        async rpc(name) { return { data: name === 'current_user_is_admin' ? true : [], error: null }; },
        from(table) {
            const request = { table, action: 'read', filters: {} };
            const finish = () => window.configurationRequest(request);
            const query = new Proxy({}, { get: (_, key) => {
                if (key === 'then') return (resolve, reject) => finish().then(resolve, reject);
                if (key === 'single' || key === 'maybeSingle') return finish;
                return (...args) => { if (key === 'eq') request.filters[args[0]] = args[1]; if (['update','insert','delete'].includes(key)) { request.action = key; request.payload = args[0]; } return query; };
            } }); return query;
        },
        storage: { from() { return { getPublicUrl() { return { data: { publicUrl: location.origin + '/fixture.svg' } }; } }; } }
    }; window.supabase = { createClient: () => client };
}
async function ready(page) {
    await page.waitForFunction(() => document.querySelector('.milky-way-canvas')?.dataset.galaxyTextureReady === 'true' && document.querySelector('[data-galaxy-clouds]')?.dataset.textureReady === 'true');
}
async function paused(page, expected) {
    await page.waitForFunction(expected => document.querySelector('.site-galaxy .milky-way-canvas')?.dataset.galaxyPaused === String(expected), expected);
    assert.equal(await page.evaluate(() => GalaxyClouds.mount(document.querySelector('.site-galaxy')).getState().paused), expected);
}
(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const state = { value: {}, version: 1, writes: 0, fail: false };
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.exposeBinding('configurationRequest', (_, request) => {
            if (request.table === 'achievement_evidence') return { data: [{ title: 'Phản hồi của học sinh', student_name: 'Nguyễn Thị Ánh', description: 'Nỗ lực và tiến bộ mỗi ngày.', course_name: 'Lớp 12', image_path: 'sample.svg' }], error: null };
            if (request.table !== 'site_configuration') return { data: [], error: null };
            if (request.filters.id !== 'site_content') return { data: { value: {} }, error: null };
            if (request.action === 'update') {
                if (state.fail) return { data: null, error: { message: 'Thử nghiệm lỗi lưu' } };
                assert.equal(request.filters.updated_at, String(state.version));
                state.value = structuredClone(request.payload.value); state.version++; state.writes++;
            }
            return { data: { value: structuredClone(state.value), updated_at: String(state.version) }, error: null };
        });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${sdk.toString()})();` });
            if (url.origin !== origin) return route.abort();
            if (url.pathname === '/fixture.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="white"/><text x="20" y="100" font-size="40">8,5 / 10</text></svg>' });
            const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
            const types = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.woff2':'font/woff2', '.png':'image/png', '.jpg':'image/jpeg' };
            return route.fulfill({ body: fs.readFileSync(file), contentType: types[path.extname(file)] || 'application/octet-stream' });
        });
        await context.addInitScript(() => {
            window.skyPaints = 0;
            const clear = CanvasRenderingContext2D.prototype.clearRect;
            CanvasRenderingContext2D.prototype.clearRect = function (...args) { if (this.canvas.classList.contains('milky-way-canvas')) window.skyPaints++; return clear.apply(this, args); };
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/achievements.html?type=grade10'); await ready(page);
        await page.evaluate(() => document.fonts.ready);
        const boxes = [];
        for (const group of ['grade10','feedback','scores','grade12']) {
            await page.locator(`[data-type="${group}"]`).click();
            boxes.push(await page.locator('.evidence-filters').boundingBox());
        }
        boxes.forEach(box => assert.deepEqual(box, boxes[0], 'Four group buttons stay in the same place'));
        const card = page.locator('#evidenceGrid .evidence-card').first();
        const info = await card.locator('.evidence-content').boundingBox(), media = await card.locator('.evidence-image-wrap').boundingBox();
        assert(info.x < media.x, 'Evidence content left, image right');
        assert.equal(await card.evaluate(node => getComputedStyle(node).cursor), 'pointer');
        await card.click();
        const enlarged = page.locator('#achievementGalleryContent .evidence-card');
        assert((await enlarged.locator('.evidence-content').boundingBox()).x < (await enlarged.locator('.evidence-image-wrap').boundingBox()).x);
        await page.mouse.move(400, 300);
        await page.waitForFunction(() => document.querySelector('.site-pointer-glow')?.dataset.active === 'true');
        assert.equal(await page.locator('.site-pointer-glow').evaluate(node => getComputedStyle(node).pointerEvents), 'none');
        assert(Number(await page.locator('.site-pointer-glow').evaluate(node => getComputedStyle(node).zIndex)) > 5100);
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#achievementGalleryContent > *')).opacity) >= .99);
        await page.screenshot({ path: path.join(root, '../../experience-gallery-desktop.png') });
        await page.keyboard.press('Escape');
        await page.locator('#siteMotionToggle').click(); await paused(page, true);
        const paints = await page.evaluate(() => skyPaints); await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => skyPaints), paints, 'Paused sky does not keep painting');
        await page.reload(); await ready(page); await paused(page, true);
        assert(await page.locator('.milky-way-canvas').evaluate(canvas => {
            const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
            return data.some((value,index) => index % 4 !== 3 && value > 60);
        }), 'Initially paused sky still renders its star/cloud texture');
        await page.locator('#siteMotionToggle').click(); await paused(page, false);
        const admin = await context.newPage(); admin.on('pageerror', error => errors.push(error.message));
        await admin.goto(origin + '/admin.html#admin-content');
        await admin.waitForFunction(() => document.querySelector('[data-content-status]')?.textContent.includes('Đã tải'));
        await admin.selectOption('#siteContentSection', 'appearance');
        const toggle = admin.locator('[name="appearance.motionEnabled"]');
        await toggle.uncheck(); assert.equal(state.writes, 0, 'Draft only until Save');
        await admin.locator('[data-content-save]').click();
        await admin.waitForFunction(() => document.querySelector('[data-content-status]').textContent.includes('Đã lưu.'));
        assert.equal(state.value['appearance.motionEnabled'], false);
        await page.evaluate(() => SiteExperience.refresh()); await paused(page, true);
        assert(await page.locator('#siteMotionToggle').isDisabled(), 'Global off cannot be bypassed by personal on');
        assert.equal(await admin.locator('#adminGalaxyToggle').getAttribute('aria-pressed'), 'true', 'Admin own sky remains independent');
        state.fail = true; await toggle.check(); await admin.locator('[data-content-save]').click();
        await admin.waitForFunction(() => document.querySelector('[data-content-status]').textContent.includes('Thử nghiệm lỗi lưu'));
        assert.equal(state.value['appearance.motionEnabled'], false);
        state.fail = false; await admin.locator('[data-content-save]').click();
        await admin.waitForFunction(() => document.querySelector('[data-content-status]').textContent.includes('Đã lưu.'));
        await page.evaluate(() => SiteExperience.refresh()); await paused(page, false);
        for (const target of [page, admin]) {
            await target.evaluate(() => document.fonts.load('700 20px "Site Noto Sans"', 'Nguyễn Thị Ánh Đỗ trường ắ ễ ự'));
            await target.evaluate(() => document.fonts.load('italic 600 20px "Site Noto Sans"', 'Tiếng Việt ữ ệ'));
            assert(await target.evaluate(() => document.fonts.check('700 20px "Site Noto Sans"', 'Nguyễn Thị Ánh Đỗ trường ắ ễ ự')));
            assert.match(await target.locator('h1').first().evaluate(node => getComputedStyle(node).fontFamily), /Site Noto Sans/);
            assert.match(await target.locator('button').first().evaluate(node => getComputedStyle(node).fontFamily), /Site Noto Sans/);
        }
        await admin.screenshot({ path: path.join(root, '../../experience-admin-desktop.png') });
        await page.emulateMedia({ reducedMotion:'reduce' }); await paused(page,true);
        assert(await page.locator('#siteMotionToggle').isDisabled());
        await page.setViewportSize({ width:390,height:844 });
        await page.locator('[data-type="feedback"]').click();
        await page.screenshot({ path: path.join(root, '../../experience-mobile.png') });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.goto(origin + '/index.html'); await ready(page);
        assert.equal(await page.locator('#siteMotionToggle').count(), 1);
        assert.equal(await page.locator('.site-pointer-glow').count(), 1);
        for (const width of [320,800,1024,1280,1440]) {
            await page.setViewportSize({ width, height:900 });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Homepage fits ${width}px after changing fonts`);
        }
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(root, '../../experience-home-desktop.png') });
        await page.goto(origin + '/achievements.html?type=scores');
        for (const width of [800,1024,1280]) {
            await page.setViewportSize({ width, height:900 });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Achievement navigation fits ${width}px`);
        }
        await page.goto(origin + '/reset-password.html');
        await page.evaluate(() => document.fonts.ready);
        assert.match(await page.locator('h1').evaluate(node => getComputedStyle(node).fontFamily), /Site Noto Sans/);
        assert.equal(await page.locator('#siteMotionToggle').count(), 0, 'Recovery page has no unused galaxy control');
        assert.deepEqual(errors, []);
        console.log('PASS shared Vietnamese fonts, stable selectors, left content/right media, glow, saved personal motion, global admin override/save failures, static texture, reduced motion and mobile');
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

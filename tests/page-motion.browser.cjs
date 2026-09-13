const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

function mockSdk() {
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test' };
    const categories = ['Lớp 10', 'Lớp 11', 'Lớp 12', 'Ôn thi THPT'].map((name, index) => ({ id: String(index + 1), name, slug: `category-${index}`, parent_id: null, sort_order: index }));
    const client = {
        auth: {
            async getUser() { return { data: { user }, error: null }; },
            onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
        },
        async rpc(name) { return { data: name === 'current_user_is_admin' ? true : [], error: null }; },
        from(table) {
            const finish = () => Promise.resolve({ data: table === 'math_categories' ? categories : table === 'site_configuration' ? null : [], error: null });
            const query = new Proxy({}, { get: (_, key) => {
                if (key === 'then') return (resolve, reject) => finish().then(resolve, reject);
                if (key === 'maybeSingle' || key === 'single') return finish;
                return () => query;
            } });
            return query;
        },
        storage: { from() { return { getPublicUrl() { return { data: { publicUrl: '' } }; } }; } }
    };
    window.supabase = { createClient: () => client };
}

(async () => {
    const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.host === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
            // Every external request is blocked; no production reads or writes.
            if (url.origin !== 'https://motion.test') return route.abort();
            const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
            const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };
            return route.fulfill({ contentType: types[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://motion.test/index.html');
        await page.waitForFunction(() => document.querySelector('#milkyWayCanvas')?.dataset.galaxyTextureReady === 'true' && document.querySelector('[data-galaxy-clouds]')?.dataset.textureReady === 'true');
        assert.equal(await page.locator('#particleCanvas').count(), 0);
        assert.equal(await page.locator('[data-galaxy-clouds]').count(), 1);
        const card = page.locator('.document-category-card').filter({ hasText: 'Lớp 12' });
        const drawing = card.locator('.category-card-illustration');
        await drawing.waitFor({ state: 'attached' });
        await page.waitForFunction(() => [...document.querySelectorAll('.category-card-illustration')].every(node => node.classList.contains('motion-offscreen')));
        await card.scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll('.category-card-illustration')].some(node => !node.classList.contains('motion-offscreen')));
        await page.waitForTimeout(220);
        const active = card.locator('.ci-cycle-frame.is-active');
        const sample = () => active.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.animationName).map(animation => ({ name: animation.animationName, time: animation.currentTime, state: animation.playState })));
        const before = await sample();
        assert(before.length > 3 && before.every(animation => animation.state === 'running'));
        await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
        await drawing.evaluate(node => new Promise(resolve => {
            const check = () => node.classList.contains('motion-offscreen') ? resolve() : requestAnimationFrame(check);
            check();
        }));
        await page.waitForTimeout(100);
        const paused = await sample();
        assert(paused.every(animation => animation.state === 'paused'), 'The drawing and scene clock pause together');
        await page.waitForTimeout(300);
        assert.deepEqual(await sample(), paused, 'Offscreen drawings must retain their exact animation progress');
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(240);
        const resumed = await sample();
        assert(resumed.every((animation, index) => animation.state === 'running' && animation.time > paused[index].time), 'Drawing resumes without resetting');
        // Advance the whole current scene near completion and let its real clock switch scenes.
        await active.evaluate(node => {
            window.previousScene = node;
            const animations = node.getAnimations({ subtree: true }).filter(animation => animation.animationName);
            const duration = animations.find(animation => animation.animationName === 'ciSceneClock').effect.getTiming().duration;
            animations.forEach(animation => { animation.currentTime = Math.min(duration - 120, animation.effect.getTiming().duration); });
        });
        await page.waitForFunction(() => !window.previousScene.classList.contains('is-active'));
        assert.equal(await card.locator('.ci-cycle-frame.is-active').count(), 1);
        assert(await page.evaluate(() => window.previousScene.classList.contains('is-complete')));

        await page.addStyleTag({ path: path.join(root, 'assets/exam-score-paper.css') });
        await page.addScriptTag({ path: path.join(root, 'assets/exam-score-paper.js') });
        await page.evaluate(() => {
            const box = document.createElement('div');
            box.id = 'dynamicPaper'; box.style.cssText = 'width:220px;height:260px;margin-top:1200px';
            box.innerHTML = ExamScorePaper.render(8.5); document.body.append(box);
        });
        await page.waitForFunction(() => document.querySelector('#dynamicPaper svg').classList.contains('motion-offscreen'));
        await page.locator('#dynamicPaper').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => !document.querySelector('#dynamicPaper svg').classList.contains('motion-offscreen'));
        await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
        await page.waitForTimeout(100);
        assert(await page.locator('#dynamicPaper svg').evaluate(node => node.getAnimations({ subtree: true }).every(animation => animation.playState === 'paused')));
        await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        await page.waitForTimeout(100);
        assert(await page.locator('#dynamicPaper svg').evaluate(node => node.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')));
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await page.locator('#dynamicPaper .esp-led').evaluate(node => getComputedStyle(node).opacity), '1');
        await page.locator('#dynamicPaper').evaluate(node => node.remove());

        for (const url of ['achievements.html?type=grade12', 'admin.html#admin-scores']) {
            await page.goto(`https://motion.test/${url}`);
            await page.waitForFunction(() => document.querySelector('canvas[data-galaxy-background-initialized]')?.dataset.galaxyTextureReady === 'true');
            assert.equal(await page.locator('canvas[data-galaxy-background-initialized]').count(), 1);
            assert.equal(await page.locator('[data-galaxy-clouds]').count(), 1);
        }
        await page.locator('#adminGalaxyToggle').click();
        assert.equal(await page.locator('#adminGalaxyScene').evaluate(node => node.hidden), true);
        assert.equal(await page.locator('#adminGalaxyCanvas').getAttribute('data-galaxy-paused'), 'true');
        await page.reload();
        assert.equal(await page.locator('#adminGalaxyToggle').getAttribute('aria-pressed'), 'false');
        await page.locator('#adminGalaxyToggle').click();
        assert.equal(await page.locator('#adminGalaxyScene').evaluate(node => node.hidden), false);

        const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
        // Share the same fully isolated request handler with the mobile context.
        await mobile.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.host === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
            if (url.origin !== 'https://motion.test') return route.abort();
            const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
            const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };
            return route.fulfill({ contentType: types[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
        });
        const phone = await mobile.newPage(); phone.on('pageerror', error => errors.push(error.message));
        for (const url of ['index.html#documents', 'achievements.html?type=grade12', 'admin.html#admin-scores']) {
            await phone.goto(`https://motion.test/${url}`);
            await phone.waitForFunction(() => document.querySelector('canvas[data-galaxy-background-initialized]')?.dataset.galaxyTextureReady === 'true');
            for (const width of [390, 320]) {
                await phone.setViewportSize({ width, height: 844 });
                await phone.waitForTimeout(180);
                assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${url} fits ${width}px`);
            }
            if (url.startsWith('index')) {
                assert.equal(await phone.locator('.document-category-card').first().evaluate(node => getComputedStyle(node).backdropFilter), 'none');
            }
            await phone.screenshot({ path: path.join(root, `../../motion-${url.split('.')[0]}-mobile.png`) });
        }
        assert.deepEqual(errors, []);
        console.log('PASS: real pages, shared galaxy, offscreen synchronized scenes, dynamic cards, page lifecycle, reduced motion, admin toggle and mobile layout');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

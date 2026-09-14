const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.resolve(root, '../../test-output/document-illustrations');
const categoryNames = ['Lớp 10', 'Lớp 11', 'Lớp 12', 'Ôn thi vào 10', 'Ôn thi THPT', 'Chuyên đề'];

function mockSdk() {
    const categories = ['Lớp 10', 'Lớp 11', 'Lớp 12', 'Ôn thi vào 10', 'Ôn thi THPT', 'Chuyên đề']
        .map((name, index) => ({ id: String(index + 1), name, slug: `category-${index}`, parent_id: null, sort_order: index }));
    const client = {
        auth: {
            async getUser() { return { data: { user: null }, error: null }; },
            onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
        },
        async rpc() { return { data: [], error: null }; },
        from(table) {
            const finish = () => Promise.resolve({ data: table === 'math_categories' ? categories : table === 'site_configuration' ? null : [], error: null });
            const query = new Proxy({}, { get: (_, key) => {
                if (['insert', 'update', 'upsert', 'delete'].includes(key)) return () => { throw new Error(`Unexpected write: ${table}.${key}`); };
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

async function routeLocal(context) {
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.host === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
        // Production data and all network writes stay inaccessible to this test.
        if (url.origin !== 'https://illustrations.test') return route.abort();
        const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };
        return route.fulfill({ contentType: types[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
    });
}

async function seek(frame, time) {
    await frame.evaluate((node, value) => {
        node.getAnimations({ subtree: true }).filter(animation => animation.animationName).forEach(animation => {
            animation.pause();
            animation.currentTime = value;
        });
    }, time);
    await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
}

async function geometry(frame) {
    return frame.evaluate(node => ({
        reveal: [...node.querySelectorAll('.ci-area-reveal')].map(item => ({ width: parseFloat(getComputedStyle(item).width), opacity: parseFloat(getComputedStyle(item).opacity) })),
        curves: [...node.querySelectorAll('.ci-curve-primary,.ci-curve-secondary,.ci-parabola,.ci-cubic-curve,.ci-sine-curve')].map(item => ({ offset: parseFloat(getComputedStyle(item).strokeDashoffset), opacity: parseFloat(getComputedStyle(item).opacity) })),
        intersections: [...node.querySelectorAll('.ci-intersection')].map(item => parseFloat(getComputedStyle(item).opacity)),
        strokes: [...node.querySelectorAll('.ci-axis-x,.ci-axis-y,.ci-axis-z,.ci-chart-axis,.ci-chart-curve,.ci-paper,.ci-paper-line')].map(item => ({ offset: parseFloat(getComputedStyle(item).strokeDashoffset), opacity: parseFloat(getComputedStyle(item).opacity) })),
        edges: [...node.querySelectorAll('.ci-visible,.ci-hidden')].map(item => ({ offset: parseFloat(getComputedStyle(item).strokeDashoffset), opacity: parseFloat(getComputedStyle(item).opacity) }))
    }));
}

async function finishAndCheckNext(page, card, frame, index, count) {
    await frame.evaluate(node => {
        window.illustrationPreviousScene = node;
        window.illustrationPreviousClock = node.getAnimations().find(animation => animation.animationName === 'ciSceneClock');
        for (const animation of node.getAnimations({ subtree: true }).filter(animation => animation.animationName)) {
            animation.currentTime = 7940;
            animation.play();
        }
    });
    await page.waitForFunction(({ expected, count }) => {
        const previous = window.illustrationPreviousScene;
        const frames = [...previous.parentElement.children];
        const active = frames.find(frame => frame.classList.contains('is-active'));
        if (count === 1) return active === previous && active.getAnimations().some(animation => animation.animationName === 'ciSceneClock' && animation !== window.illustrationPreviousClock && animation.currentTime < 1000);
        return active === frames[expected] && !previous.classList.contains('is-active');
    }, { expected: (index + 1) % count, count });
    assert.equal(await card.locator('.ci-cycle-frame.is-active').count(), 1, 'Only one scene becomes active');
    if (count > 1) {
        assert(await frame.evaluate(node => node.classList.contains('is-complete')), 'The previous scene records completion');
        assert.equal(await frame.evaluate(node => getComputedStyle(node).opacity), '0', 'A completed scene cannot overlap the following drawing');
    }
}

(async () => {
    const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
    fs.mkdirSync(output, { recursive: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
        await routeLocal(context);
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://illustrations.test/index.html#documents');
        await page.waitForFunction(() => document.querySelectorAll('.document-category-card').length === 6);
        const expectedCounts = [2, 3, 2, 1, 2, 1];
        for (const [categoryIndex, name] of categoryNames.entries()) {
            const card = page.locator('.document-category-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
            await card.scrollIntoViewIfNeeded();
            await card.locator('.category-card-illustration').evaluate(node => new Promise(resolve => {
                const ready = () => node.classList.contains('motion-offscreen') ? requestAnimationFrame(ready) : resolve();
                ready();
            }));
            const frames = card.locator('.ci-cycle-frame');
            const count = await frames.count();
            assert.equal(count, expectedCounts[categoryIndex], `${name} keeps the expected illustration sequence`);
            if (name === 'Lớp 11') {
                assert.equal(await card.locator('.category-illustration-pyramid').count(), 1, 'Only the triangular pyramid remains');
                assert.equal(await card.locator('.category-illustration-pyramid .ci-vertices circle').count(), 4);
                assert.equal(await card.locator('.category-illustration-box .ci-visible').count(), 9);
                assert.equal(await card.locator('.category-illustration-box .ci-hidden').count(), 3);
                const sine = card.locator('.category-illustration-sine');
                assert.equal(await sine.count(), 1);
                const wave = await sine.locator('.ci-sine-curve').evaluate(node => {
                    const length = node.getTotalLength();
                    return Array.from({ length: 101 }, (_, index) => {
                        const point = node.getPointAtLength(length * index / 100);
                        return { x: point.x, y: point.y };
                    });
                });
                assert(Math.abs(wave[0].x - 24) < .05 && Math.abs(wave.at(-1).x - 216) < .05, 'Sine spans −2π to 2π');
                assert(wave.every((point, index) => index === 0 || point.x > wave[index - 1].x), 'The path is drawn from left to right');
                assert(wave.every(point => Math.abs((84 - point.y) / 34 - Math.sin((point.x - 120) * Math.PI / 48)) < .02), 'The path represents y = sin x');
                assert.match(await sine.textContent(), /sin\s*x/);
            }

            // Advance every scene using its real animationend handler, then loop back.
            const activeIndex = await frames.evaluateAll(nodes => nodes.findIndex(node => node.classList.contains('is-active')));
            for (let offset = 0; offset < count; offset += 1) {
                const index = (activeIndex + offset) % count;
                const frame = frames.nth(index);
                assert(await frame.evaluate(node => node.classList.contains('is-active')));
                const timings = await frame.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.animationName).map(animation => ({ name: animation.animationName, ...animation.effect.getComputedTiming() })));
                assert(timings.length > 1, `${name} has a clock and animated drawing`);
                const clock = timings.find(timing => timing.name === 'ciSceneClock');
                assert.equal(clock.duration, 8000, 'All categories use the same scene length');
                assert(timings.every(timing => timing.iterations === 1 && timing.endTime <= clock.endTime + 1), 'All staggered drawing parts finish before the scene changes');

                await seek(frame, 2800);
                const during = await geometry(frame);
                assert(during.reveal.every(reveal => reveal.width === 0), 'Area stays hidden while curves are being drawn');
                await seek(frame, 5600);
                const ready = await geometry(frame);
                assert(ready.curves.every(curve => Math.abs(curve.offset) < .01 && curve.opacity > .95), `${name} finishes its curves before the hold phase`);
                assert(ready.intersections.every(opacity => opacity > .95), 'Intersection markers are visible before the final filled region');
                await seek(frame, 7200);
                const held = await geometry(frame);
                assert.deepEqual(held.curves, ready.curves, 'Completed boundaries remain visible throughout area filling');
                assert(held.reveal.every((reveal, i) => reveal.width > 0 && reveal.width >= ready.reveal[i].width), 'The bounded area fills toward the right');
                assert(held.edges.every(edge => Math.abs(edge.offset) < .01 && edge.opacity > .3), 'Completed solids stay visible until the scene fades');
                assert(held.strokes.every(stroke => Math.abs(stroke.offset) < .01 && stroke.opacity > .3), 'Axes, paper, and statistical drawings remain complete until the scene fades');
                if (name === 'Lớp 11' && await frame.locator('.category-illustration-sine').count()) {
                    await card.screenshot({ path: path.join(output, 'grade11-sine-desktop.png') });
                }
                await finishAndCheckNext(page, card, frame, index, count);
            }
        }

        const mobile = await browser.newContext({ viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
        await routeLocal(mobile);
        const phone = await mobile.newPage();
        phone.on('pageerror', error => errors.push(error.message));
        await phone.goto('https://illustrations.test/index.html#documents');
        await phone.waitForFunction(() => document.querySelectorAll('.ci-cycle-frame.is-active').length === 6);
        for (const [categoryIndex, name] of categoryNames.entries()) {
            const card = phone.locator('.document-category-card').filter({ has: phone.getByRole('heading', { name, exact: true }) });
            await card.scrollIntoViewIfNeeded();
            const state = await card.evaluate(node => ({
                frames: [...node.querySelectorAll('.ci-cycle-frame')].map(frame => ({ opacity: getComputedStyle(frame).opacity, display: getComputedStyle(frame).display })),
                running: node.querySelector('.category-card-illustration').getAnimations({ subtree: true }).some(animation => animation.playState === 'running'),
                curves: [...node.querySelector('.ci-cycle-frame').querySelectorAll('.ci-parabola,.ci-sine-curve,.ci-curve-primary,.ci-curve-secondary')].map(curve => ({ offset: parseFloat(getComputedStyle(curve).strokeDashoffset), opacity: parseFloat(getComputedStyle(curve).opacity) }))
            }));
            assert.equal(state.frames.length, expectedCounts[categoryIndex]);
            assert.equal(state.frames[0].opacity, '1', 'Reduced motion displays the first scene');
            assert(state.frames.slice(1).every(frame => frame.display === 'none' || frame.opacity === '0'));
            assert.equal(state.running, false, 'Reduced motion never runs the scene clock or drawing');
            assert(state.curves.every(curve => Math.abs(curve.offset) < .01 && curve.opacity > .9), 'Reduced motion displays complete curves');
            if (name === 'Lớp 11') await card.screenshot({ path: path.join(output, 'grade11-sine-mobile.png') });
        }
        assert(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The categories fit a 320px screen');
        assert.deepEqual(errors, []);
        console.log('PASS: shared document scene timing, sequential complete loops, sine geometry, preserved solids, delayed area fill, and reduced-motion mobile layout');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

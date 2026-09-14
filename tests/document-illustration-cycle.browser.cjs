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

async function checkSectorGeometry(card) {
    const sector = card.locator('.category-illustration-sector');
    assert.equal(await card.locator('.category-illustration-paper').count(), 1, 'The original exam paper remains in the entrance exam cycle');
    assert.equal(await sector.count(), 1, 'The circle sector is appended to the entrance exam cycle');
    const shape = await sector.evaluate(node => {
        const endpoints = path => {
            const start = path.getPointAtLength(0), end = path.getPointAtLength(path.getTotalLength());
            return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
        };
        const outline = node.querySelector('.ci-circle-outline');
        const fill = node.querySelector('.ci-sector-fill');
        const bounds = fill.getBBox();
        return {
            circle: Array.from({ length: 97 }, (_, i) => {
                const point = outline.getPointAtLength(outline.getTotalLength() * i / 96);
                return { x: point.x, y: point.y };
            }),
            radii: [...node.querySelectorAll('.ci-radius')].map(endpoints),
            fillLength: fill.getTotalLength(),
            fillClosed: /z\s*$/i.test(fill.getAttribute('d')),
            fillBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
            labels: [...node.querySelectorAll('text')].map(text => text.textContent.trim())
        };
    });
    const near = (actual, expected) => Math.abs(actual - expected) < .08;
    assert(shape.circle.every(point => near(Math.hypot(point.x - 116, point.y - 86), 52)), 'Every point on the outline has radius 52 around O');
    assert.equal(shape.radii.length, 2, 'Exactly two radii bound the sector');
    assert(shape.radii.every(radius => near(radius.start.x, 116) && near(radius.start.y, 86)), 'Both radii start at the center');
    assert(shape.radii.every(radius => near(Math.hypot(radius.end.x - 116, radius.end.y - 86), 52)), 'Both radii end on the circle');
    const vectors = shape.radii.map(radius => ({ x: radius.end.x - 116, y: 86 - radius.end.y }));
    const angle = Math.acos((vectors[0].x * vectors[1].x + vectors[0].y * vectors[1].y) / (52 * 52));
    assert(near(angle * 180 / Math.PI, 120), 'The two radii form a 120 degree sector');
    assert(shape.fillClosed && near(shape.fillLength, 104 + 52 * 2 * Math.PI / 3), 'The filled region is bounded by both radii and the minor circular arc');
    assert(near(shape.fillBounds.x, 90) && near(shape.fillBounds.y, 34) && near(shape.fillBounds.width, 78) && near(shape.fillBounds.height, 52), 'The colored sector is the upper 120 degree region');
    assert(['O', 'A', 'B'].every(label => shape.labels.includes(label)), 'The center and radius endpoints are labeled');
}

async function checkVariationGeometry(card) {
    assert.equal(await card.locator('.category-illustration-xyz').count(), 1, 'The Oxyz scene is preserved');
    assert.equal(await card.locator('.category-illustration-cubic-oxy').count(), 1, 'The animated cubic scene is preserved');
    const table = card.locator('.category-illustration-variation');
    assert.equal(await table.count(), 1, 'The variation table is appended to the THPT cycle');
    const drawing = await table.evaluate(node => ({
        labels: [...node.querySelectorAll('text')].map(text => ({ text: text.textContent.replace(/[−–]/g, '-').replace(/\s/g, ''), x: Number(text.getAttribute('x')), y: Number(text.getAttribute('y')) })),
        arrows: [...node.querySelectorAll('.ci-variation-arrow')].map(path => {
            const start = path.getPointAtLength(0), end = path.getPointAtLength(path.getTotalLength());
            return { dx: end.x - start.x, dy: end.y - start.y };
        }),
        bounds: [...node.querySelectorAll('text')].map(text => {
            const box = text.getBBox();
            return { x: box.x, y: box.y, right: box.x + box.width, bottom: box.y + box.height };
        }),
        viewBox: { width: node.viewBox.baseVal.width, height: node.viewBox.baseVal.height }
    }));
    const xLabel = drawing.labels.find(label => label.text === 'x');
    const derivative = drawing.labels.find(label => /^y[′']$/.test(label.text));
    assert(xLabel && derivative, 'The table has x and derivative row labels');
    assert.deepEqual(drawing.labels.filter(label => label.y === xLabel.y && label !== xLabel).sort((a, b) => a.x - b.x).map(label => label.text), ['-∞', '-1', '1', '+∞'], 'Critical points are ordered correctly');
    assert.deepEqual(drawing.labels.filter(label => label.y === derivative.y && label !== derivative).sort((a, b) => a.x - b.x).map(label => label.text), ['+', '0', '-', '0', '+'], 'Derivative signs match 3x² − 3');
    assert(drawing.labels.some(label => label.text === '2') && drawing.labels.some(label => label.text === '-2'), 'The extrema are f(−1)=2 and f(1)=−2');
    assert(drawing.labels.some(label => /y=x(?:³|\^3)-3x/.test(label.text)), 'The table identifies y = x³ − 3x');
    assert.equal(drawing.arrows.length, 3);
    assert(drawing.arrows.every(arrow => arrow.dx > 0), 'The variation arrows progress from left to right');
    assert(drawing.arrows[0].dy < 0 && drawing.arrows[1].dy > 0 && drawing.arrows[2].dy < 0, 'The function increases, decreases, then increases');
    assert(drawing.bounds.every(box => box.x >= -1 && box.y >= -1 && box.right <= drawing.viewBox.width + 1 && box.bottom <= drawing.viewBox.height + 1), 'All table labels fit in the card illustration');
}

async function checkSectorTiming(frame) {
    const state = () => frame.evaluate(node => ({
        reveal: parseFloat(getComputedStyle(node.querySelector('.ci-sector-reveal')).width),
        strokes: [...node.querySelectorAll('.ci-circle-outline,.ci-radius')].map(path => ({ offset: parseFloat(getComputedStyle(path).strokeDashoffset), opacity: parseFloat(getComputedStyle(path).opacity) }))
    }));
    for (const time of [0, 2800, 4800, 5120]) {
        await seek(frame, time);
        assert.equal((await state()).reveal, 0, 'The sector remains unfilled until the circle and both radii finish');
    }
    const outlined = await state();
    assert(outlined.strokes.every(stroke => Math.abs(stroke.offset) < .01 && stroke.opacity > .9), 'The circle and both radii are complete before filling starts');
    await seek(frame, 6000);
    const filling = await state();
    assert(filling.reveal > 0 && filling.reveal < 104, 'The sector fills gradually from left to right');
    await seek(frame, 7200);
    const held = await state();
    assert.equal(held.reveal, 104, 'The full sector is visible before changing scenes');
    assert.deepEqual(held.strokes, outlined.strokes, 'The completed circle and radii remain visible during the fill');
}

async function checkVariationTiming(frame) {
    for (const [time, finishedCount] of [[3220, 1], [4300, 2], [5410, 3]]) {
        await seek(frame, time);
        const arrows = await frame.locator('.ci-variation-arrow').evaluateAll(paths => paths.map(path => ({ offset: parseFloat(getComputedStyle(path).strokeDashoffset), opacity: parseFloat(getComputedStyle(path).opacity) })));
        const heads = await frame.locator('.ci-variation-head').evaluateAll(paths => paths.map(path => parseFloat(getComputedStyle(path).opacity)));
        assert(arrows.slice(0, finishedCount).every(arrow => Math.abs(arrow.offset) < .01 && arrow.opacity > .9), 'Each variation arrow completes before the next is drawn');
        assert(arrows.slice(finishedCount).every(arrow => arrow.opacity === 0), 'Later arrows stay hidden until their turn');
        assert(heads.slice(0, finishedCount).every(opacity => opacity > .9) && heads.slice(finishedCount).every(opacity => opacity === 0), 'Arrowheads appear only with their completed variation arrows');
    }
    await seek(frame, 7200);
    const completed = await frame.locator('.ci-table-grid,.ci-variation-arrow').evaluateAll(paths => paths.every(path => Math.abs(parseFloat(getComputedStyle(path).strokeDashoffset)) < .01 && parseFloat(getComputedStyle(path).opacity) > .7));
    assert(completed, 'The full variation table stays visible before changing scenes');
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
        const expectedCounts = [2, 3, 2, 2, 3, 1];
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
            if (name === 'Ôn thi vào 10') await checkSectorGeometry(card);
            if (name === 'Ôn thi THPT') await checkVariationGeometry(card);

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
                if (await frame.locator('.category-illustration-sector').count()) {
                    await checkSectorTiming(frame);
                    await card.screenshot({ path: path.join(output, 'entrance10-sector-desktop.png') });
                }
                if (await frame.locator('.category-illustration-variation').count()) {
                    await checkVariationTiming(frame);
                    await card.screenshot({ path: path.join(output, 'thpt-variation-desktop.png') });
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

        // Exercise and capture the added scenes on an actual narrow viewport, with motion enabled.
        const motionMobile = await browser.newContext({ viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true });
        await routeLocal(motionMobile);
        const movingPhone = await motionMobile.newPage();
        movingPhone.on('pageerror', error => errors.push(error.message));
        await movingPhone.goto('https://illustrations.test/index.html#documents');
        await movingPhone.waitForFunction(() => document.querySelectorAll('.document-category-card').length === 6);
        for (const [name, selector, filename] of [
            ['Ôn thi vào 10', '.category-illustration-sector', 'entrance10-sector-mobile.png'],
            ['Ôn thi THPT', '.category-illustration-variation', 'thpt-variation-mobile.png']
        ]) {
            const card = movingPhone.locator('.document-category-card').filter({ has: movingPhone.getByRole('heading', { name, exact: true }) });
            await card.scrollIntoViewIfNeeded();
            const frames = card.locator('.ci-cycle-frame');
            const count = await frames.count();
            for (let attempt = 0; attempt < count; attempt += 1) {
                const activeIndex = await frames.evaluateAll(nodes => nodes.findIndex(node => node.classList.contains('is-active')));
                const active = frames.nth(activeIndex);
                if (await active.locator(selector).count()) {
                    await seek(active, 7200);
                    await card.screenshot({ path: path.join(output, filename) });
                    break;
                }
                await finishAndCheckNext(movingPhone, card, active, activeIndex, count);
            }
            assert.equal(await card.locator('.ci-cycle-frame.is-active').locator(selector).count(), 1, `${name} shows the new scene on mobile`);
            if (name === 'Ôn thi vào 10') await checkSectorGeometry(card);
            else await checkVariationGeometry(card);
        }
        assert(await movingPhone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The added exam scenes fit a 320px screen');
        assert.deepEqual(errors, []);
        console.log('PASS: shared document scene timing, complete loops, sine and sector geometry, cubic variation table, preserved scenes, delayed fills, desktop/mobile layout, and reduced motion');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const origin = 'https://navigation.test';
const output = path.resolve(root, '../../test-output/navigation');

// Every page and application asset is served from the checkout. The SDK fixture
// permits reads only; this test cannot submit, delete or change production data.
function mockSdk() {
    const client = {
        auth: {
            async getUser() { return { data: { user: null }, error: null }; },
            onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
        },
        async rpc(name) {
            if (!name.startsWith('get_') && name !== 'current_user_is_admin') throw new Error(`Unexpected write RPC: ${name}`);
            return { data: name === 'current_user_is_admin' ? false : [], error: null };
        },
        from(table) {
            const finish = () => Promise.resolve({ data: table === 'site_configuration' ? { value: {} } : [], error: null });
            const query = new Proxy({}, { get: (_, key) => {
                if (key === 'then') return (resolve, reject) => finish().then(resolve, reject);
                if (key === 'single' || key === 'maybeSingle') return finish;
                if (['insert', 'update', 'upsert', 'delete'].includes(key)) return () => { throw new Error(`Unexpected write to ${table}`); };
                return () => query;
            } });
            return query;
        },
        storage: { from() { return { getPublicUrl() { return { data: { publicUrl: '' } }; } }; } }
    };
    window.supabase = { createClient: () => client };
}

async function settleIndicator(page, selector) {
    await page.waitForFunction(selector => {
        const indicator = document.querySelector('.site-nav-indicator');
        const target = document.querySelector(selector);
        if (!indicator || !target || indicator.dataset.visible !== 'true') return false;
        const a = indicator.getBoundingClientRect(), b = target.getBoundingClientRect();
        return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 2 && Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < 2;
    }, selector);
}

async function desktopLayout(page, width) {
    await page.setViewportSize({ width, height: 960 });
    assert(!(await page.locator('#menuToggle').isVisible()), `Desktop menu button hidden at ${width}px`);
    const layout = await page.evaluate(() => {
        const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        return {
            viewport: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            header: box(document.querySelector('#siteHeader')),
            logo: box(document.querySelector('#siteHeader .logo')),
            links: [...document.querySelectorAll('#mainMenu .nav-link')].filter(node => node.getClientRects().length).map(box)
        };
    });
    assert(layout.documentWidth <= layout.viewport + 1, `No horizontal document overflow at ${width}px`);
    assert(layout.links.length >= 9, 'All configured navigation links remain available');
    for (let i = 0; i < layout.links.length; i++) {
        const link = layout.links[i];
        assert(link.left >= layout.header.left && link.right <= layout.header.right + 1, `Link ${i} stays inside header at ${width}px`);
        assert(link.top >= layout.header.top && link.bottom <= layout.header.bottom + 1, `Link ${i} stays vertically inside header`);
        assert(link.left >= (i ? layout.links[i - 1].right : layout.logo.right) - 1, `Links and logo do not overlap at ${width}px`);
    }
}

async function closedMenu(page) {
    await page.waitForFunction(() => document.querySelector('#menuToggle').getAttribute('aria-expanded') === 'false');
    assert(!(await page.locator('#mainMenu').isVisible()), 'Closed menu is hidden from interaction');
    assert.equal(await page.locator('#menuToggle').getAttribute('aria-label'), 'Mở menu');
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
        await context.route('**/*', route => {
            const request = route.request(), url = new URL(request.url());
            assert.equal(request.method(), 'GET', 'The browser only makes read requests');
            if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
            if (url.origin !== origin) return route.abort();
            const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
            const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
            return route.fulfill({ body: fs.readFileSync(file), contentType: types[path.extname(file)] || 'application/octet-stream' });
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        for (const [label, pathname] of [['home', '/index.html'], ['achievements', '/achievements.html?type=grade12']]) {
            await page.goto(origin + pathname);
            await page.waitForFunction(() => window.SiteContent && document.querySelector('.site-nav-indicator'));
            await page.evaluate(() => document.fonts.ready);
            assert.equal(await page.locator('#siteHeader nav').getAttribute('aria-label'), 'Điều hướng chính');
            assert.equal(await page.locator('#menuToggle').getAttribute('aria-controls'), 'mainMenu');
            assert.equal(await page.locator('.site-nav-indicator').getAttribute('aria-hidden'), 'true');
            for (const width of [1440, 1280]) await desktopLayout(page, width);

            await page.setViewportSize({ width: 1440, height: 960 });
            const skills = '#mainMenu a[href$="#skills"]';
            await page.locator(skills).hover();
            await settleIndicator(page, skills);
            await page.screenshot({ path: path.join(output, `${label}-desktop-hover.png`), fullPage: false });
            await page.locator('#mainMenu a[href$="#projects"]').focus();
            await page.mouse.move(20, 250);
            await settleIndicator(page, '#mainMenu a[href$="#projects"]');

            // Apply the public CMS behavior while a previously visible item is active.
            await page.locator(skills).hover();
            await settleIndicator(page, skills);
            await page.evaluate(() => {
                const link = document.querySelector('#mainMenu a[href$="#skills"]');
                document.querySelectorAll('#mainMenu .active').forEach(node => node.classList.remove('active'));
                link.classList.add('active');
                window.SiteContent.apply(document, window.SiteContent.schema(document), { 'skills.visible': false });
            });
            assert(!(await page.locator(skills).isVisible()), 'CMS removes a hidden section from navigation');
            await page.waitForFunction(() => {
                const indicator = document.querySelector('.site-nav-indicator');
                if (indicator.dataset.visible !== 'true') return true;
                const a = indicator.getBoundingClientRect();
                return [...document.querySelectorAll('#mainMenu .nav-link')].filter(node => node.getClientRects().length).some(node => {
                    const b = node.getBoundingClientRect();
                    return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 2;
                });
            });
            await page.evaluate(() => window.SiteContent.apply(document, window.SiteContent.schema(document), { 'skills.visible': true }));

            for (const width of [1024, 800, 390]) {
                await page.setViewportSize({ width, height: 844 });
                assert(await page.locator('#menuToggle').isVisible(), `Menu control available at ${width}px`);
                await closedMenu(page);
                await page.locator('#menuToggle').click();
                assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'), 'true');
                assert.equal(await page.locator('#menuToggle').getAttribute('aria-label'), 'Đóng menu');
                assert(await page.locator('#mainMenu').isVisible());
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Open mobile menu fits ${width}px`);
                if (width === 390) {
                    await page.locator('#mainMenu').evaluate(async menu => {
                        await Promise.all(menu.getAnimations().map(animation => animation.finished));
                    });
                    await page.screenshot({ path: path.join(output, `${label}-mobile-open.png`), fullPage: false });
                }
                await page.keyboard.press('Escape');
                await closedMenu(page);
                assert(await page.locator('#menuToggle').evaluate(node => node === document.activeElement), 'Escape restores keyboard focus');
                await page.locator('#menuToggle').click();
                await page.mouse.click(5, 830);
                await closedMenu(page);
                await page.locator('#menuToggle').click();
                await page.locator('#mainMenu a[href$="#about"]').click();
                await page.waitForFunction(() => location.hash === '#about');
                await closedMenu(page);
                if (label === 'achievements') {
                    await page.goto(origin + pathname);
                    await page.waitForFunction(() => document.querySelector('.site-nav-indicator'));
                }
            }

            await page.setViewportSize({ width: 390, height: 420 });
            await page.locator('#menuToggle').click();
            const menu = await page.locator('#mainMenu').evaluate(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, viewport: innerHeight, scrollHeight: node.scrollHeight, height: node.clientHeight, overflow: getComputedStyle(node).overflowY }));
            assert(menu.top >= 0 && menu.bottom <= menu.viewport + 1, 'Short-screen menu remains inside viewport');
            assert(menu.scrollHeight > menu.height && ['auto', 'scroll'].includes(menu.overflow), 'Long mobile menu scrolls on a short screen');
            await page.locator('#mainMenu a[href="admin.html"]').scrollIntoViewIfNeeded();
            assert(await page.locator('#mainMenu a[href="admin.html"]').isVisible(), 'Last menu link is reachable');
            await page.keyboard.press('Escape');
            await page.setViewportSize({ width: 1440, height: 960 });
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.locator('#mainMenu a[href$="#about"]').hover();
            await settleIndicator(page, '#mainMenu a[href$="#about"]');
            assert(await page.locator('.site-nav-indicator').evaluate(node => getComputedStyle(node).transitionDuration.split(',').every(value => parseFloat(value) === 0)), 'Reduced motion disables indicator transitions');
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            console.log(`PASS ${label}: desktop fit, moving highlight, CMS visibility, mobile dismissal/accessibility, short screen and reduced motion`);
        }
        assert.deepEqual(errors, []);
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

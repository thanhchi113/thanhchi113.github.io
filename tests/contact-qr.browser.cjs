const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const origin = 'https://contact.test';
const output = path.resolve(root, '../../test-output/contact');
const qrLibraryUrl = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
const decoderUrl = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

// The SDK only returns empty read fixtures. Neither the test nor its browser can
// create submissions, navigate social links, or mutate any production data.
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

async function vendor(url) {
    const response = await fetch(url);
    assert(response.ok, `Pinned vendor build loads: ${url} (${response.status})`);
    return response.text();
}

async function installRoutes(context, qrLibrary, transport = {}) {
    await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        assert.equal(request.method(), 'GET', 'The browser only makes read requests');
        if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) {
            return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
        }
        if (url.href === qrLibraryUrl) {
            transport.qrRequests = (transport.qrRequests || 0) + 1;
            if (transport.failNextQr) { transport.failNextQr = false; return route.abort(); }
            return route.fulfill({ contentType: 'application/javascript', body: qrLibrary });
        }
        if (url.origin !== origin) return route.abort();
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
        const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
        return route.fulfill({ body: fs.readFileSync(file), contentType: types[path.extname(file)] || 'application/octet-stream' });
    });
}

async function preparePage(context, decoder) {
    const page = await context.newPage();
    await page.goto(origin + '/index.html#contact');
    await page.waitForFunction(() => window.SiteContent && document.querySelector('#contactQrDialog'));
    await page.addScriptTag({ content: decoder });
    await page.locator('[data-contact-qr="facebook"]').scrollIntoViewIfNeeded();
    return page;
}

async function openQr(page, network, expectedUrl) {
    const opener = page.locator(`[data-contact-qr="${network}"]`);
    await opener.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => ({ x: scrollX, y: scrollY, bodyOverflow: document.body.style.overflow, htmlOverflow: document.documentElement.style.overflow }));
    await opener.click();
    await page.waitForFunction(() => document.querySelector('#contactQrDialog')?.open && document.querySelector('#contactQrCode canvas')?.width > 0);
    assert(await page.locator('#contactQrDialog').isVisible(), 'The contact QR dialog is visible');
    assert.equal(await page.locator('#contactQrLink').getAttribute('href'), expectedUrl, 'The direct fallback opens the same profile as the QR');
    assert.equal(await page.locator('#contactQrLink').getAttribute('target'), '_blank');
    assert(await page.locator('#contactQrLink').getAttribute('rel').then(value => value.includes('noopener')));
    const decoded = await page.locator('#contactQrCode canvas').evaluate(canvas => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        return window.jsQR(pixels.data, pixels.width, pixels.height)?.data || null;
    });
    assert.equal(decoded, expectedUrl, 'A real independent decoder reads the intended profile from the generated pixels');
    return { network, before };
}

async function closeQr(page, session, method = 'escape') {
    if (method === 'escape') await page.keyboard.press('Escape');
    else if (method === 'button') await page.locator('#contactQrClose').click();
    else {
        const bounds = await page.locator('#contactQrDialog').boundingBox();
        assert(bounds && bounds.y > 1, 'The backdrop has a reachable point');
        await page.mouse.click(1, 1);
    }
    await page.waitForFunction(() => !document.querySelector('#contactQrDialog').open);
    const after = await page.evaluate(() => ({ x: scrollX, y: scrollY, bodyOverflow: document.body.style.overflow, htmlOverflow: document.documentElement.style.overflow }));
    assert.equal(after.bodyOverflow, session.before.bodyOverflow, 'Closing restores body scrolling');
    assert.equal(after.htmlOverflow, session.before.htmlOverflow, 'Closing restores document scrolling');
    assert(Math.abs(after.y - session.before.y) <= 2 && Math.abs(after.x - session.before.x) <= 2, 'Closing preserves the contact section scroll position');
    assert(await page.locator(`[data-contact-qr="${session.network}"]`).evaluate(node => node === document.activeElement), `${method} restores focus to the QR button`);
}

async function assertFits(page, width) {
    const layout = await page.evaluate(() => {
        const dialog = document.querySelector('#contactQrDialog');
        const nodes = [dialog, ...dialog.querySelectorAll('canvas, a, button')].filter(node => node.getClientRects().length);
        return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
            boxes: nodes.map(node => { const box = node.getBoundingClientRect(); return { name: node.id || node.tagName, left: box.left, top: box.top, right: box.right, bottom: box.bottom }; }) };
    });
    assert(layout.documentWidth <= width + 1, `The page fits a ${width}px viewport`);
    for (const box of layout.boxes) {
        assert(box.left >= -1 && box.right <= layout.viewport.width + 1, `${box.name} fits horizontally at ${width}px`);
        assert(box.top >= -1 && box.bottom <= layout.viewport.height + 1, `${box.name} fits vertically at ${width}px`);
    }
}

(async () => {
    const [qrLibrary, decoder] = await Promise.all([vendor(qrLibraryUrl), vendor(decoderUrl)]);
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce', acceptDownloads: true });
        const transport = {};
        await installRoutes(context, qrLibrary, transport);
        const errors = [];
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        const page = await preparePage(context, decoder);
        const defaults = ['mailto:chithanhhuynh11@gmail.com', 'tel:0905957716', 'https://www.facebook.com/mendz1103', 'https://github.com/thanhchi113', 'https://zalo.me/0905957716'];
        assert.deepEqual(await page.locator('.contact-list .contact-item').evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), defaults, 'The four existing CMS contact slots retain their identity and Zalo is appended');
        assert.equal(await page.locator('#contactZalo').textContent().then(value => value.replace(/\D/g, '')), '0905957716', 'Zalo shows the existing phone number');
        assert.equal(await page.locator('#contactQrDialog').evaluate(node => node.parentElement === document.body && node.tagName === 'DIALOG'), true, 'The contact dialog is independent from hideable content sections');
        const schema = await page.evaluate(() => SiteContent.schema(document).filter(field => /^contact\.item\d\.url$/.test(field.key)).map(field => ({ key: field.key, value: field.defaultValue })));
        assert.deepEqual(schema, defaults.map((value, i) => ({ key: `contact.item${i + 1}.url`, value })), 'CMS mappings still address email, phone, Facebook, GitHub and then Zalo');
        await page.screenshot({ path: path.join(output, 'contact-desktop.png'), fullPage: false });

        let session = await openQr(page, 'facebook', defaults[2]);
        assert.match(await page.locator('#contactQrTitle').innerText(), /Facebook/i);
        await assertFits(page, 1440);
        await page.screenshot({ path: path.join(output, 'facebook-qr-desktop.png'), fullPage: false });
        await closeQr(page, session);
        session = await openQr(page, 'zalo', defaults[4]);
        assert.match(await page.locator('#contactQrTitle').innerText(), /Zalo/i);
        const downloadEvent = page.waitForEvent('download');
        await page.locator('#contactQrDownload').click();
        const download = await downloadEvent;
        assert.match(download.suggestedFilename(), /\.png$/i, 'QR downloads as a PNG');
        const stream = await download.createReadStream(), chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const png = Buffer.concat(chunks);
        assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'The download contains a real PNG');
        const downloaded = await page.evaluate(async source => {
            const image = new Image();
            image.src = source;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            let left = canvas.width, top = canvas.height, right = 0, bottom = 0;
            for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
                const offset = (y * canvas.width + x) * 4;
                if (pixels.data[offset + 3] > 200 && pixels.data[offset] < 128 && pixels.data[offset + 1] < 128 && pixels.data[offset + 2] < 128) {
                    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
                }
            }
            return { decoded: window.jsQR(pixels.data, pixels.width, pixels.height)?.data, margins: [left, top, canvas.width - right - 1, canvas.height - bottom - 1] };
        }, `data:image/png;base64,${png.toString('base64')}`);
        assert.equal(downloaded.decoded, defaults[4], 'The exported PNG decodes to Zalo');
        assert(downloaded.margins.every(value => value >= 12), 'The exported PNG retains a clear quiet margin on all four edges');
        await closeQr(page, session, 'backdrop');
        assert.equal(transport.qrRequests, 1, 'The real encoder loads once and is reused across contact QR codes');

        // Existing administrators may have edited contacts or hidden Documents.
        // QR links must follow those live hrefs, not a duplicate hardcoded URL.
        const changedFacebook = 'https://www.facebook.com/contact-profile-test';
        const changedZalo = 'https://zalo.me/0912345678';
        await page.evaluate(values => SiteContent.apply(document, SiteContent.schema(document), values), {
            'documents.visible': false, 'contact.item3.url': changedFacebook, 'contact.item5.url': changedZalo
        });
        assert(!(await page.locator('#documents').isVisible()), 'Documents is genuinely hidden by the public CMS');
        assert.equal(await page.locator('#contactFacebook').getAttribute('href'), changedFacebook);
        assert.equal(await page.locator('#contactZalo').getAttribute('href'), changedZalo);
        session = await openQr(page, 'facebook', changedFacebook);
        await closeQr(page, session, 'button');
        session = await openQr(page, 'zalo', changedZalo);
        await closeQr(page, session);

        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            await page.locator('[data-contact-qr="zalo"]').scrollIntoViewIfNeeded();
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `The contact section does not overflow at ${width}px`);
            await page.screenshot({ path: path.join(output, `contact-mobile-${width}.png`), fullPage: false });
            session = await openQr(page, 'zalo', changedZalo);
            await assertFits(page, width);
            await page.screenshot({ path: path.join(output, `zalo-qr-mobile-${width}.png`), fullPage: false });
            await closeQr(page, session);
        }
        assert.deepEqual(errors, [], 'Contact interactions do not raise uncaught browser errors');
        await context.close();

        const retryContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
        const retryTransport = { failNextQr: true };
        await installRoutes(retryContext, qrLibrary, retryTransport);
        const retryPage = await preparePage(retryContext, decoder);
        await retryPage.locator('[data-contact-qr="facebook"]').click();
        await retryPage.locator('#contactQrRetry').waitFor({ state: 'visible' });
        assert.equal(await retryPage.locator('#contactQrLink').getAttribute('href'), defaults[2], 'A direct contact link remains usable while QR loading fails');
        await retryPage.locator('#contactQrRetry').click();
        await retryPage.waitForFunction(() => document.querySelector('#contactQrCode canvas')?.width > 0);
        const retried = await retryPage.locator('#contactQrCode canvas').evaluate(canvas => {
            const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
            return window.jsQR(pixels.data, pixels.width, pixels.height)?.data;
        });
        assert.equal(retried, defaults[2], 'Retry regenerates the intended QR using the real encoder');
        assert.equal(retryTransport.qrRequests, 2, 'Retry makes a new CDN request after failure');
        await retryContext.close();
        console.log('PASS contact: real QR pixel decoding, Zalo phone link, CMS contact preservation, profile updates, hidden Documents, PNG quiet margin, modal dismissal/focus/scroll, mobile fit and failed-load retry');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

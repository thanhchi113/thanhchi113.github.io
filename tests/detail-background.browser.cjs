const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://detail-background.test';
const output = path.resolve(root, '../..');

// Only data/PDF delivery is mocked. Real page scripts, Canvas rendering,
// navigation, CSS and image-to-Canvas drawing run against the local files.
function mockSdk() {
    const categories = [{ id: 1, name: 'Lớp 12', slug: 'lop-12', parent_id: null, sort_order: 0 }];
    const documents = [101, 102].map(id => ({ id, title: id === 101 ? 'Đạo hàm và đồ thị hàm số' : 'Bài tập ôn luyện', description: 'Tài liệu minh họa dùng trong kiểm thử giao diện.', category_id: 1, published: true, file_path: `document-${id}.pdf`, file_name: 'bai-tap.pdf', document_type: 'lesson', tags: ['Toán 12'], created_at: '2026-09-13', math_categories: { name: 'Lớp 12' } }));
    const drawings = [{ id: 'curve', title: 'Đồ thị hàm số bậc ba', description: 'Hình vẽ minh họa cho bài tập khảo sát hàm số.', preview_path: 'drawing.svg', published: true, code_unlocked: false, code: '\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}', created_at: '2026-09-13' }];
    const evidence = [{ id: 'evidence', title: 'Kết quả học tập', student_name: 'Học sinh minh họa', course_name: 'Lớp 12', result_summary: '8,5 điểm', image_path: 'evidence.svg' }];
    const scores = [{ id: 'score', student_name: 'Học sinh minh họa', hide_student_name: false, score: 8.5, period: 'gk1', grade: 12, class_name: '12A1', school_year: '2026-2027', evidence_image_path: 'scores/evidence.svg', published: true, created_at: '2026-09-13' }];
    const client = {
        auth: { async getUser() { return { data: { user: null }, error: null }; }, onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } },
        async rpc(name) { return { data: name === 'get_published_exam_scores' ? scores : name === 'increment_document_view' ? 1 : false, error: null }; },
        from(table) {
            let single = false;
            const finish = () => {
                let data = table === 'math_categories' ? categories : table === 'math_documents' ? documents : table === 'tikz_drawings' ? drawings : table === 'achievement_evidence' ? evidence : table === 'site_configuration' ? null : table === 'exam_score_settings' ? { id: 1, statistics_enabled: false, enabled_periods: ['gk1', 'ck1', 'gk2', 'ck2'] } : [];
                if (single && Array.isArray(data)) data = data[0] || null;
                return Promise.resolve({ data, error: null });
            };
            const query = new Proxy({}, { get: (_, key) => {
                if (key === 'then') return (resolve, reject) => finish().then(resolve, reject);
                if (key === 'maybeSingle' || key === 'single') return () => { single = true; return finish(); };
                return () => query;
            } });
            return query;
        },
        storage: { from() { return {
            getPublicUrl(file) { return { data: { publicUrl: `${location.origin}/fixture/${file}` } }; },
            async createSignedUrl(file) { return { data: { signedUrl: `${location.origin}/fixture/${file}?token=mock-test` }, error: null }; }
        }; } }
    };
    window.supabase = { createClient: () => client };
}

function mockPdf() {
    const viewport = scale => ({ width: 520 * scale, height: 700 * scale, scale, clone(options) { return viewport(options.scale); } });
    window.pdfjsLib = {
        GlobalWorkerOptions: {},
        getDocument() { return { promise: Promise.resolve({
            numPages: 2,
            async getPage(number) { return {
                getViewport({ scale }) { return viewport(scale); },
                render({ canvasContext: ctx }) {
                    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                    ctx.fillStyle = '#23354d'; ctx.font = 'bold 28px Arial'; ctx.fillText('BÀI TẬP TOÁN 12', 35, 65);
                    ctx.font = '20px Arial'; ctx.fillText(`Trang ${number} - Khảo sát hàm số`, 35, 106);
                    ctx.strokeStyle = '#25354b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(50, 360); ctx.lineTo(420, 360); ctx.moveTo(250, 160); ctx.lineTo(250, 510); ctx.stroke();
                    ctx.strokeStyle = '#4b52a9'; ctx.beginPath(); ctx.moveTo(80, 490); ctx.bezierCurveTo(180, 70, 300, 620, 400, 210); ctx.stroke();
                    return { promise: Promise.resolve(), cancel() {} };
                }
            }; },
            async destroy() {}
        }) }; }
    };
}

const fixtureImage = '<svg xmlns="http://www.w3.org/2000/svg" width="560" height="360" viewBox="0 0 560 360"><rect width="560" height="360" fill="white"/><text x="30" y="46" font-family="Arial" font-size="22" fill="#1e293b">Kết quả học tập · Toán 12</text><path d="M65 220H500M290 75V325" stroke="#334155" stroke-width="2"/><path d="M90 310C215 -80 305 460 465 100" fill="none" stroke="#6754b6" stroke-width="4"/><text x="395" y="310" fill="#334155" font-size="25">8,5 / 10</text></svg>';

async function installIsolation(context) {
    await context.addInitScript(mockPdf);
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.host === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
        // No real production reads or writes, including view counters or storage.
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith('/fixture/')) return route.fulfill({ contentType: 'image/svg+xml', body: fixtureImage });
        const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };
        return route.fulfill({ contentType: types[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
    });
}

async function sky(page) {
    await page.waitForFunction(() => document.querySelector('canvas[data-galaxy-background-initialized]')?.dataset.galaxyTextureReady === 'true' && document.querySelector('[data-galaxy-clouds]')?.dataset.textureReady === 'true');
    assert.equal(await page.locator('canvas[data-galaxy-background-initialized]').count(), 1, 'One galaxy renderer per page');
    assert.equal(await page.locator('[data-galaxy-clouds]').count(), 1, 'One cloud layer per page');
    const result = await page.evaluate(() => {
        const canvas = document.querySelector('canvas[data-galaxy-background-initialized]');
        const scene = canvas.parentElement, shade = scene.querySelector('.milky-way-shade');
        const sceneStyle = getComputedStyle(scene), canvasStyle = getComputedStyle(canvas), shadeStyle = getComputedStyle(shade), rect = scene.getBoundingClientRect();
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let min = 255, max = 0, painted = 0;
        for (let index = 0; index < data.length; index += 400) { const light = Math.max(...data.subarray(index, index + 3)); min = Math.min(min, light); max = Math.max(max, light); if (light > 35) painted++; }
        return { style: { position: sceneStyle.position, background: sceneStyle.background, sceneOpacity: sceneStyle.opacity, opacity: canvasStyle.opacity, filter: sceneStyle.filter, canvasFilter: canvasStyle.filter, shade: shadeStyle.background, shadeOpacity: shadeStyle.opacity, shadeFilter: shadeStyle.filter }, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, viewport: { width: innerWidth, height: innerHeight }, min, max, painted };
    });
    assert.equal(result.style.position, 'fixed');
    assert.equal(result.style.opacity, '1', 'Evidence canvas must not fade compared with the homepage');
    assert.equal(result.style.sceneOpacity, '1');
    assert.equal(result.style.filter, 'none');
    assert.equal(result.rect.x, 0); assert.equal(result.rect.y, 0);
    assert(Math.abs(result.rect.width - result.viewport.width) <= 16, 'Galaxy spans viewport width including browser scrollbar allowance');
    assert.equal(result.rect.height, result.viewport.height);
    assert(result.max - result.min > 35 && result.painted > 50, 'Real Canvas contains visible stars and clouds, not only a flat background');
    return result.style;
}

async function styles(page, selector) {
    return page.locator(selector).first().evaluate(node => { const s = getComputedStyle(node); return { background: s.backgroundColor, image: s.backgroundImage, backdrop: s.backdropFilter }; });
}

async function transparent(page, selectors) {
    for (const selector of selectors) {
        const actual = await styles(page, selector);
        assert.equal(actual.background, 'rgba(0, 0, 0, 0)', `${selector} must reveal the galaxy`);
        assert.equal(actual.image, 'none', `${selector} must not add a second backdrop`);
    }
}

async function screenshot(page, name) {
    const file = path.join(output, `detail-background-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`SCREENSHOT ${file}`);
}

(async () => {
    const browser = await chromium.launch({ channel: process.env.TEST_BROWSER_CHANNEL || 'msedge', headless: true });
    try {
        for (const mobile of [false, true]) {
            const size = mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 };
            const context = await browser.newContext({ viewport: size, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
            await installIsolation(context);
            const page = await context.newPage(), errors = [], label = mobile ? 'mobile' : 'desktop';
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`${origin}/index.html#contact`);
            const homepageSky = await sky(page);
            await page.locator('#contact').scrollIntoViewIfNeeded();
            await screenshot(page, `home-${label}`);
            await page.evaluate(() => navigateFromMainTaskbar('#documents', true));
            await page.locator('[data-category-id="1"]').click();
            await page.locator('[data-document-id="101"]').waitFor();
            assert.deepEqual(await sky(page), homepageSky, 'Opening a document category preserves the same sky');
            await transparent(page, ['#documents']);
            await screenshot(page, `category-${label}`);

            await page.locator('[data-document-id="101"]').click();
            await page.waitForFunction(() => document.querySelector('[data-pdf-page-wrap="1"]')?.dataset.rendered === '1');
            await page.locator('#pdfModal').scrollIntoViewIfNeeded();
            assert.deepEqual(await sky(page), homepageSky, 'Opening PDF content preserves the same sky');
            await transparent(page, ['#documents .pdf-modal', '#documents .pdf-modal-body-scroll', '#documents .pdf-viewer-scroll']);
            assert.equal((await styles(page, '#pdfModal')).backdrop, 'none', 'No full viewer blur hiding the galaxy');
            assert.equal((await styles(page, '.pdf-page-canvas')).background, 'rgb(255, 255, 255)', 'PDF paper stays white');
            const paper = await page.locator('.pdf-page-canvas').first().evaluate(canvas => [...canvas.getContext('2d').getImageData(4, 4, 1, 1).data]);
            assert.deepEqual(paper, [255, 255, 255, 255]);
            await screenshot(page, `pdf-${label}`);
            await page.locator('#pdfClose').click();
            assert.equal(await page.locator('#documents').evaluate(node => node.classList.contains('document-viewer-mode')), false);
            await page.locator('[data-document-id="101"]').waitFor();

            await page.evaluate(() => openTikzLibrary());
            await page.locator('[data-tikz-card-open="curve"]').click();
            await page.locator('#tikzRenderBox .tikz-fit-canvas').waitFor();
            assert.deepEqual(await sky(page), homepageSky, 'TikZ detail uses the same viewport and shade');
            await transparent(page, ['#tikz-library', '#tikzRenderBox']);
            assert.notEqual((await styles(page, '#tikzCodeBlock')).background, 'rgb(6, 11, 20)', 'Protected code panel reveals the sky');
            assert.equal((await styles(page, '#tikzRenderBox canvas')).background, 'rgb(255, 255, 255)', 'Actual TikZ paper stays white');
            await screenshot(page, `tikz-${label}`);
            await page.evaluate(async () => { tikzDrawings[0].code_unlocked = true; await openTikzDetail('curve'); });
            assert.equal(await page.locator('#tikzCodeBlock').getAttribute('class'), 'tikz-code-block');
            assert.notEqual((await styles(page, '#tikzCodeBlock')).background, 'rgb(6, 11, 20)', 'Unlocked code panel also reveals the sky');
            await page.locator('#tikzDetailBack').click();
            await page.locator('[data-tikz-card-open="curve"]').waitFor();
            assert.equal(await page.locator('#tikzDetail').evaluate(node => node.hidden), true);

            await page.goto(`${origin}/achievements.html?type=feedback`);
            assert.deepEqual(await sky(page), homepageSky, 'Achievements have exactly the homepage shade, opacity and filtering');
            await page.locator('.evidence-card').waitFor();
            await screenshot(page, `evidence-${label}`);
            await page.locator('.evidence-zoom').click();
            await page.locator('#evidenceModal.open').waitFor();
            assert.equal(await page.evaluate(() => document.activeElement.id), 'evidenceModalClose');
            assert(await page.locator('.evidence-page').evaluate(node => node.inert));
            assert(await page.locator('#siteHeader').evaluate(node => node.inert));
            assert.equal((await styles(page, '#evidenceModal')).backdrop, 'none');
            assert.equal((await styles(page, '#evidenceModal')).background, 'rgba(0, 0, 0, 0)', 'Image zoom preserves the galaxy without any extra tint');
            assert.equal(await page.locator('.evidence-page').evaluate(node => getComputedStyle(node).visibility), 'hidden', 'Cards do not overlap the sky behind the zoomed image');
            assert.equal(await page.locator('.evidence-page').evaluate(node => getComputedStyle(node).opacity), '0', 'Child visibility transitions cannot flash above the galaxy');
            assert.deepEqual(await sky(page), homepageSky);
            await screenshot(page, `zoom-${label}`);
            await page.locator('#evidenceModalClose').click();
            assert.equal(await page.locator('#evidenceModal').getAttribute('aria-hidden'), 'true');
            assert.equal(await page.locator('.evidence-page').evaluate(node => getComputedStyle(node).visibility), 'visible', 'Closing image restores the evidence list');
            assert.equal(await page.locator('.evidence-page').evaluate(node => getComputedStyle(node).opacity), '1');
            assert(await page.evaluate(() => document.activeElement.matches('.evidence-zoom')), 'Closing evidence zoom returns focus to the trigger');
            assert.equal(await page.locator('#siteHeader').evaluate(node => node.inert), false);
            await page.locator('[data-type="scores"]').click();
            await page.locator('.exam-student-card').waitFor();
            assert.deepEqual(await sky(page), homepageSky, 'Score group preserves the common sky');
            await page.locator('.exam-student-card').scrollIntoViewIfNeeded();
            await page.waitForFunction(() => document.querySelector('.exam-student-image-link img')?.naturalWidth > 0);
            await screenshot(page, `scores-${label}`);
            const scoreUrl = page.url(), tabCount = context.pages().length;
            await page.locator('.exam-student-image-link').click();
            await page.locator('#evidenceModal.open').waitFor();
            assert.equal(page.url(), scoreUrl, 'Score image opens on the score page');
            assert.equal(context.pages().length, tabCount, 'Score image does not open a raw new tab');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'evidenceModalClose');
            assert.equal(await page.locator('body').evaluate(node => node.style.overflow), 'hidden');
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'evidenceModalClose');
            await page.keyboard.press('Shift+Tab');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'evidenceModalClose');
            assert.deepEqual(await sky(page), homepageSky, 'Score image zoom shares the unchanged sky');
            await screenshot(page, `score-zoom-${label}`);
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#evidenceModal').getAttribute('aria-hidden'), 'true');
            assert(await page.evaluate(() => document.activeElement.matches('.exam-student-image-link')), 'Escape returns focus to score image');
            assert.equal(await page.locator('body').evaluate(node => node.style.overflow), '');
            assert.equal(await page.locator('.evidence-page').evaluate(node => node.inert), false);
            await page.locator('.evidence-back-link').click();
            await page.waitForURL('**/index.html#achievements');
            assert.deepEqual(await sky(page), homepageSky);
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow after returning');
            assert.deepEqual(errors, [], 'Page scripts must keep working through all detail views');
            await context.close();
            console.log(`PASS ${label}: category, PDF, TikZ, evidence zoom, score group and return navigation share the real galaxy; paper preserved`);
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

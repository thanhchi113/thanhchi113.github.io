const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.abort());
        await page.setContent('<style>*{box-sizing:border-box}body{margin:16px;background:#081020;color:white;font:14px Arial}button{padding:8px}select,input{max-width:100%}</style><main id="adminPanel"><input id="scoreStudentName" value="Đang nhập"><select id="scorePeriod"><option value="gk1">GK1</option></select><select id="scoreGrade"><option value="12">12</option></select><select id="scoreAdminPeriod"><option value="all">Tất cả</option></select><input id="scoreClass"><input id="scoreYear"><div id="scoreOptionsAdmin"></div></main>');
        await page.addStyleTag({ path: path.resolve(__dirname, '../assets/exam-score-options.css') });
        for (const file of ['exam-scores.js', 'exam-score-options.js']) await page.addScriptTag({ path: path.resolve(__dirname, '../assets', file) });
        await page.evaluate(() => {
            window.mock = { value: {}, version: 'v1', events: [], failRead: false, failWrite: false, hold: false };
            const client = { from(table) {
                if (table !== 'site_configuration') throw new Error('Unexpected table');
                let payload, version;
                const query = { select() { return query; }, eq(key, value) { if (key === 'id' && value !== 'score_options') throw new Error('Wrong config ID'); if (key === 'updated_at') version = value; return query; }, update(value) { payload = value; return query; }, async maybeSingle() {
                    if (mock.hold) await new Promise(resolve => { mock.release = resolve; });
                    if (!payload) { if (mock.failRead) throw new Error('Offline'); return { data: { value: structuredClone(mock.value), updated_at: mock.version } }; }
                    mock.events.push(payload);
                    if (mock.failWrite) return { error: { code: '42501' } };
                    if (version !== mock.version) return { data: null };
                    mock.value = structuredClone(payload.value); mock.version += 'x';
                    return { data: { value: structuredClone(mock.value), updated_at: mock.version } };
                } }; return query;
            } };
            window.catalog = ExamScoreOptions.init(client);
        });
        await page.evaluate(() => catalog.load());
        await page.locator('[name="classes"]').fill('9A1\n9A2');
        await page.locator('[name="years"]').fill('2027-2029');
        await page.locator('[type="submit"]').click();
        assert((await page.locator('[data-options-status]').textContent()).includes('hai năm liên tiếp'));
        assert.equal(await page.evaluate(() => mock.events.length), 0);
        await page.locator('[name="years"]').fill('2027-2028');
        await page.locator('[name="grades"][value="9"]').check();
        await page.locator('#scoreOptionsNewPeriod').fill('Thi thử lần 1');
        await page.locator('[data-options-add]').click();
        assert.equal(await page.locator('#scorePeriod option').count(), 4);
        await page.locator('[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-options-status]').textContent.startsWith('Đã lưu'));
        const key = await page.evaluate(() => mock.value.periods.find(period => period.label === 'Thi thử lần 1').key);
        await page.locator('#scorePeriod').selectOption(key);
        await page.locator('#scoreGrade').selectOption('9');
        assert.equal(await page.locator('#scoreStudentName').inputValue(), 'Đang nhập');
        assert.deepEqual(await page.locator('#scoreClassSuggestions option').evaluateAll(options => options.map(option => option.value)), ['9A1', '9A2']);
        await page.locator(`[data-options-period="${key}"]`).fill('Thi thử <img src=x onerror=alert(1)>');
        await page.locator('[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-options-status]').textContent.startsWith('Đã lưu'));
        assert.equal(await page.locator('#scorePeriod').inputValue(), key);
        assert.equal(await page.locator('#scoreOptionsAdmin img').count(), 0);
        await page.evaluate(() => { mock.version = 'another-session'; });
        await page.locator('[name="classes"]').fill('Giữ bản sửa');
        await page.evaluate(() => catalog.load());
        assert.equal(await page.locator('[name="classes"]').inputValue(), 'Giữ bản sửa');
        await page.locator('[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-options-status]').textContent.includes('phiên khác'));
        assert.equal(await page.locator('[name="classes"]').inputValue(), 'Giữ bản sửa');
        assert(!await page.locator('[type="submit"]').isDisabled());
        await page.evaluate(() => { mock.failRead = true; });
        await page.evaluate(() => catalog.load(true));
        assert(await page.locator('[type="submit"]').isDisabled());
        assert(!await page.locator('[data-options-refresh]').isDisabled());
        assert(!await page.locator('#scoreStudentName').isDisabled());
        await page.evaluate(async () => { mock.failRead = false; await catalog.load(); });
        for (const width of [1200, 390, 320]) {
            await page.setViewportSize({ width, height: 1000 });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}`);
        }
        await page.evaluate(() => { mock.hold = true; catalog.load(); });
        await page.waitForFunction(() => Boolean(mock.release));
        await page.evaluate(() => { catalog.clear(); mock.hold = false; mock.release(); });
        await page.waitForFunction(() => document.querySelector('[data-options-fields]').disabled);
        assert.equal(await page.locator('[data-options-status]').textContent(), '');
        assert.deepEqual(await page.evaluate(() => ExamScores.grades), [10, 11, 12]);
        assert.deepEqual(errors, []);
        console.log('PASS: explicit catalog save, custom period/grade/suggestions, preserved form values, safe labels, year validation, stale conflict, offline fallback/retry, auth clear, mobile320');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

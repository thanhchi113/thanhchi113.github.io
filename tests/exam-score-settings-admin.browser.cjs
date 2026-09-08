const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        await page.route('**/*', route => route.abort());
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<main id="adminPanel"><input id="scoreInput" value="8.5"><div id="scoreStatisticsSettings"></div></main>');
        await page.addStyleTag({ path: path.resolve(__dirname, '../assets/exam-score-settings-admin.css') });
        await page.addScriptTag({ path: path.resolve(__dirname, '../assets/exam-score-settings-admin.js') });
        await page.evaluate(() => {
            window.mock = { data: { id: 1, statistics_enabled: true, summary_enabled: true, bar_enabled: true, pie_enabled: true, line_enabled: true, enabled_periods: ['gk1', 'ck1', 'gk2', 'ck2'] }, events: [], failRead: false, failWrite: false, hold: false };
            const client = { from(table) {
                if (table !== 'exam_score_settings') throw new Error('Unexpected table');
                let payload;
                const query = { select() { return query; }, eq(column, value) { if (column !== 'id' || value !== 1) throw new Error('Singleton ID required'); return query; }, update(value) { payload = value; return query; }, async single() {
                    mock.events.push(payload ? 'write' : 'read');
                    if (mock.hold) await new Promise(resolve => { mock.release = resolve; });
                    if (!payload) return { data: structuredClone(mock.data), error: mock.failRead ? { code: 'PGRST205' } : null };
                    if (mock.failWrite) return { data: null, error: { code: 'PGRST116' } };
                    Object.assign(mock.data, payload); return { data: { id: 1 }, error: null };
                } };
                return query;
            } };
            window.controller = window.ExamScoreSettingsAdmin.init(client);
        });
        await page.evaluate(() => controller.load());
        const input = name => page.locator(`[name="${name}"]`);
        await input('bar_enabled').uncheck();
        await page.locator('[name="enabled_periods"][value="ck2"]').uncheck();
        await input('statistics_enabled').uncheck();
        assert(await input('bar_enabled').isDisabled());
        assert(!(await input('bar_enabled').isChecked()));
        assert(!(await page.locator('[name="enabled_periods"][value="ck2"]').isChecked()));
        assert.equal(await page.evaluate(() => mock.events.filter(event => event === 'write').length), 0);
        await page.locator('[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-settings-status]').textContent.includes('Đã lưu'));
        assert.deepEqual(await page.evaluate(() => mock.data), { id: 1, statistics_enabled: false, summary_enabled: true, bar_enabled: false, pie_enabled: true, line_enabled: true, enabled_periods: ['gk1', 'ck1', 'gk2'] });
        await page.evaluate(() => controller.load());
        assert(!(await input('statistics_enabled').isChecked()));
        await input('statistics_enabled').check();
        assert(!(await input('bar_enabled').isDisabled()));
        assert(!(await input('bar_enabled').isChecked()));
        await page.evaluate(() => { mock.failWrite = true; });
        await page.locator('[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-settings-status]').textContent.includes('Chưa lưu'));
        assert.equal(await page.evaluate(() => mock.data.statistics_enabled), false);
        assert(!(await input('statistics_enabled').isDisabled()));
        await page.evaluate(async () => { mock.failRead = true; await controller.load(); });
        assert(await input('statistics_enabled').isDisabled());
        assert(!(await page.locator('#scoreInput').isDisabled()));
        await page.evaluate(() => { mock.failRead = false; });
        await page.locator('[data-settings-refresh]').click();
        await page.waitForFunction(() => !document.querySelector('[data-settings-fields]').disabled);
        await page.evaluate(() => { mock.hold = true; controller.load(); });
        await page.waitForFunction(() => typeof mock.release === 'function');
        await page.evaluate(() => { controller.clear(); mock.hold = false; mock.release(); });
        await page.waitForTimeout(10);
        assert(await input('statistics_enabled').isDisabled());
        assert.equal(await page.locator('[data-settings-status]').textContent(), '');
        for (const width of [1200, 390]) {
            await page.setViewportSize({ width, height: 900 });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        }
        assert.deepEqual(errors, []);
        console.log('PASS: explicit statistics save, preserved master-off choices, period selection, write/read errors, score form independence, stale load clear, mobile layout');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

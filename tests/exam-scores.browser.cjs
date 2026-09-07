const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4174';
const output = process.env.TEST_OUTPUT_DIR || require('node:os').tmpdir();
const api = require('../assets/exam-scores.js');
let database = Array.from({ length: 25 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    period: api.periods[index % 4].key, score: [0, 4.5, 5, 6.5, 8, 9, 10][index % 7],
    grade: index < 20 ? 12 : 11, class_name: index < 20 ? '12A1' : '11A1',
    school_year: '2026-2027', published: index !== 24, created_at: new Date(2026, 8, 7, 12, 0, 25 - index).toISOString()
}));
let writes = 0, scoreError = null, chartError = false, denyWrite = false;

async function mockApi(context) {
    await context.route('https://uiyqdqucqplifcvukwul.supabase.co/**', async route => {
        const request = route.request(), url = new URL(request.url());
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
        const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(data) });
        if (request.method() === 'OPTIONS') return respond({});
        if (url.pathname === '/auth/v1/user') return respond({ id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test', aud: 'authenticated', role: 'authenticated' });
        if (url.pathname.endsWith('/rpc/current_user_is_admin')) return respond(true);
        if (!url.pathname.endsWith('/exam_scores')) return respond([]);
        if (request.method() === 'GET') {
            if (scoreError) return respond(scoreError, 404);
            let rows = database;
            if (url.searchParams.get('published') === 'eq.true') rows = rows.filter(row => row.published);
            const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 500);
            return respond(rows.slice(offset, offset + limit));
        }
        writes++;
        if (denyWrite) return respond({ code: 'PGRST116', message: 'No rows' }, 406);
        let selected;
        const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        if (request.method() === 'POST') {
            selected = { ...request.postDataJSON(), id: `added-${writes}`, created_at: new Date().toISOString() };
            database.unshift(selected);
        } else if (request.method() === 'PATCH') {
            selected = database.find(row => row.id === id);
            Object.assign(selected, request.postDataJSON());
        } else if (request.method() === 'DELETE') {
            selected = database.find(row => row.id === id);
            database = database.filter(row => row.id !== id);
        } else throw new Error(`Unexpected write: ${request.method()}`);
        return respond({ id: selected.id });
    });
    await context.route('https://cdn.jsdelivr.net/npm/chart.js@4.5.1/**', route => chartError ? route.abort() : route.continue());
}

async function canvasState(page, id) {
    return page.locator(`#${id}`).evaluate(canvas => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 64) sum += data[i] + data[i + 1] + data[i + 2] + data[i + 3];
        return { sum, width: canvas.clientWidth, height: canvas.clientHeight };
    });
}
async function waitCharts(page) {
    await page.waitForFunction(() => window.Chart && ['scoreBarChart', 'scorePieChart', 'scoreLineChart'].every(id => Chart.getChart(document.getElementById(id))));
}
async function noOverflow(page) {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page must not overflow horizontally');
}

(async () => {
    for (const file of ['index.html', 'admin.html', 'achievements.html']) {
        const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (match[1].trim()) new Function(match[1]);
    }
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await mockApi(context);
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/achievements.html?type=scores`);
        await waitCharts(page);
        assert.equal(await page.locator('#scoreCount').innerText(), '24');
        const expected = api.summarize(database.filter(row => row.published));
        assert.equal(await page.locator('#scoreAverage').innerText(), api.format(expected.average));
        for (const id of ['scoreBarChart', 'scorePieChart', 'scoreLineChart', 'evidenceGalaxyCanvas']) {
            const pixels = await canvasState(page, id);
            assert(pixels.sum > 0 && pixels.width > 200 && pixels.height > 100, `${id} renders nonblank pixels`);
        }
        const sky = await canvasState(page, 'evidenceGalaxyCanvas');
        await page.waitForTimeout(300);
        assert.notEqual((await canvasState(page, 'evidenceGalaxyCanvas')).sum, sky.sum);
        await page.screenshot({ path: path.join(output, 'exam-scores-desktop.png'), fullPage: true });
        for (const width of [900, 390, 320]) {
            await page.setViewportSize({ width, height: 900 });
            await noOverflow(page);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(output, 'exam-scores-mobile.png'), fullPage: true });
        await page.locator('#menuToggle').click();
        assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Escape');
        await page.selectOption('#scoreGradeFilter', '11');
        await waitCharts(page);
        assert.equal(await page.locator('#scoreCount').innerText(), '4');
        await page.selectOption('#scorePeriodFilter', 'ck2');
        await waitCharts(page);
        const series = await page.evaluate(() => Chart.getChart(document.getElementById('scoreLineChart')).data.datasets[0].data);
        assert.deepEqual(series.slice(0, 3), [null, null, null]);
        await page.selectOption('#scoreGradeFilter', '10');
        assert.equal(await page.locator('#scoreCount').innerText(), '0');
        assert(!await page.locator('#examScoreResults').isVisible());
        await page.locator('[data-type="grade12"]').click();
        await page.locator('.evidence-card').first().waitFor();
        assert(!await page.locator('#examScores').isVisible());
        await page.locator('[data-type="scores"]').click();
        await page.selectOption('#scoreGradeFilter', 'all');
        await page.selectOption('#scorePeriodFilter', 'all');
        await waitCharts(page);
        await page.locator('.evidence-back-link').click();
        await page.waitForURL('**/index.html#achievements');
        await page.locator('[data-achievement-evidence="scores"]').focus();
        await page.keyboard.press('Enter');
        await page.waitForURL('**/achievements.html?type=scores');
        await waitCharts(page);
        console.log('Public: 3 charts, correct data, filters, missing periods, galaxy, responsive layout, navigation passed');

        const admin = await context.newPage();
        admin.on('pageerror', error => errors.push(error.message));
        await admin.addInitScript(() => {
            localStorage.setItem('sb-uiyqdqucqplifcvukwul-auth-token', JSON.stringify({
                access_token: 'test.header.signature', refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 7200,
                token_type: 'bearer', user: { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test' }
            }));
        });
        await admin.goto(`${base}/admin.html#admin-scores`);
        await admin.waitForFunction(() => !document.getElementById('scoreFormFields').disabled);
        assert.equal(await admin.locator('#scoreAdminRows tr').count(), 10);
        await admin.locator('#scoreAdminPagination [data-page="2"]').first().click();
        assert.equal(await admin.locator('#scoreAdminRows tr').count(), 10);
        await admin.locator('#scoreAdminPagination [data-page="3"]').first().click();
        assert.equal(await admin.locator('#scoreAdminRows tr').count(), 5);
        await admin.fill('#scoreClass', '12A2');
        await admin.fill('#scoreYear', '2026-2027');
        await admin.selectOption('#scoreGrade', '12');
        await admin.selectOption('#scorePeriod', 'ck2');
        await admin.fill('#scoreValue', '11');
        await admin.locator('#scoreSaveBtn').click();
        assert.equal(writes, 0);
        assert((await admin.locator('#scoreFormStatus').innerText()).includes('0 đến 10'));
        await admin.fill('#scoreValue', '8,75');
        await admin.locator('#scoreSaveBtn').dblclick();
        await admin.waitForFunction(() => document.getElementById('scoreFormStatus').textContent.includes('Đã lưu'));
        assert.equal(writes, 1);
        assert.equal(database[0].score, 8.75);
        assert.equal(await admin.locator('#scoreValue').inputValue(), '');
        assert.equal(await admin.locator('#scoreClass').inputValue(), '12A2');
        await admin.locator('[data-score-action="edit"]').first().click();
        await admin.fill('#scoreValue', '0');
        await admin.locator('#scoreSaveBtn').click();
        await admin.waitForFunction(() => document.getElementById('scoreFormStatus').textContent.includes('Đã lưu'));
        assert.equal(database[0].score, 0);
        await admin.locator('[data-score-action="toggle"]').first().click();
        await admin.waitForFunction(() => !document.getElementById('scoreFormFields').disabled);
        assert.equal(database[0].published, false);
        await page.reload();
        await waitCharts(page);
        assert.equal(await page.locator('#scoreCount').innerText(), '24');
        denyWrite = true;
        await admin.locator('[data-score-action="edit"]').first().click();
        await admin.fill('#scoreValue', '7');
        await admin.locator('#scoreSaveBtn').click();
        await admin.waitForFunction(() => document.getElementById('scoreFormStatus').textContent.includes('không còn tồn tại'));
        assert.equal(database[0].score, 0);
        denyWrite = false;
        admin.once('dialog', dialog => dialog.dismiss());
        await admin.locator('[data-score-action="delete"]').first().click();
        assert.equal(database.length, 26);
        admin.once('dialog', dialog => dialog.accept());
        await admin.locator('[data-score-action="delete"]').first().click();
        await admin.waitForFunction(() => !document.getElementById('scoreFormFields').disabled);
        assert.equal(database.length, 25);
        await admin.screenshot({ path: path.join(output, 'exam-admin-desktop.png'), fullPage: true });
        await admin.setViewportSize({ width: 390, height: 844 });
        await noOverflow(admin);
        await admin.screenshot({ path: path.join(output, 'exam-admin-mobile.png'), fullPage: true });
        console.log('Admin: auth, pagination, validation, create/edit/hide/delete, canceled delete, rejected write and mobile passed');

        scoreError = { code: 'PGRST205', message: 'Table missing' };
        await admin.locator('#scoreAdminRefresh').click();
        await admin.waitForFunction(() => !document.getElementById('scoreSetupHelp').classList.contains('hidden'));
        assert(await admin.locator('#scoreSaveBtn').isDisabled());
        await page.locator('#scoreRefresh').click();
        await page.waitForFunction(() => document.getElementById('examScoreStatus').textContent.includes('đang được thiết lập'));
        scoreError = null;
        await page.locator('#scoreRefresh').click();
        await waitCharts(page);
        database = [];
        await page.locator('#scoreRefresh').click();
        await page.waitForFunction(() => document.getElementById('scoreCount').textContent === '0');
        assert(!await page.locator('#examScoreResults').isVisible());
        database = [{ id: 'one', score: 9, period: 'gk1', grade: 12, class_name: '12A1', school_year: '2026-2027', published: true }];
        chartError = true;
        await page.reload();
        await page.waitForFunction(() => document.getElementById('examScoreStatus').textContent.includes('Chưa tải được biểu đồ'));
        assert(await page.locator('#scorePeriodRows').isVisible());
        chartError = false;
        await page.locator('#scoreRefresh').click();
        await waitCharts(page);
        assert.deepEqual(errors, []);
        console.log('Failure states: missing table, retry, no data, chart CDN failure and recovery passed; zero page errors');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

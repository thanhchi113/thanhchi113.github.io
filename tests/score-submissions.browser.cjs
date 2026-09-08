const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64');

async function setupMock(page) {
    await page.evaluate(() => {
        window.mock = { records: [], events: [], rejectInsert: false, rejectRpc: false, loseRpcResponse: false, refreshes: 0 };
        function query() {
            let mode = 'select', filters = [], start = 0, end = Infinity, one = false, optional = false;
            const builder = {
                select() { return builder; },
                delete() { mode = 'delete'; return builder; },
                eq(key, value) { filters.push([key, value]); return builder; },
                order() { return builder; },
                range(first, last) { start = first; end = last; return builder; },
                single() { one = true; return builder; },
                maybeSingle() { one = true; optional = true; return builder; },
                async insert(payload) {
                    mock.events.push({ type: 'insert', payload });
                    if (mock.rejectInsert) return { error: { code: 'PGRST000' } };
                    if (mock.records.some(row => row.id === payload.id)) return { error: { code: '23505' } };
                    mock.records.push(payload);
                    return { error: null };
                },
                then(resolve, reject) {
                    let data = mock.records.filter(row => filters.every(([key, value]) => row[key] === value));
                    const count = data.length;
                    if (mode === 'delete') {
                        mock.events.push({ type: 'delete', ids: data.map(row => row.id) });
                        mock.records = mock.records.filter(row => !data.includes(row));
                    }
                    data = data.slice(start, end + 1);
                    return Promise.resolve(one ? { data: data[0] || null, error: !data.length && !optional ? { code: 'PGRST116' } : null } : { data, count, error: null }).then(resolve, reject);
                }
            };
            return builder;
        }
        window.client = {
            from(table) { if (table !== 'exam_score_submissions') throw new Error('Unexpected table'); return query(); },
            storage: { from(bucket) { return {
                async upload(object, blob, options) { mock.events.push({ type: 'upload', bucket, object, options, size: blob.size }); return { data: { path: object }, error: null }; },
                async remove(objects) { mock.events.push({ type: 'remove', bucket, objects }); return { data: [], error: null }; },
                async download(object) { mock.events.push({ type: 'download', bucket, object }); return { data: new Blob(['test'], { type: 'image/png' }), error: null }; },
                async createSignedUrl(object) { mock.events.push({ type: 'sign', bucket, object }); return { data: { signedUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=' }, error: null }; }
            }; } },
            async rpc(name, payload) {
                if (name !== 'approve_exam_score_submission') throw new Error('Unexpected RPC');
                mock.events.push({ type: 'rpc', payload });
                if (mock.rejectRpc) return { error: { code: '42501' } };
                const row = mock.records.find(row => row.id === payload.submission_id && row.status === 'pending');
                if (!row) return { error: { code: 'P0002' } };
                row.status = 'approved';
                return mock.loseRpcResponse ? { error: { message: 'Network response lost' } } : { data: row.id };
            }
        };
        window.examScoreAdmin = { load() { mock.refreshes++; } };
    });
}
async function publicPage(page) {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const start = html.indexOf('<div id="scoreSubmission"');
    const end = html.indexOf('<!-- GALLERY MODAL -->', start);
    await page.setContent(`<html lang="vi"><body>${html.slice(start, end)}</body></html>`);
    await page.addScriptTag({ path: path.join(root, 'assets/exam-scores.js') });
    await setupMock(page);
    await page.addScriptTag({ path: path.join(root, 'assets/score-submissions.js') });
    await page.evaluate(() => ScoreSubmissions.init(client));
}
async function fillPublic(page, score = '8,5') {
    await page.locator('[name=student_name]').fill('Nguyễn Minh Anh');
    await page.locator('[name=class_name]').fill('12A1');
    await page.locator('[name=grade]').selectOption('12');
    await page.locator('[name=score]').fill(score);
    await page.locator('[name=school_year]').fill('2026-2027');
    await page.locator('[type=checkbox]').check();
}
async function waitIdle(page, selector) {
    await page.waitForFunction(selector => document.querySelector(selector).getAttribute('aria-busy') === 'false', selector);
}
async function submitPublic(page) {
    await page.locator('button[type=submit]').click();
    await waitIdle(page, '#studentScoreSubmissionForm');
}
async function adminPage(page) {
    await page.setContent('<html lang="vi"><body><div id="adminPanel"><div id="scoreSubmissionAdmin"></div></div></body></html>');
    await page.addStyleTag({ path: path.join(root, 'assets/score-submissions.css') });
    await page.addScriptTag({ path: path.join(root, 'assets/exam-scores.js') });
    await setupMock(page);
    await page.evaluate(() => {
        mock.records = Array.from({ length: 23 }, (_, index) => ({
            id: `student-${index}`, student_name: index === 0 ? '<img src=x onerror="window.injection=true">' : `Học sinh ${index}`,
            class_name: '12A1', grade: 12, school_year: '2026-2027', period: 'gk1', score: 8.5, status: 'pending', created_at: '2026-09-08T00:00:00Z',
            evidence_image_path: index < 3 ? `student-${index}/image.png` : null, evidence_image_name: index < 3 ? 'điểm.png' : null
        }));
    });
    await page.addScriptTag({ path: path.join(root, 'assets/score-submissions-admin.js') });
    await page.evaluate(async () => { window.adminSubmissions = ScoreSubmissionsAdmin.init(client); await adminSubmissions.load(); });
}
(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const context = await browser.newContext();
        // This suite uses injected clients; no production data, email or password calls are allowed.
        await context.route('https://**', route => route.abort());
        await context.route('https://fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
        const page = await context.newPage();
        await page.goto('https://fixture.test/');
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await publicPage(page);
        await fillPublic(page, '10,01');
        await page.locator('button[type=submit]').click();
        assert.match(await page.locator('#studentScoreSubmissionStatus').textContent(), /0 đến 10/);
        assert.equal(await page.evaluate(() => mock.events.length), 0);
        await fillPublic(page, '0');
        await page.locator('#studentScoreSubmissionImage').setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: png });
        assert.match(await page.locator('#studentScoreSubmissionStatus').textContent(), /Chọn một ảnh/);
        await page.locator('#studentScoreSubmissionDrop').evaluate((drop, bytes) => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([new Uint8Array(bytes)], 'xác nhận.png', { type: 'image/png' }));
            drop.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        }, Array.from(png));
        await page.evaluate(() => { mock.rejectInsert = true; });
        await submitPublic(page);
        assert.match(await page.locator('#studentScoreSubmissionStatus').textContent(), /Chưa gửi được/);
        assert.equal(await page.locator('[name=score]').inputValue(), '0');
        await page.evaluate(() => { mock.rejectInsert = false; });
        await submitPublic(page);
        const publicState = await page.evaluate(() => mock);
        assert.equal(publicState.records.length, 1);
        assert.equal(publicState.records[0].score, 0);
        assert.equal(publicState.records[0].status, 'pending');
        assert.equal(publicState.records[0].published, undefined);
        assert.equal(publicState.events.filter(event => event.type === 'upload').length, 1, 'Retries should reuse the uploaded image');
        assert(publicState.records[0].evidence_image_path.startsWith(publicState.records[0].id + '/'));
        assert.equal(await page.locator('[name=student_name]').inputValue(), '');
        await fillPublic(page, '10');
        await submitPublic(page);
        assert.equal(await page.evaluate(() => mock.records[1].evidence_image_path), null);

        await adminPage(page);
        assert.equal(await page.locator('[data-submission-id]').count(), 10);
        assert.equal(await page.evaluate(() => window.injection), undefined);
        assert.match(await page.locator('[data-submission-id="student-0"] h4').textContent(), /<img/);
        await page.locator('[data-submission-page="3"]').click();
        await waitIdle(page, '#scoreSubmissionAdmin');
        assert.equal(await page.locator('[data-submission-id]').count(), 3);
        await page.locator('[data-submission-page="1"]').first().click();
        await waitIdle(page, '#scoreSubmissionAdmin');
        const first = page.locator('[data-submission-id="student-0"]');
        await first.locator('[name=student_name]').fill('Tên đã sửa');
        await first.locator('[name=score]').fill('9,25');
        await first.locator('button[type=submit]').click();
        await waitIdle(page, '#scoreSubmissionAdmin');
        assert.equal(await first.count(), 0);
        const approved = await page.evaluate(() => mock.events.find(event => event.type === 'rpc').payload);
        assert.equal(approved.details.student_name, 'Tên đã sửa');
        assert.equal(approved.details.score, 9.25);
        assert.match(approved.details.evidence_image_path, /^scores\/.+\.png$/);
        assert.equal(await page.evaluate(() => mock.refreshes), 1);

        await page.evaluate(() => { mock.rejectRpc = true; });
        await page.locator('[data-submission-id="student-1"] button[type=submit]').click();
        await waitIdle(page, '#scoreSubmissionAdmin');
        assert.equal(await page.locator('[data-submission-id="student-1"]').count(), 1);
        assert.equal(await page.evaluate(() => mock.events.filter(event => event.type === 'remove' && event.bucket === 'exam-score-evidence').length), 1);

        await page.evaluate(() => { mock.rejectRpc = false; mock.loseRpcResponse = true; });
        await page.locator('[data-submission-id="student-2"] button[type=submit]').click();
        await waitIdle(page, '#scoreSubmissionAdmin');
        assert.equal(await page.locator('[data-submission-id="student-2"]').count(), 0);
        assert.equal(await page.evaluate(() => mock.events.filter(event => event.type === 'remove' && event.bucket === 'exam-score-evidence').length), 1, 'Lost response must not delete a published image');

        page.once('dialog', dialog => dialog.accept());
        await page.locator('[data-submission-id="student-3"] [data-submission-delete]').click();
        await waitIdle(page, '#scoreSubmissionAdmin');
        assert.equal(await page.locator('[data-submission-id="student-3"]').count(), 0);
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.evaluate(() => adminSubmissions.clear());
        assert.equal(await page.locator('[data-submission-id]').count(), 0);
        assert.deepEqual(errors, []);
        console.log('PASS: public score submissions, image drop/retry, validation, admin editing/approval/delete/pagination, lost-response image safety, XSS and mobile layout');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

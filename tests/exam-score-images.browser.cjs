const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { installVendorFallback, logScriptFailures } = require('./browser-vendor-support.cjs');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4174';
const host = 'https://uiyqdqucqplifcvukwul.supabase.co';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64');
const oldPath = 'scores/initial-evidence.png';
let records = [{ id: '00000000-0000-4000-8000-000000000002', student_name: 'Nguyễn Minh Anh', hide_student_name: false, score: 8.5, period: 'gk1', grade: 12, class_name: '12A1', school_year: '2026-2027', published: false, evidence_image_path: oldPath, evidence_image_name: 'initial-evidence.png', created_at: '2026-09-08T00:00:00Z' }];
const objects = new Set([oldPath]), events = [], unexpectedWrites = [];
let denyDb = false, denyUpload = false, denySign = false, breakImage = false, denyCleanup = false, rowId = 0;

async function mockApi(context) {
    // Every request to the production Supabase host is fulfilled here, including Storage.
    await context.route(`${host}/**`, async route => {
        const request = route.request(), url = new URL(request.url()), method = request.method();
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
        const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(data) });
        if (method === 'OPTIONS') return respond({});
        if (url.pathname === '/auth/v1/user') return respond({ id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test', aud: 'authenticated', role: 'authenticated' });
        if (url.pathname.endsWith('/rpc/current_user_is_admin')) return respond(true);
        if (url.pathname.endsWith('/exam_score_settings')) return respond({ id: 1, statistics_enabled: true, summary_enabled: true, bar_enabled: true, pie_enabled: true, line_enabled: true, enabled_periods: ['gk1', 'ck1', 'gk2', 'ck2'] });
        if (url.pathname.endsWith('/rpc/get_published_exam_scores')) {
            const { page_offset: offset = 0, page_limit: limit = 500 } = request.postDataJSON();
            return respond(records.filter(row => row.published).slice(offset, offset + limit).map(row => ({
                ...row, student_name: row.hide_student_name ? null : row.student_name,
                evidence_image_path: row.hide_student_name ? null : row.evidence_image_path,
                evidence_image_name: row.hide_student_name ? null : row.evidence_image_name
            })));
        }
        const signPrefix = '/storage/v1/object/sign/exam-score-evidence/';
        const objectPrefix = '/storage/v1/object/exam-score-evidence/';
        if (url.pathname.startsWith(signPrefix)) {
            const object = decodeURIComponent(url.pathname.slice(signPrefix.length));
            if (method === 'POST') {
                events.push({ type: 'sign', object });
                return denySign || !objects.has(object)
                    ? respond({ message: 'Mock signing denied', statusCode: '403', error: 'Forbidden' }, 403)
                    : respond({ signedURL: `/object/sign/exam-score-evidence/${object}?token=mock-${events.length}` });
            }
            if (method === 'GET') return breakImage ? respond({ error: 'Mock image unavailable' }, 404) : route.fulfill({ contentType: 'image/png', headers, body: png });
        }
        if (url.pathname.startsWith(objectPrefix) && method === 'POST') {
            const object = decodeURIComponent(url.pathname.slice(objectPrefix.length));
            events.push({ type: denyUpload ? 'upload-failed' : 'upload', object });
            if (denyUpload) return respond({ message: 'Mock upload denied', statusCode: '403', error: 'Forbidden' }, 403);
            objects.add(object);
            return respond({ Key: `exam-score-evidence/${object}` });
        }
        if (url.pathname === '/storage/v1/object/exam-score-evidence' && method === 'DELETE') {
            const paths = request.postDataJSON().prefixes;
            paths.forEach(object => events.push({ type: denyCleanup ? 'cleanup-failed' : 'cleanup', object }));
            if (denyCleanup) return respond({ message: 'Mock cleanup denied', statusCode: '403', error: 'Forbidden' }, 403);
            paths.forEach(object => objects.delete(object));
            return respond(paths.map(name => ({ name })));
        }
        if (url.pathname.endsWith('/exam_scores')) {
            if (method === 'GET') {
                const visible = url.searchParams.get('published') === 'eq.true' ? records.filter(row => row.published) : records;
                return respond(visible);
            }
            const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
            const payload = method === 'DELETE' ? null : request.postDataJSON();
            events.push({ type: denyDb ? 'db-failed' : 'db-commit', method, id, payload });
            if (denyDb) return respond({ code: 'PGRST116', message: 'Mock write denied' }, 406);
            let row;
            if (method === 'POST') {
                row = { ...payload, id: `mock-row-${++rowId}`, created_at: new Date().toISOString() };
                records.unshift(row);
            } else if (method === 'PATCH') {
                row = records.find(record => record.id === id);
                Object.assign(row, payload);
            } else if (method === 'DELETE') {
                row = records.find(record => record.id === id);
                records = records.filter(record => record.id !== id);
            } else throw new Error(`Unexpected score method: ${method}`);
            return respond({ id: row.id });
        }
        if (method !== 'GET') unexpectedWrites.push({ path: url.pathname, method });
        return respond([]);
    });
}
async function settled(page) {
    await page.waitForFunction(() => !document.getElementById('scoreFormFields').disabled && document.getElementById('scoreForm').getAttribute('aria-busy') === 'false');
}
async function save(page, successful = true) {
    await page.locator('#scoreSaveBtn').click();
    await page.waitForFunction(success => {
        const message = document.getElementById('scoreFormStatus').textContent;
        return success ? message.includes('Đã lưu điểm thi') : /không còn tồn tại|Không thể kết nối/.test(message);
    }, successful);
    await settled(page);
}
async function edit(page, id) {
    await page.locator(`[data-score-action="edit"][data-score-id="${id}"]`).click();
    await page.waitForFunction(() => document.getElementById('scoreFormTitle').textContent === 'Sửa điểm thi');
}
async function selectImage(page, name = 'score.png') {
    await page.locator('#scoreImageInput').setInputFiles({ name, mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => !document.getElementById('scorePreviewImage').hidden && document.getElementById('scorePreviewImage').naturalWidth > 0);
}
async function dropImages(page, files) {
    await page.locator('#scoreImageDropZone').evaluate((zone, payload) => {
        const transfer = new DataTransfer();
        payload.forEach(file => transfer.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type })));
        zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, files);
}
function assertOrder(start, expected) {
    assert.deepEqual(events.slice(start).filter(event => !['sign'].includes(event.type)).map(event => event.type), expected);
}

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await installVendorFallback(context);
        await mockApi(context);
        await context.addInitScript(() => localStorage.setItem('sb-uiyqdqucqplifcvukwul-auth-token', JSON.stringify({
            access_token: 'test.header.signature', refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 7200,
            token_type: 'bearer', user: { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test' }
        })));
        const page = await context.newPage(), errors = [];
        logScriptFailures(page);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${base}/admin.html#admin-scores`);
        await settled(page);
        await page.fill('#scoreStudentName', '  Trần   Minh Thư  ');
        await page.fill('#scoreClass', '12A2');
        await page.selectOption('#scoreGrade', '12');
        await page.selectOption('#scorePeriod', 'ck2');
        await page.fill('#scoreYear', '2026-2027');
        await page.fill('#scoreValue', '9,25');
        await page.locator('#scorePublished').uncheck();
        assert.equal(await page.locator('#scorePreviewName').textContent(), 'Trần   Minh Thư');
        assert.equal(await page.locator('#scorePreviewClass').textContent(), '12A2 · Khối 12');
        assert.equal(await page.locator('#scorePreviewPeriod').textContent(), 'Cuối kỳ 2');
        assert.equal(await page.locator('#scorePreviewValue').textContent(), '9,25');
        assert.match(await page.locator('#scorePreviewVisibility').textContent(), /Bản nháp/);
        assert(await page.locator('#scorePreviewFallback').isVisible());
        assert.equal(await page.locator('#scorePreviewFallback .exam-score-paper').getAttribute('data-score-display'), '9,25');
        const previewPaper = await page.locator('#scorePreviewFallback svg').elementHandle();
        await page.fill('#scoreClass', '12A2 cập nhật');
        assert(await previewPaper.evaluate(node => node.isConnected), 'Editing other fields must not restart the graph/LED sequence');
        await page.fill('#scoreClass', '12A2');

        for (const file of [
            { name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') },
            { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
            { name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }
        ]) {
            await page.locator('#scoreImageInput').setInputFiles(file);
            assert.match(await page.locator('#scoreImageStatus').textContent(), /tối đa 10 MB/);
            assert.equal(await page.locator('#scoreImageName').textContent(), 'Chưa đính kèm ảnh');
        }
        await dropImages(page, [1, 2].map(number => ({ name: `${number}.png`, type: 'image/png', bytes: [...png] })));
        assert.match(await page.locator('#scoreImageStatus').textContent(), /một ảnh/);
        await dropImages(page, [{ name: 'dragged-score.png', type: 'image/png', bytes: [...png] }]);
        await page.waitForFunction(() => document.getElementById('scorePreviewImage').naturalWidth > 0);
        assert.equal(await page.locator('#scoreImageName').textContent(), 'dragged-score.png');
        assert.equal(await page.locator('#scoreImageDropZone').evaluate(node => node.classList.contains('drag-over')), false);
        assert.equal(events.filter(event => event.type === 'upload').length, 0, 'Selecting or dropping a file must not upload before save');

        denyUpload = true;
        let start = events.length;
        await save(page, false);
        assertOrder(start, ['upload-failed']);
        assert.equal(records.length, 1);
        denyUpload = false;
        denyDb = true;
        start = events.length;
        await save(page, false);
        assertOrder(start, ['upload', 'db-failed', 'cleanup']);
        assert.deepEqual([...objects], [oldPath], 'Failed record insert must remove only its uploaded image');
        denyDb = false;
        start = events.length;
        await save(page);
        assertOrder(start, ['upload', 'db-commit']);
        const added = records[0];
        const addedPath = added.evidence_image_path;
        assert.equal(added.student_name, 'Trần Minh Thư');
        assert.equal(added.evidence_image_name, 'dragged-score.png');
        assert.equal(added.published, false);
        assert.equal(added.hide_student_name, false);
        assert.equal(added.score, 9.25);
        assert(objects.has(addedPath));
        assert.equal(await page.locator('#scoreStudentName').inputValue(), '');
        assert.equal(await page.locator('#scoreImageName').textContent(), 'Chưa đính kèm ảnh');

        await edit(page, added.id);
        await page.locator('#scoreHideName').check();
        await page.locator('#scorePublished').check();
        assert.notEqual(await page.locator('#scorePreviewName').textContent(), added.student_name);
        assert.equal(await page.locator('#scorePreviewName').evaluate(node => node.classList.contains('is-name-hidden')), true);
        assert.match(await page.locator('#scorePreviewName').evaluate(node => getComputedStyle(node).filter), /blur/);
        assert.equal(await page.locator('#scoreStudentName').inputValue(), added.student_name);
        assert(await page.locator('#scorePreviewImage').isHidden());
        await save(page);
        assert.equal(added.student_name, 'Trần Minh Thư', 'Privacy must retain the editable student name for admin');
        assert.equal(added.hide_student_name, true);
        assert.equal(added.evidence_image_path, addedPath, 'Privacy must retain the original evidence in admin storage');
        const publicPage = await context.newPage();
        logScriptFailures(publicPage);
        const signsBefore = events.filter(event => event.type === 'sign').length;
        await publicPage.goto(`${base}/achievements.html?type=scores`);
        await publicPage.locator('#scoreStudentCards .exam-student-card').first().waitFor();
        assert(!((await publicPage.locator('#scoreStudentCards').textContent()).includes(added.student_name)), 'The public card must not expose the hidden name');
        assert.match(await publicPage.locator('.exam-name-mask').first().evaluate(node => getComputedStyle(node).filter), /blur/);
        assert.equal(await publicPage.locator('#scoreStudentCards img').count(), 0);
        assert.equal(await publicPage.locator('#scoreStudentCards .exam-score-paper').first().getAttribute('data-score-display'), '9,25', 'The decorative paper must display this student score, including when the name is hidden');
        assert.equal(await publicPage.locator('#scoreCount').textContent(), '1', 'Anonymous student scores still count in statistics');
        assert.equal(events.filter(event => event.type === 'sign').length, signsBefore, 'Anonymous evidence must not be signed for the public page');
        await publicPage.close();
        await edit(page, added.id);
        await page.locator('#scoreHideName').uncheck();
        await page.locator('#scorePublished').uncheck();
        await save(page);

        denySign = true;
        await edit(page, added.id);
        await page.waitForFunction(() => document.getElementById('scoreImageStatus').textContent.includes('Không tải được ảnh đã lưu'));
        assert(await page.locator('#scorePreviewFallback').isVisible());
        assert.equal(await page.locator('#scoreStudentName').inputValue(), added.student_name);
        denySign = false;
        breakImage = true;
        await edit(page, added.id);
        await page.waitForFunction(() => document.getElementById('scoreImageStatus').textContent.includes('Không hiển thị được ảnh này'));
        assert(await page.locator('#scorePreviewFallback').isVisible());
        breakImage = false;
        await edit(page, added.id);
        await page.waitForFunction(() => !document.getElementById('scorePreviewImage').hidden && document.getElementById('scorePreviewImage').naturalWidth > 0);
        await page.fill('#scoreStudentName', '<img src=x onerror="window.cardInjected=true">');
        assert.equal(await page.locator('#scorePreviewName img').count(), 0);
        assert.equal(await page.evaluate(() => window.cardInjected), undefined);

        await selectImage(page, 'replacement.png');
        denyDb = true;
        start = events.length;
        await save(page, false);
        assertOrder(start, ['upload', 'db-failed', 'cleanup']);
        assert.equal(added.evidence_image_path, addedPath);
        assert(objects.has(addedPath), 'Failed replacement must preserve the previously saved image');
        denyDb = false;
        start = events.length;
        await save(page);
        assertOrder(start, ['upload', 'db-commit', 'cleanup']);
        const replacementPath = added.evidence_image_path;
        assert(objects.has(replacementPath));
        assert(!objects.has(addedPath));
        assert.equal(events.slice(start).find(event => event.type === 'cleanup').object, addedPath);
        assert.equal(await page.locator('#scoreAdminRows img').count(), 0, 'Stored name must remain text in the list');
        assert.equal(await page.evaluate(() => window.cardInjected), undefined);

        await edit(page, added.id);
        await page.locator('#scoreRemoveImage').click();
        assert(await page.locator('#scorePreviewFallback').isVisible());
        assert(objects.has(replacementPath), 'Clicking remove must defer deletion until save');
        denyDb = true;
        start = events.length;
        await save(page, false);
        assertOrder(start, ['db-failed']);
        assert(objects.has(replacementPath));
        denyDb = false;
        start = events.length;
        await save(page);
        assertOrder(start, ['db-commit', 'cleanup']);
        assert.equal(added.evidence_image_path, null);
        assert.equal(added.evidence_image_name, null);
        assert(!objects.has(replacementPath));

        // Failed cleanup must keep the successfully saved record and show the cleanup warning.
        const original = records.find(row => row.evidence_image_path === oldPath);
        await edit(page, original.id);
        await page.locator('#scoreRemoveImage').click();
        denyCleanup = true;
        start = events.length;
        await save(page);
        assertOrder(start, ['db-commit', 'cleanup-failed']);
        assert.equal(original.evidence_image_path, null);
        assert.match(await page.locator('#scoreFormStatus').textContent(), /Chưa dọn được ảnh cũ/);
        denyCleanup = false;

        await edit(page, added.id);
        await selectImage(page, 'delete-me.png');
        await save(page);
        const deletedPath = added.evidence_image_path;
        denyDb = true;
        page.once('dialog', dialog => dialog.accept());
        start = events.length;
        await page.locator(`[data-score-action="delete"][data-score-id="${added.id}"]`).click();
        await settled(page);
        assertOrder(start, ['db-failed']);
        assert(objects.has(deletedPath));
        denyDb = false;
        page.once('dialog', dialog => dialog.accept());
        start = events.length;
        await page.locator(`[data-score-action="delete"][data-score-id="${added.id}"]`).click();
        await settled(page);
        assertOrder(start, ['db-commit', 'cleanup']);
        assert(!objects.has(deletedPath));
        assert(!records.find(row => row.id === added.id));
        assert.deepEqual(unexpectedWrites, []);
        assert.deepEqual(errors, []);
        console.log('PASS: admin student preview/CRUD, blurred name privacy, hidden public evidence, drag-drop, type/size/count validation, upload/sign/image failures, XSS, post-commit image cleanup and rollback cleanup');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

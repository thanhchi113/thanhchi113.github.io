const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://evidence-optional-admin.test';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
const flags = {
    show_student_name: 'evidenceShowStudentName', show_image: 'evidenceShowImage',
    show_course_name: 'evidenceShowCourseName', show_school_name: 'evidenceShowSchoolName',
    show_result_summary: 'evidenceShowResultSummary', show_description: 'evidenceShowDescription'
};

function mockSdk() {
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test' };
    window.pendingEvidenceOcr = [];
    window.Tesseract = { recognize(file) { return new Promise((resolve, reject) => window.pendingEvidenceOcr.push({ name: file.name, resolve, reject })); } };
    const client = {
        auth: {
            async getUser() { return { data: { user }, error: null }; },
            onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
            async signOut() { return { error: null }; }
        },
        async rpc(name) { return { data: name === 'current_user_is_admin' ? true : [], error: null }; },
        from(table) {
            const request = { table, action: 'read', filters: {} };
            const finish = () => window.optionalEvidenceRequest(request);
            const query = new Proxy({}, { get: (_, key) => {
                if (key === 'then') return (resolve, reject) => finish().then(resolve, reject);
                if (key === 'single' || key === 'maybeSingle') return () => { request.single = true; return finish(); };
                return (...args) => {
                    if (key === 'eq') request.filters[args[0]] = args[1];
                    if (key === 'select') request.columns = args[0];
                    if (['insert', 'update', 'delete', 'upsert'].includes(key)) { request.action = key; request.payload = args[0]; }
                    return query;
                };
            } });
            return query;
        },
        storage: { from(bucket) { return {
            getPublicUrl() { throw new Error('Private evidence must never use a public storage URL'); },
            async createSignedUrl(file) { await window.optionalEvidenceStorage({ bucket, action: 'sign', file }); return { data: { signedUrl: `${location.origin}/fixture/${file}?signed=1` }, error: null }; },
            async upload(file, blob, options) { return window.optionalEvidenceStorage({ bucket, action: 'upload', file, name: blob.name, options }); },
            async remove(files) { return window.optionalEvidenceStorage({ bucket, action: 'remove', files }); }
        }; } }
    };
    window.supabase = { createClient: () => client };
}

(async () => {
    const existing = {
        id: 'existing', group_key: 'grade12', title: 'Kết quả học tập đã lưu', student_name: 'Nguyễn Minh Anh',
        course_name: '12A1 · 2026-2027', school_name: 'THPT Minh Họa', result_summary: '9 điểm Toán',
        description: 'Thông tin lưu để quản trị viên chỉnh sửa.', image_path: 'evidence/existing.png', image_name: 'existing.png',
        published: true, created_at: '2026-09-13T00:00:00Z', ...Object.fromEntries(Object.keys(flags).map(key => [key, true]))
    };
    const state = { rows: [structuredClone(existing)], reads: [], writes: [], storage: [], events: [], nextId: 1, readError: null, writeError: null };
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        await context.exposeBinding('optionalEvidenceRequest', (_, request) => {
            if (request.table !== 'achievement_evidence') {
                assert.equal(request.action, 'read', `Unexpected mutation of ${request.table}`);
                return { data: request.single ? null : [], error: null };
            }
            const selected = state.rows.filter(row => Object.entries(request.filters).every(([key, value]) => String(row[key]) === String(value)));
            if (request.action === 'read') {
                state.reads.push(structuredClone(request));
                return { data: state.readError ? null : structuredClone(request.single ? selected[0] || null : selected), error: state.readError };
            }
            state.writes.push(structuredClone(request));
            state.events.push({ kind: 'database', action: request.action, committed: !state.writeError });
            if (state.writeError) return { data: null, error: state.writeError };
            let result;
            if (request.action === 'insert') { result = { id: `created-${state.nextId++}`, ...request.payload }; state.rows.push(result); }
            else {
                assert(request.filters.id, 'Existing records require an exact ID');
                assert.equal(selected.length, 1, 'Only one intended record changes');
                result = selected[0];
                if (request.action === 'update') Object.assign(result, request.payload);
                else if (request.action === 'delete') state.rows = state.rows.filter(row => row.id !== result.id);
                else assert.fail(`Unexpected ${request.action}`);
            }
            return { data: structuredClone(request.single ? result : [result]), error: null };
        });
        await context.exposeBinding('optionalEvidenceStorage', (_, request) => {
            assert.equal(request.bucket, 'achievement-evidence');
            if (request.action === 'remove') assert(request.files.length && request.files.every(file => typeof file === 'string' && file.length && !file.includes('*')), 'Never delete a null or broad storage path');
            else assert.equal(typeof request.file, 'string');
            state.storage.push(structuredClone(request));
            state.events.push({ kind: 'storage', ...structuredClone(request) });
            return { data: {}, error: null };
        });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
            // All production database, object storage, OCR and other external traffic is blocked.
            if (url.origin !== origin) return route.abort();
            if (url.pathname.startsWith('/fixture/')) return route.fulfill({ contentType: 'image/png', body: png });
            const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
            const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.sql': 'text/plain' };
            return route.fulfill({ contentType: types[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
        });
        const page = await context.newPage(), errors = [];
        page.setDefaultTimeout(12000);
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        await page.goto(`${origin}/admin.html#admin-evidence`);
        const list = page.locator('#evidenceAdminList');
        const preview = page.locator('#evidencePreview');
        await list.getByText(existing.title, { exact: true }).waitFor();
        for (const key of Object.keys(flags)) assert(state.reads.filter(request => request.columns?.includes('image_path')).every(request => request.columns.split(',').includes(key)), `List reads must request ${key}, so stored privacy controls survive a reload`);
        const waitStatus = text => page.waitForFunction(text => document.getElementById('evidenceFormStatus').textContent.includes(text), text);
        const save = async () => { await page.click('#evidenceForm button[type="submit"]'); await waitStatus('Hoàn tất.'); };
        const edit = id => page.click(`[data-evidence-edit="${id}"]`);
        const uploads = () => state.storage.filter(item => item.action === 'upload');
        const removes = () => state.storage.filter(item => item.action === 'remove');
        const signs = () => state.storage.filter(item => item.action === 'sign');
        const resolveOcr = async (name, text) => page.evaluate(({ name, text }) => { const job = pendingEvidenceOcr.find(job => job.name === name); if (!job) throw new Error(`Missing OCR job ${name}`); job.resolve({ data: { text } }); }, { name, text });
        const chooseFile = async name => {
            await page.locator('#evidenceImageInput').setInputFiles({ name, mimeType: 'image/png', buffer: png });
            await page.waitForFunction(name => pendingEvidenceOcr.some(job => job.name === name), name);
        };

        assert.equal(await page.locator('#evidenceImageInput').getAttribute('required'), null, 'An attachment is optional');
        for (const id of Object.values(flags)) assert(await page.locator(`#${id}`).isChecked(), `${id} defaults to shown`);
        await page.fill('#evidenceTitle', 'Minh chứng nhập không kèm ảnh');
        await page.fill('#evidenceStudent', 'Trần Thanh Bình');
        await page.fill('#evidenceCourse', '12A2 · 2026-2027');
        await page.fill('#evidenceSchool', 'THPT Nguyễn Trãi');
        await page.fill('#evidenceResult', '8,75 điểm Toán');
        await page.fill('#evidenceDescription', 'Nội dung được giữ khi tắt hiển thị.');
        for (const id of Object.values(flags)) await page.locator(`#${id}`).uncheck();
        await preview.locator('.evidence-math-paper').waitFor();
        await save();
        const optional = state.rows.find(row => row.title === 'Minh chứng nhập không kèm ảnh');
        assert(optional, 'No-photo submission creates a record');
        assert.equal(optional.image_path, null);
        assert.equal(uploads().length, 0);
        assert.equal(removes().length, 0);
        for (const key of Object.keys(flags)) assert.equal(optional[key], false, `${key} persists independently`);
        assert.equal(optional.student_name, 'Trần Thanh Bình');
        assert.equal(optional.course_name, '12A2 · 2026-2027');
        assert.equal(optional.school_name, 'THPT Nguyễn Trãi');
        assert.equal(optional.result_summary, '8,75 điểm Toán');
        assert.equal(optional.description, 'Nội dung được giữ khi tắt hiển thị.');
        assert(await list.locator('.evidence-math-paper').count() > 0, 'No-photo list items display the animated mathematical illustration');

        await edit(optional.id);
        for (const id of Object.values(flags)) assert.equal(await page.locator(`#${id}`).isChecked(), false);
        assert.equal(await page.inputValue('#evidenceStudent'), optional.student_name, 'Hidden values remain editable by the administrator');
        await page.locator('#evidenceShowCourseName').check();
        await save();
        assert.equal(optional.show_course_name, true);
        for (const key of Object.keys(flags).filter(key => key !== 'show_course_name')) assert.equal(optional[key], false, 'Toggling one field must not expose other hidden fields');
        for (const id of Object.values(flags)) assert(await page.locator(`#${id}`).isChecked(), 'Save resets visibility defaults for the next record');

        await edit(existing.id);
        await preview.locator('img').waitFor();
        await page.locator('#evidenceShowImage').uncheck();
        await page.locator('#evidenceShowStudentName').uncheck();
        await preview.locator('.evidence-math-paper').waitFor();
        const signCount = signs().length;
        await page.fill('#evidenceResult', '9,25 điểm Toán');
        await save();
        const current = state.rows.find(row => row.id === existing.id);
        assert.equal(current.image_path, existing.image_path, 'Hiding an attachment preserves its stored path');
        assert.equal(current.image_name, existing.image_name);
        assert.equal(current.student_name, existing.student_name, 'Hiding the name preserves editable source data');
        assert.equal(current.show_student_name, false);
        assert.equal(current.show_image, false);
        assert.equal(uploads().length, 0);
        assert.equal(removes().length, 0, 'Visibility changes never delete an image');
        await edit(existing.id);
        await preview.locator('.evidence-math-paper').waitFor();
        assert.equal(await preview.locator('img').count(), 0);
        assert.equal(signs().length, signCount, 'Hidden attachments are not signed by the list, save or edit preview');

        await page.click('#evidenceRemoveImage');
        state.writeError = { code: '42501', message: 'Không thể lưu minh chứng thử nghiệm' };
        const removalCount = removes().length;
        await page.click('#evidenceForm button[type="submit"]');
        await waitStatus('Không thể lưu minh chứng thử nghiệm');
        assert.equal(current.image_path, existing.image_path, 'A failed edit retains the original attachment');
        assert.equal(removes().length, removalCount, 'An unsuccessful database save must not remove the old object');
        state.writeError = null;
        const eventStart = state.events.length;
        await save();
        assert.equal(current.image_path, null);
        assert(!current.image_name, 'Removing the attachment also clears its old file name');
        assert.deepEqual(removes().at(-1).files, [existing.image_path]);
        const removalEvents = state.events.slice(eventStart);
        const removedAt = removalEvents.findIndex(item => item.kind === 'storage' && item.action === 'remove');
        assert(removedAt > removalEvents.findIndex(item => item.kind === 'database' && item.action === 'update' && item.committed), 'Old image cleanup follows successful record persistence');

        // A late OCR response from the previous form/file must never overwrite a newer edit.
        await chooseFile('obsolete.png');
        await page.click('#evidenceResetBtn');
        await edit(optional.id);
        await resolveOcr('obsolete.png', 'Học sinh: Tên không được xuất hiện\nLớp: 11A9\nKết quả: 1 điểm');
        await page.waitForTimeout(60);
        assert.equal(await page.inputValue('#evidenceStudent'), optional.student_name);
        assert.equal(await page.inputValue('#evidenceOcrText'), optional.ocr_text || '');
        await page.click('#evidenceResetBtn');
        await chooseFile('older-file.png');
        await chooseFile('newer-file.png');
        await resolveOcr('newer-file.png', 'Học sinh: Lê Minh Châu\nLớp: 12A3\nKết quả: 9 điểm');
        await page.waitForFunction(() => document.getElementById('evidenceStudent').value === 'Lê Minh Châu');
        await resolveOcr('older-file.png', 'Học sinh: Tên cũ sai\nLớp: 10A1\nKết quả: 2 điểm');
        await page.waitForTimeout(60);
        assert.equal(await page.inputValue('#evidenceStudent'), 'Lê Minh Châu');
        assert.match(await page.inputValue('#evidenceOcrText'), /Lê Minh Châu/);
        assert(!(await page.inputValue('#evidenceTitle')).includes('Lê Minh Châu'), 'OCR should not duplicate private names into a public title');
        await page.click('#evidenceResetBtn');
        assert.equal(await page.inputValue('#evidenceOldPath'), '');
        assert.equal(await page.inputValue('#evidenceStudent'), '');
        await preview.locator('.evidence-math-paper').waitFor();

        const beforeDelete = removes().length;
        await page.click(`[data-evidence-delete="${optional.id}"]`);
        await page.waitForFunction(id => !document.querySelector(`[data-evidence-delete="${id}"]`), optional.id);
        assert.equal(removes().length, beforeDelete, 'Deleting a record without an image never sends null to Storage.remove');
        state.readError = { code: '42703', message: 'column achievement_evidence.show_image does not exist' };
        await page.click('#evidenceRefreshBtn');
        const migration = list.locator('a[download]');
        await migration.waitFor();
        const href = await migration.getAttribute('href');
        assert.equal(href, 'supabase/migrations/20260913183000_achievement_evidence_optional_image_privacy.sql');
        const migrationResponse = await page.evaluate(async href => { const result = await fetch(href); return { status: result.status, text: await result.text() }; }, href);
        assert.equal(migrationResponse.status, 200);
        assert.match(migrationResponse.text, /show_image/);
        state.readError = null;
        await page.click('#evidenceRefreshBtn');
        await list.getByText(existing.title, { exact: true }).waitFor();

        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#evidenceShowImage').scrollIntoViewIfNeeded();
        const geometry = await page.evaluate(ids => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, controls: ids.map(id => { const rect = document.getElementById(id).parentElement.getBoundingClientRect(); return { left: rect.left, right: rect.right }; }) }), Object.values(flags));
        assert(geometry.scrollWidth <= geometry.width + 1, 'Optional attachment controls do not add mobile page overflow');
        assert(geometry.controls.every(rect => rect.left >= 0 && rect.right <= geometry.width + 1), 'All six visibility controls fit on mobile');
        await page.screenshot({ path: path.resolve(root, '../../evidence-optional-admin-mobile.png') });
        assert.deepEqual(errors, [], 'The actual admin page has no uncaught errors');
        console.log('PASS: optional no-image creation, six independent visibility settings, private signed previews, preserved source fields, safe attachment removal/retry, stale OCR isolation, null-safe deletion, actionable schema migration and mobile layout.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

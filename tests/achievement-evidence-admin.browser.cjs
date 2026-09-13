const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://evidence-admin.test';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');

function mockSdk() {
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test' };
    window.Tesseract = { async recognize() { return { data: { text: 'Học sinh: Nguyễn Minh Anh\nKhóa học: Lớp 12\nKết quả: 9 điểm' } }; } };
    const client = {
        auth: {
            async getUser() { return { data: { user }, error: null }; },
            onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
            async signOut() { return { error: null }; }
        },
        async rpc(name) { return { data: name === 'current_user_is_admin' ? true : [], error: null }; },
        from(table) {
            const request = { table, action: 'read', filters: {} };
            const finish = () => window.evidenceRequest(request);
            const query = new Proxy({}, { get: (_, key) => {
                if (key === 'then') return (resolve, reject) => finish().then(resolve, reject);
                if (key === 'single' || key === 'maybeSingle') return () => { request.single = true; return finish(); };
                return (...args) => {
                    if (key === 'eq') request.filters[args[0]] = args[1];
                    if (['insert', 'update', 'delete', 'upsert'].includes(key)) { request.action = key; request.payload = args[0]; }
                    return query;
                };
            } });
            return query;
        },
        storage: { from(bucket) { return {
            getPublicUrl(file) { return { data: { publicUrl: `${location.origin}/fixture/${file}` } }; },
            async upload(file, blob, options) { return window.evidenceStorageRequest({ bucket, action: 'upload', file, name: blob.name, size: blob.size, options }); },
            async remove(files) { return window.evidenceStorageRequest({ bucket, action: 'remove', files }); }
        }; } }
    };
    window.supabase = { createClient: () => client };
}

(async () => {
    const state = {
        error: { code: 'PGRST205', message: "Could not find the table 'public.achievement_evidence' in the schema cache" },
        rows: [], writes: [], storage: [], nextId: 1
    };
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        await context.exposeBinding('evidenceRequest', (_, request) => {
            if (request.table !== 'achievement_evidence') {
                assert.equal(request.action, 'read', `Unexpected mutation of ${request.table}`);
                return { data: request.single ? null : [], error: null };
            }
            if (request.action === 'read') return { data: state.error ? null : structuredClone(state.rows), error: state.error };
            assert.equal(state.error, null, 'Writes only run after the schema is available');
            state.writes.push(structuredClone(request));
            if (request.action === 'insert') state.rows.push({ id: `evidence-${state.nextId++}`, ...request.payload });
            else {
                assert(request.filters.id, 'Existing records are modified by exact ID');
                const index = state.rows.findIndex(row => row.id === request.filters.id);
                assert(index >= 0, 'The requested record exists');
                if (request.action === 'update') Object.assign(state.rows[index], request.payload);
                else if (request.action === 'delete') state.rows.splice(index, 1);
                else assert.fail(`Unexpected action ${request.action}`);
            }
            return { data: null, error: null };
        });
        await context.exposeBinding('evidenceStorageRequest', (_, request) => {
            assert.equal(request.bucket, 'achievement-evidence');
            state.storage.push(request);
            return { data: {}, error: null };
        });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
            // All production transport is blocked; only the local application and fixtures are served.
            if (url.origin !== origin) return route.abort();
            if (url.pathname.startsWith('/fixture/')) return route.fulfill({ contentType: 'image/png', body: png });
            const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
            const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.sql': 'text/plain' };
            return route.fulfill({ contentType: types[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        const list = page.locator('#evidenceAdminList');
        const waitList = text => page.waitForFunction(text => document.querySelector('#evidenceAdminList')?.textContent.includes(text), text);
        const refresh = async text => { await page.click('#evidenceRefreshBtn'); await waitList(text); };
        const completed = () => page.waitForFunction(() => document.querySelector('#evidenceFormStatus').textContent === 'Hoàn tất.');
        await page.goto(`${origin}/admin.html#admin-evidence`);
        await waitList('Supabase chưa nhận diện được bảng lưu minh chứng');
        const download = list.locator('a[download]');
        assert.equal(await download.count(), 1);
        const repairUrl = await download.getAttribute('href');
        assert.equal(repairUrl, 'supabase/migrations/20260913153000_repair_achievement_evidence.sql');
        const sql = await page.evaluate(async href => { const response = await fetch(href); return { status: response.status, text: await response.text() }; }, repairUrl);
        assert.equal(sql.status, 200, 'The repair link serves an existing SQL file');
        assert.match(sql.text, /create table if not exists public\.achievement_evidence/i);
        assert.equal(await list.locator('a[target="_blank"]').getAttribute('href'), 'https://supabase.com/dashboard/project/uiyqdqucqplifcvukwul/sql/new');

        for (const error of [{ code: '42501', message: 'permission denied for table achievement_evidence' }, { code: 'PGRST301', message: 'JWT expired' }]) {
            state.error = error;
            await refresh('Hãy đăng nhập lại bằng tài khoản admin');
            assert.equal(await list.locator('a[download]').count(), 0, 'Permission errors must not recommend schema repair');
        }
        state.error = { message: 'Failed to fetch <img src=x onerror=alert(1)>' };
        await refresh('Hãy kiểm tra kết nối');
        assert.equal(await list.locator('a[download], img').count(), 0, 'Network details are escaped and do not recommend SQL');
        assert((await list.textContent()).includes('<img src=x onerror=alert(1)>'));

        state.error = null;
        await refresh('Chưa có minh chứng nào.');
        state.rows = [{ id: 'existing', group_key: 'grade12', title: 'Minh chứng đã lưu', student_name: 'Trần Thanh Bình', image_path: 'evidence/existing.png', image_name: 'existing.png', published: true, created_at: '2026-09-13T00:00:00Z' }];
        await refresh('Minh chứng đã lưu');
        assert((await list.textContent()).includes('Trần Thanh Bình'), 'Refresh recovers existing records after a schema error');
        await page.click('[data-evidence-delete="existing"]');
        await waitList('Chưa có minh chứng nào.');
        assert.deepEqual(state.storage.at(-1).files, ['evidence/existing.png']);

        await page.locator('#evidenceImageInput').setInputFiles({ name: 'minh-chung.png', mimeType: 'image/png', buffer: png });
        await page.waitForFunction(() => document.querySelector('#evidenceOcrStatus').textContent.includes('Đã trích xuất'));
        await page.selectOption('#evidenceGroup', 'grade12');
        await page.fill('#evidenceTitle', 'Kết quả tốt nghiệp THPT');
        await page.fill('#evidenceStudent', 'Nguyễn Minh Anh');
        await page.fill('#evidenceCourse', '12A1 · 2026-2027');
        await page.fill('#evidenceSchool', 'THPT Nguyễn Trãi');
        await page.fill('#evidenceResult', '9 điểm Toán');
        await page.fill('#evidenceDescription', 'Minh chứng kiểm tra nhập và lưu.');
        await page.click('#evidenceForm button[type="submit"]');
        await completed();
        await waitList('Kết quả tốt nghiệp THPT');
        assert.equal(state.rows.length, 1);
        const original = structuredClone(state.rows[0]);
        assert.equal(original.student_name, 'Nguyễn Minh Anh');
        assert.equal(original.course_name, '12A1 · 2026-2027');
        assert.equal(original.result_summary, '9 điểm Toán');
        assert.equal(original.published, true);
        assert.equal(state.storage.at(-1).action, 'upload');
        assert.equal(state.storage.at(-1).options.upsert, false);
        assert.equal(state.storage.at(-1).options.contentType, 'image/png');
        assert.equal(state.storage.at(-1).file, original.image_path);

        await page.click(`[data-evidence-edit="${original.id}"]`);
        assert.equal(await page.inputValue('#evidenceStudent'), original.student_name);
        await page.fill('#evidenceTitle', 'Kết quả đã chỉnh sửa');
        await page.fill('#evidenceResult', '9,5 điểm Toán');
        await page.locator('#evidenceImageInput').setInputFiles({ name: 'minh-chung-moi.png', mimeType: 'image/png', buffer: png });
        await page.waitForFunction(() => document.querySelector('#evidenceOcrStatus').textContent.includes('Đã trích xuất'));
        await page.click('#evidenceForm button[type="submit"]');
        await completed();
        await waitList('Kết quả đã chỉnh sửa');
        assert.equal(state.rows.length, 1, 'Editing updates the selected record without duplication');
        assert.equal(state.rows[0].result_summary, '9,5 điểm Toán');
        assert.notEqual(state.rows[0].image_path, original.image_path);
        assert.deepEqual(state.storage.at(-1).files, [original.image_path], 'Replacement removes only the old image after the update');
        await page.click(`[data-evidence-toggle="${original.id}"]`);
        await waitList('Đang ẩn');
        assert.equal(state.rows[0].published, false);
        await page.click(`[data-evidence-toggle="${original.id}"]`);
        await waitList('Đang hiển thị');
        assert.equal(state.rows[0].published, true);
        const currentPath = state.rows[0].image_path;
        await page.click(`[data-evidence-delete="${original.id}"]`);
        await waitList('Chưa có minh chứng nào.');
        assert.equal(state.rows.length, 0);
        assert.deepEqual(state.storage.at(-1).files, [currentPath]);
        assert.deepEqual(errors, [], 'The actual admin page has no uncaught JavaScript errors');
        console.log('PASS: evidence schema/auth/network errors, repair download, refresh recovery, image upload, edit, publication toggle and exact deletion (isolated browser).');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });

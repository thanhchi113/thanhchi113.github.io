const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const origin = 'https://evidence-bulk.test';

function mockSdk() {
    const listeners = [];
    let user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test' };
    const client = {
        auth: {
            async getUser() { return { data: { user }, error: null }; },
            onAuthStateChange(listener) { listeners.push(listener); return { data: { subscription: { unsubscribe() {} } } }; },
            async signOut() { user = null; listeners.forEach(listener => listener('SIGNED_OUT', null)); return { error: null }; }
        },
        async rpc(name) { return { data: name === 'current_user_is_admin' ? Boolean(user) : [], error: null }; },
        from(table) {
            const request = { table, action: 'read', filters: {}, inFilters: {}, order: [] };
            const finish = () => window.evidenceBulkRequest(request);
            const query = new Proxy({}, { get: (_, key) => {
                if (key === 'then') return (resolve, reject) => finish().then(resolve, reject);
                if (key === 'single' || key === 'maybeSingle') return () => { request.single = true; return finish(); };
                return (...args) => {
                    if (key === 'eq') request.filters[args[0]] = args[1];
                    if (key === 'in') request.inFilters[args[0]] = args[1];
                    if (key === 'select') request.select = args[0];
                    if (key === 'order') request.order.push([args[0], args[1]]);
                    if (['update', 'delete'].includes(key)) { request.action = key; request.payload = args[0]; }
                    return query;
                };
            } });
            return query;
        },
        storage: { from(bucket) { return { async remove(files) { return window.evidenceBulkStorage({ bucket, files }); } }; } }
    };
    window.supabase = { createClient: () => client };
}

const rowId = n => `evidence-${String(n).padStart(2, '0')}`;
function rows() {
    return Array.from({ length: 13 }, (_, i) => ({
        id: rowId(i + 1), title: `Minh chứng ${i + 1}`, student_name: `Học sinh ${i + 1}`,
        group_key: i % 2 ? 'grade10' : 'grade12', course_name: '12A1', school_name: 'THPT Minh họa',
        result_summary: `${7 + i % 3}`, description: 'Ghi chú', published: i % 3 !== 0,
        show_student_name: true, show_image: i % 2 === 0, show_course_name: true,
        show_school_name: true, show_result_summary: true, show_description: true,
        image_path: i % 2 === 0 ? `evidence/${i + 1}.png` : null,
        created_at: new Date(Date.UTC(2026, 8, 14, 0, 0, 13 - i)).toISOString()
    }));
}

(async () => {
    const state = { rows: rows(), writes: [], storage: [], denied: new Set(), zero: new Set() };
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        await context.exposeBinding('evidenceBulkRequest', (_, request) => {
            const records = request.table === 'achievement_evidence' ? state.rows : [];
            const match = row => Object.entries(request.filters).every(([k, v]) => String(row[k]) === String(v))
                && Object.entries(request.inFilters).every(([k, values]) => values.map(String).includes(String(row[k])));
            const selected = records.filter(match);
            if (request.action === 'read') {
                let result = structuredClone(selected);
                for (const [key, options] of [...request.order].reverse()) result.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (options?.ascending === false ? -1 : 1));
                return { data: request.single ? result[0] || null : result, error: null, count: result.length };
            }
            assert.equal(request.table, 'achievement_evidence');
            assert(request.filters.id || request.inFilters.id, 'Mutations must target explicit evidence IDs');
            const ids = selected.map(row => row.id);
            state.writes.push(structuredClone(request));
            if (ids.some(id => state.denied.has(id))) return { data: null, error: { code: '42501', message: 'Từ chối thao tác thử nghiệm' } };
            if (ids.some(id => state.zero.has(id))) return { data: null, error: null };
            if (request.action === 'update') selected.forEach(row => Object.assign(row, request.payload));
            else state.rows = state.rows.filter(row => !ids.includes(row.id));
            const data = selected.map(row => ({ id: row.id, image_path: row.image_path }));
            return { data: request.single ? data[0] || null : data, error: null, count: data.length };
        });
        await context.exposeBinding('evidenceBulkStorage', (_, request) => { state.storage.push(structuredClone(request)); return { data: request.files?.map(name => ({ name })), error: null }; });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
            if (url.origin !== origin) return route.abort();
            const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
            const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
            return route.fulfill({ contentType: types[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
        });
        const page = await context.newPage(); page.setDefaultTimeout(12000);
        const errors = [], dialogs = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
        await page.goto(`${origin}/admin.html#admin-evidence`);
        await page.locator('#evidenceAdminList [data-evidence-select]').first().waitFor();
        const settled = () => page.waitForFunction(() => { const s = window.evidenceAdmin?.getState(); return s?.ready && !s.busy && document.getElementById('evidenceBulkTools')?.getAttribute('aria-busy') === 'false'; });
        const check = n => page.locator(`[data-evidence-select][value="${rowId(n)}"]`);
        const field = name => page.locator(`#evidenceBulkTools [data-evidence-bulk-field="${name}"]`);
        const count = n => page.waitForFunction(n => document.getElementById('evidenceBulkCount')?.textContent === (n ? `Đã chọn ${n} mục` : 'Chưa chọn mục nào'), n);
        await settled(); await count(0);
        assert.equal(await page.locator('#evidenceAdminList [data-evidence-select]').count(), 10);
        await page.click('#evidenceBulkSelectPage'); await count(10);
        await page.locator('#evidenceAdminPagination [data-page="2"]').first().click(); await check(11).check(); await count(11);
        await page.locator('#evidenceAdminPagination [data-page="1"]').first().click(); assert.equal(await page.locator('[data-evidence-select]:checked').count(), 10);
        await page.click('#evidenceBulkSelectAll'); await count(13);
        await page.selectOption('#evidenceAdminGroup', 'grade10'); await count(0);
        await page.click('#evidenceBulkClear'); await page.selectOption('#evidenceAdminGroup', 'all');
        await check(1).check(); await page.locator('#evidenceAdminPagination [data-page="2"]').first().click(); await check(11).check();
        await page.locator('#evidenceBulkTools .evidence-bulk-editor summary').click();
        await field('group_key').selectOption('feedback'); await field('show_image').selectOption('false');
        const start = state.writes.length; await page.click('#evidenceBulkApply'); await settled();
        assert.deepEqual(state.writes.slice(start).map(w => w.filters.id).sort(), [rowId(1), rowId(11)]);
        assert(state.writes.slice(start).every(w => w.payload.group_key === 'feedback' && w.payload.show_image === false && w.payload.updated_at));
        assert.equal(state.rows.find(r => r.id === rowId(1)).show_image, false); await count(0);
        await page.fill('#evidenceStudent', 'Bản nháp');
        const before = state.rows.find(r => r.id === rowId(2)).show_image;
        await page.locator(`[data-evidence-field="show_image"][data-evidence-id="${rowId(2)}"]`).click(); await settled();
        assert.equal(state.rows.find(r => r.id === rowId(2)).show_image, !before); assert.equal(await page.inputValue('#evidenceStudent'), 'Bản nháp');
        await check(2).check(); await check(3).check(); state.denied.add(rowId(2));
        await field('show_description').selectOption('false'); await page.click('#evidenceBulkApply'); await settled();
        assert(await check(2).isChecked()); assert(!(await check(3).isChecked()));
        state.denied.clear(); await check(4).check(); const storageStart = state.storage.length; await page.click('#evidenceBulkDelete'); await settled();
        assert(!state.rows.some(r => r.id === rowId(4))); assert.deepEqual(state.storage.slice(storageStart), [{ bucket: 'achievement-evidence', files: [`evidence/4.png`] }]);
        assert.deepEqual(errors, []); console.log('PASS: evidence selection across pages/filters, exact bulk patches, independent inline image visibility, partial failure retention and confirmed deletion cleanup.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

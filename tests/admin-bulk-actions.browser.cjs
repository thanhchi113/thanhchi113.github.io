const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'https://admin-bulk.test';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');

function mockSdk() {
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test' };
    const client = {
        auth: {
            async getUser() { return { data: { user }, error: null }; },
            onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
            async signOut() { return { error: null }; }
        },
        async rpc(name) { return { data: name === 'current_user_is_admin' ? true : [], error: null }; },
        from(table) {
            const request = { table, action: 'read', filters: {}, inFilters: {}, excluded: {}, order: [] };
            const finish = () => window.bulkRequest(request);
            const query = new Proxy({}, { get: (_, key) => {
                if (key === 'then') return (resolve, reject) => finish().then(resolve, reject);
                if (key === 'single' || key === 'maybeSingle') return () => { request.single = true; return finish(); };
                return (...args) => {
                    if (key === 'select') { request.select = args[0]; request.options = args[1]; }
                    if (key === 'eq') request.filters[args[0]] = args[1];
                    if (key === 'in') request.inFilters[args[0]] = args[1];
                    if (key === 'neq') request.excluded[args[0]] = args[1];
                    if (key === 'order') request.order.push([args[0], args[1]]);
                    if (['insert', 'update', 'delete', 'upsert'].includes(key)) { request.action = key; request.payload = args[0]; }
                    return query;
                };
            } });
            return query;
        },
        storage: { from(bucket) { return {
            getPublicUrl(file) { return { data: { publicUrl: `${location.origin}/fixture/${file}` } }; },
            async remove(files) { return window.bulkStorageRequest({ bucket, action: 'remove', files }); }
        }; } }
    };
    window.supabase = { createClient: () => client };
}

const created_at = '2026-09-13T00:00:00Z';
function initialRows() {
    return {
        math_categories: [
            { id: 1, name: 'Lớp 10', slug: 'lop-10', sort_order: 1 },
            { id: 2, name: 'Lớp 12', slug: 'lop-12', sort_order: 2 },
            { id: 3, name: 'Kho lưu trữ', slug: 'kho-luu-tru', sort_order: 3 }
        ],
        math_documents: Array.from({ length: 14 }, (_, index) => ({
            id: index + 1, title: `Tài liệu ${String(index + 1).padStart(2, '0')}`,
            file_name: `tai-lieu-${index + 1}.pdf`, file_path: `uploads/doc-${index + 1}.pdf`,
            category_id: index < 12 ? 1 : 2, sort_order: index + 1,
            published: index % 2 === 0, created_at
        })),
        tikz_drawings: [1, 2].map(id => ({
            id: `tikz-${id}`, title: `Đồ thị ${id}`, code: '\\begin{tikzpicture}\\end{tikzpicture}',
            render_path: `tikz-${id}.pdf`, preview_path: `tikz-${id}.png`,
            published: id === 1, code_unlocked: id === 1, sort_order: id, created_at
        })),
        achievement_evidence: [1, 2].map(id => ({
            id: `evidence-${id}`, title: `Minh chứng ${id}`, student_name: `Học sinh ${id}`,
            image_path: `evidence/${id}.png`, group_key: 'grade12', published: true, sort_order: id, created_at
        })),
        document_contributions: [1, 2].map(id => ({
            id: `contribution-${id}`, title: `PDF đóng góp ${id}`, contributor_name: 'Nguyễn Minh Anh',
            file_path: `submissions/${id}.pdf`, file_name: `dong-gop-${id}.pdf`, file_size: 4096,
            category_id: 1, status: 'pending', created_at
        })),
        math_requests: [1, 2, 3].map(id => ({
            id: `request-${id}`, name: `Yêu cầu ${id}`, category_id: 1,
            request_text: 'Bổ sung tài liệu toán', status: id === 3 ? 'approved' : 'pending', created_at
        }))
    };
}

(async () => {
    const state = {
        rows: initialRows(), writes: [], storage: [], events: [],
        readErrors: {}, denied: new Set(), storageDenied: new Set()
    };
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        await context.exposeBinding('bulkRequest', (_, request) => {
            const rows = state.rows[request.table] || [];
            const matches = row => Object.entries(request.filters).every(([key, value]) => String(row[key]) === String(value))
                && Object.entries(request.inFilters).every(([key, values]) => values.map(String).includes(String(row[key])))
                && Object.entries(request.excluded).every(([key, value]) => String(row[key]) !== String(value));
            const selected = rows.filter(matches);
            if (request.action === 'read') {
                const error = state.readErrors[request.table] || null;
                const result = structuredClone(selected);
                for (const [key, options] of [...request.order].reverse()) {
                    result.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (options?.ascending === false ? -1 : 1));
                }
                return { data: error ? null : request.single ? result[0] || null : result, error, count: result.length };
            }
            assert(['update', 'delete'].includes(request.action), `Unexpected ${request.action} of ${request.table}`);
            assert(request.filters.id != null || request.inFilters.id?.length, 'Every mutation targets explicit record IDs');
            const ids = selected.map(row => String(row.id));
            state.writes.push(structuredClone(request));
            state.events.push({ kind: 'database', action: request.action, table: request.table, ids });
            if (ids.some(id => state.denied.has(`${request.table}:${id}`))) {
                return { data: null, error: { code: '42501', message: 'Không có quyền thao tác mục thử nghiệm' } };
            }
            const result = structuredClone(selected);
            if (request.action === 'update') selected.forEach(row => Object.assign(row, request.payload));
            else state.rows[request.table] = rows.filter(row => !matches(row));
            return { data: request.single ? result[0] || null : result, error: null, count: result.length };
        });
        await context.exposeBinding('bulkStorageRequest', (_, request) => {
            assert.equal(request.action, 'remove');
            assert(request.files.length > 0 && request.files.every(file => typeof file === 'string' && file && !file.includes('*')));
            state.storage.push(structuredClone(request));
            state.events.push({ kind: 'storage', ...structuredClone(request) });
            const failed = request.files.some(file => state.storageDenied.has(`${request.bucket}:${file}`));
            return { data: failed ? null : request.files.map(name => ({ name })), error: failed ? { message: 'Lỗi kho tệp thử nghiệm' } : null };
        });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
            // Real Supabase, storage, mail, rendering services and all other production transport are blocked.
            if (url.origin !== origin) return route.abort();
            if (url.pathname.startsWith('/fixture/')) return route.fulfill({ contentType: 'image/png', body: png });
            const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
            const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
            return route.fulfill({ contentType: types[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        const errors = [], dialogs = [];
        let acceptDialog = true;
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', async dialog => {
            dialogs.push(dialog.message());
            await (acceptDialog ? dialog.accept() : dialog.dismiss());
        });
        await page.goto(`${origin}/admin.html#admin-pdf`);
        await page.locator('#adminList [data-doc-id="1"]').waitFor();

        const toolbar = key => page.locator(`.admin-bulk-toolbar[data-bulk-key="${key}"]`);
        const count = key => toolbar(key).locator('.admin-bulk-count');
        const waitCount = (key, selected, total) => count(key).filter({ hasText: `Đã chọn ${selected}/${total} mục` }).waitFor();
        const all = key => toolbar(key).getByRole('button', { name: /^Chọn tất cả/ }).click();
        const clear = key => toolbar(key).getByRole('button', { name: 'Bỏ chọn', exact: true }).click();
        const rowCheck = (key, title) => {
            const lists = { documents: '#adminList', tikz: '#tikzAdminList', evidence: '#evidenceAdminList', requests: '#materialRequestList', 'pdf-contributions': '#pdfContributionList' };
            return page.locator(lists[key]).getByRole('checkbox', { name: `Chọn ${title}`, exact: true });
        };
        const documentCheck = id => rowCheck('documents', `Tài liệu ${String(id).padStart(2, '0')}`);
        const choose = async (key, action, destination) => {
            await toolbar(key).locator('.admin-bulk-actions select').first().selectOption(action);
            if (destination !== undefined) await toolbar(key).locator('.admin-bulk-destination').selectOption(String(destination));
        };
        const finishAction = async (key, action, destination) => {
            await choose(key, action, destination);
            const before = dialogs.length;
            await toolbar(key).locator('.admin-bulk-apply').click();
            await toolbar(key).locator('.admin-bulk-status').filter({ hasText: /^(Đã xử lý|Chưa xử lý thành công)/ }).waitFor();
            assert.equal(dialogs.length, before + 1, 'A batch has exactly one confirmation, regardless of row count');
            assert(!(await page.locator({ documents: '#adminList', tikz: '#tikzAdminList', evidence: '#evidenceAdminList', requests: '#materialRequestList', 'pdf-contributions': '#pdfContributionList' }[key]).evaluate(node => node.inert)), 'List interaction resumes after the batch');
        };
        const gotoWorkspace = async key => {
            if (!(await page.locator(`[data-workspace-tab="${key}"]`).isVisible())) await page.click('#adminSidebarOpen');
            await page.locator(`[data-workspace-tab="${key}"]`).click();
            await page.locator(`#${{ pdf: 'pdfWorkspace', tikz: 'tikzWorkspace', evidence: 'evidenceWorkspace', requests: 'requestsWorkspace' }[key]}.active`).waitFor();
        };
        const writtenIds = writes => writes.map(request => String(request.filters.id)).sort();

        await waitCount('documents', 0, 14);
        assert.equal(await page.locator('#adminList .admin-bulk-row-check input').count(), 10);
        await toolbar('documents').getByRole('checkbox', { name: 'Chọn tất cả mục ở trang hiện tại' }).check();
        await waitCount('documents', 10, 14);
        await page.locator('#docPagination [data-page="2"]').first().click();
        assert.equal(await page.locator('#adminList .admin-bulk-row-check input:checked').count(), 0);
        await documentCheck(12).check();
        await waitCount('documents', 11, 14);
        await page.locator('#docPagination [data-page="1"]').first().click();
        assert.equal(await page.locator('#adminList .admin-bulk-row-check input:checked').count(), 10, 'Selected IDs persist across pagination');
        await all('documents');
        await waitCount('documents', 14, 14);
        await page.selectOption('#docFilterCategory', '1');
        await waitCount('documents', 12, 12);
        await page.selectOption('#docFilterCategory', '2');
        await waitCount('documents', 0, 2);
        assert(await toolbar('documents').locator('.admin-bulk-apply').isDisabled(), 'Changing filters prunes selections outside the current results');

        await page.selectOption('#docFilterCategory', 'all');
        await documentCheck(1).check();
        await page.locator('#docPagination [data-page="2"]').first().click();
        await documentCheck(12).check();
        await waitCount('documents', 2, 14);
        let writeStart = state.writes.length;
        await finishAction('documents', 'move', 3);
        let writes = state.writes.slice(writeStart);
        assert.deepEqual(writtenIds(writes), ['1', '12'], 'Move modifies exactly the selected PDFs, including selected IDs on another page');
        assert(writes.every(request => request.table === 'math_documents' && request.payload.category_id === 3));
        assert.deepEqual(writes.map(request => request.payload.sort_order), [1, 2], 'Moving several PDFs appends distinct consecutive positions to the destination');
        assert(state.rows.math_documents.filter(row => ![1, 12].includes(row.id)).every(row => row.category_id === (row.id <= 12 ? 1 : 2)));
        assert.equal(state.storage.length, 0, 'Moving a category preserves existing file storage');
        await waitCount('documents', 0, 14);
        await page.locator('#docPagination [data-page="1"]').first().click();

        for (const action of ['hide', 'publish']) {
            await documentCheck(3).check();
            await documentCheck(4).check();
            writeStart = state.writes.length;
            await finishAction('documents', action);
            writes = state.writes.slice(writeStart);
            assert.deepEqual(writtenIds(writes), ['3', '4']);
            assert(writes.every(request => request.payload.published === (action === 'publish')), 'Show/hide sets an explicit value rather than toggling mixed states');
            assert(state.rows.math_documents.filter(row => [3, 4].includes(row.id)).every(row => row.published === (action === 'publish')));
        }

        await documentCheck(5).check();
        await documentCheck(6).check();
        await choose('documents', 'delete');
        writeStart = state.writes.length;
        let storageStart = state.storage.length;
        let dialogStart = dialogs.length;
        acceptDialog = false;
        await toolbar('documents').locator('.admin-bulk-apply').click();
        assert.equal(dialogs.length, dialogStart + 1);
        assert.equal(state.writes.length, writeStart, 'Cancelling permanent deletion makes no database changes');
        assert.equal(state.storage.length, storageStart, 'Cancelling permanent deletion never removes files');
        await waitCount('documents', 2, 14);
        acceptDialog = true;
        await finishAction('documents', 'delete');
        assert.deepEqual(writtenIds(state.writes.slice(writeStart)), ['5', '6']);
        assert.deepEqual(state.storage.slice(storageStart), [
            { bucket: 'math-pdfs', action: 'remove', files: ['uploads/doc-5.pdf'] },
            { bucket: 'math-pdfs', action: 'remove', files: ['uploads/doc-6.pdf'] }
        ]);
        assert(!state.rows.math_documents.some(row => [5, 6].includes(row.id)));

        await documentCheck(7).check();
        await documentCheck(8).check();
        state.denied.add('math_documents:7');
        storageStart = state.storage.length;
        await finishAction('documents', 'delete');
        await waitCount('documents', 1, 11);
        assert(await documentCheck(7).isChecked(), 'Failed items stay selected for review and retry');
        assert(state.rows.math_documents.some(row => row.id === 7));
        assert(!state.rows.math_documents.some(row => row.id === 8));
        assert.deepEqual(state.storage.slice(storageStart), [{ bucket: 'math-pdfs', action: 'remove', files: ['uploads/doc-8.pdf'] }], 'Denied database deletion must never remove the corresponding file');
        let message = await toolbar('documents').locator('.admin-bulk-status').textContent();
        assert.match(message, /1\/2/);
        assert.match(message, /1 mục chưa thành công/);
        await toolbar('documents').locator('.admin-bulk-details summary').click();
        assert((await toolbar('documents').locator('.admin-bulk-details').textContent()).includes('Tài liệu 07'));
        await clear('documents');
        state.denied.clear();

        await documentCheck(9).check();
        state.storageDenied.add('math-pdfs:uploads/doc-9.pdf');
        await finishAction('documents', 'delete');
        assert(!state.rows.math_documents.some(row => row.id === 9));
        await waitCount('documents', 0, 10);
        assert.match(await toolbar('documents').locator('.admin-bulk-status').textContent(), /1 mục có lưu ý/);
        assert.match(await toolbar('documents').locator('.admin-bulk-details').textContent(), /uploads\/doc-9.pdf/);
        state.storageDenied.clear();

        await gotoWorkspace('evidence');
        await waitCount('evidence', 0, 2);
        await rowCheck('evidence', 'Minh chứng 1').check();
        await finishAction('evidence', 'move', 'feedback');
        assert.equal(state.rows.achievement_evidence.find(row => row.id === 'evidence-1').group_key, 'feedback');
        assert.equal(state.rows.achievement_evidence.find(row => row.id === 'evidence-2').group_key, 'grade12');
        await rowCheck('evidence', 'Minh chứng 1').check();
        state.rows.achievement_evidence.find(row => row.id === 'evidence-1').image_path = 'evidence/new-current-image.png';
        storageStart = state.storage.length;
        await finishAction('evidence', 'delete');
        assert.deepEqual(state.storage.slice(storageStart), [{ bucket: 'achievement-evidence', action: 'remove', files: ['evidence/new-current-image.png'] }], 'Image cleanup uses the database-confirmed current path instead of stale list data');

        state.readErrors.achievement_evidence = { code: 'PGRST205', message: "Could not find the table 'public.achievement_evidence' in the schema cache" };
        await page.click('#evidenceRefreshBtn');
        await waitCount('evidence', 0, 0);
        assert.equal(await page.locator('#evidenceAdminList .admin-bulk-row-check input').count(), 0);
        assert(await toolbar('evidence').locator('.admin-bulk-apply').isDisabled());
        assert(await toolbar('evidence').getByRole('button', { name: /^Chọn tất cả/ }).isDisabled(), 'Missing schema exposes no actionable selection');
        delete state.readErrors.achievement_evidence;
        await page.click('#evidenceRefreshBtn');
        await waitCount('evidence', 0, 1);

        await gotoWorkspace('tikz');
        await waitCount('tikz', 0, 2);
        for (const action of ['lock', 'unlock']) {
            await all('tikz');
            writeStart = state.writes.length;
            await finishAction('tikz', action);
            assert(state.writes.slice(writeStart).every(request => request.payload.code_unlocked === (action === 'unlock')));
        }
        await rowCheck('tikz', 'Đồ thị 1').check();
        storageStart = state.storage.length;
        await finishAction('tikz', 'delete');
        assert.deepEqual(state.storage.slice(storageStart), [{ bucket: 'tikz-renders', action: 'remove', files: ['tikz-1.pdf'] }]);

        await gotoWorkspace('requests');
        await waitCount('requests', 0, 2);
        await all('requests');
        writeStart = state.writes.length;
        await finishAction('requests', 'approve');
        assert.deepEqual(writtenIds(state.writes.slice(writeStart)), ['request-1', 'request-2']);
        assert(state.writes.slice(writeStart).every(request => request.payload.status === 'approved'));
        await waitCount('requests', 0, 0);
        await page.selectOption('#materialRequestFilter', 'all');
        await rowCheck('requests', 'Yêu cầu 2').check();
        await finishAction('requests', 'reject');
        assert.equal(state.rows.math_requests.find(row => row.id === 'request-2').status, 'rejected');

        await waitCount('pdf-contributions', 0, 2);
        await rowCheck('pdf-contributions', 'PDF đóng góp 2').check();
        await finishAction('pdf-contributions', 'move', '2');
        assert.equal(state.rows.document_contributions.find(row => row.id === 'contribution-2').category_id, 2);
        await rowCheck('pdf-contributions', 'PDF đóng góp 1').check();
        storageStart = state.storage.length;
        await finishAction('pdf-contributions', 'delete');
        assert.deepEqual(state.storage.slice(storageStart), [{ bucket: 'document-submissions', action: 'remove', files: ['submissions/1.pdf'] }]);

        await gotoWorkspace('pdf');
        await waitCount('documents', 0, 10);
        await documentCheck(1).check();
        await choose('documents', 'move', '2');
        await toolbar('documents').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.resolve(root, '../../admin-bulk-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await toolbar('documents').scrollIntoViewIfNeeded();
        const geometry = await page.evaluate(() => {
            const bar = document.querySelector('[data-bulk-key="documents"]');
            const rect = bar.getBoundingClientRect();
            return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, left: rect.left, right: rect.right, controls: [...bar.querySelectorAll('button,select,input')].filter(node => node.offsetWidth && !node.hidden).map(node => ({ left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right })) };
        });
        assert(geometry.scrollWidth <= geometry.width + 1, 'Mobile page has no horizontal overflow');
        assert(geometry.left >= 0 && geometry.right <= geometry.width + 1);
        assert(geometry.controls.every(rect => rect.left >= 0 && rect.right <= geometry.width + 1), 'All selection and action controls fit the mobile viewport');
        await page.screenshot({ path: path.resolve(root, '../../admin-bulk-mobile.png') });

        for (const [index, event] of state.events.entries()) {
            if (event.kind !== 'storage') continue;
            assert(state.events.slice(0, index).some(prior => prior.kind === 'database' && prior.action === 'delete'), 'Storage removal occurs after database deletion');
        }

        assert.deepEqual(errors, [], 'The real admin page has no uncaught JavaScript errors');
        console.log('PASS: page/all selection, cross-page persistence, filter scoping, exact PDF moves, explicit show/hide and lock/unlock, confirmed/cancelled deletes, RLS failure, partial success, storage warning, missing schema, evidence/TikZ/contribution buckets, request review and mobile layout (isolated browser).');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });

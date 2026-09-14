const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const origin = 'https://exam-score-bulk.test';
const output = path.resolve(root, '../../test-output/exam-score-bulk');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');

function mockSdk() {
    let user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test' };
    const listeners = [];
    const fixture = window.scoreBulkTest = {
        responses: [], pendingWrites: [],
        signOut() { user = null; listeners.forEach(listener => listener('SIGNED_OUT', null)); },
        signIn() {
            user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test' };
            listeners.forEach(listener => listener('SIGNED_IN', { user }));
        }
    };
    const client = {
        auth: {
            async getUser() { return { data: { user }, error: null }; },
            onAuthStateChange(listener) { listeners.push(listener); return { data: { subscription: { unsubscribe() {} } } }; },
            async signOut() { user = null; listeners.forEach(listener => listener('SIGNED_OUT', null)); return { error: null }; }
        },
        async rpc(name) { return { data: name === 'current_user_is_admin' ? Boolean(user) : [], error: null }; },
        from(table) {
            const request = { table, action: 'read', filters: {}, inFilters: {}, excluded: {}, order: [] };
            const finish = async () => {
                const mutationId = request.action === 'read' ? null : request.filters.id;
                if (mutationId) fixture.pendingWrites.push(mutationId);
                const result = await window.scoreBulkRequest(request);
                if (mutationId) {
                    fixture.pendingWrites.splice(fixture.pendingWrites.indexOf(mutationId), 1);
                    fixture.responses.push(mutationId);
                }
                if (result.authLost) { user = null; listeners.forEach(listener => listener('SIGNED_OUT', null)); }
                return result;
            };
            const query = new Proxy({}, { get: (_, key) => {
                if (key === 'then') return (resolve, reject) => finish().then(resolve, reject);
                if (key === 'single' || key === 'maybeSingle') return () => { request.single = true; return finish(); };
                return (...args) => {
                    if (key === 'select') { request.select = args[0]; request.options = args[1]; }
                    if (key === 'eq') request.filters[args[0]] = args[1];
                    if (key === 'in') request.inFilters[args[0]] = args[1];
                    if (key === 'neq') request.excluded[args[0]] = args[1];
                    if (key === 'order') request.order.push([args[0], args[1]]);
                    if (key === 'range') request.range = args;
                    if (['insert', 'update', 'delete', 'upsert'].includes(key)) { request.action = key; request.payload = args[0]; }
                    return query;
                };
            } });
            return query;
        },
        storage: { from(bucket) { return {
            getPublicUrl(file) { return { data: { publicUrl: `${location.origin}/fixture/${file}` } }; },
            async createSignedUrl(file) { return { data: { signedUrl: `${location.origin}/fixture/${file}?signed=1` }, error: null }; },
            async remove(files) { return window.scoreBulkStorageRequest({ bucket, action: 'remove', files }); }
        }; } }
    };
    window.supabase = { createClient: () => client };
}

const scoreId = number => `score-${String(number).padStart(2, '0')}`;
function initialRows() {
    return Array.from({ length: 23 }, (_, index) => ({
        id: scoreId(index + 1), student_name: `Nguyễn Minh ${String(index + 1).padStart(2, '0')}`,
        class_name: index < 12 ? '12A1' : '11A2', grade: index < 12 ? 12 : 11,
        school_year: '2026-2027', period: index < 12 ? 'gk1' : 'ck1', score: 6 + (index % 9) / 4,
        published: index % 3 !== 0, hide_student_name: index % 4 === 1,
        show_image: true, show_score: index % 5 !== 0, show_class_name: true,
        show_grade: index % 3 !== 1, show_school_year: true, show_period: true,
        evidence_image_path: index % 2 === 0 ? `scores/student-${index + 1}.png` : null,
        evidence_image_name: index % 2 === 0 ? `student-${index + 1}.png` : null,
        created_at: new Date(Date.UTC(2026, 8, 14, 0, 0, 23 - index)).toISOString()
    }));
}

(async () => {
    const state = { rows: initialRows(), writes: [], storage: [], events: [], denied: new Set(), zeroRows: new Set(), holds: new Map(), authLoss: false };
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        await context.exposeBinding('scoreBulkRequest', async (_, request) => {
            const rows = request.table === 'exam_scores' ? state.rows : [];
            const matches = row => Object.entries(request.filters).every(([key, value]) => String(row[key]) === String(value))
                && Object.entries(request.inFilters).every(([key, values]) => values.map(String).includes(String(row[key])))
                && Object.entries(request.excluded).every(([key, value]) => String(row[key]) !== String(value));
            let selected = rows.filter(matches);
            if (request.action === 'read') {
                selected = structuredClone(selected);
                for (const [key, options] of [...request.order].reverse()) selected.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (options?.ascending === false ? -1 : 1));
                if (request.range) selected = selected.slice(request.range[0], request.range[1] + 1);
                return { data: request.single ? selected[0] || null : selected, error: null, count: selected.length };
            }
            assert.equal(request.table, 'exam_scores', 'Only the mock exam_scores table may be mutated');
            assert(['update', 'delete'].includes(request.action), `Unexpected mutation ${request.action}`);
            assert(request.filters.id != null || request.inFilters.id?.length, 'Each mutation must target explicit IDs');
            const ids = selected.map(row => row.id);
            state.writes.push(structuredClone(request));
            state.events.push({ kind: 'database', action: request.action, ids });
            const hold = state.holds.get(ids[0]);
            if (hold) { state.holds.delete(ids[0]); await hold; }
            if (ids.some(id => state.denied.has(id))) return { data: null, error: { code: '42501', message: 'Từ chối thao tác thử nghiệm' } };
            if (ids.some(id => state.zeroRows.has(id))) return { data: null, error: null };
            if (request.action === 'update') selected.forEach(row => Object.assign(row, request.payload));
            else state.rows = rows.filter(row => !matches(row));
            const authLost = state.authLoss;
            state.authLoss = false;
            return { data: request.single ? structuredClone(selected[0]) : structuredClone(selected), error: null, count: selected.length, authLost };
        });
        await context.exposeBinding('scoreBulkStorageRequest', (_, request) => {
            assert.equal(request.bucket, 'exam-score-evidence');
            assert.equal(request.action, 'remove');
            assert(request.files.length && request.files.every(file => typeof file === 'string' && file.startsWith('scores/') && !file.includes('*')));
            state.storage.push(structuredClone(request));
            state.events.push({ kind: 'storage', ...structuredClone(request) });
            return { data: request.files.map(name => ({ name })), error: null };
        });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
            // Block all production transport; test reads, writes and storage are in-memory fixtures.
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
        page.on('dialog', async dialog => { dialogs.push(dialog.message()); await (acceptDialog ? dialog.accept() : dialog.dismiss()); });
        await page.goto(`${origin}/admin.html#admin-scores`);

        const settled = () => page.waitForFunction(() => {
            const state = window.examScoreAdmin?.getState();
            return state?.ready && !state.busy && document.getElementById('scoreForm').getAttribute('aria-busy') === 'false'
                && document.getElementById('scoreBulkTools')?.getAttribute('aria-busy') === 'false';
        });
        const check = number => page.locator(`[data-score-select][value="${scoreId(number)}"]`);
        const field = name => page.locator(`#scoreBulkTools [data-score-bulk-field="${name}"]`);
        const quick = (number, name) => page.locator(`[data-score-field="${name}"][data-score-id="${scoreId(number)}"]`);
        const row = number => state.rows.find(item => item.id === scoreId(number));
        const selectedCount = async (count, total = state.rows.length) => {
            await page.waitForFunction(({ count, total }) => {
                const text = document.getElementById('scoreBulkCount')?.textContent || '';
                const selected = count ? text === `Đã chọn ${count} bài thi` : text === 'Chưa chọn bài thi';
                return selected && window.examScoreAdmin.getState().filtered.length === total;
            }, { count, total });
        };
        const go = number => page.locator(`#scoreAdminPagination [data-page="${number}"]`).first().click();
        const clear = () => page.click('#scoreBulkClear');
        const writeIds = start => state.writes.slice(start).flatMap(request => request.inFilters.id || [request.filters.id]).sort();
        const apply = async () => { await page.click('#scoreBulkApply'); await settled(); };

        await settled();
        await selectedCount(0, 23);
        assert.equal(await page.locator('#scoreAdminRows [data-score-select]').count(), 10, 'Score list has 10 rows on the first page');
        await page.locator('#scoreBulkSelectPage').click();
        await selectedCount(10, 23);
        await go(2);
        assert.equal(await page.locator('#scoreAdminRows [data-score-select]:checked').count(), 0);
        await check(15).check();
        await selectedCount(11, 23);
        await go(1);
        assert.equal(await page.locator('#scoreAdminRows [data-score-select]:checked').count(), 10, 'Page changes preserve selection by student record ID');
        await page.click('#scoreBulkSelectAll');
        await selectedCount(23, 23);
        await page.selectOption('#scoreAdminPeriod', 'gk1');
        await selectedCount(12, 12);
        await page.selectOption('#scoreAdminPeriod', 'ck1');
        await selectedCount(0, 11);
        assert(await page.locator('#scoreBulkApply').isDisabled(), 'Changing filters removes selections outside the filtered result');
        await page.click('#scoreBulkSelectAll');
        await selectedCount(11, 11);
        await clear();
        await page.selectOption('#scoreAdminPeriod', 'all');
        await page.locator('#scoreBulkTools .score-bulk-editor summary').click();

        await check(2).check();
        await go(2);
        await check(15).check();
        const beforeBulk = structuredClone(state.rows);
        await field('class_name').fill('12A mới');
        await field('school_year').fill('2027-2028');
        await field('grade').selectOption('10');
        await field('period').selectOption('ck2');
        await field('show_image').selectOption('false');
        let start = state.writes.length;
        await apply();
        assert.deepEqual(writeIds(start), [scoreId(2), scoreId(15)], 'A cross-page batch targets exactly selected IDs');
        assert(state.writes.slice(start).every(request => JSON.stringify(Object.keys(request.payload).sort()) === JSON.stringify(['class_name', 'grade', 'period', 'school_year', 'show_image'])), 'Bulk updates send only explicitly chosen fields');
        for (const original of beforeBulk) {
            const expected = [scoreId(2), scoreId(15)].includes(original.id) ? { ...original, class_name: '12A mới', grade: 10, school_year: '2027-2028', period: 'ck2', show_image: false } : original;
            assert.deepEqual(state.rows.find(item => item.id === original.id), expected, 'Unselected fields and students retain their prior values');
        }
        await selectedCount(0, 23);
        assert.equal(state.storage.length, 0, 'Hiding an image must not delete its stored file');
        await go(1);

        for (const published of [false, true]) {
            await check(9).check();
            await check(10).check();
            await field('published').selectOption(String(published));
            start = state.writes.length;
            await apply();
            assert.equal(row(9).published, published);
            assert.equal(row(10).published, published, 'Bulk show/hide sets one explicit state for mixed starting values');
            assert(state.writes.slice(start).every(request => Object.keys(request.payload).length === 1 && request.payload.published === published));
            await selectedCount(0, 23);
        }

        await page.fill('#scoreStudentName', 'Bản nháp đang nhập');
        const beforeQuick = structuredClone(row(1));
        await quick(1, 'hide_student_name').click();
        await settled();
        assert.deepEqual(row(1), { ...beforeQuick, hide_student_name: true });
        assert.equal(await quick(1, 'hide_student_name').getAttribute('aria-pressed'), 'false', 'Quick name control reflects visibility, not inverted stored flag');
        assert.equal(await page.inputValue('#scoreStudentName'), 'Bản nháp đang nhập');
        assert.equal(await page.locator('#scoreFormTitle').textContent(), 'Nhập điểm thi', 'Quick toggles do not open the edit form');
        await quick(1, 'show_image').click();
        await settled();
        assert.deepEqual(row(1), { ...beforeQuick, hide_student_name: true, show_image: false }, 'Name and image visibility are independent');
        for (const name of ['show_score', 'show_class_name', 'show_grade', 'show_school_year', 'show_period']) {
            const previous = structuredClone(row(1));
            await quick(1, name).click();
            await settled();
            assert.deepEqual(row(1), { ...previous, [name]: !previous[name] });
        }
        const previousPublished = row(1).published;
        await page.locator(`[data-score-action="toggle"][data-score-id="${scoreId(1)}"]`).click();
        await settled();
        assert.equal(row(1).published, !previousPublished, 'Existing individual publication control still works');

        await page.selectOption('#scoreAdminVisibility', 'published');
        await check(1).check();
        await page.locator(`[data-score-action="toggle"][data-score-id="${scoreId(1)}"]`).click();
        await settled();
        await selectedCount(0, state.rows.filter(item => item.published).length);
        assert.equal(await check(1).count(), 0, 'An inline toggle removes a selected record that no longer matches the active filter');
        await page.selectOption('#scoreAdminVisibility', 'all');

        await page.locator(`[data-score-action="edit"][data-score-id="${scoreId(1)}"]`).click();
        await page.fill('#scoreStudentName', 'Tên đang sửa chưa lưu');
        const previousImage = row(1).show_image;
        await quick(1, 'show_image').click();
        await settled();
        assert.equal(await page.locator('#scoreShowImage').isChecked(), !previousImage, 'The active edit form stays in sync with an inline visibility change');
        assert.equal(await page.inputValue('#scoreStudentName'), 'Tên đang sửa chưa lưu', 'Inline visibility does not overwrite another unsaved field in the edited record');
        assert.equal(row(1).student_name, beforeQuick.student_name, 'An inline toggle never saves an unrelated draft field');
        await page.click('#scoreResetBtn');

        state.denied.add(scoreId(3));
        const deniedBefore = structuredClone(row(3));
        const deniedPressed = await quick(3, 'show_image').getAttribute('aria-pressed');
        start = state.writes.length;
        await quick(3, 'show_image').click();
        await settled();
        assert.equal(state.writes.length, start + 1);
        assert.deepEqual(row(3), deniedBefore, 'Rejected quick edits preserve stored data');
        assert.equal(await quick(3, 'show_image').getAttribute('aria-pressed'), deniedPressed, 'Rejected quick edits restore the visible toggle state');
        state.denied.clear();
        state.zeroRows.add(scoreId(3));
        await quick(3, 'show_image').click();
        await settled();
        assert.equal(await quick(3, 'show_image').getAttribute('aria-pressed'), deniedPressed, 'A response without the updated row is not treated as a successful toggle');
        state.zeroRows.clear();

        await check(5).check();
        await check(7).check();
        state.denied.add(scoreId(5));
        await field('show_student_name').selectOption('false');
        start = state.writes.length;
        await apply();
        assert.deepEqual(writeIds(start), [scoreId(5), scoreId(7)]);
        assert(state.writes.slice(start).every(request => Object.keys(request.payload).length === 1 && request.payload.hide_student_name === true));
        assert.equal(row(7).hide_student_name, true);
        await selectedCount(1, 23);
        assert(await check(5).isChecked(), 'Failed batch records remain selected for retry');
        assert(!(await check(7).isChecked()), 'Successful batch records are removed from selection');
        assert.match(await page.locator('#scoreBulkStatus').textContent(), /1/);
        state.denied.clear();
        await page.click('#scoreBulkReset');
        await clear();

        await check(4).check();
        start = state.writes.length;
        await page.click('#scoreBulkApply');
        assert.equal(state.writes.length, start, 'Keeping every field unchanged issues no mutation');
        await field('score').fill('11');
        await page.click('#scoreBulkApply');
        assert.equal(state.writes.length, start, 'Invalid score is rejected before issuing a mutation');
        await field('score').fill('');
        await field('school_year').fill('2026-2029');
        await page.click('#scoreBulkApply');
        assert.equal(state.writes.length, start, 'Invalid school year is rejected before issuing a mutation');
        await field('school_year').fill('');
        await field('score').fill('9,25');
        await apply();
        assert.equal(row(4).score, 9.25, 'Bulk score edits accept Vietnamese decimal commas');
        assert.deepEqual(Object.keys(state.writes.at(-1).payload), ['score']);
        await selectedCount(0, 23);

        await check(7).check();
        await check(8).check();
        acceptDialog = false;
        start = state.writes.length;
        let storageStart = state.storage.length;
        let dialogStart = dialogs.length;
        await page.click('#scoreBulkDelete');
        assert.equal(dialogs.length, dialogStart + 1);
        assert.equal(state.writes.length, start, 'Cancelling batch deletion preserves records');
        assert.equal(state.storage.length, storageStart, 'Cancelling batch deletion preserves files');
        await selectedCount(2, 23);
        acceptDialog = true;
        await page.click('#scoreBulkDelete');
        await settled();
        assert.deepEqual(writeIds(start), [scoreId(7), scoreId(8)]);
        assert(!row(7) && !row(8));
        assert.deepEqual(state.storage.slice(storageStart), [{ bucket: 'exam-score-evidence', action: 'remove', files: ['scores/student-7.png'] }], 'Deletion cleans up only an existing image after its database row is deleted');
        await selectedCount(0, 21);

        await check(1).check();
        await field('show_image').selectOption('true');
        fs.mkdirSync(output, { recursive: true });
        await page.waitForFunction(() => !document.getElementById('toast').classList.contains('show'));
        const alignTop = selector => page.locator(selector).evaluate(node => window.scrollTo({ top: window.scrollY + node.getBoundingClientRect().top - 92, behavior: 'instant' }));
        await alignTop('#scoreBulkTools');
        await page.screenshot({ path: path.join(output, 'score-bulk-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await alignTop('#scoreBulkTools');
        const mobile = await page.locator('#scoreBulkTools').evaluate(bar => ({
            width: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
            controls: [...bar.querySelectorAll('button,input,select')].filter(node => node.offsetWidth && !node.hidden).map(node => {
                const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right };
            })
        }));
        assert(mobile.scrollWidth <= mobile.width + 1, 'Admin score page fits the mobile viewport');
        assert(mobile.bodyWidth <= mobile.width + 1, 'Admin body has no horizontal overflow on a phone');
        assert(mobile.controls.every(rect => rect.left >= 0 && rect.right <= mobile.width + 1), 'Bulk controls remain fully within the phone viewport');
        await page.screenshot({ path: path.join(output, 'score-bulk-mobile.png') });
        await page.locator('#scoreBulkTools').screenshot({ path: path.join(output, 'score-bulk-editor-mobile.png') });
        await alignTop(`[data-score-row="${scoreId(1)}"]`);
        await page.screenshot({ path: path.join(output, 'score-quick-toggles-mobile.png') });

        const mobileRows = [];
        for (const width of [390, 320]) {
            await page.setViewportSize({ width, height: 844 });
            const geometry = await page.locator('#scoreAdminRows').evaluate(body => {
                const wrap = body.closest('.exam-table-wrap');
                const table = body.closest('table');
                const rect = element => {
                    const box = element.getBoundingClientRect();
                    return { left: box.left, right: box.right, width: box.width };
                };
                return { viewport: innerWidth, wrap: { ...rect(wrap), scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth },
                    table: { ...rect(table), scrollWidth: table.scrollWidth, clientWidth: table.clientWidth },
                    rows: [...body.rows].map(row => {
                        const cell = row.cells[2], range = document.createRange();
                        range.selectNodeContents(cell);
                        const text = range.getBoundingClientRect();
                        return { id: row.dataset.scoreRow, ...rect(row), scrollWidth: row.scrollWidth, clientWidth: row.clientWidth,
                            scoreCell: rect(cell), scoreText: { left: text.left, right: text.right },
                            controls: [...row.querySelectorAll('button,input')].map(rect) };
                    }) };
            });
            mobileRows.push(geometry);
            if (width === 320) {
                await alignTop(`[data-score-row="${scoreId(1)}"]`);
                await page.screenshot({ path: path.join(output, 'score-quick-toggles-mobile-320.png') });
            }
        }

        await page.setViewportSize({ width: 1440, height: 1000 });
        await check(2).check();
        start = state.writes.length;
        state.authLoss = true;
        await page.click('#scoreBulkApply');
        await page.waitForFunction(() => document.getElementById('adminPanel').classList.contains('hidden'));
        assert.equal(state.writes.length, start + 1, 'Loss of the admin session stops a batch before the next selected row');
        assert.equal(await page.locator('#scoreAdminRows [data-score-select]').count(), 0);
        await selectedCount(0, 0);
        assert(await page.locator('#scoreBulkApply').isDisabled(), 'Auth loss clears selection and disables batch mutations');

        // An old request may finish after logout and a fresh login. The new session
        // must be usable immediately, and the old completion must not unlock it.
        await page.evaluate(() => { window.scoreBulkTest.responses = []; window.scoreBulkTest.signIn(); });
        await settled();
        await selectedCount(0, 21);
        const holdWrite = number => {
            let release;
            state.holds.set(scoreId(number), new Promise(resolve => { release = resolve; }));
            return release;
        };
        const releaseOld = holdWrite(3);
        const oldCachedImage = row(3).show_image;
        await check(3).check();
        await field('show_image').selectOption(String(!oldCachedImage));
        await page.click('#scoreBulkApply');
        await page.waitForFunction(id => window.scoreBulkTest.pendingWrites.includes(id), scoreId(3));
        assert(await page.locator('#scoreBulkApply').isDisabled());
        await page.evaluate(() => window.scoreBulkTest.signOut());
        await page.waitForFunction(() => document.getElementById('adminPanel').classList.contains('hidden'));
        await page.evaluate(() => window.scoreBulkTest.signIn());
        await settled();
        await selectedCount(0, 21);
        assert(!(await page.locator('#scoreBulkSelectAll').isDisabled()), 'A new admin session can select students while the old session request is still pending');
        await check(4).check();
        await check(5).check();
        await selectedCount(2, 21);
        await field('score').fill('8,75');
        const releaseNew = holdWrite(4);
        start = state.writes.length;
        await page.click('#scoreBulkApply');
        await page.waitForFunction(id => window.scoreBulkTest.pendingWrites.includes(id), scoreId(4));
        const newSession = await page.evaluate(() => window.examScoreAdmin.getState().epoch);
        releaseOld();
        await page.waitForFunction(id => window.scoreBulkTest.responses.includes(id), scoreId(3));
        const whileNewPending = await page.evaluate(id => {
            const state = window.examScoreAdmin.getState();
            return { epoch: state.epoch, busy: state.busy, oldImage: state.records.find(row => row.id === id).show_image,
                toolbarBusy: document.getElementById('scoreBulkTools').getAttribute('aria-busy') };
        }, scoreId(3));
        assert.equal(whileNewPending.epoch, newSession);
        assert.equal(whileNewPending.busy, true, 'Completion from the old session cannot clear the new session mutation lock');
        assert.equal(whileNewPending.toolbarBusy, 'true');
        assert.equal(whileNewPending.oldImage, oldCachedImage, 'The stale response cannot overwrite records loaded by the new session');
        await selectedCount(2, 21);
        assert(await check(4).isChecked() && await check(5).isChecked(), 'The old completion cannot change the new selection');
        assert(await page.locator('#scoreBulkFields').evaluate(fieldset => fieldset.disabled), 'The new batch keeps its fieldset locked after an old response arrives');
        assert(await page.locator('#scoreBulkApply').isDisabled());
        assert.equal(await field('score').inputValue(), '8,75', 'The old completion cannot reset the new bulk edit');
        releaseNew();
        await settled();
        assert.deepEqual(writeIds(start), [scoreId(4), scoreId(5)], 'The new session completes exactly its selected batch after the stale request finishes');
        assert.equal(row(4).score, 8.75);
        assert.equal(row(5).score, 8.75);
        await selectedCount(0, 21);
        assert.match(await page.locator('#scoreBulkStatus').textContent(), /Đã cập nhật 2 bài thi/);

        for (const geometry of mobileRows) {
            assert(geometry.wrap.scrollWidth <= geometry.wrap.clientWidth + 1, `Score table has no hidden horizontal overflow at ${geometry.viewport}px`);
            for (const record of geometry.rows) {
                assert(record.left >= geometry.wrap.left - 1 && record.right <= geometry.wrap.right + 1, 'Every student row stays inside its visible table container');
                assert(record.scoreText.left >= record.left - 1 && record.scoreText.right <= Math.min(record.right, geometry.wrap.right) + 1, `The entire score is visible for ${record.id} at ${geometry.viewport}px`);
                assert(record.controls.every(control => control.left >= record.left - 1 && control.right <= Math.min(record.right, geometry.wrap.right) + 1), 'Every row control remains fully visible');
            }
        }

        for (const [index, event] of state.events.entries()) if (event.kind === 'storage') {
            assert(state.events.slice(0, index).some(previous => previous.kind === 'database' && previous.action === 'delete'), 'File cleanup follows a confirmed database deletion');
        }
        assert.deepEqual(errors, [], 'Admin score features have no uncaught JavaScript errors');
        console.log('PASS: score page/all-filtered selection, pagination, exact field patches, independent quick privacy toggles, partial failure and rollback, validation, safe deletion, auth-loss cancellation and overlapping re-login, and desktop/mobile layout (isolated browser).');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

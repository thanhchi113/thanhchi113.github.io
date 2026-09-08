const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const self = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';

function mockSdk() {
    const mock = window.accountMock = {
        signedIn: false, admin: true, calls: [], authLocked: false, lockViolations: 0, sessionError: false,
        accounts: [
            { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test', is_current: true },
            { id: '00000000-0000-4000-8000-000000000002', email: '<img src=x onerror=alert(1)>@example.test', is_current: false }
        ]
    };
    const user = { id: mock.accounts[0].id, email: mock.accounts[0].email };
    mock.scores = Array.from({ length: 12 }, (_, index) => ({ id: `score-${index + 1}`, student_name: `Học sinh ${index + 1}`, score: 8, period: 'gk1', grade: 12, class_name: '12A1', school_year: '2026-2027', published: true, hide_student_name: false, created_at: '2026-09-08T00:00:00Z' }));
    let callback;
    mock.emit = event => {
        mock.authLocked = true;
        const result = callback?.(event, mock.signedIn ? { user } : null);
        if (result && typeof result.then === 'function') mock.lockViolations++;
        mock.authLocked = false;
    };
    const client = {
        auth: {
            async getUser() {
                if (mock.authLocked) { mock.lockViolations++; throw new Error('Auth lock reentry'); }
                if (mock.throwGetUser) throw new Error('Connection failed');
                const snapshot = { data: { user: mock.signedIn ? user : null }, error: null };
                if (mock.holdGetUser) await new Promise(resolve => { mock.resumeUser = resolve; });
                return snapshot;
            },
            onAuthStateChange(fn) { callback = fn; queueMicrotask(() => mock.emit('INITIAL_SESSION')); return { data: { subscription: { unsubscribe() {} } } }; },
            async signInWithPassword(input) {
                mock.calls.push(['login', input.email]);
                if (input.password !== 'current-test-only') return { error: { code: 'invalid_credentials' } };
                mock.signedIn = true; mock.emit('SIGNED_IN'); return { data: { user }, error: null };
            },
            async resetPasswordForEmail(email, options) {
                mock.calls.push(['forgot', email, options]); return { error: mock.forgotError ? { status: 429 } : null };
            },
            async updateUser(input) { mock.calls.push(['password', input.password]); mock.emit('USER_UPDATED'); return { error: mock.updateError ? { code: 'weak_password' } : null }; },
            async signOut() { mock.calls.push(['signout']); mock.signedIn = false; mock.emit('SIGNED_OUT'); return { error: null }; },
            async setSession() { mock.calls.push(['session']); mock.signedIn = !mock.sessionError; return { error: mock.sessionError ? new Error('expired') : null }; },
            async verifyOtp(input) { mock.calls.push(['otp', input.type]); mock.signedIn = true; return { error: null }; },
            async exchangeCodeForSession(code) { mock.calls.push(['code', code]); mock.signedIn = true; return { error: null }; }
        },
        async rpc(name, args) {
            mock.calls.push(['rpc', name, args]);
            if (name === 'current_user_is_admin') {
                const snapshot = { data: mock.admin, error: null };
                if (mock.holdRole) await new Promise(resolve => { mock.resumeRole = resolve; });
                return snapshot;
            }
            if (name === 'list_admin_accounts') return { data: mock.accounts, error: mock.listError ? { code: 'PGRST202' } : null };
            if (name === 'revoke_admin_access') {
                if (args.target_user_id === user.id || !mock.admin) return { error: { code: '42501' } };
                mock.accounts = mock.accounts.filter(account => account.id !== args.target_user_id);
                return { data: true, error: null };
            }
            return { data: [], error: null };
        },
        from(table) {
            let start = 0, end = 9999, id, action = null, payload;
            const finish = () => {
                if (table !== 'exam_scores') return { data: [], error: null };
                if (!action) return { data: mock.scores.slice(start, end + 1), error: null };
                mock.calls.push(['score-write', action, payload]);
                let row;
                if (action === 'insert') { row = { id: `score-${mock.scores.length + 1}`, ...payload, created_at: '2026-09-08T00:00:00Z' }; mock.scores.unshift(row); }
                else { row = mock.scores.find(item => item.id === id); Object.assign(row, payload); }
                return { data: { id: row.id }, error: null };
            };
            const query = new Proxy({}, { get: (_, key) => {
                if (key === 'then') return resolve => resolve(finish());
                if (key === 'single') return async () => finish();
                return (...args) => {
                    if (key === 'range') [start, end] = args;
                    if (key === 'eq' && args[0] === 'id') id = args[1];
                    if (['insert', 'update'].includes(key)) { action = key; payload = args[0]; }
                    return query;
                };
            } });
            return query;
        },
        storage: { from(bucket) { return {
            getPublicUrl() { return { data: { publicUrl: '' } }; },
            async createSignedUrl() { return { data: { signedUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=' }, error: null }; },
            async upload(path) { mock.calls.push(['upload', bucket, path]); return { error: null }; },
            async remove() { return { error: null }; }
        }; } }
    };
    window.supabase = { createClient: (_, __, options) => { mock.options = options; return client; } };
}

async function waitText(page, selector, text) {
    try { await page.waitForFunction(([selector, text]) => document.querySelector(selector)?.textContent.includes(text), [selector, text]); }
    catch (error) { throw new Error(`${selector}: expected ${text}, got ${await page.locator(selector).textContent()}`, { cause: error }); }
}

(async () => {
    for (const name of ['admin.html', 'reset-password.html']) {
        const html = fs.readFileSync(path.join(root, name), 'utf8');
        for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (match[1].trim()) new Function(match[1]);
    }
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript(() => { if (!crypto.randomUUID) crypto.randomUUID = () => '00000000-0000-4000-8000-000000000099'; });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.host === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
            if (url.origin !== 'http://account.test') return route.abort();
            const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
            const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
            return route.fulfill({ contentType: types[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
        });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://account.test/admin.html#admin-account');
        await page.locator('#accountRecoveryRequest summary').click();
        await page.fill('#accountForgotEmail', 'admin@example.test');
        await page.click('#accountForgotSubmit');
        await waitText(page, '#accountForgotStatus', 'Nếu email này');
        assert.deepEqual(await page.evaluate(() => accountMock.calls.find(call => call[0] === 'forgot')), ['forgot', 'admin@example.test', { redirectTo: 'http://account.test/reset-password.html' }]);
        await page.evaluate(() => { accountMock.forgotError = true; });
        await page.click('#accountForgotSubmit');
        await waitText(page, '#accountForgotStatus', 'giới hạn');
        await page.fill('#loginEmail', 'admin@example.test');
        await page.fill('#loginPassword', 'current-test-only');
        await page.click('#loginForm button[type=submit]');
        await page.waitForSelector('#accountWorkspace.active .account-member');
        assert.equal(await page.locator('.account-member').count(), 2);
        assert.equal(await page.locator('.account-member img').count(), 0);
        assert(await page.locator(`[data-revoke-account="${self}"]`).isDisabled());

        await page.fill('#accountCurrentPassword', 'wrong-current');
        await page.fill('#accountNewPassword', 'new-test-only');
        await page.fill('#accountConfirmPassword', 'new-test-only');
        await page.click('#accountPasswordForm button');
        await waitText(page, '#accountPasswordStatus', 'Không xác minh');
        assert.equal(await page.evaluate(() => accountMock.calls.filter(call => call[0] === 'password').length), 0);
        await page.fill('#accountCurrentPassword', 'current-test-only');
        await page.click('#accountPasswordForm button');
        await waitText(page, '#accountPasswordStatus', 'Đã cập nhật');
        assert.equal(await page.inputValue('#accountNewPassword'), '');
        assert.equal(await page.inputValue('#accountCurrentPassword'), '');
        assert.equal(await page.evaluate(() => accountMock.lockViolations), 0);

        await page.click(`[data-revoke-account="${other}"]`);
        await page.click('#accountRevokeCancel');
        assert.equal(await page.evaluate(() => accountMock.calls.filter(call => call[1] === 'revoke_admin_access').length), 0);
        await page.click(`[data-revoke-account="${other}"]`);
        await page.click('#accountRevokeConfirm');
        await waitText(page, '#accountListStatus', 'Đã thu hồi');
        assert.equal(await page.locator('.account-member').count(), 1);
        assert.deepEqual(await page.evaluate(() => accountMock.calls.find(call => call[1] === 'revoke_admin_access')[2]), { target_user_id: other });
        for (const width of [1440, 900, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No horizontal overflow at ${width}`);
        }
        await page.evaluate(() => { accountMock.listError = true; });
        await page.click('#accountRefresh');
        await waitText(page, '#accountListStatus', 'chưa được kích hoạt');
        await page.evaluate(() => { accountMock.signedIn = false; accountMock.emit('SIGNED_OUT'); });
        await page.waitForSelector('#adminPanel.hidden', { state: 'attached' });
        assert.equal(await page.locator('#accountList').textContent(), '');

        // Responses started before sign-out cannot restore the admin panel.
        for (const [hold, resume] of [['holdGetUser', 'resumeUser'], ['holdRole', 'resumeRole']]) {
            await page.evaluate(hold => { accountMock[hold] = true; accountMock.signedIn = true; accountMock.emit('SIGNED_IN'); }, hold);
            await page.waitForFunction(resume => typeof accountMock[resume] === 'function', resume);
            await page.evaluate(([hold, resume]) => {
                accountMock.signedIn = false;
                accountMock.emit('SIGNED_OUT');
                accountMock[hold] = false;
                accountMock[resume]();
            }, [hold, resume]);
            await page.waitForFunction(() => adminCheckPromise === null && adminCheckTimer === null);
            assert(await page.locator('#adminPanel').isHidden());
            assert.equal(await page.locator('#accountList').textContent(), '');
        }
        await page.evaluate(() => { accountMock.listError = false; accountMock.signedIn = true; accountMock.emit('SIGNED_IN'); });
        await page.waitForSelector('#accountWorkspace.active .account-member');
        await page.click('[data-workspace-tab="scores"]');
        assert.equal(await page.locator('#scoreForm #scoreSubmissionAdmin').count(), 0);
        assert.equal(await page.locator('#scoresWorkspace #scoreSubmissionAdmin').count(), 1);
        await page.waitForFunction(() => document.querySelector('#scoreSubmissionAdmin').getAttribute('aria-busy') === 'false');
        await page.waitForSelector('#scoreFormFields:not([disabled])');
        assert.equal(await page.locator('#scoreEntryNumber').textContent(), '13');
        assert.deepEqual(await page.locator('.exam-record-number').allTextContents(), ['1','2','3','4','5','6','7','8','9','10']);
        await page.click('#scoreAdminPagination [data-page="2"]');
        assert.deepEqual(await page.locator('.exam-record-number').allTextContents(), ['11','12']);
        await page.click('[data-score-action="edit"][data-score-id="score-12"]');
        assert.equal(await page.locator('#scoreEntryNumber').textContent(), '12');
        await page.fill('#scoreStudentName', '');
        await page.click('#scoreSaveBtn');
        assert.equal(await page.evaluate(() => accountMock.calls.filter(call => call[0] === 'score-write').length), 0);
        await page.click('#scoreResetBtn');
        assert.equal(await page.locator('#scoreEntryNumber').textContent(), '13');
        await page.fill('#scoreStudentName', 'Nguyễn Minh Anh');
        await page.fill('#scoreClass', '12A2');
        await page.fill('#scoreValue', '9,25');
        await page.locator('#scoreImageInput').setInputFiles({ name: 'score-proof.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64') });
        await page.waitForSelector('#scorePreviewImage:not([hidden])');
        await page.check('#scoreHideName');
        assert.equal(await page.locator('#scorePreviewName').textContent(), 'Tên học sinh');
        assert.equal(await page.locator('#scorePreviewName').getAttribute('aria-label'), 'Tên học sinh đã được ẩn');
        assert.equal(await page.locator('#scorePreviewName').evaluate(element => getComputedStyle(element).filter), 'blur(4px)');
        assert(await page.locator('#scorePreviewImage').isHidden());
        assert.equal(await page.inputValue('#scoreStudentName'), 'Nguyễn Minh Anh');
        assert.equal(await page.locator('#scoreImageInput').evaluate(input => input.files[0].name), 'score-proof.png');
        await page.click('#scoreSaveBtn');
        await waitText(page, '#scoreFormStatus', 'Đã lưu điểm thi');
        assert.deepEqual(await page.evaluate(() => ({ name: accountMock.scores[0].student_name, hidden: accountMock.scores[0].hide_student_name, published: accountMock.scores[0].published, image: accountMock.scores[0].evidence_image_name })), { name: 'Nguyễn Minh Anh', hidden: true, published: true, image: 'score-proof.png' });
        assert(!(await page.locator('#scoreHideName').isChecked()));
        assert.equal(await page.locator('#scoreEntryNumber').textContent(), '14');
        await page.click('[data-score-action="edit"][data-score-id="score-13"]');
        assert(await page.locator('#scoreHideName').isChecked());
        assert.equal(await page.inputValue('#scoreStudentName'), 'Nguyễn Minh Anh');
        await page.uncheck('#scoreHideName');
        await page.waitForSelector('#scorePreviewImage:not([hidden])');
        assert.equal(await page.locator('#scorePreviewName').textContent(), 'Nguyễn Minh Anh');
        await page.check('#scoreHideName');
        await page.uncheck('#scorePublished');
        await page.click('#scoreSaveBtn');
        await waitText(page, '#scoreFormStatus', 'Đã lưu điểm thi');
        assert.deepEqual(await page.evaluate(() => ({ hidden: accountMock.scores[0].hide_student_name, published: accountMock.scores[0].published })), { hidden: true, published: false });
        assert.equal(await page.locator('#scoreAdminRows .exam-record-name').first().textContent(), 'Nguyễn Minh Anh');
        assert.equal(await page.locator('#scoreAdminRows .exam-record-privacy').first().textContent(), 'Ẩn tên và ảnh');
        await page.evaluate(() => { accountMock.throwGetUser = true; accountMock.emit('USER_UPDATED'); });
        await page.waitForSelector('#adminPanel.hidden', { state: 'attached' });
        await waitText(page, '#loginStatus', 'Chưa kết nối');
        assert.equal(await page.evaluate(() => accountMock.lockViolations), 0);

        for (const suffix of ['#access_token=example&refresh_token=example&type=recovery', '?code=example-code', '?token_hash=example-hash&type=recovery']) {
            await page.goto(`http://account.test/reset-password.html${suffix}`);
            await page.waitForSelector('#recoveryForm:not([hidden])');
            assert.equal(page.url(), 'http://account.test/reset-password.html');
            await page.fill('#recoveryPassword', 'new-test-only');
            await page.fill('#recoveryConfirmation', 'new-test-only');
            await page.click('#recoverySubmit');
            await waitText(page, '#recoveryStatus', 'Đã đặt lại mật khẩu');
            assert(await page.locator('#recoveryForm').isHidden());
            assert(await page.evaluate(() => accountMock.calls.some(call => call[0] === 'signout')));
        }
        await page.goto('about:blank');
        await page.goto('http://account.test/reset-password.html#error=access_denied&error_code=otp_expired&type=recovery');
        await waitText(page, '#recoveryStatus', 'không hợp lệ');
        assert(await page.locator('#recoveryForm').isHidden());
        assert.equal(await page.evaluate(() => accountMock.calls.length), 0);
        await page.goto('about:blank');
        await page.goto('http://account.test/reset-password.html');
        await waitText(page, '#recoveryStatus', 'không hợp lệ');
        assert(await page.locator('#recoveryForm').isHidden());
        assert.deepEqual(errors, []);
        console.log('PASS: isolated account UI, auth lock, recovery, password verification, role revocation, escaping, mobile layout');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

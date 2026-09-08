const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const origin = 'http://password.test';

function mockClient() {
    const state = window.passwordVisibilityMock = { logins: 0, updates: 0, signouts: 0, loginSubmits: 0 };
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test' };
    window.visibilityClient = {
        auth: {
            async getUser() { return { data: { user }, error: null }; },
            async signInWithPassword(input) {
                state.logins++;
                return input.password === 'Current-test-only!' ? { data: { user }, error: null } : { error: { code: 'invalid_credentials' } };
            },
            async updateUser() { state.updates++; return { error: null }; },
            async signOut() { state.signouts++; return { error: null }; },
            async setSession() { return { error: null }; },
            async exchangeCodeForSession() { return { error: null }; },
            async verifyOtp() { return { error: null }; },
            async resetPasswordForEmail() { throw new Error('This visibility test must never send mail'); }
        },
        async rpc(name) { return { data: name === 'current_user_is_admin' ? true : [{ ...user, is_current: true }], error: null }; }
    };
    window.supabase = { createClient: () => window.visibilityClient };
}

async function assertMasked(page, ids) {
    for (const id of ids) {
        assert.equal(await page.locator(`#${id}`).getAttribute('type'), 'password');
        assert.equal(await page.locator(`[data-password-toggle="${id}"]`).getAttribute('aria-pressed'), 'false');
    }
}
async function reveal(page, id) {
    const button = page.locator(`[data-password-toggle="${id}"]`);
    assert.equal(await button.count(), 1);
    assert.equal(await button.getAttribute('type'), 'button');
    assert.equal(await button.getAttribute('aria-controls'), id);
    await button.focus();
    await button.press('Enter');
    assert.equal(await page.locator(`#${id}`).getAttribute('type'), 'text');
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.match(await button.getAttribute('aria-label'), /^Ẩn mật khẩu/);
    assert.equal(await page.locator(`#${id}`).getAttribute('value'), null, 'Typed passwords must not be copied into value attributes');
}

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) {
                if (url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: '' });
                return route.abort();
            }
            const file = path.join(root, decodeURIComponent(url.pathname));
            if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
            const contentType = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html';
            return route.fulfill({ contentType, body: fs.readFileSync(file) });
        });
        await context.addInitScript(mockClient);
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${origin}/reset-password.html`);
        const loginForm = fs.readFileSync(path.join(root, 'admin.html'), 'utf8').match(/<form id="loginForm"[\s\S]*?<\/form>/)[0];
        await page.setContent(`<html lang="vi"><head><link rel="stylesheet" href="${origin}/assets/admin-account.css"><style>body{margin:20px;background:#081321;color:white;font-family:Arial,sans-serif}.admin-form{display:grid;gap:14px;max-width:430px}.admin-form input{box-sizing:border-box;width:100%;height:45px;padding:0 12px}.admin-form label{display:block}</style></head><body>${loginForm}<div id="adminPanel"><section id="accountWorkspace"></section></div></body></html>`);
        await page.addScriptTag({ path: path.join(root, 'assets/admin-account.js') });
        await page.evaluate(() => {
            delete window.adminAccount;
            AdminAccount.init(visibilityClient);
            document.getElementById('loginForm').addEventListener('submit', event => { event.preventDefault(); passwordVisibilityMock.loginSubmits++; });
        });
        const changeFields = ['accountCurrentPassword', 'accountNewPassword', 'accountConfirmPassword'];
        await assertMasked(page, ['loginPassword', ...changeFields]);
        await page.fill('#loginEmail', 'admin@example.test');
        await page.fill('#loginPassword', 'Login-test-only!');
        await reveal(page, 'loginPassword');
        assert.equal(await page.inputValue('#loginPassword'), 'Login-test-only!');
        assert.equal(await page.evaluate(() => passwordVisibilityMock.loginSubmits), 0, 'The eye button must not submit login');
        assert(!(await page.locator('body').textContent()).includes('Login-test-only!'), 'Typed values must not be copied into labels or page text');
        await page.locator('[data-password-toggle="loginPassword"]').press('Space');
        await assertMasked(page, ['loginPassword']);
        await reveal(page, 'loginPassword');
        await page.locator('#loginForm button[type=submit]').click();
        await assertMasked(page, ['loginPassword']);
        assert.equal(await page.evaluate(() => passwordVisibilityMock.loginSubmits), 1);
        assert.equal(await page.evaluate(() => passwordVisibilityMock.logins + passwordVisibilityMock.updates), 0);

        await page.fill('#accountCurrentPassword', 'Current-test-only!');
        await page.fill('#accountNewPassword', 'New-test-only!');
        await page.fill('#accountConfirmPassword', 'Mismatch-test-only!');
        for (const id of changeFields) await reveal(page, id);
        await page.locator('#accountPasswordForm button[type=submit]').click();
        await assertMasked(page, changeFields);
        assert.match(await page.locator('#accountPasswordStatus').textContent(), /chưa trùng nhau/);
        assert.equal(await page.evaluate(() => passwordVisibilityMock.updates), 0);
        await page.fill('#accountConfirmPassword', 'New-test-only!');
        for (const id of changeFields) await reveal(page, id);
        await page.locator('#accountPasswordForm button[type=submit]').click();
        await page.waitForFunction(() => document.getElementById('accountPasswordStatus').textContent.includes('Đã cập nhật'));
        await assertMasked(page, changeFields);
        assert.equal(await page.evaluate(() => passwordVisibilityMock.updates), 1);
        for (const id of changeFields) assert.equal(await page.inputValue(`#${id}`), '');

        await page.fill('#accountCurrentPassword', 'Current-test-only!');
        await reveal(page, 'accountCurrentPassword');
        await page.evaluate(() => document.getElementById('accountPasswordForm').reset());
        await assertMasked(page, changeFields);
        await reveal(page, 'loginPassword');
        await reveal(page, 'accountCurrentPassword');
        await page.evaluate(() => adminAccount.clear());
        await assertMasked(page, ['loginPassword', ...changeFields]);
        await page.evaluate(() => AdminAccount.enhancePasswordInputs());
        assert.equal(await page.locator('[data-password-toggle]').count(), 4, 'Reinitializing must not duplicate controls');
        await page.setViewportSize({ width: 390, height: 844 });
        assert(await page.evaluate(() => [...document.querySelectorAll('.account-password-control')].every(element => element.getBoundingClientRect().right <= innerWidth && element.scrollWidth <= element.clientWidth + 1)));
        assert(Number.parseFloat(await page.locator('#loginPassword').evaluate(input => getComputedStyle(input).paddingRight)) >= 50, 'Typed text needs space beside the eye');

        await page.goto('about:blank');
        await page.goto(`${origin}/reset-password.html#access_token=test-only&refresh_token=test-only&type=recovery`);
        await page.locator('#recoveryForm:not([hidden])').waitFor();
        const recoveryFields = ['recoveryPassword', 'recoveryConfirmation'];
        await assertMasked(page, recoveryFields);
        for (const id of recoveryFields) { await page.fill(`#${id}`, 'Recovery-test-only!'); await reveal(page, id); }
        assert.equal(await page.evaluate(() => passwordVisibilityMock.updates), 0, 'Visibility controls must not call Auth');
        await page.locator('#recoverySubmit').click();
        await page.waitForFunction(() => document.getElementById('recoveryStatus').textContent.includes('Đã đặt lại mật khẩu'));
        await assertMasked(page, recoveryFields);
        assert(await page.locator('#recoveryForm').isHidden());
        assert.equal(await page.evaluate(() => passwordVisibilityMock.updates), 1);
        assert.equal(await page.evaluate(() => passwordVisibilityMock.signouts), 1);
        for (const id of recoveryFields) assert.equal(await page.inputValue(`#${id}`), '');
        assert.deepEqual(errors, []);
        console.log('PASS: all six password eye buttons, keyboard/ARIA, no submit/API side effects, preserved typed values, masked submit/reset/clear, recovery success and mobile control layout');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

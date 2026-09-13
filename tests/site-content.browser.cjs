const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');

function mockSdk() {
    let signedIn = true;
    const callbacks = [];
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.test' };
    window.contentAuth = {
        emit(active) {
            signedIn = active;
            callbacks.forEach(callback => callback(active ? 'SIGNED_IN' : 'SIGNED_OUT', active ? { user } : null));
        }
    };
    const client = {
        auth: {
            async getUser() { return { data: { user: signedIn ? user : null }, error: null }; },
            onAuthStateChange(callback) { callbacks.push(callback); return { data: { subscription: { unsubscribe() {} } } }; },
            async signOut() { window.contentAuth.emit(false); return { error: null }; }
        },
        async rpc(name) { return { data: name === 'current_user_is_admin' ? signedIn : [], error: null }; },
        from(table) {
            const request = { table, action: 'read', filters: {} };
            const finish = () => window.configurationRequest(request);
            const query = new Proxy({}, { get: (_, key) => {
                if (key === 'then') return (resolve, reject) => finish().then(resolve, reject);
                if (key === 'single' || key === 'maybeSingle') return finish;
                return (...args) => {
                    if (key === 'eq') request.filters[args[0]] = args[1];
                    if (['insert', 'update', 'delete', 'upsert'].includes(key)) { request.action = key; request.payload = args[0]; }
                    return query;
                };
            } });
            return query;
        },
        storage: { from() { return { getPublicUrl() { return { data: { publicUrl: '' } }; } }; } }
    };
    window.supabase = { createClient: () => client };
}

async function waitStatus(page, text) {
    await page.waitForFunction(text => document.querySelector('[data-content-status]')?.textContent.includes(text), text);
}

(async () => {
    const state = {
        value: {}, version: 1, writes: [], failSave: false, holdLoad: false,
        row() { return { value: structuredClone(this.value), updated_at: `2026-09-13T00:00:${String(this.version).padStart(2, '0')}.000000+00:00` }; }
    };
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' });
        await context.exposeBinding('configurationRequest', async (_, request) => {
            if (request.table !== 'site_configuration') return { data: [], error: null };
            if (request.filters.id === 'score_options') return { data: { value: {}, updated_at: '2026-09-13T00:00:01.000000+00:00' }, error: null };
            assert.equal(request.filters.id, 'site_content');
            if (request.action === 'read') {
                const snapshot = { data: state.row(), error: null };
                if (state.holdLoad) await new Promise(resolve => { state.resumeLoad = resolve; });
                return snapshot;
            }
            assert.equal(request.action, 'update', 'The editor uses update-only configuration access');
            assert.deepEqual(Object.keys(request.payload), ['value']);
            state.writes.push(structuredClone(request));
            if (state.failSave) return { data: null, error: { message: 'Lỗi kết nối thử nghiệm' } };
            if (request.filters.updated_at !== state.row().updated_at) return { data: null, error: null };
            state.value = structuredClone(request.payload.value); state.version++;
            return { data: state.row(), error: null };
        });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.host === 'cdn.jsdelivr.net' && url.pathname.includes('@supabase/supabase-js@')) return route.fulfill({ contentType: 'application/javascript', body: `(${mockSdk.toString()})();` });
            if (url.origin !== 'https://content.test') return route.abort();
            const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
            const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
            return route.fulfill({ contentType: types[path.extname(file)] || 'text/plain', body: fs.readFileSync(file) });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('https://content.test/admin.html#admin-content');
        await waitStatus(page, 'Đã tải nội dung');
        const field = key => page.locator(`[name="${key}"]`);
        const preview = page.frameLocator('[data-content-preview]');
        await preview.locator('.about-content h3').waitFor();
        const sourceFields = await page.evaluate(async () => {
            const text = await (await fetch('index.html')).text();
            return SiteContent.schema(new DOMParser().parseFromString(text, 'text/html'));
        });
        for (const key of ['about.paragraph1', 'about.highlight1.number', 'skills.skill1.name', 'skills.skill1.percent', 'home.nameFirst', 'contact.item1.url']) {
            assert(sourceFields.some(item => item.key === key), `Existing ${key} is available to edit`);
        }
        for (const id of ['home', 'about', 'skills', 'projects', 'documents', 'achievements', 'contact', 'tikz-library', 'material-request']) {
            const visibility = sourceFields.find(item => item.key === `${id}.visible`);
            assert.equal(visibility?.kind, 'boolean', `${id} has an explicit visibility setting`);
            assert.equal(visibility.defaultValue, true, `${id} stays enabled for existing configurations`);
        }
        assert.equal(sourceFields.filter(item => item.kind === 'percent').length, 6, 'All six existing skill percentages are extracted');
        const initialAbout = sourceFields.find(item => item.key === 'about.paragraph1').defaultValue;
        assert.equal(await field('about.paragraph1').inputValue(), initialAbout);
        assert(initialAbout.length > 40);
        await field('about.paragraph1').fill('Giới thiệu đã chỉnh sửa từ trang quản trị.');
        await field('about.highlight1.number').fill('240+');
        try { await preview.locator('.about-content > p').first().filter({ hasText: 'Giới thiệu đã chỉnh sửa' }).waitFor(); }
        catch (error) {
            console.error('Preview state', await page.evaluate(() => {
                const frame = document.querySelector('[data-content-preview]');
                return { src: frame.src, text: frame.contentDocument.querySelector('.about-content > p')?.textContent,
                    api: !!frame.contentWindow.SiteContent, inputs: document.querySelector('[name="about.paragraph1"]').value };
            }), errors);
            throw error;
        }
        assert.equal(await preview.locator('.highlight-number').first().textContent(), '240+');
        assert.equal(state.writes.length, 0, 'Typing and preview never publish content');
        await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
        await page.screenshot({ path: path.join(root, '../../site-content-desktop.png') });

        await page.selectOption('#siteContentSection', 'skills');
        await field('skills.skill1.name').fill('Tư duy Toán học');
        await field('skills.skill1.percent').fill('73.5');
        await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelector('.skill-progress').style.getPropertyValue('--progress') === '73.5%');
        assert.equal(await preview.locator('.skill-percent').first().textContent(), '73.5%');
        await page.click('[data-content-save]');
        await waitStatus(page, 'Đã lưu.');
        assert.equal(state.value['skills.skill1.percent'], 73.5);
        assert.equal(state.value['about.highlight1.number'], '240+');
        assert.equal(state.writes.length, 1);

        const publicPage = await context.newPage();
        publicPage.on('pageerror', error => errors.push(error.message));
        await publicPage.goto('https://content.test/index.html#skills');
        await publicPage.waitForFunction(() => document.querySelector('.skill-percent').textContent === '73.5%');
        assert.equal(await publicPage.locator('.about-content > p').first().textContent(), state.value['about.paragraph1']);
        assert.equal(await publicPage.locator('.skill-progress').first().evaluate(node => node.style.getPropertyValue('--progress')), '73.5%');
        assert(await publicPage.locator('#skills').isVisible(), 'A missing visibility flag preserves the original section');

        // Visibility is a reversible draft setting; hiding a section never discards its edited content.
        const beforeVisibilityWrites = state.writes.length;
        assert.equal(await field('skills.visible').getAttribute('role'), 'switch');
        assert(await field('skills.visible').isChecked());
        await field('skills.visible').uncheck();
        await preview.locator('#skills[data-site-section-hidden="true"]').waitFor({ state: 'attached' });
        assert(!(await preview.locator('#skills').isVisible()), 'The draft preview immediately hides skills');
        assert.equal(await page.evaluate(() => new URL(document.querySelector('iframe').contentWindow.location.href).searchParams.get('admin-content-preview')), '1', 'Visibility fallback navigation preserves the protected preview mode');
        assert.equal(await preview.locator('#skills .skill-info h3').first().textContent(), 'Tư duy Toán học');
        assert.equal(state.writes.length, beforeVisibilityWrites, 'A visibility toggle does not publish until saved');
        assert.notEqual(state.value['skills.visible'], false);
        assert(await publicPage.locator('#skills').isVisible(), 'The live page is unchanged while editing the draft');
        await page.click('[data-content-undo]');
        await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelector('#skills').getAttribute('data-site-section-hidden') !== 'true');
        assert(await field('skills.visible').isChecked());
        assert(await preview.locator('#skills').isVisible());
        assert.equal(await field('skills.skill1.name').inputValue(), 'Tư duy Toán học');
        assert.equal(state.writes.length, beforeVisibilityWrites);

        await field('skills.visible').uncheck();
        await page.click('[data-content-save]');
        await waitStatus(page, 'Đã lưu.');
        assert.equal(state.value['skills.visible'], false);
        assert.equal(state.value['skills.skill1.name'], 'Tư duy Toán học');
        assert.equal(state.value['skills.skill1.percent'], 73.5);
        await publicPage.reload();
        await publicPage.locator('#skills[data-site-section-hidden="true"]').waitFor({ state: 'attached' });
        assert(!(await publicPage.locator('#skills').isVisible()));
        const skillLink = publicPage.locator('#mainMenu a[href="#skills"]');
        assert.equal(await skillLink.getAttribute('data-site-link-hidden'), 'true');
        assert.equal(await skillLink.locator('..').getAttribute('data-site-link-hidden'), 'true');
        assert(!(await skillLink.locator('..').isVisible()), 'The entire hidden navigation item leaves no menu gap');
        await publicPage.waitForFunction(() => location.hash !== '#skills' && document.querySelector('#home').getBoundingClientRect().height > 0);
        assert.equal(await publicPage.locator('#skills .skill-info h3').first().textContent(), 'Tư duy Toán học');

        await page.click('[data-content-defaults]');
        assert(await field('skills.visible').isChecked(), 'Restoring defaults also enables the section in the draft');
        await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelector('#skills').getAttribute('data-site-section-hidden') !== 'true');
        assert.equal(state.value['skills.visible'], false, 'Restoring defaults does not publish');
        assert.equal(state.value['skills.skill1.name'], 'Tư duy Toán học');
        await page.click('[data-content-undo]');
        assert(!(await field('skills.visible').isChecked()), 'Undo restores the saved hidden setting');
        assert.equal(await field('skills.skill1.name').inputValue(), 'Tư duy Toán học');
        await field('skills.visible').check();
        await page.click('[data-content-save]');
        await waitStatus(page, 'Đã lưu.');
        await publicPage.reload();
        await publicPage.waitForFunction(() => document.querySelector('#skills .skill-info h3').textContent === 'Tư duy Toán học');
        assert(await publicPage.locator('#skills').isVisible(), 'A saved toggle restores the section with its existing content');
        assert(await publicPage.locator('#mainMenu a[href="#skills"]').isVisible());
        assert.equal(state.value['skills.skill1.percent'], 73.5);
        await publicPage.close();

        // Exercise saved configurations on fresh pages without altering the editor's saved version.
        const savedVisibilityConfiguration = structuredClone(state.value);
        const routePage = await context.newPage();
        routePage.on('pageerror', error => errors.push(error.message));
        try {
            state.value = { ...savedVisibilityConfiguration, 'skills.visible': false, 'tikz-library.visible': false,
                'home.description': 'Kiểm tra đường dẫn tới mục đang ẩn.' };
            for (const hash of ['#skills', '#tikz-library', '#tikz-hidden-example']) {
                await routePage.goto(`https://content.test/index.html?visibility-case=${encodeURIComponent(hash.slice(1))}${hash}`);
                await routePage.waitForFunction(() => document.querySelector('.hero-description').textContent === 'Kiểm tra đường dẫn tới mục đang ẩn.');
                await routePage.waitForFunction(() => !['#skills', '#tikz-library', '#tikz-hidden-example'].includes(location.hash));
                assert(!(await routePage.locator('#skills').isVisible()));
                assert(!(await routePage.locator('#tikz-library').isVisible()));
                assert(!(await routePage.locator('[data-tikz-open]').isVisible()), 'The project card cannot reopen a hidden TikZ library');
                assert(await routePage.locator('#home').isVisible(), `The ${hash} deep link falls back to visible content`);
                assert.equal(await routePage.evaluate(() => document.body.classList.contains('tikz-library-mode') || document.body.classList.contains('tikz-detail-mode')), false);
            }
            state.value = { ...savedVisibilityConfiguration, 'documents.visible': false,
                'home.description': 'Kiểm tra đường dẫn tài liệu đang ẩn.' };
            for (const parameter of ['doc', 'category']) {
                await routePage.goto(`https://content.test/index.html?${parameter}=hidden-example&visibility-case=${parameter}`);
                await routePage.waitForFunction(() => document.querySelector('.hero-description').textContent === 'Kiểm tra đường dẫn tài liệu đang ẩn.');
                await routePage.waitForFunction(() => !new URL(location.href).searchParams.has('doc') && !new URL(location.href).searchParams.has('category'));
                assert(!(await routePage.locator('#documents').isVisible()), `A hidden ${parameter} deep link never opens the documents section`);
                assert(await routePage.locator('#home').isVisible(), `The ${parameter} URL without a hash still shows available content`);
                assert.equal(await routePage.locator('#pdfModal').getAttribute('aria-hidden'), 'true');
            }
            state.value = { ...savedVisibilityConfiguration, 'home.visible': false, 'projects.visible': false,
                'about.paragraph1': 'Kiểm tra đường dẫn quay lại mục đang bật.' };
            await routePage.goto('https://content.test/index.html?visibility-case=hidden-home');
            await routePage.waitForFunction(() => document.querySelector('.about-content > p').textContent === 'Kiểm tra đường dẫn quay lại mục đang bật.' && location.hash === '#about');
            assert(!(await routePage.locator('#home').isVisible()));
            assert(!(await routePage.locator('#projects').isVisible()));
            assert(await routePage.locator('#about').isVisible());
            for (const selector of ['.logo', '.back-to-top']) {
                assert.equal(new URL(await routePage.locator(selector).getAttribute('href'), routePage.url()).hash, '#about', `${selector} points to the first available section`);
            }
            await routePage.locator('#mainMenu [data-main-nav="tikz"]').click();
            await routePage.waitForFunction(() => document.body.classList.contains('tikz-library-mode') && location.hash === '#tikz-library');
            assert(await routePage.locator('#tikz-library').isVisible());
            await routePage.locator('#tikzBackButton').click();
            await routePage.waitForFunction(() => location.hash === '#about' && !document.body.classList.contains('tikz-library-mode'));
            assert(await routePage.locator('#about').isVisible(), 'Closing TikZ falls back to an enabled section when projects and home are hidden');

            state.value = { ...savedVisibilityConfiguration, 'skills.visible': 'false', 'about.visible': 0,
                'contact.visible': null, 'home.description': 'Kiểm tra cấu hình hiển thị không hợp lệ.' };
            await routePage.goto('https://content.test/index.html?visibility-case=invalid#skills');
            await routePage.waitForFunction(() => document.querySelector('.hero-description').textContent === 'Kiểm tra cấu hình hiển thị không hợp lệ.');
            for (const id of ['skills', 'about', 'contact']) {
                assert(await routePage.locator(`#${id}`).isVisible(), `${id} stays visible when its flag is not a boolean`);
            }

            state.value = { ...savedVisibilityConfiguration, 'skills.visible': false, 'achievements.visible': false };
            await routePage.goto('https://content.test/achievements.html?type=grade10');
            await routePage.locator('#mainMenu a[href="index.html#skills"][data-site-link-hidden="true"]').waitFor({ state: 'attached' });
            for (const id of ['skills', 'achievements']) {
                const link = routePage.locator(`#mainMenu a[href="index.html#${id}"]`);
                assert(!(await link.locator('..').isVisible()), `The achievements page also hides ${id} navigation`);
            }
            const back = routePage.locator('.evidence-back-link');
            assert(await back.isVisible(), 'Visitors retain a way back when the achievements section is hidden');
            assert.notEqual(new URL(await back.getAttribute('href'), routePage.url()).hash, '#achievements');
            assert.equal(await routePage.locator('a[href="index.html#scoreSubmission"]').getAttribute('data-site-link-hidden'), 'true', 'The submission invitation does not point into a hidden achievements section');
        } finally {
            state.value = savedVisibilityConfiguration;
            await routePage.close();
        }

        const beforeTikzPreviewWrites = state.writes.length;
        await page.selectOption('#siteContentSection', 'tikz-library');
        await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelector('#tikz-library').getBoundingClientRect().height > 0);
        assert(await preview.locator('#tikz-library').isVisible(), 'Selecting TikZ in the editor opens its normally separate preview view');
        await field('tikz-library.visible').uncheck();
        await preview.locator('#tikz-library[data-site-section-hidden="true"]').waitFor({ state: 'attached' });
        assert(!(await preview.locator('#tikz-library').isVisible()));
        await field('tikz-library.visible').check();
        await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelector('#tikz-library').getBoundingClientRect().height > 0);
        assert.equal(await page.evaluate(() => new URL(document.querySelector('iframe').contentWindow.location.href).searchParams.get('admin-content-preview')), '1');
        assert.equal(state.writes.length, beforeTikzPreviewWrites, 'Previewing and toggling TikZ never publishes without saving');
        await page.click('[data-content-undo]');

        // Unsafe markup stays plain text in both preview and public application.
        const markup = '<img src=x onerror="window.contentInjected=true">';
        await page.selectOption('#siteContentSection', 'about');
        await field('about.paragraph1').fill(markup);
        await preview.locator('.about-content > p').first().filter({ hasText: markup }).waitFor();
        assert.equal(await preview.locator('.about-content > p img').count(), 0);
        assert.equal(await page.evaluate(() => document.querySelector('iframe').contentWindow.contentInjected), undefined);
        await page.click('[data-content-save]');
        await waitStatus(page, 'Đã lưu.');
        const beforeInvalid = state.writes.length;
        await page.selectOption('#siteContentSection', 'contact');
        await field('contact.item1.url').fill('javascript:alert(1)');
        await page.click('[data-content-save]');
        await waitStatus(page, 'liên kết không hợp lệ');
        assert.equal(state.writes.length, beforeInvalid, 'Unsafe link fails validation before writing');
        assert(!String(await preview.locator('.contact-item').first().getAttribute('href')).startsWith('javascript:'));
        assert.equal(await field('contact.item1.url').inputValue(), 'javascript:alert(1)', 'An invalid input remains available for correction');
        await field('contact.item1.url').fill('https://example.test/contact');
        await page.click('[data-content-save]');
        await waitStatus(page, 'Đã lưu.');
        await page.selectOption('#siteContentSection', 'about');
        await field('about.paragraph1').fill('Bản sửa cần giữ khi mạng bị lỗi.');
        state.failSave = true;
        await page.click('[data-content-save]');
        await waitStatus(page, 'Lỗi kết nối thử nghiệm');
        assert.equal(await field('about.paragraph1').inputValue(), 'Bản sửa cần giữ khi mạng bị lỗi.');
        assert.equal(state.value['about.paragraph1'], markup);
        state.failSave = false;
        await page.click('[data-content-save]');
        await waitStatus(page, 'Đã lưu.');
        assert.equal(state.value['about.paragraph1'], 'Bản sửa cần giữ khi mạng bị lỗi.');

        await field('about.paragraph1').fill('Bản nháp đang làm khi admin khác lưu.');
        state.value['about.paragraph1'] = 'Nội dung đã được admin khác lưu.'; state.version++;
        await page.click('[data-content-save]');
        await waitStatus(page, 'được cập nhật ở nơi khác');
        assert.equal(await field('about.paragraph1').inputValue(), 'Bản nháp đang làm khi admin khác lưu.');
        assert.equal(state.value['about.paragraph1'], 'Nội dung đã được admin khác lưu.');
        page.once('dialog', dialog => dialog.dismiss());
        await page.click('[data-content-reload]');
        assert.equal(await field('about.paragraph1').inputValue(), 'Bản nháp đang làm khi admin khác lưu.');
        page.once('dialog', dialog => dialog.accept());
        await page.click('[data-content-reload]');
        await waitStatus(page, 'Đã tải nội dung');
        assert.equal(await field('about.paragraph1').inputValue(), 'Nội dung đã được admin khác lưu.');

        for (const width of [900, 390, 320]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No editor overflow at ${width}px`);
            const clipped = await page.locator('.site-content-editor').evaluate(node => {
                const outer = node.getBoundingClientRect();
                return [...node.querySelectorAll('input,textarea,select,button,iframe')].flatMap(control => {
                    const rect = control.getBoundingClientRect();
                    return rect.width && (rect.left < outer.left || rect.right > outer.right) ? [{ tag: control.tagName, left: rect.left, right: rect.right, outer: outer.right }] : [];
                });
            });
            assert.equal(await page.locator('.site-content-editor').evaluate(node => node.scrollLeft), 0, 'The decorative glow must not scroll the editor sideways');
            assert.deepEqual(clipped, [], `No clipped editor controls at ${width}px`);
            if (width === 390) await page.screenshot({ path: path.join(root, '../../site-content-mobile.png') });
        }

        state.holdLoad = true;
        await page.click('[data-content-reload]');
        await page.waitForFunction(() => document.querySelector('#contentWorkspace').getAttribute('aria-busy') === 'true');
        for (let attempts = 0; !state.resumeLoad && attempts < 20; attempts++) await page.waitForTimeout(25);
        assert.equal(typeof state.resumeLoad, 'function');
        await page.evaluate(() => contentAuth.emit(false));
        await page.waitForSelector('#adminPanel.hidden', { state: 'attached' });
        state.holdLoad = false; state.resumeLoad();
        await page.waitForTimeout(50);
        assert.equal(await page.locator('[data-content-fields] input,[data-content-fields] textarea').count(), 0);
        assert.equal(await page.locator('[data-content-preview]').getAttribute('src'), null);
        assert(await page.locator('[data-content-save]').isDisabled());
        await page.evaluate(() => contentAuth.emit(true));
        await waitStatus(page, 'Đã tải nội dung');
        assert.equal(await field('about.paragraph1').inputValue(), 'Nội dung đã được admin khác lưu.');
        assert.deepEqual(errors, []);
        console.log('PASS: actual admin/page CMS extraction, draft preview, reversible visibility switches, hidden navigation/deep-link fallbacks, save/public refresh, percentages, safe text/links, failures/conflicts, logout stale-load protection, and responsive desktop/mobile layout.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });

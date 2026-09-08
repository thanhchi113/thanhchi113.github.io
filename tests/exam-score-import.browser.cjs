const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const vendors = process.env.TEST_VENDOR_DIR || path.resolve(root, '../../test-vendor');
const ExcelJS = require(path.join(vendors, 'exceljs-4.4.0.js'));
const { Document, Packer, Paragraph, Table, TableRow, TableCell } = require(process.env.DOCX_MODULE || 'docx');
const blankPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1sAAAAASUVORK5CYII=', 'base64');
function mockClient() {
    const state = window.importMock = { rows: [], inserts: [], failInsert: 0, loseResponse: false, failRead: 0, failReconcile: false, loads: 0 };
    window.client = { from(table) {
        if (table !== 'exam_scores') throw new Error('Unexpected table');
        return {
            select() { return { async in(_, ids) {
                if (state.failRead > 0) { state.failRead--; return { data: null, error: { message: 'Mock read unavailable' } }; }
                return { data: state.rows.filter(row => ids.includes(row.id)).map(row => ({ id: row.id })), error: null };
            } }; },
            insert(payload) { return { async select() {
                state.inserts.push(structuredClone(payload));
                if (state.failInsert === state.inserts.length) return { data: null, error: { code: '42501', message: 'Mock insert denied' } };
                if (payload.some(row => state.rows.some(saved => saved.id === row.id))) return { data: null, error: { code: '23505', message: 'Duplicate key' } };
                state.rows.push(...structuredClone(payload));
                if (state.loseResponse) {
                    state.loseResponse = false;
                    if (state.failReconcile) state.failRead = 1;
                    throw new Error('Mock response lost after commit');
                }
                return { data: payload.map(row => ({ id: row.id })), error: null };
            } }; }
        };
    } };
    window.examScoreAdmin = { load() { state.loads++; } };
}
(async () => {
    const document = new Document({ sections: [{ children: [new Table({ rows: [
        ['Họ và tên', 'Lớp', 'Điểm GK1', 'Điểm CK1'],
        ['Nguyễn Word', '11A1', '7,5', '8,5']
    ].map(cells => new TableRow({ children: cells.map(text => new TableCell({ children: [new Paragraph(text)] })) })) })] }] });
    const docx = await Packer.toBuffer(document);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Toán 12');
    sheet.addRow(['Học sinh', 'Lớp', 'Điểm môn Toán', 'Kỳ thi']);
    sheet.addRow(['Trần Excel', '12B1', 10, 'CK2']);
    sheet.addRow(['Lê Formula', '12B1', { formula: '4+5', result: 9 }, 'GK2']);
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
        await context.route('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/**', route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(vendors, 'mammoth-1.8.0.js')) }));
        await context.route('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/**', route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(vendors, 'exceljs-4.4.0.js')) }));
        await context.route('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/**', route => route.fulfill({ contentType: 'text/javascript', body: `window.Tesseract={async createWorker(lang,mode,options){window.ocrLanguage=lang;options.logger({status:'recognizing text',progress:.5});return {async recognize(){return {data:{text:'Họ tên: Phạm Ảnh\\nLớp: 10A2\\nĐiểm: 8,75\\nKỳ thi: GK1'}}},async terminate(){window.ocrTerminated=true}}}};` }));
        await context.route('http://127.0.0.1:4199/**', route => {
            const name = new URL(route.request().url()).pathname.slice(1);
            if (!name) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="assets/exam-score-import.css"><body style="margin:30px;background:#050914;font-family:Arial,sans-serif"><div id="adminPanel" class="hidden"><div id="scoreImportAdmin"></div></div><script src="assets/exam-scores.js"></script><script src="assets/exam-score-import-parser.js"></script><script src="assets/exam-score-import.js"></script><script>window.importer=ExamScoreImport.init(client);importer.load();</script></body></html>' });
            const file = path.resolve(root, name);
            assert(file.startsWith(root + path.sep));
            return route.fulfill({ path: file, contentType: name.endsWith('.js') ? 'text/javascript' : 'text/css' });
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        await page.addInitScript(mockClient);
        await page.goto('http://127.0.0.1:4199/');
        assert(await page.locator('[data-import-fields]').evaluate(fieldset => fieldset.disabled), 'pre-auth workspace load must stay disabled');
        await page.evaluate(() => { document.getElementById('adminPanel').classList.remove('hidden'); importer.load(); });
        const choose = page.locator('[data-import-files]');
        const status = page.locator('[data-import-status]');
        const waitReady = () => page.waitForFunction(() => document.querySelector('#scoreImportAdmin').getAttribute('aria-busy') === 'false');
        const csv = (name, content) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(content) });
        await choose.setInputFiles(csv('scores.csv', 'Họ tên;Lớp;Điểm;Kỳ thi\nAn;12A1;0;gk1\nBình;12A2;10;ck1\n;12A3;8,25;gk2'));
        await waitReady();
        assert.equal(await page.locator('[data-import-id]').count(), 3);
        await page.locator('[data-import-save]').click();
        assert.match(await status.textContent(), /1 dòng.*thiếu hoặc sai/);
        assert.equal(await page.evaluate(() => importMock.inserts.length), 0);
        await page.locator('[data-import-field="student_name"]').nth(2).fill('<img src=x onerror=alert(1)> Chi');
        assert.equal(await page.locator('[data-import-rows] img').count(), 0);
        await page.locator('[data-import-save]').click(); await waitReady();
        assert.equal(await page.locator('[data-import-id]').count(), 0);
        assert.deepEqual(await page.evaluate(() => importMock.rows.map(row => row.score)), [0,10,8.25]);
        assert(await page.evaluate(() => importMock.rows.every(row => !row.published && !row.hide_student_name)));

        // A server commit with lost response and failed reconciliation stays frozen until retry.
        await choose.setInputFiles(csv('retry.csv', 'Họ tên,Lớp,Điểm\nRetry Student,11A1,8'));
        await waitReady();
        await page.evaluate(() => { importMock.loseResponse = true; importMock.failReconcile = true; });
        await page.locator('[data-import-save]').click(); await waitReady();
        assert.equal(await page.locator('[data-import-id]').count(), 1);
        assert(await page.locator('[data-import-field="student_name"]').isDisabled());
        const beforeRetry = await page.evaluate(() => ({ writes: importMock.inserts.length, count: importMock.rows.length }));
        await page.locator('[data-import-publish]').check();
        await page.locator('[data-import-save]').click(); await waitReady();
        assert.deepEqual(await page.evaluate(() => ({ writes: importMock.inserts.length, count: importMock.rows.length })), beforeRetry);
        assert.equal(await page.evaluate(() => importMock.rows.at(-1).published), false);
        assert.match(await status.textContent(), /Xem trạng thái/);

        // Real Word/Excel parsers, plus mocked OCR worker and an unsupported file in one drop.
        await choose.setInputFiles([
            { name: 'table.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx },
            { name: 'table.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx },
            { name: 'roster.png', mimeType: 'image/png', buffer: blankPng },
            { name: 'old.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('unsupported') }
        ]);
        await waitReady();
        assert.equal(await page.locator('[data-import-id]').count(), 5);
        assert.match(await status.textContent(), /1 tệp gặp lỗi/);
        assert.equal(await page.evaluate(() => ocrLanguage), 'vie+eng');
        assert.equal(await page.evaluate(() => ocrTerminated), true);
        const names = await page.locator('[data-import-field="student_name"]').evaluateAll(inputs => inputs.map(input => input.value));
        assert.deepEqual(names, ['Nguyễn Word','Nguyễn Word','Trần Excel','Lê Formula','Phạm Ảnh']);
        await page.screenshot({ path: path.join(root, '../../score-import-desktop.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(root, '../../score-import-mobile.png') });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile should scroll table without overflowing page');
        await page.locator('[data-import-clear]').click();
        assert.equal(await page.locator('[data-import-id]').count(), 0);
        await page.evaluate(() => { importMock.rows = []; importMock.inserts = []; importMock.failInsert = 2; });
        await choose.setInputFiles(csv('many.csv', 'Họ tên,Lớp,Điểm\n' + Array.from({ length: 51 }, (_, i) => `Học sinh ${i + 1},12A1,8`).join('\n')));
        await waitReady();
        await page.locator('[data-import-save]').click(); await waitReady();
        assert.equal(await page.evaluate(() => importMock.rows.length), 50);
        assert.equal(await page.locator('[data-import-id]').count(), 1);
        assert.equal(await page.evaluate(() => importMock.inserts[0].length), 50);
        await page.evaluate(() => { importMock.failInsert = 0; });
        await page.locator('[data-import-save]').click(); await waitReady();
        assert.equal(await page.evaluate(() => importMock.rows.length), 51);
        assert.equal(await page.evaluate(() => new Set(importMock.rows.map(row => row.id)).size), 51);
        assert.equal(await page.evaluate(() => importMock.inserts[1][0].id === importMock.inserts[2][0].id), true);
        await page.evaluate(() => { importer.clear(); });
        assert(await page.locator('[data-import-fields]').evaluate(fieldset => fieldset.disabled));
        assert.deepEqual(errors, []);
        console.log('PASS: auth lock; CSV validation/edit/XSS; draft save; lost response retry without duplicate; real DOCX/XLSX; mocked image OCR; per-file error; mobile; 50-row batches/partial failure retry; clear.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });

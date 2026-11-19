import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const indexUrl = new URL('./index.html', import.meta.url);
const taiLieuUrl = new URL('./tai-lieu.html', import.meta.url);
const adminUrl = new URL('./admin.html', import.meta.url);

const html = fs.readFileSync(indexUrl, 'utf8');

// Generate synchronized tai-lieu.html from index.html
const taiLieuGenerated = html
  .replace(
    /<title>[\s\S]*?<\/title>/,
    '<title>Tài Liệu — Lớp Toán Anh Chí (Thầy Huỳnh Thanh Chí)</title>'
  )
  .replace('<body>', '<body class="doc-library-page">')
  .replace(/href="#(gioi-thieu|lop-hoc|thanh-tich|tra-cuu-diem|lien-he)"/g, 'href="./index.html#$1"')
  .replace('<div class="doc-lib-shell" id="kho-tai-lieu" hidden>', '<div class="doc-lib-shell" id="kho-tai-lieu">')
  .replace('<script>', '<script>\nwindow.IS_DOC_LIBRARY_PAGE = true;');
fs.writeFileSync(taiLieuUrl, taiLieuGenerated, 'utf8');

// Generate synchronized standalone admin.html Studio page from index.html
const adminGenerated = html
  .replace(
    /<title>[\s\S]*?<\/title>/,
    '<title>Trang Quản Trị Nội Dung & Định Dạng (Admin Studio) — Lớp Toán Anh Chí</title>'
  )
  .replace('<body>', '<body class="admin-studio-page">')
  .replace(/href="#(gioi-thieu|lop-hoc|thanh-tich|tra-cuu-diem|lien-he)"/g, 'href="./index.html#$1"')
  .replace('<div class="modal-backdrop" id="editor-modal" hidden>', '<div class="modal-backdrop" id="editor-modal">')
  .replace('<script>', '<script>\nwindow.IS_ADMIN_STUDIO_PAGE = true;');
fs.writeFileSync(adminUrl, adminGenerated, 'utf8');

const taiLieuHtml = fs.readFileSync(taiLieuUrl, 'utf8');
const adminHtml = fs.readFileSync(adminUrl, 'utf8');

// 1. Check required sections and absence of e-commerce/buying features
assert.ok(html.includes('id="gioi-thieu"'), 'Missing #gioi-thieu section');
assert.ok(html.includes('id="lop-hoc"'), 'Missing #lop-hoc section');
assert.ok(html.includes('id="thanh-tich"'), 'Missing #thanh-tich section');
assert.ok(html.includes('id="tra-cuu-diem"'), 'Missing #tra-cuu-diem section');
assert.ok(html.includes('id="lien-he"'), 'Missing #lien-he section');
assert.ok(!html.includes('Mua bản quyền') && !html.includes('250.000đ'), 'Should not contain buying/pricing elements');

// 2. Verify only generic draft students are shown and all real student names are hidden
const match = html.match(/const BASE_STUDENTS = (\[[\s\S]*?\]);/);
assert.ok(match, 'BASE_STUDENTS not found');
const students = eval(match[1]);
assert.equal(students.length, 16, 'Expected 16 draft students');
assert.ok(students.every(s => /^Học sinh Nháp \d{2}$/.test(s.name)), 'All default students must be generic Học sinh Nháp XX');
assert.ok(
  !html.includes('Châu Hiểu Nhiên') &&
  !html.includes('Hoàng Như') &&
  !html.includes('Hoàng Quốc Việt') &&
  !html.includes('Phạm Quốc Khánh') &&
  !html.includes('Nguyễn Minh Anh'),
  'All previous/real student names must be completely hidden'
);

// 3. Verify score table single-line display (white-space: nowrap on td)
assert.match(html, /table\.score-table td\s*\{[^}]*white-space:\s*nowrap/s, 'score-table td must have white-space: nowrap');

// 4. Verify Taskbar Cleanup: only 1 "Tra cứu điểm" button in main .nav bar, and "Tài liệu PDF" renamed to "Tài liệu"
const navMatch = html.match(/<nav class="wrap nav"[\s\S]*?<\/nav>/);
assert.ok(navMatch, 'Missing nav.wrap.nav');
const navContent = navMatch[0];
const traCuuCountInNav = (navContent.match(/Tra cứu điểm/g) || []).length;
assert.equal(traCuuCountInNav, 1, 'Main taskbar (.nav) must have exactly ONE "Tra cứu điểm" button');
assert.ok(!html.includes('Tài liệu PDF'), 'Must rename "Tài liệu PDF" to "Tài liệu" everywhere');
assert.ok(navContent.includes('<a href="./tai-lieu.html">Tài liệu</a>'), 'Main taskbar must link to ./tai-lieu.html with label "Tài liệu"');

// 5. Verify Removal of "ẩn 12 HS" / "đang được ẩn bảo mật" phrases from user page
assert.ok(
  !html.includes('ẩn 12 HS') &&
  !html.includes('đang được ẩn bảo mật') &&
  !html.includes('khóa bảo mật bởi Admin') &&
  !html.includes('HS được phép'),
  'User page must not contain any "ẩn 12 HS" or "đang được ẩn bảo mật" messages'
);
assert.ok(
  html.includes('class="privacy-banner admin-only" id="public-privacy-banner" hidden'),
  '#public-privacy-banner must be admin-only and hidden from public users'
);

// 6. Verify Hero Notebook Sheet: Penrose Triangle & Ch1 Math Brand Animation, Unified Font, Clean Multi-Line Theory, Cubic Graph, Solid of Revolution & Zero Crawling Dots
assert.ok(!html.includes('class="sheet-switcher"') && !html.includes('data-sheet-mode='), 'Must remove .sheet-switcher buttons below hero notebook sheet');
assert.ok(!html.includes('id="hero-sheet-tag"'), 'Must remove #hero-sheet-tag title pill');
assert.ok(
  html.includes('const SHEET_ORDER = ["brand_logo", "cube", "circle_parabola", "conics", "probability"]') &&
  html.includes('setInterval(advanceHeroSheet, 5500)') &&
  html.includes('renderHeroSheet("brand_logo")') &&
  html.includes('.sheet text, .sheet .m-tex text, .sheet text.m-tex, .sheet tspan { font-family: var(--hand); font-style: normal; }') &&
  html.includes('class="penrose-beam-1"') &&
  html.includes('class="penrose-beam-2"') &&
  html.includes('class="penrose-beam-3"') &&
  html.includes('class="ch1-sigma-pulse"') &&
  html.includes('class="ch1-swoosh-wipe"') &&
  !html.includes('Thương hiệu Ch1 Math') &&
  html.includes('Lớp Toán Anh Chí</text>') &&
  html.includes('Thầy Huỳnh Thanh Chí · Toán 6 – 12</text>') &&
  html.includes('function svgTexFrac(') &&
  html.includes('function svgTexBar(') &&
  html.includes('function svgTexIntegral(') &&
  html.includes('M352 94V20M352 94H482M352 94L298 138') &&
  html.includes('M98 376 L98 330 C118 294, 144 304, 162 376 Z') &&
  html.includes('M162 376 C178 416, 202 412, 218 392 L218 376 Z') &&
  html.includes('M82 352 Q90 341, 98 330 C118 294, 144 304, 162 376 C178 416, 202 412, 218 392 Q225 384, 232 372') &&
  html.includes('${svgTexSup("R", "2")}') &&
  html.includes('Elip (E):') &&
  html.includes('Hypebol (H):') &&
  html.includes('3. Parabol (P):') &&
  html.includes('Gieo 2 xúc xắc:') &&
  html.includes('class="dice-bounce-1"') &&
  !html.includes('class="pop venn-inter-pulse"') &&
  !html.includes('<animateMotion') &&
  html.includes('advanceHeroSheet()'),
  'Hero notebook sheet must render dedicated centered Penrose + Ch1 Math logo slide (no circle/card/word Thuong hieu), original 6-diagram cube layout, fast 5.5s cycle, unified font & multi-line LaTeX formulas'
);

// 7. Verify Instant Click on Any Card to Open Protected PDF Viewer Immediately & Student Login Gate
assert.ok(
  html.includes('data-lib-card="${doc.id}"') &&
  html.includes('.doc-lib-card[data-lib-card]') &&
  html.includes('function handleDocOpenRequest(doc) {\n  if (!doc) return;\n  openProtectedPdfViewer(doc);\n}') &&
  html.includes('id="doc-require-student-login-chk"') &&
  html.includes('id="student-doc-login-modal"') &&
  html.includes('function isStudentAuthorizedForDocs()'),
  'Clicking anywhere on a document card must open the Protected PDF Viewer with student login gate'
);

// 8. Verify Dedicated Full-Page admin.html Dashboard (No small modal on user page) + Rich Text / Typography & User Web Sync
assert.ok(
  adminHtml.includes('class="admin-studio-page"') &&
  adminHtml.includes('window.IS_ADMIN_STUDIO_PAGE = true') &&
  html.includes('body.admin-studio-page > main') &&
  html.includes('id="admin-overview-cards"') &&
  html.includes('window.location.href = `./admin.html${q}`') &&
  html.includes('id="global-font-select"') &&
  html.includes('id="global-size-select"') &&
  html.includes('data-rt-font=') &&
  html.includes('data-rt-size=') &&
  html.includes('data-rt-cmd="bold"') &&
  html.includes('data-rt-cmd="italic"') &&
  html.includes('data-rt-cmd="underline"') &&
  html.includes('data-rt-color=') &&
  html.includes('CARD_STYLES_STORAGE_KEY') &&
  html.includes('GLOBAL_TYPO_STORAGE_KEY') &&
  html.includes('syncSiteStateFromSupabase') &&
  html.includes('window.addEventListener("storage"'),
  'Missing dedicated full-page admin.html Dashboard or real-time sync to user web'
);
assert.match(html, /\[data-editable\]\s*\{\s*white-space:\s*pre-line;\s*\}/, '[data-editable] must support custom multi-line line breaks via white-space: pre-line');

// 9. Verify Hero h1 matches initial version (two lines + italic em with yellow swipe highlight) and is never stripped by live DOM storage
assert.ok(
  html.includes('<h1>Học hiểu bản chất.<br><em>Bứt phá điểm 9+ Toán.</em></h1>') &&
  html.includes('font: 800 clamp(40px, 5.6vw, 70px)/1.03 var(--serif);') &&
  html.includes('h1 em { font-style: italic; font-weight: 650; color: var(--ink); position: relative; white-space: nowrap; }') &&
  html.includes('if (heroH1 && !heroH1.querySelector("em"))'),
  'Hero h1 must preserve its original 2-line structure and italic yellow-highlighted <em>'
);

// 10. Verify Document Cards Default to File - Trang A4 - PDF Icon & Admin Can Select Optional Icon
assert.ok(
  html.includes('id="doc-svg-type-input"') &&
  html.includes('<option value="pdf_a4" selected>File - Trang A4 - PDF (Mặc định)</option>') &&
  html.includes('FILE · PDF') &&
  html.includes('>A4</text>') &&
  !html.includes('svgType: "cubic"'),
  'Document cards must default to File - Trang A4 - PDF icon with Admin option to pick custom display'
);

// 11. Verify Only Dedicated "Phòng thi & BTVN" Menu Items Jump to Exam App (No Redundant Class/Timetable/CTA Exam Links)
assert.ok(
  html.includes('https://thanhchi113.github.io/thi-thu-toan/?tab=btvn') &&
  !html.includes('<a class="class-slot-row"') &&
  !html.includes('<a class="tt-cls-chip"') &&
  !html.includes('https://thanhchi113.github.io/thi-thu-toan/?tab=grades') &&
  html.includes('<div class="class-slot-row"') &&
  html.includes('<span class="tt-cls-chip"'),
  'Only dedicated Phòng thi & BTVN navigation items should jump to thi-thu-toan; schedule rows and timetable chips must not jump to exam app'
);

// 12. Verify Strictly Zero Emojis or Text Arrows Across All Pages
const emojiOrArrowRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}→↻↔]/u;
assert.ok(!emojiOrArrowRegex.test(html), 'index.html must not contain any emojis, dingbats, or text arrow symbols');
assert.ok(!emojiOrArrowRegex.test(taiLieuHtml), 'tai-lieu.html must not contain any emojis, dingbats, or text arrow symbols');
assert.ok(!emojiOrArrowRegex.test(adminHtml), 'admin.html must not contain any emojis, dingbats, or text arrow symbols');

// 13. Verify Student Score Submission Form (#gui-diem-thi), Quy Nhơn Schools & Admin Edit/Approve Workflow + Valid JS Syntax
assert.ok(
  html.includes('id="gui-diem-thi"') &&
  html.includes('id="score-submit-form"') &&
  html.includes('id="sub-name"') &&
  html.includes('id="sub-school"') &&
  html.includes('id="sub-school-other"') &&
  html.includes('id="ed-school-select"') &&
  html.includes('id="ed-school-other"') &&
  html.includes('id="rc-school"') &&
  html.includes('THPT Chuyên Lê Quý Đôn') &&
  html.includes('THPT Quốc Học Quy Nhơn') &&
  html.includes('THPT Trưng Vương') &&
  html.includes('THPT Trần Cao Vân') &&
  html.includes('THPT Quy Nhơn') &&
  html.includes('THCS Lê Hồng Phong') &&
  html.includes('id="sub-exam"') &&
  html.includes('id="sub-score"') &&
  html.includes('SCORE_SUBMISSIONS_KEY') &&
  html.includes('appendScoreSubmissionToSupabase') &&
  html.includes('id="admin-submissions-box"') &&
  html.includes('id="admin-submissions-tbody"') &&
  html.includes('data-sub-edit=') &&
  html.includes('data-sub-approve=') &&
  html.includes('buildStudentDraftFromSubmission') &&
  adminHtml.includes('id="admin-submissions-box"') &&
  adminHtml.includes('id="ed-school-select"'),
  'Missing student score submission form, Quy Nhon school options, or Admin edit/approval workflow'
);

// 14. Verify Cloudflare Edge Document Vault & Automation Hub Integration + Zero Secret Leak
assert.ok(
  html.includes('id="cloudflare-config-box"') &&
  html.includes('id="cf-pool-meter-box"') &&
  html.includes('renderStoragePoolMeterUI') &&
  html.includes('id="cloudflare-config-form"') &&
  html.includes('https://docs.lop-toan-anh-chi.workers.dev') &&
  html.includes('id="automation-hub-box"') &&
  html.includes('id="auto-enable-toanmath"') &&
  html.includes('id="auto-enable-fblatex"') &&
  html.includes('id="auto-enable-toan12"') &&
  html.includes('id="auto-publish-mode-select"') &&
  html.includes('uploadDocToCloudflare') &&
  html.includes('syncDocsFromCloudflare') &&
  html.includes('fetchProtectedDocArrayBuffer') &&
  adminHtml.includes('id="cloudflare-config-box"') &&
  adminHtml.includes('id="automation-hub-box"') &&
  taiLieuHtml.includes('https://docs.lop-toan-anh-chi.workers.dev'),
  'Missing Cloudflare Edge Vault or Document Automation Hub integration'
);
assert.ok(
  !/cf_ltac_[0-9a-f]{24,}/i.test(html) &&
  !/cf_ltac_[0-9a-f]{24,}/i.test(taiLieuHtml) &&
  !/cf_ltac_[0-9a-f]{24,}/i.test(adminHtml),
  'Upload API secret must NEVER be hardcoded in public HTML files'
);

const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.ok(inlineScripts.length >= 1, 'Expected inline <script> block');
for (const [, code] of inlineScripts) {
  new vm.Script(code);
}

// 15. Verify Ch1 Math Logo Assets, Mobile PWA Manifest & Integration Across All 3 HTML Pages
for (const asset of ['logo-ch1math.png', 'logo-mark.png', 'favicon.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest']) {
  assert.ok(fs.existsSync(new URL(`./${asset}`, import.meta.url)), `Missing logo/PWA asset: ${asset}`);
}
const manifestObj = JSON.parse(fs.readFileSync(new URL('./manifest.webmanifest', import.meta.url), 'utf8'));
assert.equal(manifestObj.short_name, 'Ch1 Math', 'PWA manifest short_name must be Ch1 Math');
for (const [pageName, pageSrc] of [['index.html', html], ['tai-lieu.html', taiLieuHtml], ['admin.html', adminHtml]]) {
  assert.ok(pageSrc.includes('./logo-ch1math.png'), `${pageName} must embed ./logo-ch1math.png`);
  assert.ok(pageSrc.includes('./favicon.png'), `${pageName} must link ./favicon.png`);
  assert.ok(pageSrc.includes('./logo-mark.png'), `${pageName} must embed ./logo-mark.png`);
  assert.ok(pageSrc.includes('<meta name="apple-mobile-web-app-title" content="Ch1 Math">'), `${pageName} must set apple-mobile-web-app-title to Ch1 Math`);
  assert.ok(pageSrc.includes('./manifest.webmanifest'), `${pageName} must link ./manifest.webmanifest`);
}

// 16. Verify 4-Column Schedule, 10 Real Classes, Weekly Timetable & Admin Auto-Sync Manager
assert.ok(
  html.includes('id="class-columns-grid"') &&
  html.includes('data-col-id="12"') &&
  html.includes('data-col-id="11"') &&
  html.includes('data-col-id="10"') &&
  html.includes('data-col-id="6-9"') &&
  html.includes('id="weekly-timetable-wrap"') &&
  html.includes('SCHEDULE_STORAGE_KEY') &&
  html.includes('renderAllScheduleDependentUI') &&
  html.includes('id="admin-pane-schedule"') &&
  adminHtml.includes('id="admin-pane-schedule"') &&
  adminHtml.includes('id="schedule-class-form"') &&
  adminHtml.includes('id="schedule-tsv-input"'),
  'Missing 4-column schedule structure, weekly timetable, or Admin schedule management pane'
);
for (const timeSlot of ['09:00 – 10:30', '09:30 – 11:00', '14:00 – 15:30', '15:30 – 17:00', '17:30 – 19:00', '19:30 – 21:00']) {
  assert.ok(html.includes(timeSlot), `Missing exact timetable slot: ${timeSlot}`);
}
assert.ok(
  html.includes('class="dl ${col.mainCard ? "main " : ""}reveal in"'),
  'Dynamically rendered .dl cards must include reveal in classes so they never stay hidden'
);

const vnNormMatch = html.match(/function vnNorm\([\s\S]*?\n\}/);
const schBlockMatch = html.match(/const WEEKDAY_ORDER = [\s\S]*?function serializeScheduleToTsv[\s\S]*?\n\}/);
assert.ok(vnNormMatch && schBlockMatch, 'Unable to locate pure schedule parser helpers in index.html');
const schCtx = { localStorage: { getItem: () => null }, loadSavedCards: () => ({}) };
vm.runInNewContext(`${vnNormMatch[0]}\n${schBlockMatch[0]}\n__parseTsv = parseTimetableGridTsv;\n__defaultCfg = DEFAULT_SCHEDULE_CONFIG;`, schCtx);

const parsedFromSheet = schCtx.__parseTsv([
  '\tThứ 2\tThứ 3\tThứ 4\tThứ 5\tThứ 6\tThứ 7',
  '9:00:10:30\t7A\t\t7A\t\t7A\t',
  '9:30-11:00\t\t10C\t\t10C\t\t10C',
  '14:00-15:30\t8A\t9A\t8A\t9A\t8A\t9A',
  '15:30-17:00\t10A\t10B\t10A\t10B\t10A\t10B',
  '17:30-19:00\t12A\t12B\t12A\t12B\t12A\t12B',
  '19:30-21:00\t11A\t11B\t11A\t11B\t11A\t11B'
].join('\n'));
assert.equal(parsedFromSheet.length, 10, 'parseTimetableGridTsv must extract all 10 classes from timetable grid');
const byName = Object.fromEntries(parsedFromSheet.map(c => [c.name, c]));
assert.deepEqual([...byName['12A'].days], ['T2', 'T4', 'T6']);
assert.equal(byName['12A'].time, '17:30 – 19:00');
assert.equal(byName['12B'].time, '17:30 – 19:00');
assert.equal(byName['11A'].time, '19:30 – 21:00');
assert.equal(byName['11B'].time, '19:30 – 21:00');
assert.equal(byName['10A'].time, '15:30 – 17:00');
assert.equal(byName['10B'].time, '15:30 – 17:00');
assert.equal(byName['10C'].time, '09:30 – 11:00');
assert.equal(byName['9A'].time, '14:00 – 15:30');
assert.equal(byName['8A'].time, '14:00 – 15:30');
assert.equal(byName['7A'].time, '09:00 – 10:30');

console.log('PASS: All assertions passed (4-Col 10-Class Schedule, Timetable Parser, Admin Schedule Sync, Protected PDF Viewer, 100% Vector Icons, Ch1 Math Logo).');

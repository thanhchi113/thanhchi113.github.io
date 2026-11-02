import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexUrl = new URL('./index.html', import.meta.url);
const taiLieuUrl = new URL('./tai-lieu.html', import.meta.url);
const adminUrl = new URL('./admin.html', import.meta.url);

const html = fs.readFileSync(indexUrl, 'utf8');

// Generate synchronized tai-lieu.html from index.html
const taiLieuGenerated = html
  .replace(
    '<title>Thầy Huỳnh Thanh Chí — Giáo Viên Toán (Lớp 6 – 12, Tuyển Sinh 10 & THPT Quốc Gia)</title>',
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
    '<title>Thầy Huỳnh Thanh Chí — Giáo Viên Toán (Lớp 6 – 12, Tuyển Sinh 10 & THPT Quốc Gia)</title>',
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

// 6. Verify Hero Notebook Sheet: No figure titles, no switcher buttons, 3D solid/dashed edges, Shaded Integral Area & 3D Solid of Revolution
assert.ok(!html.includes('class="sheet-switcher"') && !html.includes('data-sheet-mode='), 'Must remove .sheet-switcher buttons below hero notebook sheet');
assert.ok(!html.includes('id="hero-sheet-tag"'), 'Must remove #hero-sheet-tag title pill');
assert.ok(
  html.includes('id="integral-hatch"') &&
  html.includes('S = ∫ₐᵇ |f(x)| dx') &&
  html.includes('V = π ∫ₐᵇ [f(x)]² dx') &&
  html.includes("M(x₀;y₀;z₀)") &&
  html.includes("M'(x₀;y₀;0)") &&
  html.includes('class="draw-dash"'),
  'Hero notebook sheet must include 3D solid/dashed box cross-section ACD\', Oxyz 3 components, pyramid S.ABCD, cubic BBT, shaded integral area, and 3D solid of revolution'
);

// 7. Verify Instant Click on Any Card to Open Protected PDF Viewer Immediately
assert.ok(
  html.includes('data-lib-card="${doc.id}"') &&
  html.includes('.doc-lib-card[data-lib-card]') &&
  html.includes('function handleDocOpenRequest(doc) {\n  if (!doc) return;\n  openProtectedPdfViewer(doc);\n}'),
  'Clicking anywhere on a document card must open the Protected PDF Viewer immediately'
);

// 8. Verify Standalone admin.html Studio Page + Rich Text / Typography (Font, Bold, Italic, Size, Color, Multi-line) & User Web Sync
assert.ok(
  adminHtml.includes('class="admin-studio-page"') &&
  adminHtml.includes('window.IS_ADMIN_STUDIO_PAGE = true') &&
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
  'Missing standalone admin.html Rich Text & Typography Studio or real-time sync to user web'
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

// 10. Verify Strictly Zero Emojis or Text Arrows Across All Pages
const emojiOrArrowRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}→↻↔]/u;
assert.ok(!emojiOrArrowRegex.test(html), 'index.html must not contain any emojis, dingbats, or text arrow symbols');
assert.ok(!emojiOrArrowRegex.test(taiLieuHtml), 'tai-lieu.html must not contain any emojis, dingbats, or text arrow symbols');
assert.ok(!emojiOrArrowRegex.test(adminHtml), 'admin.html must not contain any emojis, dingbats, or text arrow symbols');

console.log('PASS: All assertions passed (Instant Card Click to View, 100% Vector Icons, Standalone Admin Studio with Font/Bold/Italic/Size/Line-break Sync, Clean Public Score UI, Fixed Taskbar, 3D Geometry + Shaded Integral + Solid of Revolution).');

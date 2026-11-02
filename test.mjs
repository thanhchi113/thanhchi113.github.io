import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

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

// 4. Verify Admin login, password 123, Gmail reset (badaoqn132@gmail.com), card editor, and student anonymization
assert.ok(html.includes('id="nav-admin-btn"'), 'Missing Admin button in header');
assert.ok(html.includes('const DEFAULT_ADMIN_PWD = "123"'), 'Default admin password must be 123');
assert.ok(html.includes('const ADMIN_EMAIL = "badaoqn132@gmail.com"'), 'Admin reset email must be badaoqn132@gmail.com');
assert.ok(html.includes('id="cards-edit-form"') && html.includes('data-editable='), 'Missing Admin card content editor');
assert.ok(html.includes('id="btn-delete-student"') && html.includes('id="toggle-anon-all"') && html.includes('formatPublicStudentName'), 'Missing student delete / anonymize controls');

// 5. Verify bento grid gap is filled (c6 & c7 cards) and floating switchable math diagrams exist
assert.ok(html.includes('data-editable="c6_title"') && html.includes('data-editable="c7_title"'), 'Missing c6/c7 cards to fill #gioi-thieu 3-column grid');
assert.ok(html.includes('.draw-dash') && html.includes('class="draw-dash"'), 'Missing .draw-dash class for true dashed lines in 3D geometry');
assert.ok(html.includes("Thiết diện (ACD')") && html.includes('M(x₀;y₀;z₀)') && html.includes("M'(x₀;y₀;0)"), 'Missing (ACD\') cross-section or 3-component Oxyz point M(x0;y0;z0)');
assert.ok(html.includes('data-sheet-mode="pyramid"') && html.includes('Hình chóp tứ giác S.ABCD') && html.includes('BBT Hàm bậc 3'), 'Missing quadrilateral pyramid S.ABCD or cubic variation table (BBT)');

// 6. Verify synchronized custom scrollbars, custom select dropdown, and custom checkboxes
assert.ok(html.includes('::-webkit-scrollbar-thumb') && html.includes('scrollbar-color: var(--ink-soft) var(--paper-2)'), 'Missing custom synchronized scrollbar styles');
assert.ok(html.includes('.custom-select-menu') && html.includes('initCustomClassSelect') && html.includes('input[type="checkbox"]:checked'), 'Missing custom notebook select dropdown or custom checkbox styles');

// 7. Verify Student List Privacy (Hide all / Show selected) & Search Permissions (Allow none / Allow selected / Allow all)
assert.ok(html.includes('id="privacy-list-mode"') && html.includes('id="privacy-search-mode"'), 'Missing privacy list mode or search permission controls in Admin');
assert.ok(html.includes('canPublicSeeInTable') && html.includes('canPublicSearchStudent'), 'Missing student list visibility & search permission guard functions');
assert.ok(students.filter(s => s.publicVisible).length === 4 && students.filter(s => s.searchable).length === 6, 'Default students must only expose 4 visible and 6 searchable records');

// 8. Verify 3D Locker PDF Document Carousel (inspired by aodauvietnam.com), Admin PDF Upload, Protected No-Download Viewer & Custom Cursors
assert.ok(html.includes('id="tai-lieu"') && html.includes('class="locker__stage"') && html.includes('class="locker__cubby"') && html.includes('class="locker__rail"'), 'Missing 3D Locker PDF Document Carousel');
assert.ok(html.includes('id="doc-upload-form"') && html.includes('id="doc-file-input"') && html.includes('savePdfBinaryToIdb'), 'Missing Admin-only PDF upload form and IndexedDB storage');
assert.ok(html.includes('id="pdf-viewer-modal"') && html.includes('id="pdf-zoom-in"') && html.includes('pdf-watermark') && html.includes('@media print'), 'Missing Protected PDF Viewer with zoom/scroll/watermark and print blocker');
assert.ok(html.includes('--cursor-grab:') && html.includes('--cursor-hover:') && html.includes('id="cursor-follower"'), 'Missing custom cursors and contextual cursor follower');

// 9. Verify single-line top navbar with compact 1-logo Admin icon & Supabase Storage integration
assert.match(html, /\.nav\s*\{[^}]*flex-wrap:\s*nowrap[^}]*white-space:\s*nowrap/s, '.nav must enforce flex-wrap: nowrap and white-space: nowrap');
assert.ok(html.includes('class="nav-icon-btn" id="nav-admin-btn"'), 'Admin button in navbar must be a compact .nav-icon-btn logo icon');
assert.ok(
  html.includes('id="supabase-config-form"') &&
  html.includes('uploadPdfToSupabaseStorage') &&
  html.includes('fetchPdfArrayBufferFromSupabase') &&
  html.includes('upsertDocMetadataToSupabase'),
  'Missing Supabase Storage & Database client integration'
);

console.log('PASS: All assertions passed (Single-line navbar with compact Admin logo, Supabase Storage integration, 3D Locker PDF Carousel, No-download PDF Viewer).');

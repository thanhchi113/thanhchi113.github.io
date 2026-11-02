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

console.log('PASS: All assertions passed (16 generic draft students, 1-line score rows, Admin auth/reset/CRUD/anonymize/card editor).');

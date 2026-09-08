const { test } = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../assets/exam-score-import-parser.js');
const scores = require('../assets/exam-scores.js');
const defaults = { grade: '12', period: 'gk1', school_year: '2026-2027', class_name: '' };

test('Vietnamese aliases and four-term wide tables expand one score per term', () => {
    const result = parser.fromRows([
        ['BẢNG ĐIỂM TOÁN'], ['STT', 'Họ và tên', 'Lớp', 'Điểm giữa học kỳ 1', 'CKI', 'GK 2', 'Cuối kì 2'],
        [1, 'Nguyễn Văn An', '10A1', '0', '6,5', '10', '9.25'],
        [2, 'Trần Bình', '11B2', '', '8', '', '']
    ], defaults, 'lớp.xlsx');
    assert.equal(result.rows.length, 5);
    assert.deepEqual(result.rows.slice(0, 4).map(row => row.period), ['gk1', 'ck1', 'gk2', 'ck2']);
    assert.deepEqual(result.rows.slice(0, 4).map(row => scores.validate(row).score), [0, 6.5, 10, 9.25]);
    assert.equal(result.rows[0].grade, '10');
    assert.equal(result.rows[4].period, 'ck1');
    assert.equal(result.rows[4].sourceLine, 4);
});
test('CSV semicolon decimal commas and quoted multiline names retain values', () => {
    const input = '\uFEFFHọc sinh;Lớp;Điểm môn Toán;Kỳ thi\r\n"Nguyễn\nMinh An";12A1;8,75;Cuối kỳ 1\r\n"Lê ""Bình""";12A2;10;GKII';
    const result = parser.fromText(input, defaults);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].student_name, 'Nguyễn Minh An');
    assert.equal(scores.validate(result.rows[0]).score, 8.75);
    assert.equal(result.rows[1].student_name, 'Lê "Bình"');
    assert.equal(result.rows[1].period, 'gk2');
});
test('comma CSV ignores quoted separators and uses defaults only for missing data', () => {
    const rows = parser.fromText('Họ tên,Lớp,Điểm,Kỳ thi,Năm học\n"An, Bình",11A1,"7,25",gk1,2025-2026\nChi,,,ck2,', { ...defaults, class_name: '12A9' }).rows;
    assert.equal(rows[0].student_name, 'An, Bình');
    assert.equal(rows[0].score, '7,25');
    assert.equal(rows[0].school_year, '2025-2026');
    assert.equal(rows[1].class_name, '12A9');
    assert.equal(rows[1].period, 'ck2');
    assert.equal(rows[1].score, '');
});
test('invalid scores and missing names are retained for review, never guessed valid', () => {
    const rows = parser.fromRows([['Họ tên', 'Lớp', 'Điểm'], ['', '12A1', '8'], ['An', '12A1', '11'], ['Bình', '12A2', '7,999'], ['Chi', '12A2', '']], defaults).rows;
    assert.equal(rows.length, 4);
    rows.forEach(row => assert.throws(() => scores.validate(row)));
});
test('labeled OCR text handles multiple students and multiple periods', () => {
    const rows = parser.fromText('Họ tên: Nguyễn An\nLớp: 12A1\nGK1: 8,5\nCK1: 9\nHọc sinh: Bình\nLớp: 11B1\nĐiểm: 7\nKỳ thi: giữa kì 2', defaults).rows;
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(row => row.period), ['gk1', 'ck1', 'gk2']);
    assert.deepEqual(rows.map(row => scores.validate(row).score), [8.5, 9, 7]);
});
test('headerless OCR lines infer one trailing score and preserve uncertain columns', () => {
    const rows = parser.fromText('1 Nguyễn Văn An 12A1 8,5\n2 Trần Bình 11B2 0\n3 Lê Chi 10A2 8 9', defaults).rows;
    assert.equal(rows[0].student_name, 'Nguyễn Văn An');
    assert.equal(scores.validate(rows[0]).score, 8.5);
    assert.equal(scores.validate(rows[1]).score, 0);
    assert.equal(rows[2].score, '');
    assert.equal(rows[2].student_name, '');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const scores = require('../assets/exam-scores.js');

const row = (score, period = 'gk1', extra = {}) => ({ score, period, grade: 12, class_name: '12A1', school_year: '2026-2027', published: true, ...extra });

test('accepts zero, ten and comma decimal scores; rejects missing and invalid input', () => {
    for (const [value, expected] of [[0, 0], ['0', 0], ['10', 10], [' 8,75 ', 8.75], ['6.5', 6.5]]) assert.equal(scores.parseScore(value), expected);
    for (const value of ['', ' ', null, undefined, false, [], {}, '1e1', '-1', '11', '10.01', '6.789', '0xA', '8 điểm']) assert.equal(scores.parseScore(value), null);
});

test('validates periods, grade, school year and class before any write', () => {
    assert.deepEqual(scores.validate(row('8,5', 'ck2', { class_name: ' 12A1  ' })), row(8.5, 'ck2'));
    for (const values of [row(11), row(8, 'other'), row(8, 'gk1', { grade: 9 }), row(8, 'gk1', { school_year: '2026-2028' }), row(8, 'gk1', { class_name: ' ' })]) assert.throws(() => scores.validate(values));
    assert.equal(scores.schoolYear(new Date(2026, 6, 1)), '2025-2026');
    assert.equal(scores.schoolYear(new Date(2026, 7, 1)), '2026-2027');
});

test('all score boundaries are counted once, including 0 and 10', () => {
    const result = scores.summarize([0, 4.99, 5, 6.49, 6.5, 7.99, 8, 9.99, 10].map(value => row(value)));
    assert.equal(result.count, 9);
    assert.deepEqual(result.distribution.map(band => band.count), [2, 2, 2, 3]);
    assert.equal(result.histogram[0], 1);
    assert.equal(result.histogram[9], 2);
    assert.equal(result.histogram.reduce((a, b) => a + b, 0), 9);
    assert.equal(result.highest, 10);
    assert.equal(result.passRate, 7 / 9 * 100);
});

test('averages are weighted per result; missing periods stay null, not zero', () => {
    const result = scores.summarize([row(0), row(10), row(8, 'ck1')]);
    assert.equal(result.average, 6);
    assert.deepEqual(result.byPeriod.map(period => period.average), [5, 8, null, null]);
    assert.deepEqual(result.byPeriod.map(period => period.key), ['gk1', 'ck1', 'gk2', 'ck2']);
    const empty = scores.summarize([row(null), row('')]);
    assert.equal(empty.count, 0);
    assert.equal(empty.average, null);
    assert.equal(empty.highest, null);
    assert.equal(empty.passRate, null);
});

test('filters combine without leaking another class, grade, year or term', () => {
    const data = [row(1), row(2, 'ck1'), row(3, 'gk1', { grade: 11 }), row(4, 'gk1', { class_name: '12A2' }), row(5, 'gk1', { school_year: '2025-2026' })];
    assert.deepEqual(scores.filter(data, { grade: '12', class_name: '12A1', school_year: '2026-2027', period: 'gk1' }).map(row => row.score), [1]);
    assert.equal(scores.filter(data, { period: 'all' }).length, 5);
});

test('loads more than 1000 rows for accurate charts and applies public filter on every page', async () => {
    const source = Array.from({ length: 1205 }, (_, id) => ({ ...row(8), id }));
    const ranges = [], filters = [];
    const client = { from(table) {
        assert.equal(table, 'exam_scores');
        return {
            select() { return this; }, order() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
            async range(start, end) { ranges.push([start, end]); return { data: source.slice(start, end + 1), error: null }; }
        };
    } };
    assert.equal((await scores.fetchAll(client, true)).length, 1205);
    assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]]);
    assert.deepEqual(filters, Array(3).fill(['published', true]));
});

test('a later API page failing rejects the whole load, never shows partial statistics', async () => {
    let calls = 0;
    const error = { code: '42501' };
    const client = { from() { return { select() { return this; }, order() { return this; }, async range() { return ++calls === 1 ? { data: Array(500).fill(row(8)) } : { error }; } }; } };
    await assert.rejects(scores.fetchAll(client), value => value === error);
});

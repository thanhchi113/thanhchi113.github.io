const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

test('migration constraints and admin/public RLS in isolated PostgreSQL', async () => {
    const db = new PGlite();
    try {
        // The real helper already exists in production; this fixture exercises both outcomes.
        await db.exec(`
            create role anon;
            create role authenticated;
            grant usage on schema public to anon, authenticated;
            create function public.current_user_is_admin() returns boolean
            language sql stable security invoker as $$
                select coalesce(current_setting('tests.is_admin', true), '') = 'yes'
            $$;
        `);
        const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260907144035_exam_scores.sql'), 'utf8');
        await db.exec(sql);
        const asAdmin = () => db.exec("reset role; set tests.is_admin = 'yes'; set role authenticated;");
        const asUser = () => db.exec("reset role; set tests.is_admin = 'no'; set role authenticated;");
        const asAnon = () => db.exec("reset role; set tests.is_admin = 'no'; set role anon;");
        await asAdmin();
        const { rows } = await db.query(`insert into public.exam_scores (period,score,grade,class_name,school_year,published)
            values ('gk1',0,12,'12A1','2026-2027',true), ('ck1',10,12,'12A1','2026-2027',false) returning id`);
        assert.equal(rows.length, 2);
        assert.equal((await db.query('select * from public.exam_scores')).rows.length, 2);
        await asAnon();
        assert.equal((await db.query('select * from public.exam_scores')).rows.length, 1);
        await assert.rejects(db.exec("delete from public.exam_scores"), error => error.code === '42501');
        await assert.rejects(db.exec("insert into public.exam_scores (period,score,grade,class_name,school_year) values ('gk1',9,12,'12A1','2026-2027')"), error => error.code === '42501');
        await asUser();
        assert.equal((await db.query('select * from public.exam_scores')).rows.length, 1);
        await assert.rejects(db.exec("insert into public.exam_scores (period,score,grade,class_name,school_year) values ('gk1',9,12,'12A1','2026-2027')"), error => error.code === '42501');
        assert.deepEqual((await db.query('update public.exam_scores set score=9 returning id')).rows, []);
        assert.deepEqual((await db.query('delete from public.exam_scores returning id')).rows, []);
        await asAdmin();
        assert.deepEqual((await db.query('select score::text from public.exam_scores order by score')).rows.map(row => row.score), ['0', '10']);
        for (const [period, score, grade, className, year] of [
            ['bad', 8, 12, '12A1', '2026-2027'], ['gk1', -1, 12, '12A1', '2026-2027'], ['gk1', 10.01, 12, '12A1', '2026-2027'],
            ['gk1', 8.555, 12, '12A1', '2026-2027'], ['gk1', 8, 9, '12A1', '2026-2027'], ['gk1', 8, 12, ' ', '2026-2027'], ['gk1', 8, 12, '12A1', '2026-2029']
        ]) {
            await assert.rejects(db.query('insert into public.exam_scores (period,score,grade,class_name,school_year) values ($1,$2,$3,$4,$5)', [period, score, grade, className, year]), error => error.code === '23514');
        }
        assert.equal((await db.query('update public.exam_scores set published=true,score=8.75 where id=$1 returning score::text', [rows[1].id])).rows[0].score, '8.75');
        await asAnon();
        assert.equal((await db.query('select * from public.exam_scores')).rows.length, 2);
        await asAdmin();
        assert.equal((await db.query('delete from public.exam_scores where id=$1 returning id', [rows[0].id])).rows.length, 1);
        assert.equal((await db.query('select * from public.exam_scores')).rows.length, 1);
    } finally { await db.close(); }
});

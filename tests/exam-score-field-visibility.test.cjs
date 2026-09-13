const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const scores = require('../assets/exam-scores.js');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260913203000_exam_score_field_visibility.sql'), 'utf8');
const fields = { show_image: 'evidence_image_path', show_score: 'score', show_class_name: 'class_name', show_grade: 'grade', show_school_year: 'school_year', show_period: 'period' };

test('hidden fields are omitted before filtering, chart calculations and public rendering', () => {
    const source = { student_name: 'Secret', score: 9.75, grade: 12, class_name: 'SecretClass', school_year: '2026-2027', period: 'gk1', evidence_image_path: 'secret.png', evidence_image_name: 'secret.png', hide_student_name: true, ...Object.fromEntries(Object.keys(fields).map(key => [key, false])) };
    const redacted = scores.publicRecord(source);
    for (const key of ['student_name', 'evidence_image_name', ...Object.values(fields)]) assert.equal(redacted[key], null);
    assert.equal(scores.summarize([source]).count, 0);
    assert.equal(scores.summarize([redacted]).highest, null);
    assert.equal(scores.filter([redacted], { class_name: 'SecretClass' }).length, 0);
    const independent = scores.publicRecord({ ...source, show_image: true, show_score: true });
    assert.equal(independent.student_name, null);
    assert.equal(independent.evidence_image_path, 'secret.png');
    assert.equal(independent.score, 9.75);
    assert.equal(source.student_name, 'Secret');
    assert.equal(scores.visibility({ hide_student_name: true }).show_image, false);
});

test('SQL upgrade preserves old privacy, independently redacts fields, protects storage and supports reruns', async () => {
    const db = new PGlite();
    const admin = '00000000-0000-4000-8000-000000000001';
    const viewer = '00000000-0000-4000-8000-000000000002';
    const as = async (role, id = '') => {
        await db.exec('reset role');
        await db.query("select set_config('test.uid', $1, false)", [id]);
        await db.exec(`set role ${role}`);
    };
    const denied = operation => assert.rejects(operation, error => error.code === '42501');
    try {
        await db.exec(`
            create role anon; create role authenticated; create role unrelated_role;
            create schema auth; create schema storage; create schema app_private;
            grant usage on schema public,auth,storage to anon,authenticated,unrelated_role;
            create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
            create function public.current_user_is_admin() returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() = '${admin}'::uuid $$;
            create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
            create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text);
            alter table storage.objects enable row level security;
            grant select,insert,update,delete on storage.objects to anon,authenticated;
        `);
        for (const file of ['20260907144035_exam_scores.sql', '20260908070137_exam_score_student_details.sql', '20260908082007_exam_score_name_privacy.sql']) await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8'));
        await as('authenticated', admin);
        await db.exec(`insert into public.exam_scores (student_name,period,score,grade,class_name,school_year,hide_student_name,evidence_image_path,evidence_image_name)
            values ('Legacy hidden','gk1',9.75,12,'12A1','2026-2027',true,'legacy.png','legacy.png');
            insert into storage.objects (bucket_id,name) values ('exam-score-evidence','legacy.png');`);
        await as('postgres');
        await db.exec(migration);
        assert.equal((await db.query("select show_image from public.exam_scores where student_name='Legacy hidden'")).rows[0].show_image, false);
        await as('authenticated', admin);
        const expected = new Map();
        for (const flag of [null, 'hide_student_name', ...Object.keys(fields)]) {
            const name = flag || 'visible';
            const row = (await db.query(`insert into public.exam_scores (student_name,period,score,grade,class_name,school_year,evidence_image_path,evidence_image_name)
                values ($1,'ck2',8.25,11,'11A3','2025-2026',$2,$2) returning *`, [name, `${name}.png`])).rows[0];
            assert.equal(row.show_image, true);
            if (flag) {
                row[flag] = flag === 'hide_student_name';
                await db.query(`update public.exam_scores set ${flag}=$1 where id=$2`, [row[flag], row.id]);
            }
            await db.query("insert into storage.objects (bucket_id,name) values ('exam-score-evidence',$1)", [row.evidence_image_path]);
            expected.set(row.id, row);
        }
        await db.exec(`insert into public.exam_scores (student_name,period,score,grade,class_name,school_year,published,evidence_image_path)
            values ('SECRET DRAFT','gk1',3,10,'10A1','2026-2027',false,'draft.png');
            insert into storage.objects (bucket_id,name) values ('exam-score-evidence','draft.png'),('exam-score-evidence','orphan.png');`);
        for (const [role, id] of [['anon', ''], ['authenticated', viewer], ['authenticated', '']]) {
            await as(role, id);
            if (role === 'anon') await denied(db.exec('select * from public.exam_scores'));
            else assert.deepEqual((await db.query('select * from public.exam_scores')).rows, []);
            const rows = (await db.query('select * from public.get_published_exam_scores()')).rows;
            assert.equal(rows.length, expected.size + 1);
            for (const result of rows.filter(row => expected.has(row.id))) {
                const raw = expected.get(result.id);
                assert.equal(result.student_name, raw.hide_student_name ? null : raw.student_name);
                for (const [flag, field] of Object.entries(fields)) {
                    assert.equal(result[flag], raw[flag]);
                    assert.equal(result[field], raw[flag] ? raw[field] : null);
                }
                assert.equal(result.evidence_image_name, raw.show_image ? raw.evidence_image_name : null);
            }
            assert.deepEqual((await db.query('select * from app_private.get_published_exam_scores()')).rows, rows, 'The helper must not expose unredacted data');
            const objects = (await db.query('select name from storage.objects')).rows.map(row => row.name);
            assert(objects.includes('hide_student_name.png'), 'Image visibility is independent of name visibility');
            for (const name of ['legacy.png', 'show_image.png', 'draft.png', 'orphan.png']) {
                assert(!objects.includes(name));
                assert.equal((await db.query('select app_private.can_view_exam_evidence($1) as allowed', [name])).rows[0].allowed, false);
            }
            await denied(db.exec("insert into public.exam_scores (student_name,period,score,grade,class_name,school_year) values ('Bad','gk1',1,10,'A','2026-2027')"));
            if (role === 'anon') await denied(db.exec('update public.exam_scores set show_score=true'));
            else assert.deepEqual((await db.query('update public.exam_scores set show_score=true returning id')).rows, []);
            assert.deepEqual((await db.query('delete from storage.objects returning id')).rows, []);
        }
        await as('unrelated_role');
        await denied(db.exec('select * from public.get_published_exam_scores()'));
        await as('authenticated', admin);
        assert.equal((await db.query('select * from public.exam_scores')).rows.length, expected.size + 2);
        assert.equal((await db.query('select * from storage.objects')).rows.length, expected.size + 3);
        const hiddenScore = [...expected.values()].find(row => !row.show_score);
        assert.equal((await db.query('select score from public.exam_scores where id=$1', [hiddenScore.id])).rows[0].score, '8.25');
        const snapshot = (await db.query('select * from public.exam_scores order by id')).rows;
        await as('postgres');
        await db.exec(migration);
        assert.deepEqual((await db.query('select * from public.exam_scores order by id')).rows, snapshot);
        await as('authenticated', admin);
        await db.query('update public.exam_scores set show_score=true where id=$1', [hiddenScore.id]);
        await as('anon');
        assert.equal((await db.query('select score from public.get_published_exam_scores() where id=$1', [hiddenScore.id])).rows[0].score, '8.25');
        await as('authenticated', admin);
        await db.exec("insert into public.exam_scores (student_name,period,score,grade,class_name,school_year) select 'Student '||n,'gk1',8,12,'12A1','2026-2027' from generate_series(1,505) n");
        await as('anon');
        assert.equal((await db.query('select * from public.get_published_exam_scores(-1,9000)')).rows.length, 500);
        assert.equal((await db.query('select * from public.get_published_exam_scores(500,9000)')).rows.length, 14);
    } finally { await db.close(); }
});

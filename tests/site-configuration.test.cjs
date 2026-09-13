const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

test('site configuration protects admin edits and supports custom score catalogues without changing legacy results', async () => {
    const db = new PGlite();
    const admin = '00000000-0000-4000-8000-000000000001';
    const viewer = '00000000-0000-4000-8000-000000000002';
    const submission = '00000000-0000-4000-8000-000000000003';
    const migration = file => fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8');
    const currentMigration = migration('20260913074535_site_content_and_score_options.sql');
    const as = async (role, id = '') => {
        await db.exec('reset role');
        await db.query("select set_config('test.uid', $1, false)", [id]);
        await db.exec(`set role ${role}`);
    };
    const config = async () => (await db.query('select id, value, updated_at::text as updated_at from public.site_configuration order by id')).rows;
    const denied = operation => assert.rejects(operation, error => error.code === '42501');
    const invalid = operation => assert.rejects(operation, error => error.code === '23514');
    try {
        await db.exec(`
            create role anon;
            create role authenticated;
            create schema auth;
            create schema storage;
            grant usage on schema public, auth, storage to anon, authenticated;
            create function auth.uid() returns uuid language sql stable as $$
                select nullif(current_setting('test.uid', true), '')::uuid;
            $$;
            create table auth.users (id uuid primary key, email text);
            create table public.profiles (
                id uuid primary key references auth.users,
                role text default 'viewer' check (role in ('admin', 'viewer')),
                created_at timestamptz default now()
            );
            alter table public.profiles enable row level security;
            grant select on public.profiles to authenticated;
            create policy own_profile on public.profiles for select to authenticated using (id = auth.uid());
            create function public.current_user_is_admin() returns boolean
                language sql stable security definer set search_path = '' as $$
                    select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
                $$;
            create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
            create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text);
            alter table storage.objects enable row level security;
            grant select, insert, update, delete on storage.objects to anon, authenticated;
        `);
        for (const [id, role] of [[admin, 'admin'], [viewer, 'viewer']]) {
            await db.query('insert into auth.users values ($1, $2)', [id, `${role}@example.test`]);
            await db.query('insert into public.profiles (id, role) values ($1, $2)', [id, role]);
        }
        for (const file of [
            '20260907144035_exam_scores.sql',
            '20260908070137_exam_score_student_details.sql',
            '20260908082005_admin_accounts_and_score_submissions.sql'
        ]) await db.exec(migration(file));
        // An older unnamed result must survive both the prior NOT VALID constraint and this migration.
        await db.exec(`insert into public.exam_scores (period, score, grade, class_name, school_year, published)
            values ('gk1', 8.5, 12, '12A1', '2026-2027', true), ('ck2', 6, 11, '11A2', '2025-2026', false)`);
        await db.exec(migration('20260908082007_exam_score_name_privacy.sql'));
        await db.exec(migration('20260908083027_exam_score_statistics_settings.sql'));
        await db.query(`insert into public.exam_score_submissions (id, student_name, period, score, grade, class_name, school_year)
            values ($1, 'Học sinh chờ duyệt', 'gk1', 9, 12, '12A1', '2026-2027')`, [submission]);
        const legacyScores = (await db.query('select * from public.exam_scores order by id')).rows;
        const legacySubmissions = (await db.query('select * from public.exam_score_submissions order by id')).rows;
        const legacySettings = (await db.query('select * from public.exam_score_settings')).rows;
        await db.exec(currentMigration);
        assert.deepEqual((await db.query('select * from public.exam_scores order by id')).rows, legacyScores);
        assert.deepEqual((await db.query('select * from public.exam_score_submissions order by id')).rows, legacySubmissions);
        assert.deepEqual((await db.query('select * from public.exam_score_settings')).rows, legacySettings);

        await as('anon');
        const initial = await config();
        assert.deepEqual(initial.map(({ id, value }) => ({ id, value })), [
            { id: 'score_options', value: {} }, { id: 'site_content', value: {} }
        ]);
        await denied(db.exec("update public.site_configuration set value = '{\"about\":\"tampered\"}' where id = 'site_content'"));
        await denied(db.exec("insert into public.site_configuration (id, value) values ('site_content', '{}')"));
        await denied(db.exec("delete from public.site_configuration where id = 'site_content'"));
        assert.deepEqual(await config(), initial);

        await as('authenticated', viewer);
        assert.deepEqual(await config(), initial);
        assert.equal((await db.query("update public.site_configuration set value = '{\"about\":\"tampered\"}' where id = 'site_content' returning id")).rows.length, 0);
        await denied(db.exec("delete from public.site_configuration where id = 'site_content'"));
        await denied(db.exec("insert into public.site_configuration (id, value) values ('site_content', '{}')"));
        assert.deepEqual(await config(), initial);

        await as('authenticated', admin);
        const content = { about: { description: 'Giới thiệu mới' }, skills: [{ name: 'Toán', value: 95 }], numbers: [{ value: 120, label: 'Học sinh' }] };
        const first = (await db.query(`update public.site_configuration set value = $1::jsonb
            where id = 'site_content' and updated_at = $2::timestamptz
            returning id, value, updated_at::text as updated_at`, [content, initial[1].updated_at])).rows;
        assert.equal(first.length, 1);
        assert.deepEqual(first[0].value, content);
        assert.notEqual(first[0].updated_at, initial[1].updated_at);
        const stale = await db.query(`update public.site_configuration set value = '{"about":"stale"}'
            where id = 'site_content' and updated_at = $1::timestamptz returning id`, [initial[1].updated_at]);
        assert.equal(stale.rows.length, 0, 'A stale editor cannot overwrite a newer saved section');
        assert.deepEqual((await config())[1], first[0]);

        // Two writes sharing a transaction timestamp still receive distinct versions.
        await db.exec('begin');
        const version1 = (await db.query("update public.site_configuration set value = value where id = 'site_content' returning updated_at::text as version")).rows[0].version;
        const version2 = (await db.query("update public.site_configuration set value = value where id = 'site_content' returning updated_at::text as version")).rows[0].version;
        assert.notEqual(version1, version2);
        await db.exec('commit');
        await denied(db.exec("update public.site_configuration set updated_at = '2000-01-01' where id = 'site_content'"));
        await denied(db.exec("update public.site_configuration set id = 'other' where id = 'site_content'"));
        await denied(db.exec("delete from public.site_configuration where id = 'site_content'"));
        await invalid(db.exec("update public.site_configuration set value = '[]' where id = 'site_content'"));
        await invalid(db.exec("update public.site_configuration set value = 'null' where id = 'site_content'"));
        await invalid(db.query("update public.site_configuration set value = $1::jsonb where id = 'site_content'", [{ text: 'a'.repeat(131072) }]));
        await invalid(db.query("update public.site_configuration set value = $1::jsonb where id = 'site_content'", [{ text: 'ệ'.repeat(50000) }]));

        const options = { classes: ['9A1', '12A1'], years: ['2026-2027'], periods: [{ id: 'kiem-tra-15p', label: 'Kiểm tra 15 phút' }], grades: [9, 12] };
        const savedOptions = await db.query("update public.site_configuration set value = $1::jsonb where id = 'score_options' returning value", [options]);
        assert.deepEqual(savedOptions.rows, [{ value: options }]);
        await db.query(`insert into public.exam_scores (student_name, period, score, grade, class_name, school_year)
            values ('Học sinh khối 9', 'kiem-tra-15p', 9.5, 9, '9A1', '2026-2027') returning id`);
        await db.exec("update public.exam_score_settings set enabled_periods = array['gk1', 'kiem-tra-15p'] where id = 1");
        for (const key of ['', 'bad key', 'GK1', '0exam', '<script>', 'a'.repeat(49)]) {
            await invalid(db.query(`insert into public.exam_scores (student_name, period, score, grade, class_name, school_year)
                values ('Invalid', $1, 8, 9, '9A1', '2026-2027')`, [key]));
            await invalid(db.query('update public.exam_score_settings set enabled_periods = $1::text[]', [[key]]));
        }
        for (const grade of [0, 13]) {
            await invalid(db.query(`insert into public.exam_scores (student_name, period, score, grade, class_name, school_year)
                values ('Invalid', 'gk1', 8, $1, '9A1', '2026-2027')`, [grade]));
        }
        await invalid(db.exec("update public.exam_score_settings set enabled_periods = array['gk1', null]"));
        await invalid(db.exec("update public.exam_score_settings set enabled_periods = array[['gk1', 'ck1']]"));
        await invalid(db.query('update public.exam_score_settings set enabled_periods = $1::text[]', [Array.from({ length: 101 }, (_, i) => `exam-${i}`)]));
        await db.exec("update public.exam_score_settings set enabled_periods = '{}'::text[]");
        await db.exec("update public.exam_score_settings set enabled_periods = array['gk1', 'kiem-tra-15p']");

        await as('anon');
        assert.deepEqual((await config())[0].value, options);
        assert.deepEqual((await config())[1].value, content);
        assert.deepEqual((await db.query('select enabled_periods from public.exam_score_settings')).rows[0].enabled_periods, ['gk1', 'kiem-tra-15p']);
        await denied(db.exec('select * from public.exam_scores'));
        assert.equal((await db.query('select * from public.get_published_exam_scores() where grade = 9')).rows.length, 1);
        await db.query(`insert into public.exam_score_submissions (student_name, period, score, grade, class_name, school_year)
            values ('Học sinh lớp 6', 'kiem-tra-15p', 7.25, 6, '6A2', '2026-2027')`);
        await invalid(db.exec(`insert into public.exam_score_submissions (student_name, period, score, grade, class_name, school_year)
            values ('Invalid', 'bad key', 7, 6, '6A2', '2026-2027')`));
        await invalid(db.exec(`insert into public.exam_score_submissions (student_name, period, score, grade, class_name, school_year)
            values ('Invalid', 'gk1', 7, 13, '6A2', '2026-2027')`));
        await denied(db.exec('select * from public.exam_score_submissions'));
        await as('authenticated', admin);
        const pending = (await db.query("select id from public.exam_score_submissions where grade = 6")).rows[0].id;
        const approved = (await db.query('select public.approve_exam_score_submission($1, $2) as id', [pending, {
            student_name: 'Học sinh lớp 6 (đã kiểm tra)', period: 'kiem-tra-15p', score: 7.5,
            grade: 6, class_name: '6A2', school_year: '2026-2027'
        }])).rows[0].id;
        assert.equal((await db.query('select grade from public.exam_scores where id = $1', [approved])).rows[0].grade, 6);
        assert.equal((await db.query('select status from public.exam_score_submissions where id = $1', [pending])).rows[0].status, 'approved');

        // Reapplying setup keeps edited configuration and all pre-existing score data intact.
        const configured = await config();
        await as('postgres');
        await invalid(db.exec("insert into public.site_configuration (id, value) values ('private_data', '{}')"));
        await db.exec(currentMigration);
        assert.deepEqual(await config(), configured);
        assert.deepEqual((await db.query('select * from public.exam_scores where id = any($1::uuid[]) order by id', [legacyScores.map(row => row.id)])).rows, legacyScores);
        assert.deepEqual((await db.query('select * from public.exam_score_submissions where id = $1', [submission])).rows, legacySubmissions);
    } finally {
        await db.close();
    }
});

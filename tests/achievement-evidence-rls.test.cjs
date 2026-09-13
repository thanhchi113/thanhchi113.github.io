const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260913153000_repair_achievement_evidence.sql'), 'utf8');
const admin = '00000000-0000-4000-8000-000000000001';
const viewer = '00000000-0000-4000-8000-000000000002';

test('evidence repair creates the missing schema, preserves data on rerun, and enforces admin/public permissions', async () => {
    const db = new PGlite();
    const as = async (role, id = '') => {
        await db.exec('reset role');
        await db.query("select set_config('test.uid', $1, false)", [id]);
        await db.exec(`set role ${role}`);
    };
    const denied = operation => assert.rejects(operation, error => error.code === '42501');
    try {
        await db.exec(`
            create role anon;
            create role authenticated;
            create role service_role bypassrls;
            create schema auth;
            create schema storage;
            grant usage on schema public, auth, storage to anon, authenticated, service_role;
            create function auth.uid() returns uuid language sql stable as $$
                select nullif(current_setting('test.uid', true), '')::uuid;
            $$;
            create table public.profiles (id uuid primary key, role text not null);
            create function public.current_user_is_admin() returns boolean
                language sql stable security definer set search_path = '' as $$
                    select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
                $$;
            create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
            create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text);
            alter table storage.objects enable row level security;
            grant select, insert, update, delete on storage.objects to anon, authenticated;
            insert into storage.buckets values ('other-bucket', 'other-bucket', false, 1000, array['application/pdf']);
            insert into storage.objects (bucket_id, name) values ('other-bucket', 'keep.pdf');
        `);
        for (const [id, role] of [[admin, 'admin'], [viewer, 'viewer']]) {
            await db.query('insert into public.profiles values ($1, $2)', [id, role]);
        }
        const helperDefinition = (await db.query("select pg_get_functiondef('public.current_user_is_admin()'::regprocedure) as definition")).rows;
        const otherBucket = (await db.query("select * from storage.buckets where id = 'other-bucket'")).rows;
        const otherObject = (await db.query("select * from storage.objects where bucket_id = 'other-bucket'")).rows;
        assert.equal((await db.query("select to_regclass('public.achievement_evidence') as relation")).rows[0].relation, null);

        await db.exec(migration);
        assert.deepEqual((await db.query("select id, public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'achievement-evidence'")).rows, [{
            id: 'achievement-evidence', public: true, file_size_limit: '10485760',
            allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp']
        }]);
        // The repair is independent of the older migration's unrelated tables.
        assert.deepEqual((await db.query("select to_regclass('public.math_requests') as requests, to_regclass('public.document_contributions') as contributions")).rows, [{ requests: null, contributions: null }]);

        await as('authenticated', admin);
        const evidence = (await db.query(`insert into public.achievement_evidence
            (group_key, title, student_name, course_name, school_name, result_summary, description, ocr_text, image_path, image_name, published)
            values ('grade12', 'Kết quả THPT', 'Nguyễn An', 'Toán 12', 'THPT A', '9 điểm', 'Phản hồi học sinh', 'Nội dung ảnh', 'grade12/result.png', 'result.png', true),
                   ('feedback', 'Phản hồi chưa công bố', 'Trần Bình', null, null, null, null, null, 'feedback/draft.png', 'draft.png', false)
            returning id, published`)).rows;
        const publishedId = evidence.find(row => row.published).id;
        const draftId = evidence.find(row => !row.published).id;
        assert.equal((await db.query('select * from public.achievement_evidence')).rows.length, 2);
        const image = (await db.query("insert into storage.objects (bucket_id, name) values ('achievement-evidence', 'grade12/result.png') returning id")).rows[0].id;
        await denied(db.exec('truncate public.achievement_evidence'));
        await assert.rejects(db.exec("insert into public.achievement_evidence (group_key,title,image_path) values ('unsupported','Invalid','x.png')"), error => error.code === '23514');

        for (const [role, id] of [['anon', ''], ['authenticated', viewer], ['authenticated', '']]) {
            await as(role, id);
            assert.deepEqual((await db.query('select id from public.achievement_evidence')).rows, [{ id: publishedId }]);
            await denied(db.exec("insert into public.achievement_evidence (group_key,title,image_path) values ('feedback','Unauthorized','x.png')"));
            if (role === 'anon') {
                await denied(db.exec("update public.achievement_evidence set title = 'Unauthorized'"));
                await denied(db.exec('delete from public.achievement_evidence'));
            } else {
                assert.deepEqual((await db.query("update public.achievement_evidence set title = 'Unauthorized' returning id")).rows, []);
                assert.deepEqual((await db.query('delete from public.achievement_evidence returning id')).rows, []);
            }
            assert.deepEqual((await db.query('select * from storage.objects')).rows, []);
            await denied(db.exec("insert into storage.objects (bucket_id,name) values ('achievement-evidence','unauthorized.png')"));
            assert.deepEqual((await db.query("update storage.objects set name = 'tampered.png' returning id")).rows, []);
            assert.deepEqual((await db.query('delete from storage.objects returning id')).rows, []);
        }

        await as('authenticated', admin);
        assert.deepEqual((await db.query('select id from storage.objects')).rows, [{ id: image }]);
        assert.equal((await db.query("update storage.objects set name = 'grade12/replaced.png' where id = $1 returning id", [image])).rows.length, 1);
        await denied(db.query("update storage.objects set bucket_id = 'other-bucket' where id = $1", [image]));
        await denied(db.exec("insert into storage.objects (bucket_id,name) values ('other-bucket','forbidden.png')"));
        assert.deepEqual((await db.query("delete from storage.objects where bucket_id = 'other-bucket' returning id")).rows, []);
        assert.equal((await db.query("update public.achievement_evidence set title = 'Đã duyệt', published = true where id = $1 returning id", [draftId])).rows.length, 1);
        await as('anon');
        assert.equal((await db.query('select * from public.achievement_evidence')).rows.length, 2);

        // Reapplying setup must not reset records, files, or unrelated buckets.
        await as('postgres');
        const savedRows = (await db.query('select * from public.achievement_evidence order by id')).rows;
        const savedObjects = (await db.query('select * from storage.objects order by id')).rows;
        await db.exec(migration);
        assert.deepEqual((await db.query('select * from public.achievement_evidence order by id')).rows, savedRows);
        assert.deepEqual((await db.query('select * from storage.objects order by id')).rows, savedObjects);
        assert.deepEqual((await db.query("select * from storage.buckets where id = 'other-bucket'")).rows, otherBucket);
        assert.deepEqual((await db.query("select * from storage.objects where bucket_id = 'other-bucket'")).rows, otherObject);
        assert.deepEqual((await db.query("select pg_get_functiondef('public.current_user_is_admin()'::regprocedure) as definition")).rows, helperDefinition);

        await as('authenticated', admin);
        assert.equal((await db.query('delete from public.achievement_evidence where id = $1 returning id', [publishedId])).rows.length, 1);
        assert.equal((await db.query('delete from storage.objects where id = $1 returning id', [image])).rows.length, 1);
        assert.equal((await db.query('select * from public.achievement_evidence')).rows.length, 1);
        assert.deepEqual((await db.query('select * from storage.objects')).rows, []);
        await as('service_role');
        assert.equal((await db.query('select * from public.achievement_evidence')).rows.length, 1);
    } finally {
        await db.close();
    }
});

test('repair fails without replacing or weakening a missing admin helper', async () => {
    const db = new PGlite();
    try {
        await assert.rejects(db.exec(migration), error => error.message.includes('Missing public.current_user_is_admin()'));
        await db.exec('rollback');
        assert.equal((await db.query("select to_regclass('public.achievement_evidence') as relation")).rows[0].relation, null);
        assert.equal((await db.query("select to_regprocedure('public.current_user_is_admin()') as helper")).rows[0].helper, null);
    } finally {
        await db.close();
    }
});

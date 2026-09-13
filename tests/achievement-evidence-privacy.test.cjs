const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260913183000_achievement_evidence_optional_image_privacy.sql'), 'utf8');
const oldRepair = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260913153000_repair_achievement_evidence.sql'), 'utf8');
const admin = '00000000-0000-4000-8000-000000000001';
const viewer = '00000000-0000-4000-8000-000000000002';
const visibility = {
    show_student_name: 'student_name', show_image: 'image_path', show_course_name: 'course_name',
    show_school_name: 'school_name', show_result_summary: 'result_summary', show_description: 'description'
};

async function fixture() {
    const db = new PGlite();
    await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create role unrelated_role;
        create schema auth;
        create schema storage;
        grant usage on schema public, auth, storage to anon, authenticated, service_role, unrelated_role;
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
    await db.query('insert into public.profiles values ($1, $2), ($3, $4)', [admin, 'admin', viewer, 'viewer']);
    const as = async (role, id = '') => {
        await db.exec('reset role');
        await db.query("select set_config('test.uid', $1, false)", [id]);
        await db.exec(`set role ${role}`);
    };
    return { db, as };
}

const denied = operation => assert.rejects(operation, error => error.code === '42501');

test('missing evidence schema supports optional images and independently redacts every hidden field for guests', async () => {
    const { db, as } = await fixture();
    try {
        await db.exec(migration);
        assert.deepEqual((await db.query("select id, public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'achievement-evidence'")).rows, [{
            id: 'achievement-evidence', public: false, file_size_limit: '10485760',
            allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp']
        }]);
        await as('authenticated', admin);
        const expected = new Map();
        for (const flag of [null, ...Object.keys(visibility)]) {
            const label = flag || 'all_visible';
            const row = (await db.query(`insert into public.achievement_evidence
                (group_key,title,student_name,course_name,school_name,result_summary,description,ocr_text,image_path,image_name)
                values ('grade12',$1,'Nguyễn An','Toán 12','THPT A','9 điểm','Phản hồi của học sinh','SECRET OCR',$2,'SECRET image-name.png') returning *`,
            [label, `grade12/${label}.png`])).rows[0];
            if (flag) {
                await db.query(`update public.achievement_evidence set ${flag} = false where id = $1`, [row.id]);
                row[flag] = false;
            }
            await db.query("insert into storage.objects (bucket_id,name) values ('achievement-evidence',$1)", [row.image_path]);
            expected.set(row.id, row);
        }
        const withoutImage = (await db.query(`insert into public.achievement_evidence
            (group_key,title,student_name) values ('grade12','Không cần ảnh','Trần Bình') returning *`)).rows[0];
        expected.set(withoutImage.id, withoutImage);
        assert.equal(withoutImage.image_path, null);
        const draft = (await db.query(`insert into public.achievement_evidence
            (group_key,title,image_path,published) values ('grade12','SECRET DRAFT','grade12/draft.png',false) returning id`)).rows[0];
        await db.exec(`
            insert into storage.objects (bucket_id,name) values ('achievement-evidence','grade12/draft.png'),('achievement-evidence','orphan.png');
            insert into public.achievement_evidence (group_key,title) values ('feedback','Nhóm khác');
        `);
        await denied(db.exec('truncate public.achievement_evidence'));
        await assert.rejects(db.exec("insert into public.achievement_evidence (group_key,title) values ('bad','Invalid')"), error => error.code === '23514');
        await assert.rejects(db.exec("update public.achievement_evidence set show_image = null"), error => error.code === '23502');

        for (const [role, id] of [['anon', ''], ['authenticated', viewer], ['authenticated', '']]) {
            await as(role, id);
            if (role === 'anon') await denied(db.exec('select * from public.achievement_evidence'));
            else assert.deepEqual((await db.query('select * from public.achievement_evidence')).rows, []);
            const publicRows = (await db.query("select * from public.get_published_achievement_evidence('grade12')")).rows;
            assert.equal(publicRows.length, expected.size);
            for (const result of publicRows) {
                const original = expected.get(result.id);
                assert.ok(original);
                assert.equal('ocr_text' in result, false);
                assert.equal('image_name' in result, false);
                for (const [flag, field] of Object.entries(visibility)) {
                    assert.equal(result[flag], original[flag]);
                    assert.equal(result[field], original[flag] ? original[field] : null);
                }
            }
            assert.equal(JSON.stringify(publicRows).includes('SECRET'), false);
            assert.deepEqual((await db.query("select * from public.get_published_achievement_evidence('no-such-group')")).rows, []);
            assert.equal((await db.query("select * from public.get_published_achievement_evidence('feedback')")).rows.length, 1);
            assert.equal((await db.query("select * from public.get_published_achievement_evidence('grade12',0,1)")).rows.length, 1);
            assert.equal((await db.query("select * from public.get_published_achievement_evidence('grade12',1,500)")).rows.length, expected.size - 1);
            const visibleObjects = (await db.query('select name from storage.objects order by name')).rows.map(row => row.name);
            assert.equal(visibleObjects.length, 6);
            assert.equal(visibleObjects.includes('grade12/show_student_name.png'), true, 'name and image controls must be independent');
            for (const objectName of ['grade12/show_image.png', 'grade12/draft.png', 'orphan.png', 'unknown.png']) {
                assert.equal((await db.query('select app_private.can_view_achievement_evidence($1) as allowed', [objectName])).rows[0].allowed, false);
                assert.deepEqual((await db.query('select * from storage.objects where name = $1', [objectName])).rows, []);
            }
            assert.equal((await db.query("select app_private.can_view_achievement_evidence('grade12/all_visible.png') as allowed")).rows[0].allowed, true);
            await denied(db.exec("insert into public.achievement_evidence (group_key,title) values ('feedback','Unauthorized')"));
            await denied(db.exec("insert into storage.objects (bucket_id,name) values ('achievement-evidence','unauthorized.png')"));
            if (role === 'anon') {
                await denied(db.exec("update public.achievement_evidence set show_image = true"));
                await denied(db.exec('delete from public.achievement_evidence'));
            } else {
                assert.deepEqual((await db.query('update public.achievement_evidence set show_image = true returning id')).rows, []);
                assert.deepEqual((await db.query('delete from public.achievement_evidence returning id')).rows, []);
            }
            assert.deepEqual((await db.query("update storage.objects set name = 'tampered.png' returning id")).rows, []);
            assert.deepEqual((await db.query('delete from storage.objects returning id')).rows, []);
        }

        await as('unrelated_role');
        await denied(db.exec("select * from public.get_published_achievement_evidence('grade12')"));
        await as('authenticated', admin);
        assert.equal((await db.query('select * from public.achievement_evidence')).rows.length, 10);
        assert.equal((await db.query('select * from storage.objects')).rows.length, 9);
        assert.equal((await db.query('select ocr_text from public.achievement_evidence where title = $1', ['all_visible'])).rows[0].ocr_text, 'SECRET OCR');
        await denied(db.exec("insert into storage.objects (bucket_id,name) values ('other-bucket','forbidden.png')"));
        assert.deepEqual((await db.query("delete from storage.objects where bucket_id = 'other-bucket' returning id")).rows, []);
        await denied(db.exec("update storage.objects set bucket_id = 'other-bucket' where name = 'grade12/all_visible.png'"));

        const visible = [...expected.values()].find(row => row.title === 'all_visible');
        await db.query('update public.achievement_evidence set show_image = false where id = $1', [visible.id]);
        await as('anon');
        assert.equal((await db.query('select image_path from public.get_published_achievement_evidence($1) where id = $2', ['grade12', visible.id])).rows[0].image_path, null);
        assert.deepEqual((await db.query("select * from storage.objects where name = 'grade12/all_visible.png'")).rows, []);
        await as('authenticated', admin);
        await db.query('update public.achievement_evidence set show_image = true, image_path = null, image_name = null where id = $1', [visible.id]);
        await as('anon');
        assert.deepEqual((await db.query("select * from storage.objects where name = 'grade12/all_visible.png'")).rows, []);
        await as('authenticated', admin);
        assert.equal((await db.query("delete from storage.objects where name = 'grade12/all_visible.png' returning id")).rows.length, 1);
        assert.equal((await db.query('delete from public.achievement_evidence where id = $1 returning id', [draft.id])).rows.length, 1);

        // Pagination remains bounded even when a caller passes a large limit.
        await db.exec("insert into public.achievement_evidence (group_key,title) select 'grade10','Mẫu ' || n from generate_series(1,505) n");
        await as('anon');
        assert.equal((await db.query("select count(*)::integer as total from public.get_published_achievement_evidence('grade10',-1,9000)")).rows[0].total, 500);
        assert.equal((await db.query("select count(*)::integer as total from public.get_published_achievement_evidence('grade10',500,9000)")).rows[0].total, 5);
        assert.equal((await db.query("select count(*)::integer as total from public.get_published_achievement_evidence('grade10',null,null)")).rows[0].total, 500);
    } finally { await db.close(); }
});

test('upgrading the original public-image table preserves rows, objects, admin helper, and toggles on rerun', async () => {
    const { db, as } = await fixture();
    try {
        await db.exec(oldRepair);
        await db.exec(`
            insert into public.achievement_evidence (group_key,title,student_name,image_path,image_name,ocr_text)
            values ('feedback','Phản hồi từ Nguyễn An','Nguyễn An','feedback/old.png','old.png','OCR cũ');
            insert into storage.objects (bucket_id,name) values ('achievement-evidence','feedback/old.png');
        `);
        const original = (await db.query('select * from public.achievement_evidence')).rows[0];
        const savedObjects = (await db.query('select * from storage.objects order by id')).rows;
        const helperDefinition = (await db.query("select pg_get_functiondef('public.current_user_is_admin()'::regprocedure) as definition")).rows;
        const otherBucket = (await db.query("select * from storage.buckets where id = 'other-bucket'")).rows;
        await db.exec(migration);
        const upgraded = (await db.query('select * from public.achievement_evidence')).rows[0];
        for (const field of Object.keys(original)) assert.deepEqual(upgraded[field], original[field], field);
        for (const flag of Object.keys(visibility)) assert.equal(upgraded[flag], true);
        await as('authenticated', admin);
        await db.query(`update public.achievement_evidence set show_student_name = false, show_image = false,
            show_course_name = false, show_school_name = false, show_result_summary = false, show_description = false where id = $1`, [original.id]);
        await db.exec("insert into public.achievement_evidence (group_key,title) values ('grade10','Không kèm ảnh')");
        await as('postgres');
        const savedRows = (await db.query('select * from public.achievement_evidence order by id')).rows;
        await db.exec(migration);
        assert.deepEqual((await db.query('select * from public.achievement_evidence order by id')).rows, savedRows);
        assert.deepEqual((await db.query('select * from storage.objects order by id')).rows, savedObjects);
        assert.deepEqual((await db.query("select * from storage.buckets where id = 'other-bucket'")).rows, otherBucket);
        assert.deepEqual((await db.query("select pg_get_functiondef('public.current_user_is_admin()'::regprocedure) as definition")).rows, helperDefinition);
        assert.equal((await db.query("select public from storage.buckets where id = 'achievement-evidence'")).rows[0].public, false);
        // A link to the legacy repair has already been shared with the owner.
        // Running that older file must fail before restoring raw table/image access.
        await assert.rejects(db.exec(oldRepair), error => error.message.includes('20260913183000_achievement_evidence_optional_image_privacy.sql'));
        await db.exec('rollback');
        assert.equal((await db.query("select public from storage.buckets where id = 'achievement-evidence'")).rows[0].public, false);
        assert.deepEqual((await db.query('select * from public.achievement_evidence order by id')).rows, savedRows);
        await as('anon');
        await denied(db.exec('select * from public.achievement_evidence'));
        const redacted = (await db.query("select * from public.get_published_achievement_evidence('feedback')")).rows[0];
        assert.equal(redacted.title, 'Phản hồi từ học sinh');
        for (const [flag, field] of Object.entries(visibility)) {
            assert.equal(redacted[flag], false);
            assert.equal(redacted[field], null);
        }
        assert.deepEqual((await db.query("select * from storage.objects where name = 'feedback/old.png'")).rows, []);
        await as('authenticated', viewer);
        assert.deepEqual((await db.query('select * from public.achievement_evidence')).rows, []);
        await as('service_role');
        assert.equal((await db.query('select * from public.achievement_evidence')).rows.length, 2);
    } finally { await db.close(); }
});

test('optional-image setup refuses to bypass a missing admin helper and rolls back all schema changes', async () => {
    const db = new PGlite();
    try {
        await assert.rejects(db.exec(migration), error => error.message.includes('Missing public.current_user_is_admin()'));
        await db.exec('rollback');
        assert.equal((await db.query("select to_regclass('public.achievement_evidence') as relation")).rows[0].relation, null);
        assert.equal((await db.query("select to_regprocedure('public.current_user_is_admin()') as helper")).rows[0].helper, null);
    } finally { await db.close(); }
});

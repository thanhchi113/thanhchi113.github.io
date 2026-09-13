const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260913230000_repair_material_requests_and_pdf_contributions.sql'), 'utf8');
const admin = '00000000-0000-4000-8000-000000000001';
const viewer = '00000000-0000-4000-8000-000000000002';
const contribution = '00000000-0000-4000-8000-000000000003';

for (const legacy of [false, true]) test(`request/PDF repair: ${legacy ? 'existing requests' : 'missing tables'}, permissions and repeatability`, async () => {
    const db = new PGlite();
    const as = async (role, id = '') => {
        await db.exec('reset role');
        await db.query("select set_config('test.uid',$1,false)", [id]);
        await db.exec(`set role ${role}`);
    };
    const denied = operation => assert.rejects(operation, error => error.code === '42501');
    try {
        await db.exec(`
            create role anon; create role authenticated; create role unrelated_role;
            create schema auth; create schema storage;
            grant usage on schema public,auth,storage to anon,authenticated,unrelated_role;
            create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
            create function public.current_user_is_admin() returns boolean language sql stable security definer set search_path='' as $$ select auth.uid()='${admin}'::uuid $$;
            create table public.math_categories (id bigint primary key, name text);
            insert into public.math_categories values (1,'Toán 12');
            grant select on public.math_categories to anon,authenticated;
            create table storage.buckets (id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
            create table storage.objects (id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text);
            alter table storage.objects enable row level security;
            grant select,insert,update,delete on storage.objects to anon,authenticated;
            insert into storage.buckets values ('achievement-evidence','achievement-evidence',false,10485760,array['image/png']);
            insert into storage.objects (bucket_id,name) values ('achievement-evidence','keep.png');
            create table public.achievement_evidence (id integer primary key,title text,show_image boolean);
            insert into public.achievement_evidence values (1,'Keep private evidence',false);
        `);
        if (legacy) await db.exec(`
            create table public.math_requests (
                id bigserial primary key, name text,email text,category_id bigint references public.math_categories(id) on delete set null,
                request_text text not null,status text not null default 'pending',admin_note text,created_at timestamptz not null default now()
            );
            insert into public.math_requests (name,email,category_id,request_text,admin_note) values ('Legacy student','private@example.test',1,'Keep this request','Keep this note');
            alter table public.math_requests enable row level security;
            grant all on public.math_requests to anon,authenticated;
            create policy legacy_read on public.math_requests for select using (true);
        `);
        const adminFunction = (await db.query("select pg_get_functiondef('public.current_user_is_admin()'::regprocedure) as definition")).rows[0].definition;
        await db.exec(migration);
        assert.equal((await db.query("select pg_get_functiondef('public.current_user_is_admin()'::regprocedure) as definition")).rows[0].definition, adminFunction);
        if (legacy) {
            const row = (await db.query("select * from public.math_requests where name='Legacy student'")).rows[0];
            assert.equal(row.request_text, 'Keep this request');
            assert.equal(row.admin_note, 'Keep this note');
            assert.equal(row.reviewed_at, null);
            assert(row.updated_at);
        }
        const bucket = (await db.query("select * from storage.buckets where id='document-submissions'")).rows[0];
        assert.equal(bucket.public, false);
        assert.equal(bucket.file_size_limit, 15728640);
        assert.deepEqual(bucket.allowed_mime_types, ['application/pdf']);

        // Public forms insert without selecting private queue data back to the browser.
        await as('anon');
        await db.exec("insert into public.math_requests (name,email,category_id,request_text,status) values ('New student','new@example.test',1,'More algebra exercises','pending')");
        await db.query(`insert into public.document_contributions (id,title,category_id,contributor_name,contributor_email,file_path,file_name,file_size,status)
            values ($1,'Practice PDF',1,'New student','new@example.test','submissions/new.pdf','new.pdf',4096,'pending')`, [contribution]);
        await db.exec("insert into storage.objects (bucket_id,name) values ('document-submissions','submissions/new.pdf')");
        for (const [role, id] of [['anon',''],['authenticated',viewer]]) {
            await as(role,id);
            if (role === 'anon') {
                await denied(db.exec('select * from public.math_requests'));
                await denied(db.exec('select * from public.document_contributions'));
                await denied(db.exec("update public.math_requests set status='approved'"));
                await denied(db.exec('delete from public.document_contributions'));
            } else {
                assert.deepEqual((await db.query('select * from public.math_requests')).rows, []);
                assert.deepEqual((await db.query('select * from public.document_contributions')).rows, []);
                assert.deepEqual((await db.query("update public.math_requests set status='approved' returning id")).rows, []);
                assert.deepEqual((await db.query('delete from public.document_contributions returning id')).rows, []);
            }
            assert.deepEqual((await db.query('select * from storage.objects')).rows, []);
            assert.deepEqual((await db.query('delete from storage.objects returning id')).rows, []);
            await denied(db.exec("insert into public.math_requests (request_text,status) values ('Bypass review','approved')"));
            await denied(db.exec("insert into public.math_requests (request_text,admin_note) values ('Forged','approved by admin')"));
            await denied(db.exec("insert into public.document_contributions (title,file_path,file_name,status) values ('Forged','submissions/forged.pdf','forged.pdf','approved')"));
            await denied(db.exec("insert into public.document_contributions (title,file_path,file_name,reviewed_at) values ('Forged','submissions/forged.pdf','forged.pdf',now())"));
            await denied(db.exec("insert into storage.objects (bucket_id,name) values ('document-submissions','submissions/not-pdf.exe')"));
            await denied(db.exec("insert into storage.objects (bucket_id,name) values ('achievement-evidence','submissions/no-access.pdf')"));
        }
        await as('authenticated',admin);
        const requests = (await db.query('select r.id,r.reviewed_at,r.updated_at,c.name from public.math_requests r left join public.math_categories c on c.id=r.category_id')).rows;
        assert.equal(requests.length, legacy ? 2 : 1);
        assert(requests.every(row => row.name === 'Toán 12'));
        assert.equal((await db.query('select * from public.document_contributions')).rows.length, 1);
        assert.deepEqual((await db.query('select name from storage.objects')).rows, [{ name:'submissions/new.pdf' }]);
        assert.equal((await db.query("update public.math_requests set status='approved',reviewed_at=now(),updated_at=now() where request_text='More algebra exercises' returning id")).rows.length, 1);
        assert.equal((await db.query("update public.math_requests set status='rejected',reviewed_at=now(),updated_at=now() where request_text='More algebra exercises' returning id")).rows.length, 1);
        assert.equal((await db.query("update public.document_contributions set status='approved',reviewed_at=now(),updated_at=now() where id=$1 returning id", [contribution])).rows.length, 1);

        await as('postgres');
        const snapshot = (await db.query('select * from public.math_requests order by id')).rows;
        const pdfSnapshot = (await db.query('select * from public.document_contributions')).rows;
        await db.exec(migration);
        assert.deepEqual((await db.query('select * from public.math_requests order by id')).rows, snapshot);
        assert.deepEqual((await db.query('select * from public.document_contributions')).rows, pdfSnapshot);
        assert.equal((await db.query("select public from storage.buckets where id='achievement-evidence'")).rows[0].public, false);
        assert.deepEqual((await db.query('select * from public.achievement_evidence')).rows, [{ id:1,title:'Keep private evidence',show_image:false }]);
        assert.equal((await db.query("select count(*)::integer as count from storage.objects where name='keep.png'")).rows[0].count, 1);
        await as('authenticated',admin);
        assert.equal((await db.query('delete from public.document_contributions where id=$1 returning id', [contribution])).rows.length, 1);
        assert.equal((await db.query("delete from storage.objects where bucket_id='document-submissions' and name='submissions/new.pdf' returning id")).rows.length, 1);
        assert.equal((await db.query("delete from public.math_requests where request_text='More algebra exercises' returning id")).rows.length, 1);
        await as('unrelated_role');
        await denied(db.exec('select * from public.math_requests'));
    } finally { await db.close(); }
});

-- Repair Admin > Minh chung without rerunning the unrelated request migrations.
-- Safe to run again: existing evidence rows and stored images are retained.
-- Chay toan bo tep trong Supabase SQL Editor cua du an uiyqdqucqplifcvukwul.
-- Ket qua cuoi: evidence_table = achievement_evidence, evidence_bucket_ready = true.
begin;

-- Reuse the site's existing admin check. Never replace it with a permissive fallback.
do $$
begin
    if to_regprocedure('public.current_user_is_admin()') is null then
        raise exception 'Missing public.current_user_is_admin(); configure the existing admin roles first.';
    end if;
end;
$$;

create table if not exists public.achievement_evidence (
    id uuid primary key default gen_random_uuid(),
    group_key text not null check (group_key in ('grade10', 'grade12', 'feedback')),
    title text not null,
    student_name text,
    course_name text,
    school_name text,
    result_summary text,
    description text,
    ocr_text text,
    image_path text not null,
    image_name text,
    sort_order integer not null default 0,
    published boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists achievement_evidence_group_sort_idx
    on public.achievement_evidence (group_key, sort_order, created_at desc);

alter table public.achievement_evidence enable row level security;

-- Table privileges are explicit because new Supabase projects may not grant them
-- automatically. RLS still limits writes and unpublished records to real admins.
revoke all privileges on table public.achievement_evidence from public, anon, authenticated;
grant select on table public.achievement_evidence to anon;
grant select, insert, update, delete on table public.achievement_evidence to authenticated;
grant all privileges on table public.achievement_evidence to service_role;

drop policy if exists "Public can view published achievement evidence" on public.achievement_evidence;
create policy "Public can view published achievement evidence"
    on public.achievement_evidence for select to anon, authenticated
    using (published = true);

drop policy if exists "Admins can manage achievement evidence" on public.achievement_evidence;
create policy "Admins can manage achievement evidence"
    on public.achievement_evidence for all to authenticated
    using ((select public.current_user_is_admin()))
    with check ((select public.current_user_is_admin()));

-- The website already uses public URLs for evidence images. Keep that contract,
-- the existing 10 MB limit and accepted image types; do not delete any objects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'achievement-evidence',
    'achievement-evidence',
    true,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Storage SELECT is also required for admin updates/removals of stored images.
-- Public bucket downloads do not require listing access to storage.objects.
drop policy if exists "Admins can view achievement evidence" on storage.objects;
create policy "Admins can view achievement evidence"
    on storage.objects for select to authenticated
    using (bucket_id = 'achievement-evidence' and (select public.current_user_is_admin()));

drop policy if exists "Admins can upload achievement evidence" on storage.objects;
create policy "Admins can upload achievement evidence"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'achievement-evidence' and (select public.current_user_is_admin()));

drop policy if exists "Admins can update achievement evidence" on storage.objects;
create policy "Admins can update achievement evidence"
    on storage.objects for update to authenticated
    using (bucket_id = 'achievement-evidence' and (select public.current_user_is_admin()))
    with check (bucket_id = 'achievement-evidence' and (select public.current_user_is_admin()));

drop policy if exists "Admins can delete achievement evidence" on storage.objects;
create policy "Admins can delete achievement evidence"
    on storage.objects for delete to authenticated
    using (bucket_id = 'achievement-evidence' and (select public.current_user_is_admin()));

-- Delivered only after COMMIT so PostgREST sees the completed schema.
notify pgrst, 'reload schema';
commit;

-- Read-only confirmation for SQL Editor; does not expose student information.
select
    to_regclass('public.achievement_evidence') as evidence_table,
    exists (select 1 from storage.buckets where id = 'achievement-evidence') as evidence_bucket_ready;

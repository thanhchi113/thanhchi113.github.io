-- Minh chung co the khong kem anh; tung truong co quyen hien thi rieng.
-- Chay TOAN BO tep nay trong Supabase SQL Editor. Co the chay lai an toan.
-- Tep nay da bao gom sua bang bi thieu. KHONG chay lai migration repair cu
-- 20260913153000 sau tep nay, vi repair cu mo bucket anh cho cong khai.
-- Giu nguyen du lieu va tep da tai len. Anh an chi duoc admin truy cap.
begin;

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
    image_path text,
    image_name text,
    sort_order integer not null default 0,
    published boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.achievement_evidence alter column image_path drop not null;
alter table public.achievement_evidence
    add column if not exists show_student_name boolean not null default true,
    add column if not exists show_image boolean not null default true,
    add column if not exists show_course_name boolean not null default true,
    add column if not exists show_school_name boolean not null default true,
    add column if not exists show_result_summary boolean not null default true,
    add column if not exists show_description boolean not null default true;

create index if not exists achievement_evidence_group_sort_idx
    on public.achievement_evidence (group_key, sort_order, created_at desc);
create index if not exists achievement_evidence_visible_image_idx
    on public.achievement_evidence (image_path)
    where published = true and show_image = true and image_path is not null;

alter table public.achievement_evidence enable row level security;
revoke all privileges on table public.achievement_evidence from public, anon, authenticated;
grant select, insert, update, delete on table public.achievement_evidence to authenticated;
grant all privileges on table public.achievement_evidence to service_role;

-- Guests and signed-in non-admins must use the sanitized RPC below.
drop policy if exists "Public can view published achievement evidence" on public.achievement_evidence;
drop policy if exists "Admins can manage achievement evidence" on public.achievement_evidence;
create policy "Admins can manage achievement evidence"
    on public.achievement_evidence for all to authenticated
    using ((select public.current_user_is_admin()))
    with check ((select public.current_user_is_admin()));

create schema if not exists app_private;

create or replace function app_private.get_published_achievement_evidence(
    evidence_group text, page_offset integer default 0, page_limit integer default 500
)
returns table (
    id uuid, group_key text, title text, student_name text, course_name text,
    school_name text, result_summary text, description text, image_path text,
    sort_order integer, created_at timestamptz, show_student_name boolean,
    show_image boolean, show_course_name boolean, show_school_name boolean,
    show_result_summary boolean, show_description boolean
)
language sql stable security definer set search_path = '' as $$
    select e.id, e.group_key,
        case when e.show_student_name = false and nullif(btrim(e.student_name), '') is not null
            then replace(e.title, e.student_name, 'học sinh') else e.title end,
        case when e.show_student_name then e.student_name else null end,
        case when e.show_course_name then e.course_name else null end,
        case when e.show_school_name then e.school_name else null end,
        case when e.show_result_summary then e.result_summary else null end,
        case when e.show_description then e.description else null end,
        case when e.show_image then e.image_path else null end,
        e.sort_order, e.created_at, e.show_student_name, e.show_image,
        e.show_course_name, e.show_school_name, e.show_result_summary, e.show_description
    from public.achievement_evidence e
    where e.published = true and (evidence_group is null or e.group_key = evidence_group)
    order by e.sort_order asc, e.created_at desc, e.id desc
    limit greatest(1, least(500, coalesce(page_limit, 500)))
    offset greatest(0, coalesce(page_offset, 0));
$$;

create or replace function public.get_published_achievement_evidence(
    evidence_group text, page_offset integer default 0, page_limit integer default 500
)
returns table (
    id uuid, group_key text, title text, student_name text, course_name text,
    school_name text, result_summary text, description text, image_path text,
    sort_order integer, created_at timestamptz, show_student_name boolean,
    show_image boolean, show_course_name boolean, show_school_name boolean,
    show_result_summary boolean, show_description boolean
)
language sql stable security invoker set search_path = '' as $$
    select * from app_private.get_published_achievement_evidence(evidence_group, page_offset, page_limit);
$$;

create or replace function app_private.can_view_achievement_evidence(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.achievement_evidence e
        where e.image_path = object_name and e.published = true and e.show_image = true
    );
$$;

revoke all on function app_private.get_published_achievement_evidence(text, integer, integer) from public;
revoke all on function public.get_published_achievement_evidence(text, integer, integer) from public;
revoke all on function app_private.can_view_achievement_evidence(text) from public;
grant usage on schema app_private to anon, authenticated;
grant execute on function app_private.get_published_achievement_evidence(text, integer, integer) to anon, authenticated;
grant execute on function public.get_published_achievement_evidence(text, integer, integer) to anon, authenticated;
grant execute on function app_private.can_view_achievement_evidence(text) to anon, authenticated;

-- A private bucket is necessary: CSS hiding cannot revoke a public image URL.
-- Existing files stay in place. Clients request signed URLs lasting 60 seconds.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('achievement-evidence', 'achievement-evidence', false, 10485760,
    array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Published achievement evidence can be viewed" on storage.objects;
create policy "Published achievement evidence can be viewed"
    on storage.objects for select to anon, authenticated
    using (bucket_id = 'achievement-evidence' and app_private.can_view_achievement_evidence(name));

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

notify pgrst, 'reload schema';
commit;

-- Read-only SQL Editor confirmation; no names, content, or image paths exposed.
select
    to_regclass('public.achievement_evidence') as evidence_table,
    exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'achievement_evidence'
        and column_name = 'image_path' and is_nullable = 'YES') as image_is_optional,
    (select count(*) = 6 from information_schema.columns
        where table_schema = 'public' and table_name = 'achievement_evidence'
        and column_name in ('show_student_name', 'show_image', 'show_course_name',
            'show_school_name', 'show_result_summary', 'show_description')) as visibility_fields_ready,
    exists (select 1 from storage.buckets
        where id = 'achievement-evidence' and public = false) as evidence_bucket_private,
    to_regprocedure('public.get_published_achievement_evidence(text,integer,integer)') is not null as public_rpc_ready;

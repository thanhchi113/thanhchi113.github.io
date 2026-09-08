-- Run after 20260907144035_exam_scores.sql and 20260908070137_exam_score_student_details.sql.
-- Adds the student review inbox and narrowly scoped admin account operations.
begin;

create table public.exam_score_submissions (
    id uuid primary key default gen_random_uuid(),
    student_name text not null check (char_length(btrim(student_name)) between 1 and 160),
    period text not null check (period in ('gk1','ck1','gk2','ck2')),
    score numeric not null check (score >= 0 and score <= 10 and scale(score) <= 2),
    grade smallint not null check (grade in (10,11,12)),
    class_name text not null check (char_length(btrim(class_name)) between 1 and 80),
    school_year text not null check (school_year ~ '^20[0-9]{2}-20[0-9]{2}$' and right(school_year,4)::integer = left(school_year,4)::integer + 1),
    evidence_image_path text check (evidence_image_path is null or evidence_image_path ~ ('^' || id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$')),
    evidence_image_name text check (evidence_image_name is null or char_length(evidence_image_name) between 1 and 255),
    status text not null default 'pending' check (status in ('pending','approved')),
    created_at timestamptz not null default now()
);
create index exam_score_submissions_pending_idx on public.exam_score_submissions (created_at desc,id desc) where status = 'pending';
alter table public.exam_score_submissions enable row level security;
revoke all on public.exam_score_submissions from public,anon,authenticated;
grant insert (id,student_name,period,score,grade,class_name,school_year,evidence_image_path,evidence_image_name,status) on public.exam_score_submissions to anon,authenticated;
grant select,update,delete on public.exam_score_submissions to authenticated;
create policy "Students can submit pending scores" on public.exam_score_submissions
for insert to anon,authenticated with check (status = 'pending');
create policy "Admins can read score submissions" on public.exam_score_submissions
for select to authenticated using ((select public.current_user_is_admin()));
create policy "Admins can update score submissions" on public.exam_score_submissions
for update to authenticated using ((select public.current_user_is_admin())) with check ((select public.current_user_is_admin()));
create policy "Admins can delete score submissions" on public.exam_score_submissions
for delete to authenticated using ((select public.current_user_is_admin()));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('exam-score-submissions','exam-score-submissions',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "Students can upload score confirmation" on storage.objects for insert to anon,authenticated
with check (bucket_id='exam-score-submissions' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$');
create policy "Admins can view submitted score confirmation" on storage.objects for select to authenticated
using (bucket_id='exam-score-submissions' and (select public.current_user_is_admin()));
create policy "Admins can delete submitted score confirmation" on storage.objects for delete to authenticated
using (bucket_id='exam-score-submissions' and (select public.current_user_is_admin()));

-- The caller remains subject to table RLS. Locking prevents duplicate approval.
create function public.approve_exam_score_submission(submission_id uuid, details jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare pending_row public.exam_score_submissions; score_id uuid; image_path text;
begin
    if auth.uid() is null or not public.current_user_is_admin() then
        raise exception 'Chỉ admin được duyệt điểm.' using errcode='42501';
    end if;
    select * into pending_row from public.exam_score_submissions where id=submission_id for update;
    if not found or pending_row.status <> 'pending' then
        raise exception 'Yêu cầu đã được xử lý hoặc không còn tồn tại.' using errcode='P0002';
    end if;
    image_path := nullif(details->>'evidence_image_path','');
    if image_path is not null and (image_path !~ '^scores/[0-9a-f-]{36}\.(jpg|png|webp)$' or not exists (
        select 1 from storage.objects where bucket_id='exam-score-evidence' and name=image_path
    )) then
        raise exception 'Ảnh xác nhận chưa được tải lên.' using errcode='22023';
    end if;
    if nullif(btrim(details->>'student_name'),'') is null then
        raise exception 'Vui lòng nhập tên học sinh.' using errcode='22023';
    end if;
    insert into public.exam_scores (student_name,period,score,grade,class_name,school_year,published,evidence_image_path,evidence_image_name)
    values (btrim(details->>'student_name'),details->>'period',(details->>'score')::numeric,(details->>'grade')::smallint,
        btrim(details->>'class_name'),details->>'school_year',true,image_path,nullif(details->>'evidence_image_name','')) returning id into score_id;
    update public.exam_score_submissions set status='approved' where id=submission_id;
    return score_id;
end;
$$;
revoke all on function public.approve_exam_score_submission(uuid,jsonb) from public,anon;
grant execute on function public.approve_exam_score_submission(uuid,jsonb) to authenticated;

-- Profile roles and auth emails are private. Only these checked operations cross that boundary.
create schema if not exists app_private;
revoke all on schema app_private from public,anon;
grant usage on schema app_private to authenticated;
create function app_private.list_admin_accounts()
returns table(id uuid,email text,created_at timestamptz,is_current boolean)
language plpgsql stable security definer set search_path='' as $$
begin
    if auth.uid() is null or not public.current_user_is_admin() then
        raise exception 'Chỉ admin được quản lý tài khoản.' using errcode='42501';
    end if;
    return query select p.id,u.email::text,p.created_at,p.id=auth.uid()
    from public.profiles p join auth.users u on u.id=p.id where p.role='admin' order by p.created_at,p.id;
end;
$$;
create function app_private.revoke_admin_access(target_user_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
    if auth.uid() is null or not public.current_user_is_admin() then
        raise exception 'Chỉ admin được thu hồi quyền.' using errcode='42501';
    end if;
    -- Serialize role changes and recheck the caller after acquiring the locks.
    perform p.id from public.profiles p where p.role='admin' order by p.id for update;
    if not public.current_user_is_admin() then
        raise exception 'Quyền admin của bạn đã thay đổi.' using errcode='42501';
    end if;
    if target_user_id=auth.uid() then raise exception 'Không thể tự thu hồi quyền admin của mình.' using errcode='22023'; end if;
    if (select count(*) from public.profiles where role='admin') <= 1 then
        raise exception 'Phải giữ lại ít nhất một admin.' using errcode='22023';
    end if;
    update public.profiles set role='viewer' where id=target_user_id and role='admin';
    if not found then raise exception 'Tài khoản không còn quyền admin.' using errcode='P0002'; end if;
    return true;
end;
$$;
revoke all on function app_private.list_admin_accounts() from public,anon;
revoke all on function app_private.revoke_admin_access(uuid) from public,anon;
grant execute on function app_private.list_admin_accounts() to authenticated;
grant execute on function app_private.revoke_admin_access(uuid) to authenticated;
create function public.list_admin_accounts()
returns table(id uuid,email text,created_at timestamptz,is_current boolean)
language sql stable security invoker set search_path='' as $$ select * from app_private.list_admin_accounts(); $$;
create function public.revoke_admin_access(target_user_id uuid)
returns boolean language sql security invoker set search_path='' as $$ select app_private.revoke_admin_access(target_user_id); $$;
revoke all on function public.list_admin_accounts() from public,anon;
revoke all on function public.revoke_admin_access(uuid) from public,anon;
grant execute on function public.list_admin_accounts() to authenticated;
grant execute on function public.revoke_admin_access(uuid) to authenticated;

commit;

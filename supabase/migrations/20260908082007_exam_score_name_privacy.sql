begin;
alter table public.exam_scores add column hide_student_name boolean not null default false;
-- Legacy unnamed records are preserved, but every new/edited record must contain a name.
alter table public.exam_scores add constraint exam_scores_student_name_required check (student_name is not null and char_length(btrim(student_name)) between 1 and 160) not valid;

-- This function intentionally serves guests: only published, redacted fields can leave the database.
create function app_private.get_published_exam_scores(page_offset integer default 0,page_limit integer default 500)
returns table(id uuid,student_name text,period text,score numeric,grade smallint,class_name text,school_year text,published boolean,created_at timestamptz,evidence_image_path text,evidence_image_name text,hide_student_name boolean)
language sql stable security definer set search_path='' as $$
    select s.id,case when s.hide_student_name then null else s.student_name end,s.period,s.score,s.grade,s.class_name,s.school_year,s.published,s.created_at,
        case when s.hide_student_name then null else s.evidence_image_path end,
        case when s.hide_student_name then null else s.evidence_image_name end,s.hide_student_name
    from public.exam_scores s where s.published=true order by s.created_at desc,s.id desc
    limit greatest(1,least(500,coalesce(page_limit,500))) offset greatest(0,coalesce(page_offset,0));
$$;
create function public.get_published_exam_scores(page_offset integer default 0,page_limit integer default 500)
returns table(id uuid,student_name text,period text,score numeric,grade smallint,class_name text,school_year text,published boolean,created_at timestamptz,evidence_image_path text,evidence_image_name text,hide_student_name boolean)
language sql stable security invoker set search_path='' as $$ select * from app_private.get_published_exam_scores(page_offset,page_limit); $$;
create function app_private.can_view_exam_evidence(object_name text)
returns boolean language sql stable security definer set search_path='' as $$
    select exists(select 1 from public.exam_scores where evidence_image_path=object_name and published=true and hide_student_name=false);
$$;
revoke all on function app_private.get_published_exam_scores(integer,integer) from public;
revoke all on function public.get_published_exam_scores(integer,integer) from public;
revoke all on function app_private.can_view_exam_evidence(text) from public;
grant usage on schema app_private to anon,authenticated;
grant execute on function app_private.get_published_exam_scores(integer,integer) to anon,authenticated;
grant execute on function public.get_published_exam_scores(integer,integer) to anon,authenticated;
grant execute on function app_private.can_view_exam_evidence(text) to anon,authenticated;

-- Public clients must use the sanitized endpoint, including signed-in non-admins.
drop policy "Public can read published exam scores" on public.exam_scores;
revoke select on public.exam_scores from anon;
drop policy "Published exam evidence can be viewed" on storage.objects;
create policy "Published exam evidence can be viewed" on storage.objects for select to anon,authenticated
using (bucket_id='exam-score-evidence' and app_private.can_view_exam_evidence(name));
commit;

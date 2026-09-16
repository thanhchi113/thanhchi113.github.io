-- Link the same student across GK/CK score records with an optional stable tag.
begin;
alter table public.exam_scores add column if not exists student_tag text;
alter table public.exam_scores drop constraint if exists exam_scores_student_tag_check;
alter table public.exam_scores add constraint exam_scores_student_tag_check
  check (student_tag is null or char_length(btrim(student_tag)) between 1 and 100);
create index if not exists exam_scores_student_tag_idx on public.exam_scores (lower(student_tag))
  where student_tag is not null;
drop function if exists public.get_published_exam_scores(integer, integer);
drop function if exists app_private.get_published_exam_scores(integer, integer);
create function app_private.get_published_exam_scores(page_offset integer default 0, page_limit integer default 500)
returns table (
 id uuid, student_name text, student_tag text, period text, score numeric, grade smallint,
 class_name text, school_year text, published boolean, created_at timestamptz,
 evidence_image_path text, evidence_image_name text, hide_student_name boolean,
 show_image boolean, show_score boolean, show_class_name boolean, show_grade boolean,
 show_school_year boolean, show_period boolean
) language sql stable security definer set search_path = '' as $$
 select s.id,
   case when not s.hide_student_name then s.student_name end,
   case when not s.hide_student_name then s.student_tag end,
   case when s.show_period then s.period end,
   case when s.show_score then s.score end,
   case when s.show_grade then s.grade end,
   case when s.show_class_name then s.class_name end,
   case when s.show_school_year then s.school_year end,
   s.published, s.created_at,
   case when s.show_image then s.evidence_image_path end,
   case when s.show_image then s.evidence_image_name end,
   s.hide_student_name, s.show_image, s.show_score, s.show_class_name,
   s.show_grade, s.show_school_year, s.show_period
 from public.exam_scores s where s.published = true
 order by s.created_at desc, s.id desc
 limit greatest(1, least(500, coalesce(page_limit, 500))) offset greatest(0, coalesce(page_offset, 0));
$$;
create function public.get_published_exam_scores(page_offset integer default 0, page_limit integer default 500)
returns table (
 id uuid, student_name text, student_tag text, period text, score numeric, grade smallint,
 class_name text, school_year text, published boolean, created_at timestamptz,
 evidence_image_path text, evidence_image_name text, hide_student_name boolean,
 show_image boolean, show_score boolean, show_class_name boolean, show_grade boolean,
 show_school_year boolean, show_period boolean
) language sql stable security invoker set search_path = '' as $$
 select * from app_private.get_published_exam_scores(page_offset, page_limit);
$$;
revoke all on function app_private.get_published_exam_scores(integer, integer) from public;
revoke all on function public.get_published_exam_scores(integer, integer) from public;
grant usage on schema app_private to anon, authenticated;
grant execute on function app_private.get_published_exam_scores(integer, integer) to anon, authenticated;
grant execute on function public.get_published_exam_scores(integer, integer) to anon, authenticated;
notify pgrst, 'reload schema';
commit;

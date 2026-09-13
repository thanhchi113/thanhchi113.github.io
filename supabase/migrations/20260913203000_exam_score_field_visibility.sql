-- Independent public visibility for exam score cards. Run after the existing score migrations.
-- Raw student data and attachments remain available to administrators.
begin;

alter table public.exam_scores add column if not exists show_image boolean;
-- Only initialize unconfigured rows. Rerunning must preserve every saved preference.
update public.exam_scores set show_image = not hide_student_name where show_image is null;
alter table public.exam_scores alter column show_image set default true;
alter table public.exam_scores alter column show_image set not null;
alter table public.exam_scores add column if not exists show_score boolean not null default true;
alter table public.exam_scores add column if not exists show_class_name boolean not null default true;
alter table public.exam_scores add column if not exists show_grade boolean not null default true;
alter table public.exam_scores add column if not exists show_school_year boolean not null default true;
alter table public.exam_scores add column if not exists show_period boolean not null default true;

-- The return shape changes, so recreate both functions inside this transaction.
drop function public.get_published_exam_scores(integer, integer);
drop function app_private.get_published_exam_scores(integer, integer);

create function app_private.get_published_exam_scores(page_offset integer default 0, page_limit integer default 500)
returns table (
    id uuid, student_name text, period text, score numeric, grade smallint,
    class_name text, school_year text, published boolean, created_at timestamptz,
    evidence_image_path text, evidence_image_name text, hide_student_name boolean,
    show_image boolean, show_score boolean, show_class_name boolean, show_grade boolean,
    show_school_year boolean, show_period boolean
)
language sql stable security definer set search_path = '' as $$
    select s.id,
        case when not s.hide_student_name then s.student_name end,
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
    from public.exam_scores s
    where s.published = true
    order by s.created_at desc, s.id desc
    limit greatest(1, least(500, coalesce(page_limit, 500)))
    offset greatest(0, coalesce(page_offset, 0));
$$;

create function public.get_published_exam_scores(page_offset integer default 0, page_limit integer default 500)
returns table (
    id uuid, student_name text, period text, score numeric, grade smallint,
    class_name text, school_year text, published boolean, created_at timestamptz,
    evidence_image_path text, evidence_image_name text, hide_student_name boolean,
    show_image boolean, show_score boolean, show_class_name boolean, show_grade boolean,
    show_school_year boolean, show_period boolean
)
language sql stable security invoker set search_path = '' as $$
    select * from app_private.get_published_exam_scores(page_offset, page_limit);
$$;

create or replace function app_private.can_view_exam_evidence(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.exam_scores
        where evidence_image_path = object_name and published = true and show_image = true
    );
$$;

revoke all on function app_private.get_published_exam_scores(integer, integer) from public;
revoke all on function public.get_published_exam_scores(integer, integer) from public;
revoke all on function app_private.can_view_exam_evidence(text) from public;
grant usage on schema app_private to anon, authenticated;
grant execute on function app_private.get_published_exam_scores(integer, integer) to anon, authenticated;
grant execute on function public.get_published_exam_scores(integer, integer) to anon, authenticated;
grant execute on function app_private.can_view_exam_evidence(text) to anon, authenticated;

-- Public readers can only receive sanitized RPC output, even when signed in.
alter table public.exam_scores enable row level security;
drop policy if exists "Public can read published exam scores" on public.exam_scores;
revoke select on public.exam_scores from anon;
update storage.buckets set public = false where id = 'exam-score-evidence';
notify pgrst, 'reload schema';
commit;

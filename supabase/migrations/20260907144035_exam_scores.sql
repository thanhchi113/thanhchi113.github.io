-- Apply in Supabase SQL Editor after reviewing. Does not alter existing data.
-- Reuses the same admin authorization function as the existing admin page.
begin;

create table public.exam_scores (
    id uuid primary key default gen_random_uuid(),
    period text not null check (period in ('gk1', 'ck1', 'gk2', 'ck2')),
    score numeric not null check (score >= 0 and score <= 10 and scale(score) <= 2),
    grade smallint not null check (grade in (10, 11, 12)),
    class_name text not null check (char_length(btrim(class_name)) between 1 and 80),
    school_year text not null check (
        school_year ~ '^20[0-9]{2}-20[0-9]{2}$'
        and right(school_year, 4)::integer = left(school_year, 4)::integer + 1
    ),
    published boolean not null default true,
    created_at timestamptz not null default now()
);

comment on table public.exam_scores is
    'One math exam result per row. No student names or contact information. Published results feed public aggregate charts.';

create index exam_scores_created_id_idx on public.exam_scores (created_at desc, id desc);

alter table public.exam_scores enable row level security;
revoke all on public.exam_scores from public, anon, authenticated;
grant select on public.exam_scores to anon;
grant select, insert, update, delete on public.exam_scores to authenticated;

create policy "Public can read published exam scores"
    on public.exam_scores for select to anon, authenticated
    using (published = true);

create policy "Admins can manage exam scores"
    on public.exam_scores for all to authenticated
    using ((select public.current_user_is_admin()))
    with check ((select public.current_user_is_admin()));

commit;

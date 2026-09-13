-- Website copy and score catalogues contain only content intended for public display.
-- Apply after the existing exam-score migrations. Existing results and submissions are retained.
begin;

create table if not exists public.site_configuration (
    id text primary key check (id in ('site_content', 'score_options')),
    value jsonb not null default '{}'::jsonb
        check (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 131072),
    updated_at timestamptz not null default now()
);

comment on table public.site_configuration is
    'Published website section copy and score input catalogues only. Do not store student details, credentials or private drafts here.';

alter table public.site_configuration enable row level security;
revoke all on public.site_configuration from public, anon, authenticated;
grant select on public.site_configuration to anon, authenticated;
-- Stable rows are seeded below. Clients may change only their value, never their identity or version.
grant update (value) on public.site_configuration to authenticated;

drop policy if exists "Anyone can read published site configuration" on public.site_configuration;
create policy "Anyone can read published site configuration"
    on public.site_configuration for select to anon, authenticated using (true);
drop policy if exists "Admins can update site configuration" on public.site_configuration;
create policy "Admins can update site configuration"
    on public.site_configuration for update to authenticated
    using ((select public.current_user_is_admin()))
    with check ((select public.current_user_is_admin()));

create or replace function app_private.set_site_configuration_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
    -- A strictly newer version also protects very fast writes in the same transaction.
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    return new;
end;
$$;
revoke all on function app_private.set_site_configuration_updated_at() from public, anon, authenticated;
drop trigger if exists site_configuration_updated_at on public.site_configuration;
create trigger site_configuration_updated_at before update on public.site_configuration
    for each row execute function app_private.set_site_configuration_updated_at();

insert into public.site_configuration (id, value)
values ('site_content', '{}'::jsonb), ('score_options', '{}'::jsonb)
on conflict (id) do nothing;

-- Labels live in score_options; stored result keys remain bounded, stable ASCII identifiers.
alter table public.exam_scores drop constraint if exists exam_scores_period_check;
alter table public.exam_scores add constraint exam_scores_period_check
    check (period ~ '^[a-z][a-z0-9_-]{0,47}$');
alter table public.exam_scores drop constraint if exists exam_scores_grade_check;
alter table public.exam_scores add constraint exam_scores_grade_check check (grade between 1 and 12);
alter table public.exam_score_submissions drop constraint if exists exam_score_submissions_period_check;
alter table public.exam_score_submissions add constraint exam_score_submissions_period_check
    check (period ~ '^[a-z][a-z0-9_-]{0,47}$');
alter table public.exam_score_submissions drop constraint if exists exam_score_submissions_grade_check;
alter table public.exam_score_submissions add constraint exam_score_submissions_grade_check check (grade between 1 and 12);

create or replace function app_private.valid_exam_period_keys(period_keys text[])
returns boolean language sql immutable security invoker set search_path = '' as $$
    select period_keys is not null
        and cardinality(period_keys) <= 100
        and coalesce(array_ndims(period_keys), 1) = 1
        and not exists (
            select 1 from unnest(period_keys) as candidate(key)
            where key is null or key !~ '^[a-z][a-z0-9_-]{0,47}$'
        );
$$;
revoke all on function app_private.valid_exam_period_keys(text[]) from public;
grant execute on function app_private.valid_exam_period_keys(text[]) to anon, authenticated;
alter table public.exam_score_settings drop constraint if exists exam_score_settings_enabled_periods_check;
alter table public.exam_score_settings add constraint exam_score_settings_enabled_periods_check
    check (app_private.valid_exam_period_keys(enabled_periods));

commit;

begin;
create table public.exam_score_settings (
    id smallint primary key default 1 check(id=1),
    statistics_enabled boolean not null default true,
    summary_enabled boolean not null default true,
    bar_enabled boolean not null default true,
    pie_enabled boolean not null default true,
    line_enabled boolean not null default true,
    enabled_periods text[] not null default array['gk1','ck1','gk2','ck2']
        check(enabled_periods <@ array['gk1','ck1','gk2','ck2']::text[] and array_position(enabled_periods,null) is null)
);
insert into public.exam_score_settings(id) values(1);
alter table public.exam_score_settings enable row level security;
revoke all on public.exam_score_settings from public,anon,authenticated;
grant select on public.exam_score_settings to anon,authenticated;
grant update(statistics_enabled,summary_enabled,bar_enabled,pie_enabled,line_enabled,enabled_periods) on public.exam_score_settings to authenticated;
create policy "Anyone can read statistics display settings" on public.exam_score_settings for select to anon,authenticated using(true);
create policy "Admins can configure statistics display" on public.exam_score_settings for update to authenticated
using((select public.current_user_is_admin())) with check((select public.current_user_is_admin()));
commit;

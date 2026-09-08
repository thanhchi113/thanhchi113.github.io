begin;

alter table public.exam_scores
    add column student_name text check (student_name is null or char_length(btrim(student_name)) between 1 and 160),
    add column evidence_image_path text,
    add column evidence_image_name text;

comment on table public.exam_scores is
    'Student math exam results; published rows include student name and optional evidence photo. Drafts are visible to admins only.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exam-score-evidence', 'exam-score-evidence', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Published exam evidence can be viewed"
on storage.objects for select to anon, authenticated
using (bucket_id = 'exam-score-evidence' and exists (
    select 1 from public.exam_scores s where s.evidence_image_path = name and s.published = true
));

create policy "Admins can view exam evidence"
on storage.objects for select to authenticated
using (bucket_id = 'exam-score-evidence' and (select public.current_user_is_admin()));

create policy "Admins can upload exam evidence"
on storage.objects for insert to authenticated
with check (bucket_id = 'exam-score-evidence' and (select public.current_user_is_admin()));

create policy "Admins can delete exam evidence"
on storage.objects for delete to authenticated
using (bucket_id = 'exam-score-evidence' and (select public.current_user_is_admin()));

create index exam_scores_published_evidence_idx on public.exam_scores (evidence_image_path)
where published = true and evidence_image_path is not null;

commit;

alter table if exists public.math_documents
  add column if not exists cover_enabled boolean not null default true;
comment on column public.math_documents.cover_enabled is 'Whether the optional PDF cover is shown; false falls back to rendered page 1.';

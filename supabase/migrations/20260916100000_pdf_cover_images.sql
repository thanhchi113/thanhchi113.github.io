-- Optional cover image for PDF cards. When null, the frontend renders page 1 of the PDF.
alter table if exists public.math_documents
  add column if not exists thumbnail_path text;

comment on column public.math_documents.thumbnail_path is
  'Optional image cover stored in math-pdfs; null falls back to rendered PDF page 1.';

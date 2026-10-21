-- Run once in the Supabase SQL editor before deploying the Edge Function.
create table if not exists public.bcc_student_password_reset_audit (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users(id),
  student_id uuid not null references auth.users(id),
  reset_at timestamptz not null default now()
);
alter table public.bcc_student_password_reset_audit enable row level security;
-- Admin read-only policy is added by SECURITY_FIXES_2026-10-21.sql; only the service role writes audit records.
create index if not exists bcc_student_password_reset_student_idx on public.bcc_student_password_reset_audit(student_id,reset_at desc);

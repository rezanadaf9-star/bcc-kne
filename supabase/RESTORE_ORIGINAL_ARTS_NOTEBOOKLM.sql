-- BCC PORTAL — restore the original no-stream architecture and add Class 12 Arts + AI Study Hub
-- Run this on the EXISTING BCC Supabase project before using this new frontend.
-- It preserves Auth users, profiles, student IDs and existing Class 10 data.

create extension if not exists pgcrypto;

-- Ensure the AI resource table exists before any optional stream column cleanup.
create table if not exists public.notebooklm_resources (
  id uuid primary key default gen_random_uuid(),
  class_no integer not null check (class_no in (10,12)),
  subject_id uuid references public.subjects(id) on delete set null,
  resource_type text not null check (resource_type in ('notes','lecture','doubt','ai')),
  title text not null,
  description text,
  url text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Remove stream-dependent policies/functions from the earlier experimental multi-stream version.
drop policy if exists subjects_class_stream_select on public.subjects;
drop policy if exists lectures_class_stream_select on public.lectures;
drop policy if exists notes_class_stream_select on public.notes;
drop policy if exists homework_class_stream_select on public.homework;
drop policy if exists quizzes_class_stream_select on public.quizzes;
drop policy if exists notebooklm_class_stream_select on public.notebooklm_resources;
drop policy if exists notebooklm_student_select on public.notebooklm_resources;
drop policy if exists notebooklm_staff_write on public.notebooklm_resources;
drop view if exists public.quiz_questions_public;
drop function if exists public.student_can_access(integer,text);
drop function if exists public.my_stream();

-- Remove stream columns if the earlier experiment added them.
alter table public.student_profiles drop column if exists stream;
alter table public.subjects drop column if exists stream;
alter table public.lectures drop column if exists stream;
alter table public.notes drop column if exists stream;
alter table public.homework drop column if exists stream;
alter table public.quizzes drop column if exists stream;
alter table public.notebooklm_resources drop column if exists stream;
drop index if exists public.ux_subject_class_stream;
drop index if exists public.ux_subjects_class_stream_name;

create or replace function public.my_class()
returns integer language sql stable security definer set search_path=public
as $$ select sp.class_no from public.student_profiles sp where sp.user_id=auth.uid(); $$;

create or replace view public.quiz_questions_public
as
select q.id,q.quiz_id,q.position,q.question_text,q.option_a,q.option_b,q.option_c,q.option_d
from public.quiz_questions q
join public.quizzes z on z.id=q.quiz_id
where z.is_active=true and (z.class_no=public.my_class() or public.is_staff());
-- Do not run this view with the creator's permissions. This addresses the
-- Supabase Security Advisor finding for SECURITY DEFINER views.
alter view public.quiz_questions_public set (security_invoker = true);
grant select on public.quiz_questions_public to authenticated;

-- Restore class-only RLS.
drop policy if exists subjects_class_select on public.subjects;
create policy subjects_class_select on public.subjects for select to authenticated
using (public.is_staff() or class_no=public.my_class());
drop policy if exists subjects_staff_write on public.subjects;
create policy subjects_staff_write on public.subjects for all to authenticated
using (public.is_staff()) with check (public.is_staff());

drop policy if exists lectures_class_select on public.lectures;
create policy lectures_class_select on public.lectures for select to authenticated
using (public.is_staff() or class_no=public.my_class());
drop policy if exists lectures_staff_write on public.lectures;
create policy lectures_staff_write on public.lectures for all to authenticated
using (public.is_staff()) with check (public.is_staff());

drop policy if exists notes_class_select on public.notes;
create policy notes_class_select on public.notes for select to authenticated
using (public.is_staff() or class_no=public.my_class());
drop policy if exists notes_staff_write on public.notes;
create policy notes_staff_write on public.notes for all to authenticated
using (public.is_staff()) with check (public.is_staff());

drop policy if exists homework_class_select on public.homework;
create policy homework_class_select on public.homework for select to authenticated
using (public.is_staff() or class_no=public.my_class());
drop policy if exists homework_staff_write on public.homework;
create policy homework_staff_write on public.homework for all to authenticated
using (public.is_staff()) with check (public.is_staff());

drop policy if exists quizzes_class_select on public.quizzes;
create policy quizzes_class_select on public.quizzes for select to authenticated
using (public.is_staff() or class_no=public.my_class());
drop policy if exists quizzes_staff_write on public.quizzes;
create policy quizzes_staff_write on public.quizzes for all to authenticated
using (public.is_staff()) with check (public.is_staff());

create table if not exists public.notebooklm_resources (
  id uuid primary key default gen_random_uuid(),
  class_no integer not null check (class_no in (10,12)),
  subject_id uuid references public.subjects(id) on delete set null,
  resource_type text not null check (resource_type in ('notes','lecture','doubt','ai')),
  title text not null,
  description text,
  url text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.notebooklm_resources enable row level security;
drop policy if exists notebooklm_class_select on public.notebooklm_resources;
create policy notebooklm_class_select on public.notebooklm_resources for select to authenticated
using (public.is_staff() or (is_active=true and class_no=public.my_class()));
drop policy if exists notebooklm_staff_write on public.notebooklm_resources;
create policy notebooklm_staff_write on public.notebooklm_resources for all to authenticated
using (public.is_staff()) with check (public.is_staff());

insert into public.subjects(class_no,name)
select 12, v.name
from (values
  ('History'),('Geography'),('Political Science'),('Economics'),('Hindi'),('Urdu'),('English')
) as v(name)
where not exists (
  select 1 from public.subjects s where s.class_no=12 and s.name=v.name
);

-- Old Class 12 Science/Commerce rows, if present, are intentionally preserved in the database.
-- The new frontend only exposes the seven Arts subjects requested for this version.

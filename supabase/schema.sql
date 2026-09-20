
-- BCC PORTAL — Supabase schema
-- Run this entire file in Supabase SQL Editor on a new project.
-- Auth users are created server-side by the admin-create-user Edge Function.
-- Passwords are never stored in these public tables.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('student','teacher','admin')),
  full_name text not null,
  login_id text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.student_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  class_no integer not null check (class_no in (10,12)),
  roll_number text,
  batch text not null check (batch in ('26','27')),
  created_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  class_no integer not null check (class_no in (10,12)),
  name text not null,
  created_at timestamptz not null default now(),
  unique(class_no,name)
);

create table if not exists public.lectures (
  id uuid primary key default gen_random_uuid(),
  class_no integer not null check (class_no in (10,12)),
  subject_id uuid not null references public.subjects(id) on delete restrict,
  title text not null,
  description text,
  youtube_url text,
  file_path text,
  is_live boolean not null default false,
  downloadable boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (youtube_url is not null or file_path is not null or is_live = true)
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  class_no integer not null check (class_no in (10,12)),
  subject_id uuid not null references public.subjects(id) on delete restrict,
  title text not null,
  file_path text not null,
  file_type text not null check (file_type in ('pdf','jpg','jpeg','png')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.homework (
  id uuid primary key default gen_random_uuid(),
  class_no integer not null check (class_no in (10,12)),
  subject_id uuid not null references public.subjects(id) on delete restrict,
  title text not null,
  instructions text,
  file_path text,
  due_date date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  class_no integer not null check (class_no in (10,12)),
  subject_id uuid references public.subjects(id) on delete restrict,
  title text not null,
  quiz_type text not null check (quiz_type in ('Weekly','Monthly','Chapter-wise')),
  duration_minutes integer not null default 30 check (duration_minutes > 0),
  total_marks numeric not null default 0,
  start_at timestamptz,
  end_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  position integer not null,
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text,
  option_d text,
  correct_option text not null check (correct_option in ('A','B','C','D')),
  correct_marks numeric not null default 4,
  wrong_marks numeric not null default -1,
  explanation text,
  unique(quiz_id,position)
);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  score numeric not null,
  total_marks numeric not null,
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  unattempted_count integer not null default 0,
  submitted_at timestamptz not null default now()
);

create table if not exists public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  selected_option text check (selected_option in ('A','B','C','D')),
  status text not null check (status in ('correct','wrong','unattempted')),
  marks_awarded numeric not null default 0
);

create index if not exists idx_students_class on public.student_profiles(class_no);
create index if not exists idx_lectures_class_subject on public.lectures(class_no,subject_id);
create index if not exists idx_notes_class_subject on public.notes(class_no,subject_id);
create index if not exists idx_homework_class_subject on public.homework(class_no,subject_id);
create index if not exists idx_quizzes_class_active on public.quizzes(class_no,is_active);
create unique index if not exists ux_one_attempt_per_quiz_student on public.quiz_attempts(quiz_id,student_id);
create index if not exists idx_attempts_student on public.quiz_attempts(student_id,submitted_at desc);


-- Helper functions for RLS.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('teacher','admin')); $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'); $$;

create or replace function public.my_class()
returns integer language sql stable security definer set search_path=public
as $$ select sp.class_no from public.student_profiles sp where sp.user_id=auth.uid(); $$;

-- Public question view: NEVER exposes correct_option, marks or explanations to students.
drop view if exists public.quiz_questions_public;
create or replace view public.quiz_questions_public
as
select q.id,q.quiz_id,q.position,q.question_text,q.option_a,q.option_b,q.option_c,q.option_d
from public.quiz_questions q
join public.quizzes z on z.id=q.quiz_id
where z.is_active=true
  and (z.class_no=public.my_class() or public.is_staff());

grant select on public.quiz_questions_public to authenticated;

-- Storage bucket for private BCC content.
insert into storage.buckets(id,name,public)
values('bcc-content','bcc-content',false)
on conflict(id) do update set public=false;

-- RLS.
alter table public.profiles enable row level security;
alter table public.student_profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.lectures enable row level security;
alter table public.notes enable row level security;
alter table public.homework enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;

drop policy if exists profiles_self_or_staff_select on public.profiles;
create policy profiles_self_or_staff_select on public.profiles for select to authenticated
using (id=auth.uid() or public.is_staff());

drop policy if exists student_self_or_staff_select on public.student_profiles;
create policy student_self_or_staff_select on public.student_profiles for select to authenticated
using (user_id=auth.uid() or public.is_staff());

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

-- Only staff can directly see the answer key.
drop policy if exists quiz_questions_staff_select on public.quiz_questions;
create policy quiz_questions_staff_select on public.quiz_questions for select to authenticated
using (public.is_staff());
drop policy if exists quiz_questions_staff_write on public.quiz_questions;
create policy quiz_questions_staff_write on public.quiz_questions for all to authenticated
using (public.is_staff()) with check (public.is_staff());

drop policy if exists attempts_self_or_staff_select on public.quiz_attempts;
create policy attempts_self_or_staff_select on public.quiz_attempts for select to authenticated
using (student_id=auth.uid() or public.is_staff());
drop policy if exists attempts_staff_insert on public.quiz_attempts;
create policy attempts_staff_insert on public.quiz_attempts for insert to authenticated
with check (public.is_staff());
-- Students submit through the Edge Function using service-role privileges.

drop policy if exists answers_self_or_staff_select on public.quiz_answers;
create policy answers_self_or_staff_select on public.quiz_answers for select to authenticated
using (public.is_staff() or exists(select 1 from public.quiz_attempts a where a.id=attempt_id and a.student_id=auth.uid()));
drop policy if exists answers_staff_insert on public.quiz_answers;
create policy answers_staff_insert on public.quiz_answers for insert to authenticated
with check (public.is_staff());

-- Storage RLS: path convention type/class/filename.
drop policy if exists bcc_storage_read on storage.objects;
create policy bcc_storage_read on storage.objects for select to authenticated
using (
  bucket_id='bcc-content'
  and (
    public.is_staff()
    or split_part(name,'/',2)::integer=public.my_class()
  )
);

drop policy if exists bcc_storage_insert on storage.objects;
create policy bcc_storage_insert on storage.objects for insert to authenticated
with check (bucket_id='bcc-content' and public.is_staff());

drop policy if exists bcc_storage_update on storage.objects;
create policy bcc_storage_update on storage.objects for update to authenticated
using (bucket_id='bcc-content' and public.is_staff())
with check (bucket_id='bcc-content' and public.is_staff());

drop policy if exists bcc_storage_delete on storage.objects;
create policy bcc_storage_delete on storage.objects for delete to authenticated
using (bucket_id='bcc-content' and public.is_staff());

-- Seed subjects. Add/edit these later from SQL if the coaching centre uses different subjects.
insert into public.subjects(class_no,name) values
(10,'Mathematics'),(10,'Science'),(10,'English'),(10,'Hindi'),(10,'Social Science'),
(12,'History'),(12,'Geography'),(12,'Political Science'),(12,'Economics'),(12,'Hindi'),(12,'Urdu'),(12,'English')
on conflict(class_no,name) do nothing;



-- NotebookLM / Gemini resource links published by staff.
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
create index if not exists idx_notebooklm_class on public.notebooklm_resources(class_no,is_active,created_at desc);
alter table public.notebooklm_resources enable row level security;
drop policy if exists notebooklm_class_select on public.notebooklm_resources;
create policy notebooklm_class_select on public.notebooklm_resources for select to authenticated
using (public.is_staff() or (is_active=true and class_no=public.my_class()));
drop policy if exists notebooklm_staff_write on public.notebooklm_resources;
create policy notebooklm_staff_write on public.notebooklm_resources for all to authenticated
using (public.is_staff()) with check (public.is_staff());

-- IMPORTANT:
-- Create the first admin Auth user manually in Supabase Dashboard:
-- Authentication > Users > Add user.
-- Use any real email/password temporarily, then update its email to the
-- synthetic ID email used by this portal, e.g. admin@students.bcc-portal.invalid,
-- and create a matching profile row:
--
-- insert into public.profiles(id,role,full_name,login_id)
-- values('<AUTH_USER_UUID>','admin','BCC Administrator','ADMIN');
--
-- Then the portal Teacher tab can use ID ADMIN and that password.

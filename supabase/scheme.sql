
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

-- ============================================================
-- Secure quiz sessions + leaderboard support (included for new installs)
-- ============================================================
-- BCC Portal: secure quiz sessions + student/admin leaderboards
-- Run this ONCE in the existing Supabase project's SQL Editor before deploying
-- the updated frontend and Edge Functions.
--
-- This migration is additive. It does not delete existing users, quizzes,
-- attempts, answers, content, or Auth accounts.

create extension if not exists pgcrypto;

alter table public.quiz_attempts
  add column if not exists started_at timestamptz,
  add column if not exists submission_reason text;

create table if not exists public.quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  status text not null default 'in_progress'
    check (status in ('in_progress','submitted','expired')),
  submission_reason text,
  created_at timestamptz not null default now(),
  unique(quiz_id, student_id)
);

create index if not exists idx_quiz_sessions_student
  on public.quiz_sessions(student_id, created_at desc);

alter table public.quiz_sessions enable row level security;

drop policy if exists quiz_sessions_self_select on public.quiz_sessions;
create policy quiz_sessions_self_select
on public.quiz_sessions for select to authenticated
using (student_id = auth.uid() or public.is_staff());

-- The browser never writes quiz_sessions directly. The Edge Functions use
-- service-role privileges after authenticating the current user.

drop function if exists public.get_quiz_questions_public(uuid);

-- Secure public question RPC used by the quiz UI. It NEVER exposes answers,
-- marks, or explanations.
create or replace function public.get_quiz_questions_public(p_quiz_id uuid)
returns table(
  id uuid,
  quiz_id uuid,
  position integer,
  question_text text,
  option_a text,
  option_b text,
  option_c text,
  option_d text
)
language plpgsql
security definer
set search_path=public
as $$
declare
  quiz_class integer;
begin
  select q.class_no into quiz_class
  from public.quizzes q
  where q.id = p_quiz_id
    and q.is_active = true;

  if quiz_class is null then
    raise exception 'Quiz not found or inactive.';
  end if;

  if not public.is_staff() and quiz_class <> public.my_class() then
    raise exception 'This quiz is not for your class.';
  end if;

  return query
  select q.id,q.quiz_id,q.position,q.question_text,
         q.option_a,q.option_b,q.option_c,q.option_d
  from public.quiz_questions q
  where q.quiz_id=p_quiz_id
  order by q.position;
end;
$$;

revoke all on function public.get_quiz_questions_public(uuid) from public;
grant execute on function public.get_quiz_questions_public(uuid) to authenticated;

-- Per-quiz leaderboard. Students may request only a quiz from their own
-- class; staff may request either class.
create or replace function public.get_quiz_leaderboard(p_quiz_id uuid)
returns table(
  student_id uuid,
  full_name text,
  login_id text,
  class_no integer,
  score numeric,
  total_marks numeric,
  rank bigint,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
declare
  quiz_class integer;
begin
  select q.class_no into quiz_class
  from public.quizzes q
  where q.id=p_quiz_id;

  if quiz_class is null then
    raise exception 'Quiz not found.';
  end if;

  if not public.is_staff() and quiz_class <> public.my_class() then
    raise exception 'You cannot view another class leaderboard.';
  end if;

  return query
  select
    a.student_id,
    p.full_name,
    p.login_id,
    sp.class_no,
    a.score,
    a.total_marks,
    rank() over(order by a.score desc) as rank,
    a.submitted_at
  from public.quiz_attempts a
  join public.profiles p on p.id=a.student_id
  join public.student_profiles sp on sp.user_id=a.student_id
  where a.quiz_id=p_quiz_id
  order by a.score desc, a.submitted_at asc, p.full_name asc;
end;
$$;

revoke all on function public.get_quiz_leaderboard(uuid) from public;
grant execute on function public.get_quiz_leaderboard(uuid) to authenticated;

-- Cumulative class leaderboard. Percentage is used so quizzes with different
-- maximum marks are comparable.
create or replace function public.get_class_leaderboard(p_class_no integer)
returns table(
  student_id uuid,
  full_name text,
  login_id text,
  class_no integer,
  total_score numeric,
  total_marks numeric,
  percentage numeric,
  attempted_quizzes bigint,
  rank bigint
)
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_class_no not in (10,12) then
    raise exception 'Invalid class.';
  end if;

  if not public.is_staff() and p_class_no <> public.my_class() then
    raise exception 'You cannot view another class leaderboard.';
  end if;

  return query
  with totals as (
    select
      sp.user_id as student_id,
      p.full_name,
      p.login_id,
      sp.class_no,
      coalesce(sum(a.score),0)::numeric as total_score,
      coalesce(sum(a.total_marks),0)::numeric as total_marks,
      count(a.id)::bigint as attempted_quizzes
    from public.student_profiles sp
    join public.profiles p on p.id=sp.user_id
    left join public.quiz_attempts a
      on a.student_id=sp.user_id
     and exists (
       select 1 from public.quizzes q
       where q.id=a.quiz_id and q.class_no=p_class_no
     )
    where sp.class_no=p_class_no
    group by sp.user_id,p.full_name,p.login_id,sp.class_no
  ),
  scored as (
    select *,
      case when total_marks > 0
        then round((total_score / total_marks) * 100, 2)
        else 0::numeric
      end as percentage
    from totals
  )
  select
    s.student_id,
    s.full_name,
    s.login_id,
    s.class_no,
    s.total_score,
    s.total_marks,
    s.percentage,
    s.attempted_quizzes,
    rank() over(order by s.percentage desc, s.total_score desc) as rank
  from scored s
  order by s.percentage desc, s.total_score desc, s.full_name asc;
end;
$$;

revoke all on function public.get_class_leaderboard(integer) from public;
grant execute on function public.get_class_leaderboard(integer) to authenticated;

-- Student quiz history with the student's rank in every quiz already taken.
create or replace function public.get_my_quiz_history()
returns table(
  quiz_id uuid,
  quiz_title text,
  quiz_type text,
  score numeric,
  total_marks numeric,
  rank bigint,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
begin
  if public.my_class() is null then
    raise exception 'Student profile not found.';
  end if;

  return query
  select
    a.quiz_id,
    q.title,
    q.quiz_type,
    a.score,
    a.total_marks,
    rank() over(partition by a.quiz_id order by a.score desc) as rank,
    a.submitted_at
  from public.quiz_attempts a
  join public.quizzes q on q.id=a.quiz_id
  where a.student_id=auth.uid()
    and q.class_no=public.my_class()
  order by a.submitted_at desc;
end;
$$;

revoke all on function public.get_my_quiz_history() from public;
grant execute on function public.get_my_quiz_history() to authenticated;

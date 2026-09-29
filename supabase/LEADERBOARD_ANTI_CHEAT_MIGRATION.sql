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
  "position" integer,
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
  select q.id,q.quiz_id,q.position as "position",q.question_text,
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

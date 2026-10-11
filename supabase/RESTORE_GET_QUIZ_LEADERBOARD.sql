-- Restore the per-quiz leaderboard RPC used by the student/admin leaderboard.
-- This function reads submitted quiz_attempts only. It does not delete or modify
-- quiz history, questions, attempts, students, marks, or admin data.
-- Run this in Supabase SQL Editor if get_quiz_leaderboard(uuid) was dropped.

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

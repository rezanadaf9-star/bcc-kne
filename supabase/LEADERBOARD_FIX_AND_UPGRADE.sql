-- BCC Portal: leaderboard fix + current-student support
-- Run this AFTER LEADERBOARD_ANTI_CHEAT_MIGRATION.sql.
-- This does NOT touch quiz sessions, anti-cheat, users, or quiz data.

-- 1) FIX: cumulative class leaderboard
-- The old function used an unqualified `total_marks` inside PL/pgSQL,
-- which conflicts with the RETURNS TABLE output variable of the same name.
-- Every reference is now qualified through the CTE alias.

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
       select 1
       from public.quizzes q
       where q.id=a.quiz_id
         and q.class_no=p_class_no
     )
    where sp.class_no=p_class_no
    group by sp.user_id,p.full_name,p.login_id,sp.class_no
  ),
  scored as (
    select
      t.*,
      case
        when t.total_marks > 0
          then round((t.total_score / t.total_marks) * 100, 2)
        else 0::numeric
      end as percentage
    from totals t
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
    rank() over(
      order by s.percentage desc, s.total_score desc
    ) as rank
  from scored s
  order by s.percentage desc, s.total_score desc, s.full_name asc;
end;
$$;

revoke all on function public.get_class_leaderboard(integer) from public;
grant execute on function public.get_class_leaderboard(integer) to authenticated;


-- 2) Latest/individual quiz leaderboard.
-- This remains the source for the "Latest Quiz" section.
-- The frontend can call this function with the newest quiz ID.
-- Ranking is within that quiz only.

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
  select q.class_no
    into quiz_class
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
  join public.profiles p
    on p.id=a.student_id
  join public.student_profiles sp
    on sp.user_id=a.student_id
  where a.quiz_id=p_quiz_id
  order by a.score desc, a.submitted_at asc, p.full_name asc;
end;
$$;

revoke all on function public.get_quiz_leaderboard(uuid) from public;
grant execute on function public.get_quiz_leaderboard(uuid) to authenticated;


-- 3) Student's own quiz history.
-- Keeps the student's rank for each quiz they have attempted.

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
  join public.quizzes q
    on q.id=a.quiz_id
  where a.student_id=auth.uid()
    and q.class_no=public.my_class()
  order by a.submitted_at desc;
end;
$$;

revoke all on function public.get_my_quiz_history() from public;
grant execute on function public.get_my_quiz_history() to authenticated;


-- 4) Optional helper: returns the newest active quiz for the logged-in
-- student's class. This makes the Latest Quiz section deterministic.
-- Students can only receive a quiz belonging to their own class.

create or replace function public.get_latest_class_quiz()
returns table(
  id uuid,
  title text,
  quiz_type text,
  class_no integer,
  total_marks numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
declare
  current_class integer;
begin
  current_class := public.my_class();

  if current_class is null then
    raise exception 'Student profile not found.';
  end if;

  return query
  select
    q.id,
    q.title,
    q.quiz_type,
    q.class_no,
    q.total_marks,
    q.created_at
  from public.quizzes q
  where q.class_no=current_class
    and q.is_active=true
  order by q.created_at desc
  limit 1;
end;
$$;

revoke all on function public.get_latest_class_quiz() from public;
grant execute on function public.get_latest_class_quiz() to authenticated;

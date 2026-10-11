-- BCC Portal: Academic / School Exam Marks
-- Additive migration. Run ONCE in Supabase SQL Editor after backing up production.
-- This does not modify or delete quiz attempts, students, or existing leaderboard data.

create table if not exists public.academic_exam_sets (
  id uuid primary key default gen_random_uuid(),
  class_no integer not null check (class_no in (10,12)),
  exam_name text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  result_declared boolean not null default false
);

alter table public.academic_exam_sets add column if not exists result_declared boolean not null default false;
-- Existing exam records are preserved as already published when this feature is added. New exams remain undeclared until staff explicitly declares them.
update public.academic_exam_sets set result_declared=true where result_declared=false;

create index if not exists idx_academic_exam_sets_class
  on public.academic_exam_sets(class_no, created_at desc);

create table if not exists public.academic_exam_subjects (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.academic_exam_sets(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  subject_name text not null,
  full_marks numeric not null check (full_marks > 0),
  created_at timestamptz not null default now(),
  unique(exam_id, subject_id)
);

create index if not exists idx_academic_exam_subjects_exam
  on public.academic_exam_subjects(exam_id);

create table if not exists public.student_exam_marks (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.academic_exam_sets(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  marks jsonb not null default '{}'::jsonb,
  included_subject_ids jsonb,
  status text not null default 'draft' check (status in ('draft','completed')),
  updated_at timestamptz not null default now(),
  unique(exam_id, student_id)
);

create index if not exists idx_student_exam_marks_exam
  on public.student_exam_marks(exam_id, status);

create index if not exists idx_student_exam_marks_student
  on public.student_exam_marks(student_id, updated_at desc);

-- Existing installations may already have the table from an earlier version.
alter table public.student_exam_marks add column if not exists included_subject_ids jsonb;

alter table public.academic_exam_sets enable row level security;
alter table public.academic_exam_subjects enable row level security;
alter table public.student_exam_marks enable row level security;

drop policy if exists academic_exam_sets_select on public.academic_exam_sets;
create policy academic_exam_sets_select
on public.academic_exam_sets for select to authenticated
using (public.is_staff() or class_no = public.my_class());

drop policy if exists academic_exam_sets_staff_write on public.academic_exam_sets;
create policy academic_exam_sets_staff_write
on public.academic_exam_sets for all to authenticated
using (public.is_staff()) with check (public.is_staff());

drop policy if exists academic_exam_subjects_select on public.academic_exam_subjects;
create policy academic_exam_subjects_select
on public.academic_exam_subjects for select to authenticated
using (
  public.is_staff()
  or exists (
    select 1
    from public.academic_exam_sets e
    where e.id = academic_exam_subjects.exam_id
      and e.class_no = public.my_class()
  )
);

drop policy if exists academic_exam_subjects_staff_write on public.academic_exam_subjects;
create policy academic_exam_subjects_staff_write
on public.academic_exam_subjects for all to authenticated
using (public.is_staff()) with check (public.is_staff());

drop policy if exists student_exam_marks_select on public.student_exam_marks;
create policy student_exam_marks_select
on public.student_exam_marks for select to authenticated
using (public.is_staff() or student_id = auth.uid());

drop policy if exists student_exam_marks_staff_write on public.student_exam_marks;
create policy student_exam_marks_staff_write
on public.student_exam_marks for all to authenticated
using (public.is_staff()) with check (public.is_staff());

-- IMPORTANT: all return-table fields are qualified with the CTE alias in the final SELECT.
-- This avoids the PL/pgSQL "column reference ... is ambiguous" error.
-- One combined academic percentage/rank per student, based only on completed
-- school exams. A student with no completed record is excluded.
drop function if exists public.get_academic_exam_student_ranking(integer, uuid);
create or replace function public.get_academic_exam_student_ranking(
  p_class_no integer, p_student_id uuid default auth.uid()
)
returns table(student_id uuid,full_name text,login_id text,class_no integer,total_score numeric,total_full_marks numeric,percentage numeric,completed_exams bigint,rank bigint)
language plpgsql security definer set search_path=public as $$
begin
  if p_class_no not in (10,12) then raise exception 'Invalid class.'; end if;
  if not public.is_staff() and (p_class_no <> public.my_class() or p_student_id <> auth.uid()) then raise exception 'You cannot view another student ranking.'; end if;
  return query
  with totals as (
    select sp.user_id as student_id,p.full_name,p.login_id,sp.class_no,
      sum(coalesce((select sum((value)::numeric) from jsonb_each_text(sem.marks) j(key,value) where sem.included_subject_ids is null or sem.included_subject_ids ? j.key),0))::numeric as total_score,
      sum(coalesce((select sum(aes.full_marks) from public.academic_exam_subjects aes where aes.exam_id=sem.exam_id and (sem.included_subject_ids is null or sem.included_subject_ids ? aes.subject_id::text)),0))::numeric as total_full_marks,
      count(sem.id)::bigint as completed_exams
    from public.student_profiles sp join public.profiles p on p.id=sp.user_id
    join public.student_exam_marks sem on sem.student_id=sp.user_id and sem.status='completed'
    join public.academic_exam_sets ae on ae.id=sem.exam_id and ae.class_no=p_class_no
    where sp.class_no=p_class_no group by sp.user_id,p.full_name,p.login_id,sp.class_no
  ), scored as (select *,case when total_full_marks>0 then round((total_score/total_full_marks)*100,2) else 0::numeric end as percentage from totals)
  select s.student_id,s.full_name,s.login_id,s.class_no,s.total_score,s.total_full_marks,s.percentage,s.completed_exams,
    rank() over(order by s.percentage desc,s.total_score desc,s.full_name asc) as rank
  from scored as s
  order by s.percentage desc,s.total_score desc,s.full_name asc;
end;
$$;

revoke all on function public.get_academic_exam_student_ranking(integer,uuid) from public;
grant execute on function public.get_academic_exam_student_ranking(integer,uuid) to authenticated;

-- Exam-specific declared-result leaderboard. Students may see only their own class; staff may see any class.
drop function if exists public.get_academic_exam_leaderboard(uuid);
create or replace function public.get_academic_exam_leaderboard(p_exam_id uuid)
returns table(
  student_id uuid,
  full_name text,
  login_id text,
  class_no integer,
  roll_number text,
  photo_path text,
  total_score numeric,
  total_full_marks numeric,
  percentage numeric,
  rank bigint
)
language plpgsql security definer set search_path=public as $$
declare
  v_class integer;
  v_declared boolean;
begin
  select e.class_no,e.result_declared into v_class,v_declared from public.academic_exam_sets e where e.id=p_exam_id;
  if v_class is null then raise exception 'Exam not found.'; end if;
  if not public.is_staff() and v_class <> public.my_class() then raise exception 'You cannot view this class leaderboard.'; end if;
  if not v_declared then return; end if;
  return query
  with scored as (
    select sp.user_id as student_id,p.full_name,p.login_id,sp.class_no,sp.roll_number,sp.photo_path,
      coalesce((select sum((j.value)::numeric) from jsonb_each_text(sem.marks) j where sem.included_subject_ids is null or sem.included_subject_ids ? j.key),0)::numeric as total_score,
      coalesce((select sum(aes.full_marks) from public.academic_exam_subjects aes where aes.exam_id=p_exam_id and (sem.included_subject_ids is null or sem.included_subject_ids ? aes.subject_id::text)),0)::numeric as total_full_marks
    from public.student_profiles sp
    join public.profiles p on p.id=sp.user_id
    join public.student_exam_marks sem on sem.student_id=sp.user_id and sem.exam_id=p_exam_id and sem.status='completed'
    where sp.class_no=v_class
  ), ranked as (
    select s.*,case when s.total_full_marks>0 then round((s.total_score/s.total_full_marks)*100,2) else 0::numeric end as percentage
    from scored s
  )
  select r.student_id,r.full_name,r.login_id,r.class_no,r.roll_number,r.photo_path,r.total_score,r.total_full_marks,r.percentage,
    rank() over(order by r.percentage desc,r.total_score desc,r.full_name asc) as rank
  from ranked r
  order by r.percentage desc,r.total_score desc,r.full_name asc;
end;
$$;
revoke all on function public.get_academic_exam_leaderboard(uuid) from public;
grant execute on function public.get_academic_exam_leaderboard(uuid) to authenticated;

-- Verify the migration with:
-- select * from public.academic_exam_sets;
-- select * from public.academic_exam_subjects;
-- select * from public.student_exam_marks;

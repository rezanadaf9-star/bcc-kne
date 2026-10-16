-- BCC Teacher Portal additions. Safe to run on the existing project.
alter table public.profiles add column if not exists is_active boolean not null default true;

create table if not exists public.teacher_class_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  class_no integer not null check (class_no in (10,12)),
  created_at timestamptz not null default now(),
  unique (teacher_id,class_no)
);
alter table public.teacher_class_assignments enable row level security;

-- Start the sequence after the largest existing serial in a BCC##AA teacher ID.
do $$
declare n bigint;
begin
  select coalesce(max((regexp_match(login_id, '^BCC([0-9]+)[A-Z]{2}$'))[1]::bigint),0)+1 into n
  from public.profiles where login_id ~ '^BCC[0-9]+[A-Z]{2}$';
  if not exists(select 1 from pg_class where relkind='S' and relname='bcc_teacher_id_seq') then
    execute format('create sequence public.bcc_teacher_id_seq start %s',n);
  else
    perform setval('public.bcc_teacher_id_seq', greatest(n-1, (select last_value from public.bcc_teacher_id_seq)), true);
  end if;
end $$;

drop function if exists public.next_bcc_teacher_id();
create or replace function public.next_bcc_teacher_id(p_full_name text)
returns text language plpgsql volatile security definer set search_path=public
as $$
declare parts text[]; first_initial text; second_initial text; serial_no bigint;
begin
  parts := regexp_split_to_array(trim(coalesce(p_full_name,'')), '\s+');
  if array_length(parts,1) < 2 or parts[1] = '' or parts[2] = '' then
    raise exception 'Enter a full name containing at least two names';
  end if;
  first_initial := upper(substring(regexp_replace(parts[1], '[^A-Za-z]', '', 'g') from 1 for 1));
  second_initial := upper(substring(regexp_replace(parts[2], '[^A-Za-z]', '', 'g') from 1 for 1));
  if first_initial = '' or second_initial = '' then
    raise exception 'The first two name parts must begin with letters';
  end if;
  serial_no := nextval('public.bcc_teacher_id_seq');
  return 'BCC' || lpad(serial_no::text, 2, '0') || first_initial || second_initial;
end;
$$;
revoke all on function public.next_bcc_teacher_id(text) from public, anon, authenticated;
grant execute on function public.next_bcc_teacher_id(text) to service_role;

create or replace function public.teacher_can_access_class(p_class_no integer)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
    or exists(select 1 from public.teacher_class_assignments a join public.profiles p on p.id=a.teacher_id
              where a.teacher_id=auth.uid() and p.role='teacher' and p.is_active and a.class_no=p_class_no)
$$;

-- Teachers may read their own assignments; admins can manage all assignments.
drop policy if exists teacher_assignments_read on public.teacher_class_assignments;
create policy teacher_assignments_read on public.teacher_class_assignments for select to authenticated
using (teacher_id=auth.uid() or public.is_admin());
drop policy if exists teacher_assignments_admin_manage on public.teacher_class_assignments;
create policy teacher_assignments_admin_manage on public.teacher_class_assignments for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- Keep admin full access; limit teachers to explicitly assigned classes.
drop policy if exists student_self_or_staff_select on public.student_profiles;
create policy student_self_or_staff_select on public.student_profiles for select to authenticated
using (user_id=auth.uid() or public.is_admin() or (public.teacher_can_access_class(class_no)));

drop policy if exists subjects_class_select on public.subjects;
create policy subjects_class_select on public.subjects for select to authenticated
using (public.teacher_can_access_class(class_no) or class_no=public.my_class());
drop policy if exists subjects_staff_write on public.subjects;
create policy subjects_staff_write on public.subjects for all to authenticated
using (public.is_admin() or public.teacher_can_access_class(class_no)) with check (public.is_admin() or public.teacher_can_access_class(class_no));

drop policy if exists lectures_class_select on public.lectures;
create policy lectures_class_select on public.lectures for select to authenticated
using (public.teacher_can_access_class(class_no) or class_no=public.my_class());
drop policy if exists lectures_staff_write on public.lectures;
create policy lectures_staff_write on public.lectures for all to authenticated
using (public.is_admin() or public.teacher_can_access_class(class_no)) with check (public.is_admin() or public.teacher_can_access_class(class_no));

drop policy if exists notes_class_select on public.notes;
create policy notes_class_select on public.notes for select to authenticated
using (public.teacher_can_access_class(class_no) or class_no=public.my_class());
drop policy if exists notes_staff_write on public.notes;
create policy notes_staff_write on public.notes for all to authenticated
using (public.is_admin() or public.teacher_can_access_class(class_no)) with check (public.is_admin() or public.teacher_can_access_class(class_no));

drop policy if exists homework_class_select on public.homework;
create policy homework_class_select on public.homework for select to authenticated
using (public.teacher_can_access_class(class_no) or class_no=public.my_class());
drop policy if exists homework_staff_write on public.homework;
create policy homework_staff_write on public.homework for all to authenticated
using (public.is_admin() or public.teacher_can_access_class(class_no)) with check (public.is_admin() or public.teacher_can_access_class(class_no));

drop policy if exists quizzes_class_select on public.quizzes;
create policy quizzes_class_select on public.quizzes for select to authenticated
using (public.teacher_can_access_class(class_no) or (is_active=true and class_no=public.my_class()));
drop policy if exists quizzes_staff_write on public.quizzes;
create policy quizzes_staff_write on public.quizzes for all to authenticated
using (public.is_admin() or public.teacher_can_access_class(class_no)) with check (public.is_admin() or public.teacher_can_access_class(class_no));

drop policy if exists quiz_questions_staff_select on public.quiz_questions;
create policy quiz_questions_staff_select on public.quiz_questions for select to authenticated
using (public.is_admin() or exists(select 1 from public.quizzes q where q.id=quiz_id and public.teacher_can_access_class(q.class_no)));
drop policy if exists quiz_questions_staff_write on public.quiz_questions;
create policy quiz_questions_staff_write on public.quiz_questions for all to authenticated
using (public.is_admin() or exists(select 1 from public.quizzes q where q.id=quiz_id and public.teacher_can_access_class(q.class_no)))
with check (public.is_admin() or exists(select 1 from public.quizzes q where q.id=quiz_id and public.teacher_can_access_class(q.class_no)));

-- Only admins may create/manage staff accounts through the Edge Function.

-- Apply class assignments to academic examination records as well.
drop policy if exists academic_exam_sets_select on public.academic_exam_sets;
create policy academic_exam_sets_select on public.academic_exam_sets for select to authenticated
using (public.teacher_can_access_class(class_no) or class_no=public.my_class());
drop policy if exists academic_exam_sets_staff_write on public.academic_exam_sets;
create policy academic_exam_sets_staff_write on public.academic_exam_sets for all to authenticated
using (public.is_admin() or public.teacher_can_access_class(class_no)) with check (public.is_admin() or public.teacher_can_access_class(class_no));
drop policy if exists academic_exam_subjects_select on public.academic_exam_subjects;
create policy academic_exam_subjects_select on public.academic_exam_subjects for select to authenticated
using (public.is_admin() or exists(select 1 from public.academic_exam_sets e where e.id=exam_id and public.teacher_can_access_class(e.class_no)) or exists(select 1 from public.academic_exam_sets e where e.id=exam_id and e.class_no=public.my_class()));
drop policy if exists academic_exam_subjects_staff_write on public.academic_exam_subjects;
create policy academic_exam_subjects_staff_write on public.academic_exam_subjects for all to authenticated
using (public.is_admin() or exists(select 1 from public.academic_exam_sets e where e.id=exam_id and public.teacher_can_access_class(e.class_no)))
with check (public.is_admin() or exists(select 1 from public.academic_exam_sets e where e.id=exam_id and public.teacher_can_access_class(e.class_no)));
drop policy if exists student_exam_marks_select on public.student_exam_marks;
create policy student_exam_marks_select on public.student_exam_marks for select to authenticated
using (student_id=auth.uid() or public.is_admin() or exists(select 1 from public.student_profiles sp join public.academic_exam_sets e on e.id=student_exam_marks.exam_id where sp.user_id=student_exam_marks.student_id and public.teacher_can_access_class(sp.class_no) and e.class_no=sp.class_no));
drop policy if exists student_exam_marks_staff_write on public.student_exam_marks;
create policy student_exam_marks_staff_write on public.student_exam_marks for all to authenticated
using (public.is_admin() or exists(select 1 from public.student_profiles sp join public.academic_exam_sets e on e.id=student_exam_marks.exam_id where sp.user_id=student_exam_marks.student_id and public.teacher_can_access_class(sp.class_no) and e.class_no=sp.class_no))
with check (public.is_admin() or exists(select 1 from public.student_profiles sp join public.academic_exam_sets e on e.id=student_exam_marks.exam_id where sp.user_id=student_exam_marks.student_id and public.teacher_can_access_class(sp.class_no) and e.class_no=sp.class_no));

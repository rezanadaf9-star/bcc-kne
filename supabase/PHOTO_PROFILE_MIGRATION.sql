-- BCC Portal: student profile photo + optional phone number
-- Run once in Supabase SQL Editor after the existing leaderboard/anti-cheat migrations.

alter table public.student_profiles add column if not exists phone text;
alter table public.student_profiles add column if not exists photo_path text;

-- Allow admin/teacher staff to save or replace a student's profile photo path.
drop policy if exists "student_profiles_staff_update" on public.student_profiles;
create policy "student_profiles_staff_update"
on public.student_profiles for update to authenticated
using (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','teacher')))
with check (exists (select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','teacher')));

insert into storage.buckets (id, name, public)
values ('student-photos', 'student-photos', false)
on conflict (id) do update set public=false;

drop policy if exists "student_photos_staff_insert" on storage.objects;
create policy "student_photos_staff_insert"
on storage.objects for insert to authenticated
with check (bucket_id='student-photos' and exists (select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','teacher')));

drop policy if exists "student_photos_authenticated_select" on storage.objects;
create policy "student_photos_authenticated_select"
on storage.objects for select to authenticated
using (bucket_id='student-photos');

drop policy if exists "student_photos_staff_update" on storage.objects;
create policy "student_photos_staff_update"
on storage.objects for update to authenticated
using (bucket_id='student-photos' and exists (select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','teacher')))
with check (bucket_id='student-photos' and exists (select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','teacher')));

drop policy if exists "student_photos_staff_delete" on storage.objects;
create policy "student_photos_staff_delete"
on storage.objects for delete to authenticated
using (bucket_id='student-photos' and exists (select 1 from public.profiles p where p.id=auth.uid() and p.role in ('admin','teacher')));

-- Add photo_path to both leaderboard RPCs so the frontend can display signed profile images.
drop function if exists public.get_class_leaderboard(integer);
create or replace function public.get_class_leaderboard(p_class_no integer)
returns table(student_id uuid, full_name text, login_id text, class_no integer, photo_path text, total_score numeric, total_marks numeric, percentage numeric, attempted_quizzes bigint, rank bigint)
language plpgsql security definer set search_path=public as $$
begin
  if p_class_no not in (10,12) then raise exception 'Invalid class.'; end if;
  if not public.is_staff() and p_class_no <> public.my_class() then raise exception 'You cannot view another class leaderboard.'; end if;
  return query
  with totals as (
    select sp.user_id student_id,p.full_name,p.login_id,sp.class_no,sp.photo_path,
      coalesce(sum(a.score),0)::numeric total_score,coalesce(sum(a.total_marks),0)::numeric total_marks,count(a.id)::bigint attempted_quizzes
    from public.student_profiles sp join public.profiles p on p.id=sp.user_id
    left join public.quiz_attempts a on a.student_id=sp.user_id and exists(select 1 from public.quizzes q where q.id=a.quiz_id and q.class_no=p_class_no)
    where sp.class_no=p_class_no group by sp.user_id,p.full_name,p.login_id,sp.class_no,sp.photo_path
  ), scored as (select t.*,case when t.total_marks>0 then round((t.total_score/t.total_marks)*100,2) else 0::numeric end percentage from totals t)
  select s.student_id,s.full_name,s.login_id,s.class_no,s.photo_path,s.total_score,s.total_marks,s.percentage,s.attempted_quizzes,rank() over(order by s.percentage desc,s.total_score desc)
  from scored s order by s.percentage desc,s.total_score desc,s.full_name asc;
end; $$;
revoke all on function public.get_class_leaderboard(integer) from public; grant execute on function public.get_class_leaderboard(integer) to authenticated;

drop function if exists public.get_quiz_leaderboard(uuid);
create or replace function public.get_quiz_leaderboard(p_quiz_id uuid)
returns table(student_id uuid, full_name text, login_id text, class_no integer, photo_path text, score numeric, total_marks numeric, rank bigint, submitted_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare quiz_class integer; begin
  select q.class_no into quiz_class from public.quizzes q where q.id=p_quiz_id;
  if quiz_class is null then raise exception 'Quiz not found.'; end if;
  if not public.is_staff() and quiz_class <> public.my_class() then raise exception 'You cannot view another class leaderboard.'; end if;
  return query select a.student_id,p.full_name,p.login_id,sp.class_no,sp.photo_path,a.score,a.total_marks,rank() over(order by a.score desc),a.submitted_at
  from public.quiz_attempts a join public.profiles p on p.id=a.student_id join public.student_profiles sp on sp.user_id=a.student_id
  where a.quiz_id=p_quiz_id order by a.score desc,a.submitted_at asc,p.full_name asc;
end; $$;
revoke all on function public.get_quiz_leaderboard(uuid) from public; grant execute on function public.get_quiz_leaderboard(uuid) to authenticated;

-- Staff/admin profile photo support.
alter table public.profiles add column if not exists photo_path text;

drop function if exists public.set_my_profile_photo(text);
create or replace function public.set_my_profile_photo(p_path text)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_path is null or p_path = '' then
    raise exception 'Photo path is required.';
  end if;
  if p_path <> ('staff/' || auth.uid()::text || '/profile.jpg') then
    raise exception 'Invalid profile photo path.';
  end if;
  update public.profiles
  set photo_path = p_path
  where id = auth.uid();
  if not found then raise exception 'Profile record not found.'; end if;
end;
$$;
revoke all on function public.set_my_profile_photo(text) from public;
grant execute on function public.set_my_profile_photo(text) to authenticated;

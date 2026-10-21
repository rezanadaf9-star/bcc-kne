-- Run in Supabase SQL Editor once. Restricted avatar metadata for lecture participants.
-- Requires existing lecture_comments, profiles and student_profiles tables.
create or replace function public.get_lecture_discussion_avatars(p_lecture_id uuid)
returns table(user_id uuid, photo_path text)
language sql stable security definer
set search_path = ''
as $$
  select c.user_id,
         coalesce(sp.photo_path, p.photo_path) as photo_path
  from (select distinct lc.user_id
        from public.lecture_comments lc
        where lc.lecture_id = p_lecture_id) c
  join public.profiles p on p.id = c.user_id
  left join public.student_profiles sp on sp.user_id = c.user_id
  where auth.uid() is not null
    and coalesce(sp.photo_path, p.photo_path) is not null;
$$;
revoke all on function public.get_lecture_discussion_avatars(uuid) from public, anon;
grant execute on function public.get_lecture_discussion_avatars(uuid) to authenticated;

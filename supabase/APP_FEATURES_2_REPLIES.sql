-- =====================================================================
-- BCC app: replies inside lecture discussions  (run AFTER APP_FEATURES.sql)
-- Safe to re-run. Until this is run, comments work as a flat list (no Reply button).
-- =====================================================================
alter table public.lecture_comments
  add column if not exists parent_id uuid references public.lecture_comments(id) on delete cascade;
create index if not exists lecture_comments_parent_idx on public.lecture_comments (parent_id);

-- a reply must belong to a comment of the SAME lecture
create or replace function public.lecture_comments_check_parent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null then
    if not exists (select 1 from public.lecture_comments p where p.id = new.parent_id and p.lecture_id = new.lecture_id) then
      raise exception 'Invalid reply target';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_lecture_comments_parent on public.lecture_comments;
create trigger trg_lecture_comments_parent before insert on public.lecture_comments
  for each row execute function public.lecture_comments_check_parent();

-- Visibility / permissions (already created by APP_FEATURES.sql, shown here for reference):
--   SELECT : students of the lecture's class, admin, and teachers assigned to that class
--   INSERT : the same people (as themselves)
--   DELETE : own comment, admin, or the teacher assigned to that class (moderation)

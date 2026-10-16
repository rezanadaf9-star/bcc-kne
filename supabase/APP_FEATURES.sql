-- =====================================================================
-- BCC Android app: new tables for LECTURE COMMENTS and NOTIFICATIONS
-- Run once in Supabase -> SQL Editor. Safe to re-run.
-- Requires the existing project functions: is_admin(), my_class(),
-- teacher_can_access_class(int)  (installed by the teacher-portal migration).
-- Until this is run the app still works: comments show "not enabled yet"
-- and the notification count stays at 0.
-- =====================================================================

-- ---------- 1) LECTURE COMMENTS ----------
create table if not exists public.lecture_comments (
  id          uuid primary key default gen_random_uuid(),
  lecture_id  uuid not null references public.lectures(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  author_name text not null default '',
  author_role text not null default 'student',
  body        text not null check (char_length(btrim(body)) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index if not exists lecture_comments_lecture_idx on public.lecture_comments (lecture_id, created_at desc);
alter table public.lecture_comments enable row level security;

-- the server fills in the author's real name/role, the client cannot fake it
create or replace function public.lecture_comments_fill_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.user_id := auth.uid(); end if;
  select p.full_name, p.role into new.author_name, new.author_role from public.profiles p where p.id = new.user_id;
  return new;
end $$;
drop trigger if exists trg_lecture_comments_author on public.lecture_comments;
create trigger trg_lecture_comments_author before insert on public.lecture_comments
  for each row execute function public.lecture_comments_fill_author();

create or replace function public.can_see_lecture(p_lecture_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lectures l
    where l.id = p_lecture_id
      and (l.class_no = public.my_class() or public.is_admin() or public.teacher_can_access_class(l.class_no))
  )
$$;

drop policy if exists lecture_comments_select on public.lecture_comments;
create policy lecture_comments_select on public.lecture_comments for select to authenticated
  using (public.can_see_lecture(lecture_id));
drop policy if exists lecture_comments_insert on public.lecture_comments;
create policy lecture_comments_insert on public.lecture_comments for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_lecture(lecture_id));
drop policy if exists lecture_comments_delete on public.lecture_comments;
create policy lecture_comments_delete on public.lecture_comments for delete to authenticated
  using (user_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.lectures l where l.id = lecture_id and public.teacher_can_access_class(l.class_no)));
grant select, insert, delete on public.lecture_comments to authenticated;

-- ---------- 2) NOTIFICATIONS ----------
create table if not exists public.app_notifications (
  id             uuid primary key default gen_random_uuid(),
  class_no       integer check (class_no in (10,12)),          -- NULL = every class
  kind           text not null default 'general'
                 check (kind in ('lecture','note','homework','quiz','ai','result','general')),
  title          text not null,
  body           text,
  ref_id         uuid,                                          -- lecture / note / homework / quiz id
  ref_subject_id uuid,                                          -- subject (used to open Notes / Homework)
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists app_notifications_class_idx on public.app_notifications (class_no, created_at desc);
alter table public.app_notifications enable row level security;

drop policy if exists app_notifications_select on public.app_notifications;
create policy app_notifications_select on public.app_notifications for select to authenticated
  using (class_no is null or class_no = public.my_class() or public.is_admin() or public.teacher_can_access_class(class_no));
drop policy if exists app_notifications_insert on public.app_notifications;
create policy app_notifications_insert on public.app_notifications for insert to authenticated
  with check (public.is_admin() or (class_no is not null and public.teacher_can_access_class(class_no)));
drop policy if exists app_notifications_delete on public.app_notifications;
create policy app_notifications_delete on public.app_notifications for delete to authenticated
  using (public.is_admin() or (class_no is not null and public.teacher_can_access_class(class_no)));
grant select, insert, delete on public.app_notifications to authenticated;

create table if not exists public.notification_reads (
  user_id         uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  notification_id uuid not null references public.app_notifications(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (user_id, notification_id)
);
alter table public.notification_reads enable row level security;
drop policy if exists notification_reads_select on public.notification_reads;
create policy notification_reads_select on public.notification_reads for select to authenticated using (user_id = auth.uid());
drop policy if exists notification_reads_insert on public.notification_reads;
create policy notification_reads_insert on public.notification_reads for insert to authenticated with check (user_id = auth.uid());
drop policy if exists notification_reads_delete on public.notification_reads;
create policy notification_reads_delete on public.notification_reads for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.notification_reads to authenticated;

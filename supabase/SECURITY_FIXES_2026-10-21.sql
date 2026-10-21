-- =====================================================================
-- BCC Portal - Supabase security advisor fixes (21 Oct 2026)
-- Run ONCE in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Safe to re-run. Does not change any table data, the website or the app.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 23 "Public Can Execute SECURITY DEFINER Function" warnings (anon)
--    Nobody who is signed out needs any of these functions.
--    (Revoke from PUBLIC too, because anon inherits from PUBLIC.)
-- ---------------------------------------------------------------------
do $$
declare s text;
begin
  foreach s in array array[
    'public.academic_exam_is_active(uuid)',
    'public.archive_academic_exam(uuid)',
    'public.bcc_announce_result()',
    'public.bcc_is_device_session_active(text)',
    'public.bcc_logout_device_session()',
    'public.bcc_register_device_session(text,text)',
    'public.bcc_session_not_revoked()',
    'public.can_see_lecture(uuid)',
    'public.correct_academic_student_marks(uuid,uuid,jsonb,jsonb,text)',
    'public.get_academic_exam_leaderboard(uuid)',
    'public.get_academic_exam_student_ranking(integer,uuid)',
    'public.get_class_leaderboard(integer)',
    'public.get_latest_class_quiz()',
    'public.get_lecture_discussion_avatars(uuid)',
    'public.get_my_quiz_history()',
    'public.get_quiz_leaderboard(uuid)',
    'public.get_quiz_questions_public(uuid)',
    'public.is_admin()',
    'public.is_staff()',
    'public.lecture_comments_check_parent()',
    'public.lecture_comments_fill_author()',
    'public.my_class()',
    'public.set_my_profile_photo(text)',
    'public.teacher_can_access_class(integer)'
  ] loop
    if to_regprocedure(s) is not null then
      execute format('revoke execute on function %s from public, anon', s);
      execute format('grant execute on function %s to authenticated, service_role', s);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2) "Signed-in users can execute SECURITY DEFINER function" warnings
--    Close the ones that NO app/website code calls directly:
--      * trigger functions (the database fires them itself)
--      * helpers only used inside other server-side functions
--      * old/unused functions
-- ---------------------------------------------------------------------
do $$
declare s text;
begin
  foreach s in array array[
    'public.bcc_announce_result()',
    'public.lecture_comments_check_parent()',
    'public.lecture_comments_fill_author()',
    'public.academic_exam_is_active(uuid)',
    'public.get_academic_exam_student_ranking(integer,uuid)',
    'public.get_latest_class_quiz()',
    'public.get_quiz_questions_public(uuid)'
  ] loop
    if to_regprocedure(s) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', s);
      execute format('grant execute on function %s to service_role', s);
    end if;
  end loop;
end $$;

-- The remaining "signed-in users" warnings are INTENTIONAL and cannot be removed:
--   is_admin, is_staff, my_class, teacher_can_access_class, can_see_lecture,
--   bcc_session_not_revoked  -> used inside your row-level-security policies
--   leaderboards, quiz history, profile photo, device sessions, archive/correct marks
--   -> called by the app/website with supabase.rpc(...)
-- Each of them checks auth.uid()/role inside, so they are safe.

-- ---------------------------------------------------------------------
-- 3) INFO: "RLS Enabled No Policy" on bcc_student_password_reset_audit
--    Give admins read-only access; nobody else can see it.
--    (The edge function still writes with the service role.)
-- ---------------------------------------------------------------------
revoke all on table public.bcc_student_password_reset_audit from anon, authenticated;
grant select on table public.bcc_student_password_reset_audit to authenticated;
grant select, insert, update, delete on table public.bcc_student_password_reset_audit to service_role;
drop policy if exists bcc_password_reset_audit_admin_read on public.bcc_student_password_reset_audit;
create policy bcc_password_reset_audit_admin_read
  on public.bcc_student_password_reset_audit
  for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------
-- 4) Supabase email: from 30 Oct 2026 NEW tables in "public" are no longer
--    auto-exposed to the Data API. Existing tables are NOT affected.
--    This makes tables you create later keep working (row-level security
--    still protects them - ALWAYS enable RLS on every new table).
--    anon is deliberately NOT included.
-- ---------------------------------------------------------------------
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

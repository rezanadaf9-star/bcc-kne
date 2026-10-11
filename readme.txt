# Brilliant Coaching Centre — BCC Portal

Updated full-stack BCC student/teacher portal based on the original working architecture.

## This version intentionally has NO stream system

Student IDs remain exactly in the original format:

`26BCC12RA@123`

There is no Science/Arts/Commerce code in the ID and no stream field is required for login.

## Class 12 subjects

- History
- Geography
- Political Science
- Economics
- Hindi
- Urdu
- English

Class 10 remains class-based and uses the existing subjects.

## Included

- Responsive BCC login page for desktop, tablet and mobile
- Responsive student and teacher/admin portal
- Existing Supabase Auth login architecture
- Existing student ID generation architecture
- Dashboard, lectures, notes, homework, quizzes and marks
- Mobile sidebar and browser Back-button navigation
- AI Study Hub / NotebookLM section
- Admin publishing for NotebookLM/Gemini resource links
- Resource categories: Notes & summaries, Lectures, Doubt solving, AI study assistant
- Session boot screen so an already-authenticated user does not briefly see the login page while Supabase restores the session

## Existing Supabase project

For a new GitHub repository, use the SAME Supabase project URL and publishable/anon key in `config.js`.

Do not create new student accounts just because the GitHub repository is new. Auth users and database records remain in Supabase.

## Existing project migration

If the Supabase database was changed using the earlier experimental multi-stream version, run:

`supabase/RESTORE_ORIGINAL_ARTS_NOTEBOOKLM.sql`

in Supabase SQL Editor. This restores the original no-stream class-based access model, preserves Auth users/student IDs, adds the Class 12 Arts subjects and creates the NotebookLM resource table.

If setting up a completely new Supabase project, run `supabase/schema.sql` instead.

## Edge Functions

Deploy/keep these original functions:

- `admin-create-user`
- `submit-quiz`
- `attempt-result`

The included functions use the original no-stream student ID system.

## Security

Never put a Supabase service-role key in frontend `config.js`. Only the public/publishable/anon key belongs in the browser.

NotebookLM/Gemini integration here is link-based: BCC publishes resource URLs and students open them. Google account credentials are not stored by this portal.

============================================================
LEADERBOARD + SECURE QUIZ MODE UPDATE
============================================================

This version adds:
- Student Leaderboard in the student sidebar.
- Class 10 / Class 12 separation using student_profiles.class_no.
- Latest quiz leaderboard + student's position.
- Full class leaderboard.
- Student quiz history with rank for every submitted quiz.
- Admin/teacher Leaderboard page with Class 10 and Class 12 cards.
- Cumulative class ranking by score percentage.
- Secure quiz sessions stored in Supabase.
- Automatic quiz submission when the student changes tab/app, browser window loses focus, uses browser Back, leaves the page, or the timer ends.
- Copy/cut/paste/context-menu and common developer/print/save shortcuts are disabled while a quiz is running.
- AI Study Hub now uses a Font Awesome wand/sparkles icon in the sidebar.

IMPORTANT: FRONTEND UPDATE ORDER
--------------------------------
1. BACK UP YOUR CURRENT SUPABASE DATABASE before changing production.
2. Open Supabase Dashboard > SQL Editor.
3. Run the complete file:
   supabase/LEADERBOARD_ANTI_CHEAT_MIGRATION.sql
   (The same migration is also included under supabase/migrations/ for CLI users.)
4. Deploy the updated Edge Functions:
   - supabase/functions/start-quiz/index.ts
   - supabase/functions/submit-quiz/index.ts
   The existing attempt-result function remains compatible.
5. Upload/publish the updated frontend files:
   - index.html
   - app.js
   - style.css
   - supabase/ (for the migration/functions)
6. Keep config.js using the same Supabase URL and publishable/anon key.
   NEVER replace it with a service-role/secret key.

SUPABASE CLI EXAMPLE
--------------------
After linking the same Supabase project:

supabase db push

The timestamped migration inside supabase/migrations/ is included so the
CLI can apply the database changes.

OR, if you prefer the Dashboard SQL Editor, run
supabase/LEADERBOARD_ANTI_CHEAT_MIGRATION.sql manually.

Do not apply both routes to the same database at the same time unless you
understand your Supabase migration history; the SQL is designed to be
additive, but your migration history should remain consistent.

Then deploy:
supabase functions deploy start-quiz
supabase functions deploy submit-quiz
supabase functions deploy attempt-result

If your project uses a different deployment process, deploy the two changed
functions through that process instead.

HOW CLASS QUIZ ACCESS WORKS
---------------------------
A student's class is taken from public.student_profiles.class_no.
When an admin creates a quiz with Class 10, only Class 10 students can start it.
The same rule applies to Class 12.

The database and Edge Functions both enforce the class check. The browser
does not decide which class a student belongs to.

QUIZ SECURITY LIMITATION
------------------------
The browser can detect and react to:
- browser Back
- changing tabs/apps (visibility change)
- switching the browser window away (focus loss)
- page navigation/closing (best-effort beacon)
- timer expiry

These events trigger an automatic submission.

No browser-only system can make cheating mathematically impossible. A student
could still use another physical device, another person, or other methods
outside the browser. The important answer key remains server-side and the
final score is calculated by the submit-quiz Edge Function.

LEADERBOARD RANKING
-------------------
Student cumulative rank:
- All submitted quiz scores for the student's class are added.
- Percentage = total score / total possible marks.
- Higher percentage ranks higher.
- Students with no attempts remain visible with 0 attempted quizzes.

Per-quiz rank:
- Higher score ranks higher.
- Ties receive the same rank.

If you change the scoring model later, update:
supabase/LEADERBOARD_ANTI_CHEAT_MIGRATION.sql

PRODUCTION SAFETY
-----------------
Do not delete the existing quiz_attempts table or existing students.
The migration is additive and uses IF NOT EXISTS / IF NOT EXISTS-style
operations where appropriate.

If the frontend is updated before the new Edge Functions and migration are
deployed, quiz starting/submission and leaderboard pages may show errors.
Therefore update Supabase first, then publish the frontend.

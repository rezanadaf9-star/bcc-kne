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

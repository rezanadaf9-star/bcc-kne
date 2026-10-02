BCC Portal — Academic Marks Update
====================================

WHAT THIS UPDATE ADDS
---------------------
1. Admin Marks page now contains Class 10 and Class 12 cards.
2. Admin can create an exam once:
   - Exam name
   - Full marks for every class subject
3. Students are listed by roll number.
4. Clicking a student opens a marks-entry card.
5. Enter every subject mark and press Done:
   - The student is saved as completed.
   - The next student opens automatically.
6. Save saves the current student as a draft and closes the entry.
   - Previously completed students remain saved.
   - Reopening that exam resumes at the first unfinished student.
7. Admin Leaderboard contains ONLY quiz performance:
   - cumulative quiz score
   - cumulative quiz percentage
   - cumulative rank
   - latest quiz marks
   - latest quiz percentage
   - all-student quiz monitoring
   - latest-vs-previous quiz percentage change
8. Admin Marks contains the school/academic exam system:
   - exam setup and full marks
   - roll-number-wise student list
   - subject-wise marks entry
   - Done automatically moves to the next student
   - Save pauses the current student without losing completed records
   - clicking a student opens their complete academic profile
   - exam-wise rank, percentage and improvement/decline
   - student photo and phone number
9. Student portal now has a Marks sidebar item.
10. Student Marks shows:
   - class exam leaderboard
   - top 3 students
   - current student's rank
   - exam cards
   - subject-wise marks
   - full marks
   - subject percentage
   - total and overall percentage
11. Class 10 and Class 12 remain completely separated.

IMPORTANT: DATABASE FIRST
-------------------------
1. BACK UP the current Supabase database.
2. Open Supabase Dashboard > SQL Editor.
3. Run the COMPLETE file:
   supabase/ACADEMIC_MARKS_MIGRATION.sql
4. Run it only once.
5. This migration is additive and does not delete quiz data or students.

FRONTEND FILES TO REPLACE
-------------------------
In your GitHub repository, replace ONLY these frontend files from this ZIP:

- index.html
- app.js
- style.css

Do NOT replace:
- config.js
- your existing Supabase project URL/key
- existing Edge Functions

SUPABASE FILE
-------------
Copy the new SQL file into your repository if you want to keep the migration with the project:

supabase/ACADEMIC_MARKS_MIGRATION.sql

No Edge Function deployment is required for this academic-marks feature.

GITHUB STEP-BY-STEP
-------------------
1. Open your BCC-kne GitHub repository.
2. Replace index.html.
3. Replace app.js.
4. Replace style.css.
5. Upload supabase/ACADEMIC_MARKS_MIGRATION.sql.
6. Commit the changes.
7. Wait for GitHub Pages to deploy.
8. Hard refresh the website.

SUPABASE STEP-BY-STEP
---------------------
Do this before testing the new Marks page:

1. Supabase Dashboard.
2. SQL Editor.
3. New query.
4. Paste the complete contents of:
   supabase/ACADEMIC_MARKS_MIGRATION.sql
5. Run.
6. Confirm these tables exist:
   - academic_exam_sets
   - academic_exam_subjects
   - student_exam_marks
7. Confirm the function exists:
   - get_academic_exam_student_ranking

FIRST ADMIN TEST
----------------
1. Log in to Admin.
2. Open Marks.
3. Select Class 10 or Class 12.
4. Click New Exam.
5. Enter an exam name.
6. Enter full marks for every subject.
7. Click Create & Start.
8. Enter the first student's marks.
9. Click Done.
10. The next roll-number student should open automatically.
11. Click Save on a later student.
12. Return to the same exam.
13. It should resume at the first student that is not completed.
14. Finish the remaining students.

STUDENT TEST
------------
1. Log in as a student.
2. Open Marks from the sidebar.
3. The exam should appear as a card after the student's record is completed.
4. Open the exam.
5. Verify subject marks, full marks, subject percentages, total and overall percentage.
6. Verify the student's class rank/top-3 area.

IMPORTANT BEHAVIOR
------------------
- Quiz marks are no longer displayed on the Admin Marks page.
- Quiz marks remain in Leaderboard.
- Academic school-exam marks are stored separately from quiz attempts.
- Class 10 academic records never mix with Class 12 records.
- Full marks are stored once per exam subject, not repeatedly for every student.
- A student draft is not shown as a completed student result.
- Only completed academic marks are used in the academic leaderboard.
- Students can read only their own marks records through RLS.
- Staff can manage marks for both classes.

IF SOMETHING LOOKS EMPTY
------------------------
Check these in order:
1. Was ACADEMIC_MARKS_MIGRATION.sql run successfully?
2. Are Class 10/Class 12 subjects present in the subjects table?
3. Are student_profiles rows present with class_no and roll_number?
4. Did GitHub Pages finish deploying the new index.html/app.js/style.css?
5. Hard refresh the page.

DO NOT CHANGE config.js unless your existing Supabase configuration itself is wrong.

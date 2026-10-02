BCC Portal – Leaderboard V6

What changed
1. Student Quiz Leaderboard
   - Latest quiz now shows a visual top-3 podium with student photos and crown PNG.
   - Ranks 4–10 are shown underneath.
   - If the logged-in student is ranked below 10, ranks 4–10 are followed by an ellipsis and the student's own highlighted rank.
   - The same layout is used for cumulative quiz ranking.
   - Existing personal summary cards and quiz history remain.

2. Admin Quiz Leaderboard
   - Latest quiz now uses the same visual podium + ranks 4–10 presentation.
   - Student monitoring remains below it.

3. Academic Exam Leaderboards
   - Marks now has an "EXAMS LEADERBOARD" area for declared exams, separated by Class 10 and Class 12.
   - Admin can declare an exam result from the class marks page.
   - After declaration, the exam appears in the academic leaderboard cards.
   - Academic leaderboard page has top-3 podium with photos/crowns.
   - Admin sees ranks 4 through the final student in a scrollable list.
   - Student sees ranks 4–10; if their rank is below 10, an ellipsis and their highlighted row are shown.
   - Rankings use each student's applicable full marks after FM Update and percentage, so students with different subject sets are ranked fairly by percentage.

4. Student Marks
   - Latest Exam Leaderboard now uses the latest DECLARED academic exam.
   - A separate Exams Leaderboard section contains one card per declared exam.
   - Clicking an exam opens its podium/rank page.
   - Existing exam record/detail cards remain.

Database
- Run the updated supabase/ACADEMIC_MARKS_MIGRATION.sql once in the Supabase SQL Editor.
- It adds result_declared and the exam-specific leaderboard RPC.
- Existing academic exams are marked declared during migration to preserve the previous visible behavior. New exams are undeclared until an admin clicks Declare Result.

Files changed
- app.js
- style.css
- assets/crown.png
- supabase/ACADEMIC_MARKS_MIGRATION.sql

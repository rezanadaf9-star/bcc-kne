BCC Portal — Academic Marks V4

This V4 package is a correction to the academic Marks system only.

IMPORTANT
- The existing quiz Leaderboard is working and is NOT being changed by this fix.
- The `column reference "total_full_marks" is ambiguous` error belongs to the student Academic Marks ranking function.
- Do NOT run LEADERBOARD_FIX_AND_UPGRADE.sql for this issue.

Website files to replace in your current BCC-kne project:
- index.html
- app.js
- style.css
Do NOT replace config.js.

Supabase:
1. Open SQL Editor.
2. Run the complete `supabase/ACADEMIC_MARKS_MIGRATION.sql` from this V4 ZIP.
3. This uses CREATE OR REPLACE for the academic ranking function and fixes the ambiguity by qualifying return columns.
4. Do not run the leaderboard fix SQL for this issue.

The existing academic features remain: exam setup, selected subjects/full marks, per-student FM Update, Save/Done, resume, Class 10/12 separation, and student Marks page.

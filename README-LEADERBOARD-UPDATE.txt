BCC Portal - Leaderboard Final Update

1. Supabase: run supabase/LEADERBOARD_FIX_AND_UPGRADE.sql ONCE in SQL Editor.
2. GitHub: replace ONLY index.html, app.js, and style.css with the files in frontend/.
3. DO NOT replace config.js.
4. Edge Functions start-quiz and submit-quiz are already deployed; do not redeploy them for this update.
5. Refresh the site with a hard reload after GitHub Pages updates.

Behavior:
- Latest quiz leaderboard at top.
- Overall cumulative class ranking below.
- Class 10 and Class 12 remain separate.
- Logged-in student is highlighted and labeled YOU.
- If the student is outside the top 5, their row is still shown below the top 5 on the overview.
- Full ranking is available with See full ranking.

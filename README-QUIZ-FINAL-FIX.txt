BCC Portal — Quiz Final Fix

This update changes ONLY the quiz-runner UI/submit behavior and adds a SQL restore helper for the leaderboard RPC.

QUIZ UI CHANGES
- Removed the visible "Quiz mode is active" / anti-cheat policy card from the quiz page.
- Anti-cheat/security JavaScript behavior is NOT removed.
- Added a visual question progress line that updates with the current question.
- Previous + Next buttons stay near the bottom of the viewport with a 50px bottom gap.
- On the last question, Next becomes Submit Quiz as before.
- The existing small Submit Quiz button in the title area remains available for early submission.
- Removed the blue mobile tap/highlight flash.
- Manual submission no longer uses the full-screen loading overlay; the submit control changes immediately to "Submitting..." while the secure Supabase Edge Function saves the result.

IMPORTANT ABOUT SUBMISSION SPEED
The frontend can respond immediately to the click, but the final result still depends on the network and the Supabase submit-quiz Edge Function. The update removes unnecessary UI blocking; it cannot make a network request physically instantaneous.

LEADERBOARD RPC FIX
If the red error says:
  Could not find the function public.get_quiz_leaderboard(p_quiz_id) in the schema cache
then the RPC was dropped from Supabase. Run:
  supabase/RESTORE_GET_QUIZ_LEADERBOARD.sql
in Supabase SQL Editor.

That SQL recreates only the function and grants execute permission. It does NOT delete quiz attempts, quiz questions, student records, marks, or history.

DO NOT drop any tables.

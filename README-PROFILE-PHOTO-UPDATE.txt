BCC PROFILE PHOTO + OPTIONAL PHONE UPDATE

WHAT CHANGED
- Admin Create Student now has optional phone number and optional student photo.
- Photo is uploaded to private Supabase Storage bucket student-photos under USER_ID/profile.ext.
- Dashboard header shows the student photo; initials remain the fallback.
- Student leaderboard and admin class leaderboards show a 38px circular photo.
- Existing students without photos continue to show initials.
- No SMS/WhatsApp service is integrated. Phone is only stored for future use.

PRODUCTION STEPS
1. Run supabase/PHOTO_PROFILE_MIGRATION.sql ONCE in Supabase SQL Editor.
2. Replace the existing admin-create-user Edge Function code with supabase/functions/admin-create-user/index.ts from this package, then Deploy updates.
3. In GitHub replace ONLY frontend/index.html, frontend/app.js and frontend/style.css. Keep config.js unchanged.
4. Do not redeploy start-quiz or submit-quiz for this feature.
5. Test by creating one test student with a photo, log in as that student, verify the header photo, then check the leaderboard.

NOTE
The photo input uses capture="environment" so compatible phones may offer the camera directly. Photo is optional and limited to 5 MB by the frontend.

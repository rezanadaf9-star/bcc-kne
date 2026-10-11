BCC Portal - Profile Photo Update

This package includes:
- Student profile photos tied to the student's Supabase User ID.
- Student photo upload/replace from Admin -> Students -> View.
- Student photo delete option from the same student profile.
- Student photo fallback: yellow circular background with first letters in BCC navy when no photo exists.
- Student photos display in the student header/profile and quiz/cumulative leaderboards.
- Admin/teacher account profile photo upload from the profile menu; the photo is stored persistently and shown in the top header.
- Profile photos use a 1px BCC navy border. Uploaded photos are slightly cropped to hide colored edges baked into the image; fallback initials remain yellow.
- No SMS/WhatsApp integration.

Production steps:
1. Run PHOTO_PROFILE_MIGRATION.sql once in Supabase SQL Editor. If the existing photo migration was already run, run this updated version so the staff/admin photo column and RPC are created.
2. Replace frontend/index.html, frontend/app.js, and frontend/style.css in GitHub.
3. Keep your existing frontend/config.js unchanged.
4. No need to redeploy start-quiz or submit-quiz for these photo changes.
5. Deploy the existing admin-create-user Edge Function only if your current production function does not already match this package.

Student photo workflow:
- Admin opens Students -> View.
- Choose photo -> Add photo / Replace photo.
- Delete photo is available when a photo exists.

Admin/teacher photo workflow:
- Open the profile menu in the top-right.
- Choose Add profile photo / Replace profile photo.
- The photo is stored at staff/{USER_ID}/profile.jpg.

Important:
- The student-photos bucket is private.
- Storage policies in PHOTO_PROFILE_MIGRATION.sql are required.

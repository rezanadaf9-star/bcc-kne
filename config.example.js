// Copy this file to config.js and replace the placeholders.
// The publishable/anon key is safe to expose in a static frontend when
// your database has correct Row Level Security policies.
// NEVER put a Supabase service-role/secret key in this file.

window.BCC_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY",
  // This is only an internal email namespace used by Supabase Auth.
  // It is not a mailbox and users do not need to see it.
  AUTH_EMAIL_DOMAIN: "students.bcc-portal.invalid",
  YOUTUBE_CHANNEL_ID: ""
};

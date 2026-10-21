-- BCC Device Session Management (Supabase PostgreSQL)
-- Run once in Supabase SQL Editor. Save a copy in the website project root.
-- Limits: student/teacher = 1 web + 1 android; admin = 2 web + 2 android.
-- A newer login replaces the oldest ACTIVE session of the SAME platform.
-- IMPORTANT: This registry does NOT revoke Supabase Auth JWTs or refresh tokens.
-- Application and protected backend endpoints must enforce is_bcc_session_active().
-- Adjust role lookup to match your actual profile schema before deploying.

begin;

create table if not exists public.bcc_device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id uuid not null,
  platform text not null check (platform in ('web', 'android')),
  device_label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, auth_session_id)
);
create index if not exists bcc_sessions_user_platform_idx
  on public.bcc_device_sessions(user_id, platform, created_at, id)
  where revoked_at is null;

alter table public.bcc_device_sessions enable row level security;
revoke all on public.bcc_device_sessions from anon, authenticated;
-- Do not grant direct writes: all changes go through security-definer functions.

-- Uses JWT session_id claim provided by Supabase Auth.
create or replace function public.bcc_current_auth_session_id()
returns uuid language plpgsql stable security invoker set search_path = '' as $$
declare v text;
begin
  v := auth.jwt()->>'session_id';
  if v is null or v = '' then return null; end if;
  return v::uuid;
exception when invalid_text_representation then return null;
end;
$$;

-- Register the authenticated browser/app session. Serialize concurrent logins
-- for the same account using a transaction-scoped advisory lock.
create or replace function public.bcc_register_device_session(
  p_platform text,
  p_device_label text default null
)
returns table(session_record_id uuid, replaced_sessions integer, allowed_sessions integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := public.bcc_current_auth_session_id();
  v_role text;
  v_limit integer;
  v_id uuid;
  v_replaced integer := 0;
  v_count integer;
  v_old uuid;
begin
  if v_uid is null or v_sid is null then
    raise exception 'Authenticated Supabase session required';
  end if;
  if p_platform not in ('web','android') or p_platform is null then
    raise exception 'Unsupported platform';
  end if;
  -- IMPORTANT: Modify this SELECT if your role lives elsewhere.
  select lower(coalesce(p.role::text, 'student')) into v_role
    from public.profiles p where p.id = v_uid;
  if v_role is null then raise exception 'BCC profile not found'; end if;
  if v_role not in ('student','teacher','admin') then
    raise exception 'Unsupported BCC role';
  end if;
  v_limit := case when v_role = 'admin' then 2 else 1 end;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text || ':' || p_platform, 0));

  -- Do not silently reactivate a previously revoked auth session.
  if exists (select 1 from public.bcc_device_sessions d
             where d.user_id=v_uid and d.auth_session_id=v_sid and d.revoked_at is not null) then
    raise exception 'This login session was replaced. Sign in again.';
  end if;

  insert into public.bcc_device_sessions(user_id,auth_session_id,platform,device_label)
  values(v_uid,v_sid,p_platform,left(p_device_label,120))
  on conflict (user_id,auth_session_id) do update
    set last_seen_at=now(), device_label=excluded.device_label
  returning id into v_id;

  -- Reject a session trying to switch its platform after registration.
  if not exists(select 1 from public.bcc_device_sessions d
    where d.id=v_id and d.platform=p_platform and d.revoked_at is null) then
    raise exception 'Session platform mismatch';
  end if;

  select count(*) into v_count from public.bcc_device_sessions d
    where d.user_id=v_uid and d.platform=p_platform and d.revoked_at is null;
  while v_count > v_limit loop
    select d.id into v_old from public.bcc_device_sessions d
    where d.user_id=v_uid and d.platform=p_platform and d.revoked_at is null and d.id<>v_id
    order by d.created_at asc, d.id asc limit 1;
    if v_old is null then exit; end if;
    update public.bcc_device_sessions set revoked_at=now() where id=v_old;
    v_replaced := v_replaced+1;
    v_count := v_count-1;
  end loop;
  return query select v_id,v_replaced,v_limit;
end;
$$;

create or replace function public.bcc_is_device_session_active(p_platform text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and p_platform in ('web','android')
    and exists (
      select 1 from public.bcc_device_sessions d
      where d.user_id=auth.uid()
        and d.auth_session_id=public.bcc_current_auth_session_id()
        and d.platform=p_platform and d.revoked_at is null
    );
$$;

create or replace function public.bcc_logout_device_session()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null or public.bcc_current_auth_session_id() is null then return false; end if;
  update public.bcc_device_sessions set revoked_at=coalesce(revoked_at,now())
  where user_id=auth.uid() and auth_session_id=public.bcc_current_auth_session_id()
    and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.bcc_current_auth_session_id() from public;
revoke all on function public.bcc_register_device_session(text,text) from public;
revoke all on function public.bcc_is_device_session_active(text) from public;
revoke all on function public.bcc_logout_device_session() from public;
grant execute on function public.bcc_current_auth_session_id() to authenticated;
grant execute on function public.bcc_register_device_session(text,text) to authenticated;
grant execute on function public.bcc_is_device_session_active(text) to authenticated;
grant execute on function public.bcc_logout_device_session() to authenticated;

commit;

-- Integration checklist (NOT handled by this SQL alone):
-- 1. Verify public.profiles.id and public.profiles.role match your actual schema.
-- 2. Call bcc_register_device_session('web', label) after website sign-in,
--    and bcc_register_device_session('android', label) after app sign-in.
-- 3. Call bcc_is_device_session_active(platform) at startup, on resume,
--    on realtime revocation events, and periodically; sign out if false.
-- 4. Enforce active-session checks on ALL protected API/database/storage paths.
--    Otherwise revoked JWTs may still access Supabase until expiration.
-- 5. Supabase Auth refresh-token/session revocation requires a separate trusted
--    server-side mechanism; never put service_role secrets in client code.
-- 6. Existing users must re-register or reauthenticate after rollout.

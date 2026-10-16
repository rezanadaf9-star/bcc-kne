-- Upgrade existing BCC teacher ID generation to BCC01ZQ format.
-- Safe to run after 20261015000100_teacher_portal.sql, including when the earlier migration was already applied.
do $$
declare n bigint;
begin
  select coalesce(max((regexp_match(login_id, '^BCC([0-9]+)[A-Z]{2}$'))[1]::bigint),0) into n
  from public.profiles where login_id ~ '^BCC[0-9]+[A-Z]{2}$';
  if not exists(select 1 from pg_class where relkind='S' and relname='bcc_teacher_id_seq') then
    execute format('create sequence public.bcc_teacher_id_seq start %s', n+1);
  else
    perform setval('public.bcc_teacher_id_seq', greatest(n, (select last_value from public.bcc_teacher_id_seq)), true);
  end if;
end $$;

drop function if exists public.next_bcc_teacher_id();
create or replace function public.next_bcc_teacher_id(p_full_name text)
returns text language plpgsql volatile security definer set search_path=public
as $$
declare parts text[]; first_initial text; second_initial text; serial_no bigint;
begin
  parts := regexp_split_to_array(trim(coalesce(p_full_name,'')), '\s+');
  if array_length(parts,1) < 2 or parts[1] = '' or parts[2] = '' then
    raise exception 'Enter a full name containing at least two names';
  end if;
  first_initial := upper(substring(regexp_replace(parts[1], '[^A-Za-z]', '', 'g') from 1 for 1));
  second_initial := upper(substring(regexp_replace(parts[2], '[^A-Za-z]', '', 'g') from 1 for 1));
  if first_initial = '' or second_initial = '' then
    raise exception 'The first two name parts must begin with letters';
  end if;
  serial_no := nextval('public.bcc_teacher_id_seq');
  return 'BCC' || lpad(serial_no::text, 2, '0') || first_initial || second_initial;
end;
$$;
revoke all on function public.next_bcc_teacher_id(text) from public, anon, authenticated;
grant execute on function public.next_bcc_teacher_id(text) to service_role;

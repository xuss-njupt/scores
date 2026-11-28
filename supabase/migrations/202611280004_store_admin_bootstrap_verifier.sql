-- Store the one-time bootstrap verifier in a service-role-only table,
-- rather than embedding the hash in a public Git repository.
alter table public.admin_bootstrap_state
  add column if not exists bootstrap_token_hash text;

update public.admin_bootstrap_state
set bootstrap_token_hash = 'cc5d47d9a8b47a9e0bc4d21df8e2fdf05ccff9146abccf7744f733a5b0965ca3'
where singleton = true
  and admin_id is null
  and claimed_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'admin_bootstrap_token_hash_format'
      and conrelid = 'public.admin_bootstrap_state'::regclass
  ) then
    alter table public.admin_bootstrap_state
      add constraint admin_bootstrap_token_hash_format
      check (bootstrap_token_hash is null or bootstrap_token_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$$;

revoke all on public.admin_bootstrap_state from anon, authenticated;
grant select, insert, update, delete on public.admin_bootstrap_state to service_role;

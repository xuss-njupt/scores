-- Allow exactly one super-administrator account in the entire application.
-- The unique partial index is the final database-level guard, independent of the UI.
create unique index if not exists profiles_single_super_admin_idx
  on public.profiles (role)
  where role = 'admin';

-- Synchronize the singleton state with any administrator that may already exist.
update public.admin_bootstrap_state s
set admin_id = existing.id,
    claimed_at = coalesce(s.claimed_at, now()),
    bootstrap_token_hash = null
from (
  select id from public.profiles where role = 'admin' order by created_at limit 1
) existing
where s.singleton = true;

-- If an administrator exists, permanently close first-registration.
update public.admin_bootstrap_state
set claimed_at = coalesce(claimed_at, now()),
    bootstrap_token_hash = null
where singleton = true
  and exists (select 1 from public.profiles where role = 'admin');

-- Atomic first-admin reservation. Only the service role can execute this function.
-- An abandoned reservation expires after 10 minutes; the unique index still prevents
-- two administrator profiles from ever being committed.
create or replace function public.claim_admin_registration(p_claimed_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.admin_bootstrap_state
  set claimed_at = p_claimed_at,
      bootstrap_token_hash = null
  where singleton = true
    and admin_id is null
    and (claimed_at is null or claimed_at < now() - interval '10 minutes');
  return found;
end;
$$;

revoke all on function public.claim_admin_registration(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_admin_registration(timestamptz) to service_role;

revoke all on public.admin_bootstrap_state from anon, authenticated;
grant select, insert, update, delete on public.admin_bootstrap_state to service_role;

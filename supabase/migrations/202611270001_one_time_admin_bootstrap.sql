create table if not exists public.admin_bootstrap_state (
  singleton boolean primary key default true check (singleton),
  claimed_at timestamptz,
  admin_id uuid references public.profiles(id) on delete set null
);
insert into public.admin_bootstrap_state(singleton)
values (true)
on conflict (singleton) do nothing;
alter table public.admin_bootstrap_state enable row level security;
revoke all on public.admin_bootstrap_state from public, anon, authenticated;
grant select, insert, update, delete on public.admin_bootstrap_state to service_role;
drop policy if exists admin_bootstrap_service_role_all on public.admin_bootstrap_state;
create policy admin_bootstrap_service_role_all on public.admin_bootstrap_state
for all to service_role using (true) with check (true);

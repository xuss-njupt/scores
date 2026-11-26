alter table private.student_invites set schema public;
alter table public.student_invites enable row level security;
revoke all on public.student_invites from public, anon, authenticated;
grant all on public.student_invites to service_role;

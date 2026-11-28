-- Teacher sign-in uses a stable internal Auth email derived from employee_no.
-- User-facing login remains employee number + password.
begin;

-- The old trigger depended on raw_app_meta_data being present during INSERT.
-- GoTrue may set app_metadata after INSERT, so profile creation is now explicit in Edge Functions.
drop trigger if exists on_teacher_self_registered on auth.users;
drop function if exists public.handle_teacher_self_registration();

-- Recover any teacher Auth users created by the old registration endpoint whose profile
-- was not created because the metadata-trigger did not run.
insert into public.profiles (id, role, full_name, employee_no, must_change_password)
select
  u.id,
  'teacher',
  left(btrim(u.raw_app_meta_data ->> 'full_name'), 100),
  btrim(u.raw_app_meta_data ->> 'employee_no'),
  false
from auth.users u
where u.raw_app_meta_data ->> 'signup_type' = 'teacher'
  and btrim(coalesce(u.raw_app_meta_data ->> 'full_name', '')) <> ''
  and btrim(coalesce(u.raw_app_meta_data ->> 'employee_no', '')) ~ '^20[0-9]{6}$'
  and not exists (select 1 from public.profiles p where p.id = u.id)
  and not exists (
    select 1 from public.profiles p
    where p.employee_no = btrim(u.raw_app_meta_data ->> 'employee_no')
  )
on conflict do nothing;

-- Convert existing teacher Auth identifiers to a deterministic internal email.
-- This does not change Auth user IDs or password hashes; it only removes email-confirmation
-- dependence and enables direct signInWithPassword using the employee number mapping.
update auth.users u
set
  email = 'teacher-' || p.employee_no || '@teachers.scores.invalid',
  email_confirmed_at = coalesce(u.email_confirmed_at, now()),
  updated_at = now()
from public.profiles p
where p.id = u.id
  and p.role = 'teacher'
  and p.employee_no ~ '^20[0-9]{6}$'
  and u.email is distinct from ('teacher-' || p.employee_no || '@teachers.scores.invalid');

commit;

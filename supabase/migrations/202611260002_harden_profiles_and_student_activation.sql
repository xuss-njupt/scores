alter table public.students drop constraint if exists students_profile_id_key;
alter table public.students drop column if exists activation_code_hash;
alter table public.students drop column if exists activation_expires_at;

revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

create table if not exists private.student_invites (
  id uuid primary key default gen_random_uuid(),
  student_no text not null,
  full_name text not null,
  class_id uuid not null references public.classes(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists student_invites_lookup_idx
  on private.student_invites(student_no, class_id, expires_at)
  where consumed_at is null;
revoke all on private.student_invites from public, anon, authenticated;
grant all on private.student_invites to service_role;

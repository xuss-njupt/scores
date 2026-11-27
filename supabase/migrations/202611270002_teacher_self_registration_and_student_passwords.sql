alter table public.profiles
  add column if not exists employee_no text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_employee_no_format_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_employee_no_format_check
      check (
        employee_no is null
        or (role = 'teacher' and employee_no ~ '^20[0-9]{6}$')
      );
  end if;
end;
$$;

create unique index if not exists profiles_employee_no_unique
  on public.profiles (employee_no)
  where employee_no is not null;

update public.profiles
set must_change_password = false
where role = 'student' and must_change_password = true;

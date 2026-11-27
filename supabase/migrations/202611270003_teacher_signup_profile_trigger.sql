create or replace function public.handle_teacher_self_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
  requested_employee_no text;
begin
  if new.raw_user_meta_data ->> 'signup_type' <> 'teacher' then
    return new;
  end if;

  requested_name := nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '');
  requested_employee_no := nullif(btrim(new.raw_user_meta_data ->> 'employee_no'), '');

  if requested_name is null or length(requested_name) > 100
     or requested_employee_no is null
     or requested_employee_no !~ '^20[0-9]{6}$' then
    raise exception 'Registration information is invalid';
  end if;

  insert into public.profiles (id, role, full_name, employee_no, must_change_password)
  values (new.id, 'teacher', requested_name, requested_employee_no, false);

  return new;
end;
$$;

revoke all on function public.handle_teacher_self_registration() from public, anon, authenticated;

drop trigger if exists on_teacher_self_registered on auth.users;
create trigger on_teacher_self_registered
after insert on auth.users
for each row
execute function public.handle_teacher_self_registration();

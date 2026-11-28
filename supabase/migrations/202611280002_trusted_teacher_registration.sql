-- The registration form uses a server-created Auth account (no email confirmation).
-- Only trusted app_metadata, not editable user_metadata, may create teacher profiles.
create or replace function public.handle_teacher_self_registration()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  requested_name text;
  requested_employee_no text;
begin
  if coalesce(new.raw_app_meta_data ->> 'signup_type','') <> 'teacher' then
    if coalesce(new.raw_user_meta_data ->> 'signup_type','') = 'teacher' then
      raise exception 'Registration information is invalid';
    end if;
    return new;
  end if;
  requested_name := nullif(btrim(new.raw_app_meta_data ->> 'full_name'),'');
  requested_employee_no := nullif(btrim(new.raw_app_meta_data ->> 'employee_no'),'');
  if requested_name is null or length(requested_name)>100
     or requested_employee_no is null or requested_employee_no !~ '^20[0-9]{6}$' then
    raise exception 'Registration information is invalid';
  end if;
  insert into public.profiles(id,role,full_name,employee_no,must_change_password)
  values(new.id,'teacher',requested_name,requested_employee_no,false);
  return new;
end;
$$;
revoke all on function public.handle_teacher_self_registration() from public, anon, authenticated;
-- A duplicate student number across classes must always identify the same student account.
create or replace function private.check_enrollment_identity()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.profile_id is not null and not exists (
    select 1 from public.profiles p
    where p.id=new.profile_id and p.role='student' and p.student_no=new.student_no
  ) then
    raise exception '学生账号与学号不匹配' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.check_enrollment_identity() from public, anon, authenticated;
drop trigger if exists enrollment_identity_integrity on public.students;
create trigger enrollment_identity_integrity before insert or update of profile_id, student_no on public.students
for each row execute function private.check_enrollment_identity();
create index if not exists students_student_no_idx on public.students(student_no);

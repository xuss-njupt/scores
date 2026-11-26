drop policy if exists classes_teacher_or_admin_select on public.classes;
drop policy if exists classes_enrolled_student_select on public.classes;
create policy classes_scoped_select on public.classes for select to authenticated
using (
  teacher_id = (select auth.uid())
  or private.is_admin()
  or exists (
    select 1 from public.students s
    where s.class_id = classes.id and s.profile_id = (select auth.uid())
  )
);

create index if not exists student_invites_class_id_idx on public.student_invites(class_id);
create index if not exists student_invites_created_by_idx on public.student_invites(created_by);

create policy student_invites_service_role_all on public.student_invites
for all to service_role using (true) with check (true);

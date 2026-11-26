create policy classes_enrolled_student_select on public.classes
for select to authenticated
using (
  exists (
    select 1 from public.students s
    where s.class_id = classes.id and s.profile_id = (select auth.uid())
  )
);

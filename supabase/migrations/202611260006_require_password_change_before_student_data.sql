create or replace function private.password_change_required()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select p.must_change_password from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;
revoke all on function private.password_change_required() from public, anon;
grant execute on function private.password_change_required() to authenticated;

drop policy if exists classes_scoped_select on public.classes;
create policy classes_scoped_select on public.classes for select to authenticated
using (
  teacher_id = (select auth.uid())
  or private.is_admin()
  or (
    not private.password_change_required()
    and exists (
      select 1 from public.students s
      where s.class_id = classes.id and s.profile_id = (select auth.uid())
    )
  )
);

drop policy if exists assessments_scoped_select on public.assessments;
create policy assessments_scoped_select on public.assessments for select to authenticated
using (
  private.owns_class(class_id) or private.is_admin()
  or (
    is_published
    and not private.password_change_required()
    and exists (
      select 1 from public.students s
      where s.class_id = assessments.class_id and s.profile_id = (select auth.uid())
    )
  )
);

drop policy if exists scores_teacher_or_owner_select on public.scores;
create policy scores_teacher_or_owner_select on public.scores for select to authenticated
using (
  private.is_admin()
  or exists (
    select 1 from public.assessments a
    where a.id = scores.assessment_id and private.owns_class(a.class_id)
  )
  or (
    private.is_enrolled_student(student_id)
    and not private.password_change_required()
    and exists (
      select 1 from public.assessments a
      where a.id = scores.assessment_id and a.is_published
    )
  )
);

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','teacher','student')),
  full_name text not null,
  student_no text unique,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_profile_no_check check (
    (role = 'student' and student_no is not null) or (role <> 'student' and student_no is null)
  )
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  term text,
  created_at timestamptz not null default now(),
  unique (teacher_id, name, term)
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_no text not null,
  full_name text not null,
  profile_id uuid unique references public.profiles(id) on delete set null,
  activation_code_hash text,
  activation_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (class_id, student_no)
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  name text not null,
  category text,
  exam_date date,
  max_score numeric(10,2),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (class_id, name)
);

create table public.scores (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  score numeric(10,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id)
);

create index classes_teacher_id_idx on public.classes(teacher_id);
create index students_class_id_idx on public.students(class_id);
create index students_profile_id_idx on public.students(profile_id);
create index assessments_class_id_idx on public.assessments(class_id);
create index scores_student_id_idx on public.scores(student_id);
create index scores_assessment_id_idx on public.scores(assessment_id);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;

create or replace function private.owns_class(target_class uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.classes c
    where c.id = target_class and c.teacher_id = (select auth.uid())
  );
$$;

create or replace function private.is_enrolled_student(target_student uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.students s
    where s.id = target_student and s.profile_id = (select auth.uid())
  );
$$;

revoke all on function private.is_admin() from public, anon;
revoke all on function private.owns_class(uuid) from public, anon;
revoke all on function private.is_enrolled_student(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.owns_class(uuid) to authenticated;
grant execute on function private.is_enrolled_student(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.assessments enable row level security;
alter table public.scores enable row level security;

create policy profiles_select_self_or_admin on public.profiles for select to authenticated
using (id = (select auth.uid()) or private.is_admin());
create policy profiles_update_self_or_admin on public.profiles for update to authenticated
using (id = (select auth.uid()) or private.is_admin())
with check (id = (select auth.uid()) or private.is_admin());

create policy classes_teacher_or_admin_select on public.classes for select to authenticated
using (teacher_id = (select auth.uid()) or private.is_admin());
create policy classes_teacher_insert on public.classes for insert to authenticated
with check (
  teacher_id = (select auth.uid()) and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'teacher'
  )
);
create policy classes_teacher_update on public.classes for update to authenticated
using (teacher_id = (select auth.uid()) or private.is_admin())
with check (teacher_id = (select auth.uid()) or private.is_admin());
create policy classes_teacher_delete on public.classes for delete to authenticated
using (teacher_id = (select auth.uid()) or private.is_admin());

create policy students_teacher_select on public.students for select to authenticated
using (private.owns_class(class_id) or private.is_admin() or private.is_enrolled_student(id));
create policy students_teacher_insert on public.students for insert to authenticated
with check (private.owns_class(class_id) or private.is_admin());
create policy students_teacher_update on public.students for update to authenticated
using (private.owns_class(class_id) or private.is_admin())
with check (private.owns_class(class_id) or private.is_admin());
create policy students_teacher_delete on public.students for delete to authenticated
using (private.owns_class(class_id) or private.is_admin());

create policy assessments_scoped_select on public.assessments for select to authenticated
using (
  private.owns_class(class_id) or private.is_admin()
  or (
    is_published and exists (
      select 1 from public.students s
      where s.class_id = assessments.class_id and s.profile_id = (select auth.uid())
    )
  )
);
create policy assessments_teacher_insert on public.assessments for insert to authenticated
with check (private.owns_class(class_id) or private.is_admin());
create policy assessments_teacher_update on public.assessments for update to authenticated
using (private.owns_class(class_id) or private.is_admin())
with check (private.owns_class(class_id) or private.is_admin());
create policy assessments_teacher_delete on public.assessments for delete to authenticated
using (private.owns_class(class_id) or private.is_admin());

create policy scores_teacher_or_owner_select on public.scores for select to authenticated
using (
  private.is_admin()
  or exists (
    select 1 from public.assessments a
    where a.id = scores.assessment_id and private.owns_class(a.class_id)
  )
  or (
    private.is_enrolled_student(student_id)
    and exists (
      select 1 from public.assessments a
      where a.id = scores.assessment_id and a.is_published
    )
  )
);
create policy scores_teacher_insert on public.scores for insert to authenticated
with check (
  private.is_admin()
  or exists (
    select 1 from public.assessments a
    where a.id = scores.assessment_id and private.owns_class(a.class_id)
  )
);
create policy scores_teacher_update on public.scores for update to authenticated
using (
  private.is_admin()
  or exists (
    select 1 from public.assessments a
    where a.id = scores.assessment_id and private.owns_class(a.class_id)
  )
)
with check (
  private.is_admin()
  or exists (
    select 1 from public.assessments a
    where a.id = scores.assessment_id and private.owns_class(a.class_id)
  )
);
create policy scores_teacher_delete on public.scores for delete to authenticated
using (
  private.is_admin()
  or exists (
    select 1 from public.assessments a
    where a.id = scores.assessment_id and private.owns_class(a.class_id)
  )
);

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.classes to authenticated;
grant select, insert, update, delete on public.students to authenticated;
grant select, insert, update, delete on public.assessments to authenticated;
grant select, insert, update, delete on public.scores to authenticated;

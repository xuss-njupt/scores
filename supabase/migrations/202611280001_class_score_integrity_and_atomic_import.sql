-- Keep the existing authentication model. Enforce integrity independently of UI.
revoke truncate, references, trigger on public.profiles, public.classes, public.students, public.assessments, public.scores from anon, authenticated;
-- Enrollment identity is managed only by the trusted import/activation functions.
revoke insert, update, delete on public.students from authenticated;
revoke update on public.assessments from authenticated;
grant update (name, category, exam_date, max_score, is_published) on public.assessments to authenticated;
revoke update on public.classes from authenticated;
grant update (name, term) on public.classes to authenticated;

create or replace function private.check_score_class()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.assessments a join public.students s on s.class_id=a.class_id
    where a.id=new.assessment_id and s.id=new.student_id
  ) then
    raise exception '成绩与学生必须属于同一班级' using errcode='23514';
  end if;
  if new.score < 0 or new.score = 'NaN'::numeric then
    raise exception '成绩数值无效' using errcode='23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.check_score_class() from public, anon, authenticated;
drop trigger if exists score_class_integrity on public.scores;
create trigger score_class_integrity before insert or update on public.scores
for each row execute function private.check_score_class();

-- Single transaction: validate the whole file first, then update only draft scores.
-- SECURITY INVOKER preserves the existing per-class RLS checks.
create or replace function public.import_class_scores(p_class_id uuid, p_rows jsonb)
returns integer language plpgsql security invoker set search_path = ''
as $$
declare
  written integer;
begin
  if auth.uid() is null or not (private.owns_class(p_class_id) or private.is_admin()) then
    raise exception '无权导入该班级成绩' using errcode='42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception '成绩数据格式错误';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 25000 then
    raise exception '每次导入需要 1 至 25000 条有效成绩';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) r(student_no text, full_name text, assessment_name text, score numeric)
    left join public.students s on s.class_id=p_class_id and s.student_no=r.student_no
    where s.id is null or r.full_name is null or lower(btrim(s.full_name)) <> lower(btrim(r.full_name))
      or r.assessment_name is null or btrim(r.assessment_name)='' or length(r.assessment_name)>150
      or r.score is null or r.score='NaN'::numeric or r.score<0 or r.score>99999999.99
      or round(r.score,2)<>r.score
  ) then
    raise exception '存在不匹配的学号、姓名或无效成绩，请核对文件';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) r(student_no text, assessment_name text)
    group by student_no, btrim(assessment_name) having count(*)>1
  ) then
    raise exception '成绩表存在重复记录';
  end if;
  -- New and reimported assessments both become unpublished atomically.
  insert into public.assessments (class_id,name,category,is_published)
  select distinct p_class_id,btrim(r.assessment_name),'成绩',false
  from jsonb_to_recordset(p_rows) r(assessment_name text)
  on conflict (class_id,name) do update set is_published=false;

  insert into public.scores (assessment_id,student_id,score)
  select a.id,s.id,r.score
  from jsonb_to_recordset(p_rows) r(student_no text,assessment_name text,score numeric)
  join public.students s on s.class_id=p_class_id and s.student_no=r.student_no
  join public.assessments a on a.class_id=p_class_id and a.name=btrim(r.assessment_name)
  on conflict (assessment_id,student_id) do update set score=excluded.score;
  get diagnostics written=row_count;
  return written;
end;
$$;
revoke all on function public.import_class_scores(uuid,jsonb) from public, anon;
grant execute on function public.import_class_scores(uuid,jsonb) to authenticated;

-- Remove the obsolete student first-login flag and ensure no accidental reintroduction.
update public.profiles set must_change_password=false where role='student' and must_change_password=true;

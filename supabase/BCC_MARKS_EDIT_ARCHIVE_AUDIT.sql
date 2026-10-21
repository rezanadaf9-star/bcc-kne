-- Run once in Supabase SQL Editor, after a database backup.
-- No existing examination or marks records are deleted.
ALTER TABLE public.academic_exam_sets ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.academic_exam_sets ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.profiles(id);

CREATE TABLE IF NOT EXISTS public.academic_marks_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.academic_exam_sets(id),
  student_id uuid NOT NULL REFERENCES public.profiles(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  old_marks jsonb NOT NULL,
  new_marks jsonb NOT NULL,
  old_included_subject_ids jsonb,
  new_included_subject_ids jsonb,
  reason text NOT NULL CHECK(length(trim(reason))>0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS academic_marks_audit_lookup ON public.academic_marks_audit(exam_id,student_id,created_at DESC);
ALTER TABLE public.academic_marks_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS academic_marks_audit_staff_read ON public.academic_marks_audit;
CREATE POLICY academic_marks_audit_staff_read ON public.academic_marks_audit FOR SELECT TO authenticated USING(public.is_staff());
-- No direct client insert/update/delete policies: corrections must pass through the validated RPC.

CREATE OR REPLACE FUNCTION public.correct_academic_student_marks(
  p_exam_id uuid,p_student_id uuid,p_marks jsonb,p_included_subject_ids jsonb,p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_exam public.academic_exam_sets%ROWTYPE;
  v_previous public.student_exam_marks%ROWTYPE;
  v_subject record;
  v_ids jsonb;
  v_value numeric;
  v_count integer;
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'Staff access required'; END IF;
  IF length(trim(coalesce(p_reason,'')))<3 THEN RAISE EXCEPTION 'Please provide a correction reason'; END IF;
  SELECT * INTO v_exam FROM public.academic_exam_sets WHERE id=p_exam_id FOR UPDATE;
  IF NOT FOUND OR v_exam.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Exam is unavailable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.student_profiles WHERE user_id=p_student_id AND class_no=v_exam.class_no) THEN RAISE EXCEPTION 'Student does not belong to exam class'; END IF;
  IF p_marks IS NULL OR jsonb_typeof(p_marks)<>'object' THEN RAISE EXCEPTION 'Invalid marks payload'; END IF;
  IF p_included_subject_ids IS NOT NULL AND jsonb_typeof(p_included_subject_ids)<>'array' THEN RAISE EXCEPTION 'Invalid subject selection'; END IF;
  SELECT count(*) INTO v_count FROM public.academic_exam_subjects WHERE exam_id=p_exam_id;
  IF v_count=0 THEN RAISE EXCEPTION 'No configured subjects'; END IF;
  SELECT coalesce(p_included_subject_ids,jsonb_agg(subject_id::text)) INTO v_ids FROM public.academic_exam_subjects WHERE exam_id=p_exam_id;
  IF jsonb_array_length(v_ids)=0 THEN RAISE EXCEPTION 'Select at least one subject'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(v_ids) x WHERE NOT EXISTS(SELECT 1 FROM public.academic_exam_subjects s WHERE s.exam_id=p_exam_id AND s.subject_id::text=x)) THEN RAISE EXCEPTION 'Unknown subject'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_marks)) <> jsonb_array_length(v_ids) THEN RAISE EXCEPTION 'Every included subject requires a mark'; END IF;
  FOR v_subject IN SELECT subject_id,full_marks FROM public.academic_exam_subjects WHERE exam_id=p_exam_id LOOP
    IF v_ids ? v_subject.subject_id::text THEN
      IF NOT p_marks ? v_subject.subject_id::text THEN RAISE EXCEPTION 'Missing subject marks'; END IF;
      BEGIN v_value:=(p_marks->>v_subject.subject_id::text)::numeric;
      EXCEPTION WHEN others THEN RAISE EXCEPTION 'Marks must be numeric'; END;
      IF v_value<0 OR v_value>v_subject.full_marks THEN RAISE EXCEPTION 'Marks exceed full marks'; END IF;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_marks) x WHERE NOT v_ids ? x) THEN RAISE EXCEPTION 'Marks contain excluded subjects'; END IF;
  SELECT * INTO v_previous FROM public.student_exam_marks WHERE exam_id=p_exam_id AND student_id=p_student_id FOR UPDATE;
  INSERT INTO public.student_exam_marks(exam_id,student_id,marks,included_subject_ids,status,updated_at)
    VALUES(p_exam_id,p_student_id,p_marks,v_ids,'completed',now())
    ON CONFLICT(exam_id,student_id) DO UPDATE SET marks=excluded.marks,included_subject_ids=excluded.included_subject_ids,status='completed',updated_at=now();
  INSERT INTO public.academic_marks_audit(exam_id,student_id,actor_id,old_marks,new_marks,old_included_subject_ids,new_included_subject_ids,reason)
    VALUES(p_exam_id,p_student_id,auth.uid(),coalesce(v_previous.marks,'{}'::jsonb),p_marks,v_previous.included_subject_ids,v_ids,trim(p_reason));
END;
$$;
REVOKE ALL ON FUNCTION public.correct_academic_student_marks(uuid,uuid,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_academic_student_marks(uuid,uuid,jsonb,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_academic_exam(p_exam_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.is_staff() THEN RAISE EXCEPTION 'Staff access required'; END IF;
 UPDATE public.academic_exam_sets SET archived_at=now(),archived_by=auth.uid() WHERE id=p_exam_id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Exam not found or already archived'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.archive_academic_exam(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_academic_exam(uuid) TO authenticated;

-- Prevent archived exams from appearing in the student leaderboard RPC.
-- This also ensures that old direct leaderboard links cannot display archived results.
CREATE OR REPLACE FUNCTION public.academic_exam_is_active(p_exam_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.academic_exam_sets WHERE id=p_exam_id AND archived_at IS NULL);
$$;
REVOKE ALL ON FUNCTION public.academic_exam_is_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.academic_exam_is_active(uuid) TO authenticated;

-- Recreate leaderboard RPC with archived-exam guard.
drop function if exists public.get_academic_exam_leaderboard(uuid);
create or replace function public.get_academic_exam_leaderboard(p_exam_id uuid)
returns table(
  student_id uuid,
  full_name text,
  login_id text,
  class_no integer,
  roll_number text,
  photo_path text,
  total_score numeric,
  total_full_marks numeric,
  percentage numeric,
  rank bigint
)
language plpgsql security definer set search_path=public as $$
declare
  v_class integer;
  v_declared boolean;
begin
  select e.class_no,e.result_declared into v_class,v_declared from public.academic_exam_sets e where e.id=p_exam_id;
  if v_class is null then raise exception 'Exam not found.'; end if;
  if not public.is_staff() and v_class <> public.my_class() then raise exception 'You cannot view this class leaderboard.'; end if;
  if not v_declared or not public.academic_exam_is_active(p_exam_id) then return; end if;
  return query
  with scored as (
    select sp.user_id as student_id,p.full_name,p.login_id,sp.class_no,sp.roll_number,sp.photo_path,
      coalesce((select sum((j.value)::numeric) from jsonb_each_text(sem.marks) j where sem.included_subject_ids is null or sem.included_subject_ids ? j.key),0)::numeric as total_score,
      coalesce((select sum(aes.full_marks) from public.academic_exam_subjects aes where aes.exam_id=p_exam_id and (sem.included_subject_ids is null or sem.included_subject_ids ? aes.subject_id::text)),0)::numeric as total_full_marks
    from public.student_profiles sp
    join public.profiles p on p.id=sp.user_id
    join public.student_exam_marks sem on sem.student_id=sp.user_id and sem.exam_id=p_exam_id and sem.status='completed'
    where sp.class_no=v_class
  ), ranked as (
    select s.*,case when s.total_full_marks>0 then round((s.total_score/s.total_full_marks)*100,2) else 0::numeric end as percentage
    from scored s
  )
  select r.student_id,r.full_name,r.login_id,r.class_no,r.roll_number,r.photo_path,r.total_score,r.total_full_marks,r.percentage,
    rank() over(order by r.percentage desc,r.total_score desc,r.full_name asc) as rank
  from ranked r
  order by r.percentage desc,r.total_score desc,r.full_name asc;
end;
$$;
revoke all on function public.get_academic_exam_leaderboard(uuid) from public;
grant execute on function public.get_academic_exam_leaderboard(uuid) to authenticated;

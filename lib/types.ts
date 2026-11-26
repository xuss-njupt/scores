export type AppRole = "admin" | "teacher" | "student";

export type Profile = {
  id: string;
  role: AppRole;
  full_name: string;
  student_no: string | null;
  must_change_password: boolean;
};

export type Classroom = {
  id: string;
  teacher_id: string;
  name: string;
  term: string | null;
};

export type Student = {
  id: string;
  class_id: string;
  student_no: string;
  full_name: string;
  profile_id: string | null;
};

export type Assessment = {
  id: string;
  class_id: string;
  name: string;
  category: string | null;
  exam_date: string | null;
  max_score: number | null;
  is_published: boolean;
};

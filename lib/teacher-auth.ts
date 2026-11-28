// Teacher identities use an internal Auth email derived from the employee number.
// The real sign-in identifier exposed to users remains the employee number.
export function teacherEmail(employeeNo: string): string {
  return "teacher-" + employeeNo.trim() + "@teachers.scores.invalid";
}

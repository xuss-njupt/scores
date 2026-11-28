export type RosterRow = { student_no: string; full_name: string; initial_password: string };
export type ScoreRow = { student_no: string; full_name: string; assessment_name: string; score: number };
export type Workbook = { headers: string[]; rows: string[][] };
export type StudentIdentity = { student_no: string; full_name: string };
const headerKey = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, "").replace(/[（(](必填|可选|optional|required)[）)]$/i, "");
const studentHeaders = ["学号", "studentno", "studentid"];
const nameHeaders = ["姓名", "name", "studentname"];
const passwordHeaders = ["密码", "初始密码", "password", "initialpassword"];
const studentNo = (value: string) => value.trim().toUpperCase();
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function columns(workbook: Workbook) {
  const keys = workbook.headers.map(headerKey);
  const used = new Set<string>();
  for (const [i, key] of keys.entries()) {
    if (!key) {
      if (workbook.rows.some(row => (row[i] ?? "").trim())) throw new Error("第 " + (i + 1) + " 列缺少表头。");
      continue;
    }
    if (used.has(key)) throw new Error("表头重复：" + workbook.headers[i]);
    used.add(key);
  }
  const no = keys.findIndex(key => studentHeaders.includes(key));
  const name = keys.findIndex(key => nameHeaders.includes(key));
  const password = keys.findIndex(key => passwordHeaders.includes(key));
  if (no < 0 || name < 0) throw new Error("Excel 第一行必须包含学号、姓名。");
  return { no, name, password };
}

export function parseRoster(workbook: Workbook): RosterRow[] {
  const { no, name, password } = columns(workbook);
  if (!workbook.rows.length || workbook.rows.length > 500) throw new Error("每次名单导入限 1–500 人。");
  const seen = new Set<string>();
  return workbook.rows.map((row, index) => {
    const id = studentNo(row[no] ?? "");
    const fullName = (row[name] ?? "").trim();
    const raw = password < 0 ? "" : (row[password] ?? "");
    const pass = raw.trim() ? raw : "";
    const prefix = "第 " + (index + 2) + " 行：";
    if (!id || !fullName || id.length > 64 || fullName.length > 100) throw new Error(prefix + "学号或姓名无效。");
    if (seen.has(id)) throw new Error(prefix + "学号重复：" + id);
    if (pass && (pass.length < 10 || pass.length > 128)) throw new Error(prefix + "密码需要 10–128 位。");
    seen.add(id);
    return { student_no: id, full_name: fullName, initial_password: pass };
  });
}

export function parseScores(workbook: Workbook, students: StudentIdentity[]): ScoreRow[] {
  const { no, name } = columns(workbook);
  const scoreColumns = workbook.headers.map((header, index) => ({ name: header.trim(), index }))
    .filter(column => column.index !== no && column.index !== name && column.name);
  if (!scoreColumns.length) throw new Error("至少需要一个成绩项目列。");
  if (scoreColumns.some(column => column.name.length > 150)) throw new Error("成绩项目名称过长。");
  const roster = new Map(students.map(student => [studentNo(student.student_no), student]));
  const seen = new Set<string>();
  const output: ScoreRow[] = [];
  for (const [index, row] of workbook.rows.entries()) {
    const id = studentNo(row[no] ?? "");
    const prefix = "第 " + (index + 2) + " 行：";
    const student = roster.get(id);
    if (!student || !sameName(student.full_name, row[name] ?? "")) throw new Error(prefix + "学号或姓名与本班名单不匹配。");
    if (seen.has(id)) throw new Error(prefix + "学号重复：" + id);
    seen.add(id);
    for (const column of scoreColumns) {
      const raw = (row[column.index] ?? "").trim();
      if (!raw) continue;
      // Avoid permissive Number() coercion of hexadecimal, booleans, or malformed commas.
      if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || Number(raw) > 99999999.99) {
        throw new Error(prefix + column.name + " 成绩无效：" + raw.slice(0, 30));
      }
      output.push({ student_no: student.student_no, full_name: student.full_name, assessment_name: column.name, score: Number(raw) });
    }
  }
  if (!output.length) throw new Error("文件没有有效成绩。");
  if (output.length > 25000) throw new Error("每次最多导入 25000 条成绩，请拆分文件。");
  return output;
}

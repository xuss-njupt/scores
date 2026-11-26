"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import type { Assessment, Classroom, Profile, Student } from "@/lib/types";

type Notice = { kind: "success" | "error" | "info"; text: string } | null;

function showError(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

async function studentLoginEmail(studentNo: string) {
  const normalized = studentNo.trim().toUpperCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return "student-" + hex.slice(0, 40) + "@students.scores.invalid";
}

async function adminAction<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke("scores-admin", {
    body: { action, ...payload },
  });
  if (error) {
    const detail = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : error.message;
    throw new Error(detail || "服务器接口调用失败");
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

function readCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    if ("result" in item) return readCell(item.result);
    if ("text" in item) return String(item.text ?? "").trim();
    if ("richText" in item && Array.isArray(item.richText)) {
      return item.richText.map((part) => String((part as { text?: string }).text ?? "")).join("").trim();
    }
  }
  return String(value).trim();
}

function headerIndex(headers: string[], candidates: string[]) {
  const normalized = headers.map((value) => value.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  return normalized.findIndex((value) => candidates.includes(value));
}

async function readWorkbook(file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error("Excel 文件不能超过 10 MB。");
  const { readSheet } = await import("read-excel-file/browser");
  const data = await readSheet(file, 1);
  if (!data || data.length < 2) throw new Error("Excel 文件没有可读取的数据。");
  const headers = (data[0] ?? []).map(readCell);
  if (headers.every((item) => !item)) throw new Error("Excel 第一行必须是字段名称。");
  const rows = data.slice(1)
    .map((row) => headers.map((_, column) => readCell(row[column] ?? null)))
    .filter((row) => row.some((item) => item !== ""));
  return { headers, rows };
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = "\uFEFF" + rows.map((row) => row.map((cell) => '"' + cell.replaceAll('"', '""') + '"').join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function NoticeBar({ notice, onClose }: { notice: Notice; onClose?: () => void }) {
  if (!notice) return null;
  return (
    <div className={"notice " + notice.kind} role="status">
      <span>{notice.text}</span>
      {onClose && <button className="notice-close" onClick={onClose} aria-label="关闭提示">×</button>}
    </div>
  );
}

function AppHeader({ profile, onLogout }: { profile: Profile; onLogout: () => void }) {
  const roleText = profile.role === "admin" ? "超级管理员" : profile.role === "teacher" ? "教师" : "学生";
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">分</div>
        <div><strong>校园成绩平台</strong><span>Academic Score Portal</span></div>
      </div>
      <div className="account">
        <div className="avatar">{profile.full_name.slice(0, 1)}</div>
        <div className="account-copy"><strong>{profile.full_name}</strong><span>{roleText}</span></div>
        <button className="button button-light button-small" onClick={onLogout}>退出登录</button>
      </div>
    </header>
  );
}

function LoginPanel({ onNotice }: { onNotice: (notice: Notice) => void }) {
  const [mode, setMode] = useState<"staff" | "student" | "activate">("staff");
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [studentNo, setStudentNo] = useState("");
  const [studentName, setStudentName] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const email = mode === "student" ? await studentLoginEmail(identity) : identity.trim().toLowerCase();
      const { error } = await getSupabase().auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error) {
      onNotice({ kind: "error", text: showError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function activate(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword.length < 10) {
      onNotice({ kind: "error", text: "密码至少需要10位。" });
      return;
    }
    if (newPassword !== confirmPassword) {
      onNotice({ kind: "error", text: "两次输入的密码不一致。" });
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await getSupabase().functions.invoke("student-activate", {
        body: {
          student_no: studentNo.trim().toUpperCase(),
          full_name: studentName.trim(),
          activation_code: activationCode.trim(),
          password: newPassword,
        },
      });
      if (error) throw new Error(data?.error || error.message);
      if (data?.error) throw new Error(String(data.error));
      onNotice({ kind: "success", text: "账号激活成功，请返回登录页面使用学号和新密码登录。" });
      setMode("student");
      setIdentity(studentNo.trim().toUpperCase());
      setPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      onNotice({ kind: "error", text: showError(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="login-intro">
        <div className="eyebrow">SCHOOL ACADEMIC SERVICE</div>
        <h1>成绩清晰可查，<br /><span>学习每一步都有回响。</span></h1>
        <p>面向教师与学生的统一成绩管理平台。教师维护班级与考试成绩，学生安全查看本人已发布的学习记录。</p>
        <div className="intro-points">
          <div><span className="point-icon">01</span><div><strong>分级权限管理</strong><small>管理员、教师、学生各司其职</small></div></div>
          <div><span className="point-icon">02</span><div><strong>Excel 批量处理</strong><small>名单与多科成绩便捷导入</small></div></div>
          <div><span className="point-icon">03</span><div><strong>成绩安全可控</strong><small>教师发布后，学生仅可见本人数据</small></div></div>
        </div>
      </section>

      <section className="login-card">
        <div className="card-heading">
          <div className="eyebrow">WELCOME BACK</div>
          <h2>{mode === "activate" ? "首次激活学生账号" : "登录成绩平台"}</h2>
          <p>{mode === "activate" ? "请使用教师发放的一次性激活码创建个人密码。" : "请选择账号类型并输入登录信息。"}</p>
        </div>
        {mode !== "activate" ? (
          <>
            <div className="segmented">
              <button className={mode === "staff" ? "active" : ""} onClick={() => setMode("staff")}>教师 / 管理员</button>
              <button className={mode === "student" ? "active" : ""} onClick={() => setMode("student")}>学生登录</button>
            </div>
            <form onSubmit={signIn} className="form-stack">
              <label>{mode === "student" ? "学号" : "登录邮箱"}
                <input value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder={mode === "student" ? "请输入学号" : "name@school.edu"} autoComplete="username" required />
              </label>
              <label>密码
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入登录密码" autoComplete="current-password" required />
              </label>
              <button className="button button-primary button-full" disabled={busy}>{busy ? "正在登录…" : "登录"}</button>
            </form>
            {mode === "student" && <button className="text-button" onClick={() => setMode("activate")}>首次使用？使用激活码设置密码</button>}
            {mode === "staff" && <p className="form-footnote">教师账号由学校超级管理员创建，不开放公开注册。</p>}
          </>
        ) : (
          <>
            <form onSubmit={activate} className="form-stack">
              <label>学号<input value={studentNo} onChange={(event) => setStudentNo(event.target.value)} placeholder="与教师导入的学号一致" required /></label>
              <label>姓名<input value={studentName} onChange={(event) => setStudentName(event.target.value)} placeholder="请输入真实姓名" required /></label>
              <label>一次性激活码<input value={activationCode} onChange={(event) => setActivationCode(event.target.value)} placeholder="请输入教师发放的激活码" required /></label>
              <label>设置新密码<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={10} autoComplete="new-password" placeholder="至少10位" required /></label>
              <label>确认新密码<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={10} autoComplete="new-password" placeholder="再次输入新密码" required /></label>
              <button className="button button-primary button-full" disabled={busy}>{busy ? "正在激活…" : "激活并设置密码"}</button>
            </form>
            <button className="text-button" onClick={() => setMode("student")}>返回学生登录</button>
          </>
        )}
        <div className="security-note"><span>盾</span> 个人成绩仅本人及授权教师可访问</div>
      </section>
    </main>
  );
}

function AdminDashboard({ onNotice }: { onNotice: (notice: Notice) => void }) {
  const [teachers, setTeachers] = useState<Array<{ id: string; full_name: string; created_at: string }>>([]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadTeachers() {
    try {
      const result = await adminAction<{ teachers: typeof teachers }>("list_teachers");
      setTeachers(result.teachers ?? []);
    } catch (error) {
      onNotice({ kind: "error", text: showError(error) });
    }
  }
  useEffect(() => { void loadTeachers(); }, []);

  async function createTeacher(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await adminAction("create_teacher", { full_name: fullName.trim(), email: email.trim(), password });
      onNotice({ kind: "success", text: "教师账号已创建。请通过安全渠道将邮箱和初始密码交给教师本人。" });
      setFullName(""); setEmail(""); setPassword("");
      await loadTeachers();
    } catch (error) {
      onNotice({ kind: "error", text: showError(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dashboard-wrap">
      <div className="page-heading"><div><div className="eyebrow">SYSTEM CONTROL</div><h1>管理员工作台</h1><p>创建教师账号并维护平台访问权限。</p></div><div className="heading-stat"><strong>{teachers.length}</strong><span>位教师账号</span></div></div>
      <div className="content-grid admin-grid">
        <section className="panel">
          <div className="panel-title"><div><h2>创建教师账号</h2><p>初始密码至少10位，教师首次登录后可更改。</p></div><span className="panel-icon">＋</span></div>
          <form onSubmit={createTeacher} className="form-stack">
            <label>教师姓名<input value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="例如：王老师" /></label>
            <label>登录邮箱<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="teacher@school.edu" /></label>
            <label>初始密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required placeholder="至少10位" /></label>
            <button className="button button-primary" disabled={busy}>{busy ? "正在创建…" : "创建教师账号"}</button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-title"><div><h2>教师账号</h2><p>当前平台已创建的教师账户。</p></div><button className="button button-light button-small" onClick={() => void loadTeachers()}>刷新</button></div>
          {teachers.length === 0 ? <div className="empty-state">暂无教师账号。创建后的教师会显示在这里。</div> : (
            <div className="teacher-list">{teachers.map((teacher) => <div className="teacher-row" key={teacher.id}><div className="avatar avatar-muted">{teacher.full_name.slice(0, 1)}</div><div><strong>{teacher.full_name}</strong><small>创建于 {new Date(teacher.created_at).toLocaleDateString("zh-CN")}</small></div><span className="status-pill">教师</span></div>)}</div>
          )}
        </section>
      </div>
      <div className="info-strip"><strong>权限提醒</strong><span>教师账号只能由超级管理员创建。不要把管理员账号交给教师或学生共用。</span></div>
    </div>
  );
}

function TeacherDashboard({ profile, onOpenClass, onNotice }: { profile: Profile; onOpenClass: (value: Classroom) => void; onNotice: (notice: Notice) => void }) {
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadClasses() {
    try {
      const { data, error } = await getSupabase().from("classes").select("id,teacher_id,name,term").order("created_at", { ascending: false });
      if (error) throw error;
      setClasses((data ?? []) as Classroom[]);
    } catch (error) {
      onNotice({ kind: "error", text: showError(error) });
    }
  }
  useEffect(() => { void loadClasses(); }, []);

  async function createClass(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const { error } = await getSupabase().from("classes").insert({
        teacher_id: profile.id, name: name.trim(), term: term.trim() || null,
      });
      if (error) throw error;
      setName(""); setTerm("");
      onNotice({ kind: "success", text: "班级创建成功。" });
      await loadClasses();
    } catch (error) {
      onNotice({ kind: "error", text: showError(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dashboard-wrap">
      <div className="page-heading"><div><div className="eyebrow">TEACHER WORKSPACE</div><h1>教师工作台</h1><p>欢迎回来，{profile.full_name}。选择班级，开始维护名单和成绩。</p></div><div className="heading-stat"><strong>{classes.length}</strong><span>个班级</span></div></div>
      <div className="content-grid teacher-grid">
        <section className="panel create-panel">
          <div className="panel-title"><div><h2>创建班级</h2><p>每位教师只能管理自己创建的班级。</p></div><span className="panel-icon">＋</span></div>
          <form onSubmit={createClass} className="form-stack">
            <label>班级名称<input value={name} onChange={(e) => setName(e.target.value)} required placeholder="例如：材料物理 2026 级 1 班" /></label>
            <label>学期 / 年级（可选）<input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="例如：2026-2027 学年第一学期" /></label>
            <button className="button button-primary" disabled={busy}>{busy ? "正在创建…" : "创建班级"}</button>
          </form>
        </section>
        <section className="panel classes-panel">
          <div className="panel-title"><div><h2>我的班级</h2><p>打开班级管理学生名单与成绩。</p></div><button className="button button-light button-small" onClick={() => void loadClasses()}>刷新</button></div>
          {classes.length === 0 ? <div className="empty-state"><div className="empty-icon">班</div><strong>还没有班级</strong><span>先在左侧创建一个班级。</span></div> : (
            <div className="class-list">{classes.map((item) => <button className="class-card" key={item.id} onClick={() => onOpenClass(item)}><div className="class-avatar">{item.name.slice(0, 1)}</div><div className="class-card-copy"><strong>{item.name}</strong><span>{item.term || "未设置学期"}</span></div><span className="class-arrow">›</span></button>)}</div>
          )}
        </section>
      </div>
    </div>
  );
}

function StudentDashboard({ profile }: { profile: Profile }) {
  const [records, setRecords] = useState<Array<{ id: string; score: number; name: string; date: string | null; max: number | null; className: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const sb = getSupabase();
        const { data: enrollments, error: enrollmentError } = await sb.from("students")
          .select("id,class_id").eq("profile_id", profile.id);
        if (enrollmentError) throw enrollmentError;
        const enrollmentRows = enrollments ?? [];
        const classIds = [...new Set(enrollmentRows.map((item) => item.class_id))];
        const { data: classRows, error: classError } = classIds.length
          ? await sb.from("classes").select("id,name").in("id", classIds)
          : { data: [], error: null };
        if (classError) throw classError;
        const classNames = new Map((classRows ?? []).map((item) => [item.id, item.name]));
        const collected: Array<{ id: string; score: number; name: string; date: string | null; max: number | null; className: string }> = [];
        for (const enrollment of enrollmentRows) {
          const { data, error } = await sb.from("scores")
            .select("id,score,assessments!inner(id,name,exam_date,max_score,is_published)")
            .eq("student_id", enrollment.id)
            .eq("assessments.is_published", true)
            .order("created_at", { ascending: false });
          if (error) throw error;
          for (const item of data ?? []) {
            const raw = item as unknown as { id: string; score: number; assessments: { name: string; exam_date: string | null; max_score: number | null } | Array<{ name: string; exam_date: string | null; max_score: number | null }> };
            const assessment = Array.isArray(raw.assessments) ? raw.assessments[0] : raw.assessments;
            if (assessment) collected.push({
              id: raw.id, score: Number(raw.score), name: assessment.name, date: assessment.exam_date,
              max: assessment.max_score, className: classNames.get(enrollment.class_id) ?? "我的班级",
            });
          }
        }
        if (!cancelled) { setRecords(collected); setErrorText(""); }
      } catch (error) {
        if (!cancelled) setErrorText(showError(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [profile.id]);

  const average = useMemo(() => records.length ? records.reduce((sum, item) => sum + item.score, 0) / records.length : 0, [records]);
  return (
    <div className="dashboard-wrap">
      <div className="page-heading"><div><div className="eyebrow">STUDENT PORTAL</div><h1>我的成绩</h1><p>{profile.full_name} · 学号 {profile.student_no}</p></div><div className="heading-stat"><strong>{records.length}</strong><span>条已发布成绩</span></div></div>
      <div className="metric-row">
        <div className="metric-card"><span>已发布成绩</span><strong>{records.length}</strong><small>当前可查看的考试记录</small></div>
        <div className="metric-card"><span>平均分</span><strong>{records.length ? average.toFixed(1) : "—"}</strong><small>按已发布成绩计算</small></div>
        <div className="metric-card"><span>数据权限</span><strong className="metric-safe">本人</strong><small>仅显示属于当前账号的成绩</small></div>
      </div>
      <section className="panel results-panel">
        <div className="panel-title"><div><h2>成绩记录</h2><p>教师发布后，成绩会显示在这里。</p></div><span className="status-pill status-green">个人数据</span></div>
        {loading ? <div className="empty-state">正在加载成绩…</div> : errorText ? <div className="notice error">{errorText}</div> : records.length === 0 ? <div className="empty-state"><div className="empty-icon">分</div><strong>暂时没有已发布成绩</strong><span>请等待任课教师发布成绩，发布后可在此查询。</span></div> : (
          <div className="table-wrap"><table><thead><tr><th>班级</th><th>考试 / 测验</th><th>考试日期</th><th className="align-right">成绩</th></tr></thead><tbody>{records.map((item) => <tr key={item.id}><td>{item.className}</td><td><strong>{item.name}</strong></td><td>{item.date || "—"}</td><td className="align-right score-value">{item.score}{item.max ? <small> / {item.max}</small> : null}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </div>
  );
}

function ClassWorkspace({ classroom, profile, onBack, onNotice }: { classroom: Classroom; profile: Profile; onBack: () => void; onNotice: (notice: Notice) => void }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activationRows, setActivationRows] = useState<Array<{ student_no: string; full_name: string; activation_code: string; expires_at: string }>>([]);
  const [resetStudent, setResetStudent] = useState("");
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadClass() {
    setLoading(true);
    try {
      const sb = getSupabase();
      const [studentResult, assessmentResult] = await Promise.all([
        sb.from("students").select("id,class_id,student_no,full_name,profile_id").eq("class_id", classroom.id).order("student_no"),
        sb.from("assessments").select("id,class_id,name,category,exam_date,max_score,is_published").eq("class_id", classroom.id).order("created_at", { ascending: false }),
      ]);
      if (studentResult.error) throw studentResult.error;
      if (assessmentResult.error) throw assessmentResult.error;
      setStudents((studentResult.data ?? []) as Student[]);
      setAssessments((assessmentResult.data ?? []) as Assessment[]);
    } catch (error) {
      onNotice({ kind: "error", text: showError(error) });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadClass(); }, [classroom.id]);

  async function importStudents(file: File) {
    setBusy(true);
    setActivationRows([]);
    try {
      const { headers, rows } = await readWorkbook(file);
      const noIndex = headerIndex(headers, ["学号", "studentno", "studentid", "学号（必填）"]);
      const nameIndex = headerIndex(headers, ["姓名", "name", "studentname"]);
      if (noIndex < 0 || nameIndex < 0) throw new Error("学生名单必须包含“学号”和“姓名”两列。");
      const parsed = rows.map((row) => ({
        student_no: (row[noIndex] ?? "").trim().toUpperCase(),
        full_name: (row[nameIndex] ?? "").trim(),
      })).filter((row) => row.student_no && row.full_name);
      if (!parsed.length) throw new Error("没有找到有效学生记录。");
      const uniqueNos = new Set(parsed.map((row) => row.student_no));
      if (uniqueNos.size !== parsed.length) throw new Error("学生名单中存在重复学号，请先在 Excel 中去重后再导入。");
      const result = await adminAction<{ imported: number; activation: typeof activationRows }>("import_students", {
        class_id: classroom.id, students: parsed,
      });
      setActivationRows(result.activation ?? []);
      onNotice({ kind: "success", text: "已导入 " + result.imported + " 条学生记录。" + (result.activation?.length ? " 新账号激活码请立即导出并安全发给学生。" : " 已激活学生的密码没有改变。") });
      await loadClass();
    } catch (error) {
      onNotice({ kind: "error", text: showError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function importScores(file: File) {
    setBusy(true);
    try {
      if (!students.length) throw new Error("请先导入学生名单。");
      const { headers, rows } = await readWorkbook(file);
      const noIndex = headerIndex(headers, ["学号", "studentno", "studentid", "学号（必填）"]);
      const nameIndex = headerIndex(headers, ["姓名", "name", "studentname"]);
      if (noIndex < 0 || nameIndex < 0) throw new Error("成绩表必须包含“学号”和“姓名”两列。");
      const scoreColumns = headers.map((_, index) => index).filter((index) => index !== noIndex && index !== nameIndex && headers[index].trim());
      if (!scoreColumns.length) throw new Error("成绩表至少需要一个成绩列，例如“课堂测试”或“期中考试”。");
      const studentMap = new Map(students.map((item) => [item.student_no.trim().toUpperCase(), item]));
      let inserted = 0;
      let unmatched = 0;
      for (const column of scoreColumns) {
        const assessmentName = headers[column].trim();
        const { data: assessment, error: assessmentError } = await getSupabase().from("assessments")
          .upsert({ class_id: classroom.id, name: assessmentName, category: "成绩" }, { onConflict: "class_id,name" })
          .select("id").single();
        if (assessmentError) throw assessmentError;
        const scoreRows: Array<{ assessment_id: string; student_id: string; score: number }> = [];
        for (const row of rows) {
          const studentNo = (row[noIndex] ?? "").trim().toUpperCase();
          const student = studentMap.get(studentNo);
          const raw = (row[column] ?? "").trim();
          if (!studentNo || !raw) continue;
          if (!student) { unmatched += 1; continue; }
          const value = Number(raw.replaceAll(",", ""));
          if (!Number.isFinite(value) || value < 0) continue;
          scoreRows.push({ assessment_id: assessment.id, student_id: student.id, score: value });
        }
        if (scoreRows.length) {
          const { error } = await getSupabase().from("scores").upsert(scoreRows, { onConflict: "assessment_id,student_id" });
          if (error) throw error;
          inserted += scoreRows.length;
        }
      }
      onNotice({ kind: "success", text: "成绩导入完成，共写入/更新 " + inserted + " 条分数。" + (unmatched ? " 有 " + unmatched + " 条记录因学号不在本班而跳过。" : "") + " 所有新考试默认未发布。" });
      await loadClass();
    } catch (error) {
      onNotice({ kind: "error", text: showError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function togglePublish(assessment: Assessment) {
    setBusy(true);
    try {
      await adminAction("publish_assessment", { assessment_id: assessment.id, is_published: !assessment.is_published });
      onNotice({ kind: "success", text: assessment.name + (assessment.is_published ? " 已撤回发布。" : " 已发布，学生现在可以查询。") });
      await loadClass();
    } catch (error) {
      onNotice({ kind: "error", text: showError(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dashboard-wrap">
      <div className="workspace-heading">
        <button className="back-button" onClick={onBack}>‹ 返回班级列表</button>
        <div className="page-heading"><div><div className="eyebrow">CLASS MANAGEMENT</div><h1>{classroom.name}</h1><p>{classroom.term || "未设置学期"} · 名单、成绩与发布管理</p></div><div className="heading-stat"><strong>{students.length}</strong><span>名学生</span></div></div>
      </div>
      <div className="import-grid">
        <section className="panel import-panel">
          <div className="panel-title"><div><h2>导入学生名单</h2><p>Excel 表格需包含学号、姓名两列。</p></div><span className="panel-icon">名</span></div>
          <label className="upload-zone"><span className="upload-symbol">↑</span><strong>选择学生名单 Excel</strong><small>仅支持 .xlsx，最大 10 MB；旧版 .xls 请先另存为 .xlsx</small><input type="file" accept=".xlsx" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importStudents(file); event.currentTarget.value = ""; }} /></label>
        </section>
        <section className="panel import-panel">
          <div className="panel-title"><div><h2>导入考试成绩</h2><p>学号、姓名之外的每一列作为一项考试。</p></div><span className="panel-icon">分</span></div>
          <label className="upload-zone"><span className="upload-symbol">↑</span><strong>选择成绩 Excel</strong><small>例如课堂测试、阶段考试、期中考试</small><input type="file" accept=".xlsx" disabled={busy || !students.length} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importScores(file); event.currentTarget.value = ""; }} /></label>
        </section>
      </div>

      {activationRows.length > 0 && (
        <section className="panel activation-panel">
          <div className="panel-title"><div><h2>学生账号激活码</h2><p>只显示本次新生成的激活码。请立即导出并单独发给学生，7天后过期。</p></div><button className="button button-primary button-small" onClick={() => downloadCsv("学生账号激活码.csv", [["学号", "姓名", "一次性激活码", "有效期至"], ...activationRows.map((row) => [row.student_no, row.full_name, row.activation_code, new Date(row.expires_at).toLocaleString("zh-CN")])])}>导出激活码 CSV</button></div>
          <div className="table-wrap"><table><thead><tr><th>学号</th><th>姓名</th><th>一次性激活码</th><th>有效期至</th></tr></thead><tbody>{activationRows.map((row) => <tr key={row.student_no}><td>{row.student_no}</td><td>{row.full_name}</td><td className="mono">{row.activation_code}</td><td>{new Date(row.expires_at).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>
        </section>
      )}

      <section className="panel roster-panel">
        <div className="panel-title"><div><h2>班级学生</h2><p>共 {students.length} 人。学生激活后可在此重置密码。</p></div><button className="button button-light button-small" onClick={() => void loadClass()}>刷新</button></div>
        {loading ? <div className="empty-state">正在加载班级数据…</div> : students.length === 0 ? <div className="empty-state">尚未导入学生，请先上传名单 Excel。</div> : (
          <div className="table-wrap"><table><thead><tr><th>学号</th><th>姓名</th><th>账号状态</th><th>密码管理</th></tr></thead><tbody>{students.map((student) => <tr key={student.id}><td>{student.student_no}</td><td><strong>{student.full_name}</strong></td><td><span className={student.profile_id ? "status-pill status-green" : "status-pill"}>{student.profile_id ? "已激活" : "待激活"}</span></td><td>{student.profile_id ? resetStudent === student.id ? <div className="reset-inline"><input type="password" value={resetPasswordValue} minLength={10} onChange={(e) => setResetPasswordValue(e.target.value)} placeholder="至少10位临时密码" /><button className="button button-primary button-small" disabled={busy} onClick={() => void resetPasswordForStudent(student)}>确认</button><button className="text-button" onClick={() => setResetStudent("")}>取消</button></div> : <button className="text-button" onClick={() => setResetStudent(student.id)}>重置密码</button> : <span className="muted">等待学生激活</span>}</td></tr>)}</tbody></table></div>
        )}
      </section>
      <section className="panel assessments-panel">
        <div className="panel-title"><div><h2>考试与成绩发布</h2><p>新导入成绩默认为未发布，确认核对后再发布。</p></div><span className="status-pill">{assessments.length} 项</span></div>
        {assessments.length === 0 ? <div className="empty-state">尚无考试记录。导入成绩表后会自动创建考试项目。</div> : <div className="assessment-list">{assessments.map((assessment) => <div className="assessment-row" key={assessment.id}><div className="assessment-icon">测</div><div className="assessment-copy"><strong>{assessment.name}</strong><small>{assessment.category || "成绩项目"} · {assessment.exam_date || "未设置日期"}</small></div><span className={assessment.is_published ? "status-pill status-green" : "status-pill"}>{assessment.is_published ? "已发布" : "未发布"}</span><button className={"button button-small " + (assessment.is_published ? "button-light" : "button-primary")} disabled={busy} onClick={() => void togglePublish(assessment)}>{assessment.is_published ? "撤回发布" : "发布成绩"}</button></div>)}</div>}
      </section>
    </div>
  );

  async function resetPasswordForStudent(student: Student) {
    if (resetPasswordValue.length < 10) {
      onNotice({ kind: "error", text: "临时密码至少需要10位。" });
      return;
    }
    setBusy(true);
    try {
      await adminAction("reset_student_password", { student_id: student.id, password: resetPasswordValue });
      onNotice({ kind: "success", text: student.full_name + " 的密码已重置。请安全地将临时密码交给学生。" });
      setResetStudent(""); setResetPasswordValue("");
    } catch (error) {
      onNotice({ kind: "error", text: showError(error) });
    } finally {
      setBusy(false);
    }
  }
}

function ChangePassword({ onComplete, onNotice }: { onComplete: () => void; onNotice: (notice: Notice) => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 10 || password !== confirm) {
      onNotice({ kind: "error", text: password.length < 10 ? "密码至少10位。" : "两次密码输入不一致。" });
      return;
    }
    setBusy(true);
    try {
      await adminAction("change_password", { password });
      onNotice({ kind: "success", text: "密码修改成功。" });
      onComplete();
    } catch (error) {
      onNotice({ kind: "error", text: showError(error) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="center-stage"><section className="panel change-password-panel"><div className="eyebrow">SECURITY UPDATE</div><h1>请先修改初始密码</h1><p>管理员或教师重置密码后，首次登录需要设置新的个人密码。</p><form className="form-stack" onSubmit={submit}><label>新密码<input type="password" minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="至少10位" /></label><label>确认新密码<input type="password" minLength={10} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required placeholder="再次输入新密码" /></label><button className="button button-primary button-full" disabled={busy}>{busy ? "正在更新…" : "更新密码并继续"}</button></form></section></div>
  );
}

export default function ScoreApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [selectedClass, setSelectedClass] = useState<Classroom | null>(null);
  const [configError, setConfigError] = useState("");

  useEffect(() => {
    let client;
    try {
      client = getSupabase();
    } catch (error) {
      setConfigError(showError(error));
      setAuthReady(true);
      return;
    }
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSelectedClass(null);
    });
    client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    }).catch((error) => {
      setConfigError(showError(error));
      setAuthReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      if (!session) {
        setProfile(null);
        setProfileReady(true);
        return;
      }
      setProfileReady(false);
      try {
        const { data, error } = await getSupabase().from("profiles")
          .select("id,role,full_name,student_no,must_change_password").eq("id", session.user.id).single();
        if (error) throw error;
        if (!cancelled) {
          setProfile(data as Profile);
          setProfileReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          setNotice({ kind: "error", text: "无法读取账号资料：" + showError(error) });
          await getSupabase().auth.signOut();
          setProfileReady(true);
        }
      }
    }
    void loadProfile();
    return () => { cancelled = true; };
  }, [session]);

  async function logout() {
    await getSupabase().auth.signOut();
    setSelectedClass(null);
  }

  if (!authReady || (session && !profileReady)) {
    return <div className="loading-screen"><div className="loading-mark">分</div><span>正在连接成绩平台…</span></div>;
  }

  if (!session || !profile) {
    return (
      <div className="app-background">
        <div className="public-header"><div className="brand"><div className="brand-mark">分</div><div><strong>校园成绩平台</strong><span>Academic Score Portal</span></div></div><span className="public-label">SECURE ACCESS</span></div>
        {configError ? <div className="config-error"><strong>尚未配置 Supabase</strong><p>{configError}</p><span>请在本地 .env.local 或 Vercel 环境变量中填写项目 URL 和 Publishable Key。</span></div> : <LoginPanel onNotice={setNotice} />}
        <div className="notice-holder"><NoticeBar notice={notice} onClose={() => setNotice(null)} /></div>
        <footer className="site-footer">校园成绩查询平台 · 安全、准确、可追溯</footer>
      </div>
    );
  }

  if (profile.must_change_password) {
    return (
      <div className="app-background"><AppHeader profile={profile} onLogout={logout} /><NoticeBar notice={notice} onClose={() => setNotice(null)} /><ChangePassword onComplete={() => setProfile({ ...profile, must_change_password: false })} onNotice={setNotice} /><footer className="site-footer">校园成绩查询平台 · 个人账号安全</footer></div>
    );
  }

  return (
    <div className="app-background">
      <AppHeader profile={profile} onLogout={logout} />
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      {selectedClass && profile.role !== "student" ? (
        <ClassWorkspace classroom={selectedClass} profile={profile} onBack={() => setSelectedClass(null)} onNotice={setNotice} />
      ) : profile.role === "admin" ? (
        <AdminDashboard onNotice={setNotice} />
      ) : profile.role === "teacher" ? (
        <TeacherDashboard profile={profile} onOpenClass={setSelectedClass} onNotice={setNotice} />
      ) : (
        <StudentDashboard profile={profile} />
      )}
      <footer className="site-footer">校园成绩查询平台 · 个人成绩仅授权范围内可见</footer>
    </div>
  );
}

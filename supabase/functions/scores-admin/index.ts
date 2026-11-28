import { withSupabase } from "npm:@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
function randomCode(bytes = 18) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function sha256(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 10 && value.length <= 128;
}
async function studentEmail(studentNo: string) {
  const hash = await sha256(studentNo.trim().toUpperCase());
  return "student-" + hash.slice(0, 40) + "@students.scores.invalid";
}
Deno.serve(withSupabase({ auth: "user" }, async (req: Request, ctx) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = ctx.supabaseAdmin;
    const userId = ctx.userClaims?.id;
    if (!userId) return json({ error: "请先登录" }, 401);
    const { data: profile, error: profileError } = await admin
      .from("profiles").select("id, role, full_name").eq("id", userId).single();
    if (profileError || !profile) return json({ error: "账号资料不存在" }, 403);
    const user = { id: userId };
    const body = await req.json();
    const action = body?.action;

    if (action === "create_teacher") {
      if (profile.role !== "admin") return json({ error: "仅超级管理员可以创建教师账号" }, 403);
      const email = String(body.email ?? "").trim().toLowerCase();
      const fullName = String(body.full_name ?? "").trim();
      const password = body.password;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || fullName.length > 100 || email.endsWith("@students.scores.invalid") || !validPassword(password)) {
        return json({ error: "请提供有效邮箱、教师姓名和至少10位初始密码" }, 400);
      }
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (createError || !created.user) return json({ error: createError?.message ?? "创建认证账号失败" }, 400);
      const { error: insertError } = await admin.from("profiles").insert({
        id: created.user.id, role: "teacher", full_name: fullName, must_change_password: true,
      });
      if (insertError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: "创建教师资料失败：" + insertError.message }, 400);
      }
      return json({ ok: true, teacher: { id: created.user.id, email, full_name: fullName } });
    }

    if (action === "list_teachers") {
      if (profile.role !== "admin") return json({ error: "无权查看教师列表" }, 403);
      const { data, error } = await admin.from("profiles")
        .select("id, full_name, created_at").eq("role", "teacher").order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 400);
      return json({ teachers: data ?? [] });
    }

    if (action === "import_students") {
      if (!["admin", "teacher"].includes(profile.role)) return json({ error: "无权导入学生" }, 403);
      const classId = String(body.class_id ?? "");
      const rows = body.students;
      if (!classId || !Array.isArray(rows) || rows.length < 1 || rows.length > 500) {
        return json({ error: "班级或学生数据格式不正确（单次最多500人）" }, 400);
      }
      const { data: classroom, error: classroomError } = await admin.from("classes").select("id, teacher_id").eq("id", classId).single();
      if (classroomError || !classroom) return json({ error: "班级不存在" }, 404);
      if (profile.role !== "admin" && classroom.teacher_id !== user.id) return json({ error: "不能管理其他教师的班级" }, 403);

      const normalized = rows.map((row) => {
        const rawPassword = typeof row?.initial_password === "string" ? row.initial_password : String(row?.initial_password ?? "");
        return { studentNo: String(row?.student_no ?? "").trim().toUpperCase(),
          fullName: String(row?.full_name ?? "").trim(),
          initialPassword: rawPassword.trim() ? rawPassword : "" };
      });
      const ids = new Set<string>();
      for (const row of normalized) {
        if (!row.studentNo || !row.fullName || row.studentNo.length > 64 || row.fullName.length > 100 || ids.has(row.studentNo)) {
          return json({ error: "名单存在空白、超长字段或重复学号" }, 400);
        }
        ids.add(row.studentNo);
      }

      // Validate every row before creating accounts; retain a per-row report for external Auth failures.
      const activation: Array<{ student_no: string; full_name: string; activation_code: string; expires_at: string }> = [];
      const failed: Array<{ student_no: string; error: string }> = [];
      const prepared: Array<{ studentNo: string; fullName: string; initialPassword: string; profileId: string | null }> = [];
      const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
      for (const row of normalized) {
        const { studentNo, fullName, initialPassword } = row;
        const { data: existing, error: lookupError } = await admin.from("profiles")
          .select("id,role,full_name").eq("student_no",studentNo).maybeSingle();
        if (lookupError) return json({ error: "无法核对学生账号，请重试" }, 500);
        const { data: enrollments, error: enrollmentError } = await admin.from("students")
          .select("full_name").eq("student_no",studentNo);
        if (enrollmentError) return json({ error: "无法核对学生名单，请重试" }, 500);
        if ((existing && (existing.role !== "student" || !sameName(existing.full_name,fullName))) ||
            (enrollments ?? []).some((entry) => !sameName(entry.full_name,fullName))) {
          failed.push({ student_no: studentNo, error: "学号与已有姓名不一致，请核对" });
          continue;
        }
        if (!existing && initialPassword && !validPassword(initialPassword)) {
          failed.push({ student_no: studentNo, error: "初始密码需要10至128位" });
          continue;
        }
        prepared.push({ ...row, profileId: existing?.id ?? null });
      }

      let imported = 0;
      let passwordAccounts = 0;
      for (const row of prepared) {
        const { studentNo, fullName, initialPassword } = row;
        let profileId = row.profileId;
        try {
          // Recheck before creation because another class may have just activated this account.
          if (!profileId) {
            const { data: current, error: lookupError } = await admin.from("profiles")
              .select("id,role,full_name").eq("student_no",studentNo).maybeSingle();
            if (lookupError) throw new Error("无法核对学生账号");
            if (current) {
              if (current.role !== "student" || !sameName(current.full_name,fullName)) throw new Error("学号与已有姓名不一致");
              profileId = current.id;
            }
          }
          let newAccount = false;
          if (!profileId && initialPassword) {
            const email = await studentEmail(studentNo);
            const { data: created, error: createError } = await admin.auth.admin.createUser({
              email, password: initialPassword, email_confirm: true,
            });
            if (createError || !created.user) throw new Error("账号创建失败，请检查密码或稍后重试");
            const { error: profileError } = await admin.from("profiles").insert({
              id: created.user.id, role: "student", full_name: fullName, student_no: studentNo, must_change_password: false,
            });
            if (profileError) {
              await admin.auth.admin.deleteUser(created.user.id);
              throw new Error("学生账号资料创建失败");
            }
            profileId = created.user.id;
            newAccount = true;
          }
          const { error: upsertError } = await admin.from("students").upsert({
            class_id: classId, student_no: studentNo, full_name: fullName, profile_id: profileId,
          }, { onConflict: "class_id,student_no" });
          if (upsertError) throw new Error("班级名单保存失败，可重新导入此行");

          if (profileId) {
            // Link any previously imported, matching enrollment in another class.
            const { error: linkError } = await admin.from("students").update({ profile_id: profileId })
              .eq("student_no",studentNo).eq("full_name",fullName).is("profile_id",null);
            if (linkError) throw new Error("关联学生的其他班级记录失败，可重新导入");
            const { error: consumeError } = await admin.from("student_invites")
              .update({ consumed_at: new Date().toISOString() }).eq("student_no",studentNo).is("consumed_at",null);
            if (consumeError) throw new Error("账号已建立，但旧激活码清理失败，可重新导入");
            if (newAccount) passwordAccounts += 1;
          } else {
            const activationCode = randomCode();
            const codeHash = await sha256(activationCode);
            const expiresAt = new Date(Date.now()+7*24*60*60*1000).toISOString();
            const { data: invite, error: inviteError } = await admin.from("student_invites").insert({
              student_no: studentNo, full_name: fullName, class_id: classId,
              code_hash: codeHash, expires_at: expiresAt, created_by: user.id,
            }).select("id").single();
            if (inviteError || !invite) throw new Error("生成激活码失败，可重新导入此行");
            // Issue the new code before invalidating the old one.
            const { error: removeError } = await admin.from("student_invites").delete()
              .eq("class_id",classId).eq("student_no",studentNo).is("consumed_at",null).neq("id",invite.id);
            activation.push({ student_no: studentNo, full_name: fullName, activation_code: activationCode, expires_at: expiresAt });
            if (removeError) throw new Error("新激活码已生成，但旧激活码未能清理");
          }
          imported += 1;
        } catch (error) {
          failed.push({ student_no: studentNo, error: error instanceof Error ? error.message : "导入失败" });
        }
      }
      return json({ ok: true, imported, password_accounts: passwordAccounts, activation, failed });
    }

    if (action === "reset_student_password") {
      if (!["admin", "teacher"].includes(profile.role)) return json({ error: "无权重置学生密码" }, 403);
      const studentId = String(body.student_id ?? "");
      const password = body.password;
      if (!studentId || !validPassword(password)) return json({ error: "新密码至少10位" }, 400);
      const { data: student } = await admin.from("students").select("id, class_id, profile_id").eq("id", studentId).single();
      if (!student) return json({ error: "学生记录不存在" }, 404);
      const { data: classroom } = await admin.from("classes").select("teacher_id").eq("id", student.class_id).single();
      if (profile.role !== "admin" && classroom?.teacher_id !== user.id) return json({ error: "不能重置其他教师班级的学生密码" }, 403);
      if (!student.profile_id) return json({ error: "该学生尚未激活账号，请重新生成激活码" }, 409);
      const { error: authError } = await admin.auth.admin.updateUserById(student.profile_id, { password });
      if (authError) return json({ error: authError.message }, 400);
      const { error: profileError } = await admin.from("profiles").update({ must_change_password: false }).eq("id", student.profile_id);
      if (profileError) return json({ error: profileError.message }, 400);
      return json({ ok: true });
    }

    if (action === "change_password") {
      const password = body.password;
      if (!validPassword(password)) return json({ error: "新密码至少10位，最多128位" }, 400);
      const { error: authError } = await admin.auth.admin.updateUserById(user.id, { password });
      if (authError) return json({ error: authError.message }, 400);
      const { error: profileError } = await admin.from("profiles").update({ must_change_password: false }).eq("id", user.id);
      if (profileError) return json({ error: profileError.message }, 400);
      return json({ ok: true });
    }

    if (action === "publish_assessment") {
      if (!["admin", "teacher"].includes(profile.role)) return json({ error: "无权发布成绩" }, 403);
      const assessmentId = String(body.assessment_id ?? "");
      if (typeof body.is_published !== "boolean") return json({ error: "发布状态无效" }, 400);
      const publish = body.is_published;
      const { data: assessment } = await admin.from("assessments").select("id, class_id").eq("id", assessmentId).single();
      if (!assessment) return json({ error: "考试记录不存在" }, 404);
      const { data: classroom } = await admin.from("classes").select("teacher_id").eq("id", assessment.class_id).single();
      if (profile.role !== "admin" && classroom?.teacher_id !== user.id) return json({ error: "不能发布其他教师班级的成绩" }, 403);
      const { error } = await admin.from("assessments").update({ is_published: publish }).eq("id", assessmentId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, is_published: publish });
    }
    return json({ error: "未知操作" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "服务器内部错误" }, 500);
  }
}));

import { withSupabase } from "npm:@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
Deno.serve(withSupabase({ auth: "user" }, async (req: Request, ctx) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const admin = ctx.supabaseAdmin;
    const userId = ctx.userClaims?.sub;
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
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || !validPassword(password)) {
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
      const { data: classroom } = await admin.from("classes").select("id, teacher_id").eq("id", classId).single();
      if (!classroom) return json({ error: "班级不存在" }, 404);
      if (profile.role !== "admin" && classroom.teacher_id !== user.id) return json({ error: "不能管理其他教师的班级" }, 403);

      const activation: Array<{ student_no: string; full_name: string; activation_code: string; expires_at: string }> = [];
      for (const row of rows) {
        const studentNo = String(row.student_no ?? "").trim().toUpperCase();
        const fullName = String(row.full_name ?? "").trim();
        if (!studentNo || !fullName || studentNo.length > 64 || fullName.length > 100) {
          return json({ error: "学生学号或姓名为空，或长度超限" }, 400);
        }
        const { data: existingProfile, error: existingError } = await admin.from("profiles")
          .select("id, role").eq("student_no", studentNo).maybeSingle();
        if (existingError) return json({ error: existingError.message }, 400);
        if (existingProfile && existingProfile.role !== "student") return json({ error: "学号 " + studentNo + " 已被非学生账号使用" }, 409);

        const { error: upsertError } = await admin.from("students").upsert({
          class_id: classId, student_no: studentNo, full_name: fullName, profile_id: existingProfile?.id ?? null,
        }, { onConflict: "class_id,student_no" });
        if (upsertError) return json({ error: "导入 " + studentNo + " 失败：" + upsertError.message }, 400);

        if (!existingProfile) {
          const activationCode = randomCode();
          const codeHash = await sha256(activationCode);
          const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          const { error: removeError } = await admin.from("student_invites")
            .delete().eq("class_id", classId).eq("student_no", studentNo).is("consumed_at", null);
          if (removeError) return json({ error: removeError.message }, 400);
          const { error: inviteError } = await admin.from("student_invites").insert({
            student_no: studentNo, full_name: fullName, class_id: classId,
            code_hash: codeHash, expires_at: expiresAt, created_by: user.id,
          });
          if (inviteError) return json({ error: "为 " + studentNo + " 生成激活码失败：" + inviteError.message }, 400);
          activation.push({ student_no: studentNo, full_name: fullName, activation_code: activationCode, expires_at: expiresAt });
        }
      }
      return json({ ok: true, imported: rows.length, activation });
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
      const { error: profileError } = await admin.from("profiles").update({ must_change_password: true }).eq("id", student.profile_id);
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
      const publish = Boolean(body.is_published);
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
    return json({ error: error instanceof Error ? error.message : "服务器内部错误" }, 401);
  }
}));

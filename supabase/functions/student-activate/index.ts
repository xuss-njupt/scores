import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase server environment");
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function sha256(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function studentEmail(studentNo: string) {
  const hash = await sha256(studentNo.trim().toUpperCase());
  return "student-" + hash.slice(0, 40) + "@students.scores.invalid";
}
function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 10 && value.length <= 128;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const studentNo = String(body.student_no ?? "").trim().toUpperCase();
    const fullName = String(body.full_name ?? "").trim();
    const code = String(body.activation_code ?? "").trim();
    const password = body.password;
    if (!studentNo || !fullName || !code || !validPassword(password)) {
      return json({ error: "请填写学号、姓名、激活码和至少10位新密码" }, 400);
    }
    const codeHash = await sha256(code);
    const { data: invite, error: inviteError } = await admin.from("student_invites")
      .select("id, student_no, full_name, expires_at, consumed_at")
      .eq("student_no", studentNo).eq("code_hash", codeHash)
      .is("consumed_at", null).gt("expires_at", new Date().toISOString())
      .limit(1).maybeSingle();
    if (inviteError || !invite) return json({ error: "激活信息无效或已过期，请联系任课教师重新生成激活码" }, 400);
    if (invite.full_name.trim().toLocaleLowerCase() !== fullName.toLocaleLowerCase()) return json({ error: "学号与姓名不匹配" }, 400);
    const { data: existing } = await admin.from("profiles").select("id").eq("student_no", studentNo).maybeSingle();
    if (existing) return json({ error: "该学生账号已经激活，请直接登录或联系教师重置密码" }, 409);

    const email = await studentEmail(studentNo);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createError || !created.user) return json({ error: createError?.message ?? "创建账号失败" }, 400);
    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id, role: "student", full_name: invite.full_name,
      student_no: studentNo, must_change_password: false,
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: profileError.message }, 400);
    }
    const { error: enrollmentError } = await admin.from("students")
      .update({ profile_id: created.user.id, full_name: invite.full_name }).eq("student_no", studentNo);
    if (enrollmentError) {
      await admin.from("profiles").delete().eq("id", created.user.id);
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: enrollmentError.message }, 400);
    }
    const { error: consumeError } = await admin.from("student_invites")
      .update({ consumed_at: new Date().toISOString() }).eq("student_no", studentNo).is("consumed_at", null);
    if (consumeError) return json({ error: consumeError.message }, 400);
    return json({ ok: true, message: "账号激活成功，请使用学号和刚设置的密码登录" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "服务器内部错误" }, 400);
  }
});

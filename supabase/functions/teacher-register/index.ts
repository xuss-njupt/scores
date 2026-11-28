import { withSupabase } from "npm:@supabase/server";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const failure = (status = 400) => json({ error: "注册未能完成，请核对工号是否已注册及密码是否符合要求。" }, status);

Deno.serve(withSupabase({ auth: "none" }, async (req: Request, ctx) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const fullName = String(body.full_name ?? "").trim();
    const employeeNo = String(body.employee_no ?? "").trim();
    const password = body.password;
    if (!fullName || fullName.length > 100 || !/^20[0-9]{6}$/.test(employeeNo)
        || typeof password !== "string" || password.length < 10 || password.length > 128) return failure();

    const admin = ctx.supabaseAdmin;
    const { data: existing, error: lookupError } = await admin.from("profiles")
      .select("id").eq("employee_no", employeeNo).maybeSingle();
    if (lookupError) return failure(503);
    if (existing) return failure(409);

    // Supabase Auth still uses an internal email identifier; users only enter their employee number.
    const email = "teacher-" + employeeNo + "@teachers.scores.invalid";
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { signup_type: "teacher", full_name: fullName, employee_no: employeeNo },
    });
    if (createError || !created.user) return failure(409);

    // Do not rely on an auth.users trigger: GoTrue may update app_metadata after INSERT.
    const { data: profile, error: profileLookupError } = await admin.from("profiles")
      .select("id,role,employee_no").eq("id", created.user.id).maybeSingle();
    if (profileLookupError) {
      await admin.auth.admin.deleteUser(created.user.id);
      return failure(503);
    }
    if (profile) {
      if (profile.role !== "teacher" || profile.employee_no !== employeeNo) {
        await admin.auth.admin.deleteUser(created.user.id);
        return failure(409);
      }
    } else {
      const { error: insertError } = await admin.from("profiles").insert({
        id: created.user.id, role: "teacher", full_name: fullName,
        employee_no: employeeNo, must_change_password: false,
      });
      if (insertError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return failure(409);
      }
    }
    return json({ ok: true });
  } catch (error) {
    console.error("teacher-register failed", error);
    return failure(500);
  }
}));

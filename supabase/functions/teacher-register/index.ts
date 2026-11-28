import { withSupabase } from "npm:@supabase/server";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const failure = () => json({ error: "注册未能完成，请核对填写信息或联系管理员。" }, 400);

Deno.serve(withSupabase({ auth: "none" }, async (req: Request, ctx) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const fullName = String(body.full_name ?? "").trim();
    const employeeNo = String(body.employee_no ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = body.password;
    if (!fullName || fullName.length > 100 || !/^20[0-9]{6}$/.test(employeeNo)
        || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        || email.endsWith("@students.scores.invalid")
        || typeof password !== "string" || password.length < 10 || password.length > 128) return failure();
    const admin = ctx.supabaseAdmin;
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { signup_type: "teacher", full_name: fullName, employee_no: employeeNo },
    });
    if (error || !data.user) return failure();
    // The database trigger creates the profile in the same transaction as the Auth user.
    return json({ ok: true });
  } catch {
    return failure();
  }
}));

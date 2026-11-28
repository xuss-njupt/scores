import { withSupabase } from "npm:@supabase/server";
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const invalid = () => json({ error: "登录失败，请核对工号和密码。" }, 401);
const unavailable = () => json({ error: "暂时无法登录，请稍后重试。" }, 503);

Deno.serve(withSupabase({ auth: "none" }, async (req: Request, ctx) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const employeeNo = String(body.employee_no ?? "").trim();
    const password = body.password;
    if (!/^20[0-9]{6}$/.test(employeeNo) || typeof password !== "string" || !password || password.length > 128) return invalid();
    const admin = ctx.supabaseAdmin;
    const { data: profile, error: lookupError } = await admin.from("profiles")
      .select("id").eq("role", "teacher").eq("employee_no", employeeNo).maybeSingle();
    if (lookupError) return unavailable();
    if (!profile) return invalid();
    const { data: account, error: accountError } = await admin.auth.admin.getUserById(profile.id);
    if (accountError) return unavailable();
    if (!account.user?.email) return invalid();

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_ANON_KEY") || req.headers.get("apikey");
    if (!url || !key) return unavailable();

    // Older teacher accounts signed up with a real email. Confirm them without
    // sending a verification message; keep their original Auth user and password.
    if (!account.user.email_confirmed_at) {
      const { error } = await admin.auth.admin.updateUserById(profile.id, { email_confirm: true });
      if (error) return unavailable();
    }
    // Use a separate unprivileged Auth client; never sign in on the service client.
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email: account.user.email, password });
    if (error || !data.session || data.user?.id !== profile.id) return invalid();
    return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  } catch {
    return unavailable();
  }
}));

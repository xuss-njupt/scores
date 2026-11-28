import { withSupabase } from "npm:@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const invalid = (message: string, status = 400) => json({ error: message }, status);

Deno.serve(withSupabase({ auth: "none" }, async (req: Request, ctx) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return invalid("Method not allowed", 405);

  const admin = ctx.supabaseAdmin;
  try {
    const body = await req.json();
    const action = String(body.action ?? "register");

    // The setup page can check whether the single administrator slot is still open.
    if (action === "status") {
      const [{ data: state, error: stateError }, { count, error: countError }] = await Promise.all([
        admin.from("admin_bootstrap_state").select("admin_id, claimed_at")
          .eq("singleton", true).maybeSingle(),
        admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
      ]);
      if (stateError || countError || !state) return invalid("暂时无法读取管理员注册状态，请稍后重试。", 503);
      const claimTime = state.claimed_at ? new Date(state.claimed_at).getTime() : 0;
      const claimActive = claimTime > Date.now() - 10 * 60 * 1000;
      return json({ available: !state.admin_id && (count ?? 0) === 0 && !claimActive, registering: claimActive });
    }

    if (action !== "register") return invalid("不支持的操作。", 400);

    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.full_name ?? "").trim();
    const password = body.password;
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        || !fullName || fullName.length > 100
        || typeof password !== "string" || password.length < 12 || password.length > 128) {
      return invalid("请填写有效邮箱、管理员姓名和至少12位密码。", 400);
    }

    // Check the existing administrator before reserving the singleton slot.
    const [{ data: state, error: stateError }, { count, error: countError }] = await Promise.all([
      admin.from("admin_bootstrap_state").select("admin_id, claimed_at")
        .eq("singleton", true).maybeSingle(),
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
    ]);
    if (stateError || countError || !state) return invalid("管理员注册服务暂时不可用。", 503);
    if (state.admin_id || (count ?? 0) > 0) return invalid("超级管理员已经注册，请直接登录。", 409);

    const reservationTime = new Date().toISOString();
    const { data: claimed, error: claimError } = await admin.rpc("claim_admin_registration", {
      p_claimed_at: reservationTime,
    });
    if (claimError) {
      console.error("admin registration claim failed", claimError);
      return invalid("管理员注册服务暂时不可用。", 503);
    }
    if (claimed !== true) return invalid("超级管理员注册正在进行，或已经完成，请稍后刷新页面。", 409);

    let createdUserId: string | null = null;
    try {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (createError || !created.user) {
        throw new Error(createError?.message ?? "创建管理员认证账号失败");
      }
      createdUserId = created.user.id;

      const { error: profileError } = await admin.from("profiles").insert({
        id: createdUserId, role: "admin", full_name: fullName, must_change_password: false,
      });
      if (profileError) throw new Error(profileError.message);

      const { data: finished, error: finishError } = await admin.from("admin_bootstrap_state")
        .update({ admin_id: createdUserId, bootstrap_token_hash: null })
        .eq("singleton", true).eq("claimed_at", reservationTime).is("admin_id", null)
        .select("singleton").maybeSingle();
      if (finishError || !finished) throw new Error(finishError?.message ?? "无法完成管理员注册状态更新");

      return json({ ok: true, message: "超级管理员创建成功，可以使用邮箱和密码登录。" });
    } catch (error) {
      if (createdUserId) {
        await admin.from("profiles").delete().eq("id", createdUserId);
        await admin.auth.admin.deleteUser(createdUserId);
      }
      await admin.from("admin_bootstrap_state").update({ claimed_at: null })
        .eq("singleton", true).eq("claimed_at", reservationTime).is("admin_id", null);
      console.error("admin registration failed", error);
      return invalid(error instanceof Error ? error.message : "管理员注册失败，请稍后重试。", 400);
    }
  } catch (error) {
    console.error("admin-register request failed", error);
    return invalid("管理员注册服务暂时不可用，请稍后重试。", 500);
  }
}));

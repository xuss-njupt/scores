import { withSupabase } from "npm:@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

async function sha256(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}

Deno.serve(withSupabase({ auth: "none" }, async (req: Request, ctx) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const admin = ctx.supabaseAdmin;
  let claimed = false;
  let createdUserId: string | null = null;
  let reservationTime: string | null = null;
  try {
    const body = await req.json();
    const suppliedToken = String(body.bootstrap_token ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const fullName = String(body.full_name ?? "").trim();
    const password = body.password;
    if (!/^[0-9a-f]{64}$/i.test(suppliedToken)) {
      return json({ error: "一次性初始化令牌无效" }, 403);
    }
    const suppliedHash = await sha256(suppliedToken);
    const { data: tokenState, error: tokenStateError } = await admin
      .from("admin_bootstrap_state")
      .select("bootstrap_token_hash, claimed_at, admin_id")
      .eq("singleton", true)
      .maybeSingle();
    if (tokenStateError) return json({ error: "初始化服务暂时不可用" }, 500);
    if (!tokenState || tokenState.admin_id || tokenState.claimed_at ||
        !tokenState.bootstrap_token_hash || suppliedHash !== tokenState.bootstrap_token_hash) {
      return json({ error: "一次性初始化令牌无效或已经使用" }, 403);
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || fullName.length > 100 || !validPassword(password)) {
      return json({ error: "请填写有效邮箱、管理员姓名和至少12位密码" }, 400);
    }

    reservationTime = new Date().toISOString();
    const { data: reservation, error: reserveError } = await admin
      .from("admin_bootstrap_state")
      .update({ claimed_at: reservationTime })
      .eq("singleton", true)
      .is("claimed_at", null)
      .is("admin_id", null)
      .eq("bootstrap_token_hash", suppliedHash)
      .select("singleton")
      .maybeSingle();
    if (reserveError) return json({ error: reserveError.message }, 500);
    if (!reservation) return json({ error: "管理员初始化已经完成，不能再次使用" }, 409);
    claimed = true;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createError || !created.user) throw new Error(createError?.message ?? "创建管理员认证账号失败");
    createdUserId = created.user.id;

    const { error: profileError } = await admin.from("profiles").insert({
      id: createdUserId, role: "admin", full_name: fullName, must_change_password: false,
    });
    if (profileError) throw new Error(profileError.message);

    const { error: finishError } = await admin.from("admin_bootstrap_state")
      .update({ admin_id: createdUserId, bootstrap_token_hash: null })
      .eq("singleton", true).eq("claimed_at", reservationTime);
    if (finishError) throw new Error(finishError.message);

    return json({ ok: true, message: "超级管理员创建成功。请使用刚才设置的邮箱和密码登录。" });
  } catch (error) {
    if (createdUserId) {
      await admin.from("profiles").delete().eq("id", createdUserId);
      await admin.auth.admin.deleteUser(createdUserId);
    }
    if (claimed && reservationTime) {
      await admin.from("admin_bootstrap_state")
        .update({ claimed_at: null, admin_id: null })
        .eq("singleton", true).eq("claimed_at", reservationTime);
    }
    return json({ error: error instanceof Error ? error.message : "管理员初始化失败" }, 400);
  }
}));

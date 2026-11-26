"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

export default function SetupAdminPage() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("系统管理员");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (password.length < 12) {
      setMessage({ ok: false, text: "管理员密码至少需要12位。" });
      return;
    }
    if (password !== confirm) {
      setMessage({ ok: false, text: "两次输入的密码不一致。" });
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await getSupabase().functions.invoke("bootstrap-admin", {
        body: { bootstrap_token: token.trim(), email: email.trim(), full_name: fullName.trim(), password },
      });
      if (error) throw new Error(data?.error || error.message);
      if (data?.error) throw new Error(String(data.error));
      setMessage({ ok: true, text: "超级管理员已创建。请前往登录页，使用刚才设置的邮箱和密码登录。此初始化令牌已经失效。" });
      setToken("");
      setPassword("");
      setConfirm("");
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "初始化失败，请检查输入后重试。" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="setup-page">
      <div className="setup-card">
        <div className="brand">
          <div className="brand-mark">分</div>
          <div><strong>校园成绩平台</strong><span>ONE-TIME ADMIN SETUP</span></div>
        </div>
        <div className="eyebrow setup-eyebrow">FIRST-TIME CONFIGURATION</div>
        <h1>创建超级管理员</h1>
        <p className="setup-intro">此页面仅用于首次初始化。创建成功后，一次性令牌立即失效，后续教师账号由超级管理员在网站后台创建。</p>
        <form className="form-stack" onSubmit={submit}>
          <label>一次性初始化令牌
            <input value={token} onChange={(e) => setToken(e.target.value)} required autoComplete="off" placeholder="粘贴一次性初始化令牌" />
          </label>
          <label>管理员姓名
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={100} />
          </label>
          <label>管理员邮箱
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="admin@school.edu" />
          </label>
          <label>管理员密码
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} autoComplete="new-password" placeholder="至少12位，建议使用密码管理器生成" />
          </label>
          <label>确认管理员密码
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={12} autoComplete="new-password" placeholder="再次输入密码" />
          </label>
          {message && <div className={message.ok ? "notice success" : "notice error"} role="status">{message.text}</div>}
          <button className="button button-primary button-full" disabled={busy}>{busy ? "正在安全初始化…" : "创建超级管理员"}</button>
        </form>
        <p className="setup-warning">请勿将初始化令牌分享给他人。该页面不开放普通用户注册，也不能重复创建管理员。</p>
        <Link href="/" className="setup-back">返回登录页</Link>
      </div>
    </main>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { callFunction } from "@/lib/portal-api";

export default function SetupAdminPage() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("系统管理员");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function checkStatus() {
    setChecking(true);
    try {
      const status = await callFunction<{ available: boolean; registering?: boolean }>("admin-register", { action: "status" });
      setAvailable(status.available);
      if (!status.available) setMessage({ ok: false, text: status.registering ? "管理员账号正在创建，请稍后刷新。" : "超级管理员已经注册，请直接登录。" });
      else setMessage(null);
    } catch (error) {
      setAvailable(false);
      setMessage({ ok: false, text: error instanceof Error ? error.message : "暂时无法读取注册状态。" });
    } finally { setChecking(false); }
  }

  useEffect(() => { void checkStatus(); }, []);

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
      await callFunction("admin-register", { action: "register", email: email.trim(), full_name: fullName.trim(), password });
      setMessage({ ok: true, text: "超级管理员创建成功！现在可以使用邮箱和密码登录。" });
      setAvailable(false);
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
          <div><strong>校园成绩平台</strong><span>FIRST ADMIN REGISTRATION</span></div>
        </div>
        <div className="eyebrow setup-eyebrow">ONE ADMINISTRATOR ACCOUNT</div>
        <h1>创建超级管理员</h1>
        <p className="setup-intro">系统仅允许注册一个超级管理员。注册成功后，此入口自动关闭。</p>
        {checking ? <div className="notice info" role="status">正在检查管理员注册状态…</div> : available ? <form className="form-stack" onSubmit={submit}>
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
          <button className="button button-primary button-full" disabled={busy}>{busy ? "正在创建…" : "注册超级管理员"}</button>
        </form> : <div className="form-stack">{message && <div className={message.ok ? "notice success" : "notice error"} role="status">{message.text}</div>}<button type="button" className="button button-light button-full" onClick={() => void checkStatus()}>重新检查</button></div>}
        <p className="setup-warning">超级管理员账号只能创建一次。创建成功后，其他人不能再通过此页面注册。</p>
        <Link href="/teacher/" className="setup-back">前往登录页面</Link>
      </div>
    </main>
  );
}

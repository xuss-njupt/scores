"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { adminAction, callFunction, messageOf, studentEmail, type Notify } from "@/lib/portal-api";
import { teacherEmail } from "@/lib/teacher-auth";
import { Brand, Icon } from "./ui";

export function AuthPanel({ portal, notify }: { portal: "student" | "teacher"; notify: Notify }) {
  const student = portal === "student";
  const [mode, setMode] = useState<"login" | "register" | "admin">("login");
  const [identity, setIdentity] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  function switchMode() {
    notify(null);
    setMode(mode === "login" ? "register" : "login");
    setIdentity("");
    setPassword("");
    setConfirm("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    notify(null);
    if (mode === "register" && (password.length < 10 || password !== confirm)) {
      notify({ kind: "error", text: password.length < 10 ? "密码至少需要 10 位。" : "两次密码不一致。" });
      return;
    }
    setBusy(true);
    try {
      const account = identity.trim();
      if (mode === "register") {
        if (student) {
          await callFunction("student-activate", {
            student_no: account.toUpperCase(), full_name: name.trim(), activation_code: code.trim(), password,
          });
        } else {
          await callFunction("teacher-register", { full_name: name.trim(), employee_no: account, password });
        }
        setMode("login");
        notify({ kind: "success", text: "账号创建成功。" });
      }

      const email = student
        ? await studentEmail(account)
        : mode === "admin"
          ? account.toLowerCase()
          : teacherEmail(account);
      const { error } = await getSupabase().auth.signInWithPassword({ email, password });
      if (error) throw new Error("登录失败，请核对账号和密码。");
    } catch (error) {
      notify({ kind: "error", text: mode === "register" && !student ? "注册未能完成，请核对填写信息或联系管理员。" : messageOf(error) });
    } finally {
      setBusy(false);
    }
  }

  return <main className={"auth-layout " + (student ? "auth-student" : "auth-teacher")}>
    <section className="auth-banner"><Brand/><div className="auth-banner-main"><span className="hero-icon"><Icon name={student ? "student" : "teacher"} size={46}/></span><h1>{student ? "我的成绩" : "教师工作台"}</h1><div className="auth-chips">{student ? <span><Icon name="book"/>成绩查询</span> : <><span><Icon name="class"/>班级管理</span><span><Icon name="upload"/>成绩导入</span></>}</div></div><Link className="banner-link" href={student ? "/teacher/" : "/student/"}>{student ? "教师 / 管理员入口" : "学生入口"}<Icon name="arrow" size={16}/></Link></section>
    <section className="auth-card">
      <header className="auth-card-heading"><span className="mobile-portal-icon"><Icon name={student ? "student" : "teacher"} size={24}/></span><h2>{mode === "register" ? (student ? "激活学生账号" : "教师注册") : mode === "admin" ? "管理员登录" : student ? "学生登录" : "教师登录"}</h2></header>
      <form className="form-stack" onSubmit={submit}>
        {mode === "register" && <label>姓名<input autoComplete="name" maxLength={100} required value={name} onChange={e => setName(e.target.value)} placeholder="真实姓名"/></label>}
        <label>{student ? "学号" : mode === "admin" ? "管理员邮箱" : "工号"}<input type={mode === "admin" ? "email" : "text"} inputMode={!student && mode !== "admin" ? "numeric" : undefined} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={mode === "admin" ? 254 : 64} required value={identity} onChange={e => setIdentity(e.target.value)} placeholder={student ? "请输入学号" : mode === "admin" ? "请输入管理员邮箱" : "请输入工号"}/></label>
        {mode === "register" && student && <label>激活码<input autoComplete="off" autoCapitalize="none" spellCheck={false} required value={code} onChange={e => setCode(e.target.value)} placeholder="教师发放的激活码"/></label>}
        <label>{mode === "register" ? "设置密码" : "密码"}<span className="password-field"><input type={visible ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 10 : undefined} maxLength={128} required value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "register" ? "至少 10 位" : "请输入密码"}/><button type="button" className="icon-button" aria-label={visible ? "隐藏密码" : "显示密码"} aria-pressed={visible} onClick={() => setVisible(!visible)}><Icon name="eye"/></button></span></label>
        {mode === "register" && <label>确认密码<input type="password" autoComplete="new-password" minLength={10} maxLength={128} required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="再次输入密码"/></label>}
        <button className="button button-primary button-full" disabled={busy}>{busy ? "处理中…" : mode !== "register" ? "登录" : student ? "激活并登录" : "注册并登录"}<Icon name="arrow" size={18}/></button>
      </form>
      <button className="auth-switch" type="button" onClick={switchMode} disabled={busy}>{mode !== "login" ? "返回登录" : student ? "使用激活码开通账号" : "注册教师账号"}</button>
      {!student && mode === "login" && <button type="button" className="auth-switch" disabled={busy} onClick={() => { setMode("admin"); setIdentity(""); setPassword(""); setConfirm(""); notify(null); }}>管理员登录</button>}
      <div className="auth-links"><Link href="/">首页</Link><Link href={student ? "/teacher/" : "/student/"}>{student ? "教师入口" : "学生入口"}</Link></div>
    </section>
  </main>;
}

export function PasswordPanel({ notify, onComplete, onCancel, required = false }: { notify: Notify; onComplete: () => void; onCancel?: () => void; required?: boolean }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 10 || password !== confirm) {
      notify({ kind: "error", text: password.length < 10 ? "密码至少需要 10 位。" : "两次密码不一致。" });
      return;
    }
    setBusy(true);
    try {
      await adminAction("change_password", { password });
      notify({ kind: "success", text: "密码已修改。" });
      onComplete();
    } catch (error) { notify({ kind: "error", text: messageOf(error) }); }
    finally { setBusy(false); }
  }
  return <section className="panel password-panel"><h2>{required ? "设置个人密码" : "修改密码"}</h2><form className="form-stack" onSubmit={submit}>
    <label>新密码<input type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)}/></label>
    <label>确认密码<input type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)}/></label>
    <div className="button-row"><button className="button button-primary" disabled={busy}>{busy ? "保存中…" : "保存密码"}</button>{onCancel && <button type="button" className="button button-light" onClick={onCancel} disabled={busy}>取消</button>}</div>
  </form></section>;
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminAction, messageOf, type Notify } from "@/lib/portal-api";
import { Empty, Icon, Loading, PanelTitle } from "./ui";

type Teacher = { id: string; full_name: string; created_at: string };
export function AdminWorkspace({ notify }: { notify: Notify }) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true);
    try { const result = await adminAction<{ teachers: Teacher[] }>("list_teachers"); setTeachers(result.teachers ?? []); }
    catch (error) { notify({ kind: "error", text: messageOf(error) }); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      await adminAction("create_teacher", { full_name: fullName.trim(), email: email.trim(), password });
      setFullName(""); setEmail(""); setPassword("");
      notify({ kind: "success", text: "教师账号已创建。" }); await load();
    } catch (error) { notify({ kind: "error", text: messageOf(error) }); }
    finally { setBusy(false); }
  }
  return <main className="workspace-main"><div className="workspace-heading"><h1>管理员工作台</h1><span className="count-pill">{teachers.length} 位教师</span></div><div className="workspace-grid"><section className="panel"><PanelTitle icon="plus" title="创建教师账号"/><form className="form-stack" onSubmit={submit}><label>姓名<input required maxLength={100} value={fullName} onChange={e => setFullName(e.target.value)}/></label><label>邮箱<input required type="email" value={email} onChange={e => setEmail(e.target.value)}/></label><label>初始密码<input type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)}/></label><button className="button button-primary" disabled={busy}><Icon name="plus"/>{busy ? "创建中…" : "创建账号"}</button></form></section><section className="panel"><PanelTitle title="教师列表" icon="teacher" action={<button className="button button-light button-small" disabled={loading} onClick={() => void load()}><Icon name="refresh" size={16}/>刷新</button>}/>{loading ? <Loading/> : teachers.length ? <div className="simple-list">{teachers.map(teacher => <div className="simple-row" key={teacher.id}><span className="avatar">{teacher.full_name.slice(0,1)}</span><div><strong>{teacher.full_name}</strong><small>{new Date(teacher.created_at).toLocaleDateString("zh-CN")}</small></div></div>)}</div> : <Empty icon="teacher" title="暂无教师"/>}</section></div></main>;
}

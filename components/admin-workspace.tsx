"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminAction, messageOf, type Notify } from "@/lib/portal-api";
import { Empty, Icon, Loading, PanelTitle } from "./ui";

type Teacher = { id: string; full_name: string; employee_no: string | null; created_at: string };
export function AdminWorkspace({ notify }: { notify: Notify }) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [fullName, setFullName] = useState("");
  const [employeeNo, setEmployeeNo] = useState("");
  const [password, setPassword] = useState("");
  const [resetTeacher, setResetTeacher] = useState<Teacher | null>(null);
  const [resetPassword, setResetPassword] = useState("");
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
      await adminAction("create_teacher", { full_name: fullName.trim(), employee_no: employeeNo.trim(), password });
      setFullName(""); setEmployeeNo(""); setPassword("");
      notify({ kind: "success", text: "教师账号已创建，可使用工号登录。" }); await load();
    } catch (error) { notify({ kind: "error", text: messageOf(error) }); }
    finally { setBusy(false); }
  }
  async function reset(event: FormEvent) {
    event.preventDefault();
    if (!resetTeacher) return;
    setBusy(true);
    try {
      await adminAction("reset_teacher_password", { teacher_id: resetTeacher.id, password: resetPassword });
      notify({ kind: "success", text: "教师密码已重置。" });
      setResetTeacher(null); setResetPassword("");
    } catch (error) { notify({ kind: "error", text: messageOf(error) }); }
    finally { setBusy(false); }
  }
  return <main className="workspace-main">
    <div className="workspace-heading"><h1>管理员工作台</h1><span className="count-pill">{teachers.length} 位教师</span></div>
    <div className="workspace-grid">
      <section className="panel"><PanelTitle icon="plus" title="创建教师账号"/>
        <form className="form-stack" onSubmit={submit}>
          <label>姓名<input required maxLength={100} value={fullName} onChange={e => setFullName(e.target.value)}/></label>
          <label>工号<input required inputMode="numeric" autoComplete="off" value={employeeNo} onChange={e => setEmployeeNo(e.target.value)}/></label>
          <label>初始密码<input type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)}/></label>
          <button className="button button-primary" disabled={busy}><Icon name="plus"/>{busy ? "处理中…" : "创建账号"}</button>
        </form>
      </section>
      <section className="panel">
        <PanelTitle title="教师列表" icon="teacher" action={<button className="button button-light button-small" disabled={loading} onClick={() => void load()}><Icon name="refresh" size={16}/>刷新</button>}/>
        {loading ? <Loading/> : teachers.length ? <div className="simple-list">{teachers.map(teacher => <div className="simple-row" key={teacher.id}><span className="avatar">{teacher.full_name.slice(0,1)}</span><div style={{flex:1,minWidth:0}}><strong>{teacher.full_name}</strong><small>{teacher.employee_no ?? "未设置工号"}</small></div><button type="button" className="button button-light button-small" disabled={busy} onClick={() => {setResetTeacher(teacher);setResetPassword("");}}><Icon name="key" size={15}/>重置密码</button></div>)}</div> : <Empty icon="teacher" title="暂无教师"/>}
      </section>
    </div>
    {resetTeacher && <div className="modal-overlay" onClick={() => !busy && setResetTeacher(null)}><section className="panel modal-panel" role="dialog" aria-modal="true" aria-label="重置教师密码" onClick={e=>e.stopPropagation()}><PanelTitle icon="key" title="重置教师密码" action={<button className="close-button" aria-label="关闭" disabled={busy} onClick={()=>setResetTeacher(null)}>×</button>}/><div className="reset-identity"><strong>{resetTeacher.full_name}</strong><span>{resetTeacher.employee_no}</span></div><form className="form-stack" onSubmit={reset}><label>新密码<input autoFocus type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={resetPassword} onChange={e=>setResetPassword(e.target.value)} placeholder="至少 10 位"/></label><button className="button button-primary" disabled={busy}>{busy ? "重置中…" : "确认重置"}</button></form></section></div>}
  </main>;
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Classroom, Profile } from "@/lib/types";
import { getSupabase } from "@/lib/supabase";
import { messageOf, readAll, type Notify } from "@/lib/portal-api";
import { ClassWorkspace } from "./class-workspace";
import { Empty, Icon, Loading, PanelTitle } from "./ui";

export function TeacherWorkspace({ profile, notify }: { profile: Profile; notify: Notify }) {
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [selected, setSelected] = useState<Classroom | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const sb = getSupabase();
      setClasses(await readAll<Classroom>((from, to) => sb.from("classes").select("id,teacher_id,name,term")
        .eq("teacher_id", profile.id).order("created_at", { ascending: false }).order("id").range(from, to)));
    } catch (error) { notify({ kind: "error", text: messageOf(error) }); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [profile.id]);

  async function createClass(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { notify({ kind: "error", text: "请输入班级名称。" }); return; }
    setBusy(true);
    try {
      if (classes.some(item => item.name === name.trim() && (item.term || "") === term.trim())) throw new Error("该班级已经存在。");
      const { data, error } = await getSupabase().from("classes").insert({
        teacher_id: profile.id, name: name.trim(), term: term.trim() || null,
      }).select("id,teacher_id,name,term").single();
      if (error) throw error;
      setCreating(false); setName(""); setTerm("");
      notify({ kind: "success", text: "班级已创建。" });
      await load();
      if (data) setSelected(data as Classroom);
    } catch (error) { notify({ kind: "error", text: messageOf(error) }); }
    finally { setBusy(false); }
  }

  const visibleClasses = classes.filter(item => (item.name + " " + (item.term ?? "")).toLowerCase().includes(search.trim().toLowerCase()));
  if (selected) return <ClassWorkspace key={selected.id} classroom={selected} notify={notify} onBack={() => { setSelected(null); void load(); }}/>;
  return <main className="workspace-main">
    <div className="workspace-heading"><div><span className="section-kicker">教师工作台</span><h1>我的班级 <small>{classes.length}</small></h1></div><button className="button button-primary" onClick={() => setCreating(true)}><Icon name="plus"/>新建班级</button></div>
    <div className="teacher-class-area">
      <section className="panel classes-panel"><PanelTitle title="班级列表" icon="class" action={<button className="button button-light button-small" onClick={() => void load()} disabled={loading}><Icon name="refresh" size={16}/>刷新</button>}/>
        <label className="search-field"><Icon name="search" size={18}/><input aria-label="搜索班级" placeholder="搜索班级或学期" value={search} onChange={e => setSearch(e.target.value)}/></label>
        {loading ? <Loading/> : visibleClasses.length ? <div className="class-cards">{visibleClasses.map(item => <button className="class-card" key={item.id} onClick={() => setSelected(item)}><span className="class-icon"><Icon name="class" size={24}/></span><span className="class-copy"><strong>{item.name}</strong><small>{item.term || "未设置学期"}</small></span><Icon name="arrow"/></button>)}</div> : <Empty icon="class" title={classes.length ? "没有匹配的班级" : "还没有班级"}>{!classes.length && <button className="button button-primary" onClick={() => setCreating(true)}><Icon name="plus"/>创建班级</button>}</Empty>}
      </section>
    </div>
    {creating && <div className="modal-overlay" onClick={() => !busy && setCreating(false)}><section className="panel modal-panel" role="dialog" aria-modal="true" aria-label="新建班级" onClick={e => e.stopPropagation()}><PanelTitle title="新建班级" icon="plus" action={<button type="button" className="close-button" aria-label="关闭" onClick={() => setCreating(false)} disabled={busy}>×</button>}/><form className="form-stack" onSubmit={createClass}><label>班级名称<input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={150} required/></label><label>学期（选填）<input value={term} onChange={e => setTerm(e.target.value)} maxLength={100}/></label><button className="button button-primary" disabled={busy}>{busy ? "创建中…" : "创建班级"}</button></form></section></div>}
  </main>;
}

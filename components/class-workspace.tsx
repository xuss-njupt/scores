"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Assessment, Classroom, Student } from "@/lib/types";
import { getSupabase } from "@/lib/supabase";
import { adminAction, messageOf, readAll, type Notify } from "@/lib/portal-api";
import { downloadCsv, readWorkbook } from "@/lib/excel";
import { parseRoster, parseScores, type RosterRow, type ScoreRow } from "@/lib/import-validation";
import { Empty, Icon, Loading, PanelTitle, Status } from "./ui";

type Invite = { student_no: string; full_name: string; activation_code: string; expires_at: string };
type FailedRow = { student_no: string; error: string };
type ImportResult = { imported: number; password_accounts: number; activation: Invite[]; failed?: FailedRow[] };
type StoredScore = { student_id: string; score: number };
type PendingImport = { kind: "roster"; filename: string; rows: RosterRow[] } | { kind: "scores"; filename: string; rows: ScoreRow[] };

const formatScore = (value: number) => Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
function UploadBox({ label, disabled, onFile }: { label: string; disabled: boolean; onFile: (file: File) => void }) {
  return <label className={"upload-box" + (disabled ? " disabled" : "")}><span className="upload-icon"><Icon name="upload" size={23}/></span><span><strong>{label}</strong><small>.xlsx · 最大 10 MB</small></span><Icon name="plus" size={18}/><input aria-label={label} type="file" accept=".xlsx" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) onFile(file); }}/></label>;
}

export function ClassWorkspace({ classroom, notify, onBack }: { classroom: Classroom; notify: Notify; onBack: () => void }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [tab, setTab] = useState<"roster" | "scores">("roster");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [search, setSearch] = useState("");
  const [scoreSearch, setScoreSearch] = useState("");
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [failed, setFailed] = useState<FailedRow[]>([]);
  const [reset, setReset] = useState<Student | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [stored, setStored] = useState<StoredScore[]>([]);
  const [scoreLoading, setScoreLoading] = useState(false);
  const [scoreError, setScoreError] = useState("");
  const [version, setVersion] = useState(0);

  async function load() {
    setLoading(true);
    const sb = getSupabase();
    try {
      const [roster, projects] = await Promise.all([
        readAll<Student>((from, to) => sb.from("students").select("id,class_id,student_no,full_name,profile_id").eq("class_id", classroom.id).order("student_no").order("id").range(from,to)),
        readAll<Assessment>((from, to) => sb.from("assessments").select("id,class_id,name,category,exam_date,max_score,is_published").eq("class_id", classroom.id).order("created_at", { ascending: false }).order("id").range(from,to)),
      ]);
      setStudents(roster);
      setAssessments(projects);
      setAssessmentId(current => projects.some(item => item.id === current) ? current : projects[0]?.id ?? "");
      setVersion(v => v + 1);
    } catch (error) { notify({ kind: "error", text: messageOf(error) }); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [classroom.id]);

  useEffect(() => {
    let active = true;
    setStored([]); setScoreError("");
    if (!assessmentId || tab !== "scores") { setScoreLoading(false); return; }
    setScoreLoading(true);
    const sb = getSupabase();
    readAll<StoredScore>((from,to) => sb.from("scores").select("student_id,score").eq("assessment_id",assessmentId).order("student_id").range(from,to))
      .then(rows => { if (active) setStored(rows); }, error => { if (active) setScoreError(messageOf(error)); })
      .finally(() => { if (active) setScoreLoading(false); });
    return () => { active = false; };
  }, [assessmentId, tab, version]);

  const assessment = assessments.find(item => item.id === assessmentId);
  const scoreByStudent = useMemo(() => new Map(stored.map(row => [row.student_id, Number(row.score)])), [stored]);
  const visibleStudents = students.filter(row => (row.student_no + " " + row.full_name).toLowerCase().includes(search.trim().toLowerCase()));
  const visibleScores = students.filter(row => (row.student_no + " " + row.full_name).toLowerCase().includes(scoreSearch.trim().toLowerCase()));
  const published = assessments.filter(item => item.is_published).length;
  const activated = students.filter(item => item.profile_id).length;

  function changeTab(next: "roster" | "scores") {
    if (busy) return;
    setPending(null); setTab(next);
  }

  async function prepareFile(kind: "roster" | "scores", file: File) {
    setBusy(true); setPending(null);
    try {
      const workbook = await readWorkbook(file);
      if (kind === "roster") setPending({ kind, filename: file.name, rows: parseRoster(workbook) });
      else setPending({ kind, filename: file.name, rows: parseScores(workbook, students) });
      notify(null);
    } catch (error) { notify({ kind: "error", text: messageOf(error) }); }
    finally { setBusy(false); }
  }

  async function commitImport() {
    if (!pending) return;
    setBusy(true);
    const task = pending;
    try {
      if (task.kind === "scores") {
        const { data, error } = await getSupabase().rpc("import_class_scores", { p_class_id: classroom.id, p_rows: task.rows });
        if (error) throw error;
        setPending(null);
        notify({ kind: "success", text: "已导入 " + data + " 条成绩，涉及的项目均为待发布。" });
        await load();
      } else {
        const allInvites: Invite[] = [];
        const failures: FailedRow[] = [];
        let imported = 0;
        let newAccounts = 0;
        // Bounded batches avoid long-running Edge Function requests.
        for (let offset = 0; offset < task.rows.length; offset += 25) {
          const batch = task.rows.slice(offset, offset + 25);
          setProgress("正在导入 " + Math.min(offset + batch.length, task.rows.length) + " / " + task.rows.length);
          try {
            const result = await adminAction<ImportResult>("import_students", { class_id: classroom.id, students: batch });
            imported += result.imported;
            newAccounts += result.password_accounts;
            allInvites.push(...(result.activation ?? []));
            failures.push(...(result.failed ?? []));
          } catch (error) {
            // The server may already have processed part of this request. Report uncertainty and allow retry.
            failures.push(...batch.map(row => ({ student_no: row.student_no, error: "结果未确认：" + messageOf(error) + "；可重新导入核对" })));
          }
        }
        // Keep previously generated codes for other students; replace stale codes on a successful reimport.
        setInvites(previous => {
          const latest = new Map(previous.map(row => [row.student_no, row]));
          for (const row of task.rows) if (!failures.some(item => item.student_no === row.student_no)) latest.delete(row.student_no);
          for (const row of allInvites) latest.set(row.student_no, row);
          return [...latest.values()];
        });
        setFailed(failures); setPending(null);
        notify({ kind: failures.length ? "info" : "success", text: "已导入 " + imported + " 人，直接开通 " + newAccounts + " 人，生成激活码 " + allInvites.length + " 个。" + (failures.length ? " 另有 " + failures.length + " 行需核对。" : "") });
        await load();
      }
    } catch (error) { notify({ kind: "error", text: messageOf(error) }); }
    finally { setBusy(false); setProgress(""); }
  }

  async function publish(item: Assessment) {
    if (!item.is_published && !window.confirm("确认发布「" + item.name + "」？学生将看到本次成绩。")) return;
    if (item.is_published && !window.confirm("撤回「" + item.name + "」的发布？")) return;
    setBusy(true);
    try {
      await adminAction("publish_assessment", { assessment_id: item.id, is_published: !item.is_published });
      notify({ kind: "success", text: item.is_published ? "成绩已撤回。" : "成绩已发布。" });
      await load();
    } catch (error) { notify({ kind: "error", text: messageOf(error) }); }
    finally { setBusy(false); }
  }

  async function submitReset(event: FormEvent) {
    event.preventDefault();
    if (!reset) return;
    setBusy(true);
    try {
      await adminAction("reset_student_password", { student_id: reset.id, password: resetPassword });
      notify({ kind: "success", text: reset.full_name + " 的密码已重置，可直接登录。" });
      setReset(null); setResetPassword("");
    } catch (error) { notify({ kind: "error", text: messageOf(error) }); }
    finally { setBusy(false); }
  }

  const affected = pending?.kind === "scores" ? [...new Set(pending.rows.map(row => row.assessment_name))] : [];
  const willUnpublish = assessments.filter(item => item.is_published && affected.includes(item.name)).length;
  return <main className="workspace-main">
    <div className="workspace-heading"><div><button className="back-button" onClick={onBack} disabled={busy}><Icon name="back" size={17}/>我的班级</button><h1>{classroom.name}</h1>{classroom.term && <span className="section-kicker">{classroom.term}</span>}</div><button className="button button-light" onClick={() => void load()} disabled={busy || loading}><Icon name="refresh" size={17}/>刷新</button></div>
    <div className="overview-grid"><div className="overview-card"><span className="overview-icon"><Icon name="class"/></span><div><span>学生</span><strong>{students.length}</strong></div></div><div className="overview-card"><span className="overview-icon"><Icon name="check"/></span><div><span>已开通</span><strong>{activated}</strong></div></div><div className="overview-card"><span className="overview-icon"><Icon name="book"/></span><div><span>成绩项目</span><strong>{assessments.length}</strong></div></div><div className="overview-card"><span className="overview-icon"><Icon name="eye"/></span><div><span>已发布</span><strong>{published}</strong></div></div></div>
    <nav className="workspace-tabs" aria-label="班级工作区"><button type="button" className={tab === "roster" ? "active" : ""} aria-pressed={tab === "roster"} onClick={() => changeTab("roster")} disabled={busy}><Icon name="class"/>学生名单</button><button type="button" className={tab === "scores" ? "active" : ""} aria-pressed={tab === "scores"} onClick={() => changeTab("scores")} disabled={busy}><Icon name="book"/>成绩管理</button></nav>
    <div className="workspace-grid detail-grid">
      <section className="panel import-panel"><PanelTitle icon="upload" title={tab === "roster" ? "导入学生" : "导入成绩"}/>
        <UploadBox label={tab === "roster" ? "选择名单 Excel" : "选择成绩 Excel"} disabled={busy || loading || (tab === "scores" && !students.length)} onFile={file => void prepareFile(tab,file)}/>
        <div className="template-row"><span className="muted">{tab === "roster" ? "学号 / 姓名 / 密码（选填）" : "学号 / 姓名 / 成绩项目"}</span><button className="text-button" type="button" onClick={() => downloadCsv(tab === "roster" ? "学生名单示例.csv" : "成绩表示例.csv", tab === "roster" ? [["学号","姓名","密码"],["20260001","示例学生",""]] : [["学号","姓名","课堂测试","期中考试"],["20260001","示例学生","85","92"]])}><Icon name="download" size={15}/>模板示例</button></div>
        <small className="muted template-hint">CSV 示例可用 Excel 打开，另存为 .xlsx 后导入。</small>
        {pending && <div className="import-preview"><div className="file-tag"><Icon name="check"/><strong>{pending.filename}</strong></div><div className="preview-count"><strong>{pending.rows.length}</strong><span>{pending.kind === "roster" ? "名学生待导入" : "条成绩待导入"}</span></div>{pending.kind === "scores" && <><div className="tag-list">{affected.map(name => <span key={name}>{name}</span>)}</div>{willUnpublish > 0 && <div className="inline-warning"><Icon name="alert" size={16}/>{willUnpublish} 个已发布项目将转为待发布。</div>}</>}{pending.kind === "roster" && <div className="muted">有密码的账号可直接登录；无密码的生成激活码。已有账号不覆盖密码。</div>}<div className="button-row"><button className="button button-primary" disabled={busy} onClick={() => void commitImport()}>{busy ? progress || "导入中…" : "确认导入"}</button><button className="button button-light" disabled={busy} onClick={() => setPending(null)}>取消</button></div></div>}
        {tab === "roster" && failed.length > 0 && <div className="import-report"><h3>需核对的记录 · {failed.length}</h3><button className="text-button" onClick={() => downloadCsv("导入失败记录.csv", [["学号","原因"], ...failed.map(row => [row.student_no,row.error])])}><Icon name="download" size={16}/>导出结果</button><ul>{failed.slice(0,5).map((row,index) => <li key={row.student_no+index}>{row.student_no}：{row.error}</li>)}</ul></div>}
        {tab === "roster" && invites.length > 0 && <div className="import-report invite-report"><h3>激活码 · {invites.length}</h3><p>请立即导出并分别发给学生，7 天有效。</p><button className="button button-primary button-full" onClick={() => downloadCsv("学生激活码.csv",[["学号","姓名","激活码","有效期至"], ...invites.map(row => [row.student_no,row.full_name,row.activation_code,new Date(row.expires_at).toLocaleString("zh-CN")])])}><Icon name="download"/>导出激活码</button></div>}
      </section>
      {tab === "roster" ? <section className="panel roster-panel"><PanelTitle icon="class" title={"班级学生（" + students.length + "）"}/><label className="search-field"><Icon name="search" size={18}/><input aria-label="搜索学生" placeholder="搜索学号或姓名" value={search} onChange={e => setSearch(e.target.value)}/></label>{loading ? <Loading/> : visibleStudents.length ? <div className="table-wrap"><table><thead><tr><th>学号</th><th>姓名</th><th>账号</th><th>操作</th></tr></thead><tbody>{visibleStudents.map(row => <tr key={row.id}><td className="mono">{row.student_no}</td><td><strong>{row.full_name}</strong></td><td><Status active={!!row.profile_id} yes="已开通" no="待激活"/></td><td>{row.profile_id ? <button type="button" className="text-button" disabled={busy} onClick={() => { setReset(row); setResetPassword(""); }}><Icon name="key" size={15}/>重置密码</button> : <span className="muted">—</span>}</td></tr>)}</tbody></table></div> : <Empty icon="class" title={students.length ? "没有匹配的学生" : "尚未导入名单"}/>}</section> :
      <section className="panel scores-panel"><PanelTitle icon="book" title="成绩项目"/>{loading ? <Loading/> : assessments.length ? <><div className="assessment-selector">{assessments.map(item => <button key={item.id} className={"assessment-choice"+(item.id === assessmentId ? " selected" : "")} aria-pressed={item.id===assessmentId} onClick={() => { setAssessmentId(item.id); setScoreSearch(""); }}><span>{item.name}</span><Status active={item.is_published}/></button>)}</div>{assessment && <><div className="grade-toolbar"><div><h3>{assessment.name}</h3><span className="muted">{scoreLoading ? "正在读取…" : "已录入 " + stored.length + " / " + students.length + " 人"}</span></div><button className={"button " + (assessment.is_published ? "button-light" : "button-primary")} disabled={busy || scoreLoading || !!scoreError || (!assessment.is_published && !stored.length)} onClick={() => void publish(assessment)}><Icon name={assessment.is_published ? "back" : "check"} size={17}/>{assessment.is_published ? "撤回发布" : "发布成绩"}</button></div><label className="search-field"><Icon name="search" size={18}/><input aria-label="搜索成绩名单" value={scoreSearch} onChange={e => setScoreSearch(e.target.value)} placeholder="搜索学号或姓名"/></label>{scoreLoading ? <Loading/> : scoreError ? <Empty icon="alert" title="成绩读取失败"><button className="button button-light" onClick={() => setVersion(v => v+1)}>重试</button></Empty> : visibleScores.length ? <div className="table-wrap"><table><thead><tr><th>学号</th><th>姓名</th><th className="align-right">成绩</th></tr></thead><tbody>{visibleScores.map(row => <tr key={row.id}><td className="mono">{row.student_no}</td><td>{row.full_name}</td><td className="align-right"><strong className="table-score">{scoreByStudent.has(row.id) ? formatScore(scoreByStudent.get(row.id)!) : "—"}</strong></td></tr>)}</tbody></table></div> : <Empty icon="list" title="没有匹配的学生"/>}</>}</> : <Empty icon="book" title="暂无成绩项目"/>}</section>}
    </div>
    {reset && <div className="modal-overlay" onClick={() => !busy && setReset(null)}><section className="panel modal-panel" role="dialog" aria-modal="true" aria-label="重置学生密码" onClick={e => e.stopPropagation()}><PanelTitle icon="key" title="重置密码" action={<button className="close-button" aria-label="关闭" disabled={busy} onClick={() => { setReset(null); setResetPassword(""); }}>×</button>}/><div className="reset-identity"><strong>{reset.full_name}</strong><span>{reset.student_no}</span></div><form className="form-stack" onSubmit={submitReset}><label>新密码<input autoFocus type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="至少 10 位"/></label><button className="button button-primary" disabled={busy}>{busy ? "重置中…" : "确认重置"}</button></form></section></div>}
  </main>;
}

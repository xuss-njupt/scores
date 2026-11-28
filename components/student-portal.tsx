"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { messageOf, readAll } from "@/lib/portal-api";
import type { Profile } from "@/lib/types";
import { Empty, Icon, Loading } from "./ui";

type Relation<T> = T | T[] | null;
type ClassInfo = { id: string; name: string; term: string | null };
type AssessmentInfo = { id: string; name: string; exam_date: string | null; max_score: number | null; classes: Relation<ClassInfo> };
type RawScore = { id: string; score: number; created_at: string; assessments: Relation<AssessmentInfo> };
type ScoreRecord = { id: string; name: string; score: number; max: number | null; date: string | null; created: string; classId: string; className: string; term: string | null };
function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

export function StudentPortal({ profile }: { profile: Profile }) {
  const [scores, setScores] = useState<ScoreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [classFilter, setClassFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    async function load() {
      try {
        const sb = getSupabase();
        const rows = await readAll<RawScore>((from, to) => sb.from("scores")
          .select("id,score,created_at,students!inner(profile_id),assessments!inner(id,name,exam_date,max_score,classes!inner(id,name,term))")
          .eq("students.profile_id", profile.id).eq("assessments.is_published", true)
          .order("id").range(from, to));
        const mapped = rows.flatMap((row): ScoreRecord[] => {
          const a = one(row.assessments); const c = a && one(a.classes);
          if (!a || !c) return [];
          return [{ id: row.id, name: a.name, score: Number(row.score), max: a.max_score === null ? null : Number(a.max_score), date: a.exam_date, created: row.created_at, classId: c.id, className: c.name, term: c.term }];
        });
        mapped.sort((a, b) => (b.date || b.created).localeCompare(a.date || a.created));
        if (alive) setScores(mapped);
      } catch (err) { if (alive) setError(messageOf(err)); }
      finally { if (alive) setLoading(false); }
    }
    void load();
    return () => { alive = false; };
  }, [profile.id, version]);

  const classes = useMemo(() => Array.from(new Map(scores.map(score => [score.classId, { name: score.className, term: score.term }])).entries()), [scores]);
  const shown = scores.filter(score => (!classFilter || score.classId === classFilter) && (!search.trim() || (score.name + " " + score.className).toLowerCase().includes(search.trim().toLowerCase())));
  return <main className="student-main">
    <section className="student-summary">
      <div><span className="student-label">学生 · {profile.student_no}</span><h1>{profile.full_name}</h1><span className="student-summary-label"><Icon name="book" size={16}/>我的成绩</span></div>
      <div className="student-count"><strong>{loading && !scores.length ? "—" : scores.length}</strong><span>项已发布</span></div>
    </section>
    <section className="student-results">
      <div className="student-section-heading"><h2>成绩记录</h2><button className="button button-light button-small" onClick={() => setVersion(v => v + 1)} disabled={loading}><Icon name="refresh" size={16}/>刷新</button></div>
      {scores.length > 0 && <div className="student-filters">
        <label className="search-field"><Icon name="search" size={18}/><input aria-label="搜索成绩" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索考试或课程"/></label>
        {classes.length > 1 && <select aria-label="按班级筛选" value={classFilter} onChange={e => setClassFilter(e.target.value)}><option value="">全部班级</option>{classes.map(([id, item]) => <option key={id} value={id}>{item.name}{item.term ? " · " + item.term : ""}</option>)}</select>}
      </div>}
      {loading ? <Loading text="正在查询成绩…"/> : error ? <Empty icon="alert" title="成绩加载失败" description="请检查网络后重试"><button className="button button-primary" onClick={() => setVersion(v => v + 1)}>重新加载</button></Empty> : !shown.length ? <Empty icon="book" title={scores.length ? "没有匹配的成绩" : "暂无已发布成绩"} description={scores.length ? "可调整筛选条件" : "教师发布后即可查询"}/> : <div className="score-cards">
        {shown.map(item => <article className="score-card" key={item.id}><div className="score-card-icon"><Icon name="book" size={22}/></div><div className="score-card-info"><span>{item.className}{item.term ? " · " + item.term : ""}</span><h3>{item.name}</h3><time>{item.date || "日期未设置"}</time></div><div className="score-number"><strong>{item.score.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</strong>{item.max !== null && <small>/ {item.max}</small>}</div></article>)}
      </div>}
    </section>
  </main>;
}

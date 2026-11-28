import Link from "next/link";
import { Brand, Icon } from "@/components/ui";

export default function HomePage() {
  return <main className="home-page"><header className="home-header"><Brand/></header><section className="home-content"><div className="home-heading"><h1>校园成绩查询</h1></div><div className="entry-grid"><Link className="entry-card entry-student" href="/student/"><span className="entry-icon"><Icon name="student" size={36}/></span><div><h2>学生查询</h2><span>查看个人成绩</span></div><Icon name="arrow" size={22}/></Link><Link className="entry-card entry-teacher" href="/teacher/"><span className="entry-icon"><Icon name="teacher" size={36}/></span><div><h2>教师管理</h2><span>班级 · 学生 · 成绩</span></div><Icon name="arrow" size={22}/></Link></div></section><footer className="home-footer">校园成绩平台</footer></main>;
}

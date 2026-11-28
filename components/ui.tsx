import type { ReactNode } from "react";
import Link from "next/link";
import type { Notice } from "@/lib/portal-api";

export type IconName = "student" | "teacher" | "book" | "class" | "upload" | "plus" | "arrow" | "back" | "refresh" | "check" | "lock" | "logout" | "search" | "list" | "eye" | "download" | "key" | "alert" | "home";
const paths: Record<IconName, ReactNode> = {
  student: <><path d="m2 10 10-5 10 5-10 5-10-5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5M22 10v6"/></>,
  teacher: <><rect x="8" y="3" width="13" height="13" rx="2"/><path d="M12 7h5M12 11h5M3 21v-2a4 4 0 0 1 8 0v2"/><circle cx="7" cy="12" r="3"/></>,
  book: <><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 3v18M12 9h4M12 13h4"/></>,
  class: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M17 13a5 5 0 0 1 4 5v3"/></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></>,
  plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="m9 5 7 7-7 7"/>, back: <path d="m14 6-6 6 6 6M8 12h13"/>,
  refresh: <><path d="M20 11a8 8 0 1 0-2 7M20 4v7h-7"/></>,
  check: <path d="m5 12 5 5L20 7"/>, lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
  logout: <><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M8 12h13m-5-5 5 5-5 5"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  list: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  download: <path d="M12 3v13m-5-5 5 5 5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>,
  key: <><circle cx="8" cy="10" r="5"/><path d="m12 14 8 8m-3-3 3-3m-6 0 3-3"/></>,
  alert: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></>,
  home: <><path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/></>,
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function Brand({ href = "/" }: { href?: string }) {
  return <Link href={href} className="brand"><span className="brand-mark"><Icon name="book" size={23}/></span><strong>校园成绩</strong></Link>;
}

export function NoticeBar({ notice, onClose }: { notice: Notice; onClose?: () => void }) {
  if (!notice) return null;
  return <div className={"notice " + notice.kind} role={notice.kind === "error" ? "alert" : "status"}><Icon name={notice.kind === "success" ? "check" : "alert"}/><span>{notice.text}</span>{onClose && <button className="close-button" type="button" onClick={onClose} aria-label="关闭提示">×</button>}</div>;
}

export function Empty({ icon = "list", title, description, children }: { icon?: IconName; title: string; description?: string; children?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={27}/></span><strong>{title}</strong>{description && <span>{description}</span>}{children}</div>;
}

export function Status({ active, yes = "已发布", no = "待发布" }: { active: boolean; yes?: string; no?: string }) {
  return <span className={"status-pill" + (active ? " status-green" : " status-draft")}><span className="status-dot"/>{active ? yes : no}</span>;
}

export function Loading({ text = "加载中…" }: { text?: string }) {
  return <div className="loading-inline" role="status"><span className="spinner"/>{text}</div>;
}

export function PanelTitle({ icon, title, action }: { icon?: IconName; title: string; action?: ReactNode }) {
  return <div className="panel-title"><h2>{icon && <span className="heading-icon"><Icon name={icon}/></span>}{title}</h2>{action}</div>;
}

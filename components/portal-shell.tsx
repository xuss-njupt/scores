"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Profile } from "@/lib/types";
import { getSupabase } from "@/lib/supabase";
import { messageOf, type Notice } from "@/lib/portal-api";
import { AuthPanel, PasswordPanel } from "./auth-panel";
import { Brand, Empty, Icon, Loading, NoticeBar } from "./ui";
const StudentPortal = dynamic(() => import("./student-portal").then(m => m.StudentPortal), { loading: () => <Loading/> });
const TeacherWorkspace = dynamic(() => import("./teacher-workspace").then(m => m.TeacherWorkspace), { loading: () => <Loading/> });
const AdminWorkspace = dynamic(() => import("./admin-workspace").then(m => m.AdminWorkspace), { loading: () => <Loading/> });

export default function PortalShell({ portal }: { portal: "student" | "teacher" }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [configError, setConfigError] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let active = true;
    try {
      const sb = getSupabase();
      const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
        if (active) { setUserId(session?.user.id ?? null); setReady(true); }
      });
      return () => { active = false; subscription.unsubscribe(); };
    } catch (error) {
      setConfigError(messageOf(error)); setReady(true);
      return () => { active = false; };
    }
  }, []);

  useEffect(() => {
    let active = true;
    setProfile(null); setProfileError(""); setShowPassword(false);
    if (userId) {
      getSupabase().from("profiles").select("id,role,full_name,student_no,must_change_password").eq("id", userId).single().then(({ data, error }) => {
        if (!active) return;
        if (error || !data) setProfileError("无法读取账号资料，请重试或退出后重新登录。");
        else setProfile(data as Profile);
      }, () => { if (active) setProfileError("无法读取账号资料，请检查网络。"); });
    }
    return () => { active = false; };
  }, [userId, profileVersion]);

  async function logout() {
    try {
      const { error } = await getSupabase().auth.signOut();
      if (error) throw error;
      setNotice(null);
    } catch (error) { setNotice({ kind: "error", text: messageOf(error) }); }
  }

  const liveProfile = profile?.id === userId ? profile : null;
  if (!ready) return <main className="full-loading"><Brand/><Loading/></main>;
  if (configError) return <main className="full-loading"><Brand/><Empty icon="alert" title="连接配置不可用" description={configError}/></main>;
  if (!userId) return <div className="app-background"><AuthPanel portal={portal} notify={setNotice}/><div className="floating-notice"><NoticeBar notice={notice} onClose={() => setNotice(null)}/></div></div>;
  if (!liveProfile) return <main className="full-loading"><Brand/>{profileError ? <Empty icon="alert" title="账号资料加载失败" description={profileError}><button className="button button-primary" onClick={() => setProfileVersion(v => v + 1)}>重试</button><button className="button button-light" onClick={() => void logout()}>退出登录</button></Empty> : <Loading/>}</main>;

  const student = liveProfile.role === "student";
  const correct = (portal === "student") === student;
  const role = student ? "学生" : liveProfile.role === "admin" ? "管理员" : "教师";
  return <div className={student ? "app-background student-app" : "app-background staff-app"}>
    <header className="topbar"><Brand href={student ? "/student/" : "/teacher/"}/><div className="topbar-actions"><span className="account-name"><span className="avatar">{liveProfile.full_name.slice(0,1)}</span><span>{liveProfile.full_name}<small>{role}</small></span></span><button className="button button-light button-small" onClick={() => setShowPassword(value => !value)} aria-label="修改密码"><Icon name="key" size={17}/><span className="desktop-label">密码</span></button><button className="button button-light button-small" onClick={() => void logout()}><Icon name="logout" size={17}/>退出</button></div></header>
    <NoticeBar notice={notice} onClose={() => setNotice(null)}/>
    {!correct ? <main className="center-stage"><section className="panel password-panel"><Empty icon={student ? "student" : "teacher"} title={"当前已登录" + role + "账号"}><Link className="button button-primary" href={student ? "/student/" : "/teacher/"}>进入{role}页面<Icon name="arrow"/></Link><button className="button button-light" onClick={() => void logout()}>切换账号</button></Empty></section></main> : liveProfile.must_change_password || showPassword ? <main className="center-stage"><PasswordPanel required={liveProfile.must_change_password} notify={setNotice} onComplete={() => { setProfile({ ...liveProfile, must_change_password: false }); setShowPassword(false); }} onCancel={liveProfile.must_change_password ? undefined : () => setShowPassword(false)}/></main> : student ? <StudentPortal key={liveProfile.id} profile={liveProfile}/> : liveProfile.role === "admin" ? <AdminWorkspace key={liveProfile.id} notify={setNotice}/> : <TeacherWorkspace key={liveProfile.id} profile={liveProfile} notify={setNotice}/>}
  </div>;
}

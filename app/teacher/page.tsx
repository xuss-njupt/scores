import type { Metadata } from "next";
import PortalShell from "@/components/portal-shell";
export const metadata: Metadata = { title: "教师工作台 | 校园成绩" };
export default function TeacherPage() { return <PortalShell portal="teacher"/>; }

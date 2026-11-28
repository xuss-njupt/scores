import type { Metadata } from "next";
import PortalShell from "@/components/portal-shell";
export const metadata: Metadata = { title: "学生成绩查询 | 校园成绩" };
export default function StudentPage() { return <PortalShell portal="student"/>; }

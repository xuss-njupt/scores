import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "校园成绩查询平台",
  description: "教师成绩管理与学生个人成绩查询系统",
  applicationName: "校园成绩查询平台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

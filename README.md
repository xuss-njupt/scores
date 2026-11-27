# 校园成绩查询平台

面向学校教师与学生的成绩管理网站。**只使用 GitHub 和 Supabase**：GitHub Pages 托管静态前端，GitHub Actions 自动构建发布，Supabase 提供认证、数据库、行级权限和 Edge Functions。不依赖 Vercel、Netlify 或其他网站托管平台。

## 功能

- **超级管理员**：创建教师账号、查看教师列表。
- **教师**：创建和管理自己的班级；通过 Excel 批量导入学生；导入多列成绩；发布/撤回成绩；重置已激活学生的密码。
- **学生**：使用学号和密码登录；首次使用凭教师发放的一次性激活码设置密码；只查看本人已发布成绩。
- **数据隔离**：数据库启用 RLS；教师只能管理自己的班级；学生只能读取本人已发布成绩；成绩导入后默认不发布。
- **部署**：推送到 GitHub main 分支后，自动构建并发布到 GitHub Pages。

## 技术栈

- Next.js 16.4.6 / React 19.3.1 / TypeScript
- GitHub Actions / GitHub Pages
- Supabase Auth / PostgreSQL / Row Level Security / Edge Functions
- read-excel-file 9.3.20（浏览器端读取 .xlsx）

## 正式网站地址

https://xuss-njupt.github.io/scores/

管理员首次初始化页面：

https://xuss-njupt.github.io/scores/setup-admin/

## 本地运行

要求 Node.js 20.9 或更高版本。

```bash
git clone https://github.com/xuss-njupt/scores.git
cd scores
cp .env.example .env.local
npm ci
npm run dev
```

本地开发时在 `.env.local` 中填写 Supabase URL 和 Publishable Key：

```env
NEXT_PUBLIC_SUPABASE_URL=https://hwxsuieolykxfgjxitra.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=你的Supabase_Publishable_Key
```

浏览器端只使用 Publishable Key。**不要将 Supabase Secret Key、service_role key、数据库密码或 Supabase Access Token 写入前端变量或提交到 GitHub。**

## Supabase 项目

- Project ref：`hwxsuieolykxfgjxitra`
- API URL：`https://hwxsuieolykxfgjxitra.supabase.co`

生产数据库已经部署以下表并启用 RLS：

- `profiles`
- `classes`
- `students`
- `assessments`
- `scores`
- `student_invites`
- `admin_bootstrap_state`

数据库迁移保存在 `supabase/migrations/`。三个 Edge Functions 已部署并启用：

- `scores-admin`：管理员和教师的受权管理操作。
- `student-activate`：学生一次性激活。
- `bootstrap-admin`：一次性创建第一个超级管理员。

Edge Functions 在 Supabase 服务端运行，服务端密钥不会发送到浏览器。不要把 Secret Key 放进 GitHub Actions 的前端构建变量。

## GitHub Pages 自动部署

仓库已经配置：

- `next.config.ts`：Next.js 静态导出（`output: "export"`）、GitHub Pages 项目路径 `/scores` 和尾部斜杠路由。
- `.github/workflows/ci.yml`：依赖安全审计、TypeScript 检查和静态构建。
- `.github/workflows/deploy-pages.yml`：构建 `out/` 并通过 GitHub Pages 官方 Actions 发布。
- `public/.nojekyll`：确保 Next.js 的 `_next` 静态资源目录正常发布。

### 首次启用 Pages（只需一次）

1. 打开仓库 Settings → Pages。
2. 在 Build and deployment 的 Source 中选择 **GitHub Actions**。
3. 保存。

此后每次向 `main` 推送代码，`Deploy GitHub Pages` 工作流都会自动构建和发布。也可以在仓库 Actions 页面手动运行该工作流。

### 发布检查

部署成功后打开 https://xuss-njupt.github.io/scores/，确认页面、CSS 和 JavaScript 资源均正常加载。再检查：

- 管理员、教师和学生密码登录与退出。
- 学生首次激活、教师重置密码后的强制改密。
- 管理员创建教师。
- 教师创建班级、导入学生名单、生成激活码。
- 教师导入成绩、检查未发布状态、发布和撤回成绩。
- 学生只能看到本人已发布的成绩。

如果 GitHub Pages 还未启用，或仓库 Actions 没有 Pages 发布权限，首次工作流可能提示配置问题；按上面的 Settings → Pages 设置一次即可。

## 创建第一个超级管理员

打开正式网站的 `/setup-admin/` 页面，输入项目的一次性初始化令牌、管理员姓名、邮箱和至少12位密码。Edge Function 会在 Supabase Auth 创建首个管理员，并在 `profiles` 中赋予 admin 角色。初始化成功后令牌立即失效，不能再次使用。

系统不开放公开注册。教师账号由超级管理员创建；学生账号由教师导入名单并通过初始密码或一次性激活码开通。不要给普通教师或学生分配 admin 角色。

## Excel 格式

### 学生名单

第一行是表头，至少包含学号和姓名；密码列可选。

| 学号 | 姓名 | 密码（可选） |
|---|---|---|
| 20260001 | 张三 | InitPass2026 |
| 20260002 | 李四 | |

- 密码列有值：初始密码至少10位，直接创建账号，首次登录必须改密。
- 密码列缺失或为空：系统生成一次性激活码，有效期7天，只显示一次。教师需通过安全渠道发给对应学生。
- 已激活学生再次导入名单不会覆盖其密码。

### 成绩表

第一行至少包含学号和姓名，其余列名作为成绩项目名称：

| 学号 | 姓名 | 课堂测试 | 阶段考试 | 期中考试 |
|---|---|---:|---:|---:|
| 20260001 | 张三 | 88 | 91 | 86 |
| 20260002 | 李四 | 92 | 84 | 90 |

导入时按学号匹配本班学生，空白成绩跳过。每个成绩列创建一条考试记录，默认未发布；教师检查后再逐项发布。当前支持 `.xlsx`；旧版 `.xls` 请先另存为 `.xlsx`。学号建议设置为文本格式以保留前导零。

## 安全说明

- 学生登录账号由学号的 SHA-256 摘要生成内部邮箱标识，学生仍只需输入学号和密码。
- 角色由受保护的 profiles 数据管理，普通用户不能自行提升角色。
- 学生只能读取本人已发布成绩；教师只能管理自己班级。
- 学生密码重置后，在完成强制改密前，RLS 会阻断其读取班级、考试和成绩数据。
- 所有公开业务表启用 RLS。不要将学生名单或成绩文件放入公开 Storage Bucket。
- GitHub Pages 的前端是公开静态文件；Supabase Publishable Key 本来就是公开客户端密钥。安全边界必须由 Supabase Auth、Edge Functions 和 RLS 提供，绝不能依赖隐藏前端代码或保密 Publishable Key。

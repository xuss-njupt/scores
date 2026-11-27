# 成绩查询平台

面向学校教师与学生的成绩管理网站。网站前端使用 Next.js，身份认证和 PostgreSQL 数据库使用 Supabase。

## 功能

- **超级管理员**：创建教师账号、查看教师列表。
- **教师**：创建和管理自己的班级；通过 Excel 批量导入学生；导入多列成绩；发布/撤回成绩；重置已激活学生的密码。
- **学生**：使用学号和密码登录；首次登录前凭教师发放的一次性激活码设置密码；只查看本人已发布成绩。
- **数据隔离**：数据库启用 RLS；教师只能管理自己班级；学生不能读取同班其他学生的成绩；成绩导入后默认不发布。

## 技术栈

- Next.js 16.4.6 / React 19.3.1 / TypeScript
- Supabase Auth / PostgreSQL / Row Level Security / Edge Functions
- read-excel-file 9.3.20（浏览器端安全读取 .xlsx）
- Netlify（网站托管）+ GitHub Actions（持续集成）

## 1. 本地运行

要求 Node.js 20.9 或更高版本。

    git clone https://github.com/xuss-njupt/scores.git
    cd scores
    cp .env.example .env.local

编辑 .env.local：

    NEXT_PUBLIC_SUPABASE_URL=https://hwxsuieolykxfgjxitra.supabase.co
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=在Supabase的API Keys页面复制Publishable key

然后执行：

    npm install
    npm run dev

打开 http://localhost:3000 。

浏览器环境只放 Publishable Key。**不要将 Supabase Secret Key、service_role key、数据库密码写进 NEXT_PUBLIC 环境变量或提交到 GitHub。**

## 2. Supabase 数据库

项目数据库迁移文件位于 supabase/migrations/。本仓库对应的 Supabase 项目：

- Project ref：hwxsuieolykxfgjxitra
- API URL：https://hwxsuieolykxfgjxitra.supabase.co

数据库结构及 RLS 已通过 Supabase 管理接口应用到该项目。新环境可按文件名顺序执行迁移。

## 3. 创建第一个超级管理员

系统不开放公开注册，也不允许用户自行指定角色。首次部署时只需手工创建一次超级管理员：

1. 打开 Supabase Dashboard → Authentication → Users。
2. 使用 Add user 创建管理员邮箱账号并设置一个强密码。
3. 复制该用户的 UUID。
4. 打开 SQL Editor，执行下面 SQL，将 UUID 和姓名替换为实际值：

    insert into public.profiles (id, role, full_name)
    values ('AUTH_USER_UUID'::uuid, 'admin', '系统管理员');

只执行一次。之后登录网站，超级管理员可以在后台创建教师账号。不要给普通教师或学生分配 admin 角色。

同时请到 Supabase Dashboard → Authentication → Settings，将 Allow new users to sign up（允许新用户注册）关闭。网站不会提供公开注册入口；教师通过管理员创建，学生通过一次性激活码建立账号。

## 4. Edge Functions

两个函数部署在项目中：

- **scores-admin**：要求有效登录 JWT；在服务端校验数据库角色后，执行教师账号创建、学生导入与激活码签发、密码重置、密码修改和成绩发布。
- **student-activate**：允许未登录用户调用，但必须同时验证学号、姓名、一次性激活码与有效期。激活码为高熵随机值，数据库只保存 SHA-256 摘要，且激活后即失效。

两个函数使用 Supabase 官方 @supabase/server SDK：登录后管理操作由 SDK 验证用户身份，学生首次激活由独立公开入口验证高熵激活码。SDK 从 Supabase 托管环境自动读取服务端 Secret Key。不要把密钥复制到源码、GitHub 或前端变量。

## 5. Excel 格式

### 学生名单

第一行是表头，至少包含：

| 学号 | 姓名 | 密码（可选） |
|---|---|---|
| 20260001 | 张三 | InitPass2026 |
| 20260002 | 李四 |  |

教师在班级页面上传 Excel 后：若“密码”列有值（至少10位），系统直接创建学生账号并要求学生首次登录时修改密码；若密码列缺失或单元格为空，系统生成一次性激活码。请通过学校认可的渠道分别发给学生；激活码有效期为 7 天，只显示一次。学生激活时输入学号、姓名、激活码并设置自己的密码。若学生已激活，再次导入名单不会重置其密码。

### 成绩表

第一行至少包含“学号”和“姓名”，其余列名会被当作考试/测验名称：

| 学号 | 姓名 | 课堂测试 | 阶段考试 | 期中考试 |
|---|---|---:|---:|---:|
| 20260001 | 张三 | 88 | 91 | 86 |
| 20260002 | 李四 | 92 | 84 | 90 |

导入时按学号匹配本班学生，空白成绩跳过。每个成绩列创建一条考试记录。导入后默认未发布，教师确认无误后逐项点击“发布”，学生才可以查询。

建议成绩表中使用数值单元格，不要把“缺考”“优秀”等文本写入分数列。

当前导入器支持 .xlsx。旧版二进制 .xls 文件请先用 Excel 或 WPS 另存为 .xlsx；学号建议在表格中设置为文本格式，以保留前导零。

## 6. 部署到 Netlify（不使用 Vercel）

本项目使用 Next.js App Router，不能使用 GitHub Pages 这类纯静态托管。Netlify 通过官方 OpenNext adapter 运行 Next.js 服务端渲染、Route Handlers 和 Server Actions。

### 推荐部署方式：连接 GitHub 仓库

1. 登录 https://app.netlify.com/ ，选择 Add new project → Import an existing project。
2. 选择 GitHub，授权 Netlify 访问 `xuss-njupt/scores`。
3. 选择仓库和 `main` 分支。
4. 构建设置：
   - Build command：`npm run build`
   - Publish directory：`.next`
   - Node version：`22`
   - Base directory：留空（仓库根目录）
5. 在 Site configuration → Environment variables 添加：
   - `NEXT_PUBLIC_SUPABASE_URL` = Supabase 项目 URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = Supabase Publishable Key
6. 触发部署。后续推送到 `main` 会自动重新构建和发布。

仓库根目录的 `netlify.toml` 已声明构建命令、发布目录和 Node.js 版本。Netlify 会自动检测 Next.js 并启用 OpenNext adapter，无需将应用改成静态导出。

### 上线后检查

- 确认 Netlify 生产域名可公开打开，不启用 Netlify 访问密码或团队 SSO 保护。
- 检查登录、退出、首次学生激活、首次改密、管理员创建教师、教师导入学生、导入成绩、发布成绩、学生查询成绩。
- 检查 Supabase Authentication 的 Site URL 和 Redirect URLs，加入 Netlify 生产域名（如 `https://your-site.netlify.app`）。
- 确认浏览器网络请求只包含 Publishable Key；Supabase Secret Key / service_role 绝不能放在前端环境变量。
- 网站可以公开访问，但成绩数据必须登录后才能读取。

网站可以公开访问，但成绩数据必须登录后才能读取。不要把成绩表或学生名单发布到公开 Storage Bucket。

## 7. GitHub Actions

.github/workflows/ci.yml 会在 push 和 pull request 时执行依赖安装、TypeScript 类型检查和 Next.js 构建。CI 使用虚拟 Supabase 环境变量完成编译检查，不连接生产数据库。

## 安全说明

- 学生登录账号由学号的 SHA-256 摘要生成内部邮箱标识，学生仍只需输入学号和密码；不依赖学生拥有邮箱。
- 不支持公开注册。教师账号只能由超级管理员创建；学生账号只能凭有效激活码建立。
- 密码至少 10 位。教师重置已激活学生的密码后，学生下次登录必须更改密码；在完成改密前，RLS 会同时阻断该学生读取班级、考试和成绩数据，即使旧访问令牌尚未过期。
- 角色字段不允许用户自行更新。所有角色与班级权限由数据库策略和服务端代码执行。
- 生产环境应为教师和管理员启用强密码，按学校规范管理学生激活码和导出文件，并定期检查 Supabase Security Advisors。

## 备注

本仓库当前为首个可部署版本。首次管理员初始化和 Vercel 环境变量仍需项目所有者在对应控制台完成；GitHub 代码提交本身不会替用户登录 Vercel 或创建真实管理员账户。


## 8. 首次管理员一键初始化

部署网站后，打开 `/setup-admin` 页面，输入项目所有者提供的一次性初始化令牌、管理员姓名、邮箱和至少12位密码。系统会在 Supabase Auth 创建管理员并写入 `profiles.role='admin'`。初始化成功后令牌立即失效，不能重复使用。

本项目当前的首次初始化采用一次性令牌的 SHA-256 摘要保存在 Edge Function 代码中；原始令牌不写入 GitHub。不要将令牌放入公开环境变量、页面源码或提交记录。

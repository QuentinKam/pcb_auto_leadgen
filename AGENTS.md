# AGENTS.md — AI 协作基线协议

> 所有 AI 编码助手（Trae/Builder/Solo Coder 等）在修改本仓库前必读。此文档为后续每次 AI 协作的上下文基线，确保一次做对、不跑偏。

## 1. 项目概述

PCB 外贸 AI 自动获客 Agent 独立产品。面向做 PCB/PCBA 代工、开发欧美客户的外贸工厂/外贸公司，自动完成海外潜在客户挖掘、资格预审、个性化触达。

- **产品定位**：独立产品，可对外卖给同赛道外贸公司，单独收费
- **MVP 范围**：采集 + 打分 + 看板（P1），后续迭代个性化内容（P2）、自动化发送（P3）
- **完整规划见** `spec.md`、产品意图见 `intent.md`

## 2. 技术栈（全 Bun，2026 最佳实践）

### 看板前端
- Hono on Bun（静态服务 + API 代理）
- Vite 6（HMR + 构建）
- React 19 + TypeScript 5.x
- shadcn/ui + TailwindCSS v4
- TanStack Query（数据获取/缓存）
- TanStack Router（类型安全路由）

### 后端微服务（统一栈）
- 运行时：**Bun**（不使用 Node、npm）
- Web 框架：**Hono**
- ORM：**Drizzle ORM**（不使用 Prisma）
- 队列：**Redis + BullMQ**

### 共享基础设施
- 数据库：PostgreSQL（本地 Docker / Supabase 云端）
- 缓存/队列：Redis（Upstash 或自建）
- 对象存储：Cloudflare R2
- LLM：Vercel AI SDK + Anthropic Claude（主）+ OpenAI（备）
- 邮件：Resend（生产）+ Mailtrap（测试）
- 爬虫：Crawlee + Playwright + 代理 IP 池
- 监控：Sentry + Axiom + Better Stack

### 工程化
- 包管理：**pnpm + npmmirror.com 中国镜像**（禁用 npm/yarn）
- Monorepo：pnpm workspaces + Turborepo
- 代码规范：**Biome**（替代 ESLint+Prettier）
- Git Hook：**lefthook**（替代 husky）
- CI/CD：GitHub Actions → Fly.io
- 部署：Fly.io（统一，不混用 Vercel）

## 3. 目录结构与命名规范

```
pcb_auto_leadgen/
├── apps/
│   ├── dashboard/   # Hono + Vite + React 看板
│   ├── gateway/     # Hono API 网关
│   ├── collector/   # 采集微服务
│   ├── scorer/      # 打分微服务
│   └── mailer/      # 邮件微服务
├── packages/
│   ├── db/          # Drizzle schema 共享
│   ├── queue/       # BullMQ 共享
│   ├── ui/          # shadcn 组件共享
│   ├── types/       # zod schema 共享
│   └── config/      # biome/tsconfig 共享
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

### 命名规范
- **代码标识符**：camelCase（变量、函数）
- **数据库列名**：snake_case
- **文件名**：kebab-case（`lead-score.ts`，非 `LeadScore.ts`）
- **React 组件文件名**：PascalCase（`LeadCard.tsx`）
- **类型/接口**：PascalCase（`type LeadScore`）
- **常量**：UPPER_SNAKE_CASE（`const MAX_DAILY_SENDS = 50`）
- **路由**：kebab-case（`/lead-scores`，非 `/leadScores`）
- **数据库表名**：复数 snake_case（`lead_scores`，非 `LeadScore`）

## 4. 代码规范

### 强制规则
- TypeScript 严格模式 `strict: true`，禁用 `any`（例外：第三方库类型缺失时，加 `// @ts-expect-error` 注释）
- 函数优先、单一职责、每个文件 < 300 行
- **不添加未请求的功能**：用户说"加登录"就只加登录，不顺手加重置密码、SSO、2FA
- **不创建未请求的文件**：文档/配置/工具文件只在明确需要时创建
- **优先编辑现有文件**，不轻易新建
- **不写过度防御**：只校验外部边界（HTTP 入参、爬虫产物、LLM 输出），内部函数调用信任参数

### Biome 配置要点
- 缩进：2 空格
- 引号：单引号
- 分号：必须
- 尾随逗号：es5
- import 排序：开启

### React 组件
- 函数组件 + Hooks，不写 class 组件
- 服务端组件优先，客户端组件用 `'use client'` 显式标注
- props 用 interface，可选属性加 `?`
- 不写 PropTypes（TypeScript 已覆盖）

### 后端 API
- 入参用 zod schema 校验（schema 定义在 `packages/types`）
- 路由用 Hono 的 `zod-validator`
- 错误响应统一 `{ error: string, code: string }`
- 成功响应直接返回数据，不包 `{ data: ... }` 外壳
- HTTP 状态码：201 创建、204 删除、400 参数、401 鉴权、403 权限、404 不存在、429 限流、500 服务错误

## 5. 依赖管理

- **禁用 npm/yarn**，统一用 pnpm
- **registry**：`https://registry.npmmirror.com`（中国镜像）
- 添加依赖：
  - workspace 内部：`pnpm --filter @pcb/dashboard add xxx`
  - 全局工具：`pnpm add -w -D xxx`
- 共享代码放 `packages/*`，通过 `workspace:*` 引用
- **不使用 Skypack CDN**（中国网络问题），用 npm 或 JSR specifiers
- **锁定版本**：`pnpm-lock.yaml` 必须提交

## 6. Git 提交规范（Conventional Commits）

```
<type>(<scope>): <subject>

<body>

<footer>
```

### type
- `feat`：新功能
- `fix`：bug 修复
- `refactor`：重构（不改行为）
- `perf`：性能优化
- `docs`：文档
- `test`：测试
- `chore`：构建/工具/依赖
- `ci`：CI 配置

### scope（按 app/package）
- `dashboard`、`gateway`、`collector`、`scorer`、`mailer`
- `db`、`queue`、`ui`、`types`、`config`

### 示例
```
feat(scorer): add rule-based scoring model v1
fix(mailer): handle resend webhook signature verification
refactor(db): extract tenant_id filter to shared middleware
chore(config): bump biome to 2.0
```

### 规则
- subject 用中文或英文均可，但必须 ≤ 50 字符
- 不写 `update`、`modify` 这类无意义词
- 一次提交只做一件事，混合改动拆分
- **不使用 `--no-verify`** 跳过 hook
- **不使用 `--amend`**，新写一个 commit

## 7. 测试要求

- **修复 bug 用 TDD**：先写复现测试，再修代码（贴合用户 TDD 偏好）
- 新功能不强求 TDD，但关键逻辑必须有测试：
  - 打分模型（权重计算、A/B/C 分级）
  - 邮件发送调度（配额控制、间隔控制）
  - zod schema 校验（必填、类型、边界）
- 测试框架：Bun 内置 `bun test`
- 测试文件命名：`*.test.ts`，与源文件同目录
- 覆盖率不强制 100%，但关键路径必须有

## 8. 禁止行为（红线）

### 法律合规
- **不绕过 LinkedIn TOS**：不做批量自动抓取、批量自动私信
- **不暴力爬虫**：robots.txt 遵守、间隔 ≥ 2s、不高频重试
- **不发送未授权邮箱**：仅采集公开企业邮箱
- **不绕过邮件反垃圾**：每封含 unsubscribe、发件人地址

### 技术红线
- **不使用 npm/yarn**
- **不使用 Next.js / Remix / Astro**（统一 Hono + Vite + React）
- **不使用 Prisma**（统一 Drizzle）
- **不使用 ESLint + Prettier**（统一 Biome）
- **不使用 husky**（统一 lefthook）
- **不使用 Skypack / esm.sh CDN**（中国网络问题）
- **不写过度抽象**：不为未来假想需求设计接口，当前需求最小实现
- **不写未请求的注释/文档**：代码自解释，注释只在逻辑不明显处
- **不写未请求的 emoji**：用户未要求不加

### 架构红线
- **不在 apps 之间直接 import**：必须通过 `packages/*` 共享
- **不在前端直连数据库**：必须走 gateway → 微服务
- **不在 Serverless 跑长任务**：爬虫/邮件 worker 用常驻进程
- **不在微服务直接鉴权**：鉴权统一在 gateway

## 9. 环境变量约定

- 配置文件：`.env`（本地）、`.env.production`（生产）
- `.env` 必须在 `.gitignore`，**禁止提交密钥**
- 变量前缀：
  - `DATABASE_URL`、`REDIS_URL`、`R2_*`、`RESEND_API_KEY`
  - `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`
  - `APOLLO_API_KEY`、`HUNTER_API_KEY`、`CLEARBIT_API_KEY`
  - `BRIGHTDATA_TOKEN`、`SENTRY_DSN`
- 多租户 ID：`TENANT_ID`（本地开发用，生产从 JWT 解析）

## 10. 常见坑提醒

- **Bun + BullMQ**：worker 必须用常驻进程，不能跑在 Serverless
- **Drizzle + PostgreSQL**：迁移用 `drizzle-kit generate` + `drizzle-kit migrate`，不手写 SQL
- **Crawlee + Playwright**：Playwright 浏览器二进制 300MB+，Fly.io 部署用 Volume 共享
- **Resend webhook**：必须验签，避免伪造请求污染发送状态
- **LLM 输出**：必须用 zod 解析 Claude/GPT 返回的 JSON，LLM 会偶尔返回格式错误
- **域名 warmup**：4-8 周，不能跳过直接发 500 封
- **GDPR 被遗忘权**：删除 company 时必须级联删除 contacts、scores、profiles、email_sends
- **多租户隔离**：每个查询必须带 `tenant_id` 过滤，用 Drizzle 的 `.$onFilter` 或中间件统一注入

## 11. AI 协作建议

- **修改前必读 spec.md 对应章节**，避免跑偏
- **架构改动先讨论**：不要擅自把 Hono 换成 Express、Drizzle 换成 Prisma
- **给 AI 任务时明确范围**：例如"在 apps/scorer 加打分路由"，不要说"实现打分功能"
- **每次改完跑测试**：`bun test` 或 `pnpm test`
- **遇到不确定的合规问题**：停下来问用户，不要擅自决定绕过 LinkedIn/邮件规则
- **遇到需要 brew 安装的依赖**：停下来让用户手动安装（如 Playwright 浏览器、Redis）

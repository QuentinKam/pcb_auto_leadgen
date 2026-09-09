# Spec：PCB外贸AI自动获客Agent（独立产品）
## 模块清单（解耦，单独打包交付）
1. 数据源采集层
    - 搜索引擎企业信息抓取、企业官网信息解析、领英人物信息提取
    - 输出结构化数据：公司名、官网、行业、产品、联系人、职位、邮箱
2. 线索评估Agent（核心）
    - LLM提取业务特征，匹配PCB/PCBA需求关键词
    - 打分模型输出0-100分，自动分级A/B/C，附带打分理由
3. 客户画像生成
    - 摘要客户业务、产品，判断是初创硬件、工业设备、消费电子等
4. 内容生成Agent
    - 根据客户画像，动态生成个性化英文开发信/领英消息
    - 支持多版本A/B文案，记录版本效果
5. 邮件发送调度器
    - 邮箱轮询、发送间隔控制、防垃圾邮件策略
    - 状态记录：待发送/已发送/打开/回复/退信
6. Web后台看板
    - 线索列表、筛选、搜索
    - 统计仪表盘：线索总量、A级线索、发送统计、回复率
    - 手动干预入口：业务员可以编辑、标记、导出线索
7. API层：预留接口，后续可对接邮件回复、报价模块（选配）

## 技术约束
- 爬虫遵守robots协议，不高频暴力抓取；邮箱发送遵循反垃圾规则
- 数据本地/客户侧部署可选，客户线索数据隔离
- MVP优先最小可用，先跑通线索挖掘+打分+邮件生成，再迭代自动化发送

## 交付物
- Web后台系统
- 线索数据库
- 配置面板（关键词、行业过滤、邮件模板规则）
- 数据报表导出功能

## 8. 系统架构（全 Bun 微服务化）

### 架构分层
```
看板前端 (Hono + Vite + React 19)   ← SPA + TanStack Query
        ↕ REST (zod 校验)
API 网关 (Hono on Bun)               ← 鉴权 / 限流 / 聚合
   ↕           ↕           ↕
采集服务    打分服务    邮件服务     ← 三个独立微服务
Crawlee     AI SDK      Resend
Playwright  Claude      BullMQ
BullMQ worker           Webhook
   ↕           ↕           ↕
PostgreSQL 17 + Redis + Cloudflare R2 (共享)
```

### 服务职责
- **看板前端 (dashboard)**：Hono on Bun + Vite 6 + React 19 + shadcn/ui，线索列表、统计、编辑、导出
- **API 网关 (gateway)**：Hono on Bun，JWT 鉴权、速率限制、聚合 3 个微服务响应
- **采集服务 (collector)**：Hono on Bun + Crawlee + Playwright，BullMQ worker 长任务爬取
- **打分服务 (scorer)**：Hono on Bun + Vercel AI SDK + Claude，LLM 提取特征 + 规则打分
- **邮件服务 (mailer)**：Hono on Bun + Resend + BullMQ，发送调度 + webhook 回收状态

### 统一 Bun 栈的理由
- 全栈一致：运行时、包管理、部署策略全统一，无 Vercel/Node 混部
- 常驻进程：BullMQ worker、Playwright、warmup 都需要常驻，Serverless 超时不能用
- 故障隔离：爬虫崩不影响看板可用
- 独立扩展：采集高并发时单独加副本
- 独立部署：每个服务独立 CI/CD

### Monorepo 结构
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

### 服务间通信
- 同步：REST + zod schema 校验（packages/types 共享）
- 异步：Redis Pub/Sub + BullMQ 任务队列
- 事件流：采集完成 → 入队打分 → 入队生成内容 → 入队发送

## 9. 技术栈选型（2026 最佳实践，全 Bun）

### 看板前端
- Hono on Bun（静态服务 + API 代理）
- Vite 6（开发 HMR + 生产构建）
- React 19 + TypeScript 5.x
- shadcn/ui + TailwindCSS v4
- TanStack Query（客户端数据获取/缓存）
- TanStack Router（类型安全路由）

### 后端微服务（统一栈）
- 运行时：**Bun**（原生 TS、性能、内置测试）
- Web 框架：**Hono**（轻量、跨运行时、zod 类型安全）
- ORM：**Drizzle ORM**（类型安全、SQL 优先）
- 队列：**Redis + BullMQ**（任务排队、重试、延迟）

### 共享基础设施
- 数据库：**PostgreSQL 17**（本地 / Supabase 云端，多租户 row-level security）
- 缓存/队列：Redis（Upstash 或自建）
- 对象存储：Cloudflare R2（爬虫产物 HTML/PDF、附件）
- LLM：Vercel AI SDK + Anthropic Claude（主）+ OpenAI（备）
- 邮件：Resend（生产）+ Mailtrap（开发测试）
- 爬虫：Crawlee + Playwright + Bright Data 代理 IP 池
- 监控：Sentry（错误）+ Axiom（日志/指标）+ Better Stack（uptime）

### 工程化
- 包管理：**pnpm + npmmirror.com 中国镜像**（禁用 npm/yarn）
- Monorepo：pnpm workspaces + Turborepo（构建缓存）
- 代码规范：**Biome**（替代 ESLint+Prettier，更快）
- Git Hook：**lefthook**（替代 husky，更快）
- CI/CD：GitHub Actions → Fly.io（全栈统一部署）
- 部署：Fly.io（每个 app 一个 app，共享 Volume）

## 10. 法律合规清单
- **LinkedIn**：人在环半自动化，**不做批量自动抓取/私信**；Sales Navigator 导出 CSV → 系统导入 → 文案人工复制粘贴发送
- **GDPR**（主攻欧洲）：数据保留期 24 个月、被遗忘权 API、LIA 合法利益评估文档、B2B 直接邮件援引合法利益
- **CAN-SPAM**：每封含 unsubscribe 链接、发件人物理地址、退订请求 10 个工作日内生效
- **数据隔离**：多租户 row-level security，租户间物理逻辑隔离
- **robots.txt**：遵守目标站点爬取规则，不高频暴力抓取，间隔 ≥ 2s
- **邮箱合规**：仅采集公开企业邮箱，不发送未授权个人邮箱

## 11. 邮件可达性基础设施
- **域名认证**：SPF / DKIM / DMARC（p=quarantine 起步，3 个月后升 p=reject）
- **多发送域名**：3-5 个域名轮询，每个 warmup 4-8 周
- **独立 IP**：起步共享 1 个，月发送 >50k 升级独占 IP
- **发送配额**：每发件邮箱日发 ≤50 封，每域名日发 ≤500 封
- **监控**：Google Postmaster Tools + Microsoft SNDS，reputation < 80 自动暂停
- **退信处理**：硬退信立即拉黑，软退信 3 次后拉黑
- **投诉处理**：complaint rate > 0.1% 自动暂停该域名
- **warmup**：Mailwarm 或自建脚本（向种子邮箱逐步增量发送）

## 12. 打分模型（0-100 分）

| 维度 | 权重 | 信号 |
|---|---|---|
| 行业匹配度 | 30% | 硬件/工业设备/医疗器械/汽车电子/消费电子/航空航天 |
| PCB 关键词密度 | 25% | 官网/产品页 PCB、PCBA、assembly、fabrication 词频 |
| 岗位决策权 | 20% | 采购经理/硬件工程师/项目经理 > 普通工程师 |
| 公司规模信号 | 15% | 员工 50-500、近 12 个月融资或新品发布 |
| 触达可达性 | 10% | 邮箱验证通过率 + LinkedIn 可达 |

- 分级：A ≥ 75 / B 50-74 / C < 50
- 人工校准：业务员可手动改级，系统记录覆盖原因，作为模型迭代训练样本
- 模型版本：v1 规则加权 → v2 接入 LLM 打分 → v3 微调小模型

## 13. 数据源清单

| 数据源 | 用途 | 类型 | 单条成本 |
|---|---|---|---|
| Google Search | 企业发现 | 免费（API 付费） | $0 |
| Apollo.io | 企业 + 联系人 | 订阅 $49/mo | ~$0.05 |
| Crunchbase | 公司融资/规模 | 订阅 | ~$0.10 |
| Hunter.io | 邮箱验证 | 订阅 $49/mo | ~$0.02 |
| Clearbit | 公司 enrich | 订阅 | ~$0.05 |
| LinkedIn Sales Navigator | 决策人（人工） | 订阅 $99/mo | 人工 |
| Resend | 邮件发送 | 按量 | $0.001/封 |
| Bright Data / 代理 IP | 爬虫反检测 | 按流量 | ~$0.02/线索 |

## 14. MVP 三阶段拆分

### P1（2-3 周）：采集 + 打分 + 看板
- apps/dashboard：Hono + Vite + React 看板骨架，线索列表/筛选/A-B-C 统计/手动改级
- apps/collector：Google + Apollo 数据源接入，Crawlee 爬企业官网
- apps/scorer：打分模型 v1（规则加权）
- apps/gateway：基础鉴权 + REST 路由聚合
- 不发邮件，先验证线索质量

### P2（2-3 周）：个性化内容 + 人工审核单发
- apps/scorer 新增：客户画像 Agent（读官网/产品生成摘要）
- apps/scorer 新增：内容生成 Agent（开发信 + LinkedIn 私信，A/B 双版本）
- apps/dashboard 新增：内容审核界面
- 人工审核后单条发送，记录文案版本

### P3（2-3 周）：自动化调度 + 效果追踪
- apps/mailer：邮件发送调度器（域名轮询、间隔控制、warmup）
- apps/mailer：Resend webhook 回收打开/回复/退信状态
- apps/dashboard：回复率看板、ROI 计算、CSV 导出

## 15. 数据库 Schema 草案（Drizzle）

P1 阶段必需表：
- tenants（多租户隔离）
- users（业务员账号 + 角色：admin/sales/viewer）
- keywords（关键词与行业过滤配置）
- companies（企业库：名称、官网、行业、规模、融资）
- contacts（联系人：邮箱、职位、LinkedIn URL、验证状态）
- lead_scores（打分记录 + 维度明细 + 理由 + 模型版本）

P2 阶段追加：
- profiles（客户画像：业务摘要、产品类型、客户类型标签）
- email_templates（模板 + A/B 版本 + 变量占位符）

P3 阶段追加：
- email_campaigns（发送批次：域名、配额、状态）
- email_sends（单条发送：to/subject/body/state）
- email_events（事件流：sent/delivered/opened/replied/bounced/complained）

贯穿全程：
- audit_logs（人工改级、编辑、导出操作审计）

## 16. 单位经济模型（每条 A 级线索）

- LLM 调用（采集 + 画像 + 打分 + 生成）：~$0.10/线索
- 数据源 API（Apollo + Hunter + Clearbit）：~$0.15/线索
- 邮件发送（5 次触达 × $0.001）：~$0.005/线索
- 代理 IP + 爬虫：~$0.02/线索
- 合计：~$0.30/线索

- 转化漏斗假设：100 原始线索 → 30 A 级 → 5 回复 → 1 询盘
- A 级线索成本：~$1.00；询盘成本：~$30

- SaaS 定价：$199/mo 含 200 条 A 级线索，超额 $1.5/条
- 项目交付：一次性 $8k-15k + 月度运维 $500/mo

## 17. 部署成本（生产）

| 资源 | 月成本 |
|---|---|
| Fly.io（5 个 app × shared-cpu-1x 256MB） | ~$25 |
| Supabase（Postgres Pro） | $25 |
| Upstash Redis | ~$10 |
| Cloudflare R2 | ~$5 |
| Resend | $20 起 |
| Sentry + Axiom | $26 起 |
| **合计** | **~$111/mo** |

种子客户 1 家可覆盖，5 家 SaaS 订户即盈利

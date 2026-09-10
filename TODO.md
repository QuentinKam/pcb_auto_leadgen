# PCB 获客 Agent — 三阶段进度总看板（2026-09-10）

> 范围：PCB 外贸 AI 自动获客 Agent 独立产品。总三阶段 MVP：P1（采集+打分+看板）✅、P2（画像+内容+审核）✅、P3（邮件调度+效果追踪）⬜。
>
> 关联项目：
> - 主产品（本仓库）：PCB 外贸获客 Agent = 文档「项目 1」
> - 配套项目：`/Users/quentingam/Documents/aigc_base_knowledge`（ContentForge）= 文档「项目 5」内容智能体
>
> AI 接手必读（下次 AI 进项目自动加载）：`~/.trae/memory/projects/-Users-quentingam-Documents-pcb--p2-515c39674f361c860b5f/project_memory.md`

---

## 一、设计目标

### 1.1 P2 要解决的问题
P1 已完成线索采集 + 打分 + 看板，但 A/B 级线索还停留在"知道是谁"，没有"怎么触达"。P2 补上：
- **客户画像 Agent**：把官网/产品描述变成结构化画像，让内容生成有依据
- **内容生成 Agent**：根据画像 + 联系人 + 打分，生成个性化英文开发信和 LinkedIn 私信，A/B 双版本
- **内容审核界面**：dashboard 新增审核页，业务员确认后单条发送（P3 做批量调度）

### 1.2 不做（边界）
- 不自动批量发送（P3 才做调度）
- 不接询盘回复、不做自动报价（intent.md 已明确排除）
- 不做 1:N 公域内容生产（那是 ContentForge 的事，见 §五）

---

## 二、模块架构

### 2.1 目录结构

```
apps/scorer/src/
├── scoring/              # 已存在：打分模型
└── content/              # 新增：P2 内容生成
    ├── types.ts          # 类型定义
    ├── profile.ts        # 客户画像 Agent
    ├── generator.ts      # 内容生成主入口（模板分发）
    ├── llm.ts            # LLM 调用封装（Bun fetch 直连 Anthropic）
    ├── templates/
    │   ├── base.ts       # 模板基类 + system prompt 约束
    │   ├── cold-email.ts # 开发信模板
    │   ├── linkedin-dm.ts# LinkedIn 私信模板
    │   └── industry-blog.ts  # 行业博客模板（OPC 叙事预留）
    └── routes/content.ts # Hono 路由：/content/profile、/content/generate
```

### 2.2 数据模型（DB Schema 扩展）

P2 需在 `packages/db` 新增两张表：

**profiles 表**（客户画像）
- id, tenant_id, company_id
- business_summary: text
- product_types: text[]
- customer_type: varchar
- pain_points: text[]
- buying_signals: text[]
- model_version: varchar
- created_at, updated_at

**content_drafts 表**（内容草稿）
- id, tenant_id, company_id, contact_id
- format: 'cold_email' | 'linkedin_dm' | 'industry_blog'
- variant: 'A' | 'B'
- subject: text
- body: text
- status: 'generated' | 'approved' | 'rejected' | 'sent'
- profile_id: uuid
- used_facts: text[]
- gaps: text[]
- model: varchar
- approved_by, approved_at
- created_at

### 2.3 接口设计

**客户画像 Agent**
```
POST /content/profile/:companyId
输入：companyId
输出：Profile（写入 profiles 表）
```

**内容生成 Agent**
```
POST /content/generate
输入：{ companyId, contactId, format, variant?, tone? }
输出：ContentResult（写入 content_drafts 表）
```

### 2.4 模板架构

核心思路：一个 `ContentTemplate` 基类 + 多个模板子类，LLM 调用统一封装，差异只在 prompt 组装。

各模板差异：

| 模板 | format | 长度 | 个性化重点 | A/B 变体差异 |
|---|---|---|---|---|
| cold-email | cold_email | 150-250 词 | 客户产品 + PCB 需求匹配 | A：痛点切入；B：案例/数据切入 |
| linkedin-dm | linkedin_dm | 60-120 词 | 联系人职位 + 共同话题 | A：提问式；B：资源分享式 |
| industry-blog | industry_blog | 600-1000 词 | 行业趋势 + PCB 选型建议 | A：技术深度；B：采购决策视角 |

---

## 三、与 ContentForge 的协作

### 3.1 定位差异

| 维度 | pcb_auto_leadgen P2 | ContentForge |
|---|---|---|
| 触达方式 | 1:1 个性化触达 | 1:N 公域内容 |
| 输入 | 客户画像 + 联系人 + 打分 | 行业选题 + 知识库事实包 |
| 质量门禁 | 轻（防编造） | 重（FactChecker + GEOChecker） |
| 技术栈 | Bun + TS | Python |

### 3.2 复用策略

- PCB 行业知识库共享：ContentForge 的 `facts.json` 作为 P2 生成开发信时的行业事实源
- 防编造约束复用：system prompt 照搬 ContentForge 的 `SYSTEM_CONSTRAINT` 思路
- 品牌档案共享：ContentForge 的 `brand.md` 同时作为 P2 开发信的品牌素材来源

---

---

## 四、三阶段总进度

### P1（采集 + 打分 + 看板）✅ 完成
- [x] collector 微服务骨架（apps/collector）
- [x] scorer 打分模型 v1：规则加权（5 维度 industry/keywords/role/size/reachability，A/B/C 分级）
- [x] lead_scores / companies / contacts / tenants 等 P1 核心表 + 迁移
- [x] Gateway：/api/lead-scores、/api/companies、/api/tenants
- [x] Dashboard LeadsPage：统计卡 + 等级筛选 + 分页列表 + 人工覆盖弹窗

### P2（客户画像 + 个性化内容 + 内容审核）✅ 完成
- [x] Step 1：DB Schema 扩展（profiles 表 + content_drafts 表 + drizzle 迁移 + index.ts 导出）
- [x] Step 2：客户画像 Agent（`apps/scorer/src/content/profile.ts` + 类型 + 路由 + 测例）
- [x] Step 3：模板基类 + 开发信模板（`base.ts` + `cold-email.ts` + `generator.ts` + `llm.ts`）
- [x] Step 4：LinkedIn 私信模板（`templates/linkedin-dm.ts`）+ 行业博客模板（`templates/industry-blog.ts`）
- [x] Step 5：Dashboard 内容审核页
  - [x] Gateway /api/content 代理（apps/gateway/src/routes/content.ts）
  - [x] Dashboard api.ts 新增 content 方法 + 类型
  - [x] ContentReviewPage.tsx：三栏 + A/B 并排 + 批准/驳回/编辑/标记已发送
  - [x] App.tsx：TabBar 切换（线索看板 ↔ 内容审核）
- [x] Step 6：ContentForge facts.json 对接
  - [x] `apps/scorer/src/content/facts-loader.ts`（facts 加载 + 匹配 + 缓存 + format 裁剪）
  - [x] 生成内容时注入 industryFacts 到模板上下文（替换空数组 TODO）
  - [x] [F-xxx] 引用标记追踪 + [data gap] 缺口提取（base.ts parseOutput 扩展）
- [x] Step 7：联调 + 防编造验证（facts-loader 单测 + 审核页端到端流程走通）

### P3（自动化邮件调度 + 效果追踪）✅ 完成 —— 2026-09-10
- [x] P3-1 DB Schema 扩展（0.5 天）—— 2026-09-10
  - [x] 新增 email_campaigns 表（活动，含 23 列，is_warmup 标记、统计指标、状态机）
  - [x] 新增 email_sends 表（单条发送，31 列，含 resend_message_id / sending_domain / 状态 / 重试次 / 各时间戳计数）
  - [x] 新增 email_events 表（Resend webhook 事件，15 列，delivered/opened/clicked/bounced/complaint + 原始 payload）
  - [x] drizzle-kit generate 生成 0002_complete_dust.sql 迁移（共 12 张表）
  - [x] 2026-09-10 已跑 `pnpm --filter @pcb/db migrate`，本地 pcb_leadgen DB 表从 9 张（P1）+ 2 张（P2）→ 12/12 张齐，drizzle.__drizzle_migrations 记录 0002 id 写入成功
- [x] P3-2 Mailer 服务（2-3 天）—— 2026-09-10（P3-2.5 完成）
  - [x] apps/mailer 接入 Resend SDK + BullMQ（@pcb/queue 共享）
  - [x] sends 路由：单条发送 / 批量入队 / 状态查询 / 取消
  - [x] BullMQ send-worker：常驻进程，Resend 调用 + 3 次重试 + 错误处理
  - [x] 配额控制器：每域名 500 封/日、每发件邮箱 50 封/日（Redis 计数器 + 内存 fallback）
  - [x] Resend webhook：签名校验 → 写 email_events + 活动计数器累加 + 投诉率阈值告警
  - [x] Gateway /api/mails 代理（超时 60s，svix headers 透传）
  - [x] 发件池轮询（sender-pool）+ unsubscribe footer 注入（GDPR）
- [x] P3-3 域名 warmup 策略（1 天）—— 2026-09-10
  - [x] 4-8 周 warmup 增量计划表（第 1 天 5 封 → 第 8 周 500 封，内置 46 档梯度，weekday-only，按 elapsed+absoluteDay 双索引）
  - [x] 种子邮箱队列（WARMUP_SEED_EMAILS JSON 数组 env 配置，100+ 自有真实邮箱最佳，pickSeedEmails 轮询填充目标数）
  - [x] warmup worker：独立 BullMQ Queue + Worker，每日 cron（WARMUP_DAILY_CRON 默认 UTC 2am）→ processDailyWarmup → 按目标数派单 → processWarmupSend（走 quota + senderPool 轮询 + 3 variant body + 写 email_campaigns is_warmup=true + email_sends）
  - [x] mock 模式自动模拟 open/click 交互：WARMUP_SIM_OPEN_RATE 0.75 + WARMUP_SIM_CLICK_RATE 0.35，延迟区间 WARMUP_SIM_DELAY_MIN/MAX_MS（默认 1min-15min 随机），直接回写 email_sends 状态 + bumpCampaignCounters
  - [x] warmup 路由：/warmup/status（今日目标/已发/剩余 + seedPool + 域名 + campaignStats + reputationScore 0-100 + queue counter）+ /warmup/plan（近期14天计划表）+ /warmup/recent（最近50条 warmup 发送记录）+ /warmup/trigger（手动触发 可 seedEmails/countOverride）+ /warmup/reschedule
  - [x] /health 已挂 warmup info（enabled/startDate/elapsedDays/todaysTarget/seedPoolSize/domains）；package.json 新增 warmup / start:warmup 脚本；.env.example 新增 9 项 warmup 配置注释
- [x] P3-4 Dashboard 发送看板（1-2 天）—— 2026-09-10
  - [x] 新增 gateway contacts 路由：/api/contacts/first-by-company/:id（发送前查公司下第一个有效邮箱联系人）
  - [x] 新增 mailer /stats + /campaigns 路由（stats-and-campaigns.ts），dashboard 通过 gateway /api/mails/* 代理
  - [x] api.ts 新增 mailApi（getStats/listCampaigns/listSends/enqueueSingle/getWarmupStatus/...）+ contactsApi 类型和方法
  - [x] CampaignsPage：7 张统计卡（总发送/送达/打开/回复/硬退/软退/投诉率）+ 域名 warmup 状态卡（今日目标×已发 + reputation 0-100 + BullMQ queue 计数）+ 活动列表（含 warmup 活动区分）
  - [x] EmailSendsPage：12 种状态筛选 + 单条发送列表（收件人/主题预览/域名/开点计数/时间戳）+ 取消排队发送 + 分页 + 每 30s 自动刷新
  - [x] ContentReviewPage：DraftCard「标记已发送」替换为「批准并发信」按钮（generated/approved → approved → getFirstContactByCompany → enqueueSingle → sent），错误 red banner 提示
  - [x] App.tsx TabBar 新增 2 个 Tab：发送看板（CampaignsPage）、发送记录（EmailSendsPage），共 4 Tab
- [x] P3-5 合规 & 监控（0.5 天）—— 2026-09-10
  - [x] 邮件模板强制带 unsubscribe 链接（resend-client.send() 内部调用 injectUnsubscribeFooter，HTML 插 </body> 前，Text 末尾分隔线，HMAC-SHA256 token 防篡改，env INJECT_UNSUBSCRIBE 开关）
  - [x] complaint rate > 0.1%（可配置）：handleComplaintThreshold 实际调用 suspendDomain() → Redis key pcb:mailer:suspended:domain:<domain> TTL 7天 → send-worker checkAndConsumeDomainQuota 检测 suspended 直接 return blocked 状态；内存 fallback Set 同步写入
  - [x] 硬退信 → handleBounceBlacklist 直接 contacts.active=false；软退信累计 SOFT_BOUNCE_BLACKLIST_THRESHOLD（默认3）次 → 拉黑 contact
  - [x] .env.example 补 SOFT_BOUNCE_BLACKLIST_THRESHOLD=3 注释
  - [x] GDPR 删除公司时级联删 email_sends / email_events（PG FK cascade on delete 在 drizzle schema 已配 tenantFk / companyFk / contactFk .onDelete('cascade')，DB 级级联已覆盖）

---

## 五、P2 设计与落地细节（原 Section 三、四保留）

### 5.1 模块架构

#### 目录结构

```
apps/scorer/src/
├── scoring/              # 已存在：打分模型
└── content/              # P2 内容生成
    ├── types.ts          # 类型定义
    ├── profile.ts        # 客户画像 Agent
    ├── generator.ts      # 内容生成主入口（模板分发）
    ├── llm.ts            # LLM 调用封装（Bun fetch 直连 Anthropic / OpenAI 兼容）
    ├── facts-loader.ts   # ContentForge facts.json 加载 + 匹配（按画像关键词加权）
    ├── templates/
    │   ├── base.ts       # 模板基类 + system prompt 约束 + [F-xxx]/[data gap] 解析
    │   ├── cold-email.ts # 开发信模板（A/B）
    │   ├── linkedin-dm.ts# LinkedIn 私信模板（A/B）
    │   └── industry-blog.ts  # 行业博客模板
    └── routes/content.ts # Hono 路由：/content/profile、/content/generate、/content/drafts
```

#### 模板差异总览

| 模板 | format | 长度 | 个性化重点 | A/B 变体差异 | facts 注入数量 |
|---|---|---|---|---|---|
| cold-email | cold_email | 150-250 词 | 客户产品 + PCB 需求匹配 | A：痛点切入；B：案例/数据切入 | ≤ 5 条 |
| linkedin-dm | linkedin_dm | 60-120 词 | 联系人职位 + 共同话题 | A：提问式；B：资源分享式 | ≤ 3 条 |
| industry-blog | industry_blog | 600-1000 词 | 行业趋势 + PCB 选型建议 | A：技术深度；B：采购决策视角 | ≤ 10 条 |

#### facts.json 匹配机制
- **路径**：默认读 `aigc_base_knowledge/contentforge/workspaces/pcb/registry/facts.json`（`FACTS_JSON_PATH` 可覆盖）
- **分类优先级**：market_data=3 分，decision/qa=2 分，standard/param/process=1 分，misc=0 分
- **关键词加分**：产品/痛点/行业字段命中 +2，customerType 行业词库（汽车/医疗/AI 服务器等 9 类）命中 +3
- **新鲜度**：有年份 +1，2024+ 再加 +1
- **质量门槛**：cutoff*0.3 以下结果过滤，避免冷匹配

#### [F-xxx] 引用 + [data gap] 防编造闭环
1. LLM system prompt 要求：引用事实时在句末加 `[F-016]`；缺数据写 `[data gap: need XX]`，禁止编造
2. `base.ts parseOutput` 正则提取 usedFacts + gaps，stripFactMarkers 从正文去掉 [F-xxx]（避免客户看到内部标记）
3. Dashboard 审核页：usedFacts 显示为徽章；gaps 红字提示

### 5.2 与 ContentForge 的协作（原 Section 三）

#### 定位差异

| 维度 | pcb_auto_leadgen P2 | ContentForge |
|---|---|---|
| 触达方式 | 1:1 个性化触达 | 1:N 公域内容 |
| 输入 | 客户画像 + 联系人 + 打分 | 行业选题 + 知识库事实包 |
| 质量门禁 | 轻（防编造 + [data gap]） | 重（FactChecker + GEOChecker） |
| 技术栈 | Bun + TS | Python |

#### 复用策略
- PCB 行业知识库共享：ContentForge 的 `facts.json` 作为 P2 生成开发信时的行业事实源
- 防编造约束复用：system prompt 照搬 ContentForge 的 `SYSTEM_CONSTRAINT` 思路
- 品牌档案共享：ContentForge 的 `brand.md` 同时作为 P2 开发信的品牌素材来源（P2 `getBrandInfo` 从 env 取）

### 5.3 OPC 申报叙事对接（原 Section 五）

#### 三项目闭环图

```
ContentForge（内容智能体 - 文档项目 5）
  PCB 知识库 → 行业博客/FAQ/短视频 → 公域引流 + AI 引用
           │
           ▼ 客户搜索/AI 推荐找上门
pcb_auto_leadgen（获客 Agent - 文档项目 1）
  线索采集 → AI 打分(A/B/C) → 客户画像 → 个性化触达 → P3 自动发送 → 效果追踪
           │
           ▼ 询盘转化
      订单/合作
```

---

## 六、OPC 申报材料组织（原 Section 五.二）

1. 项目概述（1 页）
2. 技术架构（1 页）
3. 核心功能演示（2-3 页）
   - P1：打分看板（A/B/C 分级）+ 人工覆盖
   - P2：内容审核页（画像 + A/B 内容并排 + 审批流 + 事实引用徽章）
   - P3（预期）：发送看板 + warmup 状态卡
4. 差异化壁垒（1 页）
   - ContentForge 知识库复用（facts.json 59 条行业事实 + 防编造）
   - 三项目闭环：内容智能体获流 → 获客 Agent 转化 → 询盘
5. 商业模式（1 页）
6. 合规与安全（0.5 页）：GDPR 数据缺口机制 / LinkedIn TOS 合规 / 邮件 unsubscribe

---

## 七、风险与对策

| 风险 | 对策 | 当前状态 |
|---|---|---|
| LLM 编造 PCB 行业数据 | system prompt 硬约束 + 事实包注入 + `[data gap]` 标记 + 审核页红字提示 | ✅ 已落地（facts-loader + base.ts parseOutput） |
| 开发信同质化 | A/B 变体（开发信 A=痛点切入，B=案例/数据切入）+ 客户画像 5 维个性化 | ✅ 已落地（cold-email.ts） |
| 跨项目知识库不同步 | facts.json、brand.md 共享，ContentForge 维护，P2 只读（FACTS_JSON_PATH 可覆盖） | ✅ 已落地（facts-loader） |
| 邮件域名 reputation 差导致进垃圾箱 | 4-8 周 warmup 增量计划 + 种子邮箱 + 域名/邮箱配额 | ✅ 已落地（warmup-config + warmup-worker + 配额控制） |
| 投诉率过高封号 | Resend webhook 实时收 complaint，>0.1% 自动暂停该域名 | ✅ 已落地（webhook handleComplaintThreshold + quota suspendDomain + send-worker blocked 拦截） |

---

## 八、静态验证 & 用例结果（2026-09-10）

### 8.1 lint + build ✅
- [x] Biome lint：112 文件扫描通过（3 条 a11y 建议，不阻塞构建）
- [x] `pnpm build`：4/4 packages 全绿（@pcb/gateway / @pcb/scorer / @pcb/mailer / @pcb/dashboard）
  - 顺带修：apps/dashboard/tsconfig.app.json 加 `"ignoreDeprecations":"6.0"` 消 TS5101 baseUrl deprecated
  - 顺带修：apps/dashboard/src/pages/CampaignsPage.tsx 删未用 MailStatsResponse import 消 TS6133

### 8.2 单元测试 ✅ 78/78 pass, 0 fail
- [x] @pcb/types：16/16（zod schema 校验）
- [x] @pcb/db：3/3
- [x] @pcb/scorer：42/42（打分模型 + content/generator/facts-loader + profile）
  - 顺带修：apps/scorer/.env 补 `FACTS_JSON_PATH=/Users/quentingam/Documents/aigc_base_knowledge/contentforge/workspaces/pcb/registry/facts.json`，跨项目 facts.json 读不到 → 42/42 全绿
- [x] @pcb/gateway：17/17（路由 handler 单测）
- [x] @pcb/mailer / @pcb/dashboard：暂无 .test.ts，package.json 改 `bun test --pass-with-no-tests`（连字符，下划线参数无效）

### 8.3 DB 迁移 0002 ✅
- [x] PostgreSQL 5432 运行中（pg_isready OK），Redis 6379 运行中（PONG OK）
- [x] `pnpm --filter @pcb/db migrate` 跑 0002_complete_dust.sql 成功
- [x] 结果：12/12 张表就位（tenants / users / keywords / companies / contacts / lead_scores / audit_logs + profiles / content_drafts + email_campaigns / email_sends / email_events）

---

## 九、运维脚本 & 一键启动（2026-09-10）

### 优先级 A：端到端联调一键化
- [x] 根目录 `start.command`（双击可运行，macOS 专用）：前置校验 PG+Redis+pnpm+bun → 5 个 Terminal Tab 并行启动 gateway/scorer/mailer:dev/mailer:worker/dashboard → 自动打开 http://localhost:5173；异常时有明确修复指引
- [x] `scripts/health-check.sh`：10 项健康检查（PG/Redis/4 服务 HTTP 200 + /warmup/status reputation 色阶 + seedPool 预警），jq 可读时打印关键字段，非 jq 时降级原始 JSON

### 优先级 B：Resend warmup 启动辅助
- [x] 根目录 `warmup-start.command`：前置读取 mailer/.env 逐字段校验（RESEND_KEY 占位符识别 / DEFAULT_SENDING_DOMAIN=your-domain 拦截 / FROM_COUNT / SEED_COUNT<10 提醒）→ 检查 mailer:3003 已就绪 → 新开 Tab 启动 warmup-worker → 立即调用 /warmup/status 打印今日目标 + reputation + seedPool
- [x] warmup 手动触发 curl 模板嵌在脚本末尾输出（countOverride=5 小规模试跑 + /plan + /recent）

---

## 十、验收标准（P1+P2 ✅ 通过）

- [x] 客户画像 Agent 能提取产品类型、客户类型、痛点（profile.ts）
- [x] 开发信 A/B 版本有明显差异，且引用客户具体业务 + 事实数据（cold-email.ts + facts-loader）
- [x] 防编造：诱导 LLM 写不存在的数字时输出 `[data gap: XX]`，审核页红字提示（base.ts systemConstraint + ContentReviewPage）
- [x] LinkedIn 私信 ≤ 120 词，口语化，无硬广（linkedin-dm.ts）
- [x] dashboard 审核页可批准/驳回/编辑 subject+body/标记已发送（ContentReviewPage）
- [x] 行业博客模板能基于 PCB 知识库生成英文长文（industry-blog.ts + facts-loader top 10 注入）

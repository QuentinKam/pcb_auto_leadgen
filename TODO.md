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
- [x] 2026-09-10 补：@pcb/mailer 新增 resend-client.test.ts 3 用例（SDK {data,error} 形态映射 + tag 清洗），全绿

### 8.3 DB 迁移 0002 ✅
- [x] PostgreSQL 5432 运行中（pg_isready OK），Redis 6379 运行中（PONG OK）
- [x] `pnpm --filter @pcb/db migrate` 跑 0002_complete_dust.sql 成功
- [x] 结果：12/12 张表就位（tenants / users / keywords / companies / contacts / lead_scores / audit_logs + profiles / content_drafts + email_campaigns / email_sends / email_events）

### 8.4 Warmup 发信问题排查修复（2026-09-10）✅
- [x] Bug 1：email_sends.company_id / contact_id NOT NULL，warmup 无 company/contact → 36 个任务 insert 全挂。修：schema 改 nullable + drizzle-kit generate 0003_medical_night_thrasher.sql + migrate 成功
- [x] Bug 2：resend-client.ts 未处理 Resend SDK v4 的 `{ data, error }` 返回形态，API 报错（403 域名未验证）被记成 status=sent。修：error 分支透出 errorMessage，TDD 3 用例全绿
- [x] Bug 3：warmup tag `{name:'domain', value:'rakuto.store'}` 含点号 → Resend Tags ASCII 校验失败。修：resend-client.send() 出口统一清洗 tag 为 `[A-Za-z0-9_-]`（点→`-`），带测试用例
- [x] 修复后 trigger 端到端验证：DB 正确记录 status=failed + last_error=403 rakuto.store not verified → **待用户在 Resend Dashboard 完成 rakuto.store 域名 DNS 验证后，warmup 即可真实发信**

### 8.5 Warmup 占位 company/contact 改为 env 可配置（2026-09-10）✅
- [x] 恢复 email_sends.company_id/contact_id NOT NULL（0004_spicy_rocket_racer.sql 已迁移），warmup 发送改为挂占位记录：ensureWarmupCompanyAndContact 按 website find-or-create 占位公司 + 按种子邮箱 find-or-create 占位联系人
- [x] 新增 3 个 env 配置：WARMUP_COMPANY_NAME（占位公司名，默认 "Warmup Test Company (<域名>)"）+ WARMUP_COMPANY_WEBSITE（占位公司网站=find-or-create 识别键，默认取发送域名）+ WARMUP_CONTACT_NAME_PREFIX（联系人名前缀，默认 "Warmup Seed"），已写入 .env / .env.example
- [x] 端到端验证：trigger 后 companies / contacts 表正确生成占位记录，email_sends.company_id/contact_id 正确关联（发送仍失败仅因 rakuto.store 未在 Resend 验证）
- ⬜ 遗留（未修，超出本次范围）：apps/mailer `tsc --noEmit` 有约 20 个历史类型错误（warmupConfig.plan 私有被 routes/index 引用、routes/warmup.ts SUM 结果 `{}` 类型等）；bun build 不做类型检查所以之前"build 全绿"未暴露，运行时不受影响

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

---

## 十一、客户演示套件（2026-09-10）✅

> 目标：把项目**从容优雅**地演示给三类对象（潜在买家 / 终端国外客户 / 投资人评审）。
> 现场原则：不空屏、不等生成、不赌网络。

### 11.1 演示前必修的三个硬伤（本次实测发现）
- [x] **租户不一致（致命）**：`apps/dashboard/.env` 的 `VITE_TENANT_ID=d7ac80b9-…` 与库里数据租户 `00000000-…` 不一致，且 `VITE_USER_ID=12aaa8ac-…` 在 users 表不存在 → **看板四个 Tab 全空 + 人工覆盖报错**。修：两个 ID 对齐为 DB 种子租户/用户（`apps/dashboard/.env` + `.env.example` 同步加注释说明）
- [x] **点公司即触发 LLM（体验杀手）**：ContentReviewPage 的画像 `useQuery` 调的是 `POST /content/profile/:companyId`，而该接口**每次都真调 LLM**（非幂等），切一次公司等十几秒，失败则显示"请先点击重新画像"。修：新增 `GET /content/profile/:companyId` 只读接口（scorer + gateway），前端改用 `api.getProfile()`，`重新画像` 按钮保留 POST
- [x] **「批准并发信」直接 500（高光环节翻车）**：`apps/gateway/src/routes/contacts.ts` 用了不存在的 `isNull(contacts.email).not()`（Drizzle 无 `.not()`）→ `first-by-company` 抛 `TypeError`。修：改用 `isNotNull(contacts.email)`（2 处），真实发信链路实测通过（status=sent + Resend message id）

### 11.2 演示数据与脚本
- [x] `scripts/` 升级为工作区包（`@pcb/scripts`，pnpm-workspace.yaml 加 `scripts`）→ 根目录脚本可解析 `@pcb/db`
- [x] `scripts/demo/dataset.ts`：12 家欧美 PCB 潜在客户静态数据集（行业/规模/国别/描述/痛点/画像/开发信 A-B 文案/LinkedIn 私信），确定性生成、离线可用
- [x] `scripts/demo/seed.ts`：写入 12 公司 + 12 联系人 + 14 打分（含 2 条人工覆盖 + 审计日志）+ 12 画像 + 14 草稿 + 1 正式活动 + 1 演示 warmup 活动 + 79 条发送记录 + 事件明细；`--reset` 精确回滚、`--purge-failed` 清历史失败记录、`--recipient=` 换收件人
- [x] **发信零外泄设计**：演示联系人邮箱全部 = `DEMO_RECIPIENT_EMAIL` 的 `+<公司标识>` 别名 → 现场任意公司点「批准并发信」都只进演示者自己邮箱
- [x] `scripts/demo/check.ts`：14 项演示就绪自检（4 服务存活 / 租户一致性 / 四 Tab 数据 / 真实发信前置），FAIL 则退出码 1
- [x] 根目录 `demo.command`（双击）：环境检查 → 重写演示数据 → 补齐未启动服务（已在跑则跳过）→ 等待就绪 → 自检 → 打开看板 → 打印演示顺序
- [x] 根 package.json 加 `demo:seed` / `demo:reset` / `demo:check`
- [x] `apps/mailer/.env(.example)` 新增 `DEMO_RECIPIENT_EMAIL`（含注释）
- [x] `DEMO_GUIDE.md`：四幕通用主线 + 三套剧本（① 卖产品给同行 ② 展示给终端客户 ③ 投资人/OPC 评审）+ 每套的 30 秒开场 / 分幕口播 / ROI 收尾 / 高频 Q&A + 排障救场表（含"录屏兜底"）+ 演示后收尾

### 11.3 验证结果（2026-09-10）
- [x] `pnpm demo:check` 14/14 全绿：线索 12 条（A=4 B=5 C=3）· 首批公司画像秒开 · 4 篇 A/B 草稿 · 发送打开率 68% / 回复 3 / 退信率 3.6% · reputation 100/100
- [x] 真实发信端到端实测通过：`enqueueSingle` → send-worker → Resend → `status=sent` + 真实 message id
- [x] `demo:reset` 回滚实测：演示数据归零（companies 13→1、drafts 14→0），真实 warmup 记录与占位公司不受影响
- [x] 回归：gateway 17/17 + scorer 42/42 测试通过；`@pcb/dashboard`（含 tsc）/ gateway / scorer 三个 build 全绿；`scripts/` biome 检查零错误

---

## 十二、生产部署：阿里云服务器（2026-09-10）✅

> 目标机 `47.251.97.20`（阿里云 Alibaba Cloud Linux 3 / 2 vCPU / 1.8G / 40G）。
> 详见 `DEPLOY.md`。

### 12.1 部署形态：共享机器上的纯增量部署
- [x] 侦察确认该机**并非空闲机器**：宝塔面板 + nginx(多端口) + MariaDB(3306) + PostgreSQL 13(5432) + Redis 6(6379) + PM2 上跑着 WordPress×2 / Medusa 商城(`brick_parts_store`) / 2 个 Next.js 应用，磁盘剩 16G、1.8G 内存且已在使用 swap
- [x] 因此**不用 Docker**，直接复用机器既有 PG/Redis/PM2/nginx；全部改动为增量
- [x] 未触碰既有业务：新建独立库、Redis 走独立 DB 号、端口全用空闲端口、nginx 仅新增 2 个 vhost 并先 `nginx -t` 通过再 reload

### 12.2 两套完全隔离的实例
| | 演示环境 (demo) | 生产环境 (prod) |
|---|---|---|
| 数据库 | `pcb_leadgen_demo` | `pcb_leadgen` |
| Redis | `6379/5` | `6379/6` |
| gateway / scorer / mailer | 3011 / 3012 / 3013 | 3021 / 3022 / 3023 |
| 对外端口 | **8090（已放行，公网可达）** | **8091（已放行，公网可达）** |
| 数据 | 12 公司 / 14 打分 / 12 画像 / 14 草稿 / 79 发送 | 空库（仅 tenant + user） |

- [x] 按需求「只起看板+查询」：**不启用 send-worker / warmup-worker** → 服务器上「批准并发信」会停在 `queued`（真发信演示仍用本机 `./demo.command`）
- [x] 数据库账号 `pcb_user`，密码存服务器 `/root/.pcb_pgpw`（600），未入仓库

### 12.3 部署过程中实测发现并修复的问题
- [x] **PM2 + bun interpreter 静默不监听（阻塞级）**：`interpreter: 'bun'` 会 import 模块，而 Bun 的 `export default { port, fetch }` 只在作为入口运行时才监听 → PM2 显示 online、日志照打 `listening`、error log 全空，但端口根本不 listen。修：`script: /usr/local/bin/bun` + `args: run src/index.ts` + `interpreter: none`
- [x] **`seed.ts` 在全新数据库上 FK 违约**：`audit_logs.user_id` → `users` 外键，seed 只建 tenant 未建 user（本机因该行早已存在从未暴露，换干净机器必崩）。修：补 `ensureUser()`
- [x] **残留探测进程占端口**：早前用于测安全组的 `node listen(8090)` 还在跑，nginx 抢不到 8090，公网返回 `PROBE_OK` 而非看板。修：`pkill` 后 reload nginx
- [x] **rsync 带回 uid 501**：服务器上 501 是系统账号 `games`，同步后统一 `chown -R root:root`

### 12.4 验证结果
- [x] 6 个服务 `/health` 全 200；3011-3013 / 3021-3023 全部 listen；既有 4 个 PM2 应用仍 online
- [x] **公网** `http://47.251.97.20:8090`：index.html 200 · `/api/lead-scores` total=12 · `/api/mails/stats` totalSent=79 开信率 70.2% · 静态资源 300KB 200 · SPA 深路由回退 200 · 画像只读接口 200（20ms，验证了 GET 只读改造生效）
- [x] 生产环境 `/api/lead-scores` total=0、`/api/mails/stats` 全 0 → 两套环境确已隔离
- [x] 内存占用约 366MB（6 进程），可用内存 1.2G；`pm2 save` 已持久化，`pm2-root` 开机自启 enabled

### 12.5 交付物
- [x] `DEPLOY.md`：访问地址 / 隔离关系 / 服务器目录 / 日常运维 / 重新部署 / 补起 worker / basic auth / 演示数据重灌 / 排错表 / 安全组记录
- [x] `scripts/demo/seed.ts`：补 `ensureUser()`（空库可用）
- [x] 服务器：`/opt/pcb-leadgen`、`ecosystem.config.cjs`、`/www/server/panel/vhost/nginx/pcb-{demo,prod}.conf`

### 12.6 遗留事项
- [x] 已给生产环境加 nginx **HTTP Basic Auth**（用户名 `pcbadmin`，密码存服务器 `/root/.pcb_basicauth_pass`，密码文件 `/etc/nginx/pcb-prod.htpasswd`）—— 8090 演示环境有意保持公开
- [x] 生产环境 8091 阿里云安全组**已放行**（2026-09-11 外部探测 `curl http://47.251.97.20:8091/` 返回 401，确认公网可达，basic auth 工作正常）
- [x] PM2 日志轮转已配（`pm2-logrotate` v3.0.0，10M/保留 7 份/压缩，见 DEPLOY.md §11）
- [ ] 未配域名/HTTPS（`rakuto.store` 未解析到本机，且大陆机器需 ICP 备案）

---

## 十三、简历口径对齐 TODO（2026-09-10 复核产出）

> 背景：简历已按「目标口径」写入本项目能力描述，落点见
> `ai-job-search-cn-master/cv.md`、`ai-job-search-cn-master/cv-PCB外贸AI获客系统.md`、
> `ai-job-search-cn-master/documents/china/profile/evidence.md`。
> 本节把「简历这么写了、代码还没到位」的差距逐条列出。做完一条勾一条；全部做完后，
> 简历措辞可从「目标口径」收敛为「已验证事实」。
>
> 复核方法：逐条回读源码 + 实跑 `pnpm build` / `pnpm test`（2026-09-10）。

### 13.1 采集模块（2026-09-11：代码已落地，待真实 run 验证）

**简历声明**：「企业采集 → 5 维度打分 …」「实现过完整采集链路：Crawlee + Playwright 抓取 Google / Apollo 企业信息与官网，遵守 robots.txt、限流间隔 ≥2s、代理 IP 池」

**实测现状（2026-09-10 复核时的起点，前两条已于 2026-09-11 修复）**：
- ~~`apps/collector/index.ts` 全文仅 1 行 `console.log('Hello via Bun!')`~~ → 已重写为 `src/index.ts`（Hono 服务）+ 完整采集链路
- ~~全仓库无 `crawlee` / `playwright` 依赖~~ → 已装 `crawlee@3.18` / `playwright@1.63` / `cheerio`
- 演示环境 `http://47.251.97.20:8090` 的线索**全部来自 `scripts/demo/seed.ts` 种子数据**（标记 `companies.raw_payload->>'demo' = 'true'`），非采集所得
- 即：P1 三件事里的「线索采集」实为未实现；§四 记的 P1「完成」实际只覆盖打分 + 看板

- [x] `pnpm --filter @pcb/collector add crawlee playwright cheerio drizzle-orm` 并锁版本（2026-09-11）
- [x] 实现搜索 API 采集器（关键词 + 地区 + 分页）：`src/clients/search/{types,brave,factory}.ts`，Brave 首发，工厂可切换 provider
- [x] ~~实现 Apollo.io 企业信息采集（走 `APOLLO_API_KEY`，遵守其 API 配额）~~ **已取消**（用户决策：优先开源）→ 改为自建官网 enrich + 规则推断
- [x] 实现官网 enrich（公司域名 → 抓首页 / about / products 页 → 抽 about、产品、行业信号、邮箱）：`src/enrich/{crawl,extract,infer}.ts`
- [x] robots.txt 校验（自研 RFC 9309 简化解析 `src/net/robots.ts` + Crawlee `respectRobotsTxtFile` 双保险）
- [x] 请求间隔 ≥2s + 每域名并发 1 + 429/5xx 指数退避 + 连续 5 次失败冷却 10 分钟：`src/net/{throttle,circuit-breaker,http}.ts`
- [x] 代理 IP 池接入（Bright Data，`BRIGHTDATA_PROXY_URL` 或 token+用户名拼装；未配置则直连）：`src/net/proxy.ts`
- [x] 采集产物写库时打 `demo=false` 标记，与种子数据可区分：`src/store/persist.ts`
- [x] 补采集器单测：限流计数、熔断状态机、robots 拒绝、Brave 解析/退避、字段映射 —— **32 个用例全绿**

**交付形态（2026-09-11）**：
- 服务：`src/index.ts`（Hono，端口 3004，`/health` + `POST /collect`）
- CLI：`pnpm --filter @pcb/collector collect --keywords="a,b" --country=us --limit=10`
- 配置：`apps/collector/.env.example`（含限流/代理/合规项）

**遗留**：
- [x] ~~**真实 run 待验**~~ → 2026-09-15/16 已用 EDGAR 多次实跑验证（`SEARCH_PROVIDER=edgar`，免费直连无需 key）：非 demo 公司/联系人/打分写库正常，浏览器一键采集端到端通过
- [x] ~~Playwright 浏览器未安装~~ → 2026-09-16 已装（playwright 1.63.0，chromium 1243），`fetchRenderedHtml` 降级路径 smoke test 通过（1.4s）。注意：实测 EDGAR 上市公司场景 0 增益（7 家无邮箱公司渲染后仍无邮箱、耗时 150s），**不要**把它接到 edgar-filings 的 probeWebsite；价值场景是 Brave/DDG 中小厂强 JS 官网
- [ ] 简历口径：原写「Crawlee + Playwright 抓取 Google / Apollo」需改为「Crawlee + Playwright 抓官网 + EDGAR/Brave 搜索 API」，去掉 Apollo

**验收**：一次真实采集 run 后 `/api/lead-scores` 出现非 demo 标记的真实线索（✅ 已达成，EDGAR 真实线索 30+ 家）；采集器关键路径有测试覆盖（✅ 64 用例）。

### 13.2 打分是规则加权，不是 AI（口径二选一）

**简历声明**：「5 维度 **AI** 打分 A/B/C 分级」

**实测现状**：`apps/scorer/src/scoring/{industry,keywords,role,size,reachability}.ts` 为纯确定性规则函数，`scoring/` 目录内零 LLM 调用。spec.md §12 与 OPC 文档自身的措辞是「5 维度**规则**加权打分」。

- [ ] 二选一，选完同步改简历措辞：
  - **方案 A（改口径，零成本）**：简历统一改为「5 维度规则加权打分 + AI 生成打分理由」，与 spec.md §12 对齐
  - **方案 B（补实现）**：在规则分之上加 LLM 复核层——复用 `apps/scorer/src/content/llm.ts`，让 LLM 读事实包 + 公司描述，输出行业匹配复核意见与自然语言研判理由，写入 `lead_scores.reason`

**验收（若选 B）**：打分链路出现真实 LLM 调用；LLM 调用失败时降级为规则分，不阻塞入库。

### 13.3 测试套件不可复现 + 4 个用例失败（可直接修）

**简历声明**：「80 个单元测试用例覆盖打分模型、发送配额、webhook 验签、类型校验」

**实测现状（2026-09-10 实跑）**：实际 **83 个用例**
| 包 | 结果 |
|---|---|
| `@pcb/types` | 16 pass / 0 fail |
| `@pcb/db` | 3 pass / 0 fail |
| `@pcb/gateway` | 17 pass / 0 fail |
| `@pcb/mailer` | 5 pass / 0 fail |
| `@pcb/scorer` | **38 pass / 4 fail**（共 42） |
| 合计 | **79 pass / 4 fail**（共 83） |

- **失败根因**：`apps/scorer/.env` 的 `FACTS_JSON_PATH` 写死绝对路径
  `/Users/quentingam/Documents/aigc_base_knowledge/contentforge/workspaces/pcb/registry/facts.json`，
  仓库迁入 `PCB_ALL/` 后该路径失效 → facts-loader 4 个用例读不到 facts.json
- §8.2 记录的「78/78」已过期（该数字早于 mailer 新增用例；16+3+42+17=78）
- **未写进文档的坑**：在仓库根目录直接 `bun test` 会失败（cwd 为根，不加载各包 `.env`），
  必须走 `pnpm test` 或进包目录跑

- [ ] 修 `apps/scorer/.env` 与 `.env.example` 的 `FACTS_JSON_PATH` 为当前真实路径
- [ ] 改为相对路径或由根目录推导，避免下次迁移再断
- [ ] 在 AGENTS.md 注明「测试须在包目录下跑或走 `pnpm test`」
- [ ] 更新 §8.2 的用例总数为 83，并标注 scorer 依赖 `FACTS_JSON_PATH`
- [ ] 简历措辞把「80」改为实测数「83」

**验收**：`pnpm test` 全绿 0 fail。

### 13.4 共享包为占位（结构有了，实现没有）

**简历声明**：「5 个共享包 `db / queue / types / ui / config`」

**实测现状**（源码行数，已排除 node_modules）：
- 有实现：`packages/db` 713 行、`packages/types` 352 行
- **占位 1 行**：`packages/queue`、`packages/ui`、`packages/config`
- 实际队列逻辑在 `apps/mailer/src/lib/queue.ts`；shadcn 组件在 `apps/dashboard/src/components/ui/`

- [ ] 把 `apps/mailer/src/lib/queue.ts` 抽到 `packages/queue`，mailer 改为引用
- [ ] 把 dashboard 的 shadcn 组件抽到 `packages/ui`
- [ ] 把 biome / tsconfig 共享配置抽到 `packages/config`

**验收**：三个包不再是 1 行占位；`pnpm build` 仍全绿；无 apps 之间直接 import（AGENTS.md §8 架构红线）。

### 13.5 无鉴权，多租户隔离仅靠请求头

**简历声明**：把「多租户数据隔离」写入合规设计段，与 GDPR / CAN-SPAM 并列

**实测现状**：`apps/gateway/src/routes/*.ts` 每个查询都带 `eq(table.tenantId, tenantId)`，`tenantId` 取自请求头 `X-Tenant-Id`，缺失时 404；但**无任何鉴权**，调用方可任意伪造租户 ID。DEPLOY.md 自述「应用本身没有任何登录鉴权…靠 nginx basic auth 兜底」。

- [ ] 实现 JWT 鉴权中间件，`tenant_id` 从 token 解析（AGENTS.md §9 已约定「生产从 JWT 解析」）
- [ ] 移除对 `X-Tenant-Id` 请求头的信任，或仅在开发环境允许
- [ ] 补测试：无 token → 401；跨租户读取 → 404

**验收**：无 token 无法访问任何 `/api/*` 业务接口；简历可如实写「多租户隔离（JWT + 行级过滤）」。

### 13.6 演示数据与真实数据在看板上不可区分

**简历声明**：以演示环境 URL 作为「已部署上线」的能力证明

**实测现状**：`scripts/demo/seed.ts` 写入的数据以 `raw_payload->>'demo' = 'true'` 标记（`--reset` 依赖该标记回滚），但看板前端未展示该标记，访问者无法分辨哪些是种子数据。

- [ ] dashboard 对 `demo=true` 的线索显示「演示数据」角标
- [ ] 或在 DEPLOY.md / 演示说明中明确「8090 全部为演示数据」

### 13.7 其他遗留（沿用既有记录）

- [x] 生产 8091 阿里云安全组放行（见 §12.6）
- [x] PM2 日志轮转 `pm2 install pm2-logrotate`（见 §12.6）
- [ ] `apps/mailer` `tsc --noEmit` 约 20 个历史类型错误（见 §8.5 遗留）
- [ ] `rakuto.store` 在 Resend Dashboard 完成 DNS 验证后 warmup 才能真实发信（见 §8.4）
- [ ] 头部摘要「P3 ⬜」与 §四「P3 ✅ 完成 —— 2026-09-10」矛盾，统一为已完成

---

## 十四、五步链路打通后的遗留（2026-09-16）

> 背景：10-K 年报邮箱提取上线（edgar-select.ts + edgar-filings.ts，64 个 collector 单测），DeepSeek 接入 scorer，「采集 → 评分 → 联系人 → 邮件 → 跟进」浏览器端到端全部验证通过。

### 14.1 已完成
- [x] EDGAR 10-K enrich：accession index.json 选主文档 → 年报正文提取公开企业邮箱 + 公司名 token 匹配选官网 → probeWebsite(/contact-us,/contact) 兜底；线索列表加「联系人邮箱」列、采集横幅加「提取联系人 N」
- [x] 性能：SEC 下载改为直接取 gzip 全文（~230KB，勿用 Range——identity 被忽略返回全文、gzip 截断报 ZlibError）；SEC_CONCURRENCY=6 + 120ms 全局节拍；单站官网探测总时限 8s；10 家采集约 15-20s
- [x] DeepSeek 接入：scorer/.env `LLM_PROVIDER=openai_compatible` + `OPENAI_MODEL=deepseek-chat` + 官方 base URL；BRAND_* 改为 GAN PCB；IEH 画像 + A/B 开发信实时生成实测通过
- [x] 五步浏览器验证：一键采集（wearable device：新建 10/联系人 2/打分 10）→ 评分 → 联系人列 → 内容审核（画像+A/B）→ 批准发信（SmartSense，sent）→ 发送记录页
- [x] start.command 更新：补 collector:3004（共 6 服务，按依赖顺序）、端口/进程幂等检测（重复跑不重复拉起）、验收路径改为五步链路 + LIVE 模式真实发信警告
- [x] Playwright chromium 安装并验证（详见 §13.1）

### 14.2 待办（按优先级）
- [x] ~~**【高】10-K Item 1 Business 全文提取喂打分与画像**~~ → 2026-09-16 完成：edgar-select.ts `extractItemBusiness`（目录排除/续页页眉/Item2 回退/10-K-A 返回 null，5 单测），raw_payload.businessOverview（10/10 覆盖，均 5.3 万字符），context.ts 扫描 + 画像 prompt 喂前 1.2 万字符；Hardware 维度 0→10-20、CalAmp 57 分 B、Sensata 画像痛点具体到 IATF16949/AEC-Q。附带修复：搜索排除 10-K/A 修正案；negative 误伤外包方（contract manufacturer 供应链写法不再 excluded，只有自称结构才排除；excluded 12→5，剩余全是真同行）
- [ ] **【决策】是否对真实线索真实发信**：Resend 现为 LIVE 模式（rakuto.store 已验证，sales@rakuto.store），对 iej@iehcorp.com 等真实邮箱点「批准并发信」会真实寄出。演示发送继续用 SmartSense IoT（example.com 假域名）
- [ ] **【中】剩余 20 家历史真实公司未回填 Item 1**：重跑关键词只能覆盖 EFTS 当前能复现的公司（29/49）。如需全量回填，写一次性脚本：从 raw_payload.domain（cik-xxx.edgar.sec.gov）取 CIK，调 EFTS 查该 CIK 最新非 10-K/A 的 accession，跑 enrichEdgarFilings 合并 raw_payload
- [ ] **【中】评分仍以 C 为主（42/49）**：Item 1 解决了 Industry/Hardware（普遍 15+20），但 buyer-fit/demand 维度对年报叙述体不敏感（demand 依赖 "looking for supplier"/招聘等强信号，Item 1 少见）。B 阈值约 50。下一步可：demand 词表补外包叙述（"we outsource all manufacturing"、"contract manufacturers in Asia" 是强采购信号）或引入 LLM 评分维度
- [ ] **【中】邮箱覆盖率 20-30% 的兜底**：大公司官网只有表单（Vuzix/Fitbit/Insulet 等）。可考虑后续接 Hunter 等邮箱推断 API（需 key）或联系人页表单识别（只标记「表单触达」不产出邮箱）
- [ ] **【低】mailer send-worker 未纳入常驻保障**：它是独立进程（`pnpm --filter @pcb/mailer worker`），不起则发送永远 queued；生产 PM2/本机脚本均需单独拉起（start.command 已含，DEPLOY.md 生产刻意未启用 worker）
- [ ] **【低】§九 与 §11 的旧表述**：start.command 已从 5 服务改 6 服务，本文 §九（行 335）描述未同步


# P2 内容生成模块 — 设计与落地 TODO

> 范围：`apps/scorer` 新增 `content/` 子模块，实现客户画像 Agent + 个性化触达内容生成（开发信 / LinkedIn 私信），并预留行业博客模板以对接 OPC 申报的"获客内容智能体"叙事。
>
> 关联项目：
> - 主产品（本仓库）：PCB 外贸获客 Agent = 文档「项目 1」
> - 配套项目：`/Users/quentingam/Documents/aigc_base_knowledge`（ContentForge）= 文档「项目 5」内容智能体

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

## 四、落地步骤

### Step 1：DB Schema 扩展（0.5 天）
- [ ] 新增 `profiles` 表
- [ ] 新增 `content_drafts` 表
- [ ] 更新 `packages/db/src/schema/index.ts` 导出
- [ ] 写迁移：`drizzle-kit generate`

### Step 2：客户画像 Agent（1-2 天）
- [ ] 定义 `ProfileResult` 类型
- [ ] 实现 `profile.ts`
- [ ] 接入路由
- [ ] 写测试

### Step 3：模板基类 + 开发信模板（2 天）
- [ ] 实现 `templates/base.ts`
- [ ] 实现 `templates/cold-email.ts`（A/B）
- [ ] 实现 `generator.ts`
- [ ] 实现 `llm.ts`
- [ ] 接入路由

### Step 4：LinkedIn 私信模板（1 天）
- [ ] 实现 `templates/linkedin-dm.ts`

### Step 5：Dashboard 内容审核页（2 天）
- [ ] 新增 `ContentReviewPage.tsx`
- [ ] 展示画像 + A/B 内容
- [ ] 批准/驳回/编辑/导出

### Step 6：行业博客模板（OPC 叙事预留，1 天）
- [ ] 实现 `templates/industry-blog.ts`
- [ ] 对接 ContentForge facts.json

### Step 7：联调 + 种子数据验证（1 天）
- [ ] 跑通：画像 → 生成开发信 A/B → 审核
- [ ] 验证防编造

---

## 五、OPC 申报叙事对接

### 5.1 三项目闭环图

```
ContentForge（内容智能体 - 文档项目 5）
  PCB 知识库 → 行业博客/FAQ/短视频 → 公域引流 + AI 引用
           │
           ▼ 客户搜索/AI 推荐找上门
pcb_auto_leadgen（获客 Agent - 文档项目 1）
  线索采集 → AI 打分(A/B/C) → 客户画像 → 个性化触达
           │
           ▼ 询盘转化
      订单/合作
```

### 5.2 申报材料组织

1. 项目概述（1 页）
2. 技术架构（1 页）
3. 核心功能演示（2-3 页）
4. 差异化壁垒（1 页）
5. 商业模式（1 页）
6. 合规与安全（0.5 页）

---

## 六、风险与对策

| 风险 | 对策 |
|---|---|
| LLM 编造 PCB 行业数据 | system prompt 硬约束 + 事实包注入 + `[数据缺口]` 标记 |
| 开发信同质化 | A/B 变体 + 客户画像个性化 |
| 跨项目知识库不同步 | facts.json、brand.md 共享，ContentForge 维护，P2 只读 |

---

## 七、验收标准

- [ ] 客户画像 Agent 能提取产品类型、客户类型、痛点
- [ ] 开发信 A/B 版本有明显差异，且引用客户具体业务
- [ ] 防编造：诱导 LLM 写不存在的数字时输出 `[数据缺口]`
- [ ] LinkedIn 私信 ≤ 120 词，口语化，无硬广
- [ ] dashboard 审核页可批准/驳回/编辑
- [ ] 行业博客模板能基于 PCB 知识库生成英文长文

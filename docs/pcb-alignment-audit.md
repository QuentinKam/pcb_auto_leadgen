# PCB Alignment Audit

> 审计对象：pcb_auto_leadgen 现有实现 vs `docs/pcb-alignment.md` 的 PCB/PCBA 领域要求。
> 审计结论依据：以实际源码为准（apps/ + packages/），不以文件名或文档声明推断。
> 本文档不修改任何源码，只产出差距分析与改造建议，供 `docs/pcb-implementation-plan.md` 落地。

---

## Executive Summary

现有实现已经跑通了「采集 → 打分 → 画像 → 内容生成 → 邮件发送 → 追踪」的完整链路，技术架构（Bun 单仓 + 5 个 app + Drizzle + BullMQ + Resend）与 [spec.md](../spec.md) 高度一致，且无需推倒重来。

但对照 [pcb-alignment.md](./pcb-alignment.md) 的领域规则，存在一个**结构性缺口**：

> 现有打分是「规则加权」的 **Buyer Fit 近似**（行业 + PCB 关键词 + 岗位 + 规模 + 可达性），
> 它**没有区分「这个公司像不像 PCB 买家」与「这个公司现在是否要买 PCB」**。

[p alignment §2](../docs/pcb-alignment.md) 明确要求 Lead Quality = `PCB Buyer Fit + Current Demand / Buying Signal`。现有系统只有前半段（且 Buyer Fit 维度不完整），后半段 **Demand Signal 完全缺失**，证据（Evidence）也在 LLM 处理后丢失。

最高杠杆的改动不是「重写打分」，也不是「加新微服务」，而是：

1. **补证据模型**（让每个分数都能回答"为什么是 87 分、依据是什么"）。
2. **补 Demand Signal 检测**（让系统能回答"为什么现在值得联系"）。
3. **扩展现有打分抽象**（加入硬件拟合、负信号、证据置信度，而不是新建第二套打分引擎）。

三件事都在 [apps/scorer](../apps/scorer) 内完成，符合「KEEP > EXTEND > ADD > REFACTOR > REWRITE」原则。

---

## Existing Architecture

实际落地与 [spec.md §8](../spec.md) 描述一致，共 5 个 app + 5 个 package：

| 服务 | 端口 | 职责 | 关键文件 |
|---|---|---|---|
| dashboard | 5173 (dev) | 看板 SPA | [apps/dashboard/src](../apps/dashboard/src) |
| gateway | 3001 | API 网关 + 转发 | [apps/gateway/src/index.ts](../apps/gateway/src/index.ts) |
| scorer | 3002 | 打分 + 画像 + 内容生成 | [apps/scorer/src/index.ts](../apps/scorer/src/index.ts) |
| mailer | 3003 | 邮件发送 + webhook + warmup | [apps/mailer/src/index.ts](../apps/mailer/src/index.ts) |
| collector | 3004 | 搜索 + 官网 enrich | [apps/collector/src/index.ts](../apps/collector/src/index.ts) |

数据流（实际代码，非文档声明）：

```text
collector（Brave 搜索 → 域名去重 → 官网 Crawlee 抓取 → 规则推断 → 落库）
        ↓ POST /score/batch（可选，config.SCORER_URL）
scorer（scoreLead 5 维规则打分 → lead_scores）
        ↓ 手动触发
scorer（LLM 画像 → profiles；LLM 内容生成 → content_drafts）
        ↓ 人工批准 → gateway → mailer
mailer（enqueue → BullMQ send-worker → Resend → webhook 回收状态 → email_sends/email_events）
```

关键事实：

- 采集入口 [pipeline.ts](../apps/collector/src/pipeline.ts) 是「关键词搜索 → 抓官网 → 规则推断 → 落库 → 触发打分」，非文档层面宣称的「LLM 提取特征」。
- 打分入口 [scoreLead](../apps/scorer/src/scoring/index.ts) 是纯规则函数，`scoring/` 目录内零 LLM 调用。
- 画像与内容生成才调用 LLM（[profile.ts](../apps/scorer/src/content/profile.ts) + [generator.ts](../apps/scorer/src/content/generator.ts)）。

---

## Existing Capabilities

逐项列出「实际存在」的能力（有源码支撑）：

1. **Company discovery**：[collector/src/pipeline.ts](../apps/collector/src/pipeline.ts) 走 Brave Search API（[brave.ts](../apps/collector/src/clients/search/brave.ts)），域名去重、社媒/百科/招聘站过滤（[normalize.ts](../apps/collector/src/store/normalize.ts)）。
2. **Website enrichment**：[crawl.ts](../apps/collector/src/enrich/crawl.ts)（Crawlee CheerioCrawler）+ [extract.ts](../apps/collector/src/enrich/extract.ts)（cheerio 抽 about/products/services/emails）+ [infer.ts](../apps/collector/src/enrich/infer.ts)（规则推断行业/规模/融资）。
3. **Lead scoring**：[scoring/index.ts](../apps/scorer/src/scoring/index.ts) 聚合 5 维，输出 0-100 + A/B/C + reason + dimensionBreakdown。
4. **Company profile**：[profile.ts](../apps/scorer/src/content/profile.ts) LLM 生成 businessSummary/productTypes/customerType/painPoints/buyingSignals。
5. **Contact extraction**：[extract.ts](../apps/collector/src/enrich/extract.ts) 抽邮箱，[persist.ts](../apps/collector/src/store/persist.ts) 只写 email（`upsertContact` 不写 name/title）。
6. **Personalized content**：[templates/base.ts](../apps/scorer/src/content/templates/base.ts) 防编造约束 + [cold-email.ts](../apps/scorer/src/content/templates/cold-email.ts)/[linkedin-dm.ts](../apps/scorer/src/content/templates/linkedin-dm.ts) A/B 变体 + [facts-loader.ts](../apps/scorer/src/content/facts-loader.ts) 行业事实注入。
7. **Human review**：dashboard [ContentReviewPage.tsx](../apps/dashboard/src/pages/ContentReviewPage.tsx) + [OverrideDialog.tsx](../apps/dashboard/src/components/OverrideDialog.tsx) + gateway [lead-scores.ts](../apps/gateway/src/routes/lead-scores.ts) override + audit_logs。
8. **Email sending + tracking**：mailer [sends.ts](../apps/mailer/src/routes/sends.ts) + [send-worker.ts](../apps/mailer/src/workers/send-worker.ts) + [webhook.ts](../apps/mailer/src/routes/webhook.ts) + quota/warmup。

---

## PCB Requirements

[p alignment.md](./pcb-alignment.md) 的核心要求浓缩：

1. Lead Quality = **PCB Buyer Fit + Current Demand/Buying Signal**（§2），而非单一行业判断。
2. Buyer Fit 应覆盖 8 个维度（§10）：Industry Fit、Hardware Fit、PCB Relevance、Demand Signal、Company Quality、Contactability、Evidence Confidence、Negative Signals。
3. **证据必须保留**（§9）：每个信号要有 `sourceUrl / sourceType / detectedAt / confidence`，且系统能回答「为什么 87 分」。
4. **Demand Signal 分级**（§8）：Tier1 高意向（RFQ、供应商搜索、新品/扩产）、Tier2 中意向（招硬件/PCB/电子工程师、新项目/新厂/融资）、Tier3 弱意向（已有硬件产品、电子团队、PCB 术语）。
5. **联系人匹配按公司规模动态调整**（§7、§14），不要一律走 Procurement。
6. **个性化优先级**（§16）：Current Demand Signal > Specific Product > Specific Engineering Activity > Specific Company > Industry > Generic。
7. **供应商能力匹配**（§18）：把客户需求匹配到供应商能力（层数/板型/材料/表面处理/HDI/Flex/SMT/PCBA/打样/小批量/量产/认证/交期/MOQ）。
8. **Lead 解释**（§19）：Why this company / Why now / Who / What evidence / What to say / What capability。

---

## Requirement Mapping

状态取值：EXISTS / PARTIAL / MISSING / CONFLICT / UNNECESSARY。

| Requirement | Intent/Spec | PCB Alignment | Existing Implementation | Status | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Company discovery | spec §13 | §3 Target Buyer | Brave 搜索 + 域名去重 + 过滤 | PARTIAL | EXTEND：加 PCB 买家关键词模板与负向过滤 |
| Website enrichment | spec §1 | §4/5/6 信号源 | Crawlee + cheerio + 规则推断 | EXISTS | KEEP |
| PCB buyer qualification | spec §12 | §2/§10 | industry + pcb_keywords 两维 | PARTIAL | EXTEND：补硬件拟合/负信号/证据置信度 |
| Evidence extraction | — | §9/§11 | 无（仅 rawPayload.sources=['brave']） | MISSING | ADD：证据 JSON 模型 + 落库 |
| Lead scoring | spec §12 | §10 分级 | 5 维规则加权 v1 | PARTIAL | EXTEND：扩维到 8 维，不新建引擎 |
| Demand signals | spec §2 | §8 | 仅 profile.buyingSignals（LLM 文本） | MISSING | ADD：规则检测 + 落库 + 计入打分 |
| Company profile | spec §9 | §5 产品信号 | profiles 表 + LLM 画像 | EXISTS | KEEP |
| Contact discovery | spec §1 | §7 采购角色 | 仅抽邮箱，无 name/title | PARTIAL | EXTEND：抽 name/title/role |
| Contact ranking | spec §12 role 维 | §7/§14 | role.ts 岗位高/中/无 | PARTIAL | EXTEND：按公司规模动态优先级 |
| Personalized email | spec §4 | §15-17 | 内容生成 + 防编造 | PARTIAL | EXTEND：注入 Demand Signal + 能力匹配 |
| Human review | spec §6 | §19 | 审核页 + override + 审计 | EXISTS | KEEP |
| Email sending | spec §5/§11 | — | mailer + BullMQ + quota + warmup | EXISTS | KEEP |
| Follow-up | — | §20 反馈闭环 | 无序列/回复跟进 | MISSING | ADD（P2，验证线索质量后再做） |
| Analytics | spec §6/§14 | §20 | stats/campaigns/sends | PARTIAL | EXTEND：加询盘/ROI 归因（P2） |

---

## Qualification Gap

现有 [scoring/index.ts](../apps/scorer/src/scoring/index.ts) 的 5 维与 pcb-alignment §10 的 8 维对照：

| PCB 维度 | 现有实现 | 差距 |
|---|---|---|
| Industry Fit | [industry.ts](../apps/scorer/src/scoring/industry.ts)（target/related/none 固定列表） | 已有，但列表偏窄（无 drones/smart home/energy storage 等 Tier1），且 `infer.ts` 与 `industry.ts` 取值需对齐 |
| Hardware Fit | 无独立维度，仅靠 pcb_keywords 间接 | **缺失**：无「硬件产品 + 电子」组合判断 |
| PCB Relevance | [keywords.ts](../apps/scorer/src/scoring/keywords.ts) | 已有，但只看词频，无上下文（会把「PCB 制造商」误判为目标买家） |
| Demand Signal | 无（buyingSignals 在 profile，不打分） | **缺失** |
| Company Quality | [size.ts](../apps/scorer/src/scoring/size.ts) | 已有，但把规模当分数（§12 要求规模只影响联系人选择，非是否 Lead） |
| Contactability | [reachability.ts](../apps/scorer/src/scoring/reachability.ts) | 已有 |
| Evidence Confidence | 无 | **缺失** |
| Negative Signals | 无（keywords 表有 weight 负值字段但未用） | **缺失**：无「PCB 制造商自身/纯软件/招聘站」排除 |

结论：

- **不需要第二套打分引擎**。采用新的归一化模型（已落地 `modelVersion='v2'`）：

  ```text
  Final Score = clamp(Buyer Fit + Demand Signal - Negative Penalty, 0, 100)
  Buyer Fit (0-60) = Industry Fit(15) + Hardware/Product Fit(20) + PCB Relevance(15) + Company Fit(10)
  Demand Signal (0-30)，Negative Penalty (0-10)
  ```

- **Company Size 不再作为强 Buyer Fit 信号**，降级为 Company Fit 的弱分量（0-10），规模主要用于 Contact Ranking（P1）。
- **Role / Reachability（联系人维度）移出评分**，`role.ts`/`size.ts`/`reachability.ts` 保留导出，供 P1 Contact Ranking 复用。
- **Evidence Confidence 不是独立加分项**，而是作为 signal 的 confidence 乘数作用到对应维度分数上（见 §17 Evidence Gap）。

实现落点：[scoring/index.ts](../apps/scorer/src/scoring/index.ts) + [scoring/buyer-fit.ts](../apps/scorer/src/scoring/buyer-fit.ts) + [scoring/demand.ts](../apps/scorer/src/scoring/demand.ts) + [scoring/negative.ts](../apps/scorer/src/scoring/negative.ts)。

---

## Evidence Gap

当前证据生命周期：

```text
collector：rawPayload.sources=['brave']  ← 仅记录「来源渠道」，无 URL、无逐信号证据
    ↓
scorer：scoreKeywords 读 rawPayload.about/products/services，命中后只记 matchedKeywords
    ↓
lead_scores.reason = 拼接文本（可读但不可查询）
    ↓
（无任何 sourceUrl / sourceType / confidence / detectedAt）
```

对照 pcb-alignment §9 的证据结构：

```json
{ "signalType": "hiring", "description": "...", "sourceUrl": "...", "detectedAt": "...", "confidence": 0.92 }
```

**当前完全缺失**。具体表现：

- [persist.ts](../apps/collector/src/store/persist.ts) 的 `buildRawPayload` 只存 `sources`（渠道名）与 `about/products/services`（正文），不存每段文本对应的 URL。
- [keywords.ts](../apps/scorer/src/scoring/keywords.ts) 命中后不记录命中的原文片段与出处。
- [profile.ts](../apps/scorer/src/content/profile.ts) 生成的 buyingSignals/painPoints 无 sourceUrl 与 confidence。

最小改动（已落地，不重写采集）：

1. **Source URL preservation**：collector 在 [extract.ts](../apps/collector/src/enrich/extract.ts) 的 `SiteSignals` 增加 `fieldSources`（字段→URL），落库到 `rawPayload.sourcesByField`。
2. **Signal-level Evidence**（非 field-level）：scorer 每个维度命中时，产出带 `signalType/description/snippet/sourceUrl/confidence` 的证据对象，由 [evidence.ts](../apps/scorer/src/scoring/evidence.ts) 统一构造。
3. **Evidence Confidence 作为乘数**（非加分项）：`Demand = tierScore × confidence`，见 [demand.ts](../apps/scorer/src/scoring/demand.ts)。
4. **落库**：`lead_scores.evidence jsonb`（[lead_scores.ts](../packages/db/src/schema/lead_scores.ts)）。

> 关键判断：证据在「信号产生时就绑定 snippet + source URL」，而不是等 LLM 处理后再回填（此时来源已不可考）。

---

## Demand Signal Gap

现状：系统唯一的「采购信号」是 [profile.ts](../apps/scorer/src/content/profile.ts) 里 LLM 输出的 `buyingSignals` 字符串数组。它有三个问题：

1. **非结构化、不可打分**：只是展示给看板，不进入 `scoreLead`。
2. **无证据**：LLM 从 description 推断，不知道从哪段文字来。
3. **无分级**：不分 Tier1/Tier2/Tier3（pcb-alignment §8）。

对照 §8 的可检测性（基于现有基础设施）：

| 信号 | Tier | 现有能力 | 可行性 |
|---|---|---|---|
| RFQ / PCB supplier search / sourcing request | 1 | 无 | 需在搜索关键词/官网文本加规则匹配，或采集时定向搜索 |
| new hardware product / launch / production expansion | 1 | 无 | 官网文本规则匹配（"announcing / launch / expanding"）可行 |
| Hardware/PCB/Electronics Engineer hiring | 2 | 无 | 官网 careers 页文本匹配可行；招聘站被 normalize 过滤 |
| new factory / funding | 2 | infer.ts 已抽 fundingStage | 部分可行，融资阶段已采集 |
| existing hardware product / electronics team / PCB terminology | 3 | keywords.ts 部分 | 已有，但当作 Buyer Fit 而非 Demand |

结论：Tier3 已被现有 keywords 维度部分覆盖；Tier1/Tier2 需要新增规则检测层，但**全部可用现有官网文本 + 规则推断实现，无需新增外部数据源**。

---

## Contact Discovery Gap

现状 [persist.ts](../apps/collector/src/store/persist.ts) 的 `upsertContact`：

```ts
const email = candidate.emails.find(...);  // 只取邮箱
insert({ email, emailVerified: 'unknown', active: true });  // 无 name / title / linkedinUrl
```

结果：

- `contacts.title` 字段存在但**从未被采集填充** → [role.ts](../apps/scorer/src/scoring/role.ts) 的岗位打分在实际采集数据上恒为 0 分（除非手工导入）。
- 无「按公司规模选择联系人」逻辑：`scoreLead` 只取第一条 active contact（[score.ts](../apps/scorer/src/routes/score.ts)），无 Procurement/Hardware/Founder 优先级。

对照 §7/§14：需要

1. 采集侧从官网/邮件地址推断 name 与 title（或从公开目录/页面）。
2. 新增「公司规模 → 联系人优先级」映射，替换当前「取第一条」。

> 注意合规：LinkedIn 批量抓取被 AGENTS.md 与 spec §10 明确禁止，联系人 name/title 只能来自官网公开信息或人工 CSV 导入，不能绕 LinkedIn。

---

## Personalization Gap

内容生成已有较强防编造约束（[base.ts](../apps/scorer/src/content/templates/base.ts) 的 `systemConstraint`：只准用上下文事实、禁最高级词、缺数据写 `[data gap]`、品牌只出现一次）。

对照 §15-18 的差距：

| 要求 | 现状 |
|---|---|
| Company + Product + Person Role + Evidence | 已注入（cold-email.ts 的 user prompt 含 profile/company/contact/score/brand） |
| Demand Signal 驱动个性化 | **缺失**：prompt 只注入 buyingSignals（LLM 猜的），无结构化 Tier 信号与证据 URL |
| Supplier Capability 匹配 | **部分**：brand 信息来自 [generator.ts](../apps/scorer/src/content/generator.ts) 的 `getBrandInfo()`，但只从 env 读取，且未做「客户需求 → 能力匹配」筛选，会泛泛推销全部能力 |
| 证据支撑「noticed that...」 | **缺失**：无 sourceUrl 供生成时引用，容易产生无证据的开场白 |

结论：模板架构（基类 + 子类 + A/B）无需改动；需要改的是**注入给 prompt 的上下文**（补 Demand Signal + 能力匹配 + 证据出处），以及**品牌/能力配置从 env 下沉到 DB/租户级**。

---

## Data Model Gap

现有 12 张表（[schema/index.ts](../packages/db/src/schema/index.ts)）对照 pcb-alignment 需要的实体：

| 表 | 状态 | 说明 |
|---|---|---|
| tenants / users / keywords | EXISTS | keywords 的负向 weight 未被使用 |
| companies | EXISTS | rawPayload jsonb 可承载证据，但未结构化 |
| contacts | EXISTS | title/name 未被采集填充 |
| lead_scores | EXISTS | reason 为文本、dimensionBreakdown 为纯数字 jsonb，无证据、无分数版本语义 |
| profiles | EXISTS | buyingSignals/painPoints 无证据与 confidence |
| content_drafts | EXISTS | 有 variant A/B，但无「版本/修订历史」（PATCH 直接改 body） |
| email_campaigns / email_sends / email_events | EXISTS | 追踪闭环已完整 |
| audit_logs | EXISTS | 人工覆盖已审计 |
| **evidence（独立表）** | **MISSING** | 需要新表或 jsonb 字段承载 §9 的证据结构 |
| **demand_signals（独立表）** | **MISSING** | 需要落库承载 §8 的分级信号 |

关键判断：

- **证据** 建议用 `lead_scores.dimension_breakdown` 之外新增 `evidence` jsonb 字段（或独立 `lead_evidences` 表），因为证据与分数是 1:N 关系，且未来要用于「为什么 87 分」解释。
- **Demand Signal** 建议独立表（或复用 profiles.buyingSignals 的升级版），因为一个公司可能有多条、不同 Tier、不同时间点的需求信号，需要可追溯。
- **分数版本** 已有 `modelVersion`（v1/v2/v3）与「追加新记录」模式，够用；不需要新增表。

---

## Architecture Gap

现有 5-app + 5-package 架构**足以支撑 PCB 领域改造**，无需新增微服务：

- collector：加证据采集 + 联系人 name/title 抽取 + Demand 关键词匹配。
- scorer：扩展现有 `scoring/` 与 `content/`，新增 PCB 领域模块（`scoring/demand.ts`、`scoring/evidence.ts` 等）。
- mailer / dashboard / gateway：基本不动。

结论（对应 Phase 9）：

> **PCB 领域模块应落在 `apps/scorer` 内（scoring + content 子目录扩展），而不是新建第 6 个微服务。**

需要指出一个既有架构债（不影响本次 PCB 对齐，但影响后续）：

- [packages/queue](../packages/queue/index.ts)、[packages/ui](../packages/ui/index.ts)、[packages/config](../packages/config/index.ts) 仍是 1 行占位（[TODO.md §13.4](../TODO.md) 已记录）；真实队列逻辑在 [mailer/src/lib/queue.ts](../apps/mailer/src/lib/queue.ts)。本次改动**不要**顺手重构这些占位包，避免扩大范围。

---

## KEEP

以下直接保留，不做改动：

- 5-app + Drizzle + BullMQ + Resend 架构。
- [scoring/index.ts](../apps/scorer/src/scoring/index.ts) 的 `scoreLead` + `dimensionBreakdown` + A/B/C 分级抽象。
- [content/templates/base.ts](../apps/scorer/src/content/templates/base.ts) 防编造约束 + A/B 变体 + `[data gap]`/`[F-xxx]` 机制。
- [facts-loader.ts](../apps/scorer/src/content/facts-loader.ts) 行业事实注入。
- collector 的合规基础设施（robots/限流/熔断/代理）。
- mailer 的 quota/warmup/webhook/退信拉黑/投诉阈值。
- gateway 的转发与 lead_scores override 审计。

---

## EXTEND

在现有抽象上做增量扩展（不新建引擎/服务）：

1. **打分维度**：`scoring/` 新增 `demand.ts`（需求信号）、`evidence.ts`（证据置信度）、`negative.ts`（负信号），并扩展 `dimensionBreakdownSchema`。
2. **行业列表**：[industry.ts](../apps/scorer/src/scoring/industry.ts) 的 TARGET/RELATED 列表对齐 pcb-alignment §3（补 drones/smart home/energy storage/embedded/telecom hardware 等）。
3. **采集证据**：[collector/src/types.ts](../apps/collector/src/types.ts) 的 `LeadCandidate` 与 `extract.ts` 的 `SiteSignals` 增加「字段→来源 URL」映射。
4. **联系人抽取**：[extract.ts](../apps/collector/src/enrich/extract.ts) 增加 name/title 启发式抽取。
5. **内容生成上下文**：[generator.ts](../apps/scorer/src/content/generator.ts) 的 `TemplateContext` 注入 Demand Signal + 能力匹配 + 证据出处。
6. **品牌能力配置**：`getBrandInfo()` 从 env 下沉到 DB（租户级），支持 §18 的能力字段。

---

## ADD

需要新增的最小实体/逻辑：

1. **证据模型**：`lead_scores.evidence` jsonb（或独立 `lead_evidences` 表），承载 §9 结构。
2. **需求信号落库**：独立 `demand_signals` 表（tier / signalType / sourceUrl / detectedAt / confidence），或升级 profiles.buyingSignals。
3. **需求信号规则检测**：`scoring/demand.ts`（Tier1/Tier2/Tier3 关键词 + 上下文规则）。
4. **负信号检测**：`scoring/negative.ts`（PCB 制造商自身、纯软件、招聘站、代理公司）。
5. **公司规模 → 联系人优先级**：`scoring/role.ts` 之外新增「规模感知的联系人排序」。

---

## REFACTOR

仅在有明确收益时做，且不扩大范围：

- **（可选）** 把 [mailer/src/lib/queue.ts](../apps/mailer/src/lib/queue.ts) 抽到 `packages/queue`（TODO §13.4 已列），但**本次 PCB 对齐不依赖它**，建议推迟。
- **（可选）** `getBrandInfo()` 从 env 读改为 DB 读，属于 EXTEND 但也可视为小型重构；建议随「能力匹配」一起做，不单独动。

---

## DO NOT BUILD

以下明确**不做**（除非现有架构真的阻碍，但审计未发现）：

- 新 CRM。
- 新消息渠道（WhatsApp/微信）。
- 第 6 个微服务（PCB 领域模块落在 scorer 内即可）。
- 新的 LLM provider（现有 Anthropic/OpenAI 兼容双通道已够）。
- 新数据库 / 换 ORM。
- 新前端框架。
- 完整重写打分引擎（现有 `scoreLead` 可扩展）。
- 完整重写采集器（现有 pipeline 可扩展）。
- 自动批量群发（P3 已实现但 spec §14 要求 P1 先验证线索质量，自动群发不应在线索精度未验证前放开）。
- 过度抽象：不为假想的多数据源做接口层（当前只有 Brave + 自建 enrich）。

---

## Highest-Leverage Changes

按 [pcb-alignment §21](../docs/pcb-alignment.md) 的 `Lead Precision > Volume > Email Automation > UI > Analytics > Infra` 排序：

1. **P0 — 证据模型 + 打分解释**：让每个 A 级线索能回答「为什么 87 分、依据 URL 是什么」。这是 §9/§19 的根基。
2. **P0 — Demand Signal 检测 + 落库 + 计入打分**：补齐「为什么现在值得联系」。这是当前最大缺口，也是 PCB 线索精度与「行业名单」的区分点。
3. **P0 — 负信号检测**：排除 PCB 制造商自身/纯软件/招聘站，直接提升精度（少打扰、多精准）。
4. **P1 — 联系人 name/title 抽取 + 规模感知排序**：让 role 维度与联系人推荐真正生效。
5. **P1 — 能力匹配 + 证据注入到个性化**：让邮件「有事实、有针对性、不说无证据的话」。
6. **P2 — Follow-up / 询盘归因 / 分析**：验证线索质量后再做。

---

## Risks

| 风险 | 说明 | 缓解 |
|---|---|---|
| 扩维破坏现有分数分布 | 新增维度会改变 A/B/C 占比 | 新维度作为 add-on 分数，保留 v1 可回退；用 `modelVersion` 区分 v1/v2 |
| 证据采集改动大 | 需要采集侧带 URL | 只改 `SiteSignals`/`rawPayload` 结构，向后兼容旧数据 |
| 联系人 name/title 抽取误判 | 官网文本噪声大 | 仅启发式 + 低置信标记，不做强断言 |
| 需求信号误报 | "hiring" 关键词可能出现在客户招聘而非采购 | 规则 + 上下文 + confidence 分级，低置信不计入 Tier1 |
| 合规（LinkedIn） | 联系人补充受限 | 只采官网公开信息，不绕 LinkedIn |
| 范围蔓延 | 顺手重构占位包/队列 | 严格按 KEEP/DO NOT BUILD 边界，占位包重构推迟 |

---

## 最终问题解答

### 1. What is already good enough?

- 技术架构与 5 微服务 + Drizzle + BullMQ + Resend 链路（spec §8 一致）。
- 打分抽象（`scoreLead` + `dimensionBreakdown` + A/B/C + 人工覆盖审计）。
- 内容生成防编造机制（`[data gap]` / `[F-xxx]` / 品牌只出现一次）。
- 邮件合规与追踪闭环（quota/warmup/webhook/退信拉黑/投诉阈值）。

### 2. What is the largest PCB-specific gap?

**Demand Signal 完全缺失**。现有系统只回答「这个公司像不像 PCB 买家」（Buyer Fit），无法回答「为什么现在值得联系」（Demand Signal）。其次是**证据（Evidence）在 LLM 处理后丢失**，导致无法解释分数、无法支撑个性化开场白。

### 3. What is the highest-leverage change?

**在现有打分抽象上补齐「需求信号 + 证据 + 负信号」三个维度**（P0），让 Lead Quality = Buyer Fit + Demand Signal + Evidence 真正成立。

### 4. What can be implemented in one day?

- 证据结构落库（`lead_scores.evidence` jsonb）+ 打分维度返回附带来源。
- `scoring/demand.ts` 规则检测（Tier1/2/3 关键词）+ 独立表落库。
- `scoring/negative.ts` 负信号检测。
- 以上三项均为 scorer + collector 内的小范围增量，可用现有测试框架覆盖。

### 5. What should be postponed?

- Follow-up 序列 / 询盘归因 / ROI（P2，先验证线索精度）。
- 自动批量群发放开（先验证 20 条高精度线索的转化）。
- 占位包（queue/ui/config）抽取重构（与 PCB 对齐无关）。
- 新数据源（Crunchbase/Hunter/Clearbit）接入（spec 已标注为可选）。

### 6. What should be removed from the current plan?

- 无需「LLM 打分 v2」作为 PCB 对齐的前置（spec §12 的 v2 可延后；规则扩维已够验证精度）。
- 无需为 Demand Signal 引入新外部数据源（现有官网文本 + 规则已够）。
- 无需把品牌能力做成完整的多租户 CMS（先 env/DB 简单字段即可）。

### 7. If only one change could be made, what should it be?

**补 Demand Signal 检测并计入打分**。这是「PCB 线索精度」相对「行业名单式筛选」的唯一实质差异，也是 §2 与 §8 的核心要求。

### 8. What is the minimum implementation required to test whether PCB Lead Quality actually improves?

最小闭环（对应 [pcb-alignment §22](../docs/pcb-alignment.md) 的 MVP Domain Priority）：

1. 采集侧保留每个信号字段的来源 URL（证据最小化）。
2. scorer 新增 `demand.ts`（Tier1/2/3）+ `negative.ts`，扩展 `scoreLead` 输出。
3. 新增 `demand_signals` 表 + `lead_scores.evidence` 字段。
4. 看板 Lead 详情能展示「Why now（需求信号）+ 证据 URL + 负信号」。
5. 用一批真实采集数据跑一次，人工核对「A 级里有多少是真实 PCB 需求 + 当前有信号」，验证 precision 是否提升。

做到这 5 步即可验证 Lead Precision，无需触碰 mailer、dashboard 发送流、或任何新服务。

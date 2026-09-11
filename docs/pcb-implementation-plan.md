# PCB Implementation Plan

> 依据 `docs/pcb-alignment-audit.md` 的差距分析，产出最小可执行的实现计划。
> 原则：KEEP > EXTEND > ADD > REFACTOR > REWRITE；`Lead Precision > Volume > Email Automation > UI > Analytics > Infra`。
> 本计划**只描述改动，不写源码**，待审批后按 TASK 顺序落地。

## 实施状态（2026-09-11）

P0 已实施完成，核心为**新的归一化打分模型**（`modelVersion='v2'`）：

```text
Final Score = clamp(Buyer Fit + Demand Signal - Negative Penalty, 0, 100)
Buyer Fit (0-60) = Industry Fit(15) + Hardware/Product Fit(20) + PCB Relevance(15) + Company Fit(10)
Demand Signal (0-30)，Negative Penalty (0-10)
```

已完成（对应下方 TASK）：

- **TASK-001 证据模型**：Signal-level Evidence（`signalType/description/snippet/sourceUrl/confidence`），落库 `lead_scores.evidence jsonb`。
- **TASK-002 需求信号**：`scoring/demand.ts`（Tier1/2/3，context-aware，confidence 乘数计分）。
- **TASK-003 负信号**：`scoring/negative.ts`（Soft→penalty / Hard→excluded），落库 `lead_scores.excluded boolean`。
- **Source URL preservation**：collector `extract.ts` 的 `fieldSources` → `rawPayload.sourcesByField`。
- DB 迁移 `0005`（lead_scores 加 `evidence` + `excluded`，`model_version` 默认 v2）已应用。
- 测试已更新并全部通过（除 `facts-loader` 4 例因跨项目 `facts.json` 路径缺失而失败，属既有问题）。

未实施（P1/P2）：联系人 title 抽取、规模感知联系人排序、能力匹配个性化、看板 Why Now 详情、定向搜索、跟进/归因、LLM 打分 v2。

---

优先级定义：

- **P0**：PCB 线索资格预审 MVP 必需（验证 Lead Precision 的最小闭环）。
- **P1**：验证后重要优化（联系人、个性化、能力匹配）。
- **P2**：后续优化（跟进、归因、分析）。

任务依赖：TASK-001 → TASK-002 → TASK-003 是 P0 主线；TASK-004/005/006/007 可并行（P1）。

---

## TASK-001: 证据模型与采集侧来源 URL 保留

### Goal

让每个打分信号都能追溯到 `sourceUrl / sourceType / detectedAt / confidence`，满足 pcb-alignment §9，为「为什么 87 分」与个性化开场白提供依据。

### Why

当前证据在 LLM 处理后丢失：采集只存 `rawPayload.sources=['brave']`，打分只记 `matchedKeywords`，无法回答任何「依据是什么」。这是 §9/§19 的根基。

### Existing Implementation

- 采集候选类型 [collector/src/types.ts](../apps/collector/src/types.ts) 的 `LeadCandidate`。
- 信号抽取 [extract.ts](../apps/collector/src/enrich/extract.ts) 的 `SiteSignals`（`about/products/services/emails` 均为纯文本/数组）。
- 落库 [persist.ts](../apps/collector/src/store/persist.ts) 的 `buildRawPayload`。
- 打分维度 [keywords.ts](../apps/scorer/src/scoring/keywords.ts) 命中后返回 `matchedKeywords` 但无原文/URL。

### Files to Modify

- [apps/collector/src/enrich/extract.ts](../apps/collector/src/enrich/extract.ts)：`SiteSignals` 增加 `sourcesByField`（字段→URL 映射），在 `extractSignals(html, url)` 里把每个字段与其来源 URL 关联。
- [apps/collector/src/store/persist.ts](../apps/collector/src/store/persist.ts)：`buildRawPayload` 写入 `sourcesByField`。
- [apps/scorer/src/scoring/keywords.ts](../apps/scorer/src/scoring/keywords.ts)：命中时附带原文片段与来源 URL。

### Files to Create

- 无（先复用 `companies.rawPayload` jsonb，不新建表）。

### Data Changes

- `companies.rawPayload` 增加 `sourcesByField: Record<field, string[]>`（如 `{ about: ['https://.../about'], products: [...] }`）。
- `lead_scores` 新增 `evidence jsonb` 字段（见 TASK-003）。

### API Changes

- 无新路由；打分响应 `lead_scores.evidence` 随 TASK-003 一起暴露。

### LLM Prompt Changes

- 无（本任务纯规则/采集侧）。

### Implementation

1. `extractSignals` 为 `about/products/services/emails` 各记录来源 URL。
2. `mergeSignals` 合并 `sourcesByField`（数组去重）。
3. `buildRawPayload` 透传。
4. `scoreKeywords` 返回 `matchedEvidence: Array<{ keyword, snippet, sourceUrl }>`。

### Acceptance Criteria

- 采集落库后，`companies.raw_payload.sources_by_field` 能区分 about/products 各自的来源 URL。
- `scoreKeywords` 命中 PCB 关键词时能给出命中的原文片段与 URL。

### Tests

- [extract.test.ts](../apps/collector/src/enrich/extract.test.ts) 增补：`sourcesByField` 正确关联。
- [keywords 维度] 增补：命中返回证据。

### Risk

- 低：向后兼容，旧数据无 `sourcesByField` 时按空处理。

### Priority

P0

---

## TASK-002: 需求信号（Demand Signal）规则检测 + 落库

### Why

当前系统只有 Buyer Fit，无「为什么现在值得联系」。这是审计结论中的最大 PCB 领域缺口（§2/§8）。

### Existing Implementation

- 采集候选 [collector/src/types.ts](../apps/collector/src/types.ts) 已有 `about/products/services/industrySignals`。
- 推断 [infer.ts](../apps/collector/src/enrich/infer.ts) 已有 `inferFundingStage`（可复用为 Tier2 信号）。
- 打分聚合 [scoring/index.ts](../apps/scorer/src/scoring/index.ts)。

### Files to Modify

- [apps/scorer/src/scoring/index.ts](../apps/scorer/src/scoring/index.ts)：`scoreLead` 增加 `demand` 维度。
- [apps/scorer/src/routes/score.ts](../apps/scorer/src/routes/score.ts)：写入 demand 结果。
- [packages/types/src/lead-score.ts](../packages/types/src/lead-score.ts)：`dimensionBreakdownSchema` 增加 `demand_signal` 字段（可空/向后兼容）。

### Files to Create

- [apps/scorer/src/scoring/demand.ts](../apps/scorer/src/scoring/demand.ts)：Tier1/2/3 规则检测。
- [packages/db/src/schema/demand_signals.ts](../packages/db/src/schema/demand_signals.ts)：需求信号落库表。

### Data Changes

- 新增 `demand_signals` 表：`id / tenant_id / company_id / tier(1|2|3) / signal_type / description / source_url / detected_at / confidence / created_at`。
- `lead_scores.dimension_breakdown` 增加 `demand_signal`（P0 可先不强制写入旧数据）。

### API Changes

- 打分响应扩展 `dimensionBreakdown.demand_signal`。
- 可选：gateway 暴露 `GET /api/companies/:id/demand-signals`（P1 再做）。

### LLM Prompt Changes

- 无（本任务纯规则）。

### Implementation

1. `demand.ts` 定义三级关键词（对齐 pcb-alignment §8）：
   - Tier1：`rfq`、`request for quote`、`pcb supplier`、`pcba supplier`、`sourcing`、`product launch`、`production expansion`。
   - Tier2：`hiring hardware engineer`、`pcb engineer`、`electronics engineer`、`new factory`、`funding`（复用 fundingStage）、`new product development`。
   - Tier3：`existing hardware`、`electronics team`、PCB 术语（弱化，与 keywords 维度区分）。
2. 扫描 `company.description` + `rawPayload.about/products/services`，命中则产出 `signalType + description + sourceUrl + confidence`。
3. confidence 规则：Tier1 强命中 0.9+，弱命中 0.5-0.7；Tier2/3 相应降低。
4. `scoreLead` 把 demand 作为 add-on 分数（不挤占原 5 维权重）。

### Acceptance Criteria

- 含 "RFQ"/"looking for PCB supplier" 文本的公司能被识别为 Tier1 需求信号。
- 需求信号随打分落库 `demand_signals`，且 `dimensionBreakdown.demand_signal` 可读。

### Tests

- `demand.test.ts`：Tier1/2/3 关键词命中与 confidence 计算。

### Risk

- 中：招聘类文本可能误判（"hiring" 出现在客户招聘而非采购）。用 confidence 分级 + 上下文规则降低。

### Priority

P0

---

## TASK-003: 负信号检测 + 打分解释（evidence/negative 维度）

### Why

排除「PCB 制造商自身 / 纯软件 / 招聘站 / 代理公司」，直接提升精度（少打扰多精准），并让每个分数可解释。

### Existing Implementation

- [scoring/index.ts](../apps/scorer/src/scoring/index.ts) 的 `dimensionBreakdown` 与 `reason` 拼接。
- [keywords.ts](../apps/scorer/src/scoring/keywords.ts) 只加分，无扣分。
- [keywords.ts（schema）](../packages/db/src/schema/keywords.ts) 的 `weight` 支持负值但未使用。

### Files to Modify

- [apps/scorer/src/scoring/index.ts](../apps/scorer/src/scoring/index.ts)：增加 `negative` 扣分维度与 `evidence` 汇总。
- [apps/scorer/src/routes/score.ts](../apps/scorer/src/routes/score.ts)：写入 evidence。
- [packages/types/src/lead-score.ts](../packages/types/src/lead-score.ts)：`dimensionBreakdownSchema` 增加 `negative`（0 或负值）、`evidence_confidence`。
- [packages/db/src/schema/lead_scores.ts](../packages/db/src/schema/lead_scores.ts)：新增 `evidence jsonb` 字段。

### Files to Create

- [apps/scorer/src/scoring/negative.ts](../apps/scorer/src/scoring/negative.ts)：负信号检测。
- [apps/scorer/src/scoring/evidence.ts](../apps/scorer/src/scoring/evidence.ts)：证据置信度计算（综合 sourceUrl 覆盖度/信号数量）。

### Data Changes

- `lead_scores.evidence jsonb`：数组 `[{ signalType, description, sourceUrl, sourceType, detectedAt, confidence }]`。
- `lead_scores.dimension_breakdown` 增加 `negative` 与 `evidence_confidence`。

### API Changes

- 打分响应增加 `evidence` 字段。
- 看板 Lead 详情后续可读 `evidence` 展示（TASK-008）。

### LLM Prompt Changes

- 无（本任务纯规则）。

### Implementation

1. `negative.ts` 规则：
   - 公司是 PCB/PCBA 制造商/EMS/代工厂（§13 默认排除）→ 扣分。
   - 纯软件/SaaS/agency/IT 咨询 → 扣分。
   - 招聘站/百科/聚合站（采集侧已过滤，此处双保险）。
2. `evidence.ts`：根据「有 sourceUrl 的信号占比 + 信号数量」给 0-10 置信分。
3. `scoreLead` 汇总：`totalScore = base5dim + demand - negative`，`dimensionBreakdown` 与 `reason` 都带上新维度。

### Acceptance Criteria

- PCB 制造商自身被降级（不进入 A 级）。
- 每个 A 级线索的 `evidence` 至少包含 1 条带 sourceUrl 的信号。
- `reason` 能逐条列出「+25 硬件产品 / +20 需求信号 / -10 负信号」。

### Tests

- `negative.test.ts`：制造商/纯软件/招聘站命中。
- `evidence.test.ts`：置信度计算。

### Risk

- 中：负信号误伤（如 EMS 客户其实是终端买家）。用可配置规则 + 低置信标记，允许人工覆盖。

### Priority

P0

---

## TASK-004: 行业与产品信号对齐 pcb-alignment §3/§5

### Why

现有 [industry.ts](../apps/scorer/src/scoring/industry.ts) 的 TARGET/RELATED 列表偏窄，未覆盖 drones/smart home/energy storage/embedded/telecom hardware 等 Tier1 行业。

### Existing Implementation

- [industry.ts](../apps/scorer/src/scoring/industry.ts)：`TARGET_INDUSTRIES` / `RELATED_INDUSTRIES` 固定集合。
- [infer.ts](../apps/collector/src/enrich/infer.ts)：`INDUSTRY_KEYWORDS`（采集侧推断）。

### Files to Modify

- [apps/scorer/src/scoring/industry.ts](../apps/scorer/src/scoring/industry.ts)：扩展行业集合。
- [apps/collector/src/enrich/infer.ts](../apps/collector/src/enrich/infer.ts)：`INDUSTRY_KEYWORDS` 与 scorer 对齐（补 drones/smart_home/energy_storage/embedded/telecom_hardware）。

### Files to Create

- 无。

### Data Changes

- 无（industry 字段仍是 varchar，取值扩充）。

### API Changes

- 无。

### LLM Prompt Changes

- 无。

### Implementation

1. 对齐 pcb-alignment §3 的 Tier1/Tier2 列表，补 `drones / smart_home / energy_storage / embedded_hardware / electronic_instruments / telecom_hardware / aerospace` 等。
2. 保持 `target(30)/related(15)/none(0)` 分值不变。

### Acceptance Criteria

- 无人机/储能/智能家居公司命中 target 或 related，得到对应行业分。

### Tests

- `industry` 维度测试补新行业用例。

### Risk

- 低：纯配置扩充。

### Priority

P1

---

## TASK-005: 联系人 name/title 抽取 + 规模感知排序

### Why

`contacts.title` 字段存在但从未被采集填充，导致 role 维度恒 0；且 §7/§14 要求联系人优先级随公司规模变化。

### Existing Implementation

- 采集抽取 [extract.ts](../apps/collector/src/enrich/extract.ts) 只抽 email。
- 落库 [persist.ts](../apps/collector/src/store/persist.ts) `upsertContact` 只写 email。
- 打分取联系人 [score.ts](../apps/scorer/src/routes/score.ts) 取第一条 active contact。

### Files to Modify

- [apps/collector/src/enrich/extract.ts](../apps/collector/src/enrich/extract.ts)：从官网 `mailto:` / `a[href]` 文本 / 团队页抽 name+title。
- [apps/collector/src/store/persist.ts](../apps/collector/src/store/persist.ts)：`upsertContact` 写入 name/title（低置信标记）。
- [apps/scorer/src/routes/score.ts](../apps/scorer/src/routes/score.ts)：按公司规模选联系人（不取第一条）。

### Files to Create

- [apps/scorer/src/scoring/contact-ranking.ts](../apps/scorer/src/scoring/contact-ranking.ts)：规模 → 角色优先级映射（§14）。

### Data Changes

- `contacts.name/title` 开始有采集值（可能低置信）。

### API Changes

- 无新路由。

### LLM Prompt Changes

- 无（可选：用 LLM 从团队页文本抽结构化 name/title，P2 再做）。

### Implementation

1. `extract.ts` 用启发式（`mailto:` 附近文本、`<a>团队</a>` 列表）抽 name/title。
2. `contact-ranking.ts` 实现 §14 映射：startup→founder/ceo/cto；medium→procurement/purchasing/sourcing；large→strategic sourcing/procurement/supplier quality。
3. `score.ts` 用规模选择最优先联系人。

### Acceptance Criteria

- 官网有团队/联系方式页时，能抽到 name/title。
- 规模不同时，打分所选联系人角色不同。

### Tests

- `contact-ranking.test.ts`：规模→优先级映射。

### Risk

- 中：name/title 误判。低置信标记，人工可编辑。

### Priority

P1

---

## TASK-006: 品牌能力配置 + 供应商能力匹配注入个性化

### Why

§18 要求「客户需求 → 供应商能力」匹配，而非泛泛推销全部能力；§15 要求个性化优先级以 Demand Signal 为最高。

### Existing Implementation

- [generator.ts](../apps/scorer/src/content/generator.ts) `getBrandInfo()` 从 env 读 capabilities/certifications/leadTime/typicalIndustries。
- [types.ts](../apps/scorer/src/content/types.ts) `BrandInfo` 无层数/板型/表面处理等精细字段。

### Files to Modify

- [apps/scorer/src/content/generator.ts](../apps/scorer/src/content/generator.ts)：`TemplateContext` 注入 demand signal + capability match。
- [apps/scorer/src/content/types.ts](../apps/scorer/src/content/types.ts)：`BrandInfo` 扩展 §18 能力字段（layerCount/boardType/material/surfaceFinish/hdi/flex/smt/pcba/prototype/smallBatch/massProduction/certifications/leadTime/moq）。
- [apps/scorer/src/content/templates/cold-email.ts](../apps/scorer/src/content/templates/cold-email.ts)：prompt 增加「只提匹配的能力 + 引用 demand signal 与证据」。

### Files to Create

- [apps/scorer/src/content/capability-match.ts](../apps/scorer/src/content/capability-match.ts)：客户需求 → 能力匹配函数。

### Data Changes

- 品牌能力字段来源：从 env 迁移到租户级配置（可先继续 env，但结构化为精细字段）。

### API Changes

- 无（生成接口不变）。

### LLM Prompt Changes

- cold-email / linkedin-dm 的 user prompt 增加：结构化 demand signal + 证据 URL + 匹配到的能力子集；system 增加「只推销匹配能力、引用证据、不编造需求」。

### Implementation

1. `capability-match.ts` 根据 customerType/productTypes 匹配层数/板型/SMT/PCBA/打样/量产。
2. `TemplateContext` 注入 `demandSignals` 与 `matchedCapabilities`。
3. 模板 prompt 引导 LLM 只使用匹配能力与需求信号。

### Acceptance Criteria

- 客户是「4 层工业控制器」时，邮件只提 4-12 层 FR-4 + SMT + 打样/小批量，不提 HDI/柔性板。
- 有 demand signal 时，开场白优先引用该信号（含证据出处）。

### Tests

- `capability-match.test.ts`：匹配逻辑。

### Risk

- 中：能力字段需要租户真实配置才有意义，否则匹配退化。先用默认值 + env。

### Priority

P1

---

## TASK-007: 需求信号检测接入采集 pipeline（定向搜索）

### Why

TASK-002 只做「官网文本规则检测」，但 Tier1 的 RFQ/供应商搜索往往出现在搜索/招标场景，采集侧可用定向关键词覆盖。

### Existing Implementation

- 采集入口 [pipeline.ts](../apps/collector/src/pipeline.ts) 接收任意 keywords。
- 搜索客户端 [brave.ts](../apps/collector/src/clients/search/brave.ts)。

### Files to Modify

- [apps/collector/src/pipeline.ts](../apps/collector/src/pipeline.ts)：增加 PCB 需求信号关键词模板（可选开关）。
- [apps/collector/src/config.ts](../apps/collector/src/config.ts)：增加 `DEMAND_KEYWORDS` 配置。

### Files to Create

- [apps/collector/src/clients/search/pcb-keywords.ts](../apps/collector/src/clients/search/pcb-keywords.ts)：内置 PCB 买家 + 需求信号关键词模板。

### Data Changes

- 无。

### API Changes

- `/collect` 可传 `includeDemandSignals` 开关（可选）。

### LLM Prompt Changes

- 无。

### Implementation

1. `pcb-keywords.ts` 内置两组关键词：买家发现（"industrial controller manufacturer" 等）+ 需求信号（"pcb supplier needed" / "rfq pcb assembly"）。
2. `runCollect` 可选叠加需求信号关键词搜索。

### Acceptance Criteria

- 用需求信号关键词能搜到 RFQ/供应商搜索类候选。

### Tests

- 关键词模板单测（纯函数）。

### Risk

- 低：纯关键词模板。

### Priority

P1

---

## TASK-008: 看板 Lead 详情展示「Why now + 证据 + 负信号」

### Why

§19 要求销售打开 Lead 后无需重新研究就能决定是否联系；审计发现看板只展示分数与维度简写（I/K/R/S/A），无证据与需求信号。

### Existing Implementation

- 看板 [LeadsPage.tsx](../apps/dashboard/src/pages/LeadsPage.tsx) 列表展示维度简写。
- [api.ts](../apps/dashboard/src/lib/api.ts) `LeadScoreItem` 无 evidence/demand 字段。

### Files to Modify

- [apps/dashboard/src/pages/LeadsPage.tsx](../apps/dashboard/src/pages/LeadsPage.tsx)：增加详情展开（evidence + demand signal + negative）。
- [apps/dashboard/src/lib/api.ts](../apps/dashboard/src/lib/api.ts)：`LeadScoreItem` 增加 `evidence`/`demandSignal` 字段。

### Files to Create

- 无（复用现有 Card/Dialog 组件）。

### Data Changes

- 无（读取 TASK-001/003 新增字段）。

### API Changes

- gateway [lead-scores.ts](../apps/gateway/src/routes/lead-scores.ts) 序列化透传 `evidence`。

### LLM Prompt Changes

- 无。

### Implementation

1. gateway 透传 `evidence`。
2. 看板每条 A 级线索可展开显示：需求信号（tier/描述/URL）、证据 URL、负信号。

### Acceptance Criteria

- A 级线索能展开看到「为什么现在联系 + 证据链接 + 负信号」。

### Tests

- 无（UI 层，人工验收）。

### Risk

- 低。

### Priority

P1

---

## TASK-009: Follow-up 序列与询盘归因（P2）

### Why

§20 反馈闭环要求记录「发送→回复→正向回复→询盘→机会→客户」；当前 mailer 只追踪到 replied，无序列与归因。

### Existing Implementation

- [email_sends/email_events](../packages/db/src/schema) 已有 replied 状态与 webhook。
- [stats-and-campaigns.ts](../apps/mailer/src/routes/stats-and-campaigns.ts) 有统计。

### Files to Modify / Create

- 独立 `follow_ups` 表 + 序列调度（复用 BullMQ）+ dashboard 归因视图。

### Data Changes

- 新增 `follow_ups` 表、`inquiries`（询盘归因）表（P2）。

### Priority

P2

---

## TASK-010: 打分 v2（LLM 复核层，可选）

### Why

spec §12 规划 v2 接入 LLM 打分；但审计结论是「规则扩维已够验证精度」，v2 不是 PCB 对齐前置。

### Existing Implementation

- [llm.ts](../apps/scorer/src/content/llm.ts) 已有 chatJson。

### Implementation

- 复用 llm.ts，在规则分之上加 LLM 复核（读事实包 + 描述，输出研判理由），失败降级规则分。

### Priority

P2

---

## 任务优先级总览

| 优先级 | 任务 | 目标 |
|---|---|---|
| P0 | TASK-001 证据模型 | 信号可溯源 |
| P0 | TASK-002 需求信号检测 | 「为什么现在」 |
| P0 | TASK-003 负信号 + 打分解释 | 精度 + 可解释 |
| P1 | TASK-004 行业对齐 | Buyer Fit 覆盖 |
| P1 | TASK-005 联系人 + 规模排序 | role 维度生效 |
| P1 | TASK-006 能力匹配个性化 | 邮件有针对性 |
| P1 | TASK-007 定向搜索 | Tier1 需求信号覆盖 |
| P1 | TASK-008 看板详情 | 销售自解释 |
| P2 | TASK-009 Follow-up/归因 | 反馈闭环 |
| P2 | TASK-010 LLM 打分 v2 | 可选增强 |

---

## 最小验证闭环（对应审计 §8）

完成 P0（TASK-001/002/003）+ 最小看板展示（TASK-008 的一部分）即可验证 Lead Precision：

```text
采集（带来源 URL）
   ↓
负信号排除（PCB 制造商/纯软件）
   ↓
需求信号检测（Tier1/2/3）
   ↓
打分 = Buyer Fit + Demand Signal - Negative（+ Evidence）
   ↓
看板展示「Why now + 证据 + 负信号」
```

用一批真实采集数据跑一次，人工核对「A 级里有多少是真实 PCB 需求 + 当前有信号」，即可判断 PCB Lead Quality 是否提升。

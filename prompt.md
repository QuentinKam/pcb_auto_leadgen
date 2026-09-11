# Task: 修正 PCB pcb_auto_leadgen 的 PCB Domain Model 与 Lead Scoring

你现在负责继续开发现有 `pcb_auto_leadgen` 项目。

本次任务**不是收缩 MVP，也不是重新定义产品范围**。

当前产品整体方向保持不变：

```text
海外客户发现
→ 公司画像
→ PCB Buyer 判断
→ Demand Signal
→ Lead Scoring
→ 联系人
→ 个性化内容
→ Email Automation
→ Follow-up
→ Dashboard / Analytics
```

保持现有产品边界和已有功能。

本次只针对之前 PCB Alignment Audit / Implementation Plan 中发现的几个核心问题进行修正，并在现有架构上增量实现。

---

# 1. 先阅读现有资料

先阅读：

* `intent.md`
* `spec.md`
* `docs/pcb-alignment.md`
* `docs/pcb-alignment-audit.md`
* `docs/pcb-implementation-plan.md`

然后检查实际代码。

**实际代码是 Source of Truth。**

不要假设文档描述的功能一定已经实现。

---

# 2. 不要收缩产品

明确：

本次不要删除或暂停以下现有能力：

* Collector
* Scorer
* Company Profile
* Contact Extraction
* Personalized Email
* Email Sending
* Email Tracking
* Mailbox Rotation
* Follow-up
* Dashboard
* Analytics
* Human Review
* Score Override
* Audit Log
* 现有 Queue / Mailer
* 现有多应用架构

这些都是当前产品的一部分。

不要因为“做 MVP”而删除它们。

---

# 3. 不要重写架构

保持当前架构：

```text
collector
scorer
gateway
mailer
dashboard
```

继续使用现有：

* PostgreSQL
* Drizzle
* Redis
* BullMQ
* Resend
* Brave Search
* Crawlee / Cheerio
* 当前 LLM integration

不要：

* 新建微服务
* 更换数据库
* 更换 ORM
* 重写 Collector
* 重写 Mailer
* 重写 Dashboard
* 重写整个 Scorer
* 为未来 SaaS 做过度架构

采用：

```text
KEEP
>
EXTEND
>
ADD
>
REFACTOR
>
REWRITE
```

---

# 4. 本次真正需要修正的四件事

重点只有：

```text
1. Buyer Fit
2. Demand Signal
3. Negative Signal
4. Evidence
```

以及它们最终如何形成：

```text
Final Score 0–100
```

---

# 5. 重新定义 Score

当前最大的结构问题是：

原有 5 个维度已经是 0–100，

然后计划再：

```text
+ Demand
- Negative
```

这样会破坏原有 0–100 的语义。

必须修改为新的归一化模型。

采用：

```text
Buyer Fit       0–60
Demand Signal   0–30
Negative        0–10 penalty
```

最终：

```text
Final Score =
clamp(
    Buyer Fit
    + Demand Signal
    - Negative Penalty,
    0,
    100
)
```

---

# 6. Buyer Fit

Buyer Fit 最大 60 分。

建议拆成：

```text
Industry Fit            15
Hardware/Product Fit    20
PCB Relevance           15
Company Fit              10
```

具体实现可以根据当前代码结构调整，但必须满足：

> Buyer Fit 表示“这家公司是不是一个适合 PCB/PCBA 销售开发的潜在客户”。

不要把 Demand 混入 Buyer Fit。

---

# 7. Industry Fit

扩展现有 PCB 目标行业。

至少覆盖：

```text
Robotics
Industrial Automation
IoT
Consumer Electronics
Medical Electronics
Automotive Electronics
Drones
UAV
Smart Home
Embedded Systems
Electronic Instruments
Energy
Battery
Power Electronics
Telecommunications
Aerospace Electronics
Defense Electronics
Wearables
Sensors
Control Systems
```

不要机械地扩大成几百个行业。

保持可维护。

---

# 8. Hardware / Product Fit

增加明确的 Hardware Fit 概念。

识别例如：

```text
electronic device
controller
sensor
IoT device
robot
industrial controller
medical device
automotive electronics
embedded device
communication equipment
smart device
battery system
power electronics
instrument
drone
UAV
```

目标是判断：

> 公司是否实际制造、研发或销售包含电子硬件的产品。

---

# 9. PCB Relevance

不要只使用简单的 PCB keyword frequency。

识别：

```text
PCB
PCBA
printed circuit board
PCB assembly
electronics assembly
SMT
EMS
electronic manufacturing
circuit board
PCB design
```

但必须考虑上下文。

例如：

```text
"We manufacture PCBs"
```

不能因此判断它是 PCB Buyer。

这家公司可能本身就是：

```text
PCB manufacturer
```

如果目标客户是 PCB 的最终采购方，则应该成为 Negative Signal。

---

# 10. Company Size

Company Size 不再作为强 Buyer Fit 信号。

公司规模主要用于：

```text
Contact Ranking
```

例如：

### Startup

优先：

```text
Founder
CEO
CTO
Hardware Lead
Engineering Lead
```

### Medium Company

优先：

```text
Procurement
Purchasing
Sourcing
Supply Chain
Hardware Engineering
Manufacturing
Operations
```

### Large Company

优先：

```text
Strategic Sourcing
Procurement
Supply Chain
Commodity Manager
Hardware Engineering
Manufacturing
```

因此：

> Company Size 主要决定“找谁”，而不是“是不是客户”。

---

# 11. Demand Signal

增加结构化 Demand Signal。

Demand 最大 30 分。

分级：

## Tier 1 — Strong Demand

例如：

```text
RFQ
PCB sourcing
PCBA sourcing
looking for PCB supplier
supplier search
new hardware product
new hardware project
product launch
production expansion
manufacturing expansion
new factory
```

## Tier 2 — Medium Demand

例如：

```text
hiring Hardware Engineer
hiring Electronics Engineer
hiring PCB Design Engineer
engineering team expansion
new project
new factory
hardware-related funding
electronics engineering expansion
```

## Tier 3 — Weak Demand

例如：

```text
existing hardware product
electronics team
PCB mentioned
hardware product exists
electronics development capability
```

---

# 12. Demand Signal 不能只是字符串匹配

禁止简单实现：

```text
text.includes("PCB supplier")
```

必须考虑上下文。

例如：

### 应该识别为需求

> We are looking for a reliable PCB supplier for our new controller.

### 不应该识别为需求

> We help companies find reliable PCB suppliers.

第二家公司是服务商，不是 PCB Buyer。

因此 Demand Detection 至少考虑：

```text
keyword
+
context
+
company identity
+
company type
+
surrounding sentence
+
confidence
```

可以使用：

```text
Rule-based detection
+
LLM contextual classification
```

但最终必须输出结构化结果。

---

# 13. Negative Signal

增加 Negative Signal。

重点识别：

```text
PCB manufacturer
PCB supplier
PCB assembly provider
EMS
electronics manufacturing service
PCB distributor
pure software company
pure SaaS
recruitment company
agency
irrelevant service company
```

具体 Negative 类型应该放到独立模块，例如：

```text
scoring/negative.ts
```

不要把大量 negative rule 塞进一个巨大函数。

---

# 14. Negative 可以有两种结果

## Soft Negative

例如：

```text
相关性较低
```

进入：

```text
Negative Penalty
```

---

## Hard Negative

例如明确发现：

```text
PCB Manufacturer
EMS Provider
```

而当前目标是最终 PCB Buyer。

可以直接：

```text
excluded = true
```

这样：

```text
Final Score
```

仍然可以计算，但 Lead 不进入主要销售 Lead Pool。

必须支持未来通过业务配置改变这个行为。

不要把：

> PCB manufacturer = 永远排除

写死。

---

# 15. Evidence Model

这是本次非常重要的修改。

不要只保存：

```json
{
  "sourcesByField": {
    "products": [
      "https://example.com/products"
    ]
  }
}
```

这种 field-level source 不够。

需要升级成：

```text
Signal-level Evidence
```

推荐：

```json
{
  "signalType": "hardware_product",
  "description": "Industrial controller for factory automation",
  "snippet": "We develop industrial controllers...",
  "sourceUrl": "https://example.com/products",
  "sourceType": "website",
  "detectedAt": "2026-09-11T00:00:00Z",
  "confidence": 0.94
}
```

---

# 16. Evidence 类型

至少支持：

```text
industry_fit
hardware_product
pcb_relevance
demand
negative
company_fit
contact
```

例如：

```json
{
  "signalType": "demand",
  "description": "Company is hiring a Hardware Engineer",
  "snippet": "We are looking for a Hardware Engineer...",
  "sourceUrl": "https://example.com/careers",
  "sourceType": "website",
  "detectedAt": "...",
  "confidence": 0.91
}
```

这样系统以后才能解释：

```text
Why this company?
Why now?
```

---

# 17. Evidence Confidence 不要作为独立加分项

不要实现：

```text
Buyer Fit
+
Demand
+
Evidence
```

Evidence 不是价值。

Evidence 是：

> 对某个 Signal 的可信程度。

例如：

```text
RFQ Signal = 30
Confidence = 0.95
```

可以得到：

```text
Effective Demand = 28.5
```

而不是：

```text
RFQ = 30
Evidence = +10
```

---

# 18. Evidence 必须贯穿 Pipeline

推荐：

```text
Discovery
    ↓
Raw Company Data
    ↓
Signal Detection
    ↓
Evidence
    ↓
Scoring
    ↓
Explanation
```

不要最后才补 Evidence。

每个重要 Signal 在产生的时候就尽量绑定：

```text
signal
source
snippet
confidence
```

---

# 19. Lead Explanation

每个 Lead 都应该可以解释：

```text
Why this company?
Why now?
Who should I contact?
What evidence supports this?
```

例如：

```text
Score: 88
Grade: A

Why this company:
Industrial automation company developing electronic controllers.

Why now:
Recently hiring hardware engineers and launching a new controller product.

Evidence:
1. Product page
   https://example.com/products

2. Careers page
   https://example.com/careers
```

不要让 LLM 编造事实。

所有具体事实都应该能够追溯到 Evidence。

---

# 20. Personalized Email

保持现有 Personalized Email 能力。

但是修改其输入。

以前可能主要使用：

```text
Company Profile
+
Generic facts
```

现在优先使用：

```text
Current Demand Signal
+
Specific Product
+
Engineering Activity
+
Evidence
+
Company Profile
+
Supplier Capability
```

优先级：

```text
Current Demand Signal
>
Specific Product
>
Engineering Activity
>
Specific Company
>
Industry
>
Generic
```

这样 Email 才真正做到：

> Why them / Why now

---

# 21. Supplier Capability Matching

保持这个方向，但不要过度设计。

系统可以将客户需求与 PCB 供应商能力匹配，例如：

```text
Layer Count
PCB Type
Material
Surface Finish
HDI
Flex
Rigid-Flex
SMT
PCBA
Prototype
Small Batch
Mass Production
Certifications
Lead Time
MOQ
```

输出可以作为：

```text
Personalization Context
```

而不是新的核心 Score 维度。

---

# 22. Collector

继续使用现有：

```text
Brave Search
→ domain dedupe
→ website crawl
→ extraction
→ rule inference
→ DB
→ optional scoring
```

本次重点增加：

```text
Source URL preservation
Evidence extraction
Demand-related evidence
Negative-related evidence
```

不要重写 Collector。

---

# 23. Scorer

Scorer 继续作为 PCB Domain Logic 的主要位置。

建议结构：

```text
scoring/
├── buyer-fit.ts
├── demand.ts
├── negative.ts
├── evidence.ts
├── keywords.ts
└── score.ts
```

如果当前项目结构不同，可以适配现有代码。

不要为了目录形式进行无意义重构。

---

# 24. Database

根据现有数据库结构增量修改。

需要能够持久化：

```text
Buyer Fit
Demand Signal
Negative Signal
Final Score
Grade
Evidence
Excluded
```

如果 `lead_scores` 已经存在：

优先扩展现有表。

例如：

```text
lead_scores
├── score
├── grade
├── dimensionBreakdown
├── evidence
├── demandSignal
├── negativePenalty
└── excluded
```

具体字段名称以当前项目 ORM 规范为准。

不要无意义创建大量新表。

如果 `demand_signals` 独立表确实有业务价值，可以保留。

---

# 25. Score 输出必须保持可解释

最终结果至少应该能够看到：

```json
{
  "score": 87,
  "grade": "A",
  "buyerFit": 54,
  "demandSignal": 28,
  "negativePenalty": 0,
  "excluded": false
}
```

以及：

```json
{
  "dimensionBreakdown": {
    "industryFit": 13,
    "hardwareProductFit": 18,
    "pcbRelevance": 14,
    "companyFit": 9
  }
}
```

和：

```json
{
  "evidence": []
}
```

---

# 26. 不要把原有功能删掉

再次强调：

本次不是 MVP 收缩。

保持：

```text
Collector
Scorer
Profile
Contact
Content Generator
Mailer
Tracking
Follow-up
Dashboard
Analytics
Human Review
```

本次只是让这些模块使用更加准确的 PCB Domain Model。

---

# 27. Implementation Priority

按照：

```text
P0
```

完成：

1. Score normalization
2. Buyer Fit restructuring
3. Demand Signal
4. Negative Signal
5. Signal-level Evidence
6. Source URL preservation

然后：

```text
P1
```

完成：

7. Contact title extraction
8. Size-aware contact ranking
9. Supplier capability matching
10. Personalized content using Demand + Evidence
11. Dashboard Why Now / Evidence display

最后：

```text
P2
```

考虑：

12. Improved LLM scoring
13. More advanced demand discovery
14. Advanced attribution
15. Advanced campaign optimization

---

# 28. 特别注意 TASK-007

原 Implementation Plan 中：

> demand-oriented search keyword templates / RFQ search

不要直接作为 P0。

可以保留为未来能力，但不要让它成为当前 PCB alignment 的核心。

当前首先验证：

> 对普通海外公司进行 Discovery 后，系统能否准确识别 PCB Buyer + Demand Signal。

---

# 29. 验证要求

完成代码后，用真实数据进行：

```text
100–300 companies
```

验证。

人工标注：

```text
Is Buyer?
Is Current Demand?
Is Evidence Correct?
Is Contact Relevant?
Would Sales Contact?
```

重点观察：

```text
A Lead Precision
```

而不是单纯：

```text
Lead Volume
```

---

# 30. 最终执行原则

整个修改过程中遵循：

```text
保持现有产品范围
+
保持现有架构
+
增量修改
+
增强 PCB Domain Intelligence
+
提高 Lead Precision
+
保证每个重要判断都有 Evidence
```

不要把这个任务理解成：

> “重新做一个 PCB Lead Generation MVP”。

应该理解成：

> “在现有 pcb_auto_leadgen 产品上，把 PCB Lead Intelligence 做准确。”

---

# 31. 执行步骤

现在先：

1. 阅读所有相关文档。
2. 检查实际代码。
3. 对照现有 Implementation Plan。
4. 找出需要修改的具体文件。
5. 更新 `docs/pcb-alignment-audit.md`。
6. 更新 `docs/pcb-implementation-plan.md`。
7. 开始实施 P0。
8. 保留现有所有其他产品能力。
9. 完成后运行测试。
10. 用真实数据进行 100–300 条 Lead 的验证。

不要因为这次修改而重新设计整个系统。

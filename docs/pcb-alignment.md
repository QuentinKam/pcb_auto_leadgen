# PCB Domain Alignment

## 1. Purpose

本文档定义 pcb_auto_leadgen 面向 PCB/PCBA 外贸客户时需要具备的领域能力。

它不是产品总 Intent，也不是完整技术 Spec。

产品总目标、用户、边界和技术架构以：

* `intent.md`
* `spec.md`

为准。

本文档只描述：

> PCB/PCBA 行业的客户识别、需求判断、Lead Qualification、Demand Signal 和个性化销售所需要的领域规则。

---

# 2. Core Business Question

pcb_auto_leadgen 最终需要回答：

> **这个企业是不是一个值得 PCB/PCBA 销售人员主动联系的潜在客户？**

进一步回答：

> **为什么现在值得联系？**

因此 Lead Quality 应该由两个主要问题组成：

```text
PCB Buyer Fit
+
Current Demand / Buying Signal
```

而不仅仅是：

```text
Company Industry
```

---

# 3. Target Buyer

优先寻找可能自行设计、研发、采购或生产电子硬件产品的企业。

## Tier 1

高优先级：

* Robotics
* Industrial Automation
* IoT
* Consumer Electronics
* Medical Electronics
* Automotive Electronics
* Drones
* Smart Home
* Embedded Hardware
* Electronic Instruments
* Energy / Battery Systems
* Telecom Hardware
* Aerospace Electronics

## Tier 2

根据具体 PCB 制造能力判断：

* Industrial Equipment
* Security Equipment
* Sensors
* Test Equipment
* Scientific Equipment
* Power Electronics
* Control Systems
* Communication Equipment

## Low Priority

* Pure SaaS
* Software-only companies
* Digital agencies
* Marketing agencies
* IT consulting companies
* Generic service companies
* Companies with no identifiable hardware activity

---

# 4. PCB Buyer Signals

## Strong Signals

以下信号应该显著提高 PCB Buyer Score：

* PCB
* PCBA
* Printed Circuit Board
* Printed Circuit Boards
* PCB Assembly
* Electronics Assembly
* Electronic Manufacturing
* Circuit Board
* SMT
* EMS
* PCB Design
* Electronics Manufacturing

同时出现：

```text
Hardware Product
+
Electronics
```

应该进一步提高分数。

---

# 5. Product Signals

公司存在以下产品类型时，应提高 PCB Buyer Fit：

* Electronic devices
* Controllers
* Sensors
* IoT devices
* Robotics
* Industrial controllers
* Embedded systems
* Medical devices
* Consumer electronics
* Automotive electronics
* Communication devices
* Smart devices
* Battery management systems
* Power electronics

需要注意：

> 产品属于这些行业，不代表一定会外购 PCB。

系统应该将行业作为候选信号，而不是最终结论。

---

# 6. Engineering Signals

以下岗位是重要的 PCB 需求信号：

### Strong

* PCB Design Engineer
* Hardware Engineer
* Electronics Engineer
* Electrical Engineer
* Hardware Design Engineer

### Medium

* Embedded Engineer
* Firmware Engineer
* Electrical Engineering Manager
* Hardware Engineering Manager
* Electronics Engineering Manager
* R&D Engineer

工程岗位本身不能证明存在 PCB 采购需求。

但：

```text
Hardware hiring
+
Hardware product
+
Manufacturing / production evidence
```

组合出现时，应明显提高 Lead Score。

---

# 7. Procurement Signals

以下角色是优先联系对象：

1. Procurement Manager
2. Purchasing Manager
3. Strategic Sourcing Manager
4. Supply Chain Manager
5. Sourcing Manager
6. Manufacturing Manager
7. Operations Manager
8. Hardware Engineering Manager
9. Electronics Engineering Manager
10. Founder / CEO

小型硬件公司：

```text
Founder / CEO
```

可能比：

```text
Procurement Manager
```

更值得联系。

因此联系人优先级应该根据公司规模动态调整。

---

# 8. Demand Signals

Buyer Fit 解决：

> “这个公司可能采购 PCB 吗？”

Demand Signal 解决：

> “这个公司近期是否更可能产生 PCB/PCBA 采购需求？”

---

## Tier 1 — High Intent

* Explicit PCB supplier search
* Explicit PCBA supplier search
* RFQ
* PCB sourcing request
* PCBA sourcing request
* New hardware product
* New product launch
* Production expansion
* Manufacturing expansion
* New electronic product

---

## Tier 2 — Medium Intent

* Hardware Engineer hiring
* PCB Engineer hiring
* Electronics Engineer hiring
* New hardware project
* New factory
* New manufacturing facility
* Production expansion
* Hardware startup funding
* New product development

---

## Tier 3 — Weak Intent

* Existing hardware products
* Embedded products
* Electronics engineering team
* PCB terminology on website
* Existing manufacturing activity

---

# 9. Evidence Requirement

重要 Lead 判断必须尽可能拥有证据。

推荐结构：

```json
{
  "signalType": "hiring",
  "description": "Hiring Senior Hardware Engineer",
  "sourceUrl": "https://...",
  "detectedAt": "...",
  "confidence": 0.92
}
```

系统应该能够回答：

```text
为什么这个 Lead 得到 87 分？
```

例如：

```text
Score: 87

+25 Hardware product
+20 Robotics industry
+20 Hardware Engineer hiring
+15 Manufacturing evidence
+10 Valid business email
-3 Weak company-size evidence
```

---

# 10. Lead Qualification

PCB Lead 不应该只根据单一关键词判断。

推荐逻辑：

```text
Industry Fit
+
Hardware Fit
+
PCB Relevance
+
Demand Signal
+
Company Quality
+
Contactability
+
Evidence Confidence
-
Negative Signals
```

最终：

```text
0-49   C
50-74  B
75-89  A
90-100 A+
```

现有 `spec.md` 中已经定义：

```text
A >= 75
B = 50-74
C < 50
```

如果实现时需要调整分级，必须先更新 Spec，不应直接在代码中改变业务规则。

---

# 11. Evidence Quality

证据优先级：

```text
Official company website
>
Official product page
>
Official job posting
>
Official company announcement
>
Reputable business database
>
Search engine snippet
>
Third-party directory
```

尽量避免仅根据搜索摘要做强结论。

---

# 12. Company Size

公司规模应该作为辅助变量。

目标客户不应简单限制为：

```text
50-500 employees
```

因为 PCB 买家可能包括：

### Startup

员工：

10-50

特点：

* Founder 主导采购
* 新产品开发
* Prototype 需求强

### Growth Company

员工：

50-500

特点：

* Hardware team
* Procurement
* Multiple products
* Supplier qualification

### Larger Company

员工：

500+

特点：

* Procurement / sourcing 流程复杂
* Supplier onboarding 周期更长
* 订单规模可能更大

因此：

> 公司规模应该影响联系人选择和销售策略，而不是简单决定是否为 Lead。

---

# 13. Company Type

系统应尽可能区分：

```text
End Customer
PCB Manufacturer
PCB Distributor
EMS
Design House
Contract Manufacturer
Hardware Startup
Hardware Brand
Research Organization
```

默认情况下：

> PCB/PCBA 制造商自身不是 PCB 产品终端买家，应避免作为普通 Lead。

但如果未来产品支持：

```text
Supplier Partnership
Subcontracting
Overflow Manufacturing
```

则可以重新定义目标。

---

# 14. Contact Matching

联系人匹配应考虑：

```text
Company Size
+
Lead Type
+
Person Role
```

例如：

### Startup

优先：

```text
Founder
CEO
CTO
Hardware Lead
```

### Medium Hardware Company

优先：

```text
Procurement
Purchasing
Sourcing
Hardware Engineering
Supply Chain
```

### Large Company

优先：

```text
Strategic Sourcing
Procurement
Supplier Quality
Supply Chain
Commodity Manager
Hardware Engineering
```

---

# 15. Personalized Outreach

邮件个性化的核心不是替换：

```text
{{company}}
{{name}}
```

而是利用：

```text
Company
+
Product
+
Role
+
Demand Signal
+
Evidence
+
Supplier Capability
```

生成联系理由。

---

# 16. Personalization Priority

优先级：

```text
Current Demand Signal
>
Specific Product
>
Specific Engineering Activity
>
Specific Company
>
Industry
>
Generic Company Description
```

例如：

低价值：

> We are a professional PCB manufacturer with 10 years of experience.

高价值：

> I noticed your team is currently expanding its hardware engineering group around your robotics products.

前提：

> 该信息必须有可靠证据。

---

# 17. Email Quality Requirements

邮件应该：

* 短
* 具体
* 有事实依据
* 与收件人的职位相关
* 与 PCB/PCBA 需求相关
* 有低摩擦 CTA

避免：

* 大段公司介绍
* 泛泛介绍 PCB 能力
* 虚构客户
* 虚构需求
* 虚构项目
* 虚构采购时间
* AI 味明显的长文
* 无证据的“noticed that...”

---

# 18. Supplier Capability Matching

如果客户配置了自己的 PCB 能力：

```text
Layer Count
Board Type
Material
Copper Thickness
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
Turnaround Time
MOQ
Target Market
```

个性化邮件应该优先匹配：

```text
Customer Need
        ↓
Supplier Capability
```

例如：

```text
Customer:
4-layer industrial controller

Supplier:
4-12 layer
FR-4
SMT
PCBA
Prototype + Small Batch

→ Relevant
```

不要无依据地向客户推销所有能力。

---

# 19. Lead Explanation

Dashboard 中每个高质量 Lead 至少应该能够展示：

```text
Why this company?

Why now?

Who should I contact?

What evidence supports this?

What should I say?

What capability is relevant?
```

目标：

> 销售人员打开 Lead 后，不需要重新研究客户，就能决定是否联系。

---

# 20. Feedback Loop

系统应该记录：

```text
AI Score
↓
Human Override
↓
Email Sent
↓
Reply
↓
Positive Reply
↓
Inquiry
↓
Opportunity
↓
Customer
```

人工改级必须保存：

```text
originalScore
newScore
reason
user
timestamp
```

这些数据未来用于优化：

* Rule weights
* Lead scoring
* Signal importance
* Contact ranking
* Email personalization

---

# 21. Priority

如果只能优化一个变量：

> **Qualified Lead Precision**

优先提高：

```text
100 raw leads
↓
20 genuinely relevant leads
```

而不是：

```text
100 raw leads
↓
1000 raw leads
```

如果 Lead 本身不准确，后续：

```text
AI email
Email automation
CRM
Dashboard
```

都会放大无效工作。

---

# 22. MVP Domain Priority

第一阶段只需要验证：

```text
企业发现
↓
PCB Buyer Qualification
↓
Evidence
↓
Lead Score
↓
Contact
↓
Personalized Email
```

暂时不要因为 PCB Domain Document 增加：

* 新 CRM
* 新营销自动化
* 新消息渠道
* 新 AI Agent
* 新微服务

除非现有架构无法支持。

---

# 23. Domain Principle

最终目标不是：

> 找到更多公司。

而是：

> **找到更可能采购 PCB/PCBA、当前存在需求信号、能够找到合适联系人，并且值得销售人员投入时间的公司。**

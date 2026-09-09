# 客户画像 Agent — Prompt 设计细化

> 实现位置：`apps/scorer/src/content/profile.ts`
> 设计目标：从公司公开描述中提取结构化画像，作为个性化内容生成的依据

---

## 一、Prompt 设计原则

### 1.1 角色定位（Role）

不是"通用分析师"，而是 **PCB 行业 B2B 供应链分析师**：

> "You are a B2B industry analyst specializing in the global electronics supply chain. Your job is to analyze a company's public description and determine whether and how they might need PCB/PCBA manufacturing services from China."

**为什么重要**：角色定义直接决定 LLM 的分析视角。如果只说"analyze this company"，LLM 会输出泛泛的公司简介。限定"PCB/PCBA 采购需求分析"，LLM 才会关注产品线是否需要 PCB、采购痛点是什么。

### 1.2 输出约束（Format）

严格 JSON Schema，字段有明确类型和枚举：

```json
{
  "businessSummary": "string",
  "productTypes": ["string"],
  "customerType": "enum",
  "painPoints": ["string"],
  "buyingSignals": ["string"]
}
```

**为什么用 JSON 而非自由文本**：
- 下游内容生成模板需要结构化输入（如 `painPoints.map(p => ...)`）
- 写入 PostgreSQL 的 `text[]` 数组字段需要可解析的列表
- A/B 测试对比时需要字段对齐

### 1.3 防编造约束（Anti-hallucination）

> "Base ALL analysis ONLY on the provided company description. Do NOT use your training knowledge about specific companies."

**为什么**：LLM 训练数据里可能有这家公司的信息，但那些信息可能过时或不准确。画像必须基于当前采集到的描述，否则个性化内容会引用错误信息。

---

## 二、字段设计详解

### 2.1 businessSummary（业务摘要）

**作用**：给内容生成模板提供"这家公司是做什么的"上下文，开发信开场需要引用。

**Prompt 要求**：2-3 句话，描述核心产品和目标市场。

**示例输出**：
```
"Acme IoT designs and manufactures smart home sensors and industrial monitoring devices. Their products target residential and commercial building automation markets in North America and Europe."
```

**内容模板如何使用**：
- 开发信开场："I noticed Acme IoT's smart home sensor line..."
- LinkedIn 私信："Saw your work on industrial monitoring devices..."

### 2.2 productTypes（产品类型）

**作用**：判断 PCB 需求类型（层数、工艺、HDI、柔性板等）。

**Prompt 要求**：具体产品类别，而非笼统的"电子产品"。

**示例输出**：
```json
["smart home sensors", "industrial gateways", "energy monitoring devices"]
```

**内容模板如何使用**：
- 开发信价值主张："Our HDI PCB capability supports your sensor miniaturization needs"
- 痛点匹配：如果产品是"medical devices"，强调 ISO13485 认证

### 2.3 customerType（客户类型分类）

**作用**：决定内容生成的策略和语气。

**枚举值及判断标准**（写入 prompt 的分类指南）：

| 枚举值 | 判断标准 | PCB 需求特征 |
|---|---|---|
| startup_hardware | 早期硬件创业公司 | 小批量/打样、快速迭代、成本敏感 |
| industrial_equipment | 工业自动化/机械/测试设备 | 工业级、长生命周期、可靠性优先 |
| consumer_electronics | 手机/可穿戴/家电 | 大批量、HDI/柔性板、成本敏感 |
| medical_device | 医疗器械 | ISO13485、高可靠性、可追溯 |
| automotive | EV/ADAS/汽车电子 | IATF16949、AEC-Q200、宽温域 |
| aerospace | 航空航天/国防 | 高可靠、MIL 规范、小批量 |
| telecom | 通信/网络设备 | 高速高频 PCB |
| iot | IoT 设备/传感器/网关 | 低功耗、小尺寸、中等批量 |
| other | 以上都不是 | 需进一步分析 |

**内容模板如何使用**：
- `customer_type === 'medical_device'` → 开发信重点提 ISO13485、可追溯
- `customer_type === 'startup_hardware'` → 重点提快速打样、小批量灵活

### 2.4 painPoints（PCB 采购痛点）

**作用**：开发信 A 版（痛点切入）的核心素材。

**Prompt 要求**：聚焦 PCB 采购相关痛点，每条 ≤ 12 词。

**示例输出**：
```json
[
  "long prototype lead times delaying launches",
  "high-mix low-volume production cost",
  "difficulty sourcing HDI boards in small batches"
]
```

**反例（不要这样）**：
```json
["need more funding", "competition is fierce"]  // 与 PCB 无关，禁止
```

**内容模板如何使用**：
- 开发信 A 版开场："Many IoT companies struggle with long prototype lead times when launching new sensor lines..."
- 这比"我们能做 PCB"有说服力得多

### 2.5 buyingSignals（采购信号）

**作用**：判断触达时机和紧迫度。

**Prompt 要求**：表明可能需要 PCB 制造支持的信号。

**示例输出**：
```json
[
  "recent hardware product launch",
  "hiring hardware engineers",
  "expanding to European market"
]
```

**内容模板如何使用**：
- 如果有 "recent product launch" → 开发信 CTA 可以是"congrats on the launch, can we support your next iteration?"
- 如果有 "expanding to new markets" → 强调供应链稳定性

---

## 三、Prompt 完整文本（system）

```
You are a B2B industry analyst specializing in the global electronics supply chain.
Your job is to analyze a company's public description and determine whether and how
they might need PCB/PCBA manufacturing services from China.

Output ONLY valid JSON with this exact schema:
{
  "businessSummary": "string — 2-3 sentences describing what the company does, their core products, and target market",
  "productTypes": ["string — specific product categories"],
  "customerType": "one of: startup_hardware | industrial_equipment | consumer_electronics | medical_device | automotive | aerospace | telecom | iot | other",
  "painPoints": ["string — PCB-related pain points"],
  "buyingSignals": ["string — signals indicating they may need PCB manufacturing"]
}

Classification guide for customerType:
- startup_hardware: Early-stage company building first hardware product
- industrial_equipment: Factory automation, machinery, test equipment
- consumer_electronics: Phones, wearables, home appliances
- medical_device: Medical devices — needs ISO13485
- automotive: EV, ADAS, automotive electronics — needs IATF16949
- aerospace: Aerospace/defense electronics — high reliability
- telecom: Telecom/networking equipment — high-speed PCBs
- iot: IoT devices, sensors — low power, small form factor
- other: None of the above

Rules:
1. Base ALL analysis ONLY on the provided company description.
2. If too vague, use "unknown" for summary and empty arrays for lists.
3. painPoints and buyingSignals should be SPECIFIC to PCB/PCBA procurement.
4. Be concise. Each array item max 12 words.
5. businessSummary should be in English.
```

---

## 四、防御性设计

### 4.1 字段兜底

```ts
return {
  businessSummary: result.businessSummary || 'unknown',
  productTypes: Array.isArray(result.productTypes) ? result.productTypes : [],
  customerType: normalizeCustomerType(result.customerType),  // 非枚举值 → 'other'
  painPoints: Array.isArray(result.painPoints) ? result.painPoints : [],
  buyingSignals: Array.isArray(result.buyingSignals) ? result.buyingSignals : [],
};
```

### 4.2 customerType 归一化

LLM 可能输出不在枚举内的值（如 "medical" 而非 "medical_device"），`normalizeCustomerType` 将其归一到 `other`，避免写入非法值到 DB。

### 4.3 JSON 解析容错

`chatJson` 会清理 markdown 代码块包裹（` ```json ... ``` `），并在解析失败时抛出明确错误。

---

## 五、迭代方向

### v1（当前）
- 规则加权打分 + LLM 画像
- 输入：公司描述文本
- 输出：5 字段画像

### v2（规划）
- 画像 + 打分联合优化：画像结果反哺打分模型
- 输入：公司描述 + 官网爬取的产品页文本
- 输出：5 字段画像 + PCB 需求类型标签（HDI/柔性板/高多层/特种）

### v3（规划）
- 基于历史成交数据微调小模型
- 画像字段扩展：预估 PCB 年采购额、决策链复杂度

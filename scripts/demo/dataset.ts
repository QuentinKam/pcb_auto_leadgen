/**
 * 演示数据集（纯静态数据，无副作用）
 *
 * 设计原则：
 * 1. 离线可用：不依赖 LLM / 网络，种子脚本秒级跑完，开会前 10 秒就能准备好
 * 2. 分级完整：A/B/C 三档都有，且含 2 条"人工覆盖"记录，方便演示覆盖弹窗
 * 3. 画像齐全：每家公司都有 profile，点开「内容审核」立刻有内容，不会空屏
 * 4. 草稿分层：部分公司预置 A/B 开发信（保证不空屏），部分留空（现场演示真实生成）
 * 5. 可识别：公司 rawPayload.demo=true，reset 时按此标记精确回滚
 */

export type DemoGrade = 'A' | 'B' | 'C';

/** 草稿预置档位：full=开发信A/B+LinkedInA/B，email=仅开发信A/B，none=留空给现场生成 */
export type DraftSet = 'full' | 'email' | 'none';

export interface DemoDraftCopy {
  subject: string;
  body: string;
}

export interface DemoCompanySeed {
  slug: string;
  name: string;
  website: string;
  industry: string;
  sizeBucket: string;
  employeeCount: number;
  fundingStage: string;
  country: string;
  description: string;
  score: number;
  grade: DemoGrade;
  reason: string;
  contact: { name: string; title: string; local: string };
  profile: {
    businessSummary: string;
    productTypes: string[];
    customerType: string;
    painPoints: string[];
    buyingSignals: string[];
  };
  usedFacts: string[];
  gaps: string[];
  draftSet: DraftSet;
  /** 有则额外插一条覆盖记录（演示「人工改级」） */
  override?: { finalGrade: DemoGrade; reason: string };
  /** 开发信 A/B 文案（draftSet !== 'none' 时必填） */
  coldEmail?: { a: DemoDraftCopy; b: DemoDraftCopy };
  /** LinkedIn 私信 A/B 文案（draftSet === 'full' 时必填） */
  linkedin?: { a: DemoDraftCopy; b: DemoDraftCopy };
}

export const DEMO_TAG = 'pcb-demo-v1';

export const DEMO_COMPANIES: DemoCompanySeed[] = [
  {
    slug: 'volterra-robotics',
    name: 'Volterra Robotics',
    website: 'https://volterra-robotics.example',
    industry: 'Industrial Automation',
    sizeBucket: '201-500',
    employeeCount: 340,
    fundingStage: 'b',
    country: 'United States',
    description:
      'Volterra Robotics builds autonomous mobile robots and pick-and-place cells for warehouse and cold-chain logistics. Their robots run 24/7 in food distribution centers, so control boards must survive condensation, vibration and wide temperature swings. They ship roughly 4,000 robots per year and outsource all PCB assembly.',
    score: 88,
    grade: 'A',
    reason:
      '工业自动化整机厂，机器人年出货量高，控制板/驱动板全外协，且明确要求宽温与三防工艺，与 IATF16949 + HDI 能力高度匹配',
    contact: { name: 'Marcus Feld', title: 'Director of Hardware Engineering', local: 'm.feld' },
    profile: {
      businessSummary:
        '美国仓储与冷链物流机器人厂商，自研 AMR 与抓取单元，年出货约 4,000 台，控制类 PCB 全部外协。',
      productTypes: ['Motor Control Board', 'Sensor Interface Board', 'Power Distribution Board'],
      customerType: 'industrial_equipment',
      painPoints: [
        '冷链环境冷凝导致控制板腐蚀失效，返修率高',
        '现有 PCB 供应商交期 6-8 周，拖慢整机交付',
        '缺乏 IATF16949 体系供应商，无法进入车厂联合项目',
      ],
      buyingSignals: [
        '官网招聘 3 个硬件工程师岗位，明确提到"supplier qualification"',
        '近 6 个月发布两代新机型，BOM 处于重新选型窗口',
      ],
    },
    usedFacts: ['F-016', 'F-021', 'F-034'],
    gaps: ['need current copper price volatility data'],
    draftSet: 'full',
    coldEmail: {
      a: {
        subject: 'Condensation failures on AMR control boards — a process fix',
        body: `Hi Marcus,

Saw that Volterra's AMRs run in cold-chain distribution centers. That environment is brutal on control boards: condensation between layers plus continuous vibration is one of the most common causes of field failures we see in warehouse robotics.

We build 4-32 layer PCBs and full PCBA for industrial automation customers, with ISO9001 + IATF16949 + ISO13485 in-house. For cold-chain duty we usually recommend a conformal coating step and an FR-4 high-Tg stackup, which has cut moisture-related returns substantially for similar programs.

Two things that might be useful:
- Prototype turnaround in 3-7 days, so your next board revision is not blocked
- IPC-A-610 Class 3 inspection with photo reports on every lot

Would a 20-minute technical call be worth it? I can bring our process engineer and walk through the coating options against your condensation spec.

Best regards,
Sales Team
GAN PCB Manufacturing`,
      },
      b: {
        subject: 'Cutting 6-8 week PCB lead time for Volterra robot builds',
        body: `Hi Marcus,

A robotics customer of ours in the same 4,000-units-a-year range was losing deals because control board lead time sat at 7 weeks. We moved them to a 2-4 week mass production cadence with prototypes in 3-7 days, and their assembly line stopped waiting on boards.

We run 4-32 layer PCB plus PCBA one-stop out of one factory — ISO9001, IATF16949 and ISO13485 certified — so the board house and the assembly line do not blame each other when something slips.

For Volterra specifically, the interesting part is the cold-chain duty cycle. We would propose a high-Tg stackup with conformal coating, which is what we use for customers whose boards see condensation and vibration together.

Would you be open to sending one board's Gerber and stackup for a no-cost DFM review? You would get a written report on cost and reliability risks, no obligation.

Best regards,
Sales Team
GAN PCB Manufacturing`,
      },
    },
    linkedin: {
      a: {
        subject: '',
        body: `Hi Marcus — saw Volterra's AMRs are deployed in cold-chain DCs. Condensation plus vibration is a rough combination for control boards. We build 4-32 layer PCB/PCBA for industrial robotics with IATF16949 in-house. Curious: is moisture-related field failure something you're actively chasing right now?`,
      },
      b: {
        subject: '',
        body: 'Hi Marcus — we put together a short write-up on high-Tg stackups plus conformal coating for robotics boards that see condensation. Happy to send it over, no pitch attached. We build 4-32 layer PCB and PCBA for industrial automation customers. Want me to share it?',
      },
    },
  },

  {
    slug: 'helix-medical-devices',
    name: 'Helix Medical Devices',
    website: 'https://helixmedical.example',
    industry: 'Medical Devices',
    sizeBucket: '51-200',
    employeeCount: 140,
    fundingStage: 'a',
    country: 'United States',
    description:
      'Helix Medical Devices develops wearable cardiac monitoring patches and handheld ultrasound probes. Products are FDA Class II, requiring full traceability, ISO13485 manufacturing and biocompatible materials. They are scaling from pilot production to commercial launch next year.',
    score: 84,
    grade: 'A',
    reason:
      '医疗器械整机厂，FDA Class II 产品放量在即，必须有 ISO13485 供应商与完整可追溯性，客户画像痛点与我们的资质完全对口',
    contact: { name: 'Dana Whitfield', title: 'VP Operations', local: 'd.whitfield' },
    profile: {
      businessSummary:
        '美国可穿戴心脏监测贴片与手持超声探头厂商，产品为 FDA Class II，正从试产转向商业化量产。',
      productTypes: ['Flexible PCB', 'Rigid-Flex PCB', 'HDI Board'],
      customerType: 'medical_device',
      painPoints: [
        '柔性板在反复弯折后出现微裂纹，影响信号稳定性',
        '缺少 ISO13485 供应商，审计文档不齐备',
        '试产到量产的良率爬坡缺乏工艺数据支撑',
      ],
      buyingSignals: [
        '官网发布 commercial launch 招聘（QA/RA 岗位多个）',
        '近期完成 A 轮融资，明确用于产能扩张',
      ],
    },
    usedFacts: ['F-008', 'F-041'],
    gaps: [],
    draftSet: 'full',
    coldEmail: {
      a: {
        subject: 'Flex PCB micro-cracking on wearables — traceability included',
        body: `Hi Dana,

Congratulations on the A round. Scaling a wearable cardiac patch from pilot to commercial usually surfaces one problem first: flexible circuits that pass bend testing in the lab and then micro-crack in the field.

We build flexible and rigid-flex PCBs for medical customers under ISO13485, alongside ISO9001 and IATF16949. That means lot traceability, documented process controls and audit-ready records — the paperwork side that usually stalls a Class II supplier qualification.

For wearable patches specifically, we would look at your bend radius and dynamic flex requirements before choosing the coverlay and copper thickness. That conversation is usually where the micro-cracking is designed out.

Would you like our medical capability pack? It includes the ISO13485 certificate, a sample traceability record and our typical DFM checklist for flex designs.

Best regards,
Sales Team
GAN PCB Manufacturing`,
      },
      b: {
        subject: 'ISO13485 flex/rigid-flex partner for Helix commercial launch',
        body: `Hi Dana,

Most Class II programs we take on arrive with the same blocker: the product is ready but the supplier's quality system is not. Auditors ask for process validation records, lot traceability and change control, and a board shop without ISO13485 cannot produce them.

We hold ISO9001, IATF16949 and ISO13485, and we run flexible, rigid-flex and HDI boards with PCBA one-stop. Our medical customers typically start with a small prototype lot in 3-7 days so the design can be frozen before mass production tooling is committed.

Given Helix is moving toward commercial launch, the useful next step is usually a documentation review rather than a price quote — confirming your QA team is satisfied with our traceability format before anything is ordered.

Would you like me to send the certificate pack and a sample device history record?

Best regards,
Sales Team
GAN PCB Manufacturing`,
      },
    },
    linkedin: {
      a: {
        subject: '',
        body: 'Hi Dana — congrats on the A round. Scaling a wearable patch to commercial usually surfaces flex micro-cracking first. We build flexible and rigid-flex PCB under ISO13485 with full lot traceability. Is supplier qualification documentation a current bottleneck for you?',
      },
      b: {
        subject: '',
        body: 'Hi Dana — we put together a medical capability pack: ISO13485 certificate, a sample device history record, and our DFM checklist for dynamic-flex designs. Useful for the Helix launch? We build flex, rigid-flex and HDI with PCBA one-stop. Happy to send it, no pitch.',
      },
    },
  },

  {
    slug: 'northwind-automotive-electronics',
    name: 'Northwind Automotive Electronics',
    website: 'https://northwind-auto.example',
    industry: 'Automotive',
    sizeBucket: '501-1000',
    employeeCount: 720,
    fundingStage: 'ipo',
    country: 'Germany',
    description:
      'Northwind Automotive Electronics supplies body control modules, LED drivers and ADAS sensor boards to European OEMs and Tier 1s. They are IATF16949 certified themselves and audit every PCB supplier against PPAP requirements.',
    score: 81,
    grade: 'A',
    reason:
      '德国汽车电子一级供应商，IATF16949 + PPAP 强要求，采购量稳定且对 HDI/厚铜工艺有明确需求',
    contact: { name: 'Anke Brandt', title: 'Head of Supplier Quality', local: 'a.brandt' },
    profile: {
      businessSummary:
        '德国汽车电子供应商，向欧洲主机厂与 Tier 1 提供车身控制模块、LED 驱动与 ADAS 传感器板。',
      productTypes: ['HDI Board', 'Heavy Copper PCB', 'LED Driver Board'],
      customerType: 'automotive',
      painPoints: [
        '现有 PCB 供应商 PPAP 文件反复退回，量产节点受压',
        'ADAS 板 HDI 层数上升，良率波动',
        '欧盟碳排与 RoHS 合规文件需要逐批提供',
      ],
      buyingSignals: [
        '官网供应商门户开放"PCB & PCBA"类目注册',
        '新产线投产新闻，指向 ADAS 传感器板扩产',
      ],
    },
    usedFacts: ['F-012', 'F-027'],
    gaps: ['need Northwind-specific PPAP element checklist'],
    draftSet: 'email',
    coldEmail: {
      a: {
        subject: 'PPAP-ready PCB supply for Northwind ADAS boards',
        body: `Hi Anke,

Supplier quality teams in automotive tell us the same thing: the PCB vendor that wins on price is rarely the one that passes PPAP without three rounds of document rework.

We are IATF16949 certified and build HDI and heavy copper boards for automotive customers, with PPAP documentation prepared as part of the standard flow rather than as an afterthought. Prototypes run 3-7 days; mass production sits at 2-4 weeks.

Given Northwind's ADAS sensor board ramp, the two areas we would focus on are HDI layer-count yield and the traceability format your auditors expect.

Would a short call with our quality lead be useful? We can walk through a real PPAP pack we submitted for a Tier 1 program, redactions as needed.

Best regards,
Sales Team
GAN PCB Manufacturing`,
      },
      b: {
        subject: 'HDI yield stability on ADAS sensor boards',
        body: `Hi Anke,

As ADAS boards move up in layer count, HDI yield becomes the line item that decides whether a program stays on schedule. We have seen yield swing 15 points between suppliers on the same Gerber, purely from lamination and via-fill process control.

Northwind is IATF16949 certified, so we can skip the basics. What matters is that we hold ISO9001, IATF16949 and ISO13485 in-house, run 4-32 layer HDI with heavy copper capability, and provide RoHS and carbon documentation per batch for EU compliance.

If it is useful, send one ADAS board's stackup. We will return a written DFM note on the yield risks we see and the process controls we would apply — no quote attached.

Best regards,
Sales Team
GAN PCB Manufacturing`,
      },
    },
  },

  {
    slug: 'aurora-grid-systems',
    name: 'Aurora Grid Systems',
    website: 'https://auroragrid.example',
    industry: 'Energy / Smart Grid',
    sizeBucket: '201-500',
    employeeCount: 260,
    fundingStage: 'c',
    country: 'United States',
    description:
      'Aurora Grid Systems builds smart meters, grid-edge controllers and energy storage inverters for utility deployments. Boards must meet UL and ANSI requirements and survive 20-year outdoor service life.',
    score: 72,
    grade: 'B',
    reason: '智能电网设备商，厚铜与大电流板需求明确，UL 认证要求高，采购节奏受公用事业招标周期影响',
    contact: { name: 'Priya Raman', title: 'Director of Supply Chain', local: 'p.raman' },
    profile: {
      businessSummary:
        '美国智能电网设备商，产品含智能电表、电网边缘控制器与储能逆变器，面向公用事业批量部署。',
      productTypes: ['Heavy Copper PCB', 'Power Board', 'Control Board'],
      customerType: 'industrial_equipment',
      painPoints: [
        '大电流板上厚铜与孔壁镀层一致性不足，温升超标',
        'UL 认证材料变更需要重新送样，周期长',
        '公用事业招标波动导致订单批量不稳定',
      ],
      buyingSignals: ['近期获得公用事业储能项目订单公告', '招聘电力电子工程师，指向逆变器新产品线'],
    },
    usedFacts: ['F-005', 'F-018'],
    gaps: [],
    draftSet: 'email',
    coldEmail: {
      a: {
        subject: 'Heavy copper consistency for Aurora inverter boards',
        body: `Hi Priya,

On energy storage inverters, the failure mode we see most often is not a design error — it is heavy copper plating that varies across the panel, which shows up later as hot spots and thermal derating in the field.

We build heavy copper and power boards for grid and energy customers, 4-32 layers, with ISO9001 and IATF16949 processes. For 20-year outdoor service life, the stackup and via fill choices matter more than the copper weight on the drawing.

Aurora's utility deployments have long qualification cycles, so it usually helps to settle the process window early rather than after a UL submission.

Would it be useful to review one of your inverter boards against our heavy copper process limits? We would send back a written assessment.

Best regards,
Sales Team
GAN PCB Manufacturing`,
      },
      b: {
        subject: 'Shorter re-qualification cycle on grid hardware',
        body: `Hi Priya,

A grid hardware customer of ours was losing 10-12 weeks every time a material change forced a UL re-submission. We cut that by locking the material set and documenting equivalence up front, so most changes became a paper exercise rather than a new sample round.

We build heavy copper, power and control boards for energy customers with UL-relevant material traceability, ISO9001 and IATF16949 in-house. Prototypes in 3-7 days, mass production 2-4 weeks.

Given Aurora's utility bid cycles, having a PCB partner who can absorb a material change without restarting qualification is usually worth more than a few percent on unit price.

Happy to send our material declaration pack if that would help your next submission.

Best regards,
Sales Team
GAN PCB Manufacturing`,
      },
    },
  },

  {
    slug: 'kestrel-aerospace-components',
    name: 'Kestrel Aerospace Components',
    website: 'https://kestrel-aero.example',
    industry: 'Aerospace',
    sizeBucket: '51-200',
    employeeCount: 180,
    fundingStage: 'b',
    country: 'United Kingdom',
    description:
      'Kestrel Aerospace Components produces avionics interface units and satellite bus electronics. They require AS9100-class quality evidence, high-reliability materials and traceability for every lot.',
    score: 68,
    grade: 'B',
    reason: '航空电子小批量高可靠性需求，材料与追溯要求严苛，单量偏小但单价与粘性高',
    contact: { name: 'Oliver Hayes', title: 'Head of Engineering', local: 'o.hayes' },
    profile: {
      businessSummary:
        '英国航空电子与卫星总线电子厂商，小批量高可靠性产品，AS9100 级质量文件要求。',
      productTypes: ['High Reliability PCB', 'Rigid-Flex PCB', 'RF Board'],
      customerType: 'aerospace',
      painPoints: [
        '小批量高可靠性订单难找愿意接的板厂',
        '需要每批材料可追溯与辐照/真空环境适配验证',
        '项目周期长，供应商中途退出风险高',
      ],
      buyingSignals: ['获得卫星总线下游合同', '官网招标页新增电子件采购类目'],
    },
    usedFacts: ['F-003'],
    gaps: ['need AS9100-equivalent certification status confirmation'],
    draftSet: 'none',
  },

  {
    slug: 'lumen-audio-labs',
    name: 'Lumen Audio Labs',
    website: 'https://lumenaudio.example',
    industry: 'Consumer Electronics',
    sizeBucket: '11-50',
    employeeCount: 38,
    fundingStage: 'seed',
    country: 'United States',
    description:
      'Lumen Audio Labs designs premium wireless speakers and portable DAC/amp products. They crowdfund and sell direct-to-consumer, with tight industrial design constraints that push toward rigid-flex and HDI.',
    score: 63,
    grade: 'B',
    reason: '消费音频品牌，外观驱动强，HDI/刚挠结合需求明确，但单量偏小且价格敏感',
    contact: { name: 'Sofia Marchetti', title: 'Co-founder & CTO', local: 's.marchetti' },
    profile: {
      businessSummary:
        '美国高端无线音箱与便携 DAC 品牌，众筹起家、DTC 销售，工业设计约束推动刚挠结合与 HDI 选型。',
      productTypes: ['Rigid-Flex PCB', 'HDI Board', 'Audio Board'],
      customerType: 'consumer_electronics',
      painPoints: [
        '众筹交付节点硬，样板与量产衔接不能断档',
        '成本压力大，希望在保证外观的前提下压缩板费',
        '小批量多批次改版，NRE 摊销困难',
      ],
      buyingSignals: ['下一代产品众筹预热页面已上线', '官网招聘硬件工程师，指向新音频平台'],
    },
    usedFacts: ['F-022'],
    gaps: [],
    draftSet: 'none',
  },

  {
    slug: 'corvus-defense-systems',
    name: 'Corvus Defense Systems',
    website: 'https://corvusdef.example',
    industry: 'Defense',
    sizeBucket: '201-500',
    employeeCount: 410,
    fundingStage: 'c',
    country: 'United States',
    description:
      'Corvus Defense Systems builds ruggedized tactical communication units and secure edge compute modules for government programs. Procurement is program-based with long qualification cycles.',
    score: 59,
    grade: 'B',
    reason: '国防项目型采购，周期长但与单一供应商绑定后粘性极强，需 ITAR/出口合规确认',
    contact: { name: 'Victor Alonso', title: 'Director of Procurement', local: 'v.alonso' },
    profile: {
      businessSummary: '美国国防战术通信与加固边缘计算模块厂商，政府项目制采购，认证周期长。',
      productTypes: ['Ruggedized PCB', 'Heavy Copper PCB', 'RF Board'],
      customerType: 'industrial_equipment',
      painPoints: [
        '加固设备热管理压力大，厚铜板温升是瓶颈',
        '供应商需满足出口合规与产地要求',
        '项目周期长，供应商中途更换成本极高',
      ],
      buyingSignals: ['获得政府战术通信项目合同', '招聘供应链合规专员'],
    },
    usedFacts: ['F-009'],
    gaps: ['need ITAR / export control eligibility confirmation'],
    draftSet: 'none',
    override: {
      finalGrade: 'A',
      reason: '已确认 Corvus 新项目预算批复，年采购额约 80 万美元，业务员手动上调为 A',
    },
  },

  {
    slug: 'verdant-iot',
    name: 'Verdant IoT',
    website: 'https://verdant-iot.example',
    industry: 'AgTech / IoT',
    sizeBucket: '11-50',
    employeeCount: 46,
    fundingStage: 'a',
    country: 'Netherlands',
    description:
      'Verdant IoT builds soil sensor networks and greenhouse climate controllers. Devices are battery powered and deployed outdoors for years, so low-power design and environmental sealing drive the electronics.',
    score: 55,
    grade: 'B',
    reason: '农业物联网传感器厂商，低功耗与户外密封需求明确，单量中等但复购稳定',
    contact: { name: 'Bram de Vries', title: 'Hardware Lead', local: 'b.devries' },
    profile: {
      businessSummary:
        '荷兰农业物联网厂商，土壤传感器网络与温室气候控制器，电池供电、户外多年部署。',
      productTypes: ['Low Power PCB', 'Sensor Interface Board', 'Rigid-Flex PCB'],
      customerType: 'startup_hardware',
      painPoints: [
        '低功耗指标对板级漏电与阻抗控制要求高',
        '户外长期部署需要三防与密封工艺配套',
        '小批量多批次，希望供应商能接受中低量',
      ],
      buyingSignals: ['A 轮融资完成，用于欧洲市场扩张', '官网新增传感器产品线'],
    },
    usedFacts: ['F-014'],
    gaps: [],
    draftSet: 'email',
    coldEmail: {
      a: {
        subject: 'Board-level leakage on battery-powered field sensors',
        body: `Hi Bram,

Battery-powered field sensors live or die on quiescent current. We regularly see designs that hit their target on the bench and then lose 30% of rated life in the field because of board-level leakage paths that were never controlled at the fab.

We build low-power and sensor interface boards, 4-32 layers, with ISO9001 and IATF16949 processes. For outdoor deployments we would look at surface finish, conformal coating compatibility and impedance control together, since those three usually decide the sealing strategy.

Verdant's greenhouse controllers have a multi-year service life, so settling this before the next revision is cheaper than a field swap.

Would a short technical exchange with our process engineer be useful?

Best regards,
Sales Team
GAN PCB Manufacturing`,
      },
      b: {
        subject: 'A low-volume PCB partner for Verdant sensor rollouts',
        body: `Hi Bram,

Congratulations on the A round. The awkward stage for hardware teams in your position is between pilot and volume: too big for prototype houses, too small for the factories that only want 10k+ runs.

We deliberately work in that band. 4-32 layer PCB and PCBA one-stop, ISO9001 and IATF16949, prototype in 3-7 days and mass production in 2-4 weeks, with no minimum that forces you to over-order.

For soil sensor networks the two things we would nail down early are quiescent current control on the board and the conformal coating spec for outdoor sealing.

Would you like our low-power design checklist? It is the one we send before quoting sensor hardware.

Best regards,
Sales Team
GAN PCB Manufacturing`,
      },
    },
  },

  {
    slug: 'meridian-robotics',
    name: 'Meridian Robotics',
    website: 'https://meridian-robotics.example',
    industry: 'Robotics',
    sizeBucket: '11-50',
    employeeCount: 29,
    fundingStage: 'seed',
    country: 'Canada',
    description:
      'Meridian Robotics is an early-stage startup building collaborative robot arms for small machine shops. First product is in pilot with a handful of design partners.',
    score: 48,
    grade: 'C',
    reason: '早期初创，出货量小且资金有限，短期采购规模有限，需长期培育',
    contact: { name: 'Elena Kovacs', title: 'Founder & CEO', local: 'e.kovacs' },
    profile: {
      businessSummary: '加拿大小型协作机械臂初创，首款产品处于设计伙伴试点阶段。',
      productTypes: ['Motor Control Board', 'Control Board'],
      customerType: 'startup_hardware',
      painPoints: [
        '创始阶段预算紧张，NRE 与样板费用敏感',
        '缺乏量产经验，工艺选型需要供应商指导',
        '出货量小，难以获得优质板厂支持',
      ],
      buyingSignals: ['完成种子轮融资', '招聘首位硬件工程师'],
    },
    usedFacts: [],
    gaps: ['need funding runway and volume forecast'],
    draftSet: 'none',
  },

  {
    slug: 'solstice-power-electronics',
    name: 'Solstice Power Electronics',
    website: 'https://solstice-power.example',
    industry: 'Power Electronics',
    sizeBucket: '51-200',
    employeeCount: 95,
    fundingStage: 'a',
    country: 'Sweden',
    description:
      'Solstice Power Electronics makes DC-DC converters and motor drives for Nordic industrial customers. They compete on efficiency and thermal performance.',
    score: 44,
    grade: 'C',
    reason: '功率电子厂商，厚铜板需求存在但已有稳定供应商，切换意愿不明确',
    contact: { name: 'Lars Nyberg', title: 'Purchasing Manager', local: 'l.nyberg' },
    profile: {
      businessSummary: '瑞典 DC-DC 变换器与电机驱动厂商，面向北欧工业客户，以效率与散热为卖点。',
      productTypes: ['Heavy Copper PCB', 'Power Board'],
      customerType: 'industrial_equipment',
      painPoints: [
        '现有供应商厚铜交期不稳定',
        '散热设计受限，希望更高导热材料方案',
        '对价格敏感，切换供应商动力不足',
      ],
      buyingSignals: ['官网发布新一代高效率变换器'],
    },
    usedFacts: [],
    gaps: ['need incumbent supplier pain confirmation'],
    draftSet: 'none',
  },

  {
    slug: 'ironwood-instruments',
    name: 'Ironwood Instruments',
    website: 'https://ironwood-inst.example',
    industry: 'Test & Measurement',
    sizeBucket: '51-200',
    employeeCount: 120,
    fundingStage: 'b',
    country: 'United States',
    description:
      'Ironwood Instruments builds benchtop oscilloscopes and precision source-measure units for R&D labs. Low-noise analog design dominates their board requirements.',
    score: 39,
    grade: 'C',
    reason: '测试仪器厂商，低噪声模拟板需求专业但批量小，模型判定为 C 级',
    contact: { name: 'Grace Lindqvist', title: 'Senior Buyer', local: 'g.lindqvist' },
    profile: {
      businessSummary: '美国台式示波器与精密源表厂商，面向研发实验室，低噪声模拟设计为核心。',
      productTypes: ['Low Noise Analog Board', 'HDI Board'],
      customerType: 'industrial_equipment',
      painPoints: [
        '低噪声模拟板对叠层与接地要求极高',
        '小批量订单难找到愿意配合调试的板厂',
        '需要阻抗一致性数据随批提供',
      ],
      buyingSignals: ['发布新一代源表产品', '官网招标页更新'],
    },
    usedFacts: ['F-030'],
    gaps: [],
    draftSet: 'none',
    override: {
      finalGrade: 'B',
      reason: 'Grace 回信确认新源表项目年需求量约 3000 片，模型低估，人工上调为 B',
    },
  },

  {
    slug: 'zephyr-drone-systems',
    name: 'Zephyr Drone Systems',
    website: 'https://zephyr-drones.example',
    industry: 'UAV / Drones',
    sizeBucket: '11-50',
    employeeCount: 52,
    fundingStage: 'seed',
    country: 'France',
    description:
      'Zephyr Drone Systems builds fixed-wing survey drones for agriculture and mining. Airframe is established; electronics are being redesigned for a lighter payload.',
    score: 34,
    grade: 'C',
    reason: '无人机初创，处于电子重设计早期，采购规模小且时间点不确定',
    contact: { name: 'Camille Rousseau', title: 'Electronics Engineer', local: 'c.rousseau' },
    profile: {
      businessSummary: '法国固定翼测绘无人机厂商，面向农业与矿业，正在重设计电子载荷。',
      productTypes: ['Rigid-Flex PCB', 'RF Board', 'Low Power PCB'],
      customerType: 'startup_hardware',
      painPoints: [
        '减重压力大，刚挠结合替代线束是主要方向',
        '射频与数字混合板需要阻抗控制',
        '初创预算有限，样板成本敏感',
      ],
      buyingSignals: ['官网招聘电子工程师', '宣布新一代轻量化机型'],
    },
    usedFacts: [],
    gaps: ['need redesign timeline'],
    draftSet: 'none',
  },
];

/** 演示用正式活动（非 warmup），让「发送看板」有正常业务活动可讲 */
export const DEMO_CAMPAIGN = {
  name: '[DEMO] 北美工业自动化 Q4 定向开发',
  description: '演示数据集：面向 A/B 级工业自动化与医疗客户的个性化开发信触达',
  format: 'cold_email',
  targetScoreMin: 50,
  targetScoreMax: 100,
};

/** 演示用 warmup 活动：让 reputation 卡片呈现健康色阶 */
export const DEMO_WARMUP_CAMPAIGN = {
  name: '[DEMO] Domain Warmup — rakuto.store',
  description: '演示数据集：域名预热历史记录（用于展示 reputation 评分与预热梯度）',
};

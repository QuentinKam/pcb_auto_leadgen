# python-system —— 已废弃的内部系统方案（归档保留）

本目录内容提炼自原独立仓库 `PCB_ALL/pcb`，该仓库已于 **2026-09-11 删除**。

## 原项目定位

`pcb` 是面向**某 PCB/PCBA 一站式外贸企业（主攻欧美）内部自用**的 AI 获客系统方案：
Python 技术栈、单租户，明确约束「阶段 1–2 禁止对外售卖软件」。

与本仓库的关系：**同一个业务问题的两个实现方向**——
本仓库（`pcb_auto_leadgen`）是 Bun 栈的**产品版**（多租户、可对外售卖）；
`pcb` 是 Python 栈的**客户内部版**。

## 为什么废弃

功能范围已基本被覆盖：

| `pcb` 的模块 | 现由谁覆盖 |
|---|---|
| 打分 / 客户画像 / AI 邮件生成 / 邮件调度 + warmup / 数据看板 / 多租户 | 本仓库（已实现并部署阿里云） |
| AI 被动内容生成流水线 | `../../aigc_base_knowledge/contentforge`（已实现） |
| PCB 行业知识库 | `../../pcb_knowledge_base` |
| 数据采集 | **两边都没实现**：本仓库 `apps/collector` 仍是 stub，`pcb` 只有方案 |

而 `pcb` 自身代码仅约 155 行脚手架 + 8 个 docstring 占位模块，无实现价值。

## 保留了什么

本目录只保留**本仓库没有、且有独立价值**的两部分：

- `业务方案与绩效溯源.md` —— 客户业务层内容：业务诊断、边界约束、
  **绩效与线索溯源字段设计**、本仓库尚未覆盖的模块、需业务侧确认的输入
- `采集模块任务拆解.md` —— 采集模块 P1.1–P1.5 的任务与验收标准，
  对本仓库的 collector stub（见 `../TODO.md` §13.1）有直接参考价值

## 丢弃了什么

- Python 代码脚手架：`src/`、`tests/`、`alembic/`、`pyproject.toml`、`uv.lock`、`alembic.ini`
- `.env`（含真实密钥）、`logs/`、各类缓存、`.venv`（82MB，可再生）
- 多版本文档中与本仓库重复的功能模块描述
  （`spec.md` / `spec_v2.md` / `intent.md` / `intent_v2.md` 的重复章节）

## 如何恢复完整原文

原仓库完整 git 历史（4 个提交）已备份为 bundle：

```
/Users/quentingam/Documents/PCB_ALL/pcb_history.bundle
```

恢复方式：

```bash
cd /tmp && git clone /Users/quentingam/Documents/PCB_ALL/pcb_history.bundle pcb
```

## 相关

- 本仓库采集模块待办：`../TODO.md` §13.1
- 简历口径与待补齐项：`../TODO.md` §十三

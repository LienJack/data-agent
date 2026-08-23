# DataFoundry 能力迁移与 CoA 语义增强 Greenfield 执行

## Goal

按已提交计划 `docs/plans/2026-08-16-001-feat-datafoundry-coa-migration-plan.md` 自主实施 U1–U20，形成新的语义层、三类专职 Agent、Text2SQL/报告闭环，并以已导入的 Falcon 28 库/500 题作为最终验收。

## Confirmed Scope

- Greenfield：只创建新的 Workspace、语义层、合同、运行时与产品旅程，不迁移、回填、双读或兼容历史数据。
- Falcon 数据已经导入；本任务只验证固定摘要和复用现有资产，不再次导入 Falcon 或其他数据集。
- 生产模型固定为 API-backed `deepseek-v4-flash`；真实五项 Credential Smoke 已通过。禁止调用 Claude、Claude Code 或 Anthropic Provider。
- Agent 分为 Semantic、Text2SQL、Report 三类独立 Profile；Tool、Skill、Workflow、Context Policy 和权限分别注册，通过 Mastra Team 编排。
- PostgreSQL Task/Event/Artifact/Receipt 是 Authority；Mastra 只负责内部 Agent/Workflow composition，Snapshot 仅供执行恢复。
- DeepSeek Harness 只作为上下文压缩、Context Epoch、子任务切片和恢复顺序的固定参考，不成为运行依赖。
- 不实现计费、价格、余额、Credits、Settlement 或商业额度功能。

## Requirements

- 完成计划 G1–G16、M01–M18、S01–S09、A01–A06、R01–R06、T01–T08 对应的 58 项能力账本。
- 每个 U-ID 必须独立规划、实现、验证和 scoped commit；按计划 DAG 推进，失败关闭且可从 Receipt/Checkpoint 恢复。
- 两个专属 Scope：Journey Workspace 与 Falcon Evaluation Workspace；首版发布前均满足 `active_release=null && generation=0`。
- Semantic Agent 只生成 Candidate；确定性 Validator 和 Bootstrap Authority 才能发布一次性 v1，后续发布恢复受治理流程。
- Text2SQL Agent 只能消费 Published Semantic Release；Report Agent 只能消费权威 SQL/Artifact Evidence。
- Falcon Semantic Bootstrap Corpus、单题 Public Input 和 Sealed/Gold/Expected/TEST 输入严格隔离。
- 不降低 Falcon 阈值、不跳题、不把 TEST 当本地调优输入。

## Acceptance Criteria

- [ ] U1–U20 每个子任务具有完成回执、相关验证证据与 scoped commit。
- [ ] 两个 Greenfield Scope 分别生成并发布首版语义层，且没有历史数据/Release 引用。
- [ ] Semantic、Text2SQL、Report 三个 Profile 的 Tool/Skill/Workflow/Context 权限可机器检查并相互隔离。
- [ ] Mastra 重启、Context Compaction、Handoff、Unknown Effect 和显式 Resume 均通过恢复门禁。
- [ ] Workspace 主旅程从空 Workspace 到 Semantic v1、Text2SQL、Report 全程通过。
- [ ] Falcon 28 个数据库全部具有可查询的 schema-grounded Semantic v1；309 DEV 和 191 TEST 按冻结协议完成终检。
- [ ] Bootstrap、Journey、Falcon 三个最终 Gate 均为 GO，且所有 Evidence/Receipt 可重放核验。

## Out of Scope

- 任何历史数据迁移、Backfill、Dual-read、旧 Release 等价性或迁移 UX。
- 新的数据集导入或重复导入 Falcon。
- Claude/Anthropic 调用与 Claude 子代理。
- 计费及商业化控制面。

## Blocking Questions

无。Provider、Falcon 复用、Greenfield 边界和 Agent 分类均已由用户明确。

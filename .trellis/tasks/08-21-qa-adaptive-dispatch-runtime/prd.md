# 自适应 Agent 调度合同与 Production Runtime

> 状态：已随父任务批准，准备实施
>
> Parent：`08-21-qa-adaptive-activity-unified-analysis`

## Goal

把 Q&A 从固定创建 Semantic、Text2SQL、Report 三个 child task，升级为受权威合同约束的自适应调度：无新事实的解释类问题可由
Root DIRECT 回答；需要专职能力时只创建实际选中的 Agent；无法安全执行时返回 durable DEFERRED receipt，不伪造 Run、Subagent
或 Tool。PostgreSQL、Contracts、API admission、Worker 与 replay 对同一计划保持一致。

## Requirements

- **R1**：新增严格、内容寻址的 `AgentDispatchPlan@1.0.0`，包含 question class、DIRECT/TEAM、selected profiles、依赖边、
  evidence requirements、reason codes、capability snapshot hash、policy version 与 direct admissibility receipt。
- **R2**：新增严格 `AgentDispatchAdmissionResult`：`EXECUTE` 冻结 effective executor 与 plan ref；`DEFERRED` 只返回稳定原因、
  required capabilities 和 receipt hash，不创建可执行 Run/task。
- **R3**：合法问题分类闭集为 EXPLANATION、SEMANTIC_READ、DATA_QUERY、REPORT、ATTRIBUTION。DIRECT 仅允许不查询新事实、
  不生成正式报告、不修改治理状态的 EXPLANATION。
- **R4**：TEAM 只允许从三个 built-in Product Profile 的已授权、已启用 exact revisions 中选择非空子集；不得重复、越权、
  使用未知 profile 或产生不闭合依赖。
- **R5**：Text2SQL 需要 Frozen Semantic Release 的只读工具能力；Report 若被选择必须依赖 accepted QueryEvidence。Semantic child
  只在确需语义解释/治理能力时创建，不能用 PENDING→SKIPPED placeholder 伪装调用。
- **R6**：Root Orchestrator 采用 deterministic eligibility 与严格 route-intent validator；模型不得扩大候选集。合法 DIRECT 通过
  现有 Provider authority 生成公开回答；数据、报告、正式归因能力缺失时不得自由补数。
- **R7**：Run admission 在持久化前冻结 dispatch receipt。SHADOW cohort 仍执行 `LEGACY_FIXED@1`，adaptive plan 只旁路记录；
  只有 ENFORCED cutover 后的新 Run 执行 `ADAPTIVE@1`。旧/在途 Run 永不被新策略重算。
- **R8**：新增 10674 forward migration，版本化 command/lease payload，并更新 routing、acceptance、lease validation 与
  PostgreSQL exact-key validator；旧 payload 明确规范化为 `LEGACY_FIXED@1`。
- **R9**：Production Runtime 只为 selected profiles 创建 Task/Handoff/Capability/Agent events，失败、取消和重放只闭合真实 task。
  Root acceptance 不再假设 Report 必然存在；成功仍必须来自 committed Artifact/Verifier/Acceptance 或合法 DIRECT provider receipt。
- **R10**：紧急回退只影响新 Run；`ROOT_ONLY_DEFER_DATA` 对数据型请求稳定 DEFERRED，不输出无证据答案。

## Acceptance Criteria

- [ ] **AC1 / Contract**：good/base/bad fixtures 证明 DIRECT、TEAM 子集和 DEFERRED 可解析、哈希可复算；unknown、duplicate、
  dependency gap、unauthorized profile、tamper 全部失败关闭。
- [ ] **AC2 / Direct**：解释类 fixture 创建 root execution，无 child task/handoff/agent status；公开回答来自真实 Provider authority。
- [ ] **AC3 / Selective Team**：Semantic-only、Text2SQL-only、Text2SQL+Report 与全链 fixture 只出现实际 selected Agent；未选择
  Agent 没有 Task、PENDING、SKIPPED、Tool 或 Artifact。
- [ ] **AC4 / Deferred**：DATA_QUERY/REPORT/ATTRIBUTION 在 capability 不足时只持久化同一 deterministic deferred receipt，
  API 重放返回相同结果，Worker 不可领取伪 Run。
- [ ] **AC5 / Authority**：PostgreSQL 17 direct smoke 接受合法 DIRECT/单 Agent/多 Agent/legacy lease，拒绝 bad hash、bad executor、
  profile mismatch、非法依赖和 payload/command kind mismatch。
- [ ] **AC6 / Rollout**：SHADOW Run 实际 executor 为 LEGACY_FIXED 且只保存 shadow plan；ENFORCED cutover 后新 Run 使用 ADAPTIVE；
  回退不改变任何在途 Run。
- [ ] **AC7 / Replay**：crash/replay 不重复创建 Task、不改变 dispatch plan，不给未选择 Agent 补事件；已有 legacy Run 继续三 Agent
  闭环到终态。
- [ ] **AC8 / Regression**：Contracts、Platform、Worker focused tests、PostgreSQL smoke、typecheck 与现有 public event replay 全通过。
- [ ] **AC9 / Evidence**：真实 Web + Worker + PostgreSQL 至少证明一个 DIRECT、一个 selective TEAM 和一个 DEFERRED，保存脱敏
  dispatch/lease/event receipts；不以 mock-only 证据宣称完成。

## Out Of Scope

- 不实现 Activity/Rich Text、VChart、会话目录、Apple Glass 或旧归因物理删除。
- 不新增第四个 Product Profile，不允许用户编辑系统 Orchestrator profile。
- 不把 Provider chain-of-thought、raw prompt、SQL rows 或 SecretRef 写入 dispatch receipt/public event。

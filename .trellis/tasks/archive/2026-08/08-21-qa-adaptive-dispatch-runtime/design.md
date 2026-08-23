# 自适应 Agent 调度技术设计

## 1. Authority Flow

```text
Question + Frozen Effective Config + Enabled Product Profiles
  -> deterministic question classifier / capability eligibility
  -> strict AgentDispatchAdmissionResult
       DEFERRED -> durable receipt only, no runnable Run
       EXECUTE  -> atomic Run command/event/outbox/audit + dispatch receipt
                    -> Worker revalidates lease/receipt/executor
                    -> DIRECT root provider OR selected TEAM graph
                    -> committed acceptance + public events
```

PostgreSQL 是 Run/command/receipt authority；Contracts 是所有边界的唯一 decoder；Worker 不从问题文本重新决定计划；Web 不携带
profile override。Public events 只投影真实执行过的 Task/Tool。

## 2. Contracts

在 `packages/contracts/src/agents/dispatch.ts` 定义：

- `agentQuestionClassSchema`
- `agentDispatchModeSchema`
- `agentDispatchPlanSchema` / build / verify
- `agentDispatchAdmissionResultSchema`
- `agentDispatchExecutionBindingSchema`

`AgentDispatchPlan` 对 selected profiles 与 dependency edges 做 canonical sort；TEAM 至少一个 profile，DIRECT profiles/edges 为空；
Report 依赖 Text2SQL，Text2SQL 可依赖 frozen semantic context 而不强制 Semantic child；ATTRIBUTION 不可 DIRECT。Plan hash 不包含
数据库时间等非确定字段。DEFERRED receipt 绑定 run identity、question class、policy/capability snapshot 与 reason code。

`START_DATA_AGENT_TEAM` payload 升级为兼容读取 union：legacy exact-three payload 规范化为
`executor_version=LEGACY_FIXED@1`；adaptive payload 携带 `dispatch_binding`、selected exact profile refs、policy version。新 writer 只写
adaptive 版本，旧 reader 在部署顺序内继续可读。

## 3. Admission And Policy

首版 classifier 为确定性、显式规则，不依赖自由文本模型决定 authority：

- 只有明确的元数据/解释意图且无需新事实时 eligible DIRECT；
- 数据查询至少选 Text2SQL；正式报告选 Text2SQL→Report；
- 需要语义治理/解释时选 Semantic；
- 正式归因当前返回 DEFERRED；
- 模糊且可能需要新事实的问题按 DATA_QUERY 处理，宁可 TEAM/DEFERRED，不错误 DIRECT。

classifier 输出 reason codes 与 required evidence。Constrained route-intent 只能在 eligibility 候选内选择；首版可先使用 deterministic
planner 作为 authority，保留未来 Provider intent adapter，但 validator 永远是最终门禁。

## 4. PostgreSQL 10674

新增 renderer source 与生成 migration：

- dispatch receipt/binding authority 与 content hash/unique idempotency；
- `accept_question_run_with_effective_config` 在任何 INSERT 前构建/验证 plan、command/event/hash；
- `claim_run_work` / lease validator 验证 executor、plan ref、selected refs 与 command kind；
- 兼容 10667/10670 legacy payload，不改写既有 migration；
- SHADOW/ENFORCED/ROOT_ONLY_DEFER_DATA rollout policy 使用 versioned authority row，Run 冻结 effective executor；
- direct SQL/DML/grant/postcondition 与 Ledger checksum 失败关闭。

部署顺序：Contracts/read compatibility → 10674 → API/Platform writers → Worker readers。10674 已应用后只允许 forward repair。

## 5. Worker Execution

`DataAgentTeamRunner` 从 verified dispatch binding 读取 selected refs，并只验证所选 revisions；registry 的“所有已启用 profiles 完整性”
与“本 Run selected subset”分离。`ProductionTeamRuntime`：

- replay 首先按 dispatch plan 查 root/selected acceptance，不再固定查 Report task；
- 仅对 selected profiles create child/handoff/capability；
- 根据 dependency graph 执行 topological order；
- Semantic-only 使用只读 Frozen Semantic branch；Text2SQL 输出 QueryEvidence；Report 必须接 accepted evidence；
- 最终答案来自 DIRECT provider receipt、Report artifact，或非 Report selected path 的受治理 Artifact projection；
- terminal failure 只对已创建 child 发公开 closure。

SHADOW path 不执行 adaptive runtime；它只在 admission 旁路持久化 plan。executor 一旦冻结，Worker 无 feature-flag 重解释权限。

## 6. Failure Codes

`AGENT_DISPATCH_PLAN_INVALID`、`AGENT_DISPATCH_RECEIPT_MISMATCH`、`AGENT_PROFILE_NOT_ALLOWED`、
`AGENT_DEPENDENCY_UNSATISFIED`、`AGENT_DISPATCH_EXECUTOR_MISMATCH`、`DIRECT_ANSWER_PROVIDER_FAILED`、
`ROOT_ONLY_DEFER_DATA`。未知内部异常统一为 `DATA_AGENT_TEAM_RUNTIME_FAILED`，公开层不包含原始异常正文。

## 7. Rollback

ENFORCED 异常时将新 admission policy 切到 `ROOT_ONLY_DEFER_DATA` 或 SHADOW；旧/在途 Run 继续使用冻结 executor。数据库 schema
不回滚、不删 receipt；通过新 migration repair。任何数据型请求在回退期间宁可 DEFERRED，不回落到无证据 Root answer。

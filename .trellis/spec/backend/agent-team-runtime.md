# Agent Team Product Runtime

> U20 把 U19 Team v2 Authority、U14 Skill Registry、U12 Resolved Context 与公开 Run SSE 接成三个专职 Product Profile。

## 1. Scope / Trigger

- 新增或修改 Agent Product Profile、Skill materialization、Team Run 命令、专职 Tool、Team Trace 或 Q&A Agent 路由时适用。
- Mastra 仅是 Worker 内部执行适配层；PostgreSQL Profile/Team/Event/Artifact/Receipt 仍是权威。
- 中间验证禁止真实 Provider/MCP 和 Falcon；使用 no-network fake ports 证明边界。

## 2. Signatures

```ts
buildAgentProductProfileRevision(input): Promise<AgentProductProfileRevision>;
createPostgresAgentProfileRegistry({ pool, authorizer }).commit(capability, command);
createPostgresAgentProfileRegistry({ pool, authorizer }).list(capability, enabledOnly);
planAgentDispatch({ run_id, question, enabled_profiles, rollout_mode, policy_version });
createPostgresAgentDispatchAuthority({ pool, authorizer }).resolveRolloutPolicy(capability, mode);
createPostgresAgentDispatchAuthority({ pool, authorizer }).setRolloutPolicy(capability, request);
materializeBuiltinTeamProfiles(input, { skills, profiles });
createDataAgentTeamRunner({ profiles, profile_capability_input, runtime, direct });
createMastraProfileComposition({ profiles, tools, visibility });
createRunWorkflowExecutorRouter({ research, team });
```

```sql
commit_agent_profile_revision(command jsonb) returns jsonb
list_agent_profile_revisions(enabled_only boolean) returns jsonb
current_agent_product_profile_refs() returns jsonb
resolve_agent_dispatch_rollout_policy(requested_bootstrap_mode text) returns jsonb
set_agent_dispatch_rollout_policy(requested_mode text, expected_version bigint) returns jsonb
load_agent_team_public_projection(requested_run_id uuid) returns jsonb
accept_backend_run_command(command jsonb, payload_hash text, event jsonb, event_hash text) returns jsonb
```

```text
GET|POST /api/workspaces/{workspaceId}/agent-profiles
GET /api/workspaces/{workspaceId}/runs/{runId}/team-trace
```

## 3. Contracts

- Product Profile ID 闭集固定为 `governed-text2sql-agent`、`report-writing-agent`、`semantic-management-agent`；Orchestrator 不可编辑。
- Revision 绑定 U19 runtime Profile、Model、Prompt、Workflow、sorted direct tools、exact Skill refs、Context Policy、Execution Safety Policy、输出类型和 Verifier hash。
- 九个 built-in Skill 必须先以 `APPROVED + ENABLED` exact revision/head 提交，且 `install_scripts=[]`；任一 disabled/revoked/mismatch 都使 Profile 不可运行。
- 新 Q&A admission 必须先冻结 `AgentDispatchAdmissionResult`。`DIRECT` 只允许无新事实、无治理 mutation、非正式报告的
  EXPLANATION，selected refs 必须为空；`TEAM` 只携带实际选择的 exact Profile 子集与闭合 DAG；`DEFERRED` 只持久化 receipt，
  不创建 Run、Task 或 Outbox。旧 exact-three payload 规范化为 `LEGACY_FIXED@1`，不得静默 fallback。
- SHADOW 新 Run 冻结 legacy exact-three executor 并旁路保存 adaptive plan；ENFORCED 新 Run 冻结 `ADAPTIVE@1`；
  `ROOT_ONLY_DEFER_DATA` 对数据请求稳定 DEFERRED。rollout authority 只允许 Owner 通过 expected-version CAS 切换，
  并把数据库返回的 `policy_version` 同时冻结进 plan、binding 与 deferred receipt。
- Q&A acceptance 从 legacy payload 升级到 Team payload 时，必须在任何 INSERT 前同时替换 Command payload、
  canonical payload hash、`run.accepted` event payload hash 和 event hash。Command、Idempotency、Event、Outbox、
  Audit 六处必须提交同一个 Team hash；禁止依赖 `commands` 的单表 BEFORE INSERT trigger 事后改写。
- Worker 在任何领域调用前重新读取并验证 selected exact Profile refs、dispatch plan/binding、trusted RunExecutionContext 和
  U12 Package/Receipt identity；只为实际 selected profiles 创建 Handoff/Task/Capability/Event。DIRECT 走现有受审计 Provider authority，
  不创建 child、Agent 或 Tool 事件。
- 每个专职 Tool 必须先写 `tool_started`，再写唯一 `tool_completed` 或 `tool_failed`；开始事件失败时领域调用数必须为 0。事件只公开 Profile/Task/Artifact 身份。
- Team 成功只能来自 runtime `ACCEPTED`；`COMPLETED`、模型文本或 Mastra snapshot 不能自行升级为 Acceptance。

## 4. Validation & Error Matrix

| 条件 | 稳定结果 |
| --- | --- |
| legacy 三 Profile 或 adaptive selected refs 缺失、乱序、越权 | `AGENT_PROFILE_NOT_ALLOWED` / `DATA_AGENT_TEAM_PROFILE_STALE` |
| Profile/Skill/runtime hash 漂移 | `AGENT_PROFILE_REVISION_INVALID` / `DATA_AGENT_TEAM_PROFILE_INVALID` |
| 非 Owner mutation | `AGENT_PROFILE_MANAGE_REQUIRED` / `WORKSPACE_ROLE_DENIED` |
| Head CAS 或幂等载荷冲突 | `AGENT_PROFILE_HEAD_VERSION_CONFLICT` / `AGENT_PROFILE_OPERATION_CONFLICT` |
| Command trigger 单独改写 Team hash，关联记录仍持有 legacy hash | 事务必须失败；公开层为 `PERSISTENCE_TRANSACTION_FAILED`，不得放宽复合 FK |
| Team command/payload kind 不一致 | `RUN_WORKFLOW_COMMAND_PAYLOAD_MISMATCH` |
| 未验证 Run context 或 Resolved Context | `RUN_EXECUTION_CONTEXT_NOT_TRUSTED` / `RESOLVED_CONTEXT_REQUIRED` |
| Resolved Context 非 READY/PARTIAL | `RESOLVED_CONTEXT_NOT_RUNNABLE` |
| Tool 不在专职 allowlist | `*_AGENT_TOOL_DENIED`，底层调用数为 0 |
| 可见性事件不能持久化 | 原错误码失败关闭，领域 Tool 调用数为 0 |
| Team runtime 非 ACCEPTED | 对应稳定 reason code，外层 Run 不得完成 |
| rollout 非 Owner mutation / stale CAS | `AGENT_DISPATCH_ROLLOUT_MANAGE_REQUIRED` / `AGENT_DISPATCH_ROLLOUT_VERSION_CONFLICT` |
| DIRECT 带 child 或 TEAM 依赖不闭合 | `AGENT_DISPATCH_PLAN_INVALID` / `AGENT_DEPENDENCY_UNSATISFIED` |

## 5. Good / Base / Bad Cases

- Good：Owner 提交 approved Profiles；Route 冻结数据库 rollout revision 与 DIRECT/selected TEAM plan；acceptance 在任何写入前
  原子构建 versioned lease/event/hash；Worker 只执行 selected graph，并以 Provider receipt 或 Verifier/Acceptance 收口。
- Base：能力不足时返回 durable DEFERRED receipt；同一幂等请求重放相同 receipt，数据库中没有伪 Run/Outbox。
- Bad：固定创建三个 child、用 PENDING→SKIPPED 伪装未调用 Agent、让 Worker 重分类问题、绕过 rollout CAS、按 Profile ID 查
  latest、共享无边界 Tool catalog、把 Mastra completed 当 accepted，或在 tool_started 落库前执行外部操作。

## 6. Tests Required

- Contracts：DIRECT/TEAM/DEFERRED canonical hash、tamper、selected Profile ID/顺序、DAG、Report→QueryEvidence、
  runtime/Skill/direct-tool closure、Team Trace edge/ref closure。
- Platform：fail-closed classifier、数据库 policy version 冻结、Owner rollout CAS、Analyst denial、DB result substitution、
  Team Trace narrow RPC。
- Worker：九 Skill/三 Profile 唯一 hash、Tool isolation、visible started/completed/failed、Profile stale、Resolved Context identity-only、Team/Research 路由零 fallback。
- Web：Profile Route 服务端注入 actor/scope/operation ID；缺 Profile 在 acceptance 前拒绝；Team Trace 空/任务/Verifier 状态。
- PostgreSQL 17：10667/10670/10674 renderer/static、NOLOGIN owner、FORCE RLS、direct DML deny、Skill disabled、
  old 7-key 与 adaptive 9-key atomic acceptance、rollout CAS、DEFERRED no-Run replay；断言
  Command/Idempotency/Event/Outbox/Audit hash 全等，且 Event document hash 可重算。

## 7. Wrong vs Correct

### Wrong

```ts
if (lease.command_kind === "START_DATA_AGENT_TEAM") {
  return legacyResearch.execute(input);
}
await tool.invoke(rawArguments);
```

### Correct

```ts
const payload = effectiveConfigRunLeasePayloadSchema.parse(lease.payload);
if (payload.kind !== lease.command_kind) throw new TypeError("RUN_WORKFLOW_COMMAND_PAYLOAD_MISMATCH");

const started = await visibility.emit(safeToolStarted);
if (!started.ok) return failure(started.error.code);
return isolatedProfileTool.invoke(authoritativeInput);
```

```sql
-- Wrong: a command-only trigger changes payload_hash after callers built the event/outbox hash.
new.payload_hash := platform.canonical_sha256(team_payload);

-- Correct: upgrade every caller-owned document/hash before accept_backend_run_command inserts anything.
requested_command := jsonb_set(requested_command, '{payload}', team_payload, false);
requested_payload_hash := platform.canonical_sha256(team_payload);
requested_event := jsonb_set(
  requested_event, '{payload,payload_hash}', to_jsonb(requested_payload_hash), false);
requested_event_hash := app_data_agent.runtime_canonical_sha256(requested_event);
```

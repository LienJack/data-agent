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
materializeBuiltinTeamProfiles(input, { skills, profiles });
createDataAgentTeamRunner({ profiles, profile_capability_input, runtime });
createMastraProfileComposition({ profiles, tools, visibility });
createRunWorkflowExecutorRouter({ research, team });
```

```sql
commit_agent_profile_revision(command jsonb) returns jsonb
list_agent_profile_revisions(enabled_only boolean) returns jsonb
current_agent_product_profile_refs() returns jsonb
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
- 新 Q&A 命令固定 `START_DATA_AGENT_TEAM`，携带 Effective Config ref 和按上述顺序排列的三个 exact Profile refs。旧 `START_L2_RESEARCH` 只保留显式兼容分支，不得 fallback。
- Q&A acceptance 从 legacy payload 升级到 Team payload 时，必须在任何 INSERT 前同时替换 Command payload、
  canonical payload hash、`run.accepted` event payload hash 和 event hash。Command、Idempotency、Event、Outbox、
  Audit 六处必须提交同一个 Team hash；禁止依赖 `commands` 的单表 BEFORE INSERT trigger 事后改写。
- Worker 在任何领域调用前重新读取并验证 Profile set、trusted RunExecutionContext 和 U12 Package/Receipt identity；只把四个内容寻址 ID/hash 交给 Team runtime。
- 每个专职 Tool 必须先写 `tool_started`，再写唯一 `tool_completed` 或 `tool_failed`；开始事件失败时领域调用数必须为 0。事件只公开 Profile/Task/Artifact 身份。
- Team 成功只能来自 runtime `ACCEPTED`；`COMPLETED`、模型文本或 Mastra snapshot 不能自行升级为 Acceptance。

## 4. Validation & Error Matrix

| 条件 | 稳定结果 |
| --- | --- |
| 三 Profile 缺失、乱序或多余 | `AGENT_PROFILE_SET_NOT_READY` / `DATA_AGENT_TEAM_PROFILE_STALE` |
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

## 5. Good / Base / Bad Cases

- Good：Owner 先提交九个 Skill，再提交三个 Profile；acceptance 在写入前原子构建 Team payload/event/hash；Route 冻结 exact refs；Worker 验证 Context 后执行隔离 Tool，并以 Verifier/Acceptance 收口。
- Base：Profile 集未激活时 Route 返回 `AGENT_PROFILE_SET_NOT_READY`，不会创建一个偷偷走 legacy Research 的 Run。
- Bad：让 `commands` trigger 单独修改 payload/hash、按 Profile ID 查 latest、共享一个 Tool catalog、把 Mastra completed 当 accepted，或在 tool_started 落库前执行外部操作。

## 6. Tests Required

- Contracts：canonical hash、tamper、Profile ID/顺序、runtime/Skill/direct-tool closure、Team Trace edge/ref closure。
- Platform：Owner commit/list/replay/CAS、Analyst denial、DB result substitution、Team Trace narrow RPC。
- Worker：九 Skill/三 Profile 唯一 hash、Tool isolation、visible started/completed/failed、Profile stale、Resolved Context identity-only、Team/Research 路由零 fallback。
- Web：Profile Route 服务端注入 actor/scope/operation ID；缺 Profile 在 acceptance 前拒绝；Team Trace 空/任务/Verifier 状态。
- PostgreSQL 17：10667/10670 renderer/static、NOLOGIN owner、FORCE RLS、direct DML deny、Skill disabled、
  atomic command upgrade 与幂等重放；断言 Command/Idempotency/Event/Outbox/Audit hash 全等，且 Event document hash 可重算。

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

# MCP / Skill Extension Authority

> U14 的 Registry、Effective Config、Tool Effect、SSRF transport、Semantic MCP 和 Web 管理面合同。

## 1. Scope / Trigger

- 修改 MCP Server/Tool manifest、Skill package、Extension Head、Run 选择、外部 Tool 调用、
  Semantic MCP adapter、workspace route 或 `10665` 时适用。
- PostgreSQL 是 immutable Revision、mutable Head、Signer revocation、Effect Intent/Transition 与
  operation receipt 的唯一权威。UI、Worker、DNS resolver 和远端 MCP 都不授予可用性。
- 中间单元不得运行 Falcon、真实 Provider 或真实 MCP；transport 测试只使用注入的 fixed-IP fake port。

## 2. Signatures

```ts
createPostgresMcpRegistry({ pool, authorizer }).commit(capability, command);
createPostgresMcpRegistry({ pool, authorizer }).list(capability, enabledOnly);
createPostgresSkillRegistry({ pool, authorizer }).commit(capability, command);
createPostgresSkillRegistry({ pool, authorizer }).revokeSigner(capability, command);
createPostgresToolEffectStore({ pool, authorizer }).begin(capability, intent);
createGovernedMcpTransport(dependencies).invoke(input);
createSemanticMcpTools(services).invoke(capability, call);
```

```sql
commit_extension_revision(command jsonb) returns jsonb
list_extension_revisions(requested_kind text, enabled_only boolean) returns jsonb
revoke_skill_signer(command jsonb) returns jsonb
begin_tool_effect(command jsonb) returns jsonb
transition_tool_effect(command jsonb) returns jsonb
resolve_extension_config_reference(kind text, id uuid, revision bigint, expected_hash text) returns jsonb
```

```text
GET|POST /api/workspaces/{workspaceId}/mcp-servers
GET|POST /api/workspaces/{workspaceId}/skills
```

## 3. Contracts

- `McpServerRevision` 与 `SkillRevision` 包含完整 App scope、正整数 revision 和 canonical
  `revision_hash`；同 object/revision 的不同 bytes 永久冲突，历史 Revision 不更新、不删除。
- Registry list 返回 `{ revision, head }`。Adapter 必须逐字段闭合 scope、object ID、active revision
  与 active hash；不能让 UI 从 manifest 推断 Head 状态。
- 只有 `OWNER` capability 可提交 Revision、推进 Head 或撤销 Signer；ANALYST/VIEWER 只读。
- Skill 固定 `install_scripts: []`，绑定 package/dependency/signature hash 与 signer；Signer 撤销会原子
  推进相关 Head 到 `REVOKED`。
- U2 的 `MCP_SERVER/SKILL` binding 只接受当前 Head 上的 exact `APPROVED + ENABLED`
  revision/hash。历史 Effective Config receipt 保留已冻结 hash；新 Run 不回退 latest。
- Tool Effect 的顺序固定为 `INTENT_COMMITTED -> DISPATCH_MARKED -> RESPONSE_OBSERVED -> terminal`；
  dispatch 后无法证明结果时只能进入 `TOOL_OUTCOME_UNKNOWN`，随后显式 reconcile。
- Transport 只接受无 credential/query/hash 的 HTTPS 443 endpoint。每次 dispatch/redirect 都重新解析
  public unicast IP、比较 pin，并通过注入的 fixed-target HTTP port 保持 SNI/Host；不得使用 raw `fetch`。
- Semantic MCP 仅适配现有 Metric、Semantic Model、U12 Context、Graph 和 U13 QueryContract 服务；
  `query` 不接受 raw SQL，Graph 不接受 raw Cypher。

## 4. Validation & Error Matrix

| 条件 | 稳定结果 |
| --- | --- |
| Revision hash、scope、object/head identity 漂移 | `*_REVISION_INVALID` 或 `EXTENSION_DATABASE_CONTRACT_INVALID` |
| 同 idempotency key 不同 command | `EXTENSION_OPERATION_CONFLICT` |
| Head CAS 旧 version | `EXTENSION_HEAD_VERSION_CONFLICT`，可重试 |
| 非管理员 mutation | `WORKSPACE_ROLE_DENIED` / `EXTENSION_MANAGE_REQUIRED` |
| Quarantined/disabled Head 进入新 Run | `RESOURCE_DISABLED` |
| Signer 或 Head revoked | `RESOURCE_REVOKED` |
| 非 active revision 或 inherited hash 不匹配 | `RESOURCE_REVISION_MISMATCH` |
| private/link-local/metadata IP、rebind、跨 host redirect | 网络前拒绝；dispatch 后 rebind 为 unknown |
| response 超限或 dispatch 后断连 | `TOOL_OUTCOME_UNKNOWN`，禁止自动重放 |
| raw SQL/Cypher/Prompt/Chunk 进入 Semantic MCP | strict schema/authority 拒绝，底层服务调用数为 0 |

## 5. Good / Base / Bad Cases

- Good：管理员提交已批准 Revision，Head CAS 到 ENABLED；U2 冻结 exact hash；Tool 在 Intent、
  dispatch、response marker、terminal 全部提交后才释放输出。
- Base：Quarantined Revision 可在管理面查看，但不会进入 enabled-only 列表或新 Effective Config。
- Bad：按 `server_id` 查最新 revision、在 DNS 校验后用普通 `fetch(endpoint)`、或远端响应返回后再补 Intent。

## 6. Tests Required

- Contracts：canonical hash/tamper、effect truth table、RBAC action、Registry Item shape。
- Platform：commit/list/result correlation、Head/Revision closure、Signer revoke、SSRF/DNS rebind/redirect、
  zero-network denial、dispatch/unknown/reconcile。
- Worker：五个 Semantic MCP tool 调用已有服务，raw SQL 和换绑 authority 为零调用拒绝。
- Web：Route 服务端注入 scope/hash/operation ID；ANALYST mutation 在 Registry 前拒绝；管理员与只读
  inventory 状态、桌面和 390px 移动端截图无溢出。
- PostgreSQL 17：10665 renderer/static、NOLOGIN owner、FORCE RLS、DML deny、CAS/replay、Signer revoke、
  Effect transition，以及 enabled/disabled/revoked/hash-mismatch 的 U2 binding。

```bash
DATA_AGENT_POSTGRES_ASSERTION_FILTER=43-extension-registry-assertions.sql \
  infra/supabase/test-support/run-postgres-smoke.sh
```

## 7. Wrong vs Correct

### Wrong

```ts
const revision = await registry.getLatest(serverId);
const response = await fetch(revision.endpoint, { body: JSON.stringify(argumentsValue) });
await effects.commitCompleted(response);
```

### Correct

```ts
const exact = effectiveConfig.resource_bindings.find(matchesFrozenServerAndRevision);
const intent = await effectStore.begin(capability, buildIntent(exact, projectionReceipt));
const response = await governedTransport.invoke({ exact, intent, arguments: argumentsValue });
return response.committedOutput;
```

新调用只能使用 Effective Config 已冻结的 exact Revision；网络边界必须消费持久 Intent 与投影 Receipt。

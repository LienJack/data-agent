# Q&A 对话资源绑定

> 本规范记录 Q&A Composer、Conversation、Run 与 Worker 之间已经实现的资源绑定契约。

## Scenario: 按对话冻结模型与数据源

### 1. Scope / Trigger

- 修改 `/w/:workspaceId/qa` Composer、Conversation 资源、Q&A Run 接受或 Worker Q&A 分支时必须
  使用本节。
- `model_profile_id + datasource_id` 是同一份服务端权威 Conversation Projection；浏览器不能维护
  第二份 committed binding。
- 当前实现已经完成 Conversation 冻结、Replacement、Run snapshot、直接分析执行、只读 Sandbox、
  QueryEvidence/AnalysisReport 与公开执行事件。模型认证、Billing 和持久调用许可不属于发布前置条件。

### 2. Signatures

```text
GET  /api/workspaces/:workspaceId/qa/resources
POST /api/workspaces/:workspaceId/qa/conversations/:conversationId/resources
POST /api/workspaces/:workspaceId/qa/conversations/:conversationId/runs
POST /api/workspaces/:workspaceId/runs/:runId/commands
```

```sql
app_data_agent.switch_qa_conversation_resources(command jsonb) returns jsonb
```

资源切换 `command` 必须恰好包含 7 个字段：

```text
schema_version, operation_id, idempotency_key, conversation_id,
datasource_id, model_profile_id, expected_resource_version
```

### 3. Contracts

- Resource Catalog 只返回安全投影；Credential、SecretRef locator、连接串和价格明细不得返回浏览器。
- 环境 Credential Profile 通过安全元数据同步为可选模型；同步命令不得包含 Credential。模型选择不依赖
  认证、计费模式、价格链、积分或额度状态。
- 空对话切换返回 `UPDATED_CURRENT` 并把 `resource_version` 加一；已有消息的对话返回
  `CREATED_REPLACEMENT`，新对话消息数为 0，旧 ID、消息和 Run 不变。
- Q&A Run start 的浏览器请求只含 `question + idempotency_key`。Repository 从 Conversation 解析
  `datasource_id + model_profile_id + model_config_version + provider + model_id +
  datasource_binding_hash`，再原子写入 Run binding 与 User Message。
- Q&A Run start 的 Next Route 只做授权、严格输入解析和 HTTP 映射；Conversation/version、附件冻结、
  Defaults/selection/catalog、Effective Config 接受和权威 Run Projection 读取统一由
  `apps/web/src/server/qa/start-question-run.ts` 持有。禁止在 Route 再装配第二套 PostgreSQL 用例。
- 模型解析必须调用
  `platform.list_active_model_catalog(deployment_id, principal_id)`；Backend 事务不能直接读取无 RLS 的
  `model_catalog_entries`。
- `qa_resource_switch_operations` 使用 `SELECT ... FOR UPDATE`，所以 Backend ACL 必须是
  `SELECT, INSERT, UPDATE`；只有 `SELECT, INSERT` 会在运行时得到 `42501`。
- Worker 解析完整绑定后直接执行确定性分析或服务端模型直连。数据事实必须由同 Run 的只读查询与
  Evidence Artifact 证明；`resource.binding.verify` 本身仍不是 datasource query 的执行证明。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| command 不是严格 7 字段或版本错误 | `CONVERSATION_RESOURCE_SWITCH_INVALID` |
| Conversation 不属于当前 principal/scope | `CONVERSATION_NOT_FOUND_OR_DENIED` |
| `expected_resource_version` 过期 | `CONVERSATION_RESOURCE_VERSION_CONFLICT` |
| datasource 非 ACTIVE 或越权 | `DATASOURCE_NOT_FOUND_OR_DENIED` |
| model profile 不在 active authority catalog | `MODEL_PROFILE_NOT_AVAILABLE` |
| 已有消息后绕过 switch RPC 原地改资源 | `CONVERSATION_RESOURCES_FROZEN` |
| Q&A Run 缺少完整模型/数据源快照 | `CONVERSATION_RESOURCES_REQUIRED` / `QA_RUN_BINDING_INVALID` |
| 环境 Profile 已安全同步且服务端凭据存在 | UI 显示可运行，可冻结到 Conversation |
| 缺少模型认证、积分、价格链或持久调用许可 | 不影响模型选择或调用 |

### 5. Good / Base / Bad Cases

- Good：冻结对话切换资源后创建新空对话；旧消息数不变，新对话 ID 不同；同幂等命令重放同一结果。
- Base：空对话切换到另一个 ACTIVE datasource，原 ID 不变且 resource version 单调增加。
- Bad：浏览器在 Run 请求里提交 model/datasource 覆盖 Conversation，或 Worker 看见绑定 ID 后仍使用
  部署默认 Provider/固定演示数据库。

### 6. Tests Required

- Contract：严格 DTO、未知字段、null binding 和 V1 reader 兼容。
- Platform：断言 Q&A resolver SQL 使用 `list_active_model_catalog($3, $2)`，并把解析快照写入 Command、
  Run binding 和 User Message 同一事务。
- PostgreSQL：回滚烟测覆盖 `CREATED_REPLACEMENT`、`UPDATED_CURRENT`、幂等重放、旧消息不变和新对话
  消息数为 0；迁移 renderer 必须固定 checksum。
- Web：Store 覆盖无 active Conversation 时资源选择创建空对话、Replacement 激活、目录失败不静默
  fallback；浏览器覆盖 320/375/768、无横向溢出、弹层 collision、Arrow/Home/End/Escape 和焦点归还。
- Worker：完整/不完整 binding 失败关闭；五个 Q&A 门禁分别提供真实 Run、Artifact 和只读查询证据；
  通用问答证明直连成功且调用前后持久 Intent/Permit 行数不增加。

### 7. Wrong vs Correct

```sql
-- Wrong: invoker RPC 直接读取 app-global catalog；Backend 没有也不应获得宽表直读权限。
select * from app_data_agent.model_catalog_entries where model_profile_id = :profile_id;

-- Correct: 通过 deployment + principal 权威投影解析 ACTIVE profile。
select *
from platform.list_active_model_catalog(:deployment_id, :principal_id)
where model_profile_id = :profile_id;
```

```typescript
// Wrong: 下拉框选中就宣称真实模型切换完成。
conversation.modelProfileId = selectedProfileId;

// Correct: Conversation -> immutable Run snapshot -> direct Worker -> SQL/Evidence or direct model
// 数据事实仍由只读查询和 Artifact 证明。
```

## Scenario: 多轮验收中的资源快照版本

### 1. Scope / Trigger

跨轮校验 Conversation/version、Falcon 四层 claim 或 terminal closure 时适用；不能把资源版本当作消息数。

### 2. Signatures

`app_data_agent.claim_falcon24_four_layer_gate_turn(command jsonb)` 与
`verifyFalcon24FourLayerConversationBindings(manifest, bindings)` 共同遵守 manifest 版本化规则。
原 claim@1 payload/哈希、CAS、身份与 receipt 签名不变；migration10825 仅增加 manifest@10 支持。

### 3. Contracts

- 插入用户/助手消息不增加 resource_version；合法资源切换或目录变更才增加。已有消息仍禁止原地切换资源。
- v10 同组保持 Conversation ID，版本单调不减；claim 必须精确匹配服务端当前 owner/scope/Conversation/version。
- turn ordinal/scenario index 严格推进、前轮必须 PASSED、Run ID 唯一，当前 Run 冻结对话输入证明消息上下文。
- v1～v9 仍保留原严格资源版本递增语义；v10 全部15题与 v9 相同。已封存失败不得升级、改写或拼接。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| v10 同组 version 1→1 或 1→2，且当前快照一致 | 允许按原 claim/CAS 推进 |
| v1～v9 同组 1→1 | 原 CONVERSATION_MISMATCH |
| 版本倒退、快照过期、跨对话、前轮未通过 | FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH |
| CAS 过期、顺序错误、重复 Run | 原 VERSION_CONFLICT / ORDER_INVALID / 唯一性约束，事务回滚 |
| TS 最终绑定不满足同组/顺序/唯一性 | FALCON24_FOUR_LAYER_CONVERSATION_BINDING_INVALID |

### 5. Good / Base / Bad

Good：三轮问答使用同一 Conversation，资源版本保持1，ordinal/Run按轮推进。
Base：合法目录编辑增加版本后，下一轮读取新版本；既有消息资源仍冻结。
Bad：为了通过测试每轮重命名对话，或把所有版本的历史门禁规则一起放宽。

### 6. Tests Required

Contracts 覆盖 v1～v10 的相等/增加/倒退与同组、ordinal、Run唯一性；v10 turns bytes等于v9。
真实 PostgreSQL 在明确 system_identifier/cluster 的空闲专用 scratch 上调用原 begin/claim，
验证版本回放、第二/第三轮、CAS/快照/前轮/重复Run失败关闭；所有诊断夹具回滚、历史 count/hash 不变。
迁移必须校验 exact frontier/checksum、原函数hash、owner/SECURITY DEFINER/ACL，不能修改旧迁移或消息guard。

### 7. Wrong vs Correct

Wrong：`resource_version > previous_resource_version` 被当作所有消息推进的充分证明。
Correct：v10资源快照非递减且claim精确匹配当前版本，消息推进另由ordinal、唯一Run和冻结历史校验。

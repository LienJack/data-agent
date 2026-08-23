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

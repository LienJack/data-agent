# 私有会话目录与回收站技术设计

## 1. 权威数据流

```text
Cookie session
  -> authorizeWorkspaceRequest
  -> strict Contract decoder
  -> PostgresWorkspaceDataRepository owner method
  -> withAppTransaction revalidation + exact-principal GUC
  -> app_data_agent owner directory RPC/table/RLS
  -> strict WorkspaceConversationDirectory projection
  -> QA store server snapshot
  -> Sidebar / mobile drawer
```

PostgreSQL 是 Folder membership、排序、生命周期、retention eligibility 与 operation receipt 的唯一 authority。Zustand 只保存已提交 snapshot、cursor、selection、pending overlay 和 transport state。

## 2. 合同

在 `packages/contracts/src/workspaces/conversation-directory.ts` 定义：

- `WorkspaceConversation@2.0.0`：在 v1 字段基础上加入 folder/order/state/retention/live state。
- `WorkspaceConversationFolder@1.0.0`。
- `WorkspaceConversationDirectoryPage@1.0.0`、受控 search match/snippet/cursor。
- `WorkspaceConversationDirectoryCommand@1.0.0` 判别联合和 `WorkspaceConversationDirectoryCommandResult@1.0.0`。
- `ConversationTrashRetentionClaim/Receipt@1.0.0`。

目录 mutation action 固定枚举，按 action 精确校验 payload；hash/operation replay 在 DB receipt 中绑定 canonical JSON。

## 3. Migration 10673

源文件分段放在 `infra/supabase/apps/data-agent/migration-sources/10673/`，由 `scripts/render-10673-migration.ts` 生成 migration 并校验 checksum。

主要对象：

- `qa_conversation_folders`；完整 scope + owner + folder composite key，FORCE RLS。
- `qa_conversations` 新列与 state/retention CHECK；owner-bound composite Folder FK。
- `qa_directory_operation_receipts`；principal-scoped idempotency、request/result hash、append-only。
- `qa_conversation_retention_claims`；DB time eligibility、lease/fence、HELD/PURGED receipt。
- `apply_qa_directory_command(jsonb)`；从 `current_backend_authority(true)` 取得 actor/scope，不接受 caller 自报 owner。
- `claim_qa_conversation_retention(...)` / `complete_qa_conversation_retention(...)`；只授予 Job owner，不授予 Browser。

Folder 删除和 ungroup、会话 trash 和 retention fields、expected version CAS 都在单事务完成。现有 conversation guard forward-replace，继续冻结 scope/owner/created identity，但允许目录字段按窄 RPC 更新。

## 4. Repository 与 API

Repository 新增：

- `listConversationDirectory(capability, query)`
- `applyConversationDirectoryCommand(capability, command)`
- `claim/completeConversationRetention(jobCapability, input)`

现有 `listConversations` 兼容委托 active view；`deleteConversation` 改为使用 trash command，不再直接 DELETE。

API：

- `GET /api/workspaces/:workspaceId/qa/conversations?view=&folder=&q=&cursor=&limit=`
- `POST /api/workspaces/:workspaceId/qa/directory/commands`

Folder 与 Conversation mutation 统一走 strict command route，避免再维护一套 action-specific payload。所有 route 先 parse 后调用 repository。GET/trajectory/messages/SSE/Preview 在 repository 或现有绑定查询前拒绝 trash conversation，统一 not-found-or-denied。

## 5. 搜索

数据库只搜索当前 exact principal：Folder `name`、Conversation `title`、Message `content`。query 1–120 chars、limit 1–50；cursor 绑定 owner/view/filter/last rank + ID。Snippet 仅返回匹配附近的纯文本片段，最多 180 字符，禁止 raw metadata/Tool output/SQL row。

首版使用受控 `ILIKE` + owner/filter indexes；所有 count 均在 owner RLS 内计算。分页 cursor 是有界的服务端 offset token，每一页都会在 exact-principal 事务内重新应用 view/filter/owner 条件；cursor 不承载授权。后续数据量证明需要时再引入绑定 query hash 的 keyset cursor 与独立全文检索 projection。

## 6. Web 状态与交互

`qa-types.ts` 仅保存已解析 projection；`qa-store.ts` 增加 directory view/filter/folders/cursor/pending command 和 command actions。命令成功后用 result snapshot 或重新加载更新；失败清理 pending 并保留 selection。

`conversation-directory.tsx` 替换 Sidebar 中扁平 `slice(0, 8)`：

- 一层 Folder tree；默认每组 5 条；未分组是系统 section。
- disclosure、菜单和对话 link 分离，禁止 nested button。
- rename 使用 inline dialog；delete 二次确认；archive/trash views 可切换。
- 上移/下移和“移动到…”菜单是拖拽等价操作。
- mobile workspace drawer 复用同一 component/projection。

本任务沿用现有视觉 token，不提前实施 Apple Glass；后续任务只改 material/token，不改变 directory authority。

## 7. 错误矩阵

| 条件 | 公开结果 |
| --- | --- |
| 资源不存在或非 owner | `*_NOT_FOUND_OR_DENIED` |
| expected version 过期 | `DIRECTORY_RESOURCE_VERSION_CONFLICT` |
| action 与状态不匹配 | `DIRECTORY_STATE_TRANSITION_INVALID` |
| 跨 owner Folder | `FOLDER_NOT_FOUND_OR_DENIED` |
| active Run/interaction | `CONVERSATION_DELETE_BLOCKED_BY_ACTIVE_RUN` |
| retention 未到期 | `CONVERSATION_RETENTION_NOT_DUE` |
| legal/artifact/audit/billing hold | `CONVERSATION_RETENTION_HELD` |
| operation replay payload 不同 | `DIRECTORY_OPERATION_REPLAY_MISMATCH` |

## 8. 验证

- Contract strict parse/round trip/hash/tamper。
- Repository mock + PostgreSQL 17 两用户隔离、CAS、folder delete、trash/restore、retention time tests。
- Route schema/error mapping，SSE/traj/messages trash denial。
- Store reducer、pending overlay、stale response cancellation、view/search/folder grouping。
- Component accessibility、keyboard menu、focus return、desktop/mobile screenshots。
- production build 和真实 Browser refresh proof。

## 9. Owned paths

- `packages/contracts/src/workspaces/conversation-directory.ts`、exports/tests。
- `packages/platform/src/persistence/workspace-data-repository.ts`、focused tests。
- `infra/supabase/apps/data-agent/migration-sources/10673/**`、generated 10673、renderer/static check/SQL smoke。
- `apps/web/src/app/api/workspaces/[workspaceId]/qa/**` 的 owner directory routes。
- `apps/web/src/lib/qa-{types,store}.ts`、directory helper/API。
- `apps/web/src/components/layout/sidebar.tsx`、mobile directory seam、`components/qa/conversation-directory*`。
- 对应 Web tests、i18n keys、task evidence。

明确不拥有并行 Falcon artifacts、知识驱动语义层 task、`next-env.d.ts`、`tsconfig.tsbuildinfo` 和 admin audit routes。

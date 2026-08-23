# 管理员对话审计平面技术设计

## 1. Architecture Boundary

```text
Personal mode
  /w/:workspaceId/qa
    -> exact-principal owner repository
    -> 10673 owner RLS / owner directory RPC

Workspace admin mode
  /w/:workspaceId/qa/admin
    -> authorize workspace membership
    -> admin audit repository
    -> PostgreSQL audited read RPC

Super admin mode
  /admin/qa?workspace_id=...
    -> authorize active SUPER_ADMIN
    -> admin audit repository
    -> PostgreSQL audited read RPC
```

三条路径不共用“是否绕过 owner”的布尔开关。Admin RPC 在 PostgreSQL 内解析 actor，并以最小权限函数 owner 读取 exact target；owner repository、个人目录 RLS 与 10673 owner functions 不变。

## 2. Contracts

在 `packages/contracts/src/workspaces/conversation-admin-audit.ts` 定义严格版本化合同：

- `QaAdminAuditScope@1.0.0`：`WORKSPACE_ADMIN | SUPER_ADMIN`、workspace、可选 target owner。
- `QaAdminDirectoryQuery/Page@1.0.0`：Workspace 必填；owner/folder/lifecycle/live/query/cursor/limit。
- `QaAdminConversationSummary@1.0.0`：复用 v2 conversation 的安全字段并显式 owner/workspace/read_only。
- `QaAdminConversationDetailQuery/Projection@1.0.0`：消息页、public events 页、trajectory/subagent/artifact reference。
- `QaAdminAuditReceiptRef@1.0.0`：receipt ID、operation kind、occurred_at、request digest。

响应始终携带 receipt ref；Web 只消费 strict decoder。Cursor 为服务端签发的不透明 token，内部绑定 actor class、workspace、filters digest、offset/keyset 与 expiry，但不代替每页授权。

## 3. PostgreSQL Forward Migration 10675

新增 migration source、renderer、checksum 与 static check，不修改 10673。

### 3.1 Authority objects

- `data_agent_qa_admin_audit_owner`：`NOLOGIN NOINHERIT NOBYPASSRLS`。
- `qa_admin_conversation_audit_receipts`：append-only、FORCE RLS、immutable trigger。
- `platform.resolve_qa_admin_audit_scope(...)`：数据库重验 active app user、deployment、Workspace membership/system role、authority epoch。
- `app_data_agent.read_qa_admin_directory(jsonb)`。
- `app_data_agent.read_qa_admin_conversation(jsonb)`。
- `app_data_agent.read_qa_admin_run_events(jsonb)` / trajectory / subagent / artifact preview authorization seam。

所有 read RPC 使用 `VOLATILE SECURITY DEFINER SET search_path=''`，流程固定：

```text
strict JSON validation
  -> resolve actor scope from DB session
  -> lock/revalidate target identity and lifecycle
  -> insert immutable audit receipt
  -> construct minimum projection
  -> return projection + receipt ref
```

任一错误整体回滚。函数 owner 只获得目标表的 SELECT 和 receipt INSERT；`data_agent_backend` 只获 RPC EXECUTE，不是 admin owner 成员，也不获 receipt 表读取。

### 3.2 Trash and purge

Admin RPC 可读取 `deleted_at is not null` 且尚未 purge 的 conversation。它不会改变 owner-facing `getRunBinding` 的 trash denial。Retention 真正删除后，RPC 返回 `QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED`。

### 3.3 SSE authorization

不为管理员复用 owner EventSource URL。Admin SSE route 用短页 replay：每次 connect/reconnect/cursor page 调用 audited event RPC；连接期间按现有 heartbeat/authority epoch 定期重验，撤权后发送稳定 terminal transport error 并关闭。SSE 连接状态不写 Run terminal，不伪造 Agent 状态。

## 4. Platform And Web API

新增独立 `PostgresQaAdminAuditRepository`，不向 `PostgresWorkspaceDataRepository` 增加 admin bypass 参数。方法按 projection 类型拆分：directory、conversation/messages、events、trajectory、subagent、artifact authorization。

Web routes：

- Workspace Admin：`/api/workspaces/:workspaceId/qa/admin/**`
- Super Admin：`/api/admin/qa/**`，每个内容查询必须带 workspace ID

所有 route 先用现有 session helpers做 UI-level preflight，再由 RPC 重验。错误统一映射，不把 PostgreSQL detail 回传 Browser。Artifact Export 先通过 admin audit authorization，再通过既有 export capability；两者缺一不可。

## 5. UI And State

新增 admin-specific store/snapshot，不复用个人 `qa-store` 的 owner mutation actions：

- Workspace Admin 页面展示当前 Workspace、只读 banner、owner/folder/state/search filters、分页列表。
- Super Admin 页面先选择 Workspace，再加载相同管理目录组件。
- 详情复用安全 Markdown、activity assembler、Inspector 和 Artifact renderer 的纯展示部分，但注入 admin read transport；Composer、创建、目录菜单和 Run control 均不渲染。
- “返回我的对话”清空 admin selection，导航到个人 `/qa`。
- fetch/SSE 使用 AbortController + generation guard；scope/filter/selection 改变后旧响应不得写入新状态。

## 6. Error Matrix

| Condition | Public result |
| --- | --- |
| non-admin / revoked actor | `QA_ADMIN_ACCESS_DENIED` |
| resource absent, purged, or cross-scope | `QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED` |
| malformed filter/cursor/reference | `QA_ADMIN_QUERY_INVALID` |
| audit receipt insert failed | `QA_ADMIN_AUDIT_UNAVAILABLE` (retryable) |
| stale/expired/future event cursor | bounded reset projection, re-authorized and audited |
| export capability absent | existing export-denied code + audit denial classification |

## 7. Validation

- Contract：strict parse、unknown fields、cursor/digest tamper、actor/target closure。
- PostgreSQL：two owners、Workspace Admin、Super Admin、cross-workspace denial、revocation、disabled actor、trash/purge、receipt atomicity/immutability/grants。
- Platform/Web：repository parse、route role/error mapping、no owner bypass、SSE reconnect/revoke、artifact/export double gate。
- UI：filter/pagination/empty/error/revoked/audit-failed、read-only control absence、keyboard/focus、stale generation。
- Browser：1440x1000、390x844，合成用户与管理员，个人/管理模式隔离，receipt SQL evidence 脱敏。

## 8. Rollout And Rollback

部署顺序：contracts reader → 10675 → repository/routes → admin UI。默认入口仅对 authority 确认的角色显示。

回滚：先隐藏 routes/UI，再撤销 `data_agent_backend` 对 admin RPC 的 EXECUTE；保留 append-only receipts。已应用 migration 不回写，通过 forward repair 调整。

## 9. Owned Paths

- Contracts：新增 admin audit contract、index export、focused tests。
- Database：10675 source/generated、renderer/static-check、PostgreSQL assertion。
- Platform：独立 admin audit repository/export/tests。
- Web：`qa/admin` 与 `/admin/qa` pages/routes、admin store/components/tests/i18n。
- 允许对既有 Run/SSE/trajectory/Artifact read helper 做最小纯函数抽取，禁止改变 owner authorization semantics。

不拥有并行 Falcon artifacts、知识驱动语义层 task、`apps/web/tsconfig.tsbuildinfo`、Apple Glass 与归因任务文件。

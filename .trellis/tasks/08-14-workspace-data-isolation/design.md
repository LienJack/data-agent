# 工作空间持久化与数据隔离技术设计

## 1. 请求权威链

所有产品请求统一走：

```text
Better Auth Cookie
  -> SessionPrincipal
  -> server-parsed workspace_id
  -> PostgresWorkspaceAuthority.resolveForServerContext
  -> transaction revalidation
  -> workspace-scoped repository / semantic port
```

workspace header 或 route 参数只是待验证的资源定位；role、principal、app/environment 都由
服务端 session 和 PostgreSQL 解析。Repository 继续使用 `withAppTransaction`，确保 capability
重验与 SQL 读写处在同一事务。

## 2. 10628 数据模型

新增 `app_data_agent.datasource_connections`：

- PK：`app_id + tenant_id + environment + datasource_id`；
- FK：workspace、创建者 membership、可选 `secret_refs`；
- 保存连接元数据和 SecretRef identity/version，不保存 secret value、完整 DSN 或 provider
  locator；
- lifecycle：`ACTIVE / ERROR / DISABLED`，删除 API 采用 `DISABLED` 软删除，保留引用完整性。

新增 `app_data_agent.qa_conversations` 与 `qa_messages`：

- conversation 固定 workspace、owner principal、可选 datasource（首条消息前必须非空）和
  可选全局 model id；
- message 通过复合 FK 继承 conversation scope，metadata 经过 secret detector；
- datasource 只允许在无消息时绑定一次或从同一 datasource 幂等重放。

新增 `app_data_agent.workspace_run_bindings`：把现有 `runs` 关联到一个 datasource 和可选
conversation，不复制 Run 状态。FK 同时验证 run、datasource、conversation 均属于同一完整
scope。新产品运行入口在接受 Run command 的同一事务创建 binding。

对 `semantic.semantic_domain_registry` 增加 datasource connection 复合 FK；relationship
projection 通过 domain registry 的复合 identity 证明 datasource 与 domain 一致。现有 semantic
对象继续以 tenant_id 隔离，不复制数据。

新表启用并强制 RLS。backend policy 使用 `platform.backend_context_matches`；conversation
owner 的读写再叠加 principal predicate。只授予 `data_agent_backend` 精确 DML 权限。

## 3. Contracts 与 Repository

`@data-agent/contracts/workspaces` 增加 strict DTO：datasource create/read、conversation
create/update/read、message append/read、run binding，以及 Phase 2 reason codes。所有 ID 使用
UUID、时间使用 ISO timestamp，未知字段失败关闭。

`@data-agent/platform` 增加 `createPostgresWorkspaceDataRepository`：

- `list/get/create/disableDatasource`；
- `list/get/create/bindDatasource/deleteConversation`；
- `list/appendMessage`；
- `bindRunDatasource/getRunBinding`。

每个方法都接收 opaque capability，使用 workspace authority 的 transactional authorizer；
公开失败统一映射为 `WORKSPACE_OBJECT_NOT_FOUND_OR_DENIED`、`DATASOURCE_*`、`CONVERSATION_*`，
数据库细节不向 Web 泄露。

## 4. Web 集成

新增统一 `resolveWorkspaceRequest` guard：解析 Cookie session、校验 UUID、解析 READ/WRITE
capability，并返回 SessionPrincipal 与 capability。Datasource/Q&A API 移到
`/api/workspaces/[workspaceId]/...`；原 `/api/datasources` 与 `/api/qa/...` mutation 路径返回
`410 WORKSPACE_ROUTE_REQUIRED`，避免静默继续使用无 scope API。

客户端 workspace id 只从 `/w/:workspaceId/...` pathname 或显式 provider 读取，不从
`NEXT_PUBLIC_DEV_USER_*`、固定 env 或 `default` 兜底。Q&A 发送前校验 conversation datasource，
并把 workspace/datasource/conversation 传给受保护 Run 入口。

Semantic 与 Schema Discovery runtime 增加 request-scoped factory，注入同一个 workspace
authority/authorizer；旧固定 resolver 只保留给显式测试/CLI，不再由产品 route 调用。允许的
semantic domain 由当前 workspace PostgreSQL 数据决定，而不是全局 env 白名单。

## 5. 验证与回滚

- Contract/unit：strict parse、未知字段、SecretRef scope、conversation datasource 冻结。
- Platform conformance：两个 scope、跨对象 ID、VIEWER 写入、停用/撤权/归档后的旧
  capability、两个 repository 实例。
- PostgreSQL：10628 从零安装、FK/RLS/grant/postcondition、两个独立 Pool 可见性。
- Web：route guard、无 session、伪造 workspace/role、客户端 URL 组合、固定身份扫描。
- 回滚只回退应用版本并保留 schema；因本项目允许丢数据，开发环境需要回滚时直接重建
  PostgreSQL，不建设 down migration 或双写。

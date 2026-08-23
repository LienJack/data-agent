# Q&A 管理员审计平面

## 1. Scope / Trigger

- Trigger：需要让 `WORKSPACE_ADMIN` 或 active `SUPER_ADMIN` 调查其他用户的 Q&A 对话、公开轨迹或 Artifact。
- Owner 目录、Owner Run SSE 与管理员审计必须是不同的 URL、repository 和 PostgreSQL RPC；管理员能力只扩展读取范围。
- 不适用于代用户发送消息、修改目录、恢复回收站、控制 Run 或读取原始 chain-of-thought。

## 2. Signatures

- Workspace page：`GET /w/:workspaceId/qa/admin`
- Global page：`GET /admin/qa`，仅 active `SUPER_ADMIN`
- Directory：`GET /api/workspaces/:workspaceId/qa/admin/directory`
- Conversation：`GET /api/workspaces/:workspaceId/qa/admin/conversations/:conversationId`
- Events：`GET .../events?operation=RUN_REPLAY|TRAJECTORY_READ|SUBAGENT_READ`
- Short-page SSE：同一 events URL 增加 `transport=sse`，响应 `event: replay`。
- Artifact authorization：`POST .../artifacts`
- DB RPC：`read_qa_admin_directory(jsonb)`、`read_qa_admin_conversation(jsonb)`、`read_qa_admin_run_events(jsonb)`、`authorize_qa_admin_artifact_access(jsonb)`。

## 3. Contracts

- 所有 query 使用 `z.strictObject`；权威 scope 为 exact `app_id + tenant_id + environment + actor_principal_id`。
- target identity 至少包含 `workspace_id + owner_principal_id + conversation_id`；Run/Artifact 继续闭合 `run_id` 和 immutable reference。
- 每次 page/replay/preview 都返回 `qa-admin-audit-receipt-ref@1.0.0`，包含 allowlisted operation/reason、request digest 与 occurred time。
- Receipt 与 projection 在同一 PostgreSQL 事务产生；receipt 写失败时不得返回 projection。
- SSE 是有界 replay page；每次 reconnect 重新走 Web authorization、DB authority 和 receipt insert。前端必须 Abort 旧请求并用 generation guard 丢弃晚到页。
- Artifact Preview 只返回 `projectArtifactDocument` 的安全 projection。`ARTIFACT_EXPORT` 只表示管理员审计授权；实际导出仍需既有独立 export capability。
- 无新增环境变量。PostgreSQL 17 migration 通过 renderer 与 migration ledger checksum 管理。

## 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| 非 Workspace Admin / 非 active Super Admin | `QA_ADMIN_ACCESS_DENIED` |
| workspace/owner/conversation/run/artifact mismatch | `QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED` |
| unknown field、非法 cursor/filter、缺少 Subagent identity | `QA_ADMIN_QUERY_INVALID` |
| receipt 无法写入 | `QA_ADMIN_AUDIT_UNAVAILABLE` 或 persistence retryable failure；无内容 |
| SSE 下一次 replay 时撤权 | 401/403，前端进入 `stopped` 并不再接收 frame |
| Artifact document 不符合安全 projection | fail closed，不返回 raw document |

## 5. Good / Base / Bad Cases

- Good：Workspace Admin 在显式管理页打开另一 owner 的对话；消息、trajectory、Subagent 和 preview 分别产生回执。
- Base：管理员打开自己的资源仍走 admin RPC；个人侧栏继续只走 owner RLS。
- Bad：把 actor principal 改写成 target owner 后调用 owner repository。
- Bad：建立一次长 SSE 后永久复用旧 capability，或把 provider payload/raw Tool output 写入 admin feed。
- Bad：在已应用 migration 中直接修 SQL；必须追加 forward migration。SQL `COALESCE` 是表达式，不得写成 `pg_catalog.coalesce(...)`。

## 6. Tests Required

- Contracts：strict unknown、operation/reason closure、run/profile/task、artifact reference mismatch。
- Platform：transactional capability、RPC 参数、raw event 到 public event、raw Artifact 到 safe preview、错误映射。
- PostgreSQL 17 fresh chain：Workspace Admin/Super Admin allow、Viewer deny、cross-scope deny、receipt immutable、base owner RLS 未放宽、7 类读取回执。
- Web：页面角色门禁、route scope override、SSE `text/event-stream`、replay merge/dedupe、无 mutation controls。
- Browser：1440x1000 三栏、390x844 目录到详情导航、Artifact Inspector、receipt 可见且截图无 Secret/PII。

## 7. Wrong vs Correct

### Wrong

```ts
const source = new EventSource(ownerRunUrl); // 沿用 owner URL，连接期不再重验
setEvents([...events, ...lateFrames]);       // scope 切换后仍接受旧帧
```

### Correct

```ts
const generation = ++generationRef.current;
const response = await fetch(adminReplayUrl, { signal: controller.signal });
const page = qaAdminRunEventsPageSchema.parse(readSseData(await response.text()));
if (generation === generationRef.current) mergeReplayPage(page);
// 每个短页重新授权并产生 RUN_REPLAY receipt。
```

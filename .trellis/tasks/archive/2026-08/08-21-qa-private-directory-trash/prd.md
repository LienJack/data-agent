# 私有会话目录与 30 天回收站

## 目标

把现有扁平、立即物理删除的 Q&A 会话列表升级为用户私有的一层文件夹目录，支持会话/文件夹管理、授权搜索、归档和 30 天可恢复回收站；同一 Workspace 的普通用户彼此不可列举、读取或推断资源是否存在。

本任务是父任务 `08-21-qa-adaptive-activity-unified-analysis` 的 Slice B，只交付 owner 目录。管理员跨 owner 的只读审计由后续 `qa-admin-audit` 交付，Apple Glass 视觉统一由 `qa-apple-glass` 交付。

## 用户故事

- 作为普通用户，我只看到自己的文件夹与会话，可以搜索、新建、重命名、排序、移动、归档、恢复和删除。
- 作为使用键盘或移动设备的用户，我无需拖拽也能完成所有排序和移动操作。
- 作为误删会话的用户，我可以在 30 天内从回收站恢复；第 30 天到期前后台任务不得清理。
- 作为正在运行分析的用户，我不会因为误点删除而丢失在途 Run；系统必须先取得 durable terminal receipt。

## 功能需求

### R1 版本化合同

- 保留 `workspace-conversation@1.0.0` 作为历史读取输入。
- 新增 strict `workspace-conversation@2.0.0`、`workspace-conversation-folder@1.0.0`、directory page/search result 和 owner command/result 合同。
- Directory view 固定为 `active | archived | trash`；Folder 只有 `active | archived`，未分组由 `folder_id = null` 投影，不创建共享 Folder 行。
- 所有 mutation 包含 `operation_id`、`idempotency_key`、`expected_resource_version`；未知字段、非法状态或跨 owner identity 失败关闭。

### R2 PostgreSQL authority

- 新增 forward migration `20260725010673_app_data_agent_qa_conversation_directory.sql`，不得改写既有 migration。
- `qa_conversation_folders` 包含完整 App/Tenant/Environment/Owner identity、稳定 Folder ID、名称、排序、版本、归档和时间戳。
- `qa_conversations` 增加 nullable `folder_id`、`sort_order`、`archived_at`、`deleted_at`、`purge_after`；状态互斥且 `purge_after = deleted_at + interval '30 days'`。
- Composite FK 必须把 Folder 与 Conversation 的完整 scope 和 owner 绑在一起，数据库级拒绝跨用户移动。
- exact-principal FORCE RLS 保持不变；Backend SQL 仍显式带完整 scope/owner 条件。
- 所有 owner command 通过窄 RPC 在单事务内完成，使用 operation/idempotency receipt；更新资源版本后返回权威 projection。

### R3 文件夹生命周期

- 支持创建、重命名、上移/下移排序、归档、恢复和删除本人 Folder。
- 首版只允许一层 Folder，名称 1–80 字符；同 owner 的 active Folder 名不区分大小写唯一。
- 归档保留 membership/order 并可恢复。
- 删除 Folder 需要 `confirmed=true`，同一事务把其会话移到未分组并提升会话版本，再删除 Folder projection；不删除会话且 owner 不变。

### R4 会话生命周期

- 支持本人会话重命名、上移/下移排序、移动到 Folder/未分组、归档、恢复、移入回收站和从回收站恢复。
- rename/order/move 不改变 Conversation、Message、Run、Artifact identity。
- archived 会话默认只出现在 archived view；trash 会话不允许 URL restore、messages、trajectory、SSE attach 或 Artifact Inspector。
- trash 写入 PostgreSQL `deleted_at` 与精确 `purge_after`；restore 清空二者并回到删除前的 active/archived 状态。
- Running、等待审批或等待用户回答的会话如果没有 durable terminal receipt，trash command 返回 `CONVERSATION_DELETE_BLOCKED_BY_ACTIVE_RUN`。

### R5 30 天 retention

- Web 只做软删除，不直接物理级联删除。
- 后台 retention claim 使用数据库时间、批次、Lease/Fence 和幂等 receipt；仅在 `purge_after <= db_now` 后可领取。
- Artifact、审计、计费或 legal hold 未满足时保持 `HELD`，不物理删除。
- 本任务至少交付 authority eligibility/claim/receipt 与可控时间 PostgreSQL 测试；生产调度接入现有 Job Center，失败可安全重试。

### R6 私有目录与搜索

- `GET conversations` 返回 server cursor 的 owner directory page，可按 view、folder、query 和 limit 查询。
- 搜索覆盖本人 Folder 名、Conversation 标题和授权 Message 内容，结果有上限、分页、受控 snippet；不会返回其他 owner 的 count 或命中提示。
- 隐藏 Subagent child conversation 不作为顶级目录项重复展示。
- 目录行的运行/等待/失败/未读状态来自持久 Run/interaction projection，不由 UI 猜测。

### R7 Web 体验

- Workspace Sidebar 提供 Folder 分组、折叠、每组最近 5 条、“展开其余 N 条”、相对时间、搜索、新建会话和新建 Folder。
- 会话菜单提供重命名、移动、排序、归档/恢复、删除/恢复；Folder 菜单提供对应生命周期动作。
- mutation 不做乐观 authority 更新；可以显示 pending overlay，服务端成功后才替换目录 snapshot，失败保留 selection 与原行并显示公开错误码。
- 桌面 Sidebar 与移动抽屉消费同一 directory projection；tree/treeitem、focus return、Enter/Space 和菜单排序替代均可用。

## 安全与非功能约束

- `ANALYST` 可管理本人目录；`VIEWER` 只读本人目录。管理员在普通 Sidebar 也只看本人内容。
- 无权或不存在统一返回 `CONVERSATION_NOT_FOUND_OR_DENIED` / `FOLDER_NOT_FOUND_OR_DENIED`，避免状态码、计数、文案与 SSE timing 枚举。
- 停用、移出 Workspace 或撤权立即失去访问；不把历史资源转移给其他普通用户。
- 所有 API 输入在边界用 `@data-agent/contracts` strict schema 解析，组件不解析 raw JSON。
- 不暴露私有思考、Provider payload、SQL rows、凭据或 SecretRef。

## 验收标准

- [x] **AC1 合同**：v1 历史 decode 与 v2/folder/directory/command strict schemas、hash/idempotency 和非法状态测试通过。
- [x] **AC2 Folder**：create/rename/reorder/archive/restore/delete 全部持久化；Folder delete 原子 ungroup，会话/owner/证据 identity 不变。
- [x] **AC3 Conversation**：rename/reorder/move/archive/restore/trash/restore 按资源版本提交，刷新和第二浏览器得到相同结果。
- [x] **AC4 Isolation**：同 Workspace 用户 A/B 的 list/count/search/direct URL/messages/trajectory/SSE/Inspector/Preview 均只命中本人，猜测 ID 不可枚举。
- [x] **AC5 Active delete gate**：Running/等待审批/等待回答且无 durable terminal receipt 时 trash 失败；terminal 后才可 trash。
- [x] **AC6 Retention**：`deleted_at + 30 days` 由数据库约束；到期前不可 claim，到期后可 claim；legal/artifact/audit/billing hold 返回 HELD 且不清除。
- [x] **AC7 Search/live**：Folder/标题/Message 搜索有 server cursor、上限和安全 snippet；运行状态来自真实 projection，隐藏 Subagent 不重复列出。
- [x] **AC8 Web/a11y**：Sidebar 和移动抽屉支持分组、最近 5 条、展开、搜索、全菜单、键盘排序替代和 focus return；mutation 失败没有幽灵行。
- [x] **AC9 纵向证据**：真实 Web + PostgreSQL 下完成创建 Folder、移动、重命名、归档/恢复、trash/restore，证明刷新一致；保存桌面与 390px 截图。
- [x] **AC10 Quality**：Contracts/Platform/Web focused tests、typecheck、Biome、migration renderer/static check、PostgreSQL 17 smoke 和 production build 通过。

## 明确不在本任务范围

- Workspace Admin / Super Admin 跨 owner 目录、详情、SSE、Preview/Export 和 append-only admin audit。
- 物理删除历史 Attribution 产品结果。
- Apple Glass 视觉 token 全面改造。
- 多层递归 Folder、普通用户共享 Folder/Conversation、代表他人发送消息。
- 独立语义知识库/语义层自动生成任务。

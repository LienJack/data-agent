# 管理员对话审计平面

> 状态：Implemented，等待任务归档
>
> 依赖：`08-21-qa-private-directory-trash` 已交付并归档

## Goal

为 `WORKSPACE_ADMIN` 和 `SUPER_ADMIN` 提供显式、只读、逐次留痕的对话审计视图，使管理员能够在职责范围内查看用户文件夹、对话、消息、Run 轨迹、Subagent 活动与 Artifact，同时不削弱普通用户的 owner RLS，也不获得代用户修改或继续执行的能力。

## User Value

- Workspace Admin 可以在当前工作空间调查支持、安全与合规问题。
- Super Admin 可以从全局入口按 Workspace 和用户定位对话，但不会把全局数据混入个人侧栏。
- 被审计用户、目标范围、访问类型、原因码和时间均形成不可变回执，管理员读取不是无痕旁路。
- 普通用户继续只能看到自己的文件夹与对话，无法通过 ID、搜索、计数、SSE 或 Artifact 侧信道发现他人资源。

## Confirmed Facts

- 10673 已交付 owner-scoped Folder、Conversation、Message、Run binding、30 天回收站与 owner-only directory RPC；基础表已启用并强制 RLS。
- 当前个人目录、消息、Run/SSE 和 Artifact Preview 都通过 exact principal capability 读取；垃圾箱中的对话会拒绝直接 Run/SSE/Artifact attach。
- 项目已有 `platform.list_workspace_members` 和 Operations Admin repository/route 授权模式，可复用身份解析与错误映射，但其返回合同不覆盖对话审计。
- 父任务已批准：个人模式仍只显示管理员自己的对话；Workspace Admin 的显式入口为 `/w/:workspaceId/qa/admin`，Super Admin 的全局入口为 `/admin/qa`；跨 owner 能力只读且必须审计。

## Product Principles

1. **显式进入**：个人目录与管理审计是两个 surface，禁止在普通侧栏添加“所有人的对话”。
2. **逐次审计**：跨 owner 的列表、详情、消息、轨迹、SSE replay、Subagent、Artifact Preview/Export 每次授权均写不可变回执。
3. **只读例外**：管理员权限只扩展读取范围，不扩展 Conversation/Folder mutation、Run create/resume/retry/cancel 或代用户发言。
4. **数据库签发身份**：actor、system role、workspace role、target scope 均在同一 PostgreSQL 事务内重验；Browser 传入的 owner/role 不是权威。
5. **最小披露**：列表只返回审计定位所需字段；消息正文、公开事件与 Artifact 内容仅在管理员显式打开对应资源时读取。
6. **不可枚举**：无权限、不存在、目标已清理和跨 scope 统一为稳定 not-found-or-denied；搜索和计数不得泄漏越权命中。

## Requirements

### A. 权限与入口

- **R1**：`WORKSPACE_ADMIN` 只能在 `/w/:workspaceId/qa/admin` 审计其 active membership 所属的当前 Workspace；权限撤销后下一次请求和已连接 SSE 均停止访问。
- **R2**：active `SUPER_ADMIN` 可在 `/admin/qa` 跨 Workspace 审计；进入具体 Workspace/Conversation 后仍绑定 exact app/environment/workspace/owner/conversation identity。
- **R3**：管理员的个人 `/w/:workspaceId/qa` 继续只读取本人目录；审计 projection、store、route 和 URL namespace 不与 owner 模式复用。
- **R4**：非管理员访问管理入口返回不可枚举的 denied/not-found 结果；页面不渲染残留 projection，也不通过重定向暴露目标 Workspace 是否存在。
- **R5**：管理员不能通过管理视图创建/重命名/移动/排序/归档/删除/恢复文件夹或对话，不能发消息、继续/重试/取消 Run，也不能改变 owner。Web 不渲染这些动作，API/DB 仍必须独立拒绝伪造请求。

### B. 管理目录与筛选

- **R6**：Workspace 管理目录显示只读 banner，并列出 owner、Folder、Conversation title、生命周期、live state、更新时间、消息数与 30 天回收状态；支持 owner、Folder、`ACTIVE/ARCHIVED/TRASH`、live state 和标题/消息关键字筛选。
- **R7**：Super Admin 全局目录先按 Workspace 筛选，再按 owner/Folder/state 查询；首版不提供无 Workspace 约束的全局消息全文扫描。
- **R8**：所有列表使用有界分页与 server cursor；cursor 绑定 actor scope、target workspace、owner/filter/query digest，不承载授权。每页重新授权并新写审计回执。
- **R9**：搜索 snippet 最多返回受控纯文本片段，不包含 raw metadata、Tool output、SQL row、SecretRef、prompt 或私有推理。普通用户 owner 搜索行为保持不变。
- **R10**：被停用或移出 Workspace 的历史 owner 可继续出现在授权管理员的审计结果中；资源不转移给其他普通用户。已被 retention `PURGED` 的资源不恢复、不伪造占位正文。

### C. 只读详情与活动

- **R11**：管理员可在选中对话后读取只读消息流、公开 Run events、trajectory、实际 Subagent Inspector 和 Artifact Preview；继续使用公共 Think 摘要，禁止 chain-of-thought、provider payload、credentials 和未公开 Tool output。
- **R12**：管理详情使用独立 admin routes/RPC，不把 actor principal 改写成 target owner，也不调用 owner repository 的 mutation/read bypass。
- **R13**：SSE 首次连接、每次 replay/reconnect 和 cursor reset 都重新授权并写 receipt；权限撤销或 scope epoch 变化后连接停止，晚到 frame 由 generation guard 丢弃。
- **R14**：TRASH 对话在管理员审计视图中允许只读查看直至 retention purge，用于调查和恢复决策；这不会恢复 owner 的 Run/SSE/Artifact 直接访问，也不提供管理员恢复按钮。
- **R15**：Artifact Preview 只返回现有 strict projection 与 hash 校验结果。Export 还必须满足既有独立 export capability，并额外写审计回执；审计读取本身不授予导出。

### D. 不可变审计回执

- **R16**：每次跨 owner 读取写入 append-only `qa_admin_conversation_audit_receipts`，至少包含 receipt ID、actor、actor role、target workspace、target owner、resource kind/id、operation kind、reason code、request digest、result classification、occurred_at。
- **R17**：reason code 为服务端 allowlist，并由入口动作确定：目录查询、消息打开、Run replay、trajectory、Subagent、Artifact Preview、Artifact Export；不接受任意客户端字符串或自由文本进入日志。
- **R18**：审计回执与对应 projection 在同一个数据库事务中产生；若回执写入失败，则读取失败关闭，不返回内容。分页、重连和跨资源跳转分别产生回执。
- **R19**：receipt 表使用专用 `NOLOGIN NOINHERIT NOBYPASSRLS` owner、空 search path、全限定名、最小 EXECUTE grant、immutable trigger 和 FORCE RLS；Browser/`authenticated`/`service_role` 不获得直接表权限。
- **R20**：普通管理员不能从本功能读取完整审计日志。本任务只要求数据库可验证回执和响应中的 receipt identity；审计日志查询/保留/导出属于后续合规控制面。

### E. 错误与安全

- **R21**：所有 admin contract 对 unknown 字段失败；owner/workspace/conversation/run/artifact identity 必须形成 exact closure，任何 target mismatch 都稳定失败。
- **R22**：跨 owner 资源不存在、无权限、已 purge、scope mismatch 统一为 `QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED`；管理员资格失效为 `QA_ADMIN_ACCESS_DENIED`，审计写入失败为 retryable `QA_ADMIN_AUDIT_UNAVAILABLE`。
- **R23**：响应、日志、截图和测试 evidence 只使用合成身份；不得记录邮箱、消息全文、SQL 结果、prompt、SecretRef 值或私有推理。
- **R24**：Workspace Admin 与 Super Admin 的授权必须由数据库 authority 重验；仅靠 Web session 中的 role 字段不能签发跨 owner projection。

## Acceptance Criteria

- **AC1**：两个普通用户在同一 Workspace 中仍互不可见；管理员个人目录仍只显示自己。
- **AC2**：Workspace Admin 在显式管理页能按 owner/Folder/state 搜索和分页查看当前 Workspace 的对话；不能访问其他 Workspace。
- **AC3**：Super Admin 在 `/admin/qa` 能选择 Workspace 后查看该范围，普通用户与 Workspace Admin 不能进入全局入口。
- **AC4**：管理员能打开消息、Run replay、trajectory、实际 Subagent 与 Artifact Preview；页面明确只读，所有 mutation/continue/retry/cancel 均不存在且伪造请求被拒绝。
- **AC5**：列表页、详情、SSE connect/reconnect、trajectory、Subagent、Preview 与 Export 的成功读取均产生 exact actor/target/action receipt；模拟 receipt insert 失败时不返回资源内容。
- **AC6**：管理员可审计 TRASH 对话直至 purge；purge 后相同 ID 返回不可枚举错误，不能恢复内容。
- **AC7**：撤销 Workspace Admin membership 或停用 Super Admin 后，新请求立即失败，既有 SSE 在下一次 authorization/replay heartbeat 关闭且不接受晚到帧。
- **AC8**：ID 猜测、跨 owner folder、跨 Workspace conversation/run/artifact、伪 cursor 与篡改 request digest 均失败关闭，且状态码/错误文案/计数不揭示资源存在。
- **AC9**：PostgreSQL 17 fresh migration chain 证明 base owner RLS 未放宽、audit receipt immutable、专用 owner 无 bypassrls、authenticated/service_role 无直接权限。
- **AC10**：桌面 1440x1000 与移动 390x844 的真实浏览器验收覆盖管理目录、筛选、只读详情、返回个人目录、SSE reconnect/revoke，并保存脱敏证据。
- **AC11**：Contracts/Platform/Web focused unit、typecheck、Biome、Web production build 和 `git diff --check` 通过；已知并行任务失败单独列为 HOLD。

## Out Of Scope

- 管理员代用户修改目录、恢复垃圾箱、继续对话或操作 Run。
- 多 Workspace 的无约束全文检索、跨租户批量导出或数据发现。
- 审计日志管理 UI、SIEM 投递、合规 retention policy 与 legal-hold 管理。
- 修改现有 10673 migration；本任务只通过新的 forward migration 扩展。
- Apple Glass 视觉重构、归因功能退场、历史归因数据删除和语义知识库。

## Risks And Deferred Items

- 跨 owner 读取是高风险能力：回滚方式是撤销新 admin RPC 的 EXECUTE grant 和隐藏管理入口，不修改 owner RLS。
- 长连接无法只靠连接建立时授权：SSE 必须使用有界 replay/heartbeat 重新鉴权，不能永久持有快照能力。
- 本任务记录 receipt，但不交付 receipt 浏览器；后续合规控制面需另立任务。

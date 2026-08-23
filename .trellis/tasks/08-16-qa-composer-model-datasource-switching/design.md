# 问答 Composer、对话资源冻结与真实执行设计

## 1. 设计目标

问答页只维护一个服务端权威的 Conversation Resource Binding。Composer 展示并切换该绑定；首次消息
写入后绑定冻结。每个 Run 再把 Conversation 的资源解析为不可变执行快照，Worker 只能通过该快照
调用模型和数据源。

完整数据流：

```text
Resource Catalog
  -> Conversation Resource Binding
  -> Immutable Run Binding
  -> Worker Profile/Datasource Resolution
  -> Billing-gated Model + Governed SQL Tools
  -> Public Run Events / Answer
```

视觉改造与执行绑定属于同一任务。没有 Worker/Provider/Query 证据时，前端显示选中态不等于切换成功。

## 2. 产品交互与 Conversation 状态机

### 2.1 资源作用域

`model_profile_id + datasource_id` 共同定义一个对话的资源上下文：

```text
NEW / EMPTY
  --选择资源--> BOUND_EMPTY
  --首次消息--> FROZEN

BOUND_EMPTY
  --切换资源--> BOUND_EMPTY（原地更新）

FROZEN
  --切换资源--> 创建 REPLACEMENT Conversation -> BOUND_EMPTY
```

- FROZEN Conversation 永不原地修改资源。
- Replacement 只复用原标题并增加可区分的时间/资源上下文；不复制消息、轨迹、Run 或隐藏 Prompt。
- 切换成功后前端激活 Replacement，旧 Conversation 仍在侧栏可访问。
- 模型或数据源中的任一个发生变化，都走同一状态机。
- “系统默认模型”必须在 Conversation 绑定时解析为明确 `model_profile_id`；Worker 不接受 null 后再
  猜默认。数据源同样必须显式绑定。

### 2.2 并发与失败

- 切换请求携带 `idempotency_key + expected_resource_version`。
- 服务端在事务中锁定 Conversation，判断消息是否存在，再更新空对话或创建 Replacement。
- 同键同载荷重放相同结果；同键异载荷返回稳定冲突。
- 切换期间 Composer 禁止发送；Run 执行期间资源选择器禁用，只保留停止动作。
- 切换失败保留原 Conversation、输入文本和资源选择，不做乐观伪提交。

## 3. Composer 视觉与组件结构

目标渲染链固定为：

```text
apps/web/src/app/w/[workspaceId]/qa/page.tsx
  -> apps/web/src/app/qa/page.tsx
  -> ChatArea + ChatInput
```

实现不得只修改独立 Demo、设置页或 Semantic Studio Composer。Canonical workspace URL 刷新、切换
Conversation 和打开 Trajectory 后返回对话视图，都必须使用同一个新版 Composer。

### 3.1 Desktop

- 页面底部只保留一个最大宽度受控的一体化 Composer；移除 ChatArea 顶部重复的“本次对话资源”栏。
- 外壳使用 22–26px 大圆角、1px 中性边框、轻微扩散阴影和既有鼠尾草/绿色强调色；不使用紫色、
  霓虹、发光或多层 Card。
- textarea 无独立盒状边框，留出稳定的 2–6 行高度。
- 底部工具条左侧为数据源入口；右侧依次为模型入口、资源/连接状态和发送/停止按钮。
- 选择器触发器优先展示“名称 + 短状态”，详细 Provider、model id、数据库位置放入弹层。
- 发送按钮使用项目现有 accent；运行中切换为明确 Stop 图标和 `aria-label`，不把 disabled send
  伪装成 stop。

### 3.2 Narrow viewport

- textarea 保持整行；工具条允许两行重排，不允许横向滚动。
- 数据源和模型触发器采用 `minmax(0, 1fr)` 截断，发送按钮保持 40px 可点击区域。
- 弹层根据 viewport collision 向上展开，最大高度独立滚动，不能被 Composer 或页面裁切。

### 3.3 Client boundaries

- `ChatInput` 保持薄 Client orchestration，textarea 值为组件本地状态。
- `QaComposerResourcePicker` 是可复用 presentational component，只接收已解析 options、状态和回调。
- Conversation/Run/资源目录 server state 继续由 QA Store 拥有；组件不直接解释 raw API JSON。
- 动画只用于 120–180ms 的弹层/状态过渡，并尊重 `prefers-reduced-motion`。

## 4. 公开 Contract 与 API

### 4.1 Resource catalog projection

新增 workspace-scoped 严格 DTO：

```ts
type QaResourceCatalog = {
  schema_version: "qa-resource-catalog@1.0.0";
  models: Array<{
    model_profile_id: string;
    config_version: number;
    provider: ModelProvider;
    model_id: string;
    display_name: string;
    readiness: "RUNNABLE" | "CERTIFICATION_REQUIRED" | "CREDENTIAL_UNAVAILABLE" | "UNBILLABLE";
    selectable: boolean;
  }>;
  datasources: Array<{
    datasource_id: string;
    display_name: string;
    type: WorkspaceDatasourceType;
    status: "ACTIVE" | "DISABLED";
    selectable: boolean;
  }>;
};
```

`GET /api/workspaces/:workspaceId/qa/resources` 只返回安全投影。Credential/SecretRef、连接串和价格明细
不进入响应。模型可选择性由 Catalog status、Credential readiness、Certification 与可解析运行配置共同
派生；实际 Billing authorization 仍在每次 Provider 调用前重新执行。

### 4.2 Conversation resource switch

```text
POST /api/workspaces/:workspaceId/qa/conversations/:conversationId/resources
```

请求只含 schema version、两个目标资源 ID、expected resource version 和 idempotency key。返回判别联合：

```ts
type ConversationResourceSwitchResult =
  | { kind: "UPDATED_CURRENT"; conversation: WorkspaceConversationV2 }
  | { kind: "CREATED_REPLACEMENT"; conversation: WorkspaceConversationV2; replaced_id: string };
```

服务端重新验证 workspace capability、Conversation owner、ACTIVE datasource 和可运行 model profile。
无权、已禁用或竞态统一返回稳定 reason code，不能泄露跨 workspace 对象存在性。

### 4.3 Atomic Q&A Run start

新增 Q&A 专用入口：

```text
POST /api/workspaces/:workspaceId/qa/conversations/:conversationId/runs
body = { schema_version, question, idempotency_key }
```

浏览器不再提交 datasource/model。服务端在同一事务中：

1. 锁定 Conversation 并读取完整资源绑定。
2. 解析 ACTIVE datasource 和 ACTIVE/runnable model profile config snapshot。
3. 创建 Run、`workspace_run_binding@2.0.0` 和 User Message。
4. 写 Outbox/accepted Event，返回公共 Run Projection。

这样避免“消息已写但 Run 创建失败”和浏览器重复资源 ID 导致的归因分叉。旧通用 `/runs` API 可保留
给非 Q&A 调用，但 Q&A Client 不再使用它。

## 5. PostgreSQL 数据模型

实施时先检查最新 app migration，再分配无冲突版本。Additive migration 包含：

- `qa_conversations.model_profile_id uuid`，引用 app-global `model_catalog_entries`；新增
  `resource_version bigint`。
- Conversation 更新 guard 同时冻结 datasource/model；已有消息或旧值已绑定时拒绝原地切换。
- `workspace_run_bindings` 新增 `model_profile_id`、`model_config_version`、`provider`、`model_id` 和
  `datasource_binding_hash`，保存执行时不可变安全快照。
- Run binding 关联 `model_config_versions`；Config 后续变化不能重写历史 Run。
- 新增资源切换与 Q&A Run start 的 Authority RPC/operation receipt，使用 server-calculated canonical
  hash、RLS、窄 grant、固定 search_path 和 ledger checksum。
- V1 reader 继续读取历史 row；新 Q&A Run 只写 V2。旧 Conversation 缺显式 model profile 时不能
  自动猜测执行，UI 引导创建新资源上下文。

`datasource_binding_hash` 只覆盖 datasource id、连接配置版本/更新时间、SecretRef identity/version 和
语义快照标识，不包含 Secret 值。它用于 Worker 校验“读取到的配置仍是 Run 接受时的绑定”。

## 6. Worker 执行边界

### 6.1 新命令类型

新增 `START_QA_ANALYSIS` command payload，不复用或改变现有 `START_L2_RESEARCH` 语义。Run Worker 根据
command kind 路由到新的 `QaAnalysisWorkflowExecutor`；既有 Research Executor 保持兼容。

Lease 只携带严格解析的 Run binding reference/identity。Worker 执行前从 PostgreSQL 加载 V2 binding
并核验 Scope、principal、Conversation、model config version 和 datasource hash。

### 6.2 Model profile

- 按 `model_profile_id + config_version` 加载不可变 model snapshot。
- 通过 SecretRef Authority 解析 Credential，不把明文放入 Lease/Event/Snapshot。
- 核验匹配的 PASS ModelCertificationReceipt/Available Profile。
- 使用 `createWorkerMastraComposition` 的 Billing-gated provider；authorize 必须使用 Lease owner
  principal 和冻结的 model profile，Provider 开始/终态必须形成正确 billing lifecycle。
- Provider request 使用选中 Profile 的 provider/model/base URL/capabilities；不能退回部署默认 Provider。

### 6.3 Datasource and Text2SQL

- 按冻结 datasource id/hash 解析 workspace datasource、SecretRef、egress policy 和当前语义/目录快照。
- 模型只提出结构化意图、Logical Plan 或受限工具调用；确定性 Compiler、Text2SQL Gates 和 Sandbox
  Authority 审批执行，AI 不能批准、发布或覆盖 Oracle。
- Schema lookup、SQL Plan、Sandbox grant 和 execution receipt 全部携带同一 datasource identity。
- 任一工具尝试引用另一个 datasource、绑定已漂移且无可重放快照、或语义上下文不可用时失败关闭。
- 回答只从通过门禁的 Result/Evidence Artifact 构造；公开事件使用既有 progress/tool/answer/terminal
  协议展示安全摘要。

### 6.4 Readiness

- Composer catalog readiness 是发送前提示，不替代 Worker runtime checks。
- 模型认证、Billing、Datasource SecretRef、Egress 或 Semantic/Sandbox 任一门禁失败时，Run 进入稳定
  公开失败/阻塞状态并返回可操作 reason code，不能静默切换到默认资源。

## 7. Store 与页面行为

- QA Store 新增 `resourceCatalogState = idle|loading|ready|empty|error` 和独立 switch pending/error。
- Conversation V2 是唯一选中资源来源；选择器不维护第二份 committed value。
- 选择触发 resource-switch API。`UPDATED_CURRENT` 替换当前投影；`CREATED_REPLACEMENT` 插入列表、
  激活新 ID、清空消息/轨迹并保留 textarea。
- 发送触发 Q&A atomic Run start；成功后把 User Message/Run 接入既有 SSE；失败不清空输入。
- Stop 继续走 Run command；运行中 selectors disabled，Stop 保持可用。
- 移除 model load 的静默 catch 和 datasource load 的静默失败，错误内联显示并提供重试。

## 8. 可访问性与交互细节

- listbox 支持 ArrowUp/ArrowDown、Home/End、Enter/Space、Escape 和焦点归还。
- textarea 在 `nativeEvent.isComposing` 或 composition active 时 Enter 不发送。
- 异步切换使用 `aria-busy`；错误和 Replacement 成功消息使用克制的 `aria-live`。
- 每个触发器明确宣布资源类型、当前值和冻结状态；图标为装饰时 `aria-hidden`。
- 未选择完整资源、资源加载失败、输入为空或 switch pending 时 Send disabled，并提供可发现原因。

## 9. Rollout 与回滚

- 部署顺序：Contract reader -> additive migration/RPC -> Platform repository -> Worker V2 consumer ->
  Q&A API -> Composer producer。
- 在 Worker 尚未支持 V2 时，Web feature gate 不开放新 Composer 发送，避免产生无人消费的 Run。
- 回滚 UI 时保留 V2 columns/RPC/readers；已经创建的 V2 Run binding 不删除、不改写。
- 若模型或 datasource runtime 仍未真实消费冻结 binding，发布门禁为 No-Go，即使视觉验收通过。

## 10. 关键取舍

- 选择按对话冻结而不是按 Run 任意切换：避免不同数据库证据和模型上下文混入一条消息链，代价是
  切换会生成新对话。
- 选择服务端派生 Run binding，而不是信任浏览器传两个 ID：减少越权与竞态面，代价是新增原子 RPC。
- 选择新 Q&A command/executor，而不是继续扩张固定 Research Executor：保持既有研究协议兼容，
  同时让问答拥有真实模型和数据库工具边界。
- 参考 DeepSeek Harness 的信息层级而非复制样式：保留项目的视觉令牌、组件和 Authority 语义。

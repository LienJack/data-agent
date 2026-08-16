# Semantic Agent 对话与执行可观察性设计

## 最终实施记录（2026-08-16）

实现验证后采用了更小的跨层边界，本节覆盖后文中的 V2 event、`beginTool`、readiness gate、共享 Q&A
Inspector 与 migration 提案：

- 新增严格的 `semantic-authoring-public-feed@1.0.0`。服务端从 PostgreSQL 权威 State/Events 构建
  USER/ASSISTANT 公开消息、Run metadata、pending `call_id/tool_name` 与既有公开 events。
- checkpoint 只在服务端读取；首条 USER 内容剥离选区上下文，USER/ASSISTANT 均使用
  `redactPublicDisplayText`，Tool message/arguments/result 和 working graph 全部排除。
- `QUEUED` 由权威 `event_sequence === 0` 派生；10 秒后只显示“等待执行器”，不改变 Run status。
- 复用既有 V1 Authoring events 和 PostgreSQL sequence；初始 GET 全量回放，SSE 按 cursor 增量，
  client 合并 feed 时按 sequence 去重，terminal 双端关闭。
- Semantic Studio 提交后进入 `/w/:workspaceId/semantic/authoring/:runId?domain=:domain`；返回链接携带
  `domain/runId`。父页与独立页的浏览器 DTO 都只包含公开 Run metadata。
- 为避免触碰并行修改中的 Q&A trajectory，实现独立的 Semantic 对话/过程双栏组件；第二个获批任务
  再统一 Q&A Composer 的交互语言。

这一选择直接满足用户要的“对话内容、执行过程、工具调用和全屏返回路径”，同时删除了必须先上线
DB V2 migration 才能发布 UI 的耦合。后文保留为曾评估的强化方案，不代表当前实现。

## 1. 设计目标

Semantic Studio 只负责收集自然语言编辑意图和创建 Authoring Run。创建成功后，浏览器导航到独立
全屏 Run 轨迹页；该页面从 PostgreSQL 权威 Run Projection 与公开事件日志恢复 USER、ASSISTANT、
TOOL、SYSTEM 记录，实时展示过程并提供返回 Semantic Studio 的面包屑。

最小机制必须同时解决两个问题：

1. 让真实对话、阶段和工具边界可观察，而不是只显示一个 busy 按钮。
2. 在模型未认证、Worker 未领取或事件流重连时给出诚实状态，不能伪造终态。

## 2. 路由与页面所有权

### 2.1 Canonical route

```text
/w/:workspaceId/semantic/authoring/:runId?domain=:semanticDomain
```

- `workspaceId` 与 `runId` 在边界使用既有 UUID Schema 校验。
- `domain` 使用既有 `semanticDomainSchema` 校验，并参与 PostgreSQL Scope/RLS 读取。
- 动态页面使用当前 Next.js App Router 的异步 `params` / `searchParams`，并增加 `loading.tsx`
  作为立即导航反馈。
- 不根据 `runId` 跨域扫描；缺少或错误的 domain 失败关闭，避免对象存在性泄露。

### 2.2 Navigation

1. Semantic Studio POST 创建 Run。
2. POST 成功返回公开 Run Projection 和 `authoring_run_id`。
3. Client 使用 `router.push(...)` 进入 Canonical route。
4. Run 页面面包屑显示：`语义本体工作台 / Agent 运行 / <short-run-id>`。
5. “语义本体工作台”链接返回：

```text
/w/:workspaceId/semantic?domain=:semanticDomain&runId=:runId
```

父页面新增 `domain`、`runId` search param 解析，只用于恢复该 domain 和 Candidate read projection；
完整轨迹不在父页面复制。

## 3. 公开数据边界

### 3.1 Internal state remains server-side

`SemanticAuthoringState` 含 `checkpoint.messages`、pending provider request、tool calls 和完整 working
graph，是 Worker/Store 内部恢复状态。Web API 不再把它直接返回浏览器。

新增严格公共 DTO：

```ts
type SemanticAuthoringRunProjection = {
  schema_version: "semantic-authoring-run-projection@1.0.0";
  run_id: string;
  candidate_id: string;
  semantic_domain: string;
  status: "RUNNING" | "WAITING_CLARIFICATION" | "READY_FOR_REVIEW" | "FAILED" | "CANCELLED";
  working_revision: number;
  used_tool_calls: number;
  current_turn: number;
  clarification: PublicClarification | null;
  created_at: string;
  updated_at: string;
};

type SemanticAuthoringRunFeed = {
  projection: SemanticAuthoringRunProjection;
  events: SemanticAuthoringPublicEvent[];
};
```

Semantic Studio 的 Candidate 图仍由服务端使用 internal working graph 构造 read model；浏览器只收到
图的既有只读投影。

### 3.2 Event evolution

Reader 同时接受历史 `semantic-authoring-public-event@1.0.0` 和新
`semantic-authoring-public-event@2.0.0`。新 Run 只写 V2；旧 Run 继续可回放，缺失的历史公开用户
消息显示为“旧版 Run 未记录公开对话”，不得从 checkpoint 补读。

V2 在现有 domain events 基础上新增/增强：

- `message`: `role=user|assistant`、公开 `content`、`turn_index`。
- `stage`: 保留阶段摘要，覆盖 QUEUED、Agent Turn 等公开过程。
- `tool`: 同一 `call_id` 写 `RUNNING` 与 `COMPLETED|FAILED` 两个边界；包含受限的 title、input、
  output、duration 和 error code。
- `graph_patch`、`validation`、`clarification`、`authoring_terminal`: 保持领域语义。

创建 Run 时同事务写入 USER message 和 QUEUED stage。澄清恢复时同事务写 USER answer message。
Agent turn 有非空 `assistant_text` 时写脱敏 ASSISTANT message；READY terminal 的 summary 在轨迹投影中
作为 Agent 完成总结展示。

### 3.3 Display safety

- 复用 `redactPublicDisplayText`，并为 Semantic tools 建立逐工具安全输入/结果摘要器。
- display input/output 为有上限的字符串，不允许任意 JSON、SQL Result Row、Provider request/response、
  System Prompt、Credential 或 Raw Memory。
- 写事件前完成脱敏；前端不负责安全清洗，只格式化已解析公共 DTO。
- Contract 对未知字段失败关闭。

## 4. Worker 与工具实时边界

现有工具事件主要在执行完成后提交，无法实时展示运行中的 Tool。新增 `beginTool` Store Port：

```text
pending tool call
  -> beginTool(CAS fence/revision, RUNNING event)
  -> execute deterministic tool
  -> commitTool(receipt, COMPLETED|FAILED event, duration)
```

- `beginTool` 只追加公开事件并推进 event sequence，不改变 Candidate graph revision。
- Tool mutation 仍只由 `commitTool` 的原子 receipt/patch 事务提交。
- Worker 崩溃后，RUNNING tool 可由同一 `call_id` 的后续 receipt 合并；若 Run 终态先到，UI 派生
  INTERRUPTED/FAILED，不伪造 Tool Result。
- 事件 sequence 继续是唯一恢复游标。

## 5. Readiness 与“无限执行中”

### 5.1 Start gate

创建 Run 前执行只读 readiness 检查，复用当前 Provider binding、Credential presence 和匹配的 PASS
`ModelCertificationReceipt` 解析逻辑：

- Credential 缺失：`SEMANTIC_AUTHORING_MODEL_CREDENTIAL_NOT_CONFIGURED`。
- PASS Receipt 缺失：`SEMANTIC_AUTHORING_MODEL_CERTIFICATION_REQUIRED`。
- 两者具备：允许创建 Run。

未 Ready 时不创建 `RUNNING` Run，Composer 原地显示稳定错误与本地认证指引；不能降低现有认证门禁。
公共响应只返回 Provider/model 的非敏感标识和 reason code，不返回 Credential 值。

### 5.2 Worker availability

模型 Ready 不能证明 Worker 进程存活。新 Run 已同事务拥有 QUEUED 事件，因此轨迹页可以区分：

- 只有 QUEUED 且未出现 Agent Turn：等待执行资源。
- Queue 超过 30 秒仍未前进：显示“执行资源暂未响应”，提供重新检查与返回工作台；这是 UI
  停滞提示，不修改 PostgreSQL Run status。
- Agent Turn 已开始：显示模型处理中，即使 Provider 调用耗时也不误判为未领取。
- SSE 重连：单独显示连接恢复状态，不能覆盖 Run Projection 状态。

本地 `pnpm dev` 已启动独立 semantic-authoring watch，文档需从“三个进程”修正为“四个进程”。
Docker deploy profile 新增 semantic-authoring Worker service，复用 Worker 镜像和相同 Authority/Model
环境变量。

## 6. 前端轨迹投影与布局

### 6.1 Shared inspector shell

从现有 Q&A `trajectory-view.tsx` 提取纯展示组件 `TrajectoryInspector`：

- 输入是已构建的 `TrajectoryRecord[]` 和 metrics，不读取 QA store。
- 保留四角色时间轴、Turn 分组、拖动/点击定位和 Summary/Payload/Result/Schema/Timing 页签。
- Q&A wrapper 继续用 `buildTrajectoryRecords`；Semantic wrapper 使用新的
  `buildSemanticAuthoringTrajectoryRecords`。
- 两个领域各自拥有事件解析/投影，避免把 Semantic event 强转为 Q&A event。

### 6.2 Full-screen page

- 顶部：面包屑、Run 状态、Domain、Candidate、elapsed/turn/tool metrics。
- 中部：四角色时间轴与按序记录列表；USER/ASSISTANT 记录直接显示对话内容。
- 右侧/下方：选中记录检查器，工具记录显示安全 Payload、Result 和 Timing。
- 澄清状态：在轨迹页内显示问题与选项，提交后继续同一 Run/SSE。
- `READY_FOR_REVIEW` 明确显示“待人工审核”，不显示已发布。
- 响应式：桌面为列表 + Inspector 双栏；窄屏上下排列；长输出独立滚动。

## 7. SSE 与恢复

- 初始 GET 返回完整公共 feed；随后 SSE 从最后 sequence 开始。
- `Last-Event-ID` 优先于 query cursor；客户端按 `(run_id, sequence)` 去重。
- 55 秒 server reconnect frame 后 EventSource 自动重连；连接状态独立于 Run terminal。
- Terminal 后关闭流；页面刷新重新 GET 并回放。
- Run feed 的 Projection 与 events 使用同一 PostgreSQL读取事务/边界解析结果，避免 UI 状态分叉。

## 8. PostgreSQL migration 与兼容

实施时先检查仓库最新 app migration 版本，再分配下一个无冲突版本。Migration 负责：

- 允许 append function 接受 V1 与 V2 白名单事件，V2 增加 message 类型。
- Start RPC 原子写初始公开消息与 QUEUED stage，并设置正确 event sequence。
- 新增 tool-start CAS RPC；Resume RPC 写澄清 answer message。
- 保持 RLS、SECURITY DEFINER owner、search_path、grant、checksum 和 migration ledger 后置断言。
- 不重写历史 event row；V1/V2 reader 兼容完成滚动升级。

## 9. 失败、回滚与运维

- Contract/DB migration 先于 V2 producer 部署；旧 reader 不能消费 V2，因此 Web/Worker/Contracts 作为
  同一发布单元上线。
- 回滚应用代码时必须保留向后兼容的 DB append function；不能删除已经写入的 V2 events。
- Readiness 查询失败时 start 失败关闭，不创建孤立 Run。
- Worker 暂停不改变 Run Authority；恢复进程后从 checkpoint/queue 继续。
- Docker semantic-authoring service 可独立停止/恢复；PostgreSQL 仍是唯一权威。

## 10. 关键取舍

- 选择独立全屏页而非 Composer 内联面板：信息密度和可回放性更好，代价是发生页面导航；面包屑和
  dynamic route loading 降低中断感。
- 选择 V2 公共事件而非读取 checkpoint：增加 migration/producer 工作量，但守住隐私边界并支持刷新。
- 选择 UI 停滞提示而非客户端自动失败：用户能理解卡住状态，同时不会篡改权威 Run terminal。
- 复用 Inspector shell 而非复制 Q&A 页面：共享交互能力，但保持两个领域的事件投影独立。

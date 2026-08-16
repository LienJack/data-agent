# 问答 Composer 与资源绑定现状基线

## UI 与客户端状态

- `apps/web/src/app/w/[workspaceId]/qa/page.tsx:1`：canonical workspace 分析路由复用共享
  `apps/web/src/app/qa/page.tsx`。
- `apps/web/src/app/qa/page.tsx:45-56`：Conversation 视图实际组合 `ChatArea` 与底部 `ChatInput`；
  Trajectory 是同页 tab。本任务必须改这条真实渲染链。
- `apps/web/src/components/qa/chat-input.tsx:1-68`：Composer 由 textarea、仅模型选择器和圆形发送按钮
  组成；运行时直接禁用输入，没有独立停止行为或资源错误态。
- `apps/web/src/components/qa/chat-area.tsx:71-91`：数据源选择器在消息区顶部的另一条资源栏，与底部
  Composer 分离。
- `apps/web/src/components/qa/model-selector.tsx:31-81`：从 `/api/models` 加载目录，把 option `id`
  写入 Conversation；请求失败被静默吞掉，也没有区分可配置与可运行模型。
- `apps/web/src/components/qa/data-source-selector.tsx:20-56`：从 QA Store 读取数据源并写 Conversation；
  当前 UI 没有显式处理 loading、empty、error 或冻结状态。
- `apps/web/src/components/qa/resource-card-picker.tsx:25-151`：弹层具备初步 listbox 语义，但没有方向键
  roving focus、异步 pending/error 或 viewport collision 策略。

## Conversation 与 Run 创建

- `apps/web/src/lib/qa-store.ts:276-337`：发送前先单独持久化用户消息，再调用 `createRun`；两个写入
  不是同一事务，失败时可能留下无 Run 的用户消息。
- `apps/web/src/lib/qa-store.ts:475-500`：资源选择通过 PATCH 修改 Conversation；模型/数据源错误共用
  全局 error，客户端无法原子决定“更新空对话”或“创建替代对话”。
- `apps/web/src/lib/api-client.ts:70-94`：`createRun` 接收 datasourceId、conversationId，但不接收
  model profile；浏览器重复提交 datasourceId。
- `apps/web/src/app/api/workspaces/[workspaceId]/runs/route.ts:12-84`：服务端校验 Conversation 与
  Datasource 一致并冻结 datasource_id，但没有解析或冻结模型。
- `packages/platform/src/persistence/repository.ts:60-76,965-1010`：Command payload 和
  workspace_run_bindings 只拥有 datasource/conversation 归因，没有模型 Profile/Config Version。

## PostgreSQL 资源冻结

- `infra/supabase/apps/data-agent/migration-sources/10628/20-workspace-data-tables.sql.inc:129-201`：
  `qa_conversations.model_id` 是无外键 text；`workspace_run_bindings` 没有模型字段。
- `infra/supabase/apps/data-agent/migration-sources/10628/30-workspace-data-guards.sql.inc:51-96`：
  datasource 一旦非空或已有消息就不能修改；model 没有同等冻结门禁。
- `packages/contracts/src/workspaces/data-isolation.ts:55-87`：Conversation 的 `model_id` 使用通用版本
  字符串，未表达它实际保存的是 `model_profile_id`。
- `infra/supabase/apps/data-agent/migration-sources/10629/20-control-plane-tables.sql.inc:10-52`：模型权威
  已拥有 `model_profile_id`、`config_version`、status、credential_ref 和不可变 config snapshot，
  新 Run 应引用这些字段而不是展示名称。

## Worker、模型与数据源执行

- `apps/worker/src/run-worker-cli.ts:120-178`：通用 Run Worker 只组装 Research Authority 和固定
  `ResearchWorkflowExecutor`，没有组装 Model Provider 或 Datasource resolver。
- `apps/worker/src/runs/research-workflow-executor.ts:365-441`：Worker 忽略用户问题、model 和 datasource，
  构造全零 `ResearchProtocolInput`；当前数据源选择只完成归因，没有影响数据库查询。
- `apps/worker/src/mastra.ts:27-49`：项目已有 Billing-gated Model Provider 组合根，可作为真实模型调用
  的复用入口。
- `packages/agent-runtime/src/models/bindings.ts:13-208`：运行绑定具备稳定 profile_id、provider、model、
  credential 和版本，但默认 resolver 按 provider 选择，不能仅凭 Conversation 字符串安全切换 Profile。
- `packages/platform/src/sandbox/postgres-text2sql-sandbox-authority.ts`：项目已有 Text2SQL Sandbox
  Authority；新 Q&A executor 必须使用冻结 datasource binding 进入该门禁，不能直接拼接连接串执行。

## 结论

当前功能不是纯前端缺口。模型仅保存在 Conversation，数据源仅进入 Run 归因，而真实 Worker 对两者
都未消费。要满足用户所说的“切换”，必须建立 Conversation 资源状态机、Run V2 不可变绑定和新的
Q&A Worker 执行分支；否则视觉上可切换但运行结果不会变化。

# Semantic Agent 对话与执行可观察性

## Goal

让用户在 Semantic Studio 发起“新增/修改”后，能像现有 Q&A 对话分析和
DeepSeek Harness 参考交互一样，看见用户与 Agent 的公开对话、实时执行阶段、工具调用及明确终态；
不能再只剩一个无法解释的“Agent 执行中…”按钮。

## Confirmed Facts

- 当前 Composer 只在存在事件后显示最近 8 条单行摘要，没有 USER / ASSISTANT / TOOL
  对话投影，也不能展开工具输入、结果和耗时
  （`apps/web/src/components/semantic/studio/semantic-agent-composer.tsx:66`）。
- 按钮文案直接由 `run.status === "RUNNING"` 驱动；当 Worker 未消费、事件流中断或终态没有抵达时，
  用户只能看到无限执行中，无法区分排队、执行、重连、失败或停滞
  （`apps/web/src/components/semantic/studio/semantic-agent-composer.tsx:168`）。
- Semantic Authoring 已有 PostgreSQL 权威状态、公开事件、SSE、序列游标和 Candidate-only
  写入边界；现有 Q&A 已有公开事件装配、折叠过程与 USER / ASSISTANT / TOOL / SYSTEM 轨迹模式。
- 公开 UI 只能展示策展后的阶段摘要与工具边界，不暴露 Chain-of-Thought、System Prompt、
  Credential、Raw Memory 或未脱敏 Provider 对象。
- Start API 会先创建 `RUNNING` Run，再读取当前事件；新 Run 的 `event_sequence` 为 0 且事件列表为空，
  因此第一条可见反馈依赖独立 Worker
  （`apps/web/src/lib/semantic-studio-service.ts:171`、
  `packages/semantic/src/authoring/in-memory-store.ts:162`）。
- Authoring Worker 要求环境 Credential 和匹配的持久化 PASS `ModelCertificationReceipt`；任一缺失时
  runtime 为 null（`apps/worker/src/semantic/authoring-model-runtime.ts:155`）。Worker 此时只写进程日志
  `CERTIFIED_MODEL_NOT_READY` 并轮询，不会给已创建的 Run 写公开事件
  （`apps/worker/src/semantic/authoring-worker-cli.ts:146`）。
- 当前 Semantic Authoring 的工具事件只有 `call_id/tool_name/status/summary/error_code`，没有安全
  input/output/duration；现有执行器主要在工具结束后才写 `COMPLETED`，缺少可实时合并的 started 边界。
- 本地 `pnpm dev` 已监督独立 semantic-authoring 进程，但 Runbook 仍写“三个进程”；Docker deploy
  profile 只有通用 Worker，没有启动 semantic-authoring CLI。不同启动方式会导致功能可用性不一致。

## Requirements

- R1. 每次 Authoring Run 显示用户提交的原始指令、Agent 面向用户的公开回复、澄清问答和完成总结。
- R2. 运行过程实时显示阶段、工具调用、图变更、确定性校验和公开终态；工具开始/完成按
  `call_id` 合并为同一条记录。
- R3. 工具记录至少显示安全标题、状态、公开摘要、稳定 `call_id` 与错误码；运行中的 pending tool
  只公开 `call_id/tool_name`，不把工具参数、原始对象、SQL 行或 checkpoint tool result 透传到浏览器。
- R4. UI 明确区分提交中、等待 Worker、执行中、等待澄清、事件流重连、已完成、失败、取消和停滞；
  非运行终态必须恢复输入能力。
- R5. SSE 断线后从 PostgreSQL sequence 恢复并去重；页面刷新后能回放同一 Run 的对话和过程。
- R6. Graph Patch 到达后继续刷新 Candidate 图；对话/过程视图与图刷新读取同一个已解析
  Authoring Projection，不建立第二套互相漂移的状态机。
- R7. 保持 Candidate-only 权威边界；Agent 不能审核、发布、回滚或修改活动 Release。
- R8. 对键盘、屏幕阅读器、长内容滚动和 reduced-motion 提供可用交互。
- R9. Semantic Studio 提交成功并取得权威 `authoring_run_id` 后，导航到独立全屏 Run 子页面；
  页面顶部面包屑提供返回原 Semantic Studio 的明确入口。
- R10. 全屏页以 Run 为单位呈现状态和回放；刷新或直接打开合法 Run URL 时继续从 PostgreSQL
  Projection 与公开事件恢复，不依赖父页面内存。

## Acceptance Criteria

- [x] 用户提交“新增成交商品数”后，提交内容立即出现在对话区，并能看到排队/执行状态，
  不依赖第一条 Worker 事件才出现反馈。
- [x] 执行中的 search/read/create/update/validate/impact/complete 工具以公开记录实时出现；
  同一 `call_id` 不产生重复的开始/完成行。
- [x] Agent 澄清问题与用户选择按时间顺序出现在同一对话中，提交后从原 checkpoint 恢复。
- [x] 成功时展示 Agent 完成总结和“待人工审核”，失败/取消时展示稳定错误码与可执行恢复动作；
  按钮不会永久停留在“Agent 执行中…”。
- [x] Worker 暂未消费时显示“等待执行资源”；超过明确阈值后显示等待与自动重连指引，
  但客户端不得伪造 FAILED 或改变 PostgreSQL Run 权威状态。
- [x] SSE 重连和页面刷新不会重复消息、工具或 Patch，终态后连接关闭并恢复输入能力。
- [ ] UI 与 Contract 测试覆盖 RUNNING、WAITING_CLARIFICATION、READY_FOR_REVIEW、FAILED、
  CANCELLED、重连、重复事件、无事件排队和长工具结果。
- [ ] 浏览器验收证明真实 Authoring Worker 启动后可观察到对话、阶段、工具和终态；Worker 未启动时
  页面给出可理解的等待/停滞状态。
- [x] 提交成功后 URL 进入 workspace-scoped Semantic Authoring Run 子路由；面包屑显示工作空间、
  Semantic Studio 和当前 Run，点击 Semantic Studio 返回原页面。
- [x] 直接刷新 Run 子页面仍能回放用户指令、Agent 公开回复、工具和终态；无权或不存在的 Run
  返回不泄露对象存在性的稳定错误页。

## Out of Scope

- 展示或存储模型私有推理、System Prompt、Provider 原始请求/响应或 Credential。
- Agent 自动审核、发布、回滚，或绕过 Candidate/Validation/人工审核权威。
- 为 Semantic Authoring 复制一套独立于 PostgreSQL 事件日志的客户端轨迹状态机。
- 本任务不承诺新增任意 SQL/Python 工具或改变语义创作工具权限闭集。
- 在原 Semantic Studio 内同时保留一份完整轨迹；父页面只负责输入和导航，Run 子页面是完整轨迹的
  唯一 UI Owner。

## Product Decision

- 采用独立全屏轨迹检查器。用户在 Semantic Studio 输入并成功创建 Run 后进入新的子页面；
  子页面顶部提供可点击面包屑返回原 Semantic Studio。

## Implementation Status

- 已实现独立 Run route、浏览器安全 public feed、增量 SSE、公开对话、pending tool/持久化事件、
  澄清操作、终态关闭、返回面包屑和移动端布局。
- Feed 由服务端从 PostgreSQL State/Events 构建；浏览器不再收到 checkpoint、working graph、
  provider request、tool arguments 或 tool result。
- 未新增 V2 database event 或 readiness start gate：现有 event log/checkpoint 已能提供本任务要求的
  可回放公开轨迹；Worker 未领取由 QUEUED/等待提示诚实表达，不伪造终态。

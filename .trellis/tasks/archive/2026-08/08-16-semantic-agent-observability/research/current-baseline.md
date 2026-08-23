# Semantic Agent 可观察性现状基线

## UI 与路由

- `apps/web/src/components/semantic/studio/semantic-agent-composer.tsx:66-110`：只有 events 非空时
  才显示最多 8 条摘要；没有角色记录、详情页签或完整回放。
- `apps/web/src/components/semantic/studio/semantic-agent-composer.tsx:168-180`：按钮仅由 busy/RUNNING
  驱动为“Agent 执行中…”。
- `apps/web/src/components/semantic/studio/semantic-studio.tsx:190-219`：父页面订阅 SSE 并按 sequence
  合并事件；Graph Patch 触发 Candidate read model 刷新。
- `apps/web/src/app/w/[workspaceId]/semantic/page.tsx:4-20`：workspace-scoped Semantic Studio 已使用
  async params/searchParams，可扩展 domain/runId 回放参数。
- `apps/web/src/lib/workspace-routes.ts:4-12`：`workspacePath` 是 canonical workspace URL builder。
- `apps/web/src/components/qa/trajectory-view.tsx:361-425`：Q&A 已有四角色时间轴、record list 和 Inspector，
  但组件直接读取 QA store，需要提取纯展示 shell 才能安全复用。

## Run 创建、事件和 Worker

- `apps/web/src/lib/semantic-studio-service.ts:171-214`：Start 创建 RUNNING state 后立即 listEvents；
  没有 readiness gate。
- `packages/semantic/src/authoring/in-memory-store.ts:125-166`：新 Run `event_sequence=0`、events 为空；
  checkpoint 首条 message 是已拼接服务端选区上下文的内部 instruction。
- `packages/contracts/src/artifacts/semantic-authoring.ts:447-539`：公开事件 V1 有 stage/tool/patch/
  validation/clarification/terminal，没有 user/assistant message；tool 没有 input/output/duration。
- `packages/semantic/src/authoring/tool-executor.ts:547-563`：工具事件在执行后写 COMPLETED；没有持久化
  RUNNING boundary。
- `packages/semantic/src/authoring/orchestrator.ts:365-463`：Agent Turn 有 RUNNING/COMPLETED stage；
  assistant text 仅进入 checkpoint，没有进入公开事件。
- `apps/worker/src/semantic/authoring-model-runtime.ts:155-190`：需要 credential、匹配 binding 的 PASS
  ModelCertificationReceipt 和 Available profile 授权。
- `apps/worker/src/semantic/authoring-worker-cli.ts:146-161`：模型 runtime 不可用时只写
  `CERTIFIED_MODEL_NOT_READY` 进程日志并轮询，不更新任一 Run。

## 持久化与安全

- `infra/supabase/apps/data-agent/migration-sources/10639/20-runtime-rpcs.sql.inc:61-107`：数据库 append
  function 只接受 V1 和固定事件类型；新增 message/V2 需要 additive migration。
- `apps/web/src/lib/semantic-studio-api.ts:24-47`：当前 Web result 直接含完整
  `SemanticAuthoringState`，因此 checkpoint 和 working graph 跨到浏览器；新页面不得继续使用此边界。
- `.trellis/spec/backend/run-event-streaming.md`：公开过程必须来自 PostgreSQL append log，sequence 是
  恢复游标，显示数据先脱敏，工具以 call_id 合并，禁止暴露 CoT/System Prompt/Raw Memory。

## 运行拓扑

- `scripts/local-dev-runtime.ts:122-145`：当前本地聚合启动 Web、Worker、Indexer、Semantic Authoring
  四个进程。
- `docs/runbooks/local-development.md:29-54`：文档仍称三个进程且没有列出 semantic-authoring 单服务命令。
- `compose.yaml:159-210`：deploy profile 的通用 Worker 不运行 semantic authoring CLI；不存在独立
  semantic-authoring service。

## 结论

截图中的无限执行不是单一 CSS 问题。当前链路允许创建一个没有任何初始事件的 RUNNING Run，
而独立 Worker 在模型未认证时不会领取或终结它。完整修复需要公共投影、初始队列事件、模型 readiness
门禁、Worker 工具边界和独立 Run 页面一起完成。

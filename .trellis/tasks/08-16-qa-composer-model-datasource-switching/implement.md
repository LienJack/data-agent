# 问答 Composer、模型与数据源切换实施计划

## 0. 开始前门禁

- [ ] 用户显式批准最新 PRD/Design/Implement 摘要。
- [ ] 运行 `task.py start`，确认任务进入 `in_progress`。
- [ ] 重新检查 `git status --short` 和相关文件 diff；Q&A、Store、Contracts、Platform 当前已有并行
  修改，先确认所有权，不能覆盖或回退他人工作。
- [ ] 重新加载 `trellis-before-dev`、`design-taste-frontend`，读取 frontend component/state/type、
  backend workspace identity/billing、database、run streaming、error handling 和 cross-layer specs。
- [ ] 检查最新 app migration 号及 semantic/full-screen sibling task 的共享文件，避免 migration、
  `qa-store.ts`、run contracts 和 trajectory 组件冲突。

## 1. 资源与 Conversation Contracts

- [ ] 新增严格 `QaResourceCatalog`、Conversation V2 resource binding、switch request/result 和
  `WorkspaceRunBindingV2` schema。
- [ ] 用 `model_profile_id` 表达模型身份，保留必要 V1 reader 兼容，禁止组件继续把通用 `model_id`
  当 Profile ID。
- [ ] 新增 `START_QA_ANALYSIS` command payload 和严格 lease/binding identity。
- [ ] 定义稳定错误：resource version conflict、conversation resources frozen、model unavailable、
  datasource unavailable、run binding drift 等。
- [ ] 测试未知字段、跨 workspace id、null binding、V1/V2 round trip、Secret fixtures 失败关闭。

验证：

```bash
pnpm --filter @data-agent/contracts exec vitest run test/workspace-data-isolation.spec.ts test/run-runtime.spec.ts
pnpm --filter @data-agent/contracts typecheck
```

## 2. PostgreSQL migration 与原子 Authority

- [ ] 分配下一个无冲突 migration，添加 Conversation model profile/resource version 与 Run V2 binding
  字段、索引、FK 和 checks。
- [ ] 扩展 Conversation guard：datasource/model 任一已绑定或已有消息后拒绝原地修改。
- [ ] 新增 resource-switch RPC：锁行、幂等、expected version、原地更新或创建 Replacement 判别结果。
- [ ] 新增 Q&A Run start RPC：从 Conversation 冻结资源、创建 Run/V2 binding/User Message/Outbox/Audit。
- [ ] Database 计算 safe datasource binding hash；任何 Secret value 不进入 row/receipt/audit。
- [ ] 更新 RLS、SECURITY DEFINER owner、search_path、窄 grant、postconditions、checksum 和 ledger。
- [ ] 真实 PostgreSQL 双连接覆盖切换竞态、重复提交、历史冻结、跨 workspace 和 Run start 原子性。

验证：

```bash
./infra/supabase/test-support/static-check.sh
./infra/supabase/test-support/run-postgres-smoke.sh
pnpm --filter @data-agent/platform exec vitest run test/persistence/workspace-data-repository.spec.ts
```

## 3. Platform Repository 与安全资源解析

- [ ] 扩展 Workspace repository 读取安全 Resource Catalog、执行 resource switch、读取 V2 Run binding。
- [ ] 解析 exact model config snapshot、ACTIVE catalog state、Credential Ref identity 和 certification
  readiness；不把 Secret 暴露给 Web DTO。
- [ ] 解析 datasource metadata、credential identity、egress policy、semantic/catalog snapshot 和 binding
  hash。
- [ ] 所有 DB/API `unknown` 先经 Contract parse；Repository 返回 `PortResult` 和稳定 reason code。
- [ ] 测试 disabled/unbillable/certification missing、credential revoked、datasource drift 和 scope mismatch。

验证：

```bash
pnpm --filter @data-agent/platform exec vitest run test/persistence/workspace-data-repository.spec.ts test/billing/billing-gated-model-provider.spec.ts
pnpm --filter @data-agent/platform typecheck
```

## 4. Q&A API 与 Store 数据流

- [ ] 新增 workspace-scoped `/qa/resources` 和 Conversation resources endpoint，使用统一 Authority。
- [ ] 新增 Conversation-scoped atomic Run start route；Q&A Client 停止向通用 `/runs` 重复提交资源 ID。
- [ ] API 返回严格公共 DTO，不泄露 Credential、SecretRef、连接串、内部异常或对象存在性。
- [ ] QA Store 增加 resource catalog、switch pending/error 和 Replacement Conversation reducer。
- [ ] 发送失败保留输入；switch 失败保留旧 binding；Replacement 激活后清空消息/轨迹但不清空 textarea。
- [ ] 删除模型/数据源加载的静默失败路径，增加内联 retry。

验证：

```bash
pnpm --filter @data-agent/web exec vitest run test/qa-conversations-route.spec.ts test/qa-resource-routes.spec.ts test/workspace-runs-route.spec.ts
pnpm --filter @data-agent/web typecheck
```

## 5. Worker Q&A 执行分支

- [ ] Run Worker 按 command kind 分派，既有 `START_L2_RESEARCH` 行为和测试保持不变。
- [ ] 实现 `QaAnalysisWorkflowExecutor`，执行前核验 Lease、principal、V2 model snapshot 和 datasource
  binding hash。
- [ ] 按冻结 Profile 组装 Credential/Certification-aware、Billing-gated Model Provider；禁止部署默认
  Profile 覆盖选择。
- [ ] 按冻结 Datasource 组装 schema/semantic resolver、egress authorizer 和 Sandbox Authority。
- [ ] 使用模型生成结构化意图/计划，复用确定性 Semantic/Text2SQL Compiler、Gates 与 execution receipt；
  禁止直接执行模型产生的未审批 SQL。
- [ ] 从已通过门禁的 Result/Evidence 生成 answer；写 progress、tool start/finish、answer、terminal 公共事件。
- [ ] Provider 开始前/后失败、Billing 拒绝、Credential revoked、Datasource drift、Sandbox denied 全部形成
  可重放终态，不能 fallback。

验证：

```bash
pnpm --filter @data-agent/worker exec vitest run test/qa-analysis-workflow-executor.spec.ts test/run-worker-runner.spec.ts
pnpm --filter @data-agent/agent-runtime exec vitest run test/integration/mastra-bridge.spec.ts
pnpm --filter @data-agent/worker typecheck
```

## 6. Composer 组件重设计

- [ ] 以 `/w/[workspaceId]/qa` 的实际渲染链为验收入口；确认 workspace route、共享 QAPage、
  `ChatArea` 与 `ChatInput` 都接入新版 Composer，不另做孤立 Demo。
- [ ] 把 DataSourceSelector 从 ChatArea 顶部移入 ChatInput Composer，移除重复资源栏。
- [ ] 重构 Resource Picker：键盘 listbox、viewport collision、loading/empty/error/disabled/selected/pending。
- [ ] 实现 22–26px 圆角一体化外壳、borderless textarea、底部左右工具条和项目 accent 发送/停止按钮。
- [ ] 使用 Phosphor 图标和既有 Provider/DataSource marks；不新增品牌资产、紫色渐变、Glow 或卡片堆叠。
- [ ] 处理 `nativeEvent.isComposing`、Enter/Shift+Enter、空输入、停止、焦点恢复和 reduced motion。
- [ ] 窄屏工具条换行，无横向溢出，弹层不被 viewport/Composer 裁切。
- [ ] Resource switch 成功为 Replacement 时显示克制通知并激活新对话；不复制旧消息。

验证：

```bash
pnpm --filter @data-agent/web exec vitest run test/qa-chat-input.spec.tsx test/qa-resource-picker.spec.tsx test/qa-store.spec.ts
pnpm --filter @data-agent/web typecheck
pnpm exec biome check apps/web/src/components/qa apps/web/src/lib/qa-store.ts
```

## 7. 端到端绑定证明

- [ ] 建立两个隔离 fixture datasource，包含可区分 schema/data；分别创建冻结 Conversation 并运行。
- [ ] 证明每个 schema/tool/sandbox receipt 只引用所选 datasource，跨源引用被拒绝。
- [ ] 建立两个可控 model profile/provider fixture；证明 Run binding、Provider request 和 Billing invocation
  使用所选 Profile/Config Version。
- [ ] 证明 Profile 或 datasource 在 Run 接受后变更不会改写历史 binding/replay。
- [ ] 证明 resource switch 创建 Replacement，旧 Conversation 的消息、Run 和 trajectory hash 不变。

## 8. 浏览器验收矩阵

- [ ] 直接访问 `/w/:workspaceId/qa`，刷新后仍展示新版 Composer，并保持正确 workspace scope。
- [ ] Desktop：Composer 信息层级、两种选择器、输入、发送/停止与参考方向一致但保留项目视觉。
- [ ] Mobile：320/375/768px 无横向滚动，弹层可滚动，核心动作不丢失。
- [ ] Keyboard：完整 listbox 导航、Escape、焦点返回、Enter/Shift+Enter、IME composition。
- [ ] Empty/error：无模型、无数据源、目录加载失败、资源被禁用、认证/计费门禁拒绝。
- [ ] Empty Conversation：切换原地更新；Frozen Conversation：切换创建并激活 Replacement。
- [ ] 运行中：selectors 禁用，Stop 可用；SSE 恢复后绑定标签和 Run 状态不分叉。
- [ ] 页面刷新：从 Conversation 投影恢复资源，不依赖本地缓存猜测。

## 9. 规范与全量验证

- [ ] 更新 frontend component/state/type spec，记录 Composer 和 Conversation Projection 所有权。
- [ ] 更新 backend workspace identity/billing 与 run streaming spec，记录 V2 resource/run binding。
- [ ] 运行 `trellis-check`、cross-layer 检查和受影响包全量测试/build。

```bash
pnpm --filter @data-agent/contracts test:contract
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/text2sql test:unit
pnpm --filter @data-agent/agent-runtime test:unit
pnpm --filter @data-agent/worker test:unit
pnpm --filter @data-agent/web test:unit
pnpm --filter @data-agent/web build
git diff --check
```

## 10. Scoped commit 与完成

- [ ] 重新检查并行脏改动，逐路径/逐 hunk 暂存；绝不使用 `git add .`。
- [ ] 检查 `git diff --cached --stat` 和完整 staged diff，排除 Semantic sibling task 及其他并行修改。
- [ ] 创建一个准确描述本任务的 scoped commit，不 amend、不 squash。
- [ ] 记录 commit、验证证据、浏览器截图和 deferred items，再运行 `trellis-finish-work`。

## No-Go / Rollback points

- 选择模型未改变真实 Provider/Profile/Billing invocation：No-Go。
- 选择数据源未改变 schema/query/sandbox binding：No-Go。
- Frozen Conversation 可被 API 或 DB 原地改资源：No-Go。
- Secret/连接串进入公共 DTO、event、日志或快照：No-Go。
- atomic Run start 留下孤立消息/Run/binding：No-Go。
- 无法在并行脏工作区形成可审计 scoped index：停止并报告 commit blocker。

## 2026-08-16 Implementation Checkpoint

已实现并验证：

- Canonical `/w/:workspaceId/qa` 统一 Composer、模型/数据源 picker、320/375/768 响应式布局、键盘
  listbox 与无横向溢出。
- 严格 Resource Catalog、安全 readiness 投影、空对话资源选择、冻结对话 Replacement 和失败保留。
- Conversation `model_profile_id/resource_version`、Run model snapshot、资源冻结 guard、严格 7 字段
  switch RPC、幂等 operation receipt 和 renderer checksum。
- Q&A Run 浏览器请求不提交资源 ID；Repository 通过
  `platform.list_active_model_catalog(deployment_id, principal_id)` 解析服务端快照，并在同一事务写 Run
  binding 与 User Message。
- 回滚 PostgreSQL smoke 已证明 `CREATED_REPLACEMENT`、`UPDATED_CURRENT`、幂等重放、旧消息保持和
  新对话空历史；同时修复了 `SELECT ... FOR UPDATE` 所需 `UPDATE` ACL 与 invoker 对 app-global model
  catalog 的错误直读。
- Worker 会严格核验完整 binding，并通过公开 `resource.binding.verify` tool 事件展示脱敏模型/数据源
  快照。

仍然 No-Go，任务保持 `in_progress`：

- 本地 active pricing catalog/model config version 为 0，因此 DeepSeek/Kimi 只能公开显示为
  `UNBILLABLE`，不可选择或发送；没有绕过计费门禁伪造 runnable。
- `run-worker-cli` 尚未把冻结 Profile 接入 `createWorkerMastraComposition` 的 Credential、Certification、
  Billing lifecycle 与真实 Provider 调用。
- Research executor 尚未把冻结 datasource 接入 Schema/Semantic/Text2SQL/Sandbox 执行；当前只有绑定
  核验事件，不是查询执行证据。
- 因此 AC6、AC7 和端到端发布门仍未满足，不能归档任务或宣称真实模型/数据库切换完成。

验证证据：

- Contracts targeted：18 passed；Platform repository/workspace：47 passed；Worker full：52 passed；Web
  full：219 passed、1 skipped。
- Contracts/Platform/Worker/Web typecheck 通过；Web production build 通过。
- Migration `10648` checksum：
  `sha256:46a31d3aa374ae7ecf5619c6c7a8f081a30d9c373c5d4e85f33cfcfb56b5ab10`。
- 全局 PostgreSQL static gate 被并行脏 migration `10636` 的双 self-checksum literal 阻断；Platform 全量
  unit 仅被并行新增 public exports 与 `platform-surface.spec.ts` allowlist 未同步阻断。

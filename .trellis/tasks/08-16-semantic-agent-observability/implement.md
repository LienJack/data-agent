# Semantic Agent 对话与执行可观察性实施计划

## 最终实施清单（覆盖下方探索性 V2 方案）

- [x] 新增严格、浏览器安全的 public feed Schema 与服务端投影。
- [x] 排除 checkpoint tool result、arguments、working graph 和 provider request；公开消息执行脱敏。
- [x] Parent Semantic Studio Start/Get/Resume/SSE 响应缩减为公开 Run metadata + events。
- [x] 新增 Feed GET/SSE route，保留 Last-Event-ID、sequence 去重、55 秒 reconnect 与 terminal close。
- [x] 新增 workspace-scoped 全屏 Run 页面、面包屑返回、公开对话、执行事件、pending tool 与澄清。
- [x] 提交成功自动导航；返回父页按 `domain/runId` 恢复 Candidate read projection。
- [x] QUEUED、10 秒等待执行器、RUNNING、WAITING_CLARIFICATION、READY、FAILED、CANCELLED 与
  reconnect 均有明确显示；移动端自动折叠工作区侧栏。
- [x] Projection secret regression、Route binding、SSE replay、Web 全量单测、typecheck、Biome、
  production build 和 desktop/mobile browser screenshot 已验证。
- [ ] 真实 Worker 端到端创建 Candidate 未在本任务检查中执行，避免在并行工作区生成测试 Candidate；
  发布前仍应按第 9 节运行带认证模型的 smoke。

下方第 1–4 节的 V2/migration/readiness 方案经实施评估不再是本任务发布依赖，保留为未来需要公开
Tool input/output/duration 或启动前硬门禁时的候选强化项。

## 0. 开始前门禁

- [ ] 用户显式批准最新 PRD/Design/Implement 摘要。
- [ ] 运行 `task.py start`，确认任务进入 `in_progress`。
- [ ] 再次运行 `git status --short`，记录并避开并行脏改动。
- [ ] 重新加载 `trellis-before-dev`，读取 backend/frontend index、run-event-streaming、
  error-handling、type-safety、component-guidelines 和 cross-layer guide。
- [ ] 检查最新 app migration 版本，避免与并行 106xx migration 冲突。
- [ ] 对已存在并行修改的 `compose.yaml`、runbook、spec 文件只暂存本任务独立 hunk；如果无法形成
  可审计 scoped index，停止并报告 commit blocker。

## 1. 公共 Contract 与投影

- [ ] 在 Semantic Authoring contracts 中保留 V1 reader，新增 V2 message/tool/stage DTO。
- [ ] 新增不含 checkpoint/working graph 的 `SemanticAuthoringRunProjection` 与 feed schema。
- [ ] 复用公开文本脱敏函数，增加有上限的 Semantic tool display summary contract。
- [ ] 添加 Contract tests：V1 replay、V2 message、tool start/finish、未知字段、secret fixtures、
  internal state 不进入 public projection。

验证：

```bash
pnpm --filter @data-agent/contracts exec vitest run test/semantic-authoring.spec.ts
pnpm --filter @data-agent/contracts typecheck
```

## 2. Semantic orchestrator 与 Store Port

- [ ] Start input 同时携带 internal instruction 与原始 public instruction。
- [ ] 扩展 Store Port/In-memory Store：初始 events、`beginTool`、V2 clarification answer。
- [ ] Worker 在确定性工具前提交 RUNNING event，结束后提交 COMPLETED/FAILED event 和 duration。
- [ ] 对各工具生成有限、脱敏的 input/output 摘要；非空 `assistant_text` 写公开 message。
- [ ] 保持 graph mutation receipt、fence、revision、digest 和 complete validation invariants 不变。
- [ ] 添加 crash/replay、同 `call_id`、失败工具、澄清和显式完成测试。

验证：

```bash
pnpm --filter @data-agent/semantic exec vitest run test/semantic-authoring.spec.ts
pnpm --filter @data-agent/semantic typecheck
```

## 3. PostgreSQL migration 与 Platform adapter

- [ ] 创建下一个无冲突 migration source/rendered SQL；更新 append 白名单兼容 V1/V2。
- [ ] Start RPC 原子写 USER + QUEUED，Resume 写 USER answer，新增 begin-tool CAS RPC。
- [ ] Platform adapter 解析公共 feed，不能把 raw DB JSON 断言为类型。
- [ ] 更新 SQL grants/postconditions/static assertions 与 migration checksum。
- [ ] 增加 Platform unit/contract 和 PostgreSQL smoke assertions。

验证：

```bash
pnpm --filter @data-agent/platform exec vitest run test/semantic/postgres-semantic-authoring.spec.ts
pnpm --filter @data-agent/platform typecheck
./infra/supabase/test-support/static-check.sh
./infra/supabase/test-support/run-postgres-smoke.sh
```

## 4. Readiness 门禁与运行拓扑

- [ ] 提取/复用 Provider binding + PASS certification receipt 的只读 readiness 解析，避免 Web/Worker
  各维护一套匹配逻辑。
- [ ] Semantic Studio start 在持久化 Run 前检查 Credential 与 Certification；返回稳定 reason code。
- [ ] Worker 继续执行完整 `AvailableModelProfile` 授权，readiness 不能替代运行时认证。
- [ ] Docker deploy profile 增加 semantic-authoring Worker service。
- [ ] 修正本地 Runbook 的四进程、单服务命令、模型认证和健康边界说明。

验证：

```bash
pnpm --filter @data-agent/worker exec vitest run test/semantic-authoring-model-runtime.spec.ts test/semantic-authoring-worker-runner.spec.ts
pnpm test:dev-runtime
docker compose config --quiet
```

## 5. Web API/SSE 公共边界

- [ ] `SemanticStudioStartResult` 改为严格 public feed，不返回 `SemanticAuthoringState`。
- [ ] Start/Get/Resume/SSE routes 全部解析同一 feed schema。
- [ ] 保留 `Last-Event-ID`、cursor、terminal close、55 秒 reconnect 和 sequence 去重语义。
- [ ] API tests 覆盖 readiness blocked、不存在/越权、V1 replay、V2 feed、重连与 terminal。

验证：

```bash
pnpm --filter @data-agent/web exec vitest run test/semantic-studio-route.spec.ts test/semantic-studio-agent-only.spec.ts
```

## 6. 独立 Run 路由与导航

- [ ] 新增 `/w/[workspaceId]/semantic/authoring/[runId]/page.tsx` 和 `loading.tsx`。
- [ ] 校验 async params/searchParams，缺少非法 domain 显示稳定错误态。
- [ ] Semantic Studio 提交成功后 router push 到 Run route。
- [ ] Semantic Studio 接受 `domain`、`runId` query，面包屑返回后恢复 Candidate projection。
- [ ] 增加 canonical workspace route tests，保证 legacy route 规则不回退。

## 7. 全屏轨迹检查器

- [ ] 从 Q&A TrajectoryView 提取 store-agnostic `TrajectoryInspector` presentational shell；保持 Q&A
  现有行为与测试。
- [ ] 新增 `buildSemanticAuthoringTrajectoryRecords`，按事件 sequence 构建 USER/ASSISTANT/TOOL/SYSTEM。
- [ ] 按 `call_id` 合并工具边界；Terminal 结束未完成工具时派生 INTERRUPTED/FAILED。
- [ ] 实现面包屑、状态摘要、时间轴、Turn 列表、五个 Inspector tabs 和澄清交互。
- [ ] 实现 queued/30 秒停滞/SSE reconnect/terminal view states；计时提示不得改写 Run Projection。
- [ ] 覆盖 keyboard、aria、reduced motion、窄屏堆叠和长输出滚动。

验证：

```bash
pnpm --filter @data-agent/web exec vitest run test/semantic-authoring-trajectory.spec.ts test/qa-event-assembler.spec.ts test/workspace-routes.spec.ts
pnpm --filter @data-agent/web typecheck
```

## 8. 规范与全量验证

- [ ] 更新 backend run-event-streaming 与 frontend component/type-safety specs，记录 public projection、
  V1/V2 replay、单投影多视图和 full-screen route。
- [ ] 运行 `trellis-check`、`trellis-update-spec`，仅采纳已由代码证据验证的发现。
- [ ] 运行 scoped format/lint、diff check 和受影响包构建。

```bash
pnpm exec biome check <owned-files>
pnpm --filter @data-agent/contracts test:contract
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/worker test:unit
pnpm --filter @data-agent/web test:unit
pnpm --filter @data-agent/web build
git diff --check
```

## 9. 浏览器验收矩阵

- [ ] 模型未认证：Start 原地失败，显示认证指引，不创建 RUNNING Run。
- [ ] Worker 未启动但模型 Ready：进入 Run 页，显示 QUEUED；30 秒后显示非权威停滞提示。
- [ ] Worker Ready：输入“新增成交商品数”，观察 USER -> stage -> TOOL -> patch -> validation ->
  ASSISTANT summary -> READY_FOR_REVIEW。
- [ ] 澄清：问题/选项/用户答案在同一轨迹中，恢复后不重复 mutation。
- [ ] SSE 断开/恢复与页面刷新：不重复 record，cursor 连续，terminal 后关闭。
- [ ] 面包屑返回：回到正确 workspace/domain，并携带 runId 显示 Candidate。
- [ ] 直接访问无权/不存在 Run：稳定不泄露错误页。

## 10. Scoped commit 与完成

- [ ] `git status --short` 区分本任务文件与并行改动。
- [ ] 逐路径/逐 hunk 暂存；检查 `git diff --cached --stat` 和 `git diff --cached`。
- [ ] 确认 staged 内容不包含其他任务的 compose/runbook/spec 改动。
- [ ] 创建一个描述本任务的 scoped commit，不 amend、不 squash。
- [ ] 记录 commit、验证结果和已知 deferred items，再运行 `trellis-finish-work`。

## Rollback points

- Contract/DB V2 compatibility gate 未通过：停止在 V1 reader，不启用 V2 producer。
- Public projection 仍包含 checkpoint/tool raw result：No-Go，不进入 UI 集成。
- Start readiness 误把未认证模型标为 Ready：No-Go，保留现有 certification gate。
- SSE replay 产生重复 record 或丢 sequence：No-Go，不提交前端导航切换。
- 不能在并行脏工作区形成安全 scoped index：报告 commit blocker，不宣称任务完成。

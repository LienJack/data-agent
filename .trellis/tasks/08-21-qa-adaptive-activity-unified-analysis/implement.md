# 对话分析自适应活动流与私有目录实施计划

> 状态：计划已收口，等待最终实施批准
>
> 执行前置：用户在看到本轮最终规划摘要后，再发一条明确批准实施的消息；之后才运行 `task.py start`。

## 0. Parent/Child Gate And Baseline

- [ ] 当前任务保持父任务；创建并链接 8 个正式 child tasks：Adaptive Runtime、Activity+Rich Text、TABLE/VChart、
  Private Directory+Trash、Admin Audit、Apple Glass、Attribution Route/Runtime Retirement、Legacy Attribution Cleanup。
- [ ] 每个 child 补齐自己的 PRD/design/implement、owned paths、AC 和验证；获得父任务最终规划批准后再按依赖顺序 start，
  每个 child 一个 scoped commit。父任务只负责纵向集成，不承载大爆炸实现提交。
- [ ] Legacy Attribution Cleanup 不与其他 child 同批启动；父任务新路径验收后必须再次获得明确 destructive Go/No-Go。
- [ ] 记录 `git status --short`；隔离现有 `apps/web/next-env.d.ts`、`tsconfig.tsbuildinfo` 和 Falcon artifacts。
- [ ] 运行 contracts/platform/worker/web focused baseline，确认现有 08-18 activity/Inspector/Team runtime 通过。
- [ ] 确认本地 PostgreSQL 17、Migration Ledger 至 10672、Web/Worker/Indexer health；迁移未就绪先运行 `pnpm dev:migrate`。
- [ ] 固定 DeepSeek Harness/Reasonix reference commit 与 reuse ledger freshness，不读取 Codex 私有实现。

Dependency graph：

```text
Adaptive Runtime ───────────────┐
Activity + Rich Text ───────────┼─> Parent vertical acceptance
TABLE/VChart ───────────────────┤
Private Directory + Trash ──> Admin Audit ─┤
Activity/Rich Text + TABLE/VChart + Directory geometry ──> Apple Glass ─┤
Parent /qa usable ─────> Attribution Route Retirement ─┘
Parent acceptance ──(new destructive approval)──> Legacy Attribution Cleanup
```

Activity/Rich Text 与 TABLE/VChart 可以在现有 public-event baseline 上并行规划；Admin Audit 依赖 directory authority；
“Core Web geometry”不是第九个 child，而是 Activity/Rich Text、TABLE/VChart 与 Directory 三个 child 共同产出的 layout acceptance
结果；该 geometry gate 通过后 Apple Glass 才收口。Attribution physical cleanup 永远不进入父任务自动 Full Gate。

## 1. Contracts And Conversation Authority

- [ ] 在 `packages/contracts` 增加完整 `AgentDispatchPlan@1.0.0`、严格 `AgentDispatchAdmissionResult`（EXECUTE/DEFERRED）、`WorkspaceConversation@2.0.0`、
  `WorkspaceConversationFolder@1.0.0` 和 directory commands/results；版本化扩展现有 CHART preview，不增加第二套 chart model。
- [ ] 保留 v1 Conversation 解码；新 route/repository 只输出 v2，不在旧版本追加 strict 字段。
- [ ] 新增 10673 Migration：folders、conversation state/folder/order/retention 字段、composite owner FK、约束、索引、RLS、
  owner commands、hardened audited admin read RPC、retention claim/eligibility/receipt。
- [ ] 新增 10674 forward Migration：版本化 dispatch command/lease payload，更新 PostgreSQL validator、routing trigger、acceptance RPC
  与 lease validation；旧 payload 显式映射 `LEGACY_FIXED@1`，禁止改写既有 migration。
- [ ] 扩展 `workspace-data-repository.ts`，所有 unknown 在边界解析；owner mutation 与 admin read 使用不同方法。
- [ ] 增加 PostgreSQL test-support：两个 owner、Workspace Admin、Super Admin、ID 猜测、revocation、Running delete、
  archive/trash/restore、restore-vs-purge、重复/崩溃接管、legal hold、`deleted_at + 30 days`，以及 DIRECT/单 Agent/多 Agent/
  DEFERRED/legacy lease。

Validation：

```bash
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/platform test:unit
./infra/supabase/test-support/run-postgres-smoke.sh
./scripts/test-platform-integration.sh
```

部署顺序：contracts/read compatibility → 10673 → 10674 → API/repository writers → Worker/Web readers。Rollback point：迁移前停止；
若 10673/10674 已应用，只做新的向前 repair migration，不修改旧 migration。

## 2. Adaptive Runtime

- [ ] 扩展 Run admission、frozen lease/profile refs、`data-agent-team-runner.ts`、`production-team-runtime.ts`、
  `mastra-profile-composition.ts`、`production-team-tools.ts` 与 root acceptance，使 dispatch plan 在执行前冻结。
- [ ] 增加 deterministic eligibility + constrained orchestrator plan validator；持久化 policy/executor version、question class、
  dependency edges、required evidence、reason codes、capability hash 和 direct admissibility receipt。
- [ ] 实现 DIRECT root provider answer；不得创建 child task/handoff/agent status placeholder。
- [ ] DIRECT 只允许无需新事实的解释类请求；数据/报告/归因无法路由时 deferred，禁止无 Artifact 自由回答。
- [ ] DEFERRED admission 只持久化公开 receipt，不创建可执行 Run/task，不产生伪 Subagent/Tool event；重放保持同一 receipt。
- [ ] TEAM 只创建 selected child tasks，补齐只读 Semantic tool branch，验证依赖顺序、Task Capability、Context Epoch、Artifact/Acceptance。
- [ ] 失败/取消/重放时只闭合真实存在的 child tasks；SSE connection state 不改变 Agent status。
- [ ] 旧在途 Run 使用冻结 `LEGACY_FIXED@1` executor 到终态；SHADOW cohort 新 Run 也实际执行 `LEGACY_FIXED@1`，只旁路保存
  `shadow_dispatch_plan_ref/policy_version`；只有 ENFORCED cutover 后的新 Run 使用 `ADAPTIVE@1`。
- [ ] 先运行 SHADOW routing corpus，对比 fixed baseline 的 false-direct/false-team、Artifact coverage、p95、成本和完成率；
  阈值通过后 ENFORCED。cohort/cutover 持久化，rollback 仅影响新 Run，回退为 `ROOT_ONLY_DEFER_DATA`。
- [ ] 加入 DIRECT、Semantic-only、Text2SQL-only、Text2SQL+Report、全链、DEFERRED、denied、旧 Run 升级接管、
  SHADOW 不执行 adaptive、replay/crash tests。

Validation：

```bash
pnpm --filter @data-agent/agent-runtime test:unit
pnpm --filter @data-agent/worker exec vitest run test/teams
pnpm --filter @data-agent/worker typecheck
```

Rollback point：旧 executor 仅服务既有 Run；adaptive plan 无法验证时进入 `ROOT_ONLY_DEFER_DATA`，数据问题稳定 deferred。

## 3. Directory API And UI

- [ ] 新增 owner folders/directory/message-search/command routes；覆盖 folder/conversation reorder，统一错误映射、分页、snippet、
  取消和 non-enumeration。
- [ ] 所有 cookie-authenticated POST/PATCH/DELETE 复用 workspace mutation guard：校验 allowlisted Origin/Host 和
  `Sec-Fetch-Site`，拒绝 missing/null/cross-site Origin；service-to-service 仅允许非 Cookie 专用身份。补齐每条 mutation route tests。
- [ ] `VIEWER` 只获得本人目录、消息、Run、SSE、Trajectory、Subagent 与 Artifact Preview 的只读 projection；所有本人
  folder/conversation mutation 均以稳定 capability-denied 失败，且不新增 `QA_DIRECTORY_SELF_MANAGE`。Artifact Export 继续单独鉴权。
- [ ] 新增独立只读 admin routes/RPC：directory、messages、events/SSE、trajectory、Subagent、Preview/Export，以及
  app-scoped Super Admin global directory；逐次写不可变 audit receipt，绝不复用 owner mutation/read bypass。
- [ ] Harden SECURITY DEFINER：专用无登录 owner、空 search path、全限定名、最小 grant、FORCE RLS、actor 来自 DB session。
- [ ] `qa-types.ts` / `qa-store.ts` 使用 v2 directory projection、server cursor 和提交后更新；允许非权威 pending overlay，
  不做 optimistic authority mutation。
- [ ] 重做 `conversation-list.tsx`：搜索、folder tree、未分组、展开其余、相对时间、严格运行状态和菜单。
- [ ] Folder archive 保留 membership/order；Folder delete 二次确认并原子 ungroup。实现 Conversation rename、reorder、move、
  archive、trash、restore、30 天说明；Running/等待审批/等待回答没有 terminal receipt 时删除失败关闭。
- [ ] 管理员 `/w/:workspaceId/qa/admin` 与 `/admin/qa` 显示 owner/Workspace/Folder/state、只读 banner 和返回个人目录动作。
- [ ] 移动 drawer 与桌面侧栏共享 projection；补键盘、tree semantics、focus return、拖拽替代菜单。
- [ ] 保证 conversation URL restore、SSE abort/generation guard、Inspector 单选状态机与目录切换一致；每个 replay page 重验权限，
  覆盖 revoke 后同连接停止、future/expired/gap cursor reset。
- [ ] 增加逐组件状态矩阵测试：empty/loading/pagination/error/reconnect/stale/conflict/revoked/audit-failed/HELD。

Validation：

```bash
pnpm --filter @data-agent/web exec vitest run test/qa-directory-store.spec.ts test/qa-inspector-store.spec.ts
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web lint
```

## 4. Rich Text, Table And VChart

- [ ] 安装并锁定：

```bash
pnpm --filter @data-agent/web add react-markdown remark-gfm rehype-sanitize @visactor/vchart @visactor/react-vchart
```

- [ ] 新增安全 Markdown renderer：受控 heading outline、段落、strong/em、列表/task-list、引用、hr、inline/code fence、
  safe/Artifact links、GFM table；每条回答使用 `<article>`。
- [ ] 禁止 raw HTML、`dangerouslySetInnerHTML`、危险 URL、本地路径、远程/data-URL 图片和未经治理的模型 spec。
- [ ] 扩展 activity assembler，把 committed TABLE/CHART Artifact 按 sequence 插入正文；user message 不装配 activity。
- [ ] 从 accepted QueryEvidence 通过确定性 server projection 产生 committed CHART reference；版本化扩展现有
  `ArtifactPreviewResult.CHART`，覆盖 line/bar/pie、单位、series/legend、source/hash/range/citations 和 dataset digest。
- [ ] 实现分页 Table block 和动态 VChart client leaf；每个图表固定提供等价“查看数据表”，tooltip 不作为唯一数据源。
- [ ] 限制 chart payload/series/points/depth/label，超限稳定失败；Inline 与 Inspector 共用 renderer 和 exact reference。
- [ ] 增加 Markdown XSS/remote-image、未闭合 fence、CJK、长链接、heading outline、large table、chart bad spec/SSR、
  数值/单位/聚合/截断/hash metamorphic tests。

Validation：

```bash
pnpm --filter @data-agent/web exec vitest run test/qa-event-assembler.spec.ts test/chat-message-activity.spec.tsx
pnpm --filter @data-agent/web test:unit
pnpm --filter @data-agent/web typecheck
```

## 5. Apple Glass System

- [ ] 重新读取并执行用户指定的 `design-taste-frontend` skill；参数保持 8/6/4。
- [ ] 在 `design-system.css` 建立 glass semantic tokens、opaque fallback、reduced transparency/motion。
- [ ] 应用于 Workspace Q&A shell、Sidebar、Topbar、Composer、Inspector、Overlay；正文与表格保持实色阅读面。
- [ ] 使用 Phosphor icons；禁止 emoji、紫色 AI 渐变、霓虹、过量 capsule 和 hover layout shift。
- [ ] 首版只交付现有浅色主题；正文/状态文字 4.5:1、focus/边界 3:1，fallback 只依赖可测 CSS/用户设置。
- [ ] 只对 transform/opacity 做 motion；最小矩阵校验 1440x1000、1024x768、768x900、767x900、390x844，
  同时保留 1280/1000/959 container concession regression。
- [ ] 更新 DeepSeek Harness reuse ledger/MIT notice，记录每个新增适配 target、差异与验证。

## 6. Legacy Attribution Retirement

- [ ] 删除 workspace navigation 的 attribution item 与中英文产品文案；只保留“对话分析”。
- [ ] 将授权后的 `/w/:workspaceId/analysis` 重定向到 `/w/:workspaceId/qa`；旧 deep link 不恢复详情。
- [ ] 删除 Web/Worker 可达的旧 Attribution/F9 产品调用；正式归因请求返回稳定 deferred capability。
- [ ] 证明 controlled-attribution eval、通用 Q&A Run/Artifact、计费、身份和安全审计仍通过。
- [ ] 产出只读 inventory：明确 generic `/analysis` Run/Artifact 无 origin discriminator，当前 child 不执行历史数据 DELETE。
- [ ] 独立 Legacy Attribution Cleanup child 只处理证明为 Attribution 专属的 10620/10621 rows；标准 migration 最多安装
  fail-closed cleanup contract/receipt，不执行 DELETE。
- [ ] 父任务验收后重新取得 destructive Go/No-Go，再通过环境限定 operational command 绑定 inventory digest、PITR/备份、
  exact counts/holds；同事务重验后执行，任何 mismatch 立即回滚。

Validation：

```bash
if rg -n 'workspace\.surface\.analysis|归因分析' apps/web/src; then exit 1; fi
test "$(rg -l '/analysis' apps/web/src | sort)" = "apps/web/src/app/w/[workspaceId]/analysis/page.tsx"
pnpm test:contract
pnpm test:security
./infra/supabase/test-support/run-postgres-smoke.sh
```

## 7. Cross-Layer And Browser Acceptance

- [ ] 启动并分别报告 database、Migration Ledger、Web、Worker、Indexer 与可选服务 health。
- [ ] 使用两个普通用户证明 Folder/Conversation/Message/Run/SSE/Inspector/Artifact/Search/URL 完整隔离。
- [ ] 使用 VIEWER 证明本人只读路径可用、全部目录 mutation 被拒绝，且目录读取不会隐式获得 Artifact Export。
- [ ] 使用 Workspace Admin/Super Admin 证明显式只读审计、过滤和 audit receipt，不能代用户写入。
- [ ] 真实运行简单 DIRECT 问题与多种 TEAM 问题，证明只有实际 Subagent 出现，refresh/SSE reconnect 顺序不变。
- [ ] 真实 SQL 返回 TABLE，趋势问题返回 VChart，富文本标题/代码/链接安全，Artifact hash/denied 失败关闭。
- [ ] 验证 rename/archive/trash/restore、Running delete gate 和 30 天 retention clock（可控数据库时间 fixture）。
- [ ] 验证连接中 revoke、cursor future/expired/gap reset、restore-vs-purge、scheduler outage/重复/部分批次。
- [ ] 只使用合成 fixture；截图/SSE/SQL receipt 结构化脱敏并通过 Secret/PII 扫描后保存到任务 artifacts。
- [ ] 固定代表性 routing corpus，与 fixed baseline 比较不必要调用率、漏调率、首次正文/终态延迟、成本和回答护栏；
  达到冻结阈值后才允许 `SHADOW → ENFORCED`。
- [ ] 父任务验收不依赖物理历史删除；Legacy Attribution Cleanup 另行批准、执行和 post-check。

Full gate：

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:tenancy
pnpm test:security
```

## 8. Finish

- [ ] 使用 `trellis-check` 做跨层 review，修复 P0/P1/P2 或记录明确 HOLD。
- [ ] 使用 `trellis-update-spec` 更新 backend/frontend executable specs：dispatch plan、conversation directory、
  governed chart/Markdown、legacy retirement。
- [ ] `git diff --check`，核对只暂存本任务 owned paths；不纳入 Falcon artifacts 与生成文件。
- [ ] 按 Task Commit Policy 每个 child 创建一个 scoped commit，父任务只做集成验收/文档提交；禁止大爆炸单提交。
- [ ] 运行 `trellis-finish-work`，记录验证、commit、未完成 HOLD 与后续独立语义知识库任务。

## 9. 2026-08-23 Trajectory Workbench Increment

- [x] Contracts：增加严格 `model-request-performance@1.0.0` 公共投影与 parser/tests；unknown field、token closure、
  unavailable truth table、context/output ceiling 必须失败关闭。
- [x] Worker：保留 Direct Provider terminal usage 和总耗时/attempt count；在可信 Run context 自动发布
  `model.request` started/completed/failed，且事件内容通过公开脱敏边界。
- [x] Web model：按 Conversation 全部 Run 构建稳定 Turn 记录，支持 Turn 摘要折叠、搜索自动可见、Inspector exact Run routing，
  并保留大列表虚拟化和时间轴聚合。
- [x] Web UI：增加 Request/模型性能 disclosure；Composer 增加 ContextMeter 的 ring trigger、popover、Escape/outside click、
  profile switch/unavailable gating。
- [x] 删除 `apps/web/src/components/qa/trajectory-view.tsx`，扫描证明无残留 import。
- [x] 更新 DeepSeek Harness reuse ledger / MIT 来源记录；固定 reference commit 为
  `47f943859bef60e4160492346772ded9b24f765a`。
- [x] Focused validation：contracts、worker run context/direct dispatcher、web workbench/context meter/view、typecheck、lint、
  `git diff --check`；只暂存本增量 owned paths并创建 scoped commit。

验证结果：Contracts 82 files/864 tests、Worker 10 files/74 tests、Web 114 passed + 1 skipped files/434 passed +
1 skipped tests；Contracts/Worker/Web typecheck、Contracts/Worker/Web build、Web Biome 全通过。Next build 保留 6 条既有
dynamic filesystem tracing warning，本增量未新增 warning source。

## Risky Files And Ownership

- Contracts：`packages/contracts/src/workspaces/**`、`packages/contracts/src/agents/**`、Artifact chart contracts；
- Database：新增 10673/10674、可选 cleanup contract migration、PostgreSQL test-support，禁止改写既有 migration；
- Platform：`workspace-data-repository.ts`、Job Center handler、admin audit projection；
- Worker：Run admission、team runner、`production-team-runtime.ts`、profile composition/tools 与 focused tests；
- Web：workspace navigation/i18n、Q&A routes/store/types/components、design-system、package/lockfile；
- Reference evidence：当前任务 research/artifacts 与现有 DeepSeek Harness reuse ledger。

并行工作树中的未知文件一律视为用户或其他任务所有；重叠路径先重新读取和最小合并，不使用 reset/checkout 覆盖。

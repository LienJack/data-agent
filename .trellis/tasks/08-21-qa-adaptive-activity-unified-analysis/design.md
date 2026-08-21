# 对话分析自适应活动流与私有目录技术设计

> 状态：产品与技术设计已收口，等待最终实施批准
>
> 本文是技术设计，不授权产品代码、依赖安装、Migration 或数据删除。

## 1. Scope And Baseline

本任务在已交付的 08-18 纵向切片上增量建设。下列能力直接复用，不重建第二套状态机：

- `PublicRunEvent@2.0.0`、PostgreSQL sequence、SSE replay cursor 与 terminal closure；
- `run.agent_status`、Tool 的 `profile_id/task_id`、ArtifactReference 与 PostgreSQL validator；
- `production-team-runtime.ts` 的 Task/Handoff/Capability/Context Epoch/Completion/Acceptance 权威；
- `qa-event-assembler.ts` 的 sequence activity projection、`qa-inspector.tsx` 与 Artifact Preview；
- DeepSeek Harness 的 assembler/disclosure/Inspector 适配及现有 MIT notice；
- Reasonix 的共享运行时、类型化事件与 surface adapter 分层思想。

本任务不建设语义知识库自动生成能力，只读取 Frozen Effective Config 中已经发布的 Semantic Release。

## 2. Architecture

```text
Question + Frozen Conversation Resources
                 |
                 v
      Deterministic eligibility envelope
                 |
                 v
  constrained orchestrator route intent
                 |
                 v
      AgentDispatchPlan validator
          /                  \
      DIRECT                 TEAM
  root answer only      selected child tasks only
          \                  /
           durable PublicRunEvent
                    |
       baseline page + live SSE cursor
                    |
 sequence activity + Markdown + Artifact blocks
                    |
       Web document / Inspector / Chart leaf
```

```text
owner commands                         admin audit view
      |                                      |
      v                                      v
Workspace Q&A API                    explicit Admin Q&A API
      |                                      |
      +---------- PostgreSQL authority ------+
                 folders/conversations
                 archive/trash/search
                 owner RLS + audited admin RPC
                           |
                  Job Center retention task
```

核心边界：Runtime 和 PostgreSQL 是 authority；Web store 只做服务端结果 projection；SSE 连接状态不是 Agent
状态；Agent/Tool/Subagent 是否展示只由 durable event 证明。

## 3. Delivery Slices

### Slice A — Adaptive Team Runtime

在 `packages/contracts` 增加严格的 `AgentDispatchPlan@1.0.0`：

```ts
type AgentDispatchPlan = {
  schema_version: "agent-dispatch-plan@1.0.0";
  run_id: string;
  executor_version: "ADAPTIVE@1" | "LEGACY_FIXED@1";
  policy_version: string;
  question_class: "EXPLANATION" | "SEMANTIC_READ" | "DATA_QUERY" | "REPORT" | "ATTRIBUTION";
  mode: "DIRECT" | "TEAM";
  selected_profile_ids: Array<
    "semantic-management-agent" | "governed-text2sql-agent" | "report-writing-agent"
  >;
  dependency_edges: Array<{ from: string; to: string }>;
  required_evidence_kinds: string[];
  reason_codes: string[];
  capability_snapshot_hash: `sha256:${string}`;
  direct_admissibility_receipt: `sha256:${string}` | null;
};

type AgentDispatchAdmissionResult =
  | {
      kind: "EXECUTE";
      plan: AgentDispatchPlan;
      effective_executor_version: "ADAPTIVE@1" | "LEGACY_FIXED@1";
      shadow_dispatch_plan_ref: `sha256:${string}` | null;
    }
  | {
      kind: "DEFERRED";
      run_id: string;
      question_class: AgentDispatchPlan["question_class"];
      reason_code: string;
      required_capabilities: string[];
      receipt_hash: `sha256:${string}`;
    };
```

执行分两步：

1. 确定性 eligibility 只根据冻结的资源、问题类别、允许的 Product Profiles、预算和 capability readiness
   产生候选集合，禁止选择未授权 profile。
2. Root Orchestrator 在候选集合内产生严格 route intent；validator 拒绝未知、重复、越权、依赖不闭合或空 TEAM。

`DIRECT` 只允许无需查询新事实、无需正式报告且无需治理变更的解释类请求；数据、报告和归因类请求在无法安全路由时返回
严格 `DEFERRED` admission result 和 durable public receipt，不创建可执行 Run/task，也不伪造 Subagent/Tool 状态；Root Provider
不得自由补数。合法 DIRECT 只创建并执行 root task，通过相同 Provider authority 产生公开回答，不创建 child task、handoff 或
`run.agent_status`。`TEAM` 只为 `selected_profile_ids` 创建 child task。Report 不再是固定尾节点；只有请求正式报告或
所选链路需要报告合成时才加入。Semantic 已冻结可读时通常不创建 Semantic child；需要语义解释或治理能力且该 profile
被授权时才创建。

调度计划以 content-addressed receipt/Artifact 持久化并绑定 Run，重放必须得到同一计划。失败关闭错误包括：
`AGENT_DISPATCH_PLAN_INVALID`、`AGENT_PROFILE_NOT_ALLOWED`、`AGENT_DEPENDENCY_UNSATISFIED`、
`DIRECT_ANSWER_PROVIDER_FAILED`。

Slice A 不只修改 `production-team-runtime.ts`，还覆盖 Run admission、冻结 lease/profile refs、
`data-agent-team-runner.ts`、`mastra-profile-composition.ts`、`production-team-tools.ts` 与 root acceptance/replay。
Semantic-only 必须有只读 Frozen Semantic Release tool branch；DIRECT 必须有不依赖 Report Artifact 的 root acceptance。
Run 创建时冻结 effective executor 与 receipt refs。部署前已经存在的固定三 Agent Run 继续由 `LEGACY_FIXED@1` 接管直到终态，
禁止用新策略重算。`SHADOW` cohort 的新 Run 仍冻结并执行 `LEGACY_FIXED@1`，同时只计算、验证并保存独立的
`shadow_dispatch_plan_ref/policy_version`，与 fixed execution 比较 false-direct、false-team、Artifact coverage、延迟和费用；
不得把 shadow plan 当成实际执行记录。只有进入 `ENFORCED` 后创建的新 Run 才冻结 `ADAPTIVE@1`。cohort、cutover 时间和
executor 逐 Run 固定，回退只影响回退后新 Run，不改变任何在途 Run。紧急回退为 `ROOT_ONLY_DEFER_DATA`，其中数据型问题返回
严格 `DEFERRED`，不生成无证据答案。

### Slice B — Private Conversation Directory

新增 Migration `20260725010673_app_data_agent_qa_conversation_directory.sql`：

- 新表 `qa_conversation_folders`：完整 App/Tenant/Environment/Owner identity、`folder_id`、`name`、
  `sort_order`、`resource_version`、`archived_at`、timestamps；
- `qa_conversations` 增加 nullable `folder_id`、`sort_order`、`archived_at`、`deleted_at`、`purge_after`；
- Folder 使用包含 App/Tenant/Environment/Owner/Folder identity 的 composite unique key；Conversation 的 composite FK
  同时包含 owner，数据库级阻止跨 owner membership；
- `purge_after = deleted_at + interval '30 days'` 由权威命令写入并由约束校验；
- 既有会话 backfill 为 owner 的“未分组”投影，即 `folder_id = null`，不创建共享目录；
- 活跃、归档、回收站使用互斥状态约束，owner identity、创建时间和 Conversation identity 不可变；
- owner/list/search 索引必须包含 owner、状态、更新时间；消息全文检索使用单独的 owner-scoped projection，搜索使用受控长度、
  结果上限、snippet 脱敏和分页 cursor，普通/管理员范围不共享未授权计数。

现有 `WorkspaceConversation@1.0.0` 保留为历史解码输入；新 API 输出
`WorkspaceConversation@2.0.0` 和 `WorkspaceConversationFolder@1.0.0`。严格 schema 不在同一版本偷偷加字段。

Owner 命令：folder create/rename/reorder/archive/restore/delete，conversation rename/reorder/move/archive/restore/trash/restore-from-trash。
Folder archive 保留 membership/order；Folder delete 二次确认后在同一事务把 Conversation 移入未分组，再删除 Folder projection。
命令均含 `operation_id`、`idempotency_key`、`expected_resource_version`，authority 提交成功后 Web 才更新。

普通读取继续使用 exact-principal RLS。管理员不能通过放宽基础 RLS 获得全表权限，而是走独立、显式、只读的
admin directory/detail RPC：函数先验证 `WORKSPACE_ADMIN` 或 `SUPER_ADMIN`，再写 actor、target owner、scope、
reason code 和 timestamp 审计，最后返回最小 projection。普通用户猜测 ID 统一映射
`CONVERSATION_NOT_FOUND_OR_DENIED` / `FOLDER_NOT_FOUND_OR_DENIED`。

Admin RPC 使用专用无登录、无 BYPASSRLS owner、空 `search_path` 和全限定对象名；撤销 PUBLIC/直接表权限，只授予后端
EXECUTE。actor、workspace 和角色从数据库会话上下文派生，不接受请求体伪造。审计表 append-only，记录 request ID、
outcome、目标完整 identity 与导出元数据。基础 owner RLS 保持 FORCE RLS，不为管理员读取而放宽。

Trash 命令先检查关联 Run 是否已有 durable terminal receipt。30 天内 owner 可恢复；到期清理新增严格
`CONVERSATION_RETENTION` Job kind、受控 producer/scheduler、专用最小权限角色、lease/fence、kill switch 与 bounded batch。
`clock_timestamp() >= purge_after` 后才可 CAS claim；restore 只在未 claim 且未到期时提交。Claim、terminal/hold/reference
复核、状态转换和 receipt 在同一租户事务完成，崩溃接管保持幂等。Artifact、计费、审计或法定 hold 存在时只移除用户
projection 并记录 `HELD`，不伪称物理清除。

### Slice C — Rich Activity, Markdown, Table And VChart

回答正文仍由 `answer_delta` 产生，activity assembler 继续按 sequence 合并。Markdown renderer 使用：

- `react-markdown`：React AST renderer；
- `remark-gfm`：表格、任务列表、删除线和 autolink；
- `rehype-sanitize`：明确 allowlist；同时启用 `skipHtml`，不接入 `rehype-raw`；
- 自定义 link transformer 仅允许 `https/http/mailto` 和受控站内路径，外链加安全属性；
- 自定义 H1–H4、paragraph、strong/em、list/task-list、blockquote、hr、code/pre、table 与受治理 Artifact link resolver，
  不使用 `dangerouslySetInnerHTML`；
- 禁止远程、data-URL 与任意 Markdown image，`img` 统一渲染 blocked placeholder；
- 每条 Assistant 回答是独立 `<article>`，模型 H1–H4 映射到页面基准以下的受控 heading level，禁止重复页面 H1 和层级跳跃。

流式增量只更新当前 text block；key 来自 Run/block identity，不以 Markdown AST position 作为持久 identity。
未闭合 fence 只能影响当前 text block，不能重建 Tool/Subagent/Artifact block。

Disclosure public detail allowlist：Think 仅 title/summary/status/duration；Tool 仅 public input/output 摘要、error code 和
ArtifactReference；Subagent 仅 profile/task、public phases、owned Tool/Artifact；Artifact 仅 strict preview metadata。
状态不只靠颜色；RUNNING delta 不逐 token 进入 live region，只对开始、阻断、失败、完成做节流后的 `aria-live="polite"`
播报，阻断/失败提供确定的重试、查看详情或返回动作。

Artifact 展示继续以 committed `ArtifactReference` 为唯一入口：

- `TABLE`：服务端 Preview 返回列、类型、受控分页窗口、总行数、null 与截断信息；Web 不加载无限全表；
- 不创建第二套 `GovernedChartModel`。版本化扩展现有 `ArtifactPreviewResult.projection.kind === "CHART"`，补齐
  `line/bar/pie`、title/unit/series/legend、等价 table projection 和受控数据窗口；Inline 与 Inspector 共用同一 renderer；
- 从 accepted QueryEvidence 通过确定性 server projection 产生 committed CHART ArtifactReference；transform 只允许固定
  聚合、排序、null 与截断规则，并绑定 source identity/revision/content hash、projection/transform version、dataset hash 与
  Frozen Semantic Release identity；
- schema 限制 payload bytes、series 数、每序列 points、嵌套深度和 label/title 长度，超限返回
  `CHART_DATA_LIMIT_EXCEEDED`；所有文字按纯文本处理；
- 模型输出的任意 VChart spec、JavaScript function、formatter、HTML、外部数据 URL 一律拒绝；
- Web client leaf 将 strict CHART projection 映射为 VChart options，使用
  `@visactor/react-vchart` / `@visactor/vchart`，SSR 只输出确定尺寸的 skeleton；
- 图表后固定提供“查看数据表” disclosure；tooltip 不是唯一数据来源，标题、摘要与截断信息使用 `aria-describedby`；
- Table/Chart block 均显示 source identity、revision、content hash、window/range、truncation 和 citations，并验证 Inline 与
  Inspector 完全一致；denied/stale/hash mismatch/unsupported/truncated 使用稳定公开错误，不 fallback 到 raw body。

### Slice D — Apple Glass Presentation

在现有 `design-system.css` 增加语义 material token，而不是在组件散落 blur 值：

```css
--glass-fill;
--glass-fill-strong;
--glass-border-inner;
--glass-shadow-tint;
--glass-blur;
--glass-saturate;
```

Sidebar、Topbar、Composer、Inspector 和 Overlay 使用三层材料结构：半透明 fill、1px 内高光/折射边、低饱和染色
阴影。正文、表格主体和长文本保持近实色阅读面。禁止紫色 AI 渐变、霓虹、纯黑大底、过量胶囊和 emoji 图标。

`@supports (backdrop-filter: blur(...))` 外提供不透明 fallback；`prefers-reduced-transparency` 或项目设置下降低
透明度；`prefers-reduced-motion` 禁用非必要动画。Framer Motion 只用于 transform/opacity 的进入、Inspector 切换和
菜单，loading 不做 layout 抖动。图表和 Markdown renderer 是隔离的 client leaf，不能把整条消息或页面升级成巨大
client component。

首版沿用现有浅色主题，不在本任务新增暗色主题。正文/状态文本至少满足 WCAG 4.5:1，大字号和非文本 focus/边界至少
3:1。fallback 只依赖 CSS support、用户 reduced-transparency/reduced-motion、print 和项目设置，不猜测设备性能。

### Slice E — Legacy Attribution Retirement

- 删除 Workspace navigation 的 `analysis` 项及中英文归因产品文案；“对话分析”是唯一分析入口；
- `/w/:workspaceId/analysis` 先完成授权检查，再重定向 `/w/:workspaceId/qa`，不恢复旧 deep link；
- Web/Worker 用户路径不得再调用旧 Attribution/F9 runtime；正式归因请求返回稳定 deferred capability；
- `controlled-attribution` eval、共享通用 Run/Artifact、计费/身份/安全审计合同不因产品入口退役而误删；
- 当前父任务只产出只读 inventory，且明确普通 `/analysis` 与 Q&A 共用的 generic Run/Artifact 没有 durable origin
  discriminator，禁止按 URL、问题文本或 Artifact 类型启发式删除；
- 物理删除移入独立 destructive-cleanup child task。它只处理 inventory 证明为 Attribution 专属的 10620/10621 authority
  rows；通用 Run/Artifact、controlled-attribution eval、计费、身份与安全审计保留；
- destructive child 不把 DELETE 放入标准 migration runner。若需要 schema，普通 migration 只安装 fail-closed inventory/
  cleanup contract 与 receipt；实际删除由环境限定的显式 operational command 执行，要求独立批准、inventory digest、
  PITR/备份检查，并在同一事务重验 digest、引用、hold 和 before count；
- 历史结果删除不可回滚，必须在父任务所有新入口、运行时和纵向验收完成后再次 Go/No-Go，禁止宽泛表名 glob 或无计数 DELETE。

## 4. API And Route Shape

Owner API：

- `GET/POST /api/workspaces/:workspaceId/qa/folders`
- `PATCH /api/workspaces/:workspaceId/qa/folders/:folderId`
- `GET /api/workspaces/:workspaceId/qa/conversations?view=active|archived|trash&folder=&q=&cursor=`
- `PATCH /api/workspaces/:workspaceId/qa/conversations/:conversationId` 使用判别 command，而非多次隐式更新

Folder 与 Conversation 的 rename/reorder/move/archive/restore/trash/delete 都是 cookie-authenticated mutation，必须先经过
共享 workspace mutation guard：校验 allowlisted `Origin` 与 `Host` 一致、`Sec-Fetch-Site` 不是 cross-site，并拒绝浏览器
Cookie 请求缺失或为 `null` 的 Origin。非浏览器 service-to-service 调用只能使用不依赖 Cookie 的专用身份。POST/PATCH/DELETE
逐路由复用该 guard，并测试 same-origin、missing/null/cross-site Origin、伪造 Host 与非 Cookie service identity。
- `POST /api/workspaces/:workspaceId/qa/conversations/:conversationId/restore`

Admin API：

- `GET /api/workspaces/:workspaceId/qa/admin/directory?owner=&folder=&state=&q=&cursor=`
- `GET /api/workspaces/:workspaceId/qa/admin/conversations/:conversationId`
- `GET /api/workspaces/:workspaceId/qa/admin/conversations/:conversationId/messages|trajectory|events`
- `GET /api/workspaces/:workspaceId/qa/admin/artifacts/:artifactId/preview|export`
- `GET /api/admin/qa/directory?workspace=&owner=&folder=&state=&q=&cursor=` 仅供 app-scoped `SUPER_ADMIN`

Workspace Admin 从 `/w/:workspaceId/qa/admin` 的“全部用户”入口进入；页面持续显示只读 banner、target owner 和返回个人
对话动作。Super Admin 从 `/admin/qa` 进入全局控制面，不静默创建 Workspace membership。Admin route 永远只读，不复用 owner mutation handler。所有 route 在调用 repository 前解析 contracts，在 repository
边界再次解析 unknown；错误经统一 `workspaceErrorResponse` 投影。

管理员打开 Message、Run replay/live events、Trajectory、Subagent、Artifact Preview/Export 时都走上述独立受审计 projection，
逐次校验 workspace→conversation→run→artifact 完整归属；不得回落到 owner route。

## 5. Web State And Interaction

`qa-store.ts` 只保存服务端成功后的 directory snapshot、cursor、active selection 和 SSE connection state。Rename、archive、
move、trash、restore 不做 optimistic authority mutation，但允许行内 non-authoritative pending overlay、禁用重复命令；失败时清除
pending 并保留原 snapshot。切换 Conversation 必须 abort 旧 SSE，并由 generation guard 拒绝晚到 frame。

对话目录使用 folder tree + server cursor：展开状态和 Inspector 宽度可浏览器本地持久化，但 folder membership、排序、
状态和 owner 不进入 localStorage authority。移动端使用同一 projection 的 sheet/drawer；所有拖拽操作有菜单/键盘替代。

目录运行状态使用严格 `RUNNING | WAITING_APPROVAL | WAITING_ANSWER | FAILED | UNREAD_COMPLETED | IDLE` projection。
Inspector 是 `NONE | SUBAGENT | ARTIFACT` 单选状态机；新选择替换当前 target，close/back、Conversation switch、refresh、
permission loss 和 focus return 都有确定转换。SSE 每个 replay poll/page 重新验证 membership/authz epoch/owner；撤权后停止业务
frame 并安全关闭。Baseline 返回 stream epoch/min/high watermark/terminal sequence；future/expired/gap cursor 返回
`CURSOR_RESET_REQUIRED`，客户端重新取权威 snapshot，assembler 不静默跨 gap。

响应式让步顺序：正文保持至少 640px；空间不足时先收 Inspector（selection 保留），再把 Sidebar 变为 drawer；
`>=1024px` 为三栏或 Sidebar+正文，`768–1023px` Sidebar drawer + 正文且 Inspector 为 overlay sheet，`<768px` 为单列，
目录 drawer 与 Inspector sheet 互斥。移动 sheet 与 Composer/软键盘分行，不覆盖输入；close/back 返回触发控件焦点。

搜索默认覆盖当前 owner 的 active/archived/trash 所选 view，可按 Folder 收窄；消息命中显示受控 snippet、Folder 与 Conversation，
选择后展开所属 Folder 并定位消息。Admin 搜索使用独立上下文和受审计 `q`，不复用个人搜索结果或计数。

组件状态矩阵必须覆盖：首次空目录、空 Folder、搜索无结果、首次/分页 loading、局部失败、SSE reconnect/stale、命令冲突、
权限撤销、admin audit 写失败、restore 失败与 retention `HELD`。每项定义保留内容、主/次操作、ARIA announcement 和恢复条件。

## 6. Compatibility And Migration Order

1. 先发布 v2 contracts、dispatch admission result 与旧 payload read compatibility；
2. 应用 10673，backfill 并验证 directory RLS/约束；
3. 应用 `20260725010674_app_data_agent_adaptive_dispatch.sql`，版本化 command/lease payload，更新 PostgreSQL validator、
   routing trigger、acceptance RPC 与 lease validation；旧 payload 明确映射 `LEGACY_FIXED@1`；
4. 发布 repository/API writers，再发布 Worker/Web readers；
5. 用 PostgreSQL 直连 smoke 验证 DIRECT、单 Agent、多 Agent、DEFERRED 与 legacy lease 后，运行真实 Web + Worker 验收并完成
   SHADOW→ENFORCED 门禁；
6. 当前父任务完成；另一个 destructive-cleanup child 在再次批准后执行显式 operational cleanup。

10673 与 10674 都是可向前修复、非破坏性 schema migration。历史结果删除不进入标准 migration chain。任何 migration Ledger/checksum、
PostgreSQL 17、锁、inventory digest 或引用验证失败都必须停止，不启动 Web fallback。

## 7. Validation And Evidence

- contracts：schema good/base/bad、v1 read/v2 write、EXECUTE/DEFERRED、unknown profile/spec rejection；
- Worker：DIRECT、每种选择组合、无 child placeholder、DEFERRED 无伪 Run、旧 Run 跨版本接管、SHADOW routing corpus、replay、
  budget/permission failure；
- PostgreSQL：DIRECT/单 Agent/多 Agent/DEFERRED/legacy lease、owner isolation、admin audited read、non-enumeration、folder lifecycle、
  Run terminal delete gate、30 天 retention；
- Web unit：assembler、Markdown XSS、streaming fence、table/chart mapping、directory reducer、Inspector/layout；
- browser：1440x1000、1024x768、768x900、767x900 与 390x844，合成 fixture 的两个普通用户、管理员、SSE reconnect/revoke、
  rename/archive/trash/restore、图表；
- destructive child：inventory/after counts、shared-object survival、old route/runtime absence、retention exceptions；
- 截图与 SSE/SQL receipt 保存到任务 `artifacts/` 前执行 Secret/PII 扫描和人工复核；只使用合成 fixture，移除消息正文、
  原始 SQL 结果、邮箱和稳定 principal 标识，不得包含 prompt、SecretRef 值或私有推理。

## 8. Risks And Rollback

| Risk | Control | Rollback |
| --- | --- | --- |
| Router 少调/多调 Agent | versioned plan + routing corpus + SHADOW thresholds | `ROOT_ONLY_DEFER_DATA`; data requests never free-answer |
| v2 Conversation DTO 破坏旧消费者 | versioned decoder + explicit projection | keep v1 read adapter until all consumers migrate |
| Admin 读取越权 | separate audited RPC; base RLS unchanged | revoke admin RPC execute grants |
| VChart/Markdown XSS 或 SSR 不稳定 | controlled model, sanitize, client leaf | fallback to safe table/text projection |
| Glass 可读性/性能下降 | opaque fallback, reduced transparency/motion | switch material tokens to opaque values |
| 30 天清理误删引用对象 | terminal/hold/reference preflight + small batch receipt | stop handler; deleted authority rows are not claimed recoverable |
| 旧归因删除不可逆 | separate approved operational cleanup with digest/counts/PITR gate | no automatic execution; abort on any mismatch |

## 9. Source And Dependency Boundary

DeepSeek Harness 继续按固定 commit `47f943859bef60e4160492346772ded9b24f765a` 作为主要 UI/assembler 代码基线；
任何新增实质性适配必须更新 reuse ledger 和 MIT notice。Reasonix 只参考分层思想，不复制代码。Codex Desktop 只作为
黑盒功能目标。

Markdown 选型依据 `react-markdown` 官方安全说明，仍显式叠加 `rehype-sanitize`；VChart 使用官方 React wrapper。
依赖只在实施 Slice C 时安装并锁定，不在规划阶段修改 lockfile。

## 10. Access Matrix

| Resource/action | Owner with Q&A write | VIEWER | Workspace Admin cross-owner | Super Admin cross-workspace |
| --- | --- | --- | --- | --- |
| Personal directory read | own only | own only | own in personal mode | own in personal mode |
| Folder/conversation mutation | own only | denied | own only | own only |
| Message/Run/SSE/Trajectory read | own only | own only | audited read-only projection | audited read-only projection |
| Subagent/Artifact Preview | own only | own only | audited read-only projection | audited read-only projection |
| Artifact Export | existing export capability only | existing export capability only | existing export capability + audit | existing export capability + audit |
| Continue Run or mutate another owner | denied | denied | denied | denied |

所有 `SECURITY DEFINER` read/purge function 采用专用无登录 owner、空 search path、全限定名、最小 EXECUTE grant 和
append-only audit。SSE 在每个 page/poll 重验权限；admin reason scope 过期或角色降级后立即关闭。

## 11. Requirement Traceability

| PRD coverage | Design owner | Planned child | Primary acceptance |
| --- | --- | --- | --- |
| R1–R6 | Slice A | Adaptive dispatch contract/runtime | AC1–AC5 |
| R7–R14, R33–R35 | baseline + Slice A/C | Activity stream + rich text | AC6–AC9, AC35–AC36 |
| R15–R18 | Slice C | Safe rich text | AC10–AC11, AC14–AC15 |
| R19–R26 | Slice C | Governed TABLE/VChart | AC12–AC15 |
| R27–R32 | Slice E | Attribution route/runtime retirement; separate cleanup | AC16–AC19 |
| R36–R43, R48–R51 | Slice B | Private directory + trash retention | AC20–AC22, AC26–AC28 |
| R44–R47 | Slice B + Access Matrix | Admin audit read plane | AC23–AC25, AC27 |
| R52–R61 | Slice D + Web state matrix | Apple Glass presentation | AC29–AC37 |

每个 child 的 `implement.md` 必须继续细化到 owned files、验证命令和具体 AC；父任务只在所有非 destructive child
提交后做纵向集成。历史归因 physical cleanup 不阻塞父任务交付，并要求新的明确批准。

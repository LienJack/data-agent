# U17 Implementation Plan

## 1. Contract

- [x] 新增 strict `WorkspaceJourneyEvidenceArtifact`、builder、hash verifier 和 required checkpoint closure。
- [x] 增加 Contracts 测试：稳定 hash、未知字段、缺失/失败/重复 checkpoint fail closed。

## 2. I18n And Workspace Chrome

- [x] 新增 typed `zh-CN`/`en-US` messages、Provider、hook 和 language segmented control。
- [x] 新增 Workspace breadcrumb/topbar，保留 pathname/query/hash 和 Run/Task/Artifact 上下文。
- [x] 让 Sidebar、StatusBar 使用统一翻译，不改服务端 capability 过滤。

## 3. Agent And Context Surfaces

- [x] 让 ProcessDisclosure、AgentTeamTrace、ContextPreview 使用统一双语展示。
- [x] 保持 reasoning/tool 默认折叠、ARIA button semantics、公开字段 allowlist 和 durable SSE projection。
- [x] 增加中英文、安全字段与交互回归测试。

## 4. Journey Guidance

- [x] 新增 Greenfield 状态、角色交接、四轴状态和 Reason Code 恢复矩阵纯函数。
- [x] 新增可访问的 GreenfieldJourneyPanel，并接入 Workspace 首页或唯一宿主页。
- [x] 覆盖 `OUTCOME_UNKNOWN` 仅 Reconcile、Permission/Denial 无 Retry、Limit 无 Resume。

## 5. Runbook And Evidence

- [x] 写 `docs/runbooks/datafoundry-coa-quick-start.md`，明确角色、页面、状态和 U18 边界。
- [x] 用 focused tests、typecheck/build 和桌面/窄屏浏览器生成 U17 evidence fixture。
- [x] 验证 artifact hash/required closure 后供 U18 引用。

## 6. Quality And Commit

- [x] 运行 Trellis check、定向 Biome、Contracts/Web tests、typecheck/build。
- [x] 审核 staged allowlist，仅提交 U17 owned paths。
- [x] scoped commit 后归档任务并自动进入 U18。

## Validation Evidence

- Contracts: 70 files / 796 tests passed; typecheck and build passed.
- Semantic: 17 files / 142 tests passed; typecheck and build passed.
- Web: 89 files / 323 tests passed, 1 test skipped by design; typecheck and Next production build passed.
- Next build retained 6 pre-existing dynamic filesystem tracing warnings; no U17 build error.
- Browser desktop 1440x1000 and mobile 390x844 had no document horizontal overflow.
- Locale switching preserved the exact URL and persisted only `data-agent.interface-locale`.
- Context Preview reached the governed API and rendered `RESOLVED_CONTEXT_DEFAULTS_INCOMPLETE` as an explicit error for the local workspace.
- Reasoning/tool disclosures started collapsed; keyboard Enter toggled details; hidden payload was absent while collapsed.
- `scripts/verify-workspace-journey-evidence.ts` verified 12/12 checkpoints and artifact hash `sha256:8bcd99d1bf6f244b5f945901942d21f78ad4c372e3df4eae9e64b01185cb162f`.
- Falcon and real Provider were not imported or executed.

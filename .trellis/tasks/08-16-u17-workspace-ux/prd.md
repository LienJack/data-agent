# U17 统一 Workspace UX、Context Preview、双语与引导

## Goal

把已交付的 Run、Artifact、Job、Knowledge、Extension、Semantic、Datasource、Test Center 与 Agent Team 能力收口到统一 Workspace 体验，并生成可由 U18 校验的内容寻址 Journey Evidence。

## Requirements

### R1. Workspace 信息架构

- 继续使用已提交的 `/w/:workspaceId/**` 服务端授权边界与统一侧栏，不复制业务页面或另建 Authority。
- 工作区顶部持续显示 `Workspace > Surface > Run/Task/Artifact` 上下文；Deep Link 保留查询参数、当前页面和工作空间身份。
- `/qa`、`/semantic`、`/data-sources`、`/platform-settings`、`/tests`、`/results` 各自只承载一种主要职责，跨页内容使用引用和工作空间 Deep Link。

### R2. Agent 对话公开过程

- 任何 Agent 对话都消费统一 Public Run SSE，展示回答、公开推理摘要和工具调用边界。
- 推理摘要及工具调用默认折叠，可用键盘展开；进行中、完成、失败和中断状态可区分。
- 工具 Payload 与 Result 按 `call_id` 合并；刷新或重连后由 durable event 投影重建，不依赖瞬时 UI 状态。
- 禁止展示原始 Prompt、`reasoning_content`、私有 chain-of-thought、Raw Context、SecretRef 或 Provider 原始请求/响应。

### R3. 双语与状态连续性

- Workspace Shell、导航、Context Preview、Agent 过程与 Team Trace 提供简体中文和英文。
- 语言切换不改变 pathname、query、hash、选中 Run/Task/Artifact 或当前 Store；偏好仅是展示状态，不成为 Authority。
- 动态状态使用 ARIA live，所有折叠和语言控件可键盘操作。

### R4. Greenfield 引导与恢复

- 首建阶段固定为 `NO_SEMANTIC_RELEASE → SCHEMA_READY → BOOTSTRAP_RUNNING → CANDIDATE_READY → VALIDATION_FAILED | READY_FOR_REVIEW | PUBLISHED_V1_READY`，并独立显示 `POLICY_MISSING/EXPIRED`。
- Admin、Semantic Agent、Analyst、Semantic Maintainer 的职责、唯一下一步动作和不可执行原因必须明确。
- Permission、NOT_READY、STALE_RELEASE、CHECKPOINT_AVAILABLE、PROVIDER_UNAVAILABLE、THROTTLED、EXECUTION_LIMIT_REACHED、Terminal Policy Denial 使用固定恢复矩阵；`OUTCOME_UNKNOWN` 只允许 Reconcile。
- Task、Evidence、Benchmark、Release 四条状态轴不得折叠；明确 `completed != accepted`、`PASS != GO`、TEST 为 unscored submission。
- Demo、Fixture、Tuning、Holdout、Test、Production 必须显式区分。

### R5. Journey Evidence

- 定义严格、内容寻址的 `WorkspaceJourneyEvidenceArtifact`，绑定 Workspace、Locale、Viewport、角色、检查点、页面、Authority/Artifact 引用和验证时间。
- Artifact 只表达 Goal/CI 验证事实，不冒充产品 Authority Receipt；关键检查点未通过时不得生成 `GO`。
- U18 只能读取 schema/hash 均有效且 required checkpoint 闭包完整的 Journey Evidence。

## Acceptance Criteria

- [x] 中英文切换保持完整 Deep Link 和 Workspace 状态。
- [x] Context Preview 覆盖 idle/resolving/ready/partial/clarification/rejected/stale/error，且只显示公开投影。
- [x] QA Agent SSE 可看到公开思考摘要和工具调用，二者默认折叠并可键盘展开。
- [x] Team Trace 显示 Task/Handoff/Epoch/Verifier 与 Profile/Workflow/Skill/Tool Revision，不泄露私有内容。
- [x] Greenfield 阶段、四轴状态和恢复矩阵具备自动化覆盖，禁止动作不会被 UI 呈现为可执行。
- [x] 内容寻址 Journey Evidence 通过严格 schema/hash/闭包校验，失败检查点不能签发 GO。
- [x] Web focused tests、typecheck、build 与真实桌面/窄屏浏览器旅程通过。
- [x] U17 独立 scoped commit，不包含共享工作树的无关改动。

## Constraints

- U17 不运行或导入 Falcon，不调用真实 Provider；Falcon Agent Team 验收仅在 U18 执行。
- 最终整站视觉重设计不属于 U17，在 U18 完成后使用 `design-taste-frontend` 独立执行。
- 只展示安全的公开推理摘要，不提供模型私有推理过程。

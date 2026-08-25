# 恢复 Root Agent 自主 Subagent 路由

## Goal

恢复 `QUESTION_RUN` 的 Root Agent 自主编排能力：Root Agent 基于当前 Run 冻结的 Agent Card 语义，自主决定直接回答或调用一个/多个 Subagent；涉及工作区数据库事实的问题必须由 Text2SQL Subagent 生成并执行受治理查询，再基于已提交证据回答，不能由 Direct QA 模型以“没有数据权限/未提供数据”为由结束。

本任务同时移除生产问答链路中的正则/关键词意图路由和固定 `query_kind` SQL 模板，使“选择哪个 Subagent”与“生成哪条 SQL”都由 Agent 完成，Host 只负责目录冻结、权限校验、预算、SQL 安全、执行和证据提交。

## Background

当前故障不是数据库尚未授权，而是生产 Worker 绕开了已经存在的 Root/Subagent 链路：

- `apps/worker/src/teams/data-agent-team-runner.ts` 将所有 `QUESTION_RUN` 统一交给 `direct_analysis`。
- `apps/worker/src/teams/direct-qa-analysis-executor.ts` 用正则识别关系问题，其余问题交给无数据库工具的直接模型。
- `apps/worker/src/run-worker-cli.ts` 没有组合 Root turn、Root delegation runtime、Profile registry 和 production team runtime。
- `apps/worker/src/teams/production-team-tools.ts` 即使进入 Text2SQL，也只支持 `TABLE_COUNT`、`MONTHLY_ORDER_TREND`、`UNSUPPORTED` 三种固定分类及固定 SQL。

Root Harness、`delegate_to_subagent@1`、V3 Team Lease、冻结的 Subagent Catalog、Subagent admission、Production Team Runtime 和通用 datasource adapters 仍在代码库中，因此本任务是恢复并完成既有架构，而不是引入第二套 Router。

## Definitions

- **Root Agent**：本轮问答的唯一意图决策者。它读取用户问题与冻结 Agent Card，选择直接回答或原生调用 `delegate_to_subagent@1`。
- **Agent Card**：V2 Profile 的结构化 discovery descriptor，包含 `when_to_use`、`when_not_to_use`、输入/输出 Artifact 与访问模式。
- **Text2SQL Subagent**：把自然语言数据目标与冻结 Schema/Semantic Context 转换为 SQL 候选，并通过受治理 datasource adapter 执行。
- **Host**：服务器确定性的执行边界。它不判断自然语言属于哪个 Agent，只验证模型决策是否在冻结目录、权限、预算和证据边界内。
- **禁止正则路由**：正则、关键词表、switch 分类器和固定 `query_kind` 不得用于选择 Subagent 或 SQL 意图。SQL AST、标识符、凭据引用和错误码的安全/语法校验不属于路由，继续保留。

## Requirements

### R1. Root Agent 是生产问答唯一 Router

- 新的 `effective-config-team-lease@3.0.0` / `ROOT_HARNESS@1` lease 必须先执行 Root turn。
- Root turn 必须读取该 Run 在接收时冻结的 `catalog_snapshot`，不得读取漂移后的 live catalog 代替它。
- Root 可返回严格的 direct final answer，或原生 `delegate_to_subagent@1` tool call；不得把“计划调用某 Agent”写成文本后直接结束。
- 不得以 `classifyAgentQuestion`、`asksForRelationships`、关键词数组、正则或固定 profile mapping 替代 Root 判断。

### R2. Agent Card 驱动、动态发现

- Root 可见的候选必须来自当前 Run 冻结的、已启用且可发现的 V2 Profiles。
- 新增一个满足发布条件的 Profile 后，无需修改 Root router 源码即可被 Root 发现。
- Host admission 必须验证 `profile_id`、Profile revision/hash、tool allowlist、artifact input/output、访问模式和 Run budget。

### R3. Direct answer 的边界

- 一般知识、解释性问题和用户消息中已经明确可见的内容可以直接回答。
- 工作区数字、数据库行、聚合、排行、趋势、关系、血缘、治理状态或正式报告结论不得在没有已接受 Artifact 的情况下直接回答。
- 当证据不足时，Root 必须委派相应 Subagent，或在确实缺少必要业务条件时返回明确澄清；不得生成“当前环境没有营销数据/请提供数据源”这类未经执行链路确认的模板回复。

### R4. Text2SQL 必须真正执行选中的数据库

- Text2SQL 输入必须包含 Root objective、Run 冻结 datasource、精确 schema snapshot、resolved semantic context 和执行预算。
- Text2SQL 模型返回通用 SQL candidate/parameters/answer metadata，不再返回固定 `query_kind`。
- Host 必须将模型输出视为不可信候选，验证单条只读语句、方言、允许的 schema/relation、参数、超时、行数和字节上限。
- 查询必须经由绑定 datasource 对应的 governed adapter 执行，并提交 `SqlArtifact` 和 `QueryEvidence` 后才能向用户展示数据结论。
- 首期必须闭环 PostgreSQL，并覆盖当前 Falcon `falcon_db_24`；其他 dialect 复用同一 Port/契约，但不作为本任务上线门禁。
- datasource 不可用时，系统返回结构化、可诊断的 Host 错误；不得让模型自行宣称“没有数据库权限”。

### R5. Semantic 与 Report 路由边界

- 指标/实体定义、业务关系、Join 关系、依赖和血缘由 Semantic Agent 读取冻结语义图，不由 Text2SQL 替代。
- 数据行、聚合、趋势和排行由 Text2SQL 执行。
- Report Agent 只能消费已接受的 `QueryEvidence` 或其他 Agent Card 声明允许的证据；不得先写报告后补数据。
- Root 可为复合目标发出有依赖顺序的多个 delegation，例如 Text2SQL 后 Report；Host 只执行 admission 通过的调用。

### R6. 保留轻量 Provider 路径

- Root 和 Specialist 模型调用继续使用轻量、服务端配置的 provider transport。
- 不恢复已退役的 model certification、persisted invocation intent、provider permit、billing/ledger 流程。
- Root 带工具时必须允许模型在“直接回答”和“调用工具”之间自主选择；不能被底层 bridge 的 `toolChoice: required` 强迫每次委派。
- tool choice policy 由服务器组合决定，客户端或模型不得覆盖。

### R7. 可观察性与隐私

- 公共 trace 只展示 Root 已选 Agent、实际执行的工具、状态、耗时和已提交 Artifact。
- 不展示 chain-of-thought、system prompt、原始 provider payload、原始凭据、连接目标或未经接受的数据库行。
- 没有被 Root 选择的 Agent 不得产生运行中占位状态。

### R8. 失败关闭与恢复

- Catalog hash、Profile binding、resolved context、schema snapshot、datasource revision、SecretRef、egress 或 SQL policy 任一不一致时必须在 I/O 前失败关闭。
- 重试、租约恢复和 replay 必须复用同一冻结 catalog/context/schema binding，不得因重试重新路由到漂移后的 Profile。
- 已提交 Artifact 和 Team task/handoff 必须保持幂等，不能因 Worker 重启重复公开结果。

## Non-functional Requirements

- 生产 Router 不增加第二次正则/分类器判断；Root 只进行一次 LLM routing turn。
- 默认查询预算不超过 Effective Config 的 `max_elapsed_ms`、`max_tool_calls` 和 datasource adapter 上限。
- SQL candidate 永不直接拼接进管理库连接；只能发送给选中 datasource 的受治理查询适配器。
- 复用 `@data-agent/contracts`、`@data-agent/agent-runtime`、`@data-agent/platform/*` 的稳定 Port，不从 Worker 反向依赖 `@data-agent/evals/*`。

## Out of Scope

- 在本任务中新增 Python Analysis、Research 或任意未注册的 Subagent Profile。
- 重构整个 Q&A UI、Activity timeline 或 Artifact Workspace。
- 恢复 model certification、Invocation Intent/Permit、商业计费或配额账本。
- 首期为 MySQL、ClickHouse、SQLite、DuckDB 接好生产 Secret Provider 和真实环境验收；只保留可扩展接口与契约一致性。
- 让模型绕过 Host 直接持有数据库密码或网络连接。

## Acceptance Criteria

- [ ] 生产 `QUESTION_RUN` V3 lease 执行路径为 Root turn -> admission -> selected Subagent runtime，而不是统一 `direct_analysis`。
- [ ] Root provider 收到冻结 Agent Cards 和唯一原生工具 `delegate_to_subagent@1`，并能在 direct answer 与 tool call 之间自主选择。
- [ ] 生产路由路径不调用 `asksForRelationships`、`classifyAgentQuestion` 或任何正则/关键词意图分类器。
- [ ] “按渠道列出营销投入、收入和 ROI，并做对比表”在 Falcon db24 上走 Root -> Text2SQL -> governed PostgreSQL adapter，产出真实 `SqlArtifact`、`QueryEvidence` 和表格回答。
- [ ] 上述问题不会返回“当前环境未提供营销数据”“请提供数据源”或无执行证据的模板拒答。
- [ ] “订单与客户实体如何关联”只选择 Semantic Agent，不执行 SQL。
- [ ] “解释什么是同比增长”由 Root 直接回答，不启动任何 Subagent。
- [ ] “查询各渠道 ROI 并生成正式报告”先产出 QueryEvidence，再调用 Report Agent；Report 的 source refs 精确指向已接受证据。
- [ ] Text2SQL 不包含 `TABLE_COUNT` / `MONTHLY_ORDER_TREND` / `UNSUPPORTED` 的生产意图枚举，也不再编译电商固定 SQL。
- [ ] 模型产生写操作、多语句、越权 relation、危险函数或超预算 SQL 时，Host 在执行前拒绝。
- [ ] datasource/SecretRef 真正缺失时返回稳定 Host reason code，公共答案不伪装成模型的“没有权限”判断。
- [ ] 重试或 Worker 恢复不会改变 catalog snapshot、schema snapshot、selected Profile 或重复提交公开 Artifact。
- [ ] 新增路由单测、provider bridge tool-choice 测试、Text2SQL policy 测试、team integration 测试和 Falcon db24 真实问答验收。
- [ ] `.trellis/spec/backend/agent-team-runtime.md` 与实际生产路径同步，不再把 Direct QA 记为唯一正式链路。
- [ ] 相关 package build/typecheck/test 通过；真实浏览器 Q&A 页面显示实际 Subagent/SQL/QueryEvidence 链路。

## Rollout and Rollback

- 采用一次受控切换：V3 lease 恢复 Root 路径；旧 V1/V2 lease 继续按明确的兼容策略处理，不用运行时 feature flag 双写两套新链路。
- 发布前完成固定路由语料与 Falcon db24 smoke gate；未通过则不切换 Worker。
- 回滚单位是本任务的单一提交；不保留隐藏正则 Router 或双路由作为长期旁路。

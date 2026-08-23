# Falcon 内置 Schema Demo 与全量评测闭环：实施计划

## 上游依赖与最终门禁

- 本任务是 `08-15-agent-semantic-graph-authoring` 的后置完成门禁；先完成语义层 Graph v2、
  design-taste Studio 重构、本体关系 coverage、GlossaryTerm、Agent-only authoring、真实 Worker、迁移与
  治理，并取得全绿 coverage receipt 后，再开始 Falcon 最终运行。
- 主 Demo 固定采用审计推荐的 db24，db14 保留 32 题 smoke；不再等待主 Demo 选型确认。
- “全部跑通”包括 28 库导入、单题、db14、db24、DEV 309、TEST 191 submission、真实 Worker、
  PostgreSQL、严格 Oracle、权限/密封测试与浏览器客户路径。任一范围未完成或失败都不满足总任务完成。

## 实施原则

- 用户已批准本版 PRD/Design/Implement，Trellis 任务处于 `in_progress`。
- 采用 inline 实施，不派发子 Agent；先合约与失败测试，再做数据平面、转换、runtime 和 UI。
- Falcon 只做固定快照一次性导入；不实现更新、同步和多版本兼容。
- 复用现有 `postgres/data_agent/pgdata`，只增加 `falcon_db_01` 至 `falcon_db_28` schema 和受限只读角色。
- 固定 seed bundle 随仓库分发，标准 `pnpm dev:migrate` 自动幂等导入；普通用户不需要联网或另跑 installer。
- DB-GPT 只读参考，不修改其 dirty worktree，也不引入运行时依赖。
- 仅修改任务 scope allowlist，保留当前 data-agent 工作树中所有无关用户改动。

## Phase 0：批准、任务启动与基线

- [ ] 获得用户对本版 PRD/Design/Implement 的明确批准。
- [ ] 用 Trellis 启动 `08-15-falcon-demo-eval`，记录 data-agent dirty tree 与 scoped allowlist。
- [ ] 记录 DB-GPT 参考 commit 和 dirty tree，仅建立只读证据。
- [ ] 验证当前 Test Center、Workspace/RBAC、datasource/SecretRef、PostgreSQL sandbox、Web、Worker 和模型认证基线。
- [ ] 区分范围内失败与全仓既有阻塞。

Checkpoint：任务进入 implementation，基线证据和回滚点完整。

## Phase 1：固定快照、DB-GPT fixture 与 Contracts

- [ ] 将固定 Falcon zip/目录的关键路径、500 题、28 SQLite、DEV/TEST 计数和摘要写入 source manifest。
- [ ] 从本地 DB-GPT 解析链路提取至少 5 个 compatibility fixture：筛选、聚合、Join、排序、复杂表达式。
- [ ] 扩展 Falcon suite、public/sealed/test case、registry、db/schema mapping、import receipt、submission receipt 合约。
- [ ] 增加 strict schema、round-trip、未知字段、计数和 source digest 测试。
- [ ] 增加 Gold/expected/LOCAL_HOLDOUT 泄漏失败测试。
- [ ] 固定 DEV 10/294/5 manifest 和 TEST 191 manifest。

Checkpoint：contracts/evals fixture 测试通过，尚无数据库副作用。

## Phase 2：现有 PostgreSQL 内的 Falcon Schema 边界

- [ ] 保持 Compose 只有现有 `postgres/data_agent/pgdata`，不得新增 PostgreSQL service、database 或 volume。
- [ ] 建立 `falcon_demo_reader` 只读 role；Workspace datasource 只通过 SecretRef 使用该角色。
- [ ] 建立 `falcon_db_01` 至 `falcon_db_28` schema 与导入 ledger。
- [ ] 只允许现有 migration owner 创建/恢复 Falcon schema；Web/Worker 日常路径不能写 Falcon 业务表。
- [ ] 增加既有服务健康、错误凭据、只读权限、控制面 schema/跨 schema 拒绝和迁移账本测试。

Checkpoint：现有 PostgreSQL 健康，28 个目标 schema 和权限边界已建立，但 suite 仍因无导入回执而 NOT_READY。

## Phase 3：随仓库分发的全量 Seed Bundle

- [ ] 实现只接受本地固定快照的离线 bundle generator；不实现网络下载或更新。
- [ ] 为每个 db_id 解析 SQLite schema、表、列、约束和行，生成对应 PostgreSQL schema 的确定性压缩 seed。
- [ ] 实现确定性 identifier/type mapping 与必要 curated views。
- [ ] 把 LICENSE/LEGAL、source/public manifest、类型映射和 28 个分库 seed 放入 `infra/falcon/`；每个文件有摘要、低于 GitHub 单文件限制且不依赖 Git LFS。
- [ ] 扩展现有 migration runner：核心迁移后自动恢复缺失 seed，同摘要幂等跳过，异摘要或半成品失败关闭。
- [ ] 逐库核对 table/row/null/content digest，并记录 warnings、导入时间和 PostgreSQL size 增量。
- [ ] 防止同名表丢失，验证 28 schema 完备性和干净 clone 离线导入。
- [ ] 汇总 `FalconImportReceipt`；同摘要幂等重放，异摘要/半成品失败关闭。
- [ ] 提供显式 rebuild，但只能 drop/recreate 明确列举的 `falcon_db_*`。

Checkpoint：干净 clone 的标准 `pnpm dev:migrate` 无需联网即可导入 28 库，全部 receipt 和大小增量已记录。

## Phase 4：Workspace datasource 与 catalog

- [ ] 通过现有 Workspace authority 注册指向同一 `data_agent` database、但使用 `falcon_demo_reader` 的 datasource 和 masked SecretRef。
- [ ] 扩展既有本地 `bootstrap:superadmin` 后置流程：首个 Workspace 幂等绑定 Falcon datasource；迁移本身不得伪造用户/Workspace，已有部署由管理员显式启用。
- [ ] 建立 `db_id -> schema -> datasource fingerprint` 权威映射。
- [ ] 扩展 schema scan/catalog 以展示 28 个 logical database、表、字段、样例、行数和大小。
- [ ] 确保 API 全部使用 `/api/workspaces/[workspaceId]/...` 并服务端解析 principal/capability。
- [ ] 增加跨 Workspace 枚举、错误 schema、stale capability 和 secret redaction 测试。

Checkpoint：指定 Demo Workspace 能浏览 Falcon catalog，其他 Workspace 统一拒绝。

## Phase 5：db24 语义层与中文知识

- [x] 为 db24 生成 9 个业务主体、17 个维度、21 个指标、21 个公式、9 张表、70 个字段和 10 个中文术语。
- [x] 用 343 条显式 Edge 表达主体、分析、公式依赖、物理字段、Join、溯源与术语关系。
- [x] 明确金额/日期清洗、库存双源、Join path 和不支持推断。
- [ ] 通过人工 Review -> Publish 建立 db24 active semantic release；当前 Candidate 保持 `REVIEW_REQUIRED`。
- [x] 实现 db24 semantic/knowledge context resolver 与 token budget projection。
- [x] 增加公式、关系、版本、Workspace 和 sealed leak guard 测试。

Checkpoint：db24 Candidate coverage 已全绿，等待人工审核发布；db14 仅保留 smoke，其他库不被错误声明为完整语义化。

## Phase 6：Falcon runtime、PostgreSQL executor 与 Oracle

- [ ] 适配 DEV 309 和 TEST 191 case；公开 serializer 不含密封字段。
- [ ] 支持 certified model 与 Data Agent 两种受测 profile。
- [ ] 构建 case-scoped Prompt：问题、当前 schema、样例和允许的 semantic/knowledge。
- [ ] 实现单语句/只读/schema allowlist/timeout/row-byte limit/cancel executor。
- [ ] 实现严格 result-equivalence Oracle 与 SQLite/PostgreSQL parity receipt。
- [ ] 覆盖 order/unordered multiset、重复行、null、numeric/date/text 和多标准答案。
- [ ] 分离 query rejected/timeout/execution/infra/bad case/oracle failure/mismatch。
- [ ] 实现 Attempt 0 与最多一次有界 Reflection，确保首答不可变。

Checkpoint：deterministic model 在真实 PostgreSQL 上覆盖 PASS、错误答案和全部关键失败分类。

## Phase 7：批量运行、ScoreCard 与 TEST submission

- [ ] 支持单题、db14 32 题、DEV 309 题和 TEST 191 题四种运行范围。
- [ ] Worker 支持长任务 lease、heartbeat、取消、恢复和幂等 terminal transition。
- [ ] 持久化 run/attempt/trace/SQL/result/Oracle/cost/latency 与全部版本引用。
- [ ] 生成 First-pass/Post-reflection/Recovery/Regression 和失败分类 ScoreCard。
- [ ] 实现 DEMO/TUNING/LOCAL_HOLDOUT 本地 GO/HOLD 门禁。
- [ ] TEST 生成 Falcon 要求的 SQL、CSV 和 trace submission artifact，不计算本地 accuracy。
- [ ] 增加 DB-GPT compatibility 报告，作为诊断附件而非正式 Oracle。

Checkpoint：db14 可做快速优化回归，DEV 全量任务可恢复完成，TEST 可生成提交包。

## Phase 8：客户 Demo UI

- [ ] Suite overview 展示固定来源、500 题、28 库与多阶段 readiness。
- [ ] Dataset catalog 展示 DEV/TEST、db/schema、表/字段/样例/题数和大小。
- [ ] 默认 db24 业务页展示关系、指标、glossary 和公开 Demo 题。
- [ ] 单题页展示允许上下文、Agent SQL、执行摘要、Attempt timeline、Oracle 和成本。
- [ ] 批量页展示 db24/db14/DEV ScoreCard 与 baseline/candidate 比较。
- [ ] TEST 页面只展示运行/提交状态和 artifact 下载，不显示伪造准确率。
- [ ] 完善 loading/empty/not-ready/permission/error/retry 和中文文案。

Checkpoint：真实浏览器完成“进入 Workspace -> 浏览数据 -> 运行 Agent -> 查看轨迹/评分 -> 下载提交包”。

## Phase 9：Runbook、真实验证与收口

- [ ] 提供 bundle verify、Workspace verify、semantic import/review/publish、smoke、batch、submission、受限 rebuild 等显式命令；首次 seed 导入本身由 `dev:migrate` 完成。
- [ ] 命令只输出 masked SecretRef 和结构化 receipt，不输出连接密码/完整 DSN。
- [ ] 编写中文 runbook，明确下载即见的一次性 seed、现有 `pgdata` 容量增量、预期计数、诊断和安全回滚。
- [ ] 运行 scoped format/lint/typecheck/unit/contract/integration tests。
- [ ] 验证现有 PostgreSQL migration ledger/checksum 与 Falcon import receipt。
- [ ] 在真实服务完成全量导入、parity、幂等、只读、跨 Workspace 和重建验证。
- [x] 用真实 certified model 完成至少一个 db24 Demo case，并完成 db14/db24/DEV pipeline probe。
- [ ] 验证 DEV 309 run 的创建/恢复/完成，以及 TEST submission artifact。
- [ ] 用真实浏览器验收全部客户路径和 sealed boundary。
- [ ] 使用 `trellis-check` 做 spec drift、跨层合约和 scoped diff 审查。
- [ ] 更新必要 spec，记录全仓无关阻塞，按 allowlist 收口并使用 Trellis finish。

## 预期命令

具体名称以实现后的 `package.json` 为准，计划提供等价入口：

```bash
pnpm --filter @data-agent/contracts build
pnpm exec vitest run packages/contracts/test packages/evals/test packages/platform/test apps/web/test

pnpm dev:infra
pnpm dev:migrate
pnpm bootstrap:superadmin
pnpm falcon:bundle:verify
pnpm falcon:workspace:verify --workspace-id "$FALCON_DEMO_WORKSPACE_ID"
pnpm falcon:semantic:import --workspace-id "$FALCON_DEMO_WORKSPACE_ID"
pnpm falcon:demo:smoke --workspace-id "$FALCON_DEMO_WORKSPACE_ID"
pnpm falcon:eval:batch --workspace-id "$FALCON_DEMO_WORKSPACE_ID" --scope db14
pnpm falcon:eval:batch --workspace-id "$FALCON_DEMO_WORKSPACE_ID" --scope db24
pnpm falcon:eval:batch --workspace-id "$FALCON_DEMO_WORKSPACE_ID" --scope dev
pnpm falcon:submission --workspace-id "$FALCON_DEMO_WORKSPACE_ID" --scope test
```

实现和 runbook 不提供 `falcon:update`、`falcon:sync` 或自动 latest 检查。

## 风险文件与回滚点

1. `compose.yaml`/`infra/docker`：只允许给现有 migration runner 增加只读 seed mount，不能新增服务、数据库、数据卷或改变 `pgdata` 语义。
2. Bundle/restore：目标数据库必须是 `data_agent`，schema 必须解析为明确的 `falcon_db_XX`；禁止接受宽泛数据库/schema 删除目标。
3. Main migrations：在既有迁移账本中创建 Falcon schema、权限、receipt 和默认 datasource；不能把业务表写入控制面 schema。
4. Semantic：只深做 db24，失败可废弃 Candidate 或切回旧 release；Agent 不得自动审批发布。
5. Runtime/UI：readiness 失败时关闭运行入口，历史 run/scorecard 保留。
6. Rebuild：先 authority 停用，再处理明确列举的 `falcon_db_*`；禁止删除 `data_agent`、`pgdata`、使用 `~`、工作区根目录或未解析 glob。

## Definition of Done

- PRD 每条 acceptance criterion 都有自动化或真实运行证据。
- 28 库已由标准首次迁移一次性导入现有 PostgreSQL 的隔离 schema，没有新增 PostgreSQL service/database/volume。
- 干净 clone 无需联网和额外 benchmark installer 即可装入 Falcon；完成既有 Workspace bootstrap 后可看到 db24 主 Demo 与 db14 smoke。
- db24 主 Demo 可浏览、可提问、可看轨迹和评分；db14 可做快速 smoke。

## 当前完成状态（2026-08-16）

- 已完成：固定 bundle、28 schema 导入、Workspace 只读绑定、严格 executor/Oracle、db14 smoke、db24 certified-model 单题、DEV 309 pipeline probe、TEST 191 submission、Test Center 与浏览器验收。
- 已完成：db24 本体 Candidate，157 Node / 343 Edge，coverage 全绿；Candidate artifact 位于 `artifacts/falcon-semantic/falcon-db24-ontology-candidate.json`。
- 待完成：人工审核并发布 db24 Candidate。发布前不得把 Falcon 语义层或总任务标记为完成。
- 已知非本任务阻塞：全仓 lint/unit 仍受共享 dirty tree 中其他任务失败影响；本任务 scoped typecheck/tests/build/browser 均单独保留证据。
- DEV 全量可运行，TEST 可生成提交包，Gold/expected 不泄漏。
- DB-GPT 参考 fixture 有审计证据，但产品不依赖 DB-GPT。
- 真实 PostgreSQL、Web、Worker、模型/Agent 和浏览器均完成端到端证明。
- 本地门禁如实给出 GO/HOLD，不降低 Oracle 或隔离要求。

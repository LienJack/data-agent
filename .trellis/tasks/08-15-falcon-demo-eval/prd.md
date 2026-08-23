# Falcon 内置 Schema Demo 与全量评测闭环

## Goal

将固定 Falcon 快照的 28 个数据库作为内置 Demo 数据，一次性导入现有 `postgres/data_agent` 的隔离 schema，并在现有 Data Agent 平台中形成可浏览、可提问、可单题/批量评测和可持续优化的 Demo Workspace。主 Demo 必须使用多表、跨业务环节和复杂分析题的数据域；其他人下载项目、完成标准首次迁移和既有 Workspace bootstrap 后即可在界面看到同一份数据，无需另起 PostgreSQL 服务或联网安装数据集。

## Background and Confirmed Facts

- 上游固定为 `eosphoros-ai/Falcon` commit `8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5`，Apache-2.0，并保留 `LEGAL.md`。
- 该快照共有 500 题、28 个 SQLite 数据库：DEV 309 题/16 库，TEST 191 题/12 库。
- `db_id=14` 有 32 道中文零售题，但只有 4 表/18 列；它适合快速 smoke，不再满足新的主 Demo 诉求。
- 主 Demo 已固定为 db24：9 表/70 列/17 题（16 道复杂题）；db26、db28 仅保留为选型审计记录。
- 固定快照解压约 310.57 MB，其中 SQLite 约 132.80 MB、CSV 约 174.83 MB；数据规模适合一次性全量导入。
- 本地 DB-GPT commit `7996544a43759506e13a2268e367c26e6b4c0976` 已实现 Falcon 下载、SQLite 汇总、题面/schema 解析、LLM/远程 Agent 调用、SQL 执行、结果比较和报告页面，可作为实现参考。
- DB-GPT 默认跟随上游 `main`、合并到共享 SQLite，并采用较宽松比较规则；这些行为不满足本项目固定数据、PostgreSQL、Workspace 和密封 Oracle 边界。
- 用户明确不要求 Falcon 数据更新；本任务不实现自动同步、升级或漂移兼容。
- 当前 Compose 已有唯一 `postgres` 服务、`data_agent` 数据库和 `pgdata` 数据卷，首次初始化由 `pnpm dev:migrate` 驱动 migration 容器完成。

## Requirements

### R1. 一次性固定快照与导入回执

- 只支持当前固定 Falcon 快照的首次导入和显式重建，不提供在线更新、定时同步或版本迁移。
- 仓库随代码分发由固定快照生成的、按 `db_id` 拆分的 PostgreSQL seed bundle；生成工具接收固定本地快照，校验 commit 标识、LICENSE/LEGAL、500 题、28 个 SQLite 文件、关键文件 SHA-256 和总摘要。
- 标准 `pnpm dev:migrate` 在核心迁移完成后自动、幂等地恢复 seed bundle；不依赖运行时联网下载，也不要求用户额外执行 benchmark installer。
- 导入成功后写不可变 `FalconImportReceipt`，记录来源、文件摘要、题目/数据库计数、目标数据源、表/行数摘要、操作者和时间。
- 文件存在、端口监听或部分表导入不能单独产生 `READY`。

### R2. 现有 PostgreSQL 内的 Schema 隔离

- 复用现有 `postgres` 服务、`data_agent` 数据库和 `pgdata` 数据卷；不得新增第二个 PostgreSQL 服务、数据库或专用数据卷。
- 每个上游 `db_id` 映射为独立 schema `falcon_db_01` 至 `falcon_db_28`，与 `platform`、`semantic`、`app_data_agent`、`auth`、`storage` 等控制面 schema 分离，并禁止合并同名表。
- migration/importer 权限只用于首次导入和显式重建；Agent 使用独立只读 datasource role，只能访问当前 case 对应 schema，不能枚举控制面 schema。
- Workspace、datasource/SecretRef、语义资产、导入回执、运行轨迹和评分继续写入既有控制面 schema；Gold/expected result 不进入 `falcon_db_*`。
- 导入完成后记录现有 `data_agent` 数据库总大小、28 个 Falcon schema 的 `pg_total_relation_size` 以及导入前后增量，验证不会挤占现有服务的运行余量。

### R3. 数据与方言转换

- 28 个 SQLite 数据库完整转换为 PostgreSQL，保留原始表、行和可核验值；类型转换规则必须显式、版本化。
- 对 SQLite/MaxCompute/Hive 特有表达式、金额文本、日期文本和宽松类型，使用受控 PostgreSQL 类型或 curated view，不静默改变业务含义。
- 每个库至少核对表数、行数、列定义、null 计数和确定性内容摘要；关键 case 在 SQLite 标准结果与 PostgreSQL 派生结果间做 parity 验证。
- `db_id -> schema -> datasource fingerprint` 映射是运行时权威，不能由客户端或模型自报。

### R4. Falcon 题库与注册表

- 导入 DEV 309 题和 TEST 191 题，保留 `question_id`、`db_id`、题面、schema、标准 SQL/结果和 `is_order`。
- DEV 固定划分为 10 题 `DEMO`、294 题 `TUNING`、5 题 `LOCAL_HOLDOUT`；划分 manifest 不在运行时随机生成。
- 默认 10 个 DEMO case 来自主 Demo 数据域，形成由单表基线、跨表聚合到 CTE/窗口/占比分析的固定难度阶梯；其余题进入 TUNING/LOCAL_HOLDOUT。
- TEST 191 题无本地 Gold，只能运行并生成 Falcon submission artifact，不产生本地正式 PASS。
- Gold SQL、expected result、LOCAL_HOLDOUT 密封字段只存在 server-only evaluator 存储，不进入普通 API、Prompt、Reflection 或客户 UI。

### R5. Demo Workspace、数据浏览与语义层

- 指定现有 Demo Workspace 注册一个 PostgreSQL datasource，连接到现有 `data_agent` 数据库，但使用只对 `falcon_db_*` 授权的受限 role 和 masked SecretRef。
- 不在迁移中伪造用户或硬编码真实 Workspace；本地首次执行现有 `bootstrap:superadmin` 创建 Workspace 后，幂等挂接内置 Falcon datasource。已有部署由管理员对目标 Workspace 显式启用。
- 客户可以浏览 28 个数据库目录、表/字段/样例/关系和题目；默认进入最终选定的多表复杂数据域。
- 主 Demo 数据域至少包含 7 表、40 列和 10 道精选中文题，并建立覆盖核心实体、关系、维度、指标和中文 glossary 的人工可审阅语义层。
- 精选题至少覆盖多表 Join、聚合/占比、CTE 或子查询、窗口函数/Having；Hard 档至少有 3 题跨 4 张及以上业务表。
- db14 保留为快速 smoke 和简单路径对照，不再承担主产品叙事。
- 除主 Demo 数据域外的其他 27 个库在 v1 只要求物理 schema 浏览和 Agent 评测，不要求逐库建设完整语义模型。
- 语义资产继续走 Candidate -> Review -> Publish；Agent 不得自动批准或发布。

### R6. Agent 运行与确定性 Oracle

- 支持直接模型和 Data Agent 两种受测对象；DB-GPT 的 LLM/远程 Agent 双路径只作为接口形态参考。
- Agent 接收问题、当前 `db_id` 的 PostgreSQL schema、允许的样例和已发布语义/知识切片，生成单条 PostgreSQL 只读 SQL。
- 执行层限制 schema、只读单语句、statement timeout、lock timeout、最大行数、取消和资源预算。
- Oracle 按 expected columns、ordered/unordered row multiset、null、numeric tolerance、date/text 规则判定；不采用 DB-GPT `CONTAIN_MATCH` 作为正式 PASS。
- 分离 `QUERY_REJECTED`、`QUERY_TIMEOUT`、`EXECUTION_ERROR`、`INFRASTRUCTURE_FAILURE` 和 `ORACLE_MISMATCH`。
- 保留 Attempt 0 和最多一次有界 Reflection；基础设施/Oracle/坏题故障不触发 Reflection。

### R7. Test Center 与优化闭环

- Test Center 展示 Falcon readiness、数据源/数据库/schema、DEV/TEST、注册表、模型/Agent、单题轨迹和批量成绩。
- 支持主 Demo 数据域全量回归、db14 快速 smoke、DEV 309 题全量任务和 TEST 191 题 submission run。
- 本地 ScoreCard 分别报告 First-pass、Post-reflection、Recovery、Regression、有效样本、成本、时延和失败分类。
- TUNING 用于 Prompt、语义和策略优化；LOCAL_HOLDOUT 只用于本地发布门禁，不冒充 Falcon 官方 Test 成绩。
- 5 个 LOCAL_HOLDOUT 的 post-reflection pass rate `>= 0.80` 才能标记本地 `GO`，否则为 `HOLD`。
- 运行绑定数据摘要、db/schema 映射、Agent/Prompt/Workflow、模型 Profile、语义/知识、Oracle 和 Run ID。

### R8. DB-GPT 参考验证

- 建立少量只读 compatibility fixtures，覆盖 DB-GPT Falcon parser 的题面、schema、样例、`is_order` 和标准结果映射。
- 对同一 case 记录 DB-GPT SQLite 参考结果与本项目 PostgreSQL 结果的差异；差异必须有明确方言/类型原因。
- 不引入 DB-GPT Python 包、服务、数据库或前端作为生产依赖，也不修改本地 DB-GPT 仓库。

### R9. 可运维性与回滚

- 首次 seed 导入、Workspace 注册、主 Demo 语义部署和评测运行均幂等并产生结构化回执。
- 显式重建只能 drop/recreate 明确列举的 `falcon_db_01` 至 `falcon_db_28`，不得删除 `data_agent` 数据库、`pgdata` 数据卷或任何非 Falcon schema。
- 回滚先停用 Workspace datasource 与运行入口，再只删除 `falcon_db_*` 和对应受限角色；历史运行、评分和来源回执继续保留。
- 提供中文 runbook，覆盖标准首次启动自动导入、验证、Workspace 注册、语义发布、单题/批量运行、submission、诊断和安全重建。

## Out of Scope

- Falcon 自动更新、定时同步、多版本共存和上游 schema 漂移迁移。
- 新增第二个 PostgreSQL 服务、独立数据库或独立数据卷。
- 把 DB-GPT 作为运行时服务、SDK 或 UI 依赖，或修改本地 DB-GPT 项目。
- 为 28 个库全部人工建设完整业务语义层；v1 只深做最终选定的主 Demo 数据域。
- 把 PostgreSQL 衍生成绩直接声明为 Falcon 官方 leaderboard 成绩。
- 自动 Prompt 搜索、无限 Reflection、AI 自动审批语义资产。
- 把 Falcon 业务表写入 `falcon_db_*` 之外的 schema，或把 Gold/expected result 写入 Agent 可读 schema。

## Acceptance Criteria

- [ ] 固定快照校验为 500 题、28 个 SQLite 数据库、DEV 309/TEST 191，并生成完整 `FalconImportReceipt`。
- [ ] Compose 仍只有现有 `postgres` 服务；没有新增 PostgreSQL database/volume，Falcon 业务表只存在于 `data_agent.falcon_db_01` 至 `data_agent.falcon_db_28`。
- [ ] 28 个 `db_id` 精确映射到 28 个 schema，同名表不丢失；逐库表数、行数、null 计数和内容摘要通过。
- [ ] 干净 clone 按文档运行标准 `pnpm dev:migrate` 后，无需联网下载和额外 benchmark 安装命令即可装入 28 库、500 题；完成现有 `bootstrap:superadmin` 后，首个本地 Workspace 可直接看到主 Demo；重复迁移/绑定不会重复写入。
- [ ] 导入完成后记录现有数据库总体/逐 schema 大小和导入增量，现有 Web/Worker/迁移账本健康不受影响。
- [ ] Demo Workspace 能看到 datasource、28 库目录和主 Demo 业务详情；其他 Workspace 无法访问或枚举。
- [ ] DEV manifest 精确包含 DEMO 10、TUNING 294、LOCAL_HOLDOUT 5；TEST 191 不带本地 Gold。
- [ ] 主 Demo 至少有 7 表/40 列、可浏览的实体/关系/指标/中文 glossary，并经过人工审核发布；db14 仅作为快速 smoke。
- [ ] 10 个精选 DEMO case 形成 Easy/Medium/Hard 难度阶梯，覆盖 Join、聚合/占比、CTE/子查询和窗口/Having，且至少 3 个 Hard case 跨 4 表以上。
- [ ] Agent 输入、公共 API、日志和 Reflection 中不存在 Gold、expected result 或 LOCAL_HOLDOUT 密封字段。
- [ ] 至少 5 个 DB-GPT compatibility fixtures 在题面/schema/标准结果层一致，方言差异有记录。
- [ ] 至少一个 Demo case 在真实 PostgreSQL、真实 Worker 和 certified model/Agent 上完成端到端运行。
- [ ] 主 Demo 数据域全量题和 db14 smoke 均可批量运行并产生 Attempt 0/Post-reflection ScoreCard；DEV 309 题全量 run 能创建、恢复和完成。
- [ ] TEST 191 题能生成符合 Falcon 要求的 SQL/CSV/trace submission artifact，但 UI 不伪造本地准确率。
- [ ] 刻意错误 SQL、越权 schema、DDL/DML、多语句、超时、基础设施故障和 Oracle mismatch 均得到正确分类。
- [ ] 真实浏览器验证“选择 Workspace -> 浏览 Falcon 数据 -> 提问/选题 -> 看 SQL/轨迹 -> 看评分/提交结果”的完整路径。
- [ ] scoped typecheck/tests、数据库迁移账本、真实导入、PostgreSQL parity、服务健康和浏览器验收均留有证据。
- [ ] 中文 runbook 能在干净环境中复现一次全量导入、Workspace 注册、复杂主 Demo 和安全回滚。

## Key Decisions

- Falcon 是本阶段唯一新增 benchmark；AgenticDataBench 不进入本任务。
- 一次性全量导入 28 个数据库，不做 Falcon 更新机制。
- 复用现有 `postgres/data_agent/pgdata`，通过 28 个 `falcon_db_*` schema、受限角色和 case-scoped `search_path` 隔离。
- 固定 seed bundle 随仓库分发并接入标准首次迁移；沿用现有 Workspace bootstrap，完成正常首次启动即可看到 Demo。
- 全量数据与题库接入；db14 降级为 smoke，db24 固定为多表复杂主 Demo。
- DB-GPT 是可审计的参考实现，不是运行时依赖。
- PostgreSQL 衍生 Oracle 与官方 Falcon submission 明确分开。

## Risks and Deferred Items

- SQLite/MaxCompute/Hive 到 PostgreSQL 的方言与类型差异可能使少数 Gold SQL 无法直接迁移；以固定 expected result、显式转换规则和 parity receipt 管理。
- 全量 seed 会增加 clone 体积和首次迁移时间；采用按 db_id 拆分、压缩且单文件低于 GitHub 限制的 bundle，并用摘要和导入计时验收，避免 Git LFS 成为下载前置条件。
- DB-GPT 文档与代码对 Agent 支持状态存在漂移；只复用已读源码中的稳定数据契约，不以文档宣称替代本项目验证。
- db24 有两个库存源表，需要通过 raw 保留、curated view 明确权威来源；db26 的 SQL 能力展示更强但业务叙事偏体育；db28 电商模型更传统但复杂度略低。
- DEV Gold 公开，因此 `LOCAL_HOLDOUT` 只证明本项目运行时密封，不具备官方盲测等级；正式成绩仍依赖 TEST submission。
- 28 库完整语义建模、官方 leaderboard 自动提交和多版本 Falcon 支持延后。

## Open Questions

主 Demo 选型已关闭：采用 db24。当前唯一发布门禁是人工审核已生成的 db24 语义 Candidate；Agent 不得自行批准或发布。

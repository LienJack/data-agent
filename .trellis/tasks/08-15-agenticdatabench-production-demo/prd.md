# AgenticDataBench E-commerce PostgreSQL Production Demo v1

## Goal

将 AgenticDataBench 的 E-commerce 数据域接入现有 Data Agent 平台，构建一个下载项目后可复现、可浏览、可提问、可执行 SQL 与受控 Python 分析脚本、可生成分析产物并可确定性评测的生产级面试 Demo。

该 Demo 的核心价值不是证明模型“会写 SQL”，而是展示一个数据 Agent 如何在 Workspace 权限、数据接入、质量校验、关系建模、语义治理、安全执行、持久运行、评测优化和可观测性约束下完成真实的多源电商分析闭环。

## User Value

- 面试官可在 10–15 分钟内看到从原始多源数据到业务结论、证据和评分的完整链路。
- 项目下载者按标准启动流程即可看到固定 Demo Workspace、数据源、表、语义资产和可运行案例，不需要自行寻找数据集或理解 benchmark 目录结构。
- 开发者可基于真实且固定的数据持续优化 Prompt、语义层、Agent 工作流和工具策略，并用隔离的 Tuning/Holdout 结果验证改进是否有效。
- 系统能够以可审计证据说明 Workspace 隔离、只读执行、版本绑定、失败恢复、成本与时延等生产能力，而不是只展示一次成功回答。

## Background and Confirmed Facts

- 上游仓库固定为 `AgenticDataBench/AgenticDataBench` commit `61bb0d6be3439797d2c75a6ede198b0b296cc226`，数据集固定为 Hugging Face revision `3b0ac3fde63fd615de92bf70c1dd93b73f92d92f`，许可证为 Apache-2.0。
- AgenticDataBench 覆盖 15 个领域；固定公开任务文件包含 246 题，官方另有 98 道未公开测试题。
- E-commerce 有 14 道公开题、12 个逻辑数据源和约 103 个顶层字段；单题平均使用 7.21 个数据源，最多使用 10 个，13/14 题至少使用 4 个数据源。
- 12 个数据源由 Olist 9 个 CSV、Amazon reviews/meta 2 个 JSON 和 eBay laptops 1 个 CSV 组成。Olist 约 126 MB，完整 E-commerce 约 3.10 GB，其中 Amazon metadata 约 2.83 GB。
- `ecommerce_15`、`ecommerce_16` 明确只读取 Amazon 两个 JSON 的前 10,000 条；`ecommerce_35` 只使用 8 个 Olist 数据源。这 3 题可以在固定有界数据上保持官方题面兼容。
- 其余多数 E-commerce 官方题依赖完整 Amazon 数据；在有界切片上运行时不得声明为官方兼容成绩。
- 当前 Compose 已有唯一 `postgres` 服务、`data_agent` 数据库和 `pgdata` 数据卷；本任务不新增 PostgreSQL 服务、数据库或数据卷。
- PostgreSQL 是 Workspace、运行、评测、语义发布和审计事实的权威；Neo4j 仅作为可重建的语义关系投影。
- 现有 Test Center 已定义固定 Dataset、Public/Sealed Case、确定性 Oracle、Attempt 0、最多一次有界 Reflection、Tuning/Holdout 隔离和版本化 ScoreCard 边界。

## Product Scope

### R1. 固定数据来源与可复现快照

- v1 固定导入 12 张原始表：完整 Olist 9 表、完整 eBay 1 表、Amazon reviews 前 10,000 条和 Amazon metadata 前 10,000 条。
- 每个输入文件必须记录上游路径、上游 revision、原始或切片摘要、切片规则、字节数、行数和 SHA-256；不得使用“当前 main”或无版本 URL。
- Amazon 切片按上游文件物理顺序取前 10,000 条，不随机抽样；同一 revision 重建必须得到相同组合摘要。
- 数据来源、许可证和再分发说明写入仓库内 `LEGAL`/数据说明；固定快照不自动更新、不定时同步，也不跟随上游漂移。
- 导入成功后生成不可变 `AgenticDataBenchImportReceipt`。只有 12 张表、逐表校验、组合摘要和 schema 版本全部通过时，Demo 数据集才能标记为 `READY`。
- 固定数据采用压缩 seed bundle 随仓库分发；标准启动不发起第二次联网下载。bundle 必须按可审计 manifest 拆分，避免单文件超过代码托管限制，并在解包前校验路径、字节上限和 SHA-256。

### R2. 复用现有 PostgreSQL 并按 Schema 隔离

- 只复用现有 `postgres/data_agent/pgdata`，不得新增 PostgreSQL 服务、数据库或专用数据卷。
- 原始数据写入 `demo_adb_ecommerce_raw`，生产型维度/事实模型写入 `demo_adb_ecommerce_mart`；控制面、Gold、评分和运行轨迹继续保存在现有权威 schema。
- `raw` 层精确保留 12 张来源表及来源字段；嵌套 Amazon 字段可使用受控 JSONB，但必须提供稳定、可查询的提取规则。
- `mart` 层至少包含 12 张非重复的业务表，覆盖客户、商品、分类、卖家、地域、日期、平台、订单、订单明细、支付、评价、配送和跨平台商品/价格事实；不得通过同义表、空表或复制表虚增数量。
- v1 总计至少 24 张物理 Demo 表，并提供不少于 5 个可审阅业务视图，例如客户 360、卖家表现、配送 SLA、商品满意度和跨平台商品比较。
- 每张 mart 表必须声明 grain、业务主键、来源、更新时间和数据质量规则；可建立的关系使用显式 PK/FK，非确定性跨平台匹配使用带算法版本、置信度和证据的映射表。
- Agent 使用独立只读角色，服务端按当前 Workspace 和 Case 选择允许的 schema/search path；浏览器、Prompt 或模型不得指定任意 schema。

### R3. 导入、建模与数据质量

- 标准迁移流程负责创建 schema、角色、表和固定 seed；导入必须幂等，重复执行不能重复行、重复注册或改变摘要。
- raw 到 mart 的转换必须版本化并产生逐表血缘；失败时不得留下被标记为 `READY` 的部分数据。
- 导入至少验证表数、列数、行数、主键唯一性、外键覆盖率、null 分布、金额/时间范围和确定性内容摘要。
- Olist 核心关系必须验证订单—客户、订单—明细、明细—商品、明细—卖家、订单—支付、订单—评价及地域映射；Amazon reviews—metadata 使用 `asin` 验证。
- Amazon、eBay、Olist 间不存在天然统一商品主键。跨平台实体匹配必须保留标准化字段、候选集合、匹配方法、置信度、接受/拒绝原因和人工审阅状态。
- 导入完成后记录各 schema 的 `pg_total_relation_size`、总数据库增量、导入时长和质量报告，作为 Demo 可复现证据。

### R4. E-commerce 语义层与术语库

- 建立一个独立的 `ecommerce` Semantic Domain，覆盖 12–15 个核心业务实体/维度、至少 30 个可计算指标和至少 40 个中文业务术语。
- 首版维度至少覆盖客户、商品、分类、品牌、卖家、地域、时间、平台、支付方式、订单状态、价格带、满意度和履约状态。
- 首版指标至少覆盖 GMV、订单量、客单价、件单价、客户复购率、支付结构、评价得分、低评分率、配送时长、延迟配送率、卖家履约表现、类目满意度和跨平台价格差。
- 每个指标必须声明名称、中文解释、公式、grain、单位、时间语义、可用维度、来源字段、null/去重策略和版本。
- 术语库必须区分业务术语、字段别名、实体同义词和技术技能；AgenticDataBench 官方 skill descriptions 可以作为能力标签，但不能冒充业务 glossary。
- 语义资产继续走 Candidate → Review → Publish；Agent 可以生成候选和影响分析，但不能自行批准或发布。
- PostgreSQL 保存语义权威，Neo4j 保存可重建关系投影。预计发布后形成约 300–450 个 Node、800–1,300 个 Edge；该范围用于容量和展示设计，不作为可通过堆砌节点达成的验收门槛。

### R5. 案例体系与难度结构

- 建立两个明确分离的套件：`ADB Official-compatible E-commerce` 和 `E-commerce Production Suite`。
- 官方兼容套件只包含 `ecommerce_15`、`ecommerce_16`、`ecommerce_35`，保留原始题面、输出契约和评测规则；任何适配差异必须记录在 compatibility manifest。
- Production Suite 固定包含 24 道项目自建中文题，划分为 8 道 `DEMO`、10 道 `TUNING`、6 道 `LOCAL_HOLDOUT`，运行时不随机重分。
- 难度分布为 6 Easy、10 Medium、8 Hard；8 道 Hard 中至少 6 道涉及 6 张及以上物理表或等价语义关系。
- 题目覆盖多表 Join、CTE/子查询、窗口函数、分位数/留存/漏斗、时间窗口、实体匹配、数据质量诊断、异常解释和跨平台比较。
- 至少 8 题要求 SQL 之外的 Python 脚本完成数据处理、统计或可视化；其中至少 4 题必须执行真实 Python 源码，而不只是声明式分析计划；至少 4 题输出 CSV/JSON 之外的图表或分析报告产物。
- Production Suite 的 Gold、Rubric 和隐藏 Validator 只存在于 Sealed Case/Oracle 边界；不得把项目自建成绩描述为 AgenticDataBench 官方榜单成绩。

### R6. Agent 端到端工作流

- Agent 必须能够完成：理解问题 → 查询已发布语义/术语 → 识别相关表和关系 → 形成分析计划 → 执行只读 SQL → 必要时执行 Python Sandbox 脚本 → 校验结果 → 生成结构化答案和产物。
- 每个 Run 绑定 Dataset Digest、Schema Snapshot、Semantic Release、Policy、Agent/Prompt/Workflow、Provider/Profile/Model、Evaluator、Seed、预算和 Run ID。
- SQL 和 Python Sandbox 工具调用必须形成持久、可重放、已脱敏的公开阶段事件；不得暴露私有推理、完整系统 Prompt、凭证、Gold 或隐藏 Rubric。
- 保留 Attempt 0。只有可归因于 Agent 输出的确定性失败才能触发最多一次 Attempt 1；基础设施、Oracle 或坏题故障不触发 Reflection。
- Worker 复用现有 lease、heartbeat、fence、cancel、resume、checkpoint、effect receipt 和 dead-letter 机制；不得引入仅供 Demo 使用的内存执行旁路。

### R7. 安全执行与 Workspace 隔离

- Demo datasource 通过现有 Workspace/RBAC/SecretRef 机制注册；完成既有本地管理员 bootstrap 后幂等挂接到指定 Demo Workspace，不在迁移中伪造真实用户。
- 普通 Demo 用户只读访问 `demo_adb_ecommerce_raw`、`demo_adb_ecommerce_mart` 和明确允许的视图，不能枚举或访问 `platform`、`app_data_agent`、`auth`、`storage` 等控制面 schema。
- SQL 只允许单条只读语句，并限制 statement timeout、lock timeout、最大返回行数、返回字节数和执行预算；拒绝 DDL、DML、多语句、扩展安装、文件访问和跨 schema 越权。
- 新增真正可执行模型生成 Python 源码的 CPython 3.12 Sandbox。任意脚本不得直接运行在 Web、Worker、迁移容器、现有 SQL Sandbox 进程或宿主进程中，只能进入专用隔离执行环境。
- Sandbox 默认无网络、根文件系统只读、无宿主项目/数据目录、数据库连接和凭证挂载；仅允许专用 IPC socket 目录。每次调用使用一次性 Python 子进程，只接收当前 Run 授权的内容寻址输入，进程退出后销毁临时目录和全部运行状态。
- 脚本请求必须绑定源码摘要、输入 Artifact 摘要、入口点、输出契约、Python Runtime Digest、依赖锁摘要和版本化 Policy。v1 不允许任意 `pip`/Conda 包或动态安装，只暴露版本锁定的 `pandas`、`numpy`、`scipy`、`matplotlib`、`pyarrow` 与只读 Sandbox SDK；`scikit-learn`、`statsmodels` 等依赖按真实题目需求另行评审。
- 输入只允许 Arrow/CSV/JSON，禁止 `pickle`、`marshal`、任意对象反序列化和可执行 Notebook；输出只允许规范化表格/JSON、净化 Markdown、Vega-Lite 规范和 PNG。
- Sandbox 同时限制 wall/CPU 时间、进程地址空间、容器内存、PID、打开文件数、输入/输出字节、stdout/stderr 和产物类型；超时、超限、取消或进程异常时终止整个进程组，丢弃未提交的部分产物并返回稳定失败码。
- AST/import 校验只是纵深防御，不能被声明为恶意代码安全边界；真正的权限边界必须由独立 OS 身份、容器网络/挂载/能力限制、seccomp/AppArmor、cgroup/rlimit 和一次性状态共同提供。
- 两个 Workspace 并发运行时，数据源权限、Run、Artifact、ScoreCard、成本和轨迹必须保持隔离；客户端自报 Workspace、Role 或 schema 不能成为权限依据。

### R8. 确定性评测与优化闭环

- CSV/JSON 产物按列、类型、顺序/无序集合、null、数值容差和内容摘要确定性评分；图表按结构化绘图规范和必要的视觉诊断评分；报告按可验证 Claim/Evidence 引用和规则评分。
- 区分 `AGENT_FAILURE`、`QUERY_REJECTED`、`QUERY_TIMEOUT`、`EXECUTION_ERROR`、`PYTHON_POLICY_REJECTED`、`PYTHON_TIMEOUT`、`PYTHON_RESOURCE_LIMIT`、`PYTHON_ERROR`、`ARTIFACT_MISMATCH`、`ORACLE_FAILURE`、`BAD_CASE` 和 `INFRASTRUCTURE_FAILURE`。
- DEMO 用于现场展示，TUNING 用于 Prompt/语义/工作流优化，LOCAL_HOLDOUT 只用于冻结版本的发布判断；Holdout Gold、Rubric 和隐藏 Validator 不得进入优化上下文。
- 只有至少 5 个有效 LOCAL_HOLDOUT case 且 `post_reflection_pass_rate >= 0.80` 时，Production Suite 才能标记 `GO`；否则为 `HOLD`。
- ScoreCard 分别报告 First-pass、Post-reflection、Recovery、Regression、有效样本数、成本、时延、资源使用和失败分类，不用单个平均分掩盖错误类型。

### R9. 面试 Demo 工作区与产品体验

- 本地标准启动和 bootstrap 完成后，用户能在现有 Workspace 中看到 `AgenticDataBench E-commerce Demo v1` 数据源和 Test Center 套件。
- 数据浏览器展示 raw/mart schema、至少 24 张物理表、字段、样例、行数、关系、质量状态和来源回执。
- 语义 Explorer 展示实体、维度、指标、术语、Join、血缘和影响关系，并明确 PostgreSQL Authority/Neo4j Projection 状态。
- 提供至少 3 条引导式面试路径：客户与复购分析、卖家履约与满意度分析、跨平台商品/价格匹配分析。
- 单题页面展示题目、难度、所需能力、运行阶段、表/指标选择、SQL/Python Sandbox 调用、查询摘要、脚本源码、受限日志、产物、证据、成本、时延和 Oracle 结果。
- Production Readiness 面板展示 Dataset/Schema/Semantic/Model/Evaluator 版本、Import Receipt、Workspace 权限、资源门禁、失败恢复和最近一次 Holdout Gate，且不泄漏密封内容。

### R10. 可运维性、回滚与文档

- 数据导入、Workspace 注册、语义候选生成、发布和套件安装均为幂等操作，并产生结构化回执或审计记录。
- 安全重建只能删除明确列举的 `demo_adb_ecommerce_raw`、`demo_adb_ecommerce_mart` 及其受限角色/注册记录；不得删除 `data_agent` 数据库、`pgdata`、其他 schema 或历史 Run/ScoreCard。
- 回滚顺序为停用套件和 datasource → 阻止新 Run → 等待/取消活动 Run → 删除 Demo 投影/业务 schema → 保留来源、运行和评分审计。
- 提供中文 runbook，覆盖数据来源、标准启动、导入验证、Workspace 挂接、语义发布、单题/批量运行、Tuning/Holdout、故障诊断和安全重建。

## Out of Scope

- 导入完整约 3.10 GB E-commerce 数据或为除 3 道兼容题外的官方题声明兼容成绩。
- 接入 AgenticDataBench 其他 14 个领域、全部 246 道公开题或 98 道私有题。
- AgenticDataBench 自动更新、定时同步、多版本并存或上游 schema 漂移迁移。
- 新增 PostgreSQL 服务、数据库、数据卷或以 Neo4j 取代 PostgreSQL 权威。
- 自动 Prompt 搜索、无限 Reflection、模型自行批准语义资产或修改 Gold/Oracle。
- 将项目自建 Production Suite 的结果声明为 AgenticDataBench 官方 leaderboard 结果。
- 提供持久 Python REPL/Notebook、跨 Run 会话、运行时联网或任意 `pip`/Conda/系统包安装。
- 在 v1 建设通用数据湖、通用 ETL 编排平台或支持任意第三方 benchmark 的无边界框架。

## Acceptance Criteria

- [ ] “接入完成”的首要验收是闭环而非题面预览：从 Test Center 选择公开题目后，certified model/Data Agent 在不知道 Gold/Rubric/隐藏 Validator 的情况下生成候选答案，候选答案在真实 PostgreSQL（Python 题另经真实 Python Sandbox）执行，再由 Sealed Oracle 确定性判分并按同一 `batch_run_id` 回读 ScoreCard；Fixture Agent、提交答案、预置 SQL 或 Gold 回放均不能作为验收证据。
- [ ] 固定来源 commit、数据 revision、Apache-2.0 许可证和 12 个输入的摘要/切片规则可从 Import Receipt 审计。
- [ ] Compose 仍只使用现有 PostgreSQL；没有新增 PostgreSQL database/volume，Demo 业务数据只存在于两个明确的 `demo_adb_ecommerce_*` schema。
- [ ] raw 层精确包含 12 张来源表；mart 层至少包含 12 张非重复维度/事实表；业务视图不少于 5 个，总物理 Demo 表不少于 24 张。
- [ ] 逐表表数、列数、行数、主键、外键、null、范围和内容摘要通过，导入失败不会产生 `READY`。
- [ ] 干净 clone 在断开外网的条件下完成标准首次迁移和管理员 bootstrap 后，可以直接看到 Demo Workspace/data source；重复执行不会重复数据或注册记录。
- [ ] Agent 只读角色无法访问控制面、其他 Workspace、未授权 schema、DDL/DML、多语句、宿主文件系统和网络；Python Sandbox 不持有 PostgreSQL 或平台凭证。
- [ ] `ecommerce_15`、`ecommerce_16`、`ecommerce_35` 能按 compatibility manifest 运行并生成确定性结果，UI 不把其他有界切片题标为官方兼容。
- [ ] Production Suite 精确包含 8 DEMO、10 TUNING、6 LOCAL_HOLDOUT，共 24 题；难度为 6 Easy、10 Medium、8 Hard。
- [ ] 至少 6 道 Hard 题涉及 6 张及以上表/关系；至少 8 题使用 SQL+Python，其中至少 4 题执行真实 Python 源码；至少 4 题生成图表或报告产物。
- [ ] 发布语义层覆盖至少 12 个业务维度/实体、30 个指标、40 个中文术语，所有指标都有公式、grain、单位、时间语义和来源血缘。
- [ ] Semantic Release 只能经人工审核发布；Neo4j 停止时 PostgreSQL 语义权威、治理和查询 fallback 仍可用。
- [ ] 至少一个 Hard Demo 在真实 PostgreSQL、真实 Worker、真实 Python Sandbox 和 certified model/Data Agent 上完成端到端运行并产生可回读 Artifact、Event、ScoreCard 和成本记录；必须保存真实 Agent 输出摘要与 Oracle Receipt，不能以“工具执行成功”代替答对和评分。
- [ ] Python Sandbox 通过成功执行、正常取消、wall/CPU 超时、地址空间/容器内存/PID/文件/输出超限和进程崩溃测试；任何非成功终止均不提交部分产物。
- [ ] 恶意脚本 fixtures 覆盖网络/socket、宿主路径、环境变量、子进程、动态 import/代码加载、原生动态库、路径逃逸、IPC 探测、`pickle`/`marshal` 和跨 Run 状态残留，均被能力边界或 Policy 稳定拒绝。
- [ ] 相同源码、输入 Artifact、Python Runtime Digest、依赖锁和 Policy 重放得到相同结构化结果摘要；`PythonSandboxReceipt` 可审计镜像/Python/依赖版本、资源预算与实测、退出分类和输入输出摘要。
- [ ] Attempt 0 永久保留；Agent 确定性失败最多触发一次裁剪 Reflection；Oracle、坏题和基础设施失败不触发。
- [ ] Gold、Rubric、隐藏 Validator、凭证、完整 Prompt 和私有推理不会出现在 Agent 输入、公共 API、SSE、日志或浏览器状态。
- [ ] 两个 Workspace 并发运行及伪造 Workspace/schema 请求通过隔离测试；取消、Worker 崩溃、Lease 过期、Resume 和重复 Effect 通过恢复/幂等测试。
- [ ] Test Center 分开展示官方兼容套件与项目 Production Suite，并能回读 First-pass、Post-reflection、成本、时延和失败分类。
- [ ] 浏览器验证完整路径：进入 Demo Workspace → 浏览 24+ 表与语义图 → 选择复杂题 → 查看 SQL/Python Sandbox 轨迹 → 查看源码/产物/证据 → 查看评分和生产就绪信息。
- [ ] 中文 runbook 能在干净环境复现安装、验证、运行、评分和只删除 Demo schema 的安全回滚。

## Key Decisions

- 主 Demo 采用 AgenticDataBench E-commerce，不再以 Falcon 作为本阶段主数据域；Falcon 若保留，只作为后续可选 Text2SQL 对照，不属于本任务。
- 使用完整 Olist、完整 eBay 和两个确定性 10,000 条 Amazon slice，形成 12 张 raw 表；不内置完整 3.10 GB 数据。
- 压缩 seed bundle 随仓库分发，标准启动无需二次联网下载；以仓库体积换取面试演示的确定性和离线可复现性。
- 复用现有 `postgres/data_agent/pgdata`，使用 `demo_adb_ecommerce_raw` 与 `demo_adb_ecommerce_mart` 做 schema 隔离。
- 用真实 raw → mart 建模达到 24+ 物理表，不通过重复表虚增复杂度。
- 官方兼容 3 题与项目自建 24 题严格分开；项目成绩不冒充官方 leaderboard 成绩。
- 语义层、Test Center、Workspace RBAC、持久 Run 和确定性 Oracle 全部复用现有平台权威，不建设 Demo 专用旁路。
- Node.js 继续承担 Web、Worker、Agent Runtime 与调度；数据分析统一采用隔离 CPython 3.12 Sandbox，通过固定 Python SDK 读取 SQL Artifact、计算统计结果并输出表格、Vega-Lite 图表规范或报告。
- Python Sandbox 是独立执行服务而不是新的数据库服务；它复用现有 Run/Worker 调度、Artifact 和 Effect Receipt，不持有数据库凭证，也不直接查询 PostgreSQL。

## Risks and Deferred Items

- 固定 seed bundle 会增加仓库体积、首次迁移时间和 CI 负担；通过有界 Amazon slice、压缩分片、摘要复用、CI 缓存和导入计时证据控制成本，不以首次启动联网下载规避该问题。
- Amazon/eBay/Olist 跨平台商品没有共同主键，实体匹配会产生不确定性；必须用版本化规则、置信度和人工审阅管理，不能伪造精确 FK。
- PostgreSQL 化和 mart 建模会改变官方原始文件执行方式；只有通过 compatibility manifest 的 3 题可以使用“官方兼容”标签。
- 图表/报告 Oracle 比表格结果更难完全确定；正式 PASS 以结构化规则为主，模型 Judge 只提供诊断，不能覆盖确定性 Oracle。
- 任意 Python 属于恶意代码风险，AST/import 白名单无法单独构成安全边界；必须以隔离容器、独立 OS 身份、无网络/无凭证和硬资源限制为主边界，无法证明硬隔离指标时 Production Readiness 必须为 `HOLD`。
- Python 科学计算依赖会增加镜像、冷启动、内存和漏洞治理成本；v1 通过 slim 多阶段镜像、固定五个核心库、一次性进程、单执行并发和有界输入输出控制，后续扩包必须重新走依赖与安全评审。
- 24 题、完整语义层和面试 UI 是复杂任务；技术设计与实施拆分将在 PRD 最终批准后单独形成 `design.md` 和 `implement.md`。

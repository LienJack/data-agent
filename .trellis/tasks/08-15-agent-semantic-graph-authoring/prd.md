# Agent 原生 Node/Edge 语义图设计与编辑 PRD

## 1. 文档状态

- 状态：`in_progress`
- 优先级：`P1`
- 产品范围：Semantic Layer Studio / Explorer / Agent Authoring / Candidate Governance
- 本轮交付：Graph v2、Agent authoring、统一读取模型、Semantic Studio、迁移治理与 Falcon 后置验收
- 目标用户：语义建模人员、数据分析师、数据治理审核人

## 2. Goal

把当前以“对象内嵌表、列、公式和其他对象引用”为中心的语义层，升级为以稳定
`Node` 和显式 `Edge` 为中心的语义图。业务主体、维度、指标、公式和物理表分别保持
独立身份，彼此通过受类型约束、可审计、可版本化的关系连接。

用户不直接编辑 Node/Edge JSON 或数据库字段。所有语义新增、修改、退役和关系调整均由
Agent 根据自然语言意图执行到候选图；前端在 Agent 执行过程中实时展示候选 Node/Edge
变化，确定性校验通过后再由人类审核和发布。

最终用户价值是：

1. 新增维度、指标、公式或关系只增加 Node/Edge，不再要求给语义数据库加业务列。
2. 同一个语义事实只维护一次，可同时用于列表、局部关系图、全图、影响分析和查询编译。
3. 用户可以用自然语言表达“新增这个指标”或“修改这条公式”，由 Agent 完成结构化建模。
4. Agent 可以高效维护候选语义，但不能绕过校验、审核和发布 Authority。

本需求的最终完成标准还包括后置 Falcon 门禁：语义层全部完成后，必须继续执行
`08-15-falcon-demo-eval`，跑通项目内 Falcon 固定快照的 28 库导入、db24 主 Demo、db14 smoke、
DEV 309 题、TEST 191 题提交产物以及相关真实 Worker、PostgreSQL、Oracle 和浏览器验证。Falcon
未全绿时，本需求不得宣告完成。

## 3. Background and Confirmed Facts

### 3.1 当前问题

- 当前 `SemanticSourceBundle@1` 的 Metric 同时内嵌 `table_id`、`column_id`、`formula`、
  `grain`、`time_column_id` 和依赖列；Dimension 同时内嵌 `table_id`、`column_id`、
  `parent_dimension_id`。这让一个语义对象承担了自身定义、物理绑定和关系表达三种职责
  （`packages/contracts/src/artifacts/semantic-governance.ts:91-124`）。
- 当前 Business Entity 把指向其他实体的 `business_relationship_types` 放在自身 payload 中，
  关系不是独立的发布对象（`packages/contracts/src/artifacts/semantic-governance.ts:193-208`）。
- 当前 Explorer 只有 `business_entity / metric / dimension / relationship / datasource` 等有限
  object kind；Formula 和 Physical Table/Column 没有完整的一等图身份。Metric/Dimension 的
  Explorer payload 仍直接包含表、列、公式和父维度引用
  （`packages/contracts/src/artifacts/semantic-explorer.ts:46-62,130-166`）。
- 当前 Explorer Builder 是从这些内嵌字段派生 `metric_dependency`、
  `dimension_hierarchy`、`business_relationship` 和 `physical_binding` 边；因此图是派生视图，
  不是关系的权威编辑模型（`packages/semantic/src/explorer/builder.ts:747-866`）。
- 当前 M3 Agent 面向物理 schema 一次性输出 JSON，`tool_allowlist=[]` 且
  `max_tool_calls=0`，不具备读取现有图后连续创建、修改 Node/Edge 的工具循环
  （`packages/semantic/src/candidate-generation/agent.ts:24-34,143-150`）。
- 当前前端把候选 operation 序列化到 textarea，并在提交时 `JSON.parse` 用户修改后的内容，
  与“语义修改由 Agent 执行”的产品方向冲突
  （`apps/web/src/components/semantic/physical-schema-browser.tsx:168-175,194-218,404-416`）。

### 3.2 已确认的研究和治理边界

- Ontology 负责稳定对象身份、关系含义和约束；数据库 schema、分析语义和物理绑定不能
  被压成同一个对象属性集合。
- Business Ontology、Analytical Semantics、Physical Binding 和 Runtime Authorization
  可以在同一张图中关联展示，但不能因为图连通而共享 Authority。
- 物理外键只能证明物理关系，不能自动升级为业务关系或安全分析 Join。
- Agent 维护候选语义，人类及确定性 Gate 维护发布 Authority。未发布候选不得进入活动
  Query Grounding。
- PostgreSQL 保持发布语义和治理状态的唯一写权威；Neo4j 或其他图引擎只能作为可重建的
  关系索引和可视化投影。
- GraphRAG 官方查询模型将 Local Search 用于围绕具体实体及其关系构造上下文，将 Global
  Search 建立在分层 community reports 之上。本产品只借用这种“局部实体邻域 / 全局分层
  社区”的信息架构，不照搬其 LLM 抽取图作为发布真相
  （[GraphRAG Query Overview](https://github.com/microsoft/graphrag/blob/main/docs/query/overview.md)、
  [GraphRAG Global Search](https://github.com/microsoft/graphrag/blob/main/docs/query/global_search.md)）。

## 4. Product Principles

### P1 — Node 是对象，Edge 是关系

Node 只保存该对象自身的固有属性；任何跨对象身份、物理绑定、依赖、层级和归属都必须
通过 Edge 表达。不能为了展示方便，再把 Edge 复制回 Node 的业务字段。

### P2 — Agent 是唯一语义创作入口

产品可以显示“新增”“编辑”“连接”“退役”等入口，但这些入口只能打开带上下文的 Agent
输入框。前端表单、图拖拽和 JSON 编辑器都不能直接写语义 Node/Edge。

### P3 — Candidate first, human publish

Agent 的每次工具调用只改变候选图。候选图可以即时显示，但活动图在人工审核并通过
确定性发布 Gate 前保持不变。

### P4 — One graph, multiple views

Node List、节点详情、局部图和全图必须读取同一发布图与同一候选 overlay，不能各自派生
不一致的对象或关系解释。

### P5 — 可观察，不暴露私有推理

界面展示用户输入、Agent 工具阶段、Node/Edge patch、证据、校验结果和失败原因；不展示
模型私有思维链、系统提示词、凭据或未经授权的业务样本行。

## 5. Semantic Graph Product Model

### 5.1 一级 Node 类型

| Node 类型 | 产品含义 | 允许的固有属性示例 | 不得内嵌的内容 |
| --- | --- | --- | --- |
| `BusinessSubject` 业务主体 | 业务世界中的稳定对象或主题，如客户、订单、订单明细、退款 | 稳定 ID、名称、定义、别名、领域、Owner、生命周期 | 指标数组、维度数组、表名、关系目标 ID |
| `Dimension` 维度 | 用于分组、筛选和切片的分析概念，如地区、日期、商品 | 稳定 ID、名称、定义、数据类型、敏感级别、生命周期 | 表列、父维度、所属主体、可用指标 |
| `Metric` 指标 | 可被业务解释和查询引用的度量，如成交商品数、商品销售额 | 稳定 ID、名称、定义、单位、可加性、空值与 fanout 策略、生命周期 | 公式正文、物理表列、依赖指标、所属主体 |
| `Formula` 公式 | 独立、可版本化、可验证的计算定义 | 稳定 ID、规范化表达式/AST、返回类型、方言、生命周期 | “属于哪个指标”、依赖列表、物理表字段列表 |
| `PhysicalTable` 物理表 | 某个 datasource/schema snapshot 中可寻址的物理关系 | 稳定 ID、datasource、schema、table、snapshot identity、生命周期 | 业务主体含义、指标定义、业务关系 |

为了避免把 `column_id` 继续嵌入指标和维度，物理列必须具有稳定、可被 Edge 引用的
`PhysicalColumn` 支撑身份。它在产品导航中从属于 PhysicalTable，不作为第六个一级业务
分类；当某列参与公式、维度绑定、Join 或证据链时，可在图中按需展开为节点。

`GlossaryTerm`（术语）同样是支撑 Node，而不是把定义文本复制进每一种业务 Node。它保存规范名、
定义、别名、语言、适用域和来源；通过 `DENOTES`、`BROADER_THAN`、`RELATED_TERM` 等 Edge 连接业务
主体、维度、指标、公式与其他术语。首批专业术语至少覆盖业务主体、粒度、可加性、基数、扇出、
行保留、物理绑定、分析 Join、候选图和活动发布，并明确物理外键、业务关系、分析 Join 三者不等价。

### 5.2 Edge 的统一合同

每条 Edge 至少具有稳定 ID、关系类型、源 Node、目标 Node、规范方向、生命周期、版本、
来源/证据和可选约束。关系类型注册表必须声明允许的 source/target 类型；非法端点组合
必须被确定性校验拒绝。

新增一种业务关系或给业务主体增加一个维度，只新增 Edge 类型或 Edge 实例，不增加
PostgreSQL 业务列。

### 5.3 MVP Edge 家族

| Edge 家族 | 典型关系 | 示例 | 必须保持的边界 |
| --- | --- | --- | --- |
| 业务关系 | `RELATES_TO` 及领域命名关系 | 客户 —下单→ 订单；订单 —包含→ 订单明细 | 不能由 FK 自动发布；必须有业务语义、方向和责任人 |
| 分析归属 | `HAS_DIMENSION`、`HAS_METRIC` | 订单明细 —拥有维度→ 商品；订单明细 —拥有指标→ 成交商品数 | 归属在 Edge，不回填 Node 数组 |
| 公式与依赖 | `DEFINED_BY`、`DEPENDS_ON`、`AT_GRAIN` | 成交商品数 —定义于→ 去重计数公式 | 公式本身是 Node；依赖不得保存为字符串列表 |
| 维度层级 | `ROLLS_UP_TO` | 城市 —汇总到→ 地区 | 必须检查方向、环和类型兼容性 |
| 物理结构 | `CONTAINS_COLUMN`、`FOREIGN_KEY_TO` | 订单明细表 —包含→ product_id | 只表达 schema 事实，不冒充业务语义 |
| 物理绑定 | `BOUND_TO`、`REFERENCES` | 商品维度 —绑定到→ product_id；公式 —引用→ product_id | 绑定必须固定 datasource/schema snapshot identity |
| 主体物理映射 | `REPRESENTED_BY`、`IDENTIFIED_BY` | 订单明细 —承载于→ fact_order_item；订单 —由→ order_id 标识 | 表级承载和字段级身份必须分开；不能只画表而省略列 |
| 公式上下文 | `AT_GRAIN`、`USES_DIMENSION` | 去重公式 —计算于→ 订单明细；公式 —使用维度→ 商品 | 主体表示计算粒度，维度边必须声明 GROUP/FILTER/TIME 等角色 |
| 分析 Join | `JOINABLE_VIA` | 订单明细表 —可分析连接→ 商品维表 | 需要 cardinality、row preservation 和 fanout proof |
| 证据与溯源 | `SUPPORTED_BY`、`DERIVED_FROM` | 公式 —派生自→ 基础指标；维度 —受支持于→ 物理列 | 只连接 Node；Edge 自身证据使用 evidence ref，证据存在不等于自动批准 |
| 术语 | `DENOTES`、`BROADER_THAN`、`RELATED_TERM` | “扇出” —指称→ fanout policy；“成交额” —指称→ 商品销售额 | 术语解释概念，不替代业务/分析/物理关系或查询编译合同 |

关系注册表首版名称可在技术设计中统一，但上述家族、方向和不可混用边界属于产品硬约束。

## 6. Core User Journeys

### 6.1 新增指标和公式

用户在任一语义视图的 Agent 输入框中输入：

> 新增“成交商品数”，按订单明细的 `product_id` 去重计算，单位是件。

系统必须：

1. 读取当前活动 release、相关业务主体、物理表列和已有同名/近似节点。
2. 识别“新增指标 + 新增公式 + 建立归属、定义和物理引用关系”的组合意图。
3. 在候选图中创建 Metric、Formula 及必要 Edge；若订单明细或物理列已存在则复用稳定身份。
4. 保存用户原始输入作为不可变 authoring evidence，并把公式规范化为引用稳定 ID 的 AST。
5. 实时在图上显示新增节点和边，随后显示 grain、unit、dependency、cycle、fanout 等校验结果。
6. 生成可逐项审阅的 Graph Diff；人工发布前，活动图和 Query Grounding 不发生变化。

Metric 卡片最终只展示自身定义及“关联关系摘要”；公式、订单明细表和 `product_id` 均通过
可点击 Edge 查看，不再作为 Metric 的内嵌表单字段。

### 6.2 修改公式

用户选中“成交商品数”或其 Formula 后输入：

> 把成交商品数改成只统计已支付订单，仍按商品去重。

系统必须读取当前公式、依赖和影响范围，创建 Formula/Edge 的候选修改，重新运行确定性
校验，并在原图上用候选 overlay 展示修改前后差异。若“已支付”的状态值、时间口径或
适用业务主体不唯一，Agent 必须暂停并只询问最关键的澄清问题，不能自行猜测。

### 6.3 新增维度或关系

用户输入“给订单明细增加商品维度，并绑定商品 ID”时，Agent 创建或复用 Dimension，新增
`HAS_DIMENSION` 和 `BOUND_TO` Edge。整个过程不得修改语义存储的 SQL 表结构，也不得给
BusinessSubject/Metric 表增加 `product_dimension_id` 一类业务列。

### 6.4 审核与发布

审核人查看 Added/Modified/Retired Node/Edge、证据、Agent 操作、校验结果和影响分析，按
现有治理链接受或拒绝候选并发布。审核动作不是语义创作；审核人若需要修改内容，必须用
Agent 输入修改意图，由 Agent 生成新的候选 revision。

## 7. Requirements

### R1 — Node/Edge authority model

- 发布语义的基本单位必须是一等 Node 和一等 Edge。
- Node payload 只允许固有属性；所有跨 Node 引用必须由 Edge 表达。
- Node/Edge 都必须支持稳定身份、版本、生命周期、来源和差异比较。
- 新增 Node 类型、Edge 类型或 Edge 实例不得要求为每种业务概念增加数据库列。
- 同一 release 内不得存在悬空 Edge、重复稳定身份或违反 source/target 类型约束的 Edge。

### R2 — Separation of semantic planes

- Business、Analytical、Physical、Evidence 四类关系必须在类型和界面上可区分。
- `FOREIGN_KEY_TO`、业务关系和 `JOINABLE_VIA` 必须是不同 Edge，不能互相推导为已发布事实。
- 业务主体、维度、指标、公式和物理表可以在一张关系图中连通，但各自的 Authority、验证和
  生命周期边界保持独立。
- Formula 作为独立 Node；Metric 与 Formula 通过 `DEFINED_BY` 关系关联。
- 业务主体必须可通过 `HAS_DIMENSION`、领域业务关系、`REPRESENTED_BY` 和 `IDENTIFIED_BY` 分别连接
  维度、其他主体、物理表和身份字段；不得用一条无属性的泛化边替代四种含义。
- Formula 必须通过 `AT_GRAIN` 连接业务主体、通过 `USES_DIMENSION` 连接参与分组/筛选/时间语义的
  Dimension，并通过 `REFERENCES` 连接实际物理字段；Metric 仍通过 `DEFINED_BY` 指向 Formula。
- 物理表必须展开 `CONTAINS_COLUMN`，列间 `FOREIGN_KEY_TO` 与人工验证的 `JOINABLE_VIA` 同时可见；
  只有 FK 没有业务/分析关系，或只有语义边没有物理证据，均视为关系覆盖不完整。

### R2.1 — Ontology relation completeness

- 关系不是按页面示例手工凑数，而是由 competency questions 驱动的类型注册表、端点约束、方向、
  基数、属性 schema、证据和 Authority 共同定义。
- 发布候选必须生成关系覆盖回执，至少检查每个活动业务主体的主体关系、维度、指标、物理承载与
  身份字段，每个 Formula 的指标定义、计算主体、维度上下文、物理引用和依赖，以及每张参与分析
  的表的列、FK 与 Join Proof。
- 不适用的关系必须有显式 `NOT_APPLICABLE` 原因；缺失且没有豁免的关系阻止发布，不能靠前端隐藏。
- GlossaryTerm 的定义、别名和概念映射进入同一 candidate/review/release 生命周期；新增或编辑术语
  也只能由 Agent 生成候选操作。

### R3 — Agent-only semantic authoring

- 业务、分析、公式和语义绑定层 Node/Edge 的 create、update、retire、link、unlink、rebind 均
  只能由 Agent 候选工具执行。Schema ingestion 对 system-managed PhysicalTable/PhysicalColumn 和
  物理结构 Edge 的确定性同步不属于语义创作，也不能被前端或 Agent 直接编辑。
- Node/Edge 详情页的“编辑”只负责把当前对象、版本和选区传入 Agent Composer。
- 移除候选 JSON textarea 和任何直接提交任意 JSON Patch 的产品路径。
- 图上的拖拽、连线、删除手势只表达上下文或生成 Agent 意图草稿，不能直接持久化语义。
- 语义删除首版采用可审计的 retire/deprecate；Agent 不执行不可恢复的硬删除。

### R4 — Persistent Agent Composer

- Node List、局部图和全图都提供同一个持久化 Agent 输入框。
- Composer 自动携带 workspace、semantic domain、活动 release、当前选中 Node/Edge 和视图
  范围；用户可以显式移除不希望提交的上下文。
- 支持自然语言、公式表达式和受支持语义 DSL 输入，但不得直接执行用户输入的任意
  SQL/Python。
- Agent 必须能识别新增、修改、退役、连接、断开、重新绑定和影响分析意图。
- 多轮澄清后必须从同一 authoring run/checkpoint 继续，不能丢失已完成的候选操作。

### R5 — Agent read and candidate mutation capability

- Agent 必须能够读取 Node/Edge 类型注册表、搜索 Node、读取详情、读取局部图、读取物理
  schema/binding、读取 Formula 依赖和当前 candidate diff。
- PhysicalTable、PhysicalColumn、`CONTAINS_COLUMN` 和 `FOREIGN_KEY_TO` 由受信 schema snapshot
  确定性同步，Agent 只读这些物理事实并创建语义绑定；不能伪造、改名或退役物理 catalog identity。
- Agent 必须具备原子、可组合的 candidate-only create/read/update/retire/link/unlink 能力；
  每次工具调用都有 typed input/output、scope、idempotency 和稳定失败终态。
- 在创建对象前必须搜索并复用可证明相同的稳定身份；名称相似只能触发候选或澄清，不能
  自动合并。
- Agent 必须显式发出 authoring run 完成信号；系统不得用“模型停止输出”推断任务完成。
- UI 可完成的所有候选语义创作结果必须有等价 Agent 工具，且所有 Agent 工具结果必须能
  在 UI 中观察和继续处理。

### R6 — Formula intent, normalization and validation

- 保留用户原始公式输入、选区、活动 release 和工具输入输出，形成不可变 authoring evidence。
- Agent 把自然语言或表达式转换为规范化 Formula AST；AST 通过稳定 Node ID/Edge 引用依赖，
  不保存易漂移的显示名称或裸表列字符串。
- 确定性 Gate 至少校验语法、返回类型、grain、unit、time、filter、null policy、dependency、
  cycle、fanout 和授权边界。
- 无法唯一确定业务口径、物理列、Join 路径或身份时，Agent 必须澄清或以失败终态结束，
  不能写入活动语义。
- Formula 变更必须产生依赖和影响分析，列出受影响的 Metric、下游 Formula、Query Grounding
  和物理绑定。

### R7 — Live candidate graph feedback

- Authoring run 接受后，界面必须立即出现可审计的执行阶段。
- 每次成功 Node/Edge mutation 都以可重放 graph patch 更新候选 overlay，不等整个 Agent
  回答结束后才一次性刷新。
- 候选视觉状态统一为：Added 绿色、Modified 琥珀色、Retired 红色虚线、未变化 Published
  灰色；颜色同时提供文字/图标冗余，不能是唯一辨识方式。
- 用户可以查看每一步工具名称、目标对象、执行状态、公开结果摘要、证据和校验错误，但
  看不到私有思维链。
- 页面刷新或短暂断线后，用户可以基于 run/cursor 恢复相同事件和候选图，不产生重复操作。

### R8 — Node List as default entry

- 进入 Semantic Layer 默认展示 Node List，而不是直接渲染全图。
- 列表支持按 Node 类型、领域、Owner、生命周期、发布/候选状态筛选，支持搜索、排序和
  虚拟滚动。
- 每一行只展示 Node 固有摘要与关系数量；表、公式、依赖和层级通过关系入口查看。
- 点击 Node 进入详情和局部关系图；当前选择在列表、局部图和全图之间保持一致。
- 列表和详情均提供“让 Agent 修改”入口，不提供直接 JSON/字段写入。

### R9 — Local relationship graph

- 点击 Node 默认展示以它为中心的一跳关系；用户可以按 Edge 家族或指定方向展开到二跳。
- 节点按类型具有一致视觉编码，边显示关系名称、方向和候选状态。
- 点击 Node/Edge 打开固有属性、关系属性、来源、版本、证据和候选 diff。
- 局部图默认最多展示 250 个 Node、500 条 Edge；超过预算时必须明确显示截断、聚合结果
  和继续展开入口，不能静默丢边。
- 搜索、筛选、缩放和选择不得改变语义状态；只有 Agent 工具可以产生候选变更。

### R10 — Full graph with GraphRAG-style hierarchy

- 全图提供独立入口，用于观察整个活动 release 及可选 candidate overlay。
- 参考 GraphRAG 的 Local/Global 分工：局部图用于围绕一个 Node 浏览邻域；全图先展示领域或
  community 层级，再随 semantic zoom 展开到具体 Node/Edge。
- 首屏优先加载 community/cluster 摘要、节点/边数量和关键枢纽；不一次性把所有原始节点
  塞进 DOM。
- 支持类型/领域/Owner/状态/关系家族筛选、搜索定位、最短关联路径、集群展开/收起、
  稳定布局和回到当前选择。
- 同一缩放层级最多渲染 500 个可视 Node/Cluster glyph；更大图必须聚合或分层加载，并保留
  被聚合对象数量和筛选结果的可解释性。
- community 只用于导航、布局和检索，不自动产生发布业务含义；LLM/GraphRAG 抽取出的节点
  和边仍只能进入 Candidate Plane。
- 局部图和全图统一使用 AntV G6 v5 渲染；使用其 Canvas/WebGL、聚类布局、缩放拖拽、选择、
  Minimap 和大图优化能力实现 GraphRAG 风格导航，但拖拽与连线只改变视图，不直接写语义。

### R11 — Review, validation and publication governance

- 每个 authoring run 固定 base release、scope、principal、model/prompt/tool/policy identity
  和 idempotency key。
- Agent 只能调用 public read 与 candidate mutation/validation 工具；不能调用 approve、
  publish、rollback、authorization、secret、直接 PostgreSQL/Neo4j 写入工具。
- 候选必须通过结构完整性、Edge 类型、Formula、环、Join/fanout、权限和 stale-base Gate。
- base release 在运行或审核期间变化时，候选必须进入 stale/rebase 流程，旧批准不得静默复用。
- 只有人工审批并通过现有 PostgreSQL Authority 发布的 release 才能进入活动 Explorer 和
  Query Grounding；候选 overlay 必须始终明确标注“未发布”。

### R12 — Compatibility and migration behavior

- 现有已发布 release 和历史 Query Run 必须保持可读取、可重放；不得就地改写已发布 bytes。
- 当前内嵌 `table_id / column_id / formula / parent_dimension_id /
  business_relationship_types` 必须可以确定性转换为 Graph v2 Node/Edge，并产生可审阅迁移报告。
- 转换无法唯一解析的身份、绑定或关系必须进入 unresolved candidate，不允许凭名称猜测。
- Graph v2 生效后，新增维度、指标、公式、物理绑定和业务关系不得要求语义存储 schema DDL。
- PostgreSQL 继续作为 Authority；所有图索引/布局/community 结果都可由发布 Node/Edge 重建。

### R13 — Security, tenancy and audit

- 所有 Node/Edge read、candidate mutation、event 和 publish 操作都必须使用服务器解析的
  workspace/tenant/environment/principal，不接受调用方自报 Authority。
- Authoring event 和审计保留用户意图、公开工具步骤、目标 ID、before/after digest、证据、
  校验和 terminal；不得记录凭据、DSN、未授权业务行或 provider 原始异常。
- 读取局部图、全图和影响分析必须执行与 Node List 相同的授权过滤；聚合计数也不能泄漏
  不可见对象。
- Agent 不可通过创建 Edge 绕过 Node 可见性、领域权限或发布审核。

## 8. Information Architecture and Interaction States

### 8.1 Semantic Layer 一级导航

1. `节点`：默认 Node List。
2. `关系图`：围绕当前 Node 的局部图。
3. `全图`：community/semantic zoom 全局图。
4. `候选与审核`：Graph Diff、校验、评论、批准/拒绝和发布。
5. `版本与血缘`：release、rollback、Node/Edge 历史与影响范围。
6. `术语`：专业术语、别名、定义、适用域及其关联的语义 Node。

Agent Composer 在前三个创作视图保持可用，并共享同一个 authoring run。

### 8.2 Authoring run 状态

- `UNDERSTANDING`：识别意图和当前选区。
- `READING_GRAPH`：读取相关 Node/Edge、物理 schema 和历史。
- `NEEDS_CLARIFICATION`：等待用户回答唯一关键歧义。
- `MUTATING_CANDIDATE`：执行候选 Node/Edge 工具并实时刷新图。
- `VALIDATING`：执行确定性结构、公式、Join、权限和影响校验。
- `READY_FOR_REVIEW`：形成 Graph Diff，可进入人工审核。
- `FAILED`：展示稳定失败码和可恢复动作，活动图保持不变。
- `CANCELLED`：停止后续工具调用，保留已发生的候选 revision 和审计记录。

## 9. Success Metrics

- 100% 的 Node/Edge 语义新增和修改来自 Agent candidate tool receipts；直接 JSON/表单写入为 0。
- 在标准验收场景中，新增一个 Dimension 只产生 Node/Edge 和候选版本变化，数据库 schema
  migration 数为 0。
- Node List、局部图、全图和 Graph Diff 对相同 release/candidate 的 Node/Edge identity 与
  count 一致率为 100%。
- 未审批 candidate 进入活动 Explorer 或 Query Grounding 的次数为 0。
- 标准 10,000 Node release 下，Node List 可流畅虚拟滚动；局部图遵守 250/500 预算；全图
  首屏先返回可操作的 cluster 摘要，不因全量节点阻塞交互。
- 公式正例可从自然语言完成“理解 → Node/Edge candidate → live graph → validation → review”；
  身份歧义、公式环、unit/grain 冲突和不安全 fanout 负例全部失败关闭。

## 10. Acceptance Criteria

### AC1 — Graph model

- [ ] BusinessSubject、Dimension、Metric、Formula、PhysicalTable 具有独立稳定 Node identity；
      PhysicalColumn 具有可被 Edge 引用的稳定支撑 identity。
- [ ] Metric/Dimension/BusinessSubject payload 不再保存表列、公式、父级或其他 Node ID 数组；
      同等信息只通过 Edge 可查询。
- [ ] Edge registry 校验 source/target、方向和关系家族；悬空、重复、跨 scope 和非法 Edge
      失败关闭。
- [ ] 新增“商品维度”演示只新增/复用 Node 和 Edge，不执行语义数据库 DDL。
- [ ] 业务主体—主体、主体—维度、主体—物理表/字段、Formula—主体/维度/物理字段，以及
      Table—Column—FK—Join Proof 均有可验证、可见且方向正确的 Edge。
- [ ] GlossaryTerm 具有稳定 identity，专业术语可以通过 Agent 候选关联到语义对象且不复制为业务列。

### AC2 — Agent authoring

- [ ] Node List、局部图和全图均可从同一 Composer 发起 create/update/retire/link/unlink/rebind。
- [ ] Agent 在创建前调用搜索/读取工具，在候选修改后调用验证/影响分析，并显式完成 run。
- [ ] “新增成交商品数”正例生成 Metric、Formula、业务归属、公式定义和物理引用候选关系。
- [ ] “仅统计已支付订单”修改正例更新 Formula/依赖候选并列出受影响对象。
- [ ] 重名身份、含糊状态值、未知列、公式环、grain/unit 冲突和不安全 Join 均澄清或失败关闭。
- [ ] Agent 无法审批、发布、回滚、读取 secret、执行任意 SQL/Python 或直接写活动图。

### AC3 — Frontend views

- [ ] `/semantic` 默认进入 Node List，点击 Node 打开一跳局部图并可按类型扩展二跳。
- [ ] 全图以 cluster/community 摘要首屏加载，支持 semantic zoom、筛选、搜索、路径和稳定选区。
- [ ] Added/Modified/Retired/Published 在列表、局部图、全图和 Diff 中使用一致且无障碍的视觉状态。
- [ ] Agent 每次 mutation 后，候选图在同一 run 中增量更新；刷新后可重放且不重复 mutation。
- [ ] UI 不存在可直接提交 Node/Edge JSON、任意 JSON Patch 或图拖拽写语义的路径。
- [ ] Semantic Studio 按 `design-taste-frontend` 重构为非对称工作台：清晰区分导航、主画布、上下文
      检查器和 Agent Composer；desktop/mobile、loading/empty/error、键盘和响应式布局均通过验收。
- [ ] 局部图和全图可以按业务、分析、公式、物理、Join、溯源和术语关系家族筛选，并能从任意
      Formula 追到 Metric、BusinessSubject、Dimension、PhysicalColumn 和证据。

### AC4 — Governance and compatibility

- [ ] candidate overlay 明确与 active release 分离；发布前 Query Grounding 不读取候选内容。
- [ ] 人工审核绑定 exact candidate/base release/validation receipts；stale approval 和并发 publish
      失败关闭。
- [ ] Graph v1 → v2 fixture 确定性转换嵌入字段为 Node/Edge；歧义项进入 unresolved candidate。
- [ ] 旧 release 和历史 Query Run 在迁移后仍按原 digest 重放；图投影可从 PostgreSQL 重建。
- [ ] workspace/tenant/environment 隔离、权限过滤、审计脱敏和 reconnect/replay 通过集成测试。

### AC5 — Scale and consistency

- [ ] 10,000 Node 基准中 Node List 使用虚拟化，局部图明确执行 250 Node/500 Edge 预算。
- [ ] 全图任一层级不超过 500 个可视 glyph，聚合后保留准确数量、类型和筛选解释。
- [ ] 同一 release/candidate 在四个读取面返回相同 Node/Edge identity、状态和关系方向。
- [ ] GraphRAG/community 结果只影响导航和检索，不修改发布语义，也不绕过 Candidate Gate。

## 11. Out of Scope

- Agent 自动审批、自动发布、自动回滚或修改 reviewer/authorization policy。
- 允许用户通过 JSON、JSON Patch、数据库表单或图拖拽直接修改活动或候选语义。
- 在语义创作输入中执行任意 SQL/Python、修改业务数据库 DDL/DML 或扫描未授权业务数据行。
- 把 Neo4j、向量库、GraphRAG community 或前端图状态提升为发布 Authority。
- 首版实现通用 OWL/SHACL reasoner、实例级时态事实图、完整 RDF 三元组平台或自动
  `owl:sameAs` 身份合并。
- 把物理 FK、名称相似度、Embedding 相似度或 LLM 推断直接发布为业务关系/安全 Join。
- 把图渲染库、community/layout 算法、Formula 解析实现或 migration 编号当作产品能力；这些
  属于技术设计与实施时预检，不能改变本 PRD 的 Node/Edge、Agent 和 Authority 边界。

## 12. Dependencies and Delivery Boundaries

- 复用现有 PostgreSQL Candidate/Review/Publish/Rollback Authority，不新建第二套发布状态机。
- 复用现有 PhysicalSchemaSnapshot、Schema Drift、活动 SemanticRelease、Explorer、Diff 和
  Lineage；本需求是当前 M3 之后的 Graph v2 / Agent Semantic Authoring 范围，并吸收原父任务
  M4 Formula Authoring 的产品目标。
- 技术设计已拆分为五个可独立验证的子任务：Graph v2 核心、Agent authoring runtime、统一
  read/community projection、Studio 图体验、迁移/治理/E2E 收口。
- 本任务当前保持 `planning`。`design.md` 与 `implement.md` 已补齐；向用户展示最终规划摘要并
  获得后续明确批准后，才启动第一个子任务并进入产品代码实现。

## 13. Risks and Deferred Decisions

- 大图布局、community 计算和增量 overlay 仍可能产生视觉漂移；技术设计已采用 release-bound
  seeded community、稳定 layout key、分层预算和无图索引降级，实施时必须用 10,000 Node 基准验证。
- Formula AST 从内嵌结构迁到独立 Node 时可能暴露历史 identity 歧义；迁移必须保守地进入
  unresolved candidate，不能自动合并。
- Agent 多工具循环会增加重试、幂等、断线恢复和成本治理复杂度；设计已用 server-side tool
  loop、working patch/receipt、checkpoint 和 explicit complete 收敛，实施负例仍必须证明至多一次。
- 首版采用 versioned Edge registry、AntV G6 v5、seeded community 和分层 cluster projection；这些
  是可替换投影实现，不改变 Node/Edge 分离、关系平面、Candidate/Publish Authority 和三种视图。

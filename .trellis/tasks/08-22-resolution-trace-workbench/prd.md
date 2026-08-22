# 运行轨迹工作台升级

> 状态：v0.2 评审稿，仅定义产品需求，不代表已批准实现。

## 1. Goal

把当前“运行与证据 > 轨迹”从逐条事件清单升级为可浏览、可定位、可检查、可回放的运行轨迹工作台。用户既能在几秒内看懂一次 Run 的阶段、Agent、工具和证据分布，也能沿时间轴定位到具体记录并查看经过公开投影的详情。

本需求参考 DeepSeek Harness 截图中的高信息密度轨迹表、顶部时间轴、搜索、折叠和右侧 Inspector 交互，但保留 Data Agent 的术语、视觉令牌、权限边界和 PostgreSQL 运行权威，不复制其品牌或完整产品外观。

## 2. User Value

- **快速判断**：一眼识别 Run 当前停在哪个阶段、是否有失败/等待、主要耗时在哪里。
- **快速定位**：通过时间轴、搜索和列表联动，从长轨迹中直接找到 Agent、Tool、SQL、Artifact 或错误。
- **深入排障**：选中记录后，在不离开当前页面的情况下查看层级、状态、名称、问题、摘要、公开输入/结果、结构、时间、用量、决策和证据内容，而不是只看到一串 ID/hash。
- **可信审计**：页面只呈现真实持久化事件和公开证据，不用前端 loading 状态猜测执行过程，也不泄露私有推理或凭据。

## 3. Confirmed Facts

- 用户截图中的当前页面对应 `ResolutionTracePanel` 的“运行与证据 > 轨迹”页签；现状是按时间排列、逐行展开的扁平列表。
- 当前 `ResolutionTrace` 已提供 Run、节点、边、状态、时间、`duration_ms`、sequence 和 Artifact Reference，最多允许 10,000 个节点、20,000 条边。
- 当前公开节点只有受限的 `title`、`summary` 和引用，不具备可直接展示的原始 Payload/Result；UI 不得为了填满 Inspector 而读取或透传原始 Provider/Tool 载荷。
- 项目已有一套 Q&A `TrajectoryView`，包含角色泳道时间轴、记录选择、列表联动和 Summary/Payload/Result/Schema/Timing Inspector，可复用其交互语义，但图一入口目前没有接入该工作台形态。
- 项目已有 `ArtifactPreviewPanel` 和 `ArtifactWorkspace`：能够按 exact Artifact Reference 读取内容，校验返回的 source reference，并渲染 Markdown、SQL、Table、Chart、Report；Table/Chart 已支持有界分页。因此 Artifact 内容预览应复用现有权威接口和渲染器，而不是在轨迹页解析原始 `document_json`。
- DeepSeek Harness 参考实现包含 Duration 模式、Turn/Call 全局折叠、搜索、时间轴点击/区间选择、缩放/平移、记录表、右侧详情和大记录集虚拟化。

## 4. Product Principles

1. **先总览，后下钻**：时间轴负责回答“哪里发生了什么”，列表负责回答“按什么顺序发生”，Inspector 负责回答“这条记录的公开细节是什么”。
2. **选择状态统一**：时间轴、列表、搜索结果和 Inspector 始终指向同一个稳定节点身份，不维护互相冲突的选择状态。
3. **真实数据优先**：没有时间、耗时、结果或 Schema 时明确显示“不可用/尚未产生”，不得补算或伪造。
4. **公共摘要优先**：Think 仅表示应用生成的公开思考摘要；禁止展示 chain-of-thought、系统 Prompt、Provider reasoning、SecretRef、连接串、授权头、原始上下文或未脱敏载荷。
5. **内容优先于标识**：Run、Config、Profile、Task、Call、Receipt、Artifact 等 ID/hash 用于证明身份与版本；用户真正要阅读的问题、名称、摘要、输入、结果、决策和证据才是主信息。
6. **参考而非复制**：借鉴 DeepSeek Harness 的信息架构和交互，不照搬品牌、术语、配色或私有协议。

## 5. Scope

### 5.1 页面框架

- **R1**：保留现有“运行与证据”标题，以及“概览 / 轨迹 / Team / SQL / 工件”一级页签；“轨迹”是本需求的主改造入口，但 Overview、Team、SQL、Artifact 中与当前记录相关的 ID-only 展示也必须接入同一套内容详情，不能在跳转后再次只显示 ID/hash。
- **R2**：桌面端轨迹页按“工具栏与时间轴 / 记录列表 / 右侧 Inspector”组织。Inspector 支持收起，并允许在合理最小/最大宽度内拖动调整。
- **R3**：窄屏下记录列表保持主视图，Inspector 以抽屉或下层面板打开；不得因为固定三栏导致横向页面溢出。

### 5.2 顶部工具栏与运行摘要

- **R4**：工具栏展示本 Run 的真实总耗时、节点数、Tool/SQL 调用数、失败或等待数量；统计口径必须来自同一 `ResolutionTrace` 投影。
- **R5**：提供“真实耗时”切换：开启时按记录的真实起点与持续时间绘制，关闭时按事件 sequence 等宽排列，便于耗时极短或时间数据不完整的 Run 浏览。
- **R6**：提供“折叠/展开阶段”和“折叠/展开调用”全局动作；它们只改变当前用户的展示状态，不写回 Run 事件。
- **R7**：提供即时搜索，至少覆盖公开 title、summary、kind、status、Agent/Tool 名称、sequence 和公开错误码。搜索命中同时高亮时间轴和列表，并展示命中数量；清空搜索恢复原视图。

### 5.3 多泳道时间轴

- **R8**：时间轴采用适配 Data Agent 的四条语义泳道：
  - `RUN`：LIFECYCLE、PROGRESS、TERMINAL；
  - `AGENT`：AGENT、REASONING、ANSWER；
  - `TOOL`：TOOL、SQL；
  - `EVIDENCE`：CONTEXT、ARTIFACT。
- **R9**：有有效 `duration_ms` 的记录显示为持续区段；只有发生时间或耗时不可用的记录显示为最小可点击标记。失败、等待、运行中和完成状态必须能通过颜色之外的形状、图标或纹理识别。
- **R10**：悬停时间轴记录时显示轻量提示：标题、类型、状态、开始时间、耗时和 sequence；提示不得包含未公开载荷。
- **R11**：点击时间轴记录后，同步选中并滚动到列表对应行，同时刷新 Inspector；点击列表行也反向定位并高亮时间轴记录。
- **R12**：用户可在时间轴上拖选一个区间，只聚焦或高亮该区间相交的记录；可拖动已聚焦窗口平移，可用滚轮/触控板缩放，双击、`Esc` 或“重置”恢复完整范围。
- **R13**：时间轴提供键盘等价操作：方向键移动到相邻记录，`Enter` 选中，`Esc` 清除区间；所有交互均有可访问名称和可见焦点。

### 5.4 轨迹记录列表

- **R14**：列表严格按公开 sequence 排序；缺少 sequence 的派生 Evidence 节点按合同中的稳定次序展示，并明确标记为派生记录。
- **R15**：每行至少展示类型标签、标题、单行摘要、状态、sequence、开始时间和耗时。Tool/SQL 行区分“调用中 / 已完成 / 失败 / 中断”，不能把 started 误显示为 completed。
- **R16**：列表支持按阶段折叠，并根据真实 `SEQUENCE / PRODUCED / EVIDENCE / CONTEXT` 边显示最多一层归属关系；不得从标题文本猜测父子关系。
- **R17**：默认采用紧凑行高。选中行显示明确左侧标记；失败、阻断、等待审批/用户输入等关键行即使折叠也保留可感知摘要。
- **R18**：当记录数达到虚拟化阈值时，仅渲染可视窗口与少量 overscan；加载更早记录或实时追加事件时保持用户当前滚动锚点，不得反复跳到末尾。

### 5.5 右侧 Inspector

- **R19**：选中任意记录后打开 Inspector。固定头部显示节点类型、Turn/阶段、Step/sequence、状态、完整标题和关闭按钮；重新打开时仍定位到当前选择，而不是默认跳到最后一条。
- **R20**：Inspector 提供 `Summary / Payload / Result / Schema / Timing` 五个页签。`Summary` 不是只有一句摘要，而是像参考截图一样，在一个可滚动视图中汇总 `Hierarchy、Status、Identity、Payload、Result、Schema、Timing` 七个可折叠区块；点击其他页签直接进入对应区块的完整视图。
- **R21**：Inspector 的公共信息矩阵至少覆盖：

  | 节点类型 | 必须展示的公开详情 |
  | --- | --- |
  | 所有节点 | Run ID、node ID、kind、status、sequence、事件/schema 版本、公开 summary、父子/证据关系 |
  | Agent / Reasoning / Answer | Agent Profile/任务身份、公共阶段摘要、模型/Provider 的非敏感绑定名、完成状态；有公开用量时展示 token、耗时和费用摘要 |
  | Tool | Tool 名称、call ID、所属 Agent/任务、公开参数、公共结果或错误码、exit/status、耗时、产出 Artifact Reference |
  | SQL | Compiler、query/statement/schema snapshot hash、编译/执行状态、执行回执与结果 Artifact Reference；SQL 正文和参数仅在独立授权投影允许时展示 |
  | Artifact / Context | 可直接阅读的安全内容预览、类型、ID、revision、content hash、来源节点、预览/下载动作和权限状态；内容是主信息，ID/hash 是次级元数据 |
  | Lifecycle / Progress / Terminal | Run 状态变化、Worker/lease 的公开回执、终态原因和关键时间；不得把已受理或已租约误写成 Provider/SQL 已执行 |

- **R22**：`Payload` 使用结构化 JSON/键值视图并支持语法着色、折行切换和复制公开内容；`Result` 根据公共类型选择文本、Markdown、JSON、表格摘要或 Artifact 预览。长内容默认显示安全预览和总长度，用户主动展开后在 Inspector 内部滚动，不撑开页面。
- **R23**：`Schema` 同时说明事件 schema 名称/版本、输入/输出公共结构和字段可用性；后端没有发布 schema 时明确显示 `Schema unavailable`，不得从当前值反推一个伪 schema。
- **R24**：`Timing` 至少展示 Started、Completed、Duration、Timing source；如果记录有请求排队、重试或子步骤公共时间，还应分项展示 queue、execution、retry 和累计耗时。时间统一显示到毫秒，并允许查看原始 ISO 时间。
- **R25**：Inspector 支持复制 node ID、call ID、sequence、hash 和公开字段；复制、搜索索引和页面源代码均不得包含被脱敏值。被隐藏字段显示“因安全策略不可见”及稳定 reason code，而不是静默消失。
- **R26**：Artifact/SQL/Agent 等可导航引用在 Inspector 中提供“查看对应工件 / SQL / Team / 返回对话”动作，并保留 exact Run + sequence 定位；无真实引用时不显示入口。选择 Artifact 时直接进入内容预览，而不是再经过一个只显示 ID/hash 的中间页面。
- **R27**：详情字段必须由服务端公共投影显式允许。前端不得直接读取 raw `run_events`、Provider payload、Tool stdout 全量或凭据来填充页签；若公共详情合同尚未提供数据，必须交付诚实空态，不能用 mock 数据填充生产页面。

### 5.6 从标识到内容的统一展开

- **R28**：任何可解析引用都遵循统一的三级信息层级：
  1. **主信息**：用户能理解的名称、问题、摘要、正文、输入、结果或决策；
  2. **辅助信息**：类型、状态、版本、时间、归属、来源和可执行的查看动作；
  3. **技术身份**：ID、revision、hash、sequence、schema version，默认收进“身份与来源”，但保持可复制。

  当内容可由当前用户已有权限下的公共投影解析时，禁止把裸 ID/hash 作为唯一可见内容。解析失败时保留 ID 并显示稳定的 unavailable/forbidden/stale reason code，不能用猜测的名称代替。

- **R29**：运行与证据工作台至少完成以下 ID-to-content 映射：

  | 当前标识 | 用户优先看到的内容 | 已有可复用来源 | 尚需补齐 |
  | --- | --- | --- | --- |
  | Run ID | 用户问题、权威状态、创建/更新时间、总耗时、尝试次数、当前/终态摘要、数据源与模型 | Run 详情投影已有 question/status/time/datasource；runtime projection 有 attempt/fence/active refs | 形成单一只读 Run Inspector 投影，避免客户端拼出矛盾状态 |
  | Conversation ID | 对话标题、本 Run 对应的问题与回答摘要、消息数、资源版本、返回对话动作 | Conversation directory/detail/messages 已有 title、messages、bindings | 轨迹详情按 exact run 选择关联消息，不加载无关对话全文 |
  | Effective Config ID/hash | 冻结模型/Provider、数据源、Semantic Release、Schema Snapshot、Context/Egress/Safety Policy、资源绑定和提交时间 | `effective_run_config_receipts` 与 resolver 已有完整权威 receipt | 新增受限的 Run Config 公共详情，不暴露凭据、内部路由或 SecretRef |
  | Model Profile ID | display name、Provider、model id、配置/档案版本、readiness、认证状态和上下文/输出上限 | QA Resource Catalog 已提供这些公共字段 | 按 Run 冻结版本显示，不能拿当前 Catalog 覆盖历史绑定 |
  | Datasource ID | display name、类型、状态、database/schema 的允许部分 | QA Resource Catalog 有 name/type/status；Datasource detail 有更多字段 | 历史 Run 使用冻结/记录时名称；credential、password、完整连接串永不进入详情 |
  | Agent Profile ID/hash | display name、公开描述、access mode、何时使用、输入/输出 Artifact 类型、工具/Skill/Workflow 摘要、revision 和 approval | Product Profile Registry v2 discovery 与 registry item 已提供大部分内容 | 旧 v1 Profile 提供稳定中文名与允许字段；不展示 Prompt 正文 |
  | Task / Attempt ID | Agent 名称、任务公共目标/摘要、父任务、状态、阶段、开始/完成/耗时、重试次数、产出内容 | Team trace 已有 lineage/status/revision/attempt/fence；Public Agent event 有 title/summary/phase/error | Team 公共投影补 task title/summary/timing/retry/output refs，不能只列 UUID |
  | Handoff / Epoch / Verifier Decision ID/hash | 谁交给谁、任务摘要、Context Epoch phase、Verifier 结论/原因、时间与关联产物 | Team trace 已有关系、phase、revision 与 hashes | 补公共 request summary、decision verdict/reason、completion summary；hash 降为来源证明 |
  | Event / Node ID | 事件类型、标题、公共 payload/result/error、状态、时间、前后/归属关系 | Public Run Event 已有 lifecycle/progress/agent/tool/answer/reasoning/terminal 内容 | Resolution Trace 当前丢弃部分字段；需安全 detail union 或按 sequence 读取公共事件 |
  | Tool Call ID | Tool 名称、所属 Agent/Task、公开 input/output、状态、error code、耗时、Artifact 内容 | Public Tool event v2 已有 call/profile/task/input/output/error/duration/refs | 将 started/completed/failed 按 call identity 组装为一条详情，不能只显示 call ID |
  | SQL/query/statement/hash refs | 实际授权 SQL、参数摘要、Compiler、状态、执行耗时/行数/错误、结果表、Query Evidence 与 Schema | SqlArtifact、ExecutionReceipt、SandboxResult、QueryEvidence 和 SQL History 已有 exact refs | SQL History 目前主要返回 hash；详情需复用 Artifact Preview/Receipt 公共投影 |
  | Schema Snapshot ID/hash | 数据源/Release、schema/table/column 摘要、生成时间、与本次 SQL 的 exact 绑定 | Effective Config 与 SchemaSnapshot ref 已存在 | 增加 SchemaSnapshot 内容 renderer/公共摘要；不能仅显示 snapshot hash |
  | Context Package / Receipt ID/hash | 语义域、路由决定、选中 Metric/Ontology 标签、容量计划、included/cropped 项、证据摘要、Provider/Policy 和 receipt 状态 | Resolved Context Package/Receipt 合同已有结构化内容 | 提供有界、脱敏公共详情；不展示原始 Prompt 或超范围知识正文 |
  | Artifact / Receipt ID/hash | 类型化内容、状态/结论、来源、签发时间、输入输出引用及可用预览/导出 | Artifact Preview/Workspace 已支持多类内容，若干 Receipt 以 Artifact 保存 | 不支持类型补公共 renderer 或诚实空态；ID/hash 只作 exact identity |

### 5.7 Artifact 内容预览

- **R30**：用户选中 `ARTIFACT` 节点，或在 Tool/SQL/Answer 的 Result 中点击 Artifact Reference 后，Inspector 自动通过 exact `artifact_id + revision + content_hash + scope/run` 加载安全内容预览。默认首屏直接显示内容；Artifact ID、revision、hash、renderer version 和来源关系放在可展开的“身份与来源”区域。
- **R31**：复用现有 `ArtifactWorkspace` 的类型化渲染能力：
  - `MARKDOWN`：渲染安全正文与经过允许的外部/Artifact 链接；
  - `SQL`：使用代码视图展示被授权的 SQL 内容，支持横向滚动与复制；
  - `TABLE`：展示字段名、数据类型、行内容、总行数/未知总数和分页；
  - `CHART`：展示图表，同时保留同源可访问数据表、单位、描述和治理来源；
  - `REPORT`：按标题和章节展示报告正文，并允许继续打开其证据引用。
- **R32**：一个记录关联多个 Artifact 时，Inspector 先显示带类型和简短内容摘要的 Artifact 列表；用户选择后在同一 Inspector 内切换预览。切换 Artifact 不改变时间轴和轨迹行的当前选择。
- **R33**：Tool/SQL 的 `Result` 区块在只有一个可预览 Artifact 时直接内联首屏预览；有多个 Artifact 时内联第一个并显示“其余 N 个”，用户可切换。不得只输出 Artifact ID 列表作为完成态。
- **R34**：表格和图表数据必须有界读取，沿用 offset/limit 分页；默认每页不超过 100 行，并展示当前范围、总行数或未知总数、是否截断及上一页/下一页。轨迹页不得一次性下载整个数据集来生成预览。
- **R35**：预览返回的 `source_ref` 必须与用户点击的 exact reference 完全一致；revision/hash 漂移、stale reference、hash mismatch 或 scope/run 不一致时失败关闭，显示稳定错误码，不能退回“按最新版本”展示。
- **R36**：不支持的 Artifact 类型显示类型、身份、公开摘要、来源和 `ARTIFACT_PREVIEW_UNSUPPORTED`，并在有权限时提供“在工件页打开”；不得把未知文档强制 JSON stringify 后展示。
- **R37**：预览覆盖 loading、empty、unsupported、forbidden、not found、stale、hash mismatch、分页失败和 renderer failure。失败只影响当前 Artifact 区块，不清空整条轨迹或关闭 Inspector。
- **R38**：预览和导出是两种独立授权动作。内容可预览不等于可下载；只有已有导出权限与回执时才显示 CSV/XLSX 等动作，且点击导出继续生成既有审计记录。

### 5.8 实时、恢复与状态

- **R39**：运行中通过既有持久化事件 + SSE 增量更新。以 `(run_id, sequence)` 幂等合并，刷新和 `Last-Event-ID` 重连后保持相同顺序、状态和记录身份。
- **R40**：用户位于末尾且未手动选中历史记录时可跟随新事件；用户正在查看历史区间、搜索结果或 Inspector 时，新事件只显示“有新记录”提示，不抢夺焦点。
- **R41**：覆盖加载中、空 Run、运行中、等待、失败、取消、已完成、重连中、部分时间数据缺失和无权限状态；页面不得用“RUNNING”标签冒充 Worker、Provider、Tool 或 SQL 已真正执行。

### 5.9 安全、权限与审计

- **R42**：沿用现有 Workspace READ/RLS 和管理员只读审计边界；本需求不新增越权读取能力。
- **R43**：搜索索引、浏览器状态和可复制文本只能包含公开投影字段。敏感字段必须在持久化/公共投影边界前剔除，而不是仅靠 CSS 隐藏。
- **R44**：管理员跨 owner 打开轨迹、Inspector、Artifact 或 SQL 时，继续生成既有不可变审计回执；普通用户不获得管理员入口。

## 6. Interaction Flow

1. 用户进入某个 Run 的“轨迹”页签，默认看到用户问题、权威状态、模型与数据源名称、完整时间范围、四泳道概览和按 sequence 排列的紧凑记录；Run/config 等 UUID/hash 收在“身份与来源”中。
2. 用户从时间轴发现某段 Tool 密集或失败区间，拖选该范围；列表聚焦相关记录。
3. 用户点击某个 `sql.sandbox.execute` 记录；列表滚动到对应行，右侧 Inspector 的 Summary 首屏同时展示层级、状态、身份、公开 Payload、Result、Schema 和 Timing。如果该调用产出一个 Artifact，Result 直接展示其内容；如果产出多个 Artifact，用户在同一 Inspector 中切换预览。
4. 用户在搜索框输入 Agent、Tool 或错误码；时间轴和列表共同高亮命中项，可逐条定位。
5. Run 仍在执行时，新事件从 SSE 到达。若用户正在查看历史记录，界面保留当前位置并提示有新记录；用户主动回到末尾后恢复实时跟随。
6. 用户刷新页面或 SSE 重连，页面从持久化 sequence 恢复到语义等价的轨迹，不重复记录、不丢失 terminal 状态。

## 7. Acceptance Criteria

- [ ] **AC1 / 页面边界（R1-R3）**：打开图一对应入口后，“概览 / Team / SQL / 工件”行为不变，“轨迹”呈现时间轴、记录列表和 Inspector；1440px 桌面端无页面级横向滚动，390px 下可完整打开记录详情。
- [ ] **AC2 / 数据诚实（R4-R5、R9、R15）**：固定 fixture 中总耗时、节点数、调用数、失败/等待数与 `ResolutionTrace` 一致；缺失 duration 的记录为可点击标记并显示“耗时不可用”，不生成虚假长度。
- [ ] **AC3 / 泳道映射（R8-R10）**：十类 Resolution Trace node 均进入唯一预期泳道；RUNNING、WAITING、FAILED、COMPLETED 在灰阶或色觉缺陷模式下仍可区分。
- [ ] **AC4 / 双向定位（R11）**：点击任一时间轴记录后，对应列表行进入可视区且 Inspector 指向相同 node_id；点击列表行产生完全相同的反向定位结果。
- [ ] **AC5 / 区间浏览（R12-R13）**：鼠标拖选、平移、滚轮/触控板缩放、双击重置、键盘相邻移动与 `Esc` 清除均可用，且不会触发文本误选或丢失当前记录选择。
- [ ] **AC6 / 搜索（R7）**：搜索 title、summary、kind、status、Agent/Tool 名称、sequence 和公开错误码均可命中；结果计数、列表和时间轴标记一致，清空后恢复完整数据。
- [ ] **AC7 / 折叠与层级（R6、R14-R17）**：阶段/调用可单独或全局折叠；层级只来自 trace edges，乱序输入、重复边和无父节点 fixture 不产生重复记录或猜测归属。
- [ ] **AC8 / Inspector 信息密度（R19-R27）**：每种节点类型至少覆盖一个 Inspector fixture；Summary 首屏可见 Hierarchy、Status、Identity、Payload、Result、Schema、Timing 七个区块，五个页签可直接查看对应完整公开内容，Tool fixture 能看到 call ID、公开参数、公共结果/错误、耗时和 Artifact 内容入口。
- [ ] **AC9 / ID-to-content（R28-R29）**：Run、Conversation、Config、Model、Datasource、Agent、Task/Handoff/Epoch/Verifier、Event/Tool Call、SQL/Schema、Context Package/Receipt、Artifact/Receipt 的 fixture 均以名称/摘要/正文/输入/结果/决策为主信息；页面不存在“可解析但只展示裸 ID/hash”的完成态。
- [ ] **AC10 / 历史绑定（R28-R29）**：Model、Datasource、Profile、Config、Semantic Release 和 Schema Snapshot 均显示本 Run 冻结或记录时的 exact revision/hash；修改当前 Catalog 后刷新历史 Run，详情不漂移到新名称或新配置。
- [ ] **AC11 / Artifact 内容（R30-R33）**：MARKDOWN、SQL、TABLE、CHART、REPORT 五类 fixture 在选中 Artifact 后都直接显示可读内容而非 ID 列表；单 Artifact 在 Tool Result 中直接内联，多 Artifact 可在同一 Inspector 切换且不改变当前轨迹选择。
- [ ] **AC12 / Artifact 身份与有界读取（R34-R38）**：10,000 行表格只读取当前页且默认不超过 100 行；返回 reference 漂移、hash mismatch、无权限、不支持类型和分页失败分别显示稳定状态，绝不回退到最新版本或下载全量数据；预览权限不自动产生导出按钮。
- [ ] **AC13 / Inspector 诚实与安全（R22-R29、R35-R38）**：无公开输入/结果/结构时展示带原因的空态；长内容在 Inspector 内预览/滚动，存在引用时可定位到 Team/SQL/Artifact/对话；显示、复制、搜索索引和 DOM 中均不存在 SecretRef、连接串、Authorization、系统 Prompt、Provider reasoning 或 raw context。
- [ ] **AC14 / 实时稳定性（R39-R41）**：同一 fixture 经首次加载、乱序增量、两次 SSE 重连和刷新后得到相同顺序、状态与 record identity；用户查看历史或内容详情时新事件不抢焦点。
- [ ] **AC15 / 大轨迹（R18）**：10,000 节点 fixture 可交互，DOM 记录行保持在虚拟窗口规模；向前加载和实时追加后当前可见锚点不漂移。
- [ ] **AC16 / 权限与审计（R42-R44）**：Workspace READ、无权限、管理员跨 owner 三组集成用例通过；跨 owner 的轨迹/详情/内容/引用打开生成对应审计回执，普通用户伪造请求被拒绝。
- [ ] **AC17 / 状态覆盖（R41）**：加载、空、运行、等待、失败、取消、完成、重连、时间缺失和无权限状态均有可观察 UI 与自动化用例；RUNNING 不被文案解释为 Provider/SQL 已完成。
- [ ] **AC18 / 参考边界**：若后续实质性复用 DeepSeek Harness 代码，更新 source reuse ledger 与 MIT notice；仅借鉴交互时记录为 Data Agent 原创实现，不复制品牌资产。

## 8. Out of Scope

- 不改变“概览 / Team / SQL / 工件”的权威业务语义或写操作；但这些页签中由当前 Run 引用的内容解析、详情与 ID-only 展示改造属于本需求范围。
- 不展示模型私有思维链、系统 Prompt、Provider 原始请求/响应、完整 Tool stdout、数据库凭据或未脱敏业务数据。
- 不用前端事件推断新的运行事实，也不建立独立于 PostgreSQL/public projection 的第二套轨迹状态机。
- 不在本任务中新增 Run retry、cancel、approval、继续执行或修改配置能力；轨迹工作台保持只读。
- 不绕过现有 Artifact Preview/Export 合同直接渲染数据库中的原始 `document_json`，也不因为用户能看到 Artifact ID 就推定其有权查看内容或下载文件。
- 不复制 DeepSeek Harness 的完整 UI、品牌、角色命名、配色或私有协议。
- 不在 v0.2 中承诺跨 Run 的全局对比、瀑布图性能分析、成本归因或轨迹导出；可作为后续任务评估。

## 9. Constraints and Risks

- 当前 `ResolutionTraceNode` 只有摘要级字段。若要让“输入 / 结果 / 结构”页签具有真实内容，后续设计必须扩展严格的公共详情合同或复用现有安全 Artifact/SQL/Agent 投影，不能让前端直接访问 raw event。Artifact 内容是例外中的已有能力：它可以通过 exact reference 复用现有 Artifact Preview API 与类型化 renderer，无需把内容塞回 Resolution Trace 节点。
- 当前内容来源分散在 Run detail、Conversation、QA Resource Catalog、Effective Config Receipt、Public Run Event、Team Trace/Profile Registry、SQL History、Resolved Context 和 Artifact Preview。后续设计需要一个按当前 Principal 授权、按 exact historical binding 读取的只读详情聚合边界；不允许浏览器凭多个 ID 自行拼接权威结论。
- `duration_ms` 并非每个节点都存在；时间轴必须同时支持真实耗时和 sequence 两种投影。
- Contract 上限为 10,000 节点，因此虚拟化、搜索索引节流和稳定滚动锚点属于产品验收的一部分，而非事后性能优化。
- 实时追加与用户主动浏览历史存在焦点竞争；默认以“不打断用户”为优先，仅在用户已位于尾部时自动跟随。

## 10. Open Question

- **OQ1（阻塞最终收敛）**：MVP 是只升级图一对应的“运行与证据 > 轨迹”页签，还是同时把 Q&A 顶层 `TrajectoryView` 也统一成同一套外观与交互？当前评审稿推荐前者：先解决明确入口，并复用已有底层交互语义；同时改两个入口会扩大回归范围，也容易在数据合同尚未统一时形成表面一致、语义不同的两套 UI。

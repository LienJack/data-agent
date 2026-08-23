# 知识库驱动语义层工作流

## Goal

让业务人员把 PDF、Markdown、Word、Excel 等业务资料与数据库结构共同作为证据，生成可追溯、可编辑、可验证、可审批的语义层候选；候选经人工治理后发布为正式版本，供 Text2SQL、对话分析和图表生成使用。

## User Value

- 将散落在制度、指标手册和业务说明中的知识转化为可执行语义资产。
- 让每个语义定义都能回答“来自哪里、为什么这样定义、映射到哪些字段”。
- 让 Agent 修改和可视化手工修改进入同一条可审计的变更与发布链路。
- 防止模型在证据不足或存在冲突时猜测并直接污染正式语义层。

## Confirmed Product Intent

- 工作流覆盖：资料上传与解析 → 语义要素提取 → 数据库与已有语义对象关联 → 候选语义结构生成 → Agent/可视化编辑 → 校验 → 审批 → 发布/回滚 → 下游消费。
- 支持从资料中提取指标名称、业务定义、公式、单位、粒度、时间口径、维度、同义词、适用范围和对象关系。
- 每个生成对象保留来源文档、页码或段落引用。
- 自动生成结果只进入候选区，不直接覆盖或发布正式语义层。
- Agent 能通过自然语言创建或修改指标、公式、时间字段与维度拆分等语义内容。
- 可视化编辑器支持调整指标、实体、关系、公式、物理字段映射和同义词。
- Agent 修改与手工修改形成同一种 ChangeSet，可预览 Diff、验证、审批、发布和回滚。
- 由用户自主选择创作入口，不要求先经过 Agent 或等待 Agent 失败。
- 创作入口包括三种：
  1. 用户在对话框输入业务意图、指标和公式，由 Agent 自动生成语义对象与关系；
  2. 用户上传知识资料，选择知识库中的具体段落作为证据，再让 Agent 基于选中段落生成语义对象与关系；
  3. 用户直接新建或编辑语义对象与关系。
- 三种入口都只修改 Candidate，必须生成同一种类型化 ChangeSet，并遵守相同的版本冲突、确定性校验、审批和发布约束；不得直接修改活动语义层。
- 编辑过程不自动生成权威 Revision；只有用户点击“保存草稿”时，才把当前 ChangeSet 持久化为可恢复的 Candidate Revision。
- “保存草稿”和“提交审核”是两个独立动作。提交审核必须绑定并冻结用户选择的已保存 Revision；审核中若继续修改，则产生新 Revision 并重新提交。
- 页面必须显示未保存状态，并在刷新、切换候选或离开页面前提醒用户未保存修改可能丢失。
- 用户希望全部语义关系均可在界面中编辑；关系编辑后的结果仍必须进入审核路线。
- 可编辑范围包括业务关系、指标归属、公式依赖、维度层级、语义物理绑定、分析 Join、术语与证据关系。
- MVP 允许使用注册表中的现有关系类型新建、修改、断开、重新连接和退役关系实例。
- 新增关系类型必须作为独立候选提案，明确名称、语义、规范方向、允许的 source/target Node 类型、属性 Schema 与治理策略，并经过单独审核；关系实例编辑器不得临时创建无约束类型。
- 数据库 schema 快照确定的 `PhysicalTable → PhysicalColumn`（`CONTAINS_COLUMN`）和 `Foreign Key`（`FOREIGN_KEY_TO`）属于 system-managed 物理事实，只读展示，不允许 Agent 或用户直接编辑。发现错误时通过重新扫描数据库，或另建不篡改原始事实的覆盖/修正候选处理。
- Knowledge Base 是独立的公司资产，必须有专属的展示、检索、维护和治理页面，而不是只作为 Semantic Studio 内部输入或系统设置项。
- 原始文件和已经被引用的解析内容不可变；用户通过上传新版本、替换来源资料或添加纠错/补充注释形成新的 Knowledge Revision。
- 新 Revision 不改写旧引用，页面必须展示旧版本仍被哪些 Candidate 或 Published Semantic 对象消费。
- 用户选中的段落是本次生成中业务定义、指标口径、公式、粒度、单位、时间语义与关系主张的唯一文档证据。
- Agent 可以读取数据库 Schema 与当前语义层完成字段映射、对象复用、冲突检查和影响分析；未选中的知识段落只能作为相关资料推荐，用户确认加入后才能成为本次生成证据。
- 字段缺失、公式冲突、粒度不一致、循环依赖、无法映射等情况必须显式阻断或标记，不允许模型自行补全后直接发布。

## Confirmed Repository Facts

- Workspace 文件 Authority 已存在，扫描白名单包含 PDF、DOCX、Markdown、CSV、JSON 和纯文本，但尚不包含 XLSX（`packages/platform/src/storage/file-scan-port.ts:3-10`）。
- Knowledge Base、Embedding Profile、Generation、Chunk、Projection Receipt、检索 Evidence 与 PostgreSQL/Neo4j 边界已经建立；这次应扩展现有链路，而不是创建第二套知识库。
- 当前知识索引 Worker 只解析 UTF-8 的纯文本、Markdown、CSV 和 JSON；PDF 与 DOCX 虽可上传和扫描，但不能进入知识解析，XLSX 从上传扫描阶段就不支持（`apps/worker/src/knowledge/knowledge-index-job.ts:48-77`）。
- `DOCUMENT_INDUCTION` 已能把受治理 Knowledge Revision 转成 review-only U5 Candidate，并复用现有 `semantic.create_candidate_draft` 与发布治理链路（`.trellis/spec/backend/semantic-induction-maintenance.md:3-14`）。
- 当前文档归纳只把 Markdown 标题或 `term:` 行识别为 `TERM`，尚未提取指标、公式、粒度、单位、时间口径、同义词和物理映射（`packages/semantic/src/induction/processor.ts:67-92`）。
- Graph v2 已有类型化 Node/Edge authoring tools、确定性验证、影响分析、澄清和进入审核的完整 Agent 工具表（`packages/semantic/src/authoring/tool-catalog.ts:8-29`）。
- Graph v2 已有带 candidate、连续 working revision、before/after digest 与 patch digest 的统一 `SemanticGraphPatch` reducer，可作为 Agent 与手工编辑共同生成 ChangeSet 的内核（`packages/semantic/src/graph-v2/patch-reducer.ts:239-272`）。
- Semantic Studio 当前只能从 Inspector 发起“让 Agent 修改”，明确不允许直接写 Node/Edge（`apps/web/src/components/semantic/studio/semantic-inspector.tsx:213-228`）。
- 当前 Knowledge Base 只在 `/settings` 中以设置面板出现，支持创建、重建和证据检索调试，但没有独立资产目录、详情、版本或内容维护页面（`apps/web/src/app/settings/page.tsx:94`、`apps/web/src/components/settings/knowledge-bases-panel.tsx:212-331`）。
- 已有任务 `08-15-agent-semantic-graph-authoring` 把“Agent 是唯一语义创作入口”冻结为产品原则，禁止表单或图操作直接持久化候选（`.trellis/tasks/08-15-agent-semantic-graph-authoring/prd.md:81-89,226-234`）；新需求的“可视化编辑器手工调整”与该原则存在明确产品冲突，需要用户决定是否覆盖旧原则。

## Requirements

### R1. Knowledge Sources

- MVP 仅支持 Markdown 资料上传、解析状态展示和失败反馈，优先跑通端到端业务闭环。
- PDF、Word、Excel 是后续格式适配范围，不阻塞 MVP 验收；适配时仍必须复用同一 Knowledge Revision、Evidence Locator 和 ChangeSet 治理合同。
- 保留原始文件、内容定位信息和可用于引用的解析结果。

### R1.1 Knowledge Asset Workspace

- 提供独立 Knowledge Base 导航入口、资产列表页和详情页。
- 列表至少展示名称、状态、Owner、可见范围、来源数量、当前版本、最近更新时间和被哪些语义域使用。
- 详情至少展示原始资料、解析后的章节/页码/段落、引用定位、索引状态、版本历史、ACL、下游语义候选与使用记录。
- 支持按权限维护名称、说明、Owner、分类、标签、ACL、来源资料集合和索引版本。
- 从详情页可选择一个或多个段落，携带精确引用进入 Agent 语义生成流程。
- Knowledge Base 的修改必须版本化、可审计，并能说明哪些既有 Candidate 或 Published Semantic 对象仍引用旧版本。
- 禁止原地覆盖已经进入证据链的原文或段落；纠错注释必须保留原段落、修正内容、作者、原因和生效版本。

### R2. Evidence-backed Extraction

- 从资料中提取指标、维度、业务术语、实体、关系、公式、单位、粒度、时间口径、同义词和适用范围。
- 提取结果必须关联来源引用与置信/待确认状态，不把推断伪装成文档事实。
- 每个材料字段必须区分 `SELECTED_KNOWLEDGE_EVIDENCE`、`SCHEMA_FACT`、`CURRENT_SEMANTIC_FACT` 与 `AGENT_INFERENCE`；Agent 推断不能冒充选中文档事实。
- 未经用户确认，不得自动扩大所选知识证据集合。
- MVP 发布后的唯一必选下游验收是 Text2SQL；对话分析与图表生成后续复用同一 Published Semantic Release，但不阻塞 MVP。

### R3. Semantic Grounding

- 将提取结果与数据库表字段、关系以及已有语义对象进行匹配。
- 对唯一匹配、多候选、无匹配和冲突分别给出明确状态与证据。

### R4. Candidate Generation

- 生成与正式语义层隔离的候选对象和关系。
- 候选保留生成依据、版本、状态、来源及与当前正式版本的差异。

### R5. Unified Authoring

- Agent 对话修改和可视化手工修改产出统一 ChangeSet。
- ChangeSet 支持查看逐对象 Diff、来源、影响范围、校验结果与操作历史。
- 直接编辑器支持所有 Agent-authored Node/Edge 的新建、修改、连接、断开、重新绑定和退役；system-managed 物理事实只读。
- 编辑会话可在保存前累积多项操作；系统不得因为字段失焦、Agent 单轮结束或单次关系调整而自动创建 Revision。
- 用户点击“保存草稿”后生成连续、可比较、可恢复的 Candidate Revision；点击“提交审核”后才创建审核任务。
- 关系实例编辑只能选择已注册的关系类型，并根据类型定义约束可选起点、终点和属性。
- 新关系类型提案与普通关系实例 ChangeSet 分开保存、验证和审核。

### R6. Deterministic Validation

- 确定性检查至少覆盖字段存在性、类型兼容、公式语法、引用完整性、粒度一致性、循环依赖和映射歧义。
- 校验失败不能被模型说明文字覆盖，也不能进入发布状态。

### R7. Governed Release

- 发布必须经过具备权限的人工审批。
- Candidate 创建者可以审核自己的提案，不因 proposer 身份被排除在审核人之外。
- 具备相应权限的创建者可以让自己的审核票满足法定人数，并由本人继续发布；MVP 不强制审核人与发布人职责分离。
- 自审自发仍必须通过 exact Revision 冻结、确定性校验、发布前检查和发布权限验证，不能把“创建者允许发布”降级为绕过 Gate。
- UI 可以提供一次“审核并发布”操作；后端必须先对 exact Candidate Revision 记录审核批准，再执行发布，两段事件均独立审计且全部成功后才返回发布成功。
- 审核成功但发布 Gate 失败时保持“已批准、未发布”或明确失败状态，不得伪造 Published，也不得留下部分激活版本。
- 正式语义层按版本发布，可查看发布记录并回滚到历史版本。
- 发布版本能够被 Text2SQL、对话分析和图表生成按明确绑定消费。
- MVP 必须证明 Text2SQL 显式绑定新发布的 exact Semantic Release，并基于新增或修改后的指标、公式与关系生成和执行真实 SQL。
- 仅创建发布记录或在 UI 显示 Published 不构成 MVP 下游验收通过。

### R8. Auditability and Safety

- 记录资料、提取、匹配、Agent/人工修改、校验、审批、发布和回滚事件。
- 不向前端或审计记录暴露模型私有推理、系统提示词、凭据或原始 Provider 对象。

## Acceptance Criteria

- [ ] 用户可上传 Markdown 业务资料，并看到解析成功或可理解的失败状态。
- [ ] 系统能从样例资料生成带来源定位的语义候选，而非直接修改正式版本。
- [ ] 候选能与真实数据库字段及已有语义对象建立可解释映射，歧义和无映射状态清晰可见。
- [ ] 同一候选可分别通过 Agent 指令和可视化编辑器修改，两类修改均生成统一 ChangeSet 和 Diff。
- [ ] 字段缺失、公式冲突、粒度不一致、循环依赖、无法映射的代表性用例得到确定性、不可绕过的结果。
- [ ] 未审批的 ChangeSet 无法发布；获批发布后生成新的正式语义版本与审计记录。
- [ ] 已发布版本可被至少一个真实下游路径消费，并能回滚到上一正式版本。
- [ ] Text2SQL 绑定 exact 新发布版本，完成至少一个会受本次知识/编辑变更影响的真实查询与 SQL 执行；结果包含可审计的版本绑定证据。

## Out of Scope

- MVP 不实现 PDF、Word、Excel 内容解析和证据选择；这些格式后续按相同合同增加适配器。
- MVP 不把知识库扩展为通用企业文档协作套件；只实现支撑知识资产治理和语义生成所需的页面、版本、引用、ACL 与检索能力。
- MVP 不要求对话分析或图表生成消费新版本；它们作为后续下游适配，不得绕过 Published Release。

## Open Questions

- Knowledge Revision 更新后，系统是只提示受影响语义对象并等待用户选择段落重新生成，还是自动创建新的语义 Candidate。
- MVP 首批必须支持的文档格式组合。
- 审批角色、多人协作与回滚粒度是否复用现有语义治理规则。
- 下游验收优先选择 Text2SQL、对话分析还是图表生成。

## Notes

- 这是复杂跨层任务，最终规划必须包含 `design.md` 与 `implement.md`。
- 当前工作树已有与本任务无关的修改和 Falcon 产物；后续实现必须仅暂存本任务拥有的路径。

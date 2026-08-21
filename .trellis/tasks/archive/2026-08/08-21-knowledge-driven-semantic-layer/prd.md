# 知识库驱动语义层工作流

## Goal

把 Markdown 业务资料作为独立、可治理的公司 Knowledge Base 资产，与数据库 Schema 和当前语义层共同形成证据，支持用户通过 Agent 对话、选择知识段落后交给 Agent、或直接编辑三种方式创建语义 Candidate。所有入口统一生成可追溯 ChangeSet，经过确定性校验、审核与发布后成为正式 Semantic Release，并由真实 Text2SQL 路径消费。

MVP 以 Markdown 端到端业务闭环为完成标准。PDF、Word、Excel 后续复用同一 Knowledge Revision、Evidence Locator、ChangeSet 和治理合同增加格式适配器。

## User Value

- 把散落在指标手册、制度和业务说明中的知识转化为可执行语义资产。
- 每个指标、公式、维度、术语和关系都能回答“来自哪里、为何这样定义、映射到哪些字段”。
- 用户可以自主选择最合适的创作方式，而不被迫依赖单一 Agent 对话路径。
- 模型、用户和资料变更都不能绕过 Candidate、验证、审核与发布 Authority。

## Confirmed Repository Facts

- Workspace File Authority 已存在；Markdown 已在扫描白名单中（`packages/platform/src/storage/file-scan-port.ts:3-10`）。
- Knowledge Base、Embedding Profile、Generation、Chunk、Projection Receipt、检索 Evidence 与 PostgreSQL/Neo4j 投影边界已经存在，应扩展现有链路，不创建第二套知识库。
- 当前 Knowledge Worker 只把 UTF-8 文本按 byte range 分块；尚无标题、段落、表格等可供用户选择的结构化 Markdown locator（`apps/worker/src/knowledge/knowledge-index-job.ts:48-95`）。
- 当前 `DOCUMENT_INDUCTION` 只把 Markdown 标题或 `term:` 行归纳为 `TERM`，尚未提取指标、公式、单位、粒度、时间口径、同义词、适用范围或物理映射（`packages/semantic/src/induction/processor.ts:67-92`）。
- Graph v2 已有类型化 Node/Edge authoring tools、确定性 validation、impact、clarification 和 review handoff（`packages/semantic/src/authoring/tool-catalog.ts:8-29`）。
- Graph v2 已有带 candidate、连续 working revision、before/after digest 与 patch digest 的统一 `SemanticGraphPatch` reducer，可作为三种入口共同的 ChangeSet 内核（`packages/semantic/src/graph-v2/patch-reducer.ts:239-314`）。
- `PHYSICAL_TABLE`、`PHYSICAL_COLUMN`、`CONTAINS_COLUMN` 和 `FOREIGN_KEY_TO` 已声明为 `SYSTEM_MANAGED`，现有 reducer 会拒绝直接修改。
- Semantic Studio 当前只支持“让 Agent 修改”，没有直接编辑 Agent-authored Node/Edge 的表单（`apps/web/src/components/semantic/studio/semantic-inspector.tsx:213-228`）。
- Knowledge Base 当前只在 `/settings` 中以设置面板出现，支持创建、重建和检索调试，没有独立资产列表、详情、版本、段落选择或内容维护页面。
- PostgreSQL Semantic Governance 已有 Candidate、Review、Publish 与 Rollback Authority；本任务复用现有治理链路，不创建平行审批系统。

## Product Decisions

### D1. Three User-selected Authoring Entrypoints

用户可自主选择：

1. 在对话框输入指标、公式或业务意图，由 Agent 读取 Schema/当前语义图并生成对象与关系。
2. 在独立 Knowledge Base 页面选择一个或多个 Markdown 段落，再让 Agent 基于所选证据生成对象与关系。
3. 直接新建或编辑语义对象和关系。

三种入口都只改变 Candidate，统一生成类型化 ChangeSet；任何入口都不能直接写活动语义层。

### D2. Knowledge Evidence Boundary

- 用户选中的段落是本次业务定义、指标口径、公式、粒度、单位、时间语义和业务关系主张的唯一文档证据。
- Agent 可以读取数据库 Schema 与当前语义层用于字段映射、对象复用、冲突检查和影响分析。
- 未选中的知识段落只能作为相关资料推荐；用户确认加入后才能成为本次生成证据。
- 每个材料字段区分 `SELECTED_KNOWLEDGE_EVIDENCE`、`SCHEMA_FACT`、`CURRENT_SEMANTIC_FACT` 和 `AGENT_INFERENCE`；推断不能伪装成文档事实。

### D3. Knowledge Is an Immutable Company Asset

- Knowledge Base 有独立导航、资产列表和详情页，不只作为设置项或 Agent 附件。
- 原始文件和已经被引用的解析内容不可变。
- 名称、说明、Owner、分类、标签、ACL、来源资料或内容修正通过新 Knowledge Revision 表达。
- 用户可上传新版本、替换来源，或对原段落添加带作者、原因和生效版本的纠错/补充注释；禁止原地覆盖旧证据。
- 新 Revision 不改写旧引用，页面显示旧版本仍被哪些 Candidate 或 Published Semantic 对象消费。

### D4. User-controlled Candidate Revisions

- 编辑过程不自动生成权威 Revision。
- 用户可在一次会话中累积多项未保存操作；只有点击“保存草稿”才持久化为连续、可比较、可恢复的 Candidate Revision。
- “保存草稿”和“提交审核”是两个独立动作；提交审核必须绑定并冻结一个已保存 Revision。
- 页面显示未保存状态，并在刷新、切换候选或离开页面前提示可能丢失的修改。

### D5. Editable Relationship Boundary

- 用户可创建、修改、断开、重新连接和退役所有 `AGENT_AUTHORED` 关系实例，包括业务关系、指标归属、公式依赖、维度层级、语义物理绑定、分析 Join、术语和证据关系。
- `CONTAINS_COLUMN`、`FOREIGN_KEY_TO` 等数据库快照物理事实只读。纠错通过重新扫描数据库或不篡改原始事实的覆盖/修正候选表达。
- MVP 的关系实例编辑器只能选择已注册类型，并按类型限制 source、target 与属性。
- 新关系类型必须作为独立提案，定义名称、语义、方向、允许端点、属性 Schema 与治理策略，单独验证和审核；不得在关系编辑器中临时创建无约束类型。

### D6. Self-review and Publish

- 具备相应权限的创建者可以审核并发布自己的提案，不强制职责分离。
- UI 可以提供一次“审核并发布”操作；后端必须先对 exact Candidate Revision 记录审核批准，再执行发布，两段事件独立审计。
- 自审自发不能绕过 exact Revision、确定性 validation、发布前检查或发布权限。
- 一次“审核并发布”命令以数据库事务原子执行；只有全部发布门禁成功时才同时形成审核与发布事实。失败时不得留下伪批准、部分激活 Release 或成功 UI 状态。

### D7. MVP Downstream Proof

- Text2SQL 是 MVP 唯一必选的真实下游验收。
- 必须证明 Text2SQL 显式绑定新发布的 exact Semantic Release，并基于本次知识/编辑变更生成和执行真实 SQL。
- 对话分析和图表生成后续复用同一 Published Release，不阻塞 MVP。

### D8. Knowledge Revision Impact Is Advisory

- 新 Knowledge Revision 自动计算并展示受影响的 Candidate、Published Semantic 对象和证据引用，但不自动创建或修改语义 Candidate。
- 用户查看新旧内容与 block Diff、重新选择 exact evidence 后，才可显式要求 Agent 生成更新候选。
- 已发布 Semantic Release 在替代候选完成验证、审核和发布前继续服务；知识更新本身不切换或中断 Text2SQL。

## Requirements

### R1. Markdown Knowledge Asset Workspace

- 提供独立 Knowledge Base 导航、列表页和详情页。
- 列表展示名称、状态、Owner、可见范围、来源数量、当前 Revision、最近更新时间和使用中的语义域。
- 详情展示原始 Markdown、解析后的标题/段落/表格块、稳定 locator、索引状态、版本历史、ACL、纠错注释、下游 Candidate/Release 和使用记录。
- 支持按权限创建 Knowledge Base，维护元数据、ACL、来源文件集合，创建新 Revision 并触发新 Generation。
- 支持选择一个或多个可见段落，把 exact Knowledge/Base/File/Block Revision 与 hash 带入语义生成。
- 新 Knowledge Revision 生成影响提示但不自动创建 Candidate；更新语义定义前必须由用户重新选择证据并显式发起生成。
- 上传、扫描、解析、索引或版本操作失败时展示稳定 reason code 和可恢复操作。

### R2. Evidence-backed Semantic Extraction

- Agent 从用户输入或选中 Markdown 证据提取指标、维度、业务主体、关系、公式、单位、粒度、时间口径、同义词和适用范围。
- 每个对象及材料字段携带精确 Evidence Locator、来源 hash、证据类别、置信状态和待确认项。
- 不得自动扩大用户选定的 Knowledge Evidence 集合。
- Agent 只能把提取结果作为 Candidate；不能 approve、publish、rollback 或改变权限。

### R3. Semantic Grounding

- 把提取结果与当前数据库表、字段、外键、可用 Join 证明和已有语义 Node/Edge 对齐。
- 对唯一匹配、多候选、无匹配、冲突、stale schema 分别给出明确状态与证据。
- system-managed 物理事实只能由 exact Schema Snapshot 提供，不能由文档或用户手工伪造。

### R4. Unified Candidate ChangeSet

- 对话 Agent、段落 Agent 和直接编辑器使用同一种类型化 Node/Edge operation 与 `SemanticGraphPatch`/ChangeSet。
- ChangeSet 绑定 base Release、Candidate、working revision、before/after digest、操作来源、Evidence、Diff、影响范围和操作历史。
- 三种入口的操作可在同一未提交编辑会话中组合；保存时形成一个 Candidate Revision。
- stale base、重复身份、非法端点、未读先改、CAS/digest 冲突必须失败关闭。

### R5. Direct Semantic Editor

- 支持创建/编辑/退役 `BUSINESS_SUBJECT`、`DIMENSION`、`METRIC`、`FORMULA`、`GLOSSARY_TERM` 等 Agent-authored Node。
- 支持创建/编辑/断开/重新连接/退役全部 Agent-authored Edge 实例。
- 表单根据 Node/Edge 判别类型呈现字段、端点限制、关系属性和证据绑定，不暴露任意 JSON Patch。
- system-managed Node/Edge 可选择用于绑定，但编辑控件只读。
- 直接编辑产生的公开审计来源标记为 `MANUAL`，但使用与 Agent 相同的 reducer、validator 和 governance。

### R6. Deterministic Validation

- 至少验证字段存在性、数据类型兼容、公式语法/返回类型、引用闭合、关系端点、粒度、单位、时间语义、循环依赖、映射歧义、stale base 和 system-managed mutation。
- Validation Receipt 绑定 exact Candidate Revision、Graph digest、Schema Snapshot、compiler/policy version。
- 任一阻断问题不能被模型说明文字、人工表单或自审权限覆盖，也不能进入 Published 状态。

### R7. Review, Publish and Rollback

- 用户只能提交已保存的 Candidate Revision 审核。
- 有权限的创建者可以执行“审核并发布”；后端仍记录独立 Review Decision 和 Publish Receipt。
- 发布生成不可变 Semantic Release 和 active pointer 变更；失败不留下半激活状态。
- 支持查看发布 Diff、审计与 exact Release 绑定，并按现有 Authority 回滚到先前活动版本。

### R8. Text2SQL Consumption

- Text2SQL 只能读取 Published Semantic Release，不能看到 Candidate overlay 或未保存编辑。
- MVP 至少运行一个会受本次新指标、公式或关系影响的真实问题，证明 exact Release 绑定、语义解析、SQL 生成和真实 PostgreSQL 执行。
- 运行证据至少包含 release identity/hash、semantic binding、SQL/AST hash、执行终态和结果摘要；不得以 UI 标签代替执行证明。

### R9. Auditability and Safety

- 记录文件/Knowledge Revision、解析块、Evidence Selection、Agent/Manual operations、Candidate Revision、validation、review、publish、rollback 与 Text2SQL binding。
- 对前端与审计输出进行公开事件脱敏，不暴露模型私有推理、系统提示词、凭据、raw Provider 对象、向量或未授权原文。

## Acceptance Criteria

- [ ] AC1：用户可从独立知识库页面上传 Markdown、完成扫描/解析/索引，并浏览带稳定 locator 的标题、段落和表格块。
- [ ] AC2：用户可创建新 Knowledge Revision 或纠错注释；旧证据引用不变，影响对象与版本使用情况可见；系统不自动创建 Candidate，用户重新选择证据后才能显式生成更新候选。
- [ ] AC3：用户可选择一个或多个段落，Agent 只基于选中内容提出带字段级证据的指标、公式、维度、术语和关系 Candidate。
- [ ] AC4：用户可通过纯对话 Agent、段落 Agent 和直接编辑器三种入口修改同一 Candidate，保存后形成统一 ChangeSet、Diff 和可恢复 Revision。
- [ ] AC5：用户可编辑全部 Agent-authored 关系实例；system-managed Table/Column/FK 关系只读；新关系类型只能走独立提案。
- [ ] AC6：字段缺失、公式错误、类型不兼容、粒度冲突、循环依赖、非法关系端点、无法映射、stale base 和物理事实篡改的代表用例被确定性阻断。
- [ ] AC7：用户点击“保存草稿”前不产生权威 Revision；离开未保存会话会收到提示；提交审核只接受已保存 Revision。
- [ ] AC8：具备权限的创建者可一步“审核并发布”，数据库保留两段审计记录且只在所有 Gate 成功后激活新 Release。
- [ ] AC9：发布后 Text2SQL 绑定 exact 新 Release，对至少一个受本次变更影响的问题生成并执行真实 SQL，保留可审计证据。
- [ ] AC10：可回滚到上一活动 Release，Text2SQL 后续绑定恢复到回滚后的 exact Release。

## Out of Scope

- MVP 不实现 PDF、Word、Excel 解析和证据选择。
- MVP 不要求对话分析或图表生成消费新 Release。
- 不把 Knowledge Base 扩展成通用企业文档协作、富文本共同编辑或 Office 在线编辑套件。
- 不允许 Agent 或用户修改 system-managed PhysicalTable、PhysicalColumn、`CONTAINS_COLUMN`、`FOREIGN_KEY_TO` 事实。
- 不允许 Candidate、Knowledge Projection 或 Neo4j 索引成为发布 Authority。

## Notes

- 这是复杂跨 Contracts、Worker、Platform、Web、Semantic、PostgreSQL migration 与 Text2SQL 的任务，必须有 `design.md` 与 `implement.md`。
- 当前主 checkout 有无关修改与 Falcon 产物；实现只能发生在 `codex/knowledge-driven-semantic-layer` worktree，并只暂存本任务拥有的路径。

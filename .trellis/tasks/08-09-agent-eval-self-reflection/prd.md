# 公开题库驱动的 Agent 能力评测与自反省

## Goal

为 Data Agent 增加一个独立的“能力测试”模块。用户可以浏览不同公开题库，进入题库后选择单题或批量做题，查看实时运行过程与最终成绩单；答案错误时，系统基于外部判分证据生成结构化反省，并在受限次数内重新作答，从而量化“反省是否真的提升能力”。

该模块首先服务于研发评测和回归定位，不把公开题库分数直接解释为生产可用性，也不自动用错题答案污染隐藏测试集或长期记忆。

## Background and Confirmed Facts

- 当前仓库已经有 `EvalCase`、`EvalRun`、`ScoreCard`、`OracleVerdictReceipt`、`BenchmarkManifest`、配对比较和 Holdout 污染检查等合同。
- 当前公开 Suite 名称包含 `insightbench`、`dab`、`rcaeval`、`controlled-attribution` 和 `governance`。
- 当前 Suite Adapter 仍会生成 `INCONCLUSIVE` 占位结果；`eval:smoke` 主要检查文件存在和合同完整性，不代表真实公开题库已经接通。
- 当前 Text2SQL 已具备七道 Gate、受控 PostgreSQL 执行和最多两次的确定性有界修复，但这不是基于公开题库 Oracle 的 Agent 反省闭环。
- 当前 Web 已有工作区侧栏、运行投影、SSE/重连语义和一个只读的评测摘要区，可复用其视觉语言与耐久运行机制。
- 当前产品首版能力边界是 L2 多步分析与强 Text2SQL；DS-1000 等 Python 数据科学题库属于后续 L3，不应在首版伪装为已支持。
- 本地 `penguin-harness` 已在提交 `047505dccc0cc16ad92be11011347d635f33ceb0` 核验。其 Benchmark 用 `statement/` 与私有 `rubric/` 分离题面和评分依据，并用 `Evaluation -> Case -> Run -> session_id` 记录分数、成本、耗时和可回放 Trace。
- Penguin 当前 Web/API 的 Evaluation Center 是只读浏览器：可选择 Benchmark、打开 Case、查看题面/评分材料、趋势、逐 Case/Run 分数和 Session Trace，但没有从页面启动单题、批量运行或反省的写接口。真正的执行与评分流程由 `benchmark-design`、`agent-evaluation`、`agent-optimization` Skill 约束。
- Penguin 的 Evaluator 将一个请求限制为“一个 Case 的一次 Run”，固定 Agent/Benchmark/Model/Version，在独立 Workspace 中只复制题面，并把 Agent 答错与评测基础设施失败分开；这些边界适合复用。
- Penguin 的 Scoreboard 直接信任写入的聚合分数，且优化流程在同一冻结 Case 集上反复接受/回滚 Agent State，没有独立 Tuning/Holdout 成绩。Data Agent 需要服务端确定性聚合、数据切片隔离和更强的防过拟合治理，不能照搬。

## Users and Core Flows

### F1. 浏览题库

用户进入“能力测试”，看到题库卡片及其能力类型、题量、难度、许可证、版本、下载状态、可运行状态和最近成绩。

### F2. 单题做题

用户进入题库、打开一道题，查看允许公开的题目、数据范围和评测规则，选择模型配置与预算后启动。系统保存初次回答、工具轨迹、判分结果、错误类型、反省和可选重试。

### F3. 批量做题

用户按难度、数据库、能力标签和历史结果筛选题目，勾选全部或部分题目后批量启动。批次中的每题是独立、可重放的子运行；某题失败不应吞掉其他题结果。

### F4. 查看成绩单

系统展示首答正确率、反省后正确率、错误恢复率、错误修复导致的新回归、成本、延迟、Token、失败分类以及按题库/难度/能力切片的结果，并可回到具体错题查看证据。

### F5. 错题反省

确定性 Oracle 判错后，系统仅向反省步骤提供最小必要的失败证据，不直接暴露 Holdout 标准答案。反省生成结构化诊断和下一次行动；重新作答后再次由同一版本 Oracle 判分，首答成绩与修复后成绩分开保存。

## Requirements

### R1. 独立测试模块

- 侧栏新增“能力测试”入口，建议路由为 `/tests`。
- 模块至少包含题库列表、题库详情/题目列表、单题运行、批量运行、运行详情和成绩单六类视图。
- 运行状态必须来自后端权威投影；前端不得伪造通过、反省成功或题库就绪状态。

### R2. 题库注册表

- 每个题库记录稳定 `suite_id`、版本、来源提交或数据版本、下载 URL、内容摘要、许可证、题量、能力标签、Oracle 类型和运行前置条件。
- 状态至少区分 `NOT_DOWNLOADED`、`DOWNLOADING`、`READY`、`LICENSE_BLOCKED`、`INVALID` 和 `UPDATE_AVAILABLE`。
- 题库升级必须产生新版本，历史成绩继续绑定旧版本，不进行静默替换。

### R3. 安全下载与数据管理

- 本轮规划完成后，实施阶段才允许下载题库。
- 下载器只访问允许列表来源，固定版本并校验 SHA-256、大小和许可证；压缩包必须防路径穿越。
- 大型题库数据不提交 Git，保存在独立 Benchmark 数据卷或对象存储；PostgreSQL 只保存注册表、摘要和权威运行记录。
- 外部 `validate.py`、测试代码和生成代码一律按不可信代码在无网络、只读数据、限 CPU/内存/时长/输出的 Sandbox 中执行。

### R4. 首版题库范围

- P0：BIRD Mini-Dev PostgreSQL/SQLite 小切片，用执行结果等价验证 Text2SQL 正确性。
- P0：Dr.Spider 小切片，用原题/扰动题成对结果验证鲁棒性下降和恢复。
- P0：InsightBench 小切片，用 planted insight 覆盖和报告质量验证端到端分析能力；确定性/字符串指标与 LLM Judge 分栏。
- P1：BIRD-Critic PostgreSQL Lite，用测试用例验证 SQL 诊断和修复。
- P1：DAB 小切片；只有确认可用许可证和再分发边界后才允许下载与展示为 `READY`。
- P2：Spider 2.0、DS-1000、DRBench；分别受外部数据源/方言成本、L3 Python 能力和深度研究能力约束。

### R5. 单题与批量运行

- 单题与批量必须走同一耐久运行协议；单题是大小为 1 的批次，而不是另一套临时逻辑。
- 批量运行冻结题目版本、数据快照、模型配置、Prompt/Workflow/Evaluator 版本、随机种子、预算和并发度。
- 支持取消、断线重连和历史重放；已提交的题目结果不得因 Worker 重启重复执行或重复计费。

### R6. Oracle 与判分

- 优先顺序固定为：确定性执行/测试用例 → 结构与安全 Gate → 规则指标 → LLM Judge 诊断。
- LLM Judge 不能覆盖确定性失败，也不能单独把题目标为正式 `PASS`。
- 结果集比较需要处理顺序、数值容差、NULL、重复行和多种等价 SQL；Oracle 版本必须入成绩单。
- 题库坏题、环境失败和 Agent 答错必须分开，不得把基础设施失败计为能力错误。

### R7. 验证器引导的自反省

- 自反省不是无证据地要求模型“再想想”，必须由 Oracle/Gate/Sandbox 反馈触发。
- 每次反省记录 `failure_type`、失败证据引用、可修改范围、不可改变的不变量、修复计划、置信度和结果。
- 首版建议每题最多一次反省重试；现有 Text2SQL 编译器内部确定性修复仍保持独立预算。
- 不保存或展示私有 Chain-of-Thought；只保存可审计的结构化诊断、工具结果和行动摘要。
- 反省结果不得自动写入全局 Prompt、Skill 或长期记忆；跨题学习必须经过 Tuning 切片验证、Holdout 复测和人工发布。

### R8. 成绩单

- 不能只显示一个总分。
- 至少展示 First-pass Pass Rate、Post-reflection Pass Rate、Recovery Rate、False-fix/Regression Rate、有效样本数、成本、延迟、Token、超时/拒答和失败分类。
- 参考 Penguin 为每个 Case Run 保留 `score(0..100)`、成本、耗时和 Trace 引用；同时保留 Suite 原生指标与确定性 PASS/FAIL，不能用归一化分数覆盖 Oracle Verdict。
- 支持按题库、能力标签、难度、数据库、模型配置和运行日期切片。
- 每个汇总指标可下钻到题目、Attempt、Oracle Receipt、Reflection Receipt 和工具/执行证据。
- 不把不同题库的 0–100 分直接求一个无解释的总平均；跨题库总览以分题库指标、宏平均和样本覆盖率并列展示。

### R9. 数据污染与公平比较

- Demo、Tuning、Holdout 三类题目必须分离；标准答案和验证器不得进入 Agent 可见上下文。
- Baseline 与启用反省的 Candidate 必须在同一题目、数据版本、模型配置和预算上成对比较。
- 修复后通过不能改写首答失败；排行榜需同时显示无反省和有反省结果。
- 题库版本、Prompt 或模型变化后重新生成新成绩单，不覆盖旧结果。

### R10. Penguin Harness 参考边界

- 采用其 `Case × Run` 最小执行单元、题面/私有评分材料隔离、显式 Runtime/Agent Version、独立 Workspace、错误与基础设施失败分离、Run 到 Session/Trace 的可追溯关系。
- 题目页借鉴其“材料浏览 + 成绩逐层下钻”交互，但首版默认只展示题面与允许公开材料；Rubric、Gold、隐藏测试和 Oracle 细节需要单独权限，不能因为是项目成员就默认可见。
- 不采用由模型写入且服务端不重算的聚合分数。Data Agent 的 Case、Batch 和 ScoreCard 指标必须由版本化 Aggregator 从不可变 Attempt/Verdict Receipt 确定性生成。
- 不把 Penguin 的“修改 Agent State 后在同一 Benchmark 上严格涨分即接受”直接用于自动优化。单题反省只能产生当前题的新 Attempt；跨题 Prompt/Skill/Memory 优化必须使用独立 Tuning/Holdout、版本快照和人工发布。
- Penguin 只作为参考实现，不成为 Data Agent 的存储格式、运行时依赖或题库许可证依据。

### R11. 环境系统模型、七题库扩展与 80% Holdout 目标

- Web 启动时从仓库根 `.env` 的 `DeepSeekAPIKey`、`KimiAPIKey` 发现凭证，幂等生成
  DeepSeek/Kimi 系统模型 Profile；凭证只保留在服务端，公开 API 只能返回脱敏状态。
- 环境 Profile 使用稳定 Provider/Profile/Model 身份，并标记为 `isSystemDefault`；用户不能通过
  Model Settings 修改或删除，变更只能通过 `.env` 与重启完成。
- Test Center 默认使用具备可验证 USD 预算约束的环境模型；正式运行必须冻结 Provider、Model、
  Profile Version、Prompt、Budget 和数据摘要。生产环境仍要求持久化 Certification Receipt，开发
  环境的会话级真实探测不能被解释为生产认证。
- 继续接通 Dr.Spider、BIRD-Critic、DAB、BLADE、DataSciBench、ScienceAgentBench 和
  SpreadsheetBench 2。每个题库必须有独立的 Source Snapshot、License Gate、Public/Sealed
  Case、Adapter、Oracle、Import Receipt 和失败分类。
- 上游许可不允许再分发或数据需要人工授权时，仓库只实现固定摘要的手动导入入口；没有合法数据
  Snapshot 时保持 `LICENSE_BLOCKED`/`ACCESS_GATED`，不能为了完成数量目标伪造 `READY`。
- 使用 DeepSeek 或 Kimi 完成可运行题目的首答与一次 Oracle 引导反省。错误归因至少区分模型输出、
  Prompt/Workflow、工具/执行、Oracle/数据、Context/预算和基础设施。
- Agent 优化只能消费 Tuning 切片的公开题面、裁剪反馈和运行轨迹；Holdout Gold、Rubric 与隐藏
  Validator 不进入模型、Prompt、Skill 或优化上下文。
- 80% 目标定义为：每个已接通且至少包含 5 个有效 Holdout Case 的题库，冻结 Candidate 在未参与
  优化的 Holdout 上 `Post-reflection Pass Rate >= 0.80`，同时报告 First-pass、Recovery、Regression、
  成本与有效样本数。未达到或有效样本不足必须如实 `HOLD`，不同题库不能用一个混合平均掩盖失败。

## Out of Scope for MVP

- 自动微调模型权重、自动修改生产 Prompt/Skill 或无审核写入长期记忆。
- 把公开 Benchmark 分数直接作为生产上线证明。
- 下载或提交缺少再分发许可的全量题库数据；此类题库只允许用户授权后的本地手动导入。
- 为追求 80% 而读取 Holdout Gold、修改 Oracle、删除失败样本或把基础设施错误计为通过。
- 自动发布跨题 Prompt/Skill/Memory 优化；Candidate 达标后仍需人工接受。
- 公开展示 Holdout 标准答案、验证器秘密或模型私有推理过程。

## Acceptance Criteria

- [x] `/tests` 能展示至少三个题库卡片及真实版本、许可证、下载/可运行状态。
- [ ] 用户能进入题库、分页/筛选题目，并启动单题运行。（进入与单题已完成；分页/筛选待完成）
- [ ] 用户能勾选多题启动批量运行，取消后保留已完成题目结果。（批量已完成；取消待完成）
- [x] BIRD Mini-Dev 小切片至少有一个真实可执行 Oracle，正确与错误答案得到不同确定性 Verdict。
- [ ] Dr.Spider 成绩单能分别显示原题准确率、扰动题准确率和鲁棒性下降。
- [ ] InsightBench 的规则指标与 LLM Judge 结果分栏，Judge 不能覆盖确定性失败。
- [x] 错题会生成结构化 Reflection Receipt，并在限制内触发一次新 Attempt。
- [x] 首答与反省后答案分别保存，成绩单同时报告 First-pass、Post-reflection、Recovery 和 Regression。
- [x] 批量中单题超时、题库坏题、环境失败和 Agent 答错均有不同失败代码。
- [ ] 刷新或断线后能通过持久化事件恢复单题/批量进度，不模拟步骤。
- [x] 数据包绑定来源、版本、SHA-256 和许可证；摘要或许可证不合格时题库不能进入 `READY`。
- [ ] 外部验证器在无网络、受限资源 Sandbox 中运行，不能写入数据卷或工作区。
- [x] Demo/Tuning/Holdout 隔离测试证明标准答案不会进入 Agent 输入和反省上下文。
- [ ] Baseline 与 Reflection Candidate 可在同一冻结 Manifest 上成对重放。
- [x] 当前占位 Adapter 不再能因“文件存在”被误判为真实题库通过。
- [x] 每个 Case Run 都绑定明确的题库/数据/Agent/模型/Prompt/Evaluator 版本和可回放 Run/Trace 引用；运行中任一冻结项变化时不得产出正式分数。
- [x] 成绩单聚合可从 Attempt 与 Verdict Receipt 重建，篡改或不一致的客户端/模型聚合值不会被接受。
- [x] Holdout 的 Rubric、Gold 和隐藏 Oracle 不通过普通题目详情 API 返回，且反省流程无法读取。
- [x] `.env` 中存在 DeepSeek/Kimi Key 时生成稳定、脱敏且不可修改/删除的系统 Model Profile；缺失
  Key 时不生成空 Profile，日志和 API 不出现明文 Credential。
- [x] Dr.Spider、BIRD-Critic、DAB、BLADE、DataSciBench、ScienceAgentBench、SpreadsheetBench 2
  均具有真实 License/Access Gate、固定来源、Import Receipt 和 Adapter 状态；合法数据未就绪时失败关闭。
- [x] 至少一个环境系统模型完成真实 Provider 调用并在 Frozen Manifest 中留下 Provider/Model/预算证据。
- [ ] 每个可运行题库保存 Baseline、Tuning Candidate 和未参与优化的 Holdout 成绩；错题有类型化归因。
- [ ] 每个有效 Holdout 样本数不少于 5 的已接通题库达到 Post-reflection Pass Rate 80%，否则发布结论为 HOLD。

## 2026-08-10 Implementation Evidence

- DeepSeek 与 Kimi Credential Certification 均为 PASS；正式 Test Center 使用具备已验证 USD 定价与
  Context Window 的 DeepSeek Profile。
- InsightBench 5 题：Run `47bf5b05-bedb-4f39-b062-4c03b8a47f6d`，首答 80%，终答 100%。
- BIRD Mini-Dev 10 题：Run `57dae037-0a07-4795-990a-ea34655fdfca`，首答/终答 80%。
- BLADE 独立 5 题 Holdout：Run `f4e5c4af-cc01-49ff-a3b7-da126eec04ac`，首答/终答 80%。
- Dr.Spider 的 v5 独立 `dog_kennels_0` Holdout：修复超长 Reflection 的结构化输出失败后，以
  Prompt `dr-spider-sql-agent@1.3.0` 重跑 Run `2ef9d9e3-a9c4-4f84-b698-a8d1b7e6eb91`；5/5
  有效、0 个基础设施失败，但首答/终答仍为 0%。该 Suite 明确保持 `HOLD`；未读取 Gold 继续调
  Prompt，也不以其他 Suite 的 80% 掩盖失败。

## Open Product Decision

- 第一版的“自反省”是否只做单题内、Oracle 引导、最多一次的有界重试，并把跨题长期学习留到后续受治理发布流程。

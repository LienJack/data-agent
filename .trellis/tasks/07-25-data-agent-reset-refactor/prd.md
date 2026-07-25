# Data Agent 彻底重置重构规划

## 目标

以空仓库为起点，设计一个能够替代现有 `text2sql` 项目的新 Data Agent。新系统不再停留在受治理的数据问答，而是沿可验证的能力阶梯，逐步交付多步研究分析、可执行数据科学、主动分析观察与因果决策；同时降低多模型接入、评测迭代和部署运维成本。

## 背景与已确认事实

- 当前仓库是彻底重置后的绿地仓库，实时 Git HEAD 为初始提交，除 `LICENSE` 和本轮初始化的规划基础设施外没有产品代码。
- 旧 `text2sql` 项目及 `research/data-agent-system-design` 是迁移输入和设计证据，不是要直接复制的实现模板。
- 指定研究课题已经覆盖 Text2SQL Artifact 链、L2–L6 能力阶梯、L3 实验 DAG、L4 主动发现、L5 因果识别和分层评测；本轮需要把这些结论收敛为新仓库可执行的架构与路线图。
- 用户已于 2026-07-25 选择执行方案 2，并明确批准按主计划进入 `/goal` 实施；产品实现以主计划 U1–U9、验证契约和完成定义为权威。

## 需求

### R1. 绿地重置

- 新系统按绿地架构规划，不承担旧 LangGraph 图结构或旧目录组织的兼容义务。
- 旧项目仅用于提取可复用的领域语义、SQL 校验、测试夹具和迁移边界。

### R2. Agent 运行时与模型生态

- Agent 内核以 Mastra 类型的现代 Agent Framework 为中心，支持动态 Agent、Workflow、Tool、Memory、Eval 与多 Agent Team。
- 通过显式 Provider/Model Capability Contract 接入 OpenAI、Anthropic/Claude、DeepSeek、GLM、Kimi、Grok、Gemini 等模型。
- 将“模型提供方接入”和“Claude Code 等外部编码 Agent 作为受控执行者接入”分开设计，避免把 CLI Agent 误当成普通推理模型。

### R3. 能力阶梯

- 产品能力覆盖多步研究分析师、可执行数据科学家、主动分析观察者和因果决策科学家。
- 每一级必须有独立 Artifact、状态、权限边界、失败终态、Oracle 和 Release Gate，不能只靠增加 Prompt 或 Agent 数量宣称升级。
- 首个可发布版本采用纵向切片：交付 L2 多步研究分析师、强 Text2SQL 和评测闭环；L3–L5 只交付稳定扩展合同与后续路线，不进入首版实现范围。

### R4. Text2SQL 质量

- Text2SQL 从“多步骤生成 SQL”重构为业务语义与数据语义共同约束的查询编译链。
- 正确性覆盖意图、语义、结构、权限、资源、执行和结果，不以“可解析、可执行、非空”作为成功判据。
- 测试驱动的迭代必须能够定位失败发生在问题理解、Grounding、规划、生成、验证、执行或结果解释中的哪一层。

### R5. 部署与租户隔离

- 支持 Vercel 前端、Supabase 数据库、Upstash Redis 的托管部署组合。
- 支持一条命令启动的 Docker 自托管部署。
- 多个个人项目可共享一个 Supabase Project，但必须通过应用级命名空间、数据库 Schema、RLS、存储路径、迁移账本和密钥边界防止项目之间的数据或迁移串扰。

### R6. 将评测作为产品能力

- 设计统一 Benchmark Adapter，能够接入 InsightBench、DAB、RCAEval 和自建可控归因数据集。
- 评测题目既能用于开发期回归、成对基线与 Release Gate，也能以经过许可和脱敏的演示题集进入产品体验。
- 题目、参考答案、评分器、数据快照、运行轨迹和模型/Prompt/语义版本必须可追踪，不能只保存一个总分。

### R7. 调研来源与可追溯性

- 本轮新增调研全部写入 `research/data-agent-system-design`，使用 `research-to-article` 的 Question、ResearchRun、Evidence、Claim、Reflection 和 Answer Runtime 约束。
- 复用已有结论时必须重新检查其适用范围和时效；目标设计、合成验证、源码审计和真实生产证据必须明确分层。

### R8. 规划流程

- 使用 Compound Engineering 形成统一的实施级技术计划和文档审查门禁。
- 使用 Trellis 保存 `prd.md`、`design.md`、`implement.md`、研究索引和后续任务状态。
- 规划阶段不得运行 `task.py start`；用户明确批准后，必须先通过计划审查与 Trellis 清单验证，再进入产品代码实现。本任务已完成该批准门。

## 验收标准

- [x] 指定研究课题中存在一条可恢复的本轮 ResearchRun，覆盖 Agent/Provider、Text2SQL、能力阶梯、部署/共享 Supabase 和 Benchmark 接入。
- [x] 关键外部事实来自当前的一手文档、论文/Benchmark 仓库或固定提交源码，并建立 Claim–Evidence 映射。
- [x] `prd.md` 明确产品目标、范围、非目标、可观察验收条件和已解决的产品决策。
- [x] `design.md` 明确架构边界、Artifact/状态流、共享 Supabase 隔离、评测接口、部署拓扑、迁移与回滚策略。
- [x] `implement.md` 给出依赖有序的实施阶段、验证命令、风险点、回滚点和每阶段 Release Gate。
- [x] Compound Engineering 计划包含需求追踪、稳定 U-ID、具体测试文件路径和可判定测试场景。
- [x] 主计划、Trellis PRD、架构设计与实施路线以中文为主，只保留必要的技术标识、命令和标准英文术语。
- [x] 计划经过置信度检查和文档审查；用户已明确批准实施，Trellis 任务状态已切换为 `in_progress`。

## 规划产物不包含的范围

- 规划阶段本身不实现产品代码、不迁移生产数据、不部署云资源；获批后的实施范围由主计划 U1–U9 单独约束。
- 不把 L6 受控数据操作员或自动写入生产系统作为首个版本的默认能力；其接口边界可预留，但需要独立的安全计划。
- 不承诺未经 Benchmark 实测的准确率、成本、时延或业务收益。
- 不生成正式研究文章或 HTML；本轮交付研究答案和工程规划产物。

## 关键产品决策

- 首版采用“L2 多步研究分析师 + 强 Text2SQL + 评测闭环”的纵向切片，并为 L3–L5 预留 Artifact、状态和能力接口；该选择优先于首版同时交付 L2–L5，以便更快形成可演示、可量化、可迭代的完整闭环。

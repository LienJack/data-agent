# 公开题库调研：Data Agent 测试与自反省

调研日期：2026-08-09（Asia/Shanghai）

## 结论

最适合当前仓库的首版组合是：

1. BIRD Mini-Dev：验证 PostgreSQL/SQLite Text2SQL 执行正确性。
2. Dr.Spider：验证数据库、自然语言问题和 SQL 扰动下的鲁棒性。
3. InsightBench：验证从数据到洞察和报告的端到端能力。

BIRD-Critic 很适合后续验证“根据失败证据修 SQL”，但完整真值/测试用例需要按官方流程获取。DAB 与本项目目标最贴近，但当前仓库没有看到明确许可证文件，且完整数据和环境较重，不应在许可证审查前自动下载或再分发。

## 候选矩阵

| 题库 | 当前公开内容 | 判分方式 | 许可证/边界 | 与当前能力匹配 | 建议 |
| --- | --- | --- | --- | --- | --- |
| BIRD Mini-Dev | 500 个 Text2SQL 对，11 个数据库，SQLite/MySQL/PostgreSQL 版本 | Execution Accuracy、R-VES、Soft F1 | BIRD 数据声明 CC BY-SA 4.0 | 强 Text2SQL、PostgreSQL Sandbox | P0；先取 30–50 题固定 Smoke Slice |
| Dr.Spider | 17 个扰动测试集，基于 Spider dev | 原题/扰动题成对执行正确率与鲁棒性下降 | 代码 Apache-2.0，数据修改 CC BY 4.0；官方感谢 Spider 允许再分发 | Text2SQL Gate、Grounding 和鲁棒性 | P0；先取每类 2 个配对 Case |
| InsightBench | 100 个业务分析数据集及 planted insights/ground-truth notebooks | Insight 覆盖、摘要指标、LLaMA-3-Eval/G-EVAL | 代码仓库 MIT；Hugging Face 数据卡为 CC-BY-4.0 | L2 多步分析和报告 | P0；已接 5 题固定切片，Judge 仅作诊断 |
| BIRD-Critic 1.0 | 200 PG Lite、530 PG、570 多方言 Open；公开题目，完整真值可按官方邮件流程获取 | Soft EX、Parsing、测试用例、QEP | 数据 CC BY-SA 4.0，代码仓库 MIT | SQL 故障诊断与修复 | P1；非常适合验证器引导反省 |
| DAB | 12 数据集、54 题、9 领域、PostgreSQL/SQLite/DuckDB/MongoDB；每题 ground truth 和 `validate.py` | 单题确定性验证、Pass@1，多次试验 | 当前仓库根目录未观察到 LICENSE；PATENTS 另有约 5GB 文件 | 最贴近真实 Data Agent 跨库任务 | P1；许可证确认后做 5–10 题 Pilot |
| Spider 2.0 | Snow/Lite 各 547 题，DBT 68 题；部分 Gold SQL/Oracle Tables | 执行结果和官方提交 | 仓库 MIT；完整数据涉及 Snowflake/BigQuery 账号和动态更新 | 企业级复杂 Schema/Agent Workflow | P2；成本和可重放性更复杂 |
| DS-1000 | 1000 个 Pandas/Numpy/Sklearn 等代码题；压缩后约 3.4MB | 每题 `test_execution` + `test_string` | CC BY-SA 4.0 | L3 Python 数据科学 Agent | P2；当前 L3 未交付，不进 MVP |
| DRBench | 企业多源深度研究任务、模拟邮件/文档/聊天/网页环境 | Insight recall 和引用质量 | 仓库 Apache-2.0；数据在 HuggingFace | 后续 Deep Research Agent | P2；待研究工具链完整后接入 |
| BLADE | 12 个数据集/研究问题，500+ 专家分析决策 | 概念变量、数据变换、统计模型自动匹配 | 代码 Apache-2.0，数据 ODC-By-1.0 | L3 统计分析决策 | P1；许可证清晰，作为下一候选 |
| DataSciBench | 数据科学代码、建模、报告与 BigCodeBench 子任务 | 任务函数、产物和 Ground Truth 评测 | 仓库未提供常规 LICENSE 文件 | L3 数据科学 Agent | P2；许可证闭合前不自动导入 |
| ScienceAgentBench | 102 个任务，来自 44 篇同行评审论文 | 自包含 Python 产物与自动指标 | 代码 MIT；多数任务 CC-BY-4.0，部分沿用上游例外许可 | 科学数据分析 Agent | P2；数据需人工获取并逐项核验 |
| SpreadsheetBench 2 | 调试、财务建模、模板、可视化四类端到端工作流 | LibreOffice 刷新后规则评测；可视化使用 VLM checklist | 仓库未提供常规 LICENSE 文件 | 业务表格 Agent | P2；许可证及 Windows 可视化环境闭合后接入 |

## 为什么优先 BIRD Mini-Dev，而不是 DAB 全量

- BIRD Mini-Dev 有明确许可证、500 题、PostgreSQL 版本和成熟执行评测，能最快把当前占位 Adapter 变成真实 Oracle。
- DAB 更贴近最终产品，但需要 PostgreSQL、MongoDB、SQLite、DuckDB、Git LFS 和大文件；环境问题会干扰对 Agent 能力的判断。
- DAB 当前公开仓库没有展示 LICENSE 文件。公开可访问不等于允许复制、修改和再分发，因此必须先完成许可证 Gate。

## 自反省方法结论

- 纯粹让模型“检查一下自己的答案”不可靠。ICLR 2024 的研究表明，无外部反馈的内在自纠错常无效，甚至可能降低表现。
- Reflexion 说明语言化反馈和跨尝试记忆可以提升 Agent，但反馈信号可以来自外部环境。
- CRITIC 强调通过工具验证后再修正；这与 SQL 执行、测试用例、Gate Receipt 最匹配。
- 因此本项目应实现“Verifier-guided Reflection”，而不是暴露答案或无限重试。

## 推荐的反省实验

每个 Case 固定两种运行方式：

- Baseline：只允许首答，不启用反省。
- Candidate：同一首答能力，在确定性 Verdict 失败后允许一次结构化反省和一次重试。

同时报告：

- First-pass Pass Rate；
- Post-reflection Pass Rate；
- Recovery Rate：首答失败、重试成功的比例；
- False-fix Rate：首答本可接受或局部正确，反省后变差的比例；
- Cost per Verified Pass；
- P50/P95 延迟和 Token；
- 按 `GROUNDING_ERROR`、`SEMANTIC_MISMATCH`、`SQL_EXECUTION`、`ORACLE_MISMATCH`、`TIMEOUT` 等分类的恢复率。

## 一手来源

- BIRD Mini-Dev：https://github.com/bird-bench/mini_dev
- BIRD 官网与数据许可证：https://bird-bench.github.io/
- Dr.Spider：https://github.com/awslabs/diagnostic-robustness-text-to-sql
- InsightBench：https://github.com/ServiceNow/insight-bench
- InsightBench 论文页：https://www.servicenow.com/research/publication/gaurav-sahu-insi-iclr2025.html
- BIRD-Critic：https://github.com/bird-bench/BIRD-CRITIC-1
- Data Agent Benchmark：https://github.com/ucbepic/DataAgentBench
- Spider 2.0：https://github.com/xlang-ai/Spider2
- DS-1000：https://github.com/xlang-ai/DS-1000
- DRBench：https://github.com/ServiceNow/drbench
- BLADE：https://github.com/behavioral-data/BLADE
- DataSciBench：https://github.com/THUDM/DataSciBench
- ScienceAgentBench：https://github.com/OSU-NLP-Group/ScienceAgentBench
- SpreadsheetBench 2：https://github.com/RUCKBReasoning/SpreadsheetBench-2
- Reflexion：https://arxiv.org/abs/2303.11366
- CRITIC：https://arxiv.org/abs/2305.11738
- Self-correction limitation：https://openreview.net/forum?id=IkmD3fKBPQ

## 当前仓库核验

- `packages/contracts/src/evals/schemas.ts` 已有题库、Oracle、ScoreCard 和失败分类合同。
- `packages/contracts/src/evals/manifest.ts` 已有 Dataset/Manifest/Demo-Holdout 版本信息，但内建零售数据仍主要是声明式 Fixture，不是已下载真实数据集。
- `packages/evals/src/*-adapter.ts` 当前构造 `INCONCLUSIVE` 和零摘要占位对象，没有运行公开题库。
- `scripts/eval-smoke.ts` 主要以文件是否存在推断“已实现”，需要改为执行真实固定 Case 并验证 Verdict。
- `apps/web/src/components/workbench/eval-section.tsx` 只展示当前 Run 的简化评测结果，不具备题库目录、题目选择、批量运行或成绩单。
- `apps/worker/src/runs/` 和 Web 的 Run Projection/SSE 可作为单题与批量运行的耐久执行底座。
- `packages/text2sql/src/repair/` 的有界修复只允许保持 Query Contract 的确定性实现修复；Agent 反省应作为独立 Attempt，不得绕过该不变量。

## 本地 Penguin Harness 参考核验

核验对象：`/Users/lienli/Documents/GitHub/agent-ref/penguin-harness`，分支 `main`，提交 `047505dccc0cc16ad92be11011347d635f33ceb0`。仓库只有未跟踪的 `.understand-anything/` 生成图谱，本次仅将其用于文件导航，未修改、暂存或提交该参考仓库。

### 已由当前源码证明的能力

- Case 目录固定拆成 `statement/` 和 `rubric/`；Evaluator 创建唯一 Workspace，只复制 `statement/`，目标 Agent 不能接触 Rubric、Gold、评分规则或 Evaluator 推理。
- `agent-evaluation` 的协议一次只运行一个 Case/Run，显式绑定 `expected_version`、`test_agent_id`、`benchmark_id`、Provider 和 Model；完成后检查 Agent State、Thinking Level、题面和 Rubric 均未变化。
- 错答、缺文件和格式错误属于有效的被测行为，可以得到 0–100 分；启动失败、Trace 绑定失败、评分器失败使用独立 Failure Code，不能伪装成 0 分。
- 每次 Run 记录 Score、Cost、Duration 和 `session_id`；Evaluation 聚合到 Case 和 Agent Version，并可从页面深链到 Session Trace。
- Benchmark 设计先用一 Run/Case Pilot 校准并冻结 Formal Baseline；优化阶段按 Case × Runs 独立调度，Candidate 只有严格高于 Reference 才保留，否则回滚 Agent State 快照。
- Web Evaluation Center 已有 Benchmark 选择、Case 列表、材料预览、Score 趋势、Evaluation/Case/Run 分层展开和 Trace 深链；路径、软链接逃逸、超大预览和权限边界有服务端测试。

### 当前实现边界

- `BenchmarkService` 和 HTTP Routes 只有 GET 读取能力；页面不能启动单题、选择多题批量运行、取消、展示实时步骤或触发错题反省。
- 服务端明确把 `scoreboard.yaml` 中由模型写入的 Case/Evaluation 聚合值视为权威，不从原始 Runs 重算；这不满足 Data Agent 的权威性与防篡改要求。
- 项目成员可以从 Web/API 打开 Rubric，只有目标 Agent 被隔离。Data Agent 的 Holdout 需要更严格的角色与 API 级隐藏。
- 自演进示例会根据失败样本/通过样本直接改写自己的 `AGENTS.md`，再用同一任务重测；正式 Optimization Skill 虽有版本快照与回滚，但仍缺独立 Holdout Gate，存在针对固定 Case 集过拟合的风险。
- 当前 Checkout 未安装 `node_modules`，因此本轮没有安装依赖或运行 Penguin 测试；上述结论来自固定 HEAD 的源码、测试和变更记录核验，不把生成知识图谱当作运行证明。

### 对 Data Agent 的取舍

| 处理 | 模式 | 原因 |
| --- | --- | --- |
| 采用 | 一个 Case × Run 一个隔离执行单元 | 便于并行、重放、失败隔离和精确计费 |
| 采用 | Public Statement / Private Oracle Bundle | 防止 Gold 和评分标准泄漏给被测 Agent |
| 采用 | 显式冻结版本、独立 Workspace、前后摘要校验 | 保证同一批成绩可比较 |
| 采用 | 错答与评测失败分开、Run 绑定 Trace | 成绩真实且可审计 |
| 借鉴后增强 | Evaluation -> Case -> Run 下钻 UI | 增加题库卡、单题/批量启动、实时 Attempt、Reflection 和多维成绩单 |
| 替换 | 模型写入聚合值 | 改为服务端从不可变 Receipt 确定性聚合并可重建 |
| 替换 | 同题集涨分即持久化 Agent 改动 | 改为题内一次反省；跨题改进必须走 Tuning/Holdout 与人工发布 |
| 不引入 | Penguin 文件格式与运行时 | Data Agent 继续使用现有 Contracts、PostgreSQL Authority、Worker 和 SSE |

评价字段可参考 Penguin 的 `score(0..100) + cost + duration + session/trace`，但只把它作为每个 Run 的统一展示壳。Data Agent 仍应保留题库原生指标和确定性 Verdict：SQL 执行正确性不能被 LLM 部分分补偿，基础设施失败不能记 0 分，不同题库也不能直接求一个看似精确但语义不一致的总平均。

### 参考文件

- `packages/skills/skills/benchmark-design/SKILL.md`
- `packages/skills/skills/agent-evaluation/SKILL.md`
- `packages/skills/skills/agent-optimization/SKILL.md`
- `packages/server/src/services/benchmark-service.ts`
- `packages/server/src/http/routes/benchmarks.ts`
- `packages/server/test/benchmarks.test.ts`
- `packages/web/src/features/benchmark/benchmark-page.tsx`
- `packages/web/src/features/benchmark/benchmark-case-browser.tsx`
- `examples/self-improving-agent/self-improve.ts`
- `examples/self-improving-agent/self-evolve.ts`
- `examples/self-improving-agent/self-evolve-recursive.ts`

# 能力测试（Test Center）

Falcon 28 库内置 Demo、固定 seed、工作空间绑定、本体候选、批量运行与 TEST submission 的完整
操作见 [Falcon 运行手册](./runbooks/falcon-demo.md)。

能力测试模块提供公开题库目录、公开题面浏览、单题/批量执行、确定性判分和不可变成绩单。
当前可运行切片包括 BIRD Mini-Dev `superhero` SQLite 10 题、InsightBench 业务分析 5 题、
Dr.Spider 跨数据库 DB-content 扰动 10 题，以及 BLADE 跨数据集 MCQ 10 题。BIRD-Critic、
DAB、DataSciBench、ScienceAgentBench 和 SpreadsheetBench 2 已固定真实来源与 Gate，但在缺少
真值授权、许可证、完整任务包或执行 Sandbox 时不会伪装为可运行。

## 数据安装

数据不写入 Git 工作区。默认目录为：

- macOS：`~/Library/Application Support/data-agent/benchmarks`
- Linux：`${XDG_DATA_HOME:-~/.local/share}/data-agent/benchmarks`
- 自定义：设置 `DATA_AGENT_BENCHMARK_ROOT`

安装器要求官方压缩包的固定字节数和 SHA-256 完全一致，并且只解出允许列表中的 BIRD
文件。已下载官方压缩包后运行：

```bash
pnpm benchmark:install bird-mini-dev "/absolute/path/to/bird-mini-dev-v1.zip"
pnpm benchmark:install insightbench
pnpm benchmark:install dr-spider
pnpm benchmark:install blade
pnpm benchmark:status
pnpm benchmark:smoke
pnpm benchmark:smoke insightbench
```

`benchmark:smoke` 会在真实 SQLite 快照上执行一个应通过答案和一个应失败答案；只有收到
`PASS`/`FAIL` 的预期组合才返回成功。

InsightBench 安装器直接从官方 Hugging Face 数据集的冻结 commit 下载 5 组 JSON/CSV，逐文件
核验固定字节数和 SHA-256，再将 CSV/公开题面与参考洞察写入不同目录。公开 Case API 只能读取
CSV 元数据和题目；密封参考洞察仅供 Oracle 使用。

Dr.Spider 安装器固定上游提交、168 MB 归档、两个 SQLite 快照和 10 条 Gold。安装发布前会使用
与正式 Oracle 相同的 Node SQLite 引擎逐条执行 Gold，并显式启用上游依赖的历史双引号字符串
兼容；Tuning 与 Holdout 使用不同数据库。BLADE 安装器固定 15.98 MB GitHub 归档，从 10 个不同
数据集各选择一条官方 MCQ；公开 API 只返回研究上下文与选项，正确选项保存在服务端封存文件。

## 数据库迁移

成绩单由迁移
`infra/supabase/apps/data-agent/migrations/20260725010585_app_data_agent_benchmark_test_center.sql`
创建的 append-only 表保存。迁移必须以 `ON_ERROR_STOP=1` 执行。

回滚时应先关闭 `/tests` 写入口并保留成绩导出，然后由数据库管理员显式删除
`app_data_agent.benchmark_eval_runs` 及对应 ledger 记录。生产环境不应静默覆盖或删除既有成绩。

## Web 配置

Web 运行时需要以下服务端变量：

```text
DATABASE_URL
TEST_CENTER_TENANT_ID
TEST_CENTER_PRINCIPAL_ID
TEST_CENTER_ENVIRONMENT
```

Tenant/Principal/Environment 都由服务端配置，不接受浏览器覆盖。开发模式提供固定本地 Scope；
生产模式缺少任一配置时失败关闭。

认证分析、SQL 和选择题模型 Agent 还需要服务端冻结以下配置：

```text
TEST_CENTER_MODEL_PROVIDER
DATA_AGENT_MODEL_PROVIDER_OVERRIDES
<所选 Provider Binding 固定的 Credential 环境变量>
```

`DATA_AGENT_MODEL_PROVIDER_OVERRIDES` 必须固定精确 `model_id`，并提供已验证的 Context Window 与
USD 定价约束。Worker 的显式 Credential Smoke 必须先把匹配当前 Profile Hash 的
`ModelCertificationReceipt` 提交到 PostgreSQL；Web 会从持久化 Authority 重新解析并授权
`AVAILABLE` Profile。配置、Receipt、Profile Version、Model ID、约束 Hash 或 Credential 任一不匹配，
认证模型 Agent 都会显示为“未就绪”，且不会发起外部调用。测试模块不会读取易失的 `/api/models`
内存配置或其中的原始 API Key。

入口：`/tests`

API：

- `GET /api/tests/suites`
- `GET /api/tests/suites/:suiteId/cases`
- `GET /api/tests/suites/:suiteId/agents`
- `POST /api/tests/suites/:suiteId/install`（当前允许 `insightbench`、`dr-spider`、`blade`）
- `POST /api/tests/runs`（必须提供 UUID `Idempotency-Key`）
- `GET /api/tests/runs/:runId`

公开 Case API 不包含 Gold SQL、Gold 结果、密封 Case Hash 或数据库文件路径。成绩由服务端根据
Attempt 原子结果聚合，客户端不能上传聚合分数。

## 当前边界

- 批量执行当前为同步 MVP；异步 Queue、SSE Replay 和取消尚未接入。
- InsightBench 同时提供确定性剖析基线和认证模型 Agent。认证模型入口只接受 PostgreSQL Receipt
  重验后的 `AVAILABLE` Profile，并通过项目 `ModelProviderPort` 调用固定 Provider/Model；未完成认证
  时保持不可点击。DeepSeek 实测 5 题首答 80%、反省后 100%。
- InsightBench 的 `insightbench-lexical-grounding@1.0.0` 是本产品冻结的 Smoke Oracle，不等同于
  官方排行榜分数；规则指标是判分权威，未来 LLM Judge 只能作为单独标注的诊断项。
- BIRD Mini-Dev 的独立 10 题实测最终正确率 80%；BLADE 的 5 题跨数据集 Holdout 首答/最终均为
  80%。Dr.Spider 修复超长 Reflection 结构化输出后，Prompt `dr-spider-sql-agent@1.3.0` 的独立
  5 题 Holdout Run `2ef9d9e3-a9c4-4f84-b698-a8d1b7e6eb91` 没有基础设施失败，但首答/最终仍为
  0%；继续保留为 `HOLD`，不读取 Holdout Gold 过拟合。
- BIRD-Critic 的公开 SQLite 题面可获取，但正式 `test_cases`/修复真值需向上游申请；DAB 顶层许可
  未闭合；DataSciBench 需要 Hugging Face 自动审批；ScienceAgentBench 完整任务包需人工获取并处理
  例外许可；SpreadsheetBench 2 数据为 MIT 且已固定摘要，但执行 Sandbox Adapter 尚未完成。

## 来源与归属

- BIRD Mini-Dev: <https://github.com/bird-bench/mini_dev>
- BIRD 数据集卡与 CC-BY-SA-4.0 许可：<https://huggingface.co/datasets/birdsql/bird_mini_dev>
- InsightBench: <https://github.com/ServiceNow/insight-bench>
- InsightBench 数据集与 CC-BY-4.0 许可：<https://huggingface.co/datasets/ServiceNow/insight_bench>
- BLADE: <https://github.com/behavioral-data/BLADE>
- Dr.Spider: <https://github.com/awslabs/diagnostic-robustness-text-to-sql>
- BIRD-Critic: <https://github.com/bird-bench/BIRD-CRITIC-1>
- Data Agent Benchmark: <https://github.com/ucbepic/DataAgentBench>
- DataSciBench: <https://github.com/THUDM/DataSciBench>
- ScienceAgentBench: <https://github.com/OSU-NLP-Group/ScienceAgentBench>
- SpreadsheetBench 2: <https://github.com/RUCKBReasoning/SpreadsheetBench-2>

安装回执固定上游 commit、下载 URL、归属和所有输入摘要，以便复现历史成绩。

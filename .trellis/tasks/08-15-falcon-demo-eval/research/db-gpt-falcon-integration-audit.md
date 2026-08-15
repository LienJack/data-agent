# 本地 DB-GPT Falcon 集成审计

## 审计范围

- Local repository: `/Users/lienli/Documents/GitHub/DB-GPT`
- Audited commit: `7996544a43759506e13a2268e367c26e6b4c0976`
- 审计仅做只读参考；DB-GPT 工作树已有用户删除和 `.understand-anything/` 未跟踪内容，本任务不得修改或回退。

## 已确认流程

DB-GPT 已实现一条完整的 Falcon 参考链路：

1. `BenchmarkDataManager` 从 `eosphoros-ai/Falcon` 下载仓库。
2. 自动发现 DEV/TEST 目录中的 SQLite 文件，并合并到统一 SQLite 数据库。
3. `FalconFileParseService` 解析 `dev.json`、`test.json` 和 `tables.json`。
4. Prompt 由表 DDL、字段样例、知识、问题和运行时 dialect 组成。
5. 运行时可调用 DB-GPT LLM，也存在通过 HTTP 调用远程 Agent 的代码路径。
6. Agent/模型输出 SQL 后，在 benchmark connector 中执行。
7. `DataCompareService` 比较标准结果和候选结果，记录正确、错误和失败。
8. 服务持久化任务与汇总，并提供列表、报告和 Excel 下载界面。

关键源码：

- `docs/docs/modules/benchmark.md`
- `packages/dbgpt-serve/src/dbgpt_serve/evaluate/service/fetchdata/benchmark_data_manager.py`
- `packages/dbgpt-serve/src/dbgpt_serve/evaluate/service/benchmark/ext/falcon_file_parse.py`
- `packages/dbgpt-serve/src/dbgpt_serve/evaluate/service/benchmark/task/benchmark_llm_task.py`
- `packages/dbgpt-serve/src/dbgpt_serve/evaluate/service/benchmark/task/benchmark_agent_task.py`
- `packages/dbgpt-serve/src/dbgpt_serve/evaluate/service/benchmark/data_compare_service.py`
- `packages/dbgpt-serve/src/dbgpt_serve/evaluate/service/benchmark/benchmark_service.py`

## 可借鉴的设计

- DEV/TEST 分离和 `db_id` 驱动的数据集映射。
- `question_id + db_id + question + SQL + answer + is_order` 的题目适配。
- Schema DDL、字段样例与问题组合成 Agent 输入。
- 模型与远程 Agent 两种调用路径。
- 生成 SQL、执行结果、错误、耗时和比较结果的明细记录。
- 汇总 executability rate、accuracy rate，并支持明细下载。

## 不直接复用的部分

### 1. 上游获取

DB-GPT 默认跟随 `main`，缓存有效期为一天。本项目按用户决定只导入一次固定 Falcon 快照，不实现同步和更新。

### 2. 数据隔离

DB-GPT 把所有 SQLite 表合并到一个共享 SQLite 文件；遇到同名表时跳过后续表。该行为不保留 `db_id` 的强隔离，也无法满足 Workspace 数据源边界。

本项目复用现有 `postgres` 服务、`data_agent` 数据库和 `pgdata` 数据卷，在同一数据库内使用 `falcon_db_01` 至 `falcon_db_28` schema 隔离业务数据，并按 `db_id` 精确路由。DB-GPT 的共享 SQLite 合库行为仍不采用。

### 3. 数据库方言

DB-GPT 当前文档明确以 SQLite 为已支持数据库。本项目运行时目标是 PostgreSQL，不能直接复制 SQLite connector、SQLite 合并逻辑或上游 Gold SQL 执行方式。

### 4. 判分严格度

DB-GPT 使用两位小数归一化、列摘要集合和 `CONTAIN_MATCH`。这可作为兼容性样本，但不能成为本项目正式 Oracle，因为列集合可能掩盖重复列/行和多重集差异。

本项目正式 Oracle 使用显式列、行多重集、顺序、null、numeric/date/text 规则，并将基础设施失败、查询拒绝、执行失败与答案错误分开。

### 5. Authority 和密封边界

DB-GPT 参考链路没有本项目的 Workspace RBAC、SecretRef、模型认证、Demo/Tuning/Holdout 隔离和 server-only sealed serializer。本项目必须沿用既有 Authority/Test Center 合约。

## 参考集成结论

DB-GPT 是 Falcon 数据格式、Prompt 构建、Agent/LLM 调用、执行比较和报告 UX 的实现参考，不是运行时依赖。实施时应建立少量 DB-GPT compatibility fixtures，证明同一 Falcon case 的问题、schema 和标准结果解析一致；不复制其下载缓存、共享 SQLite、宽松 Oracle 或 UI 代码。

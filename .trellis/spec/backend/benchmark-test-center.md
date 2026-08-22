# Test Center 与系统模型

> 系统模型凭证、第三方题库、标准答案和成绩结论分属不同权威边界；可下载不等于可运行，调参集达标不等于可以发布。

## 场景：从环境初始化系统模型

### 1. 凭证发现

- Web 启动时由 `apps/web/src/lib/root-env.ts` 读取仓库根 `.env`。
- 标准变量 `DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY` 优先；兼容别名分别是
  `DeepSeekAPIKey`、`KimiAPIKey`。
- 只有非空凭证才生成系统 Profile。Profile ID、Provider、Model 与版本必须稳定，首个可用
  Profile 标记为 `isSystemDefault`。

### 2. Secret Boundary

- 原始 Key 只存在于服务端进程环境，不写入 Model Store、数据库、日志、API 或浏览器状态。
- 公共 Model API 只返回配置状态和脱敏后的 Profile；系统 Profile 不允许通过 Settings 修改或删除。
- 真实作答直接使用服务端配置的 Profile 与环境凭据，不要求模型认证、USD 定价、积分、扣费或
  持久化调用许可。Context Window 与调用预算仍由服务端配置约束。

## 场景：初始化 Test Center Web 持久化

### 1. 范围 / 触发条件

- Web Route Handler 读取或写入 Test Center 的 PostgreSQL Authority 时适用。
- Test Center 必须自行调用根环境加载器；不能依赖模型初始化等无关模块恰好先执行。

### 2. 签名

```ts
resolveTestCenterRuntimeConfig(environment: NodeJS.ProcessEnv): {
  connectionString: string;
  tenantId: string;
  principalId: string;
  environment: string;
};
```

### 3. 契约

- `DATABASE_URL` 始终必需；`TEST_CENTER_TENANT_ID`、`TEST_CENTER_PRINCIPAL_ID` 和
  `TEST_CENTER_ENVIRONMENT` 在生产模式必需。
- 宿主机开发模式在被 Git 忽略的仓库根 `.env.local` 中配置 `DATABASE_URL`，并使用固定本地
  Tenant、Principal 与 `local` Environment；生产/容器由运行环境显式注入全部变量。
- `config()` 在解析前调用 `ensureRootEnvironmentLoaded()`；已有进程新增或修改 `.env*` 后必须重启。
- 这些变量只存在于服务端，浏览器请求不能覆盖 Scope 或连接串。

### 4. 校验与错误矩阵

| 条件 | 公开结果 |
| --- | --- |
| 缺少 `DATABASE_URL` | `503 / TEST_CENTER_CONFIG_INVALID` |
| 生产缺任一 Scope 字段 | `503 / TEST_CENTER_CONFIG_INVALID` |
| PostgreSQL 不可连接或表不可访问 | `503 / TEST_CENTER_PERSISTENCE_UNAVAILABLE` |
| 配置与 Authority 正常，但 Run 不存在 | `404 / TEST_CENTER_RUN_NOT_FOUND` |

### 5. Good / Base / Bad

- Good：容器显式注入四项配置；宿主机开发使用根 `.env.local`，重启后以业务级 404/成功写入
  证明链路。
- Base：开发仅提供 `DATABASE_URL`，其余 Scope 使用固定本地值。
- Bad：捕获配置错误后改用内存成绩、浏览器传入 Scope，或把生产配置降级为开发默认值。

### 6. 必需测试

- Unit：开发模式提供数据库地址时解析固定本地 Scope；生产 Scope 不完整时保持失败关闭。
- Integration：合法 UUID 的未知 Run 返回 `TEST_CENTER_RUN_NOT_FOUND`，而不是配置 503。
- Browser：加载已安装题库并完成一次单题运行；成绩单 PASS/FAIL 必须能从 PostgreSQL 回读。

### 7. Wrong vs Correct

#### Wrong

```ts
// 偶然依赖其他模块先加载根 .env；执行顺序变化后 Test Center 重新报配置 503。
return resolveTestCenterRuntimeConfig(process.env);
```

#### Correct

```ts
ensureRootEnvironmentLoaded();
return resolveTestCenterRuntimeConfig(process.env);
```

## 场景：接入第三方 Benchmark

### 1. Dataset Gate

每个 Suite 在 Catalog 中独立声明固定版本、上游来源、许可证/访问状态、Adapter 能力和安装状态：

- `LICENSE_BLOCKED`：缺少可确认的许可，不下载、不执行。
- `ACCESS_GATED`：需要人工申请或补齐受限资产，只允许在授权后手动导入。
- `NOT_DOWNLOADED`：来源合法，但本地 Snapshot 或执行 Adapter 尚未就绪。
- `READY`：只有完整安装文件与 `BenchmarkImportReceipt` 的逐文件 SHA-256、组合摘要和版本全部重验通过时才能进入。

下载器必须限制来源、字节数和解包路径；上游数据或摘要漂移时失败关闭。不能用“文件存在”、仓库可访问或部分数据下载成功替代 `READY`。

### 2. Public/Sealed Case

- Agent 只接收 `PublicBenchmarkCase`；SQL Gold、选择题答案、Rubric 和隐藏 Validator 只存在于
  Sealed Case 与 Oracle 边界。
- Case 详情 API、模型 Prompt 和 Reflection 输入都不能返回 Sealed 字段。
- SQL Oracle 在冻结 SQLite Snapshot 上比较 Candidate/Gold 结果；选择题 Oracle 只比较精确选项。

### 3. 有界反省

- Attempt 0 永远保留为 First-pass；只有可归因于 Agent 输出的确定性失败才允许最多一次 Attempt 1。
- SQL 反省只能看到裁剪后的失败类型/结果形状；选择题反省只能知道自己刚才选择错误，不能看到正确选项。
- Oracle、坏题或基础设施失败不触发反省，也不计入能力分母。
- Prompt/Workflow 优化只能消费 Tuning 题面、裁剪反馈和运行轨迹；Holdout Gold、Rubric 与隐藏 Validator 禁止进入优化上下文。

## 发布与 80% 门禁

- 每个 Suite 独立报告 First-pass、Post-reflection、Recovery、Regression、有效样本数、成本和失败分类，禁止用跨 Suite 平均掩盖失败。
- 只有冻结 Candidate 在未参与优化、至少 5 个有效 Case 的 Holdout 上达到
  `post_reflection_pass_rate >= 0.80` 才能标记该 Suite 达标。
- Tuning 达标但 Holdout 未达标时必须发布为 `HOLD`；禁止读取 Holdout Gold 后继续调 Prompt、删除失败题或修改 Oracle。
- 每次正式成绩绑定 Dataset Digest、Agent/Prompt/Workflow、Provider/Profile/Model、Evaluator、Seed、预算与 Run ID，保证结论可重放和可审计。

## 必需测试

- 根 `.env` 别名、标准变量优先级、空 Key 不生成 Profile、系统 Profile 不可变。
- `/api/models` 与日志不包含原始 Key。
- Receipt 摘要或安装文件被篡改时 Catalog 从 `READY` 失败关闭。
- Public Case API 不泄漏 SQL Gold、正确选项或隐藏 Rubric。
- 错答保留首答并只触发一次裁剪反省；Oracle/基础设施失败不触发。
- Tuning/Holdout 隔离与每 Suite 独立 80% 发布判断。

## 场景：验收真实 Agent 作答与确定性评分闭环

### 1. 范围 / 触发条件

- 题库或 Demo 声明“可运行”“已接入”或“验收通过”时适用；只展示题面、预置 SQL、Gold 回放或
  单独验证 Sandbox 均不构成闭环。
- 最小验收必须由用户从 Test Center 选择公开题目，并由 configured model/Data Agent 在不知道 Gold、
  Rubric 和隐藏 Validator 的前提下生成候选答案。

### 2. 签名

```ts
executeBenchmarkAcceptance(input: {
  suite_id: "ecommerce-production";
  case_id: string;
  agent_id: typeof CERTIFIED_MODEL_SQL_AGENT_ID;
  reflection_enabled: boolean;
  budget: BenchmarkRunBudget;
}): Promise<BenchmarkEvalBatchRun>;
```

### 3. 契约

- Agent 输入只包含 `PublicBenchmarkCase`、获准的 Schema/Semantic/Glossary 和工具返回；不得把
  Gold SQL、Gold 结果值、Rubric、隐藏 Validator 或其他 Case 放入 Prompt、工具结果或 Reflection。
- 候选 SQL 必须以 Demo 只读角色在真实 PostgreSQL 固定快照上独立执行；需要 Python 的题必须把
  SQL Artifact 交给真实 Python Sandbox，不能在 Web/Worker 宿主进程内替代执行。
- Sealed Case 只由服务端 Oracle 加载。Oracle 分别执行/验证 Candidate 与 Gold，生成结果/产物摘要、
  确定性 Verdict 和不可变 Receipt；模型 Judge 只能诊断，不能产生、覆盖或批准 PASS。
- 成功闭环必须持久化并可按 `batch_run_id` 回读 Manifest、Attempt 0、必要时的 Attempt 1、公开工具
  阶段、Artifact 引用、Oracle Feedback、ScoreCard、成本和时延。
- 测试用 Fixture Agent、提交答案 Agent、预置 SQL 或直接执行 Gold 可以用于单元测试，但不得作为
  “真实 Agent 验收通过”的证据。

### 4. 校验与错误矩阵

| 条件 | 公开结果 | 能力分母 |
| --- | --- | --- |
| Candidate 与 Gold 的规范化结果/产物一致 | `PASS` + ScoreCard | 计入 |
| Candidate 可执行但结果不一致 | `FAIL / ORACLE_MISMATCH` | 计入 |
| Candidate 被只读策略拒绝、超时或执行失败 | `FAIL` + 裁剪反馈 | 计入 |
| Gold、固定快照或 Oracle 自身失败 | `ORACLE_FAILURE` | 不计入 |
| PostgreSQL、Worker、Python Sandbox 或持久化不可用 | `INFRA_FAILURE` | 不计入 |
| Agent 未产生契约答案 | `INFRA_FAILURE`，不得伪造空答案分数 | 不计入 |

### 5. Good / Base / Bad

- Good：复杂题由 configured model/Data Agent 查询真实 PostgreSQL，Python 题再调用隔离 Sandbox，
  Oracle 用 Sealed Case 判分，页面能从 PostgreSQL 回读 ScoreCard 与证据链。
- Base：先完成一道人为不可伪造的多表 SQL Demo 题闭环并保持 Production Suite `HOLD`，随后再以
  Hard SQL+Python 题完成最终 GO 门槛。
- Bad：页面只显示题目；把 Gold SQL 当 Agent 输出；用 Mock/Fixture PASS 冒充真实模型成绩；或只
  展示“执行成功”而没有确定性 Verdict 和可回读 ScoreCard。

### 6. 必需测试

- Unit：Sealed 摘要、Candidate/Gold 独立执行、顺序/无序结果、数值容差及失败分类。
- Security：公共 API/Prompt/SSE/日志不出现 Sealed 字段；只读角色拒绝跨 Schema、DDL/DML、多语句。
- Integration：真实 PostgreSQL 上至少一道人为不可伪造的多表题由 configured model 作答并生成
  ScoreCard；最终验收另需一道人为不可伪造的 Hard SQL+Python 题通过真实 Worker/Sandbox。
- Browser：选择题目、启动 Agent、查看公开执行阶段，并按 `batch_run_id` 回读同一 ScoreCard。

### 7. Wrong vs Correct

#### Wrong

```ts
const answer = sealedCase.gold_sql;
return { status: "PASS", score: 100 };
```

#### Correct

```ts
const answer = await certifiedAgent.answer({ test_case: publicCase, invocation, seed });
const evaluation = await deterministicOracle.evaluate({
  candidate_sql: answer.sql,
  gold_sql: sealedCase.gold_sql,
});
return persistScorecard(aggregate(publicCase, answer, evaluation));
```

## 场景：Falcon 固定快照评测

- Falcon v1 固定为上游 commit `8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5`、28 库、
  DEV 309 和 TEST 191；seed 随仓库分发并由标准迁移离线导入现有 `data_agent`。
- 28 个 db_id 必须分别映射到 `falcon_db_01` 至 `falcon_db_28`；禁止增加第二个 PostgreSQL
  service/database/volume，也禁止把 Gold 或 registry 写入业务 schema。
- `falcon_demo_reader` 默认只读且不能读取控制面；executor 另外冻结当前 case schema、单语句、
  timeout 和结果预算。
- 公共 API 隐藏 5 个 `LOCAL_HOLDOUT`，TEST 191 全部不可本地判分；submission receipt 的
  `local_accuracy` 必须为 null。
- db24 是主 Demo，db14 仅作 smoke。db24 本体候选必须显式关联主体、维度、指标、公式、物理表、
  物理列、Join 证据和中文术语；两个库存快照不能自动合并。
- Agent 只能生成 `REVIEW_REQUIRED` Candidate；人工 Review/Publish 前不能把候选冒充 active
  semantic release。
- pipeline probe 只证明 32/17/309 case 执行与分类完成，不是模型准确率。真实成绩必须由
  configured model/Data Agent 作答并由严格 result-equivalence Oracle 产生。

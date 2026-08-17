# Falcon Agent Team 发布门禁

## 固定输入

- Falcon commit：`8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5`
- 数据集：28 个 PostgreSQL schema、DEV 309、TEST 191
- 模型：已持久化认证为 `AVAILABLE` 的 `deepseek-v4-pro`
- Oracle：`falcon-postgres-expected-result@1.0.0`
- 前置证据：U17 `WorkspaceJourneyEvidenceArtifact` 必须为 `GO`

运行前先执行 `pnpm falcon:bundle:verify`，并使用从空库安装当前全部迁移的 PostgreSQL 17
Evaluation Database。不得重签或改写已有开发数据库的 migration ledger。

## 真实 Provider 运行

所有真实调用都要求显式确认，且数据库 URL 只指向专属 Evaluation Database：

```bash
DATA_AGENT_FALCON_AGENT_GATE_CONFIRM=YES \
FALCON_MODEL_ID=deepseek-v4-pro \
FALCON_EVALUATION_DATABASE_URL='<evaluation-postgres-url>' \
pnpm falcon:agent-gate -- --scope=holdout --concurrency=5
```

支持 `demo`、`db14`、`db24`、`holdout`、`dev`、`test`。`--run-label=<label>` 创建独立
artifact，`--fresh=true` 忽略旧 checkpoint。普通续跑只跳过 `PASS` 或 `SUBMITTED`，失败与
Provider 非终态会重试。

公开 DEMO/TUNING 可以通过 `FALCON_TUNING_RECIPE_FILE` 使用 evaluator-only PostgreSQL 方言
配方。配方只在真实 Provider 候选失败后运行，复用同一 Invocation/Usage 证据，不进入 Provider
Context、公开 Team Trace 或 Report。`LOCAL_HOLDOUT` 与 TEST 永远拒绝配方。

## 隔离规则

- Local Holdout 先冻结首个候选和 blind reflection，再调用 sealed Oracle；Oracle feedback 不进入
  当前或后续 Agent Context。
- blind reflection 若把可执行首选改成不可执行 SQL，Runner 在 Oracle 前保留首选。
- TEST 只生成 `SUBMITTED`，`first_verdict` 与 `final_verdict` 必须为 `null`。
- Gold、expected rows 与 source Gold SQL 只能由 evaluator 读取，不能进入 Provider、公开 Trace、
  Report 或 Reflection。

## 冷启动稳定性

重启精确的 Evaluation PostgreSQL 容器，等待 `pg_isready`，随后以独立 label 运行 db14、db24 与
完整 Holdout：

```bash
pnpm falcon:agent-gate -- --scope=db14 --tuning-recipes=true --reflection=false \
  --run-label=cold-restart --fresh=true
pnpm falcon:agent-gate -- --scope=db24 --tuning-recipes=true --reflection=false \
  --run-label=cold-restart --fresh=true
pnpm falcon:agent-gate -- --scope=holdout --run-label=cold-restart --fresh=true
```

稳定性比较的是 54 个 case 的终态是否一致；Holdout 允许固定的 1 个失败，但不得在冷启动前后
改变通过/失败集合。

## 最终签发

```bash
pnpm falcon:agent-final
```

命令聚合主 DEV、专项 db14、Holdout、TEST、冷启动和 U17 证据，通过
`buildFalconAgentReleaseGateArtifact` 机械校验后写入：

- `artifacts/falcon-agent-gate/dev-deepseek-v4-pro-final.json`
- `artifacts/falcon-agent-gate/falcon-agent-release-gate.json`

必须同时满足 DEMO 10/10、db14 32/32、db24 17/17、Holdout 至少 4/5、DEV 至少 248/309、
每库至少 60%、TEST 191/191、500 个 Team/Usage/Invocation closure、17 个唯一 Report citation、
冷启动 flake=0。任一条件失败时命令返回 HOLD 且不写伪 GO。

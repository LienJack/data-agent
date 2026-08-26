# 技术设计：Root Agent 自主路由与 Governed Text2SQL

> E1 当前路径（2026-08-27）：本设计的有效实现由
> `docs/plans/2026-08-26-001-refactor-falcon24-e1-authority-reset-plan.md` 的 U1–U9 管理。旧 Direct QA、adaptive
> dispatch、固定 `query_kind`、模板 SQL 与 Falcon case-bound runtime 已退出生产代码面；下文“当前断点”保留为历史诊断。

## 1. 设计结论

恢复现有 Root Harness V3 作为唯一生产编排入口，并扩展当前轻量 Provider dispatcher，使它同时支持 Root、Text2SQL 和 Report 三种受服务器约束的 turn。Root 使用冻结 Agent Card 进行语义选择；Host 仅做确定性 admission 和执行。

Text2SQL 不再把自然语言压缩为三个固定 `query_kind`，而是生成结构化、通用 PostgreSQL query candidate。Host 从精确 schema snapshot 计算 relation allowlist，经已有 governed PostgreSQL adapter 做 AST policy、只读事务、EXPLAIN、限时/限行/限字节后执行，再提交 Artifact。

## 2. 当前断点与可复用资产

### 2.1 当前断点

1. `data-agent-team-runner.ts` 无条件转到 Direct QA，忽略 V3 lease 的 Root 语义。
2. `run-worker-cli.ts` 没有创建 Profile registry、Team store、Root turn/delegation runtime 和 Production Team Runtime。
3. `direct-run-bound-provider-dispatcher.ts` 只有 Direct QA schema，tool allowlist 为空。
4. `mastra-execution-bridge.ts` 只要存在工具就固定 `toolChoice: required`，导致 Root 无法自主直接回答。
5. `production-team-tools.ts` 依赖 `@data-agent/evals/ecommerce-direct-qa`，只支持两条固定 SQL。

### 2.2 直接复用

- `buildRootAgentSystemMessage`、`normalizeRootAgentProviderTurn`。
- `delegate_to_subagent@1` descriptor 与 `admitRootAgentDelegations`。
- `root-agent-turn-executor.ts`、`root-agent-delegation-runtime.ts`、`production-team-runtime.ts`。
- V3 `effective-config-team-lease@3.0.0` 与接收阶段冻结的 `catalog_snapshot`。
- Postgres Agent Profile Registry、Team Run Store、Product Team Artifact Store。
- `PostgresSchemaSnapshotStore.getSnapshot` 与 `PhysicalSchemaSnapshot` 的 relations/columns/FK。
- `createPostgresqlDatasourceAdapter`、PostgreSQL transport、SQL AST allowlist、read-only transaction、EXPLAIN 与结果预算。

## 3. 目标调用图

```text
Q&A acceptance
  -> freeze effective config + catalog snapshot + schema snapshot
  -> enqueue ROOT_HARNESS@1 lease

Worker
  -> RootAgentTurnExecutor
     -> lightweight provider(ROOT, Agent Cards, toolChoice=AUTO)
        -> FINAL_ANSWER
           -> same Root DIRECT_ANSWER_REVIEW (one bounded self-review)
              -> retain FINAL_ANSWER -> RootAnswerVerifier -> public answer
              -> or native delegate_to_subagent call
        -> delegate_to_subagent(profile_id, objective, inputs, outputs)
           -> RootAgentDelegationRuntime admission
              -> ProductionTeamRuntime
                 -> Semantic Agent -> frozen semantic graph -> Artifact
                 -> Text2SQL Agent
                    -> load exact physical schema snapshot
                    -> lightweight provider(TEXT2SQL) -> SQL candidate
                    -> Host policy + governed datasource adapter
                    -> SqlArtifact -> QueryEvidence
                 -> Report Agent
                    -> accepted QueryEvidence -> AnalysisReport
```

Root 不接收数据库连接或密码。Specialist 模型只接收被裁剪的 schema/semantic material，生成 SQL 候选；数据库 I/O 始终由 Host adapter 执行。

## 4. Provider 设计

### 4.1 轻量 dispatcher 分阶段

将当前 dispatcher 从“Direct QA 专用”调整为 run-bound lightweight dispatcher：

| Turn | System material | Tools | Response contract |
| --- | --- | --- | --- |
| Root | Root policy + frozen Agent Cards | `delegate_to_subagent@1` | native tool calls 或 strict `FINAL_ANSWER` |
| Text2SQL | objective + dialect + exact schema projection + semantic context + bounds | 无 | `text2sql-query-candidate@1.0.0` |
| Report | objective + accepted evidence projection | 无 | `report-answer@1.0.0` |

现有 `RunBoundProviderDispatcher.invoke` 的 `turn` 已能区分 Root/Specialist；dispatcher 只接受由 Worker execution context 注入的 turn，不接受客户端覆盖。

### 4.2 Root 的 AUTO tool choice

在 `ModelProviderPortCompositionInput` 增加服务器拥有的执行选项，例如：

```ts
type ModelToolChoicePolicy = "REQUIRED" | "AUTO";
```

- 默认值保持 `REQUIRED`，避免改变现有“调用工具就是必须调用”的路径。
- Root dispatcher 明确传 `AUTO`。
- 无工具请求仍为 `none + structuredOutput`。
- 有工具且 `AUTO` 时不强制 provider structured output；Root 的 direct text 由 `normalizeRootAgentProviderTurn` 严格解析，tool calls 由既有 schema 严格解析。
- policy 不进入客户端 request contract，避免用户篡改。

### 4.3 Root 语义路由规则

路由信息只来自 Agent Card，不在代码中维护问题关键词：

- Text2SQL Card：数据库值、行、聚合、趋势、排行和对比。
- Semantic Card：定义、关系、依赖、Join、血缘和治理语义。
- Report Card：将已接受证据组织为正式报告。

Host 不追加“如果包含 ROI 就选 Text2SQL”之类规则。路由质量由 Agent Card 描述、模型能力与固定语料 gate 保证。

当 Root 初始返回 direct answer 时，Host 不用正则判断问题类型，而是把原问题和初始回答交还同一个 Root 做一次 `DIRECT_ANSWER_REVIEW`。自审只能保留严格 direct answer 或改为原生 delegation；不允许第三次路由、Host 自行改派或文字形式的伪调用。

## 5. Root 与 Team Runtime 恢复

### 5.1 `data-agent-team-runner`

- 对 V3/`ROOT_HARNESS@1` lease：调用 Root turn，规范化 decision，再调用 Root delegation runtime。
- Root direct answer 和 delegation 都通过同一 verifier/admission 边界。
- V1/V2/legacy lease 显式返回 `ROOT_AGENT_LEASE_VERSION_UNSUPPORTED`，不进入生产执行。
- 删除 `direct_analysis`、Direct QA executor 与关系正则 Router；不存在 legacy executor、兼容 facade 或 feature flag 旁路。

### 5.2 Worker composition

重新组合：

- `createPostgresAgentProfileRegistry`
- `createPostgresTeamRunStore`
- `createProductionTeamRuntime`
- `createProductionTeamTools`
- `createRootAgentTurnExecutor`
- `createRootAgentDelegationRuntime`

Platform 新增稳定 `@data-agent/platform/agents` 子路径导出 Profile Registry 与 Team Store，Worker 不新增 root package import。

### 5.3 动态 Profile

Root 使用 lease 内冻结 catalog；admission 再读取 live discoverable/legacy runtime profile 验证冻结 revision/hash 仍可执行。若 Profile 被撤销或版本不一致，失败关闭为稳定 reason code，不偷偷换到另一 Agent。

## 6. 通用 Text2SQL 设计

### 6.1 输入 Authority

新增 Worker 内部 `RunBoundText2SqlContextPort`，从 execution context/effective config 获取：

- exact datasource id/revision/hash；
- exact schema snapshot id/hash；
- exact semantic release id/hash/generation；
- resolved context package/receipt；
- Root delegation objective；
- effective timeout/tool/provider budgets。

使用 `PostgresSchemaSnapshotStore.getSnapshot` 读取物理结构后，必须重新验证 snapshot id、content hash、datasource id 与 Effective Config 一致。

### 6.2 Prompt projection

只向 Text2SQL 模型投影生成 SQL 所需内容：

- dialect；
- schema、table/view、column、type、nullable、PK/FK 和 comment；
- 已发布 semantic metrics/entities/relationships/lexicon 的安全投影；
- objective、结果形状要求、时间/行数预算。

不发送 host、port、database、username、SecretRef、凭据、原始系统 prompt 或历史全量数据库行。

若 schema 超过 context budget，按 semantic candidates、关系闭包和描述相关性做服务端有界裁剪；这一步是上下文选择，不负责决定调用哪个 Subagent。裁剪结果与 hash 写入 SQL Artifact provenance。

### 6.3 SQL candidate contract

唯一 contracts schema 为：

```ts
{
  schema_version: "text2sql-query-candidate@1.0.0";
  sql: string;
  parameters: Array<string | number | boolean | null>;
  result_columns: Array<{
    name: string;
    semantic_type: "NUMBER" | "STRING" | "DATE" | "DATETIME" | "BOOLEAN";
    label: string;
  }>;
  presentation: {
    title: string;
    summary: string;
    visualization: "NONE" | "LINE" | "BAR" | "PIE" | "TABLE";
    x_key: string | null;
    y_keys: string[];
  };
}
```

`presentation.summary` 只能作为表达提示，不能当作证据。最终数字、表格和图表数据必须从 adapter result 投影。

不再存在 `TABLE_COUNT`、`MONTHLY_ORDER_TREND`、`UNSUPPORTED` 生产枚举。

模型 SQL 仍是不可信候选。Host 用 PostgreSQL AST 将所有非零常量改写为追加参数，再重新解析并执行严格 policy；这个编译步骤只保存模型表达的结构和值，不发明 relation、表达式或业务值。schema、policy、类型、列名或结果形状错误仅允许一次模型修复，且只返回安全错误码与同一冻结上下文。

### 6.4 确定性 SQL policy

Host 从 exact physical snapshot 生成 canonical `allowed_relations`，然后构建 `GovernedDatasourceQueryRequest`：

- 单语句 `SELECT`/只读 CTE；
- 禁止 DDL、DML、COPY、CALL、锁、危险函数和跨 schema relation；
- 参数化 values；
- relation 必须在 snapshot allowlist；
- timeout/max_rows/max_bytes 取 Effective Config 与 Adapter 上限的较小值；
- 执行前 EXPLAIN；
- read-only transaction；
- 任何 policy error 不释放未验证结果。

这些 AST/identifier 校验可以使用正则或 parser，因为它们验证安全属性，不进行 Agent 路由。

### 6.5 Datasource target authority

新增 Worker 组合的 `RunBoundDatasourceTargetAuthority`：

1. 从 Workspace repository 读取 selected datasource。
2. 验证 workspace、status、type、resource revision/hash 与 Effective Config。
3. 验证 ACTIVE SecretRef scope/version。
4. 通过服务器 Secret Resolver 获取短生命周期 credential。
5. 通过 egress authorizer 将 host 解析为批准 target，并计算 `target_capability_hash`。
6. 将 target 只交给 adapter transport，不进入 prompt、trace 或 Artifact。

首期 PostgreSQL resolver 覆盖当前 Falcon 环境的 `FALCON_READER_PASSWORD` SecretRef。不存在 resolver 的 datasource 返回 `DATASOURCE_SECRET_REF_UNAVAILABLE`；Root/模型不得把它改写成未经证实的业务数据结论。

### 6.6 Artifact 顺序

1. SQL candidate 先完成 Host 编译、policy、目标绑定、EXPLAIN 与真实只读执行；失败候选不提交 Artifact。
2. 执行成功后提交 `SqlArtifact`，记录最终 statement、parameters 的安全投影与 schema/context refs；随后提交 source ref 指向它的 `QueryEvidence`。
3. 可视化只消费 `QueryEvidence`；Report 只消费 accepted evidence。
4. 最终回答从 committed Artifact 渲染，模型 summary 不覆盖真实列、行或计数。

显式 LINE/BAR/PIE 意图按候选执行；候选声明 TABLE/NONE 但结果类型形成“一个分类/时间列 + 数值列”时，Host 只依据结果形状确定性地产生 BAR/LINE，不读取问题关键词。图表作为独立 `ArtifactWorkspaceDocument` 提交，并与表格绑定同一个 QueryEvidence/source receipt。

## 7. Semantic 与 Report

- Semantic Agent 保留冻结 semantic release 读取，但输出应由 objective 限定到所需关系子图，避免每次公开整个关系索引。
- Report provider 输入必须包含 accepted evidence 的有界安全投影；Report Artifact 的每个数据结论都带 source refs。
- Root 发出多个 tool calls 时，Production Team Runtime 使用既有 task/handoff 状态机按输入 Artifact 依赖执行；不满足依赖的 Report 保持等待或失败关闭。

## 8. 错误模型

建议新增/固定以下 reason codes：

- `ROOT_AGENT_PROVIDER_TURN_INVALID`
- `ROOT_AGENT_DECISION_REJECTED`
- `TEXT2SQL_CONTEXT_BINDING_MISMATCH`
- `TEXT2SQL_SCHEMA_SNAPSHOT_UNAVAILABLE`
- `TEXT2SQL_CANDIDATE_INVALID`
- `TEXT2SQL_SQL_POLICY_REJECTED`
- `DATASOURCE_BINDING_MISMATCH`
- `DATASOURCE_SECRET_REF_UNAVAILABLE`
- `DATASOURCE_EGRESS_DENIED`
- `DATASOURCE_QUERY_TIMEOUT`
- `DATASOURCE_RESULT_LIMIT_EXCEEDED`

错误公开层只显示安全原因与可采取动作；详细 correlation 留在服务端日志，不包含 SQL 之外的连接信息或凭据。

## 9. 文件级变更计划

### Contracts

- `packages/contracts/src/agents/*`：必要时收紧 Root/Specialist turn 或 artifact dependency contract。
- `packages/contracts/src/artifacts/*`：增加通用 Text2SQL candidate/provenance 的稳定 schema，或复用已有最接近的 authority contract。
- 对应 contract tests。

### Agent Runtime

- `packages/agent-runtime/src/model-provider-port.ts`：增加 server-owned tool choice policy。
- `packages/agent-runtime/src/mastra/mastra-execution-bridge.ts`：支持 Root `AUTO`，保留其他路径默认 `REQUIRED`。
- Root harness/tool tests 与 Mastra bridge integration tests。

### Platform

- `packages/platform/src/agents/index.ts` 与 package exports：提供稳定 Agents 子路径。
- 复用/扩展 `catalog/postgres-snapshot-store.ts`。
- 复用 `datasources/adapters/postgresql*.ts`，只在通用 policy/target authority 缺口处扩展。
- 对应 datasource security/contract tests。

### Worker

- `providers/direct-run-bound-provider-dispatcher.ts`：改为 Root/Specialist aware 的轻量 dispatcher；文件可按职责重命名。
- `teams/data-agent-team-runner.ts`：恢复 V3 Root 路径。
- `run-worker-cli.ts`：恢复 Root/Profile/Team composition，并接入 PostgreSQL target authority。
- `teams/production-team-tools.ts`：删除 eval 固定 SQL/query_kind，接入通用 Text2SQL candidate 与 governed adapter。
- 新增 run-bound Text2SQL context/datasource adapter 组合文件。
- 删除生产 Direct QA 正则 router 的引用；无引用文件在确认后删除。
- 对应 unit/integration tests。

### Specs

- `.trellis/spec/backend/agent-team-runtime.md`
- `.trellis/spec/backend/provider-invocation-authority.md`（仅在接口说明需同步时）
- `.trellis/spec/backend/text2sql-resolved-context.md`

## 10. 测试设计

### 10.1 Router corpus（只断言行为，不实现分类器）

| 问题 | 预期 |
| --- | --- |
| 解释什么是同比增长 | Root direct |
| 当前有多少个表 | Text2SQL |
| 按渠道对比投入、收入和 ROI | Text2SQL |
| 最近 12 个月订单趋势 | Text2SQL |
| 订单和客户是如何关联的 | Semantic |
| 指标 GMV 的定义与血缘 | Semantic |
| 查出 ROI 后生成正式报告 | Text2SQL -> Report |

测试 mock provider 返回原生 tool call/direct answer，用于验证 Host 没有二次正则路由；另设真实 DeepSeek smoke 验证 Agent Card 的实际选择质量。

### 10.2 Text2SQL policy

- 任意合法单表、Join、CTE、聚合、排行、时间趋势。
- 拒绝 INSERT/UPDATE/DELETE/DDL、多语句、越权 schema/relation、危险函数、SELECT INTO、锁。
- schema snapshot/hash/datasource mismatch 在 I/O 前失败。
- timeout、row、byte limit 和 abort。
- adapter 结果到 QueryEvidence 的类型/空值/大整数/日期投影。

### 10.3 恢复与幂等

- Root decision 之后崩溃；恢复时不重新冻结 catalog。
- SQL Artifact 后崩溃；恢复时不重复公开 Artifact。
- QueryEvidence 后 Report 前崩溃；Report 从 accepted ref 继续。
- Profile 被撤销、snapshot 漂移、SecretRef rotate 时失败关闭。

### 10.4 真实验收

在用户给出的 workspace/conversation 上运行至少四题：营销 ROI、表数量、实体关系、一般解释。保留安全 trace 与 Artifact ref；浏览器确认选中的 Agent、执行状态、表格/报告可见。

## 11. 风险与控制

| 风险 | 控制 |
| --- | --- |
| Root 模型错误直接回答数据问题 | Agent Card + Root system contract + direct answer verifier + routing corpus + real smoke gate |
| `toolChoice=AUTO` 时 provider 返回混合文本/tool | 既有 strict normalizer 拒绝 mixed response |
| SQL 模型幻觉表/列 | exact snapshot prompt + AST relation allowlist + adapter EXPLAIN，失败不产出证据 |
| 任意 datasource 凭据解析尚未生产化 | 首期明确 PostgreSQL/Falcon SecretRef，接口保持通用，缺 resolver 稳定失败 |
| 恢复旧 Root 同时恢复过重 Provider 鉴权 | 只复用轻量 dispatcher，测试断言不创建 Intent/Permit/ledger |
| UI 把计划状态显示成已执行 | 只从 durable Team task/tool/artifact event 投影公共活动 |

## 12. 关键决策记录

1. **恢复 Root，不新增 Router Agent**：现有 V3 contract 和 admission 已经是正确边界。
2. **Agent 负责意图，Host 负责权限**：避免正则规则与模型判断互相打架。
3. **移除固定 query_kind**：它是当前数据库问题无法泛化的第二个根因。
4. **复用 governed datasource adapter**：不为 Falcon 再造一条不受治理的 SQL 通道。
5. **PostgreSQL 首期上线**：先闭环用户当前真实故障；其他 dialect 保持明确扩展点，不虚报已验证。
6. **保持轻量 Provider**：恢复自主路由不等于恢复已退役的调用授权/计费体系。

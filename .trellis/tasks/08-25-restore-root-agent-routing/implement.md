# 实施计划：恢复 Root Agent 自主 Subagent 路由

> 当前状态：等待方案批准。批准前不修改产品代码。

## Phase 0：建立回归基线

- [ ] 固定当前失败案例与 Run/lease/effective config 证据，确认用户给出的 conversation 绑定 Falcon db24 与 V3 catalog snapshot。
- [ ] 添加失败回归测试，证明当前链路会进入 Direct QA、不会产生 Text2SQL delegation/QueryEvidence。
- [ ] 记录现有 Intent/Permit/ledger 计数，作为“保持轻量 Provider”的对照。

Gate：测试必须先复现错误，且不依赖字符串匹配去决定目标 Agent。

## Phase 1：恢复 Root provider turn

- [ ] 为 model provider composition 增加 server-owned `AUTO | REQUIRED` tool choice policy，默认保持 `REQUIRED`。
- [ ] 修改 Mastra bridge：Root 使用 `AUTO`；无工具保持 `none`；其他工具路径保持默认行为。
- [ ] 将 lightweight run-bound dispatcher 扩展为读取 V3 lease catalog，构建 Root system message，注册 Root response schema 与 `delegate_to_subagent@1`。
- [ ] 保留重试、usage/performance event 与 provider binding；不接入 certification/Intent/Permit。
- [ ] 覆盖 direct final、single delegation、multi delegation、mixed output、unknown tool/profile、provider failure。

Gate：Root 在同一套真实 bridge 上既能直接回答，也能发出 native tool call；无持久化 provider authorization 副作用。

## Phase 2：恢复 Worker Team composition

- [ ] 增加 `@data-agent/platform/agents` 稳定导出。
- [ ] 在 Worker 创建 Profile Registry、Team Store、Production Team Runtime、Root turn 与 Root delegation runtime。
- [ ] 恢复 `data-agent-team-runner` 的 V3 分支；V3 不得 fallback 到 `direct_analysis`。
- [ ] 保留旧 lease 的显式处理或安全拒绝，补版本矩阵测试。
- [ ] 验证 catalog freeze -> live profile binding -> admission -> selected runtime 的 hash/revision 闭合。

Gate：mock Root 选择哪个 Profile，就只有哪个 Profile 创建 task/tool 事件；没有 Host 二次分类器。

## Phase 3：替换固定 Text2SQL

- [ ] 定义/复用通用 Text2SQL query candidate contract。
- [ ] 新增 run-bound Text2SQL context loader，读取 exact physical schema snapshot 与 resolved semantic context。
- [ ] 为 dispatcher 增加 Text2SQL specialist prompt/schema；输出 SQL、parameters、result metadata，而不是 `query_kind`。
- [ ] 从 physical snapshot 生成 canonical allowed relations。
- [ ] 构建 `GovernedDatasourceQueryRequest`，接入 PostgreSQL adapter 的 AST policy、EXPLAIN、read-only transaction 和 limits。
- [ ] Worker target authority 验证 datasource revision/hash、SecretRef、egress 与 target capability hash。
- [ ] 为 Falcon SecretRef 接入服务器环境 resolver；不将 secret/target 投影给模型或 trace。
- [ ] 按 `SqlArtifact -> QueryEvidence -> chart/report` 顺序提交。
- [ ] 删除 Worker 对 `@data-agent/evals/ecommerce-direct-qa` 固定 SQL/query kind 的生产依赖。

Gate：Falcon db24 上至少通过自由 Join/聚合/趋势/排行四类查询；非法 SQL 全部在 I/O 前或 adapter 边界失败。

## Phase 4：Semantic、Report 与复合 delegation

- [ ] 验证 Semantic Agent 只读取冻结 release 的关系证据，不执行 SQL。
- [ ] Report Agent 只消费 accepted QueryEvidence，输出带 source refs 的 Report Artifact。
- [ ] 验证 Root 多 delegation 的依赖顺序与 Team handoff/recovery。
- [ ] 移除/停用生产 Direct QA 的关系正则路由；保留的正则只允许用于输入/安全验证。

Gate：Semantic、Text2SQL、Text2SQL -> Report 和 Root direct 四条路径全部有独立集成测试。

## Phase 5：真实 Q&A 验收与文档同步

- [ ] 更新 agent-team-runtime 与 Text2SQL/provider specs。
- [ ] 运行 packages/contracts、agent-runtime、platform、worker 的 focused test/typecheck/build。
- [ ] 运行完整 release 相关门禁（按仓库脚本与迁移状态）。
- [ ] 启动 Web/Worker，使用用户给出的 workspace/conversation 进行真实 DeepSeek Q&A。
- [ ] 验证页面显示实际 Root/Subagent/tool/Artifact；检查公共 trace 无 prompt、CoT、secret、target 和 raw provider payload。
- [ ] 对比 Intent/Permit/ledger 基线，证明轻量模型调用未恢复旧持久化授权副作用。
- [ ] 仅暂存本任务拥有的文件，创建一个 scoped commit。

Gate：PRD 中所有 Acceptance Criteria 有测试或真实运行证据；若 Falcon 实跑未完成，不得宣称整体落地完成。

## Validation Commands（实施时按实际 package scripts 校准）

```bash
pnpm --filter @data-agent/contracts test
pnpm --filter @data-agent/agent-runtime test
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/worker test
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/agent-runtime typecheck
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/worker typecheck
pnpm verify:release
```

## Commit Boundary

一个实现提交，内容限定为：Root/Provider/Team/Text2SQL 恢复、相应 contracts/platform exports、测试、Trellis specs 与本任务文档。不得包含当前工作区已有的 `apps/web/next-env.d.ts`、`apps/web/tsconfig.tsbuildinfo` 或其他并行改动。

建议提交信息：

```text
fix(agent-runtime): restore root-routed governed text2sql
```

## Hard Blockers

- 当前 Falcon datasource 未绑定 ACTIVE SecretRef，或 `FALCON_READER_PASSWORD` 无法由服务器 resolver 解析。
- V3 lease 没有冻结 catalog/schema snapshot，无法证明 authority exactness。
- PostgreSQL migration/checksum gate 不通过，不能安全读取/提交 Team/Artifact 状态。
- 真实模型不支持 native tool call 且没有可验证的 provider 兼容方式。

遇到 blocker 时保留已通过阶段的测试与诊断证据，不以 Direct QA、固定 SQL、字符串 JSON delegation 或跳过 authority gate 作为替代实现。

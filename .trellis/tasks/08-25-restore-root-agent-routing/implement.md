# 实施记录：恢复 Root Agent 自主 Subagent 路由

> 当前状态：代码实现完成，正在执行最终完整门禁与真实 Q&A 验收。唯一生产路径是 V3 Root Harness；无兼容层。

## Phase 0：故障基线

- [x] 固定 V3 lease、catalog snapshot、Falcon db24 datasource 与失败 Run 证据。
- [x] 确认旧生产链路无条件进入 Direct QA，数据库问题未产生 Text2SQL delegation/QueryEvidence。
- [x] 确认目标实现不恢复 Intent/Permit/ledger。

Gate：故障已从真实运行证据定位到生产组合绕开 Root，而非数据库未授权。

## Phase 1：Root provider turn

- [x] 为模型组合增加 server-owned `AUTO | REQUIRED` tool choice policy。
- [x] Root 使用 `AUTO`；无工具保持 structured output；其他工具路径保持显式策略。
- [x] dispatcher 读取 V3 lease 的冻结 Catalog，构建 Root system message 与唯一原生工具 `delegate_to_subagent@1`。
- [x] provider transport 保持轻量，不接入 certification/Intent/Permit/billing。
- [x] 覆盖 direct final、single/multi delegation、mixed output、unknown tool/profile 与 provider failure。
- [x] 初始 direct answer 由同一个 Root 做一次有界自审；Host 不做自然语言分类。

Gate：真实 DeepSeek 已在相同 Root bridge 上自主产生原生 delegation；一般知识 direct 路径进入同一严格 Harness。

## Phase 2：唯一 V3 Team runtime

- [x] 增加 `@data-agent/platform/agents`、`catalog`、`secrets` 稳定导出。
- [x] Worker 组合 Profile Registry、Team Store、Production Team Runtime、Root turn 与 Root delegation runtime。
- [x] `data-agent-team-runner` 只接受 V3/`ROOT_HARNESS@1`；V1/V2/legacy lease 稳定拒绝。
- [x] 删除 `direct_analysis`、Direct QA executor、关系正则 Router 及固定 business registry。
- [x] 闭合 catalog freeze -> exact V2 profile -> admission -> selected runtime 的 revision/hash/tool binding。

Gate：Root 选择哪个 Profile，只有该 Profile 创建 task/tool/artifact 事件；没有 Host 二次 Router 或兼容旁路。

## Phase 3：通用 Governed Text2SQL

- [x] 定义唯一 `text2sql-query-candidate@1.0.0` contract。
- [x] 加载 exact physical schema snapshot、resolved Semantic Context 与 datasource binding。
- [x] DeepSeek 输出通用 SQL、parameters、result metadata 与 presentation，不再输出 `query_kind`。
- [x] Host AST 编译器把非零 literals 参数化，并从 snapshot 构造 canonical relation allowlist。
- [x] PostgreSQL adapter 执行 EXPLAIN、read-only transaction、role/search_path/timeout/row/byte limits。
- [x] target authority 校验 datasource revision/hash、SecretRef、egress 与 capability hash；target/secret 不进入模型或公开 trace。
- [x] 仅在真实执行成功后提交 `SqlArtifact -> QueryEvidence`；失败候选不形成证据。
- [x] 增加一次有界模型修复与安全 SQLSTATE 分类，不向模型泄露 provider/database detail。
- [x] 删除 Worker 对 ecommerce Direct-QA 固定 SQL/query kind 的生产依赖。

Gate：Falcon db24 真实营销 Join/聚合查询已成功，页面展示四个渠道的真实 QueryEvidence 表格与同源图表。

## Phase 4：Semantic、Report 与可视化

- [x] Semantic Agent 验证 exact historical Release/projection hash，并输出检索、图扩展、推理、截枝、血缘、公式与质量审计。
- [x] Report Agent 仅消费 accepted evidence，并绑定 exact source refs。
- [x] Root 多 delegation 复用 Team task/handoff/acceptance 状态机。
- [x] 表格以 QueryEvidence 为权威；图表从 accepted rows 和类型确定性生成独立 Artifact。
- [x] `订单与客户实体如何关联` 真实运行只选择 Semantic Agent，未执行 SQL。

Gate：Semantic、Text2SQL、Text2SQL -> Report 和 Root direct 四条路径都必须在最终门禁中有测试或真实运行证据。

## Phase 5：最终验收与提交

- [x] 更新 PRD、设计与 `agent-team-runtime` spec，明确无兼容层。
- [x] 完成 contracts、agent-runtime、platform、semantic、worker 的任务相关 test/typecheck/build；Contracts 的全局架构测试仅剩 8 个不在本任务 diff 中的既有根入口债务。
- [x] 完成 Root direct 与 Text2SQL -> Report 的真实 DeepSeek smoke。
- [x] 检查公共 trace 无 prompt、CoT、secret、target 或 raw provider payload。
- [x] 确认 OpenSandbox 容器数量为 0，且本任务没有启动 Python Sandbox。
- [x] 只暂存本任务文件，排除 `apps/web/next-env.d.ts`、`apps/web/tsconfig.tsbuildinfo`，创建 scoped commit。

Gate：PRD 每项 AC 都有自动测试或真实运行证据；未通过不得标记任务完成。

## 真实验收证据（Falcon db24 / DeepSeek）

| 场景 | Run | 结果 |
| --- | --- | --- |
| 渠道营销投入、收入与 ROI 对比 | `1187a162-ee9a-8a3d-a464-a68bf3f23bcb` | `SUCCEEDED`；QueryEvidence `sha256:24d1b611…`；同源图表 `sha256:51f1c94c…` |
| 订单与客户关系 | `ffd4b4e4-78ea-8f9f-b98f-7ebdd0c8fbc9` | `SUCCEEDED`；只选择 Semantic Agent |
| 解释同比增长 | `4359572d-d04e-8ef3-9a0c-aae9f21cf750` | `SUCCEEDED`；两次 Root turn 后保留原始直答正文，无 Subagent |
| 查询渠道 ROI 并生成正式报告 | `aacc2d0a-1102-8913-aee6-242e964061aa` | `SUCCEEDED`；Text2SQL -> QueryEvidence `sha256:23764144…` -> Report `sha256:b325a81f…` |

浏览器确认公开活动只展示模型请求、实际选中的 Subagent、完成状态及已提交 Artifact；没有 prompt、CoT、credential、target 或 raw provider payload。Docker 检查为 0 个 sandbox/opensandbox 容器。

全局 `dependency-boundaries` 仍报告 8 个不在本任务 diff 中的既有文件使用 package 根入口；本任务新增文件与已删除 legacy 文件均已退出该违例清单。这个既有架构债务不纳入当前 scoped commit，也不伪报为已通过。

## Validation Commands

```bash
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/contracts test
pnpm --filter @data-agent/agent-runtime typecheck
pnpm --filter @data-agent/agent-runtime test
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/semantic typecheck
pnpm --filter @data-agent/semantic test
pnpm --filter @data-agent/worker typecheck
pnpm --filter @data-agent/worker test
```

## Commit Boundary

唯一实现提交包含 Root/Provider/Team/Text2SQL/Semantic/Chart 恢复、相应 contracts/platform exports、测试、Trellis specs 与本任务文档。不得包含工作区已有的 Web 生成文件或其他并行改动。

提交信息：

```text
fix(agent-runtime): restore root-routed governed text2sql
```

## Hard Blockers

- Falcon datasource 缺 ACTIVE SecretRef 或服务器 resolver 无法解析。
- V3 lease 缺冻结 catalog/schema snapshot，无法证明 authority exactness。
- PostgreSQL migration/checksum gate 不通过，无法安全读写 Team/Artifact 权威状态。
- 真实模型无法产生可验证的 native tool call。

任何 blocker 都不得用 Direct QA、固定 SQL、字符串 JSON delegation、兼容 facade 或跳过 authority gate 替代。

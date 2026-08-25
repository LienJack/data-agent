# 实施记录：恢复 Root Agent 自主 Subagent 路由

> 当前状态：v12 在首个真实 Run 失败后已硬停止；未重试、未创建 v13。正在提交实际代码/冻结契约变更，完成后才允许建立新版本。唯一生产路径是 V3 Root Harness；无兼容层。

## v12 硬停止与分层定位

- v12 `falcon24-root-v12-final-20260825` 仅启动首个 COLD Run `b9956491-6b28-86ed-9688-f8f3e0b6e5a6`，失败后立即停止，后续 29 个 Run 未启动。
- 固定定位顺序为 `Root 路由 -> SQL/数据准备 -> 治理算子 -> Oracle -> Publisher -> Sandbox 回收`；禁止靠提高 retry/repair 次数继续推进。
- `Publisher` 只有一个含义：Oracle 通过后提交 `DerivedAnalysisEvidence`、图表与报告的权威 Artifact；它发生在 Sandbox 回收之前。回收 receipt 写入与 Campaign current 指针推进属于 `Sandbox 回收` 的同一验收关闭阶段，不得再次标成 Publisher。
- 本次失败由 Oracle 以 `FALCON24_Q1_SEGMENT_DRIVER_MEMBER_MISMATCH` 检出；原因起点是治理算子输入准备中的同类型语义列错绑。Publisher 未提交权威结果，Sandbox 残留容器为 0。
- v12 的 Research L2 `QueryEvidence` 还引用了 11 个未提交的直接输入。轨迹投影必须 fail-closed 为 `RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING` 或 `RESOLUTION_TRACE_ARTIFACT_CORRUPT`，不得把断链投影成可用节点或普通 `BLOCKED` 状态。
- 只有提交实际代码或冻结契约变化后，才允许创建新 campaign；不得自动把 v12 升为 v13。
- v12 证据固定在 `artifacts/falcon24-agent-analysis/v12-hold.json`。

## Phase 0：故障基线

- [x] 固定 V3 lease、catalog snapshot、Falcon db24 datasource 与失败 Run 证据。
- [x] 确认旧生产链路无条件进入 Direct QA，数据库问题未产生 Text2SQL delegation/QueryEvidence。
- [x] 确认目标实现不恢复 Intent/Permit/ledger。

Gate：故障已从真实运行证据定位到生产组合绕开 Root，而非数据库未授权。

## Phase 1：Root provider turn

- [x] 为模型组合增加 server-owned `AUTO | REQUIRED` tool choice policy。
- [x] Root 使用 `AUTO`；无工具保持 structured output；其他工具路径保持显式策略。
- [x] dispatcher 读取 V3 lease 的冻结 Catalog，构建 Root system message 与唯一原生工具 `delegate_to_subagent@2`。
- [x] 多 Agent 分析显式声明同 batch 上游 selector；只有 Text2SQL task 完成且 Verifier `ACCEPTED` 后，Root 才能把持久化的 exact `QueryEvidence` attachment 交给治理分析 Agent。
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

## Phase 5：轨迹、Campaign 与资源回收硬门

- [x] 更新 PRD、设计与 `agent-team-runtime` spec，明确无兼容层。
- [x] PostgreSQL 冻结 30 个有序 slot；`claim/stage/record-reclamation/complete/hold` 均校验 scope、真实 Run 终态、首个失败和精确重放。
- [x] Worker 在领取下一 slot 前先对账已持久化的 terminal `run.failed`；即使 failure hook 抛错，Campaign 也会恢复为 `HOLD`，且不会重放模型、SQL 或治理算子。
- [x] 每次 finalize 重新读取完整轨迹和每个 detail，并验证 `SqlArtifact -> QueryEvidence -> AnalysisReport/Chart -> Report` 的精确引用与 Hash。
- [x] 轨迹 UI 对 corrupt/missing-reference 错误清空旧 ready 快照并显示阻断态；不得在 Authority 已失败关闭后继续展示陈旧轨迹。
- [x] Sandbox 回收 receipt 只接受 runtime 实际执行的 `list -> kill -> confirmed list` 管理面观察；operation UUID、target hash、前后数量/哈希与 observation hash 均由服务端生成并由 PostgreSQL 二次复验。
- [x] Finalize 只有在 Oracle 通过、轨迹闭合、底层 Run 已 `SUCCEEDED`，且 OpenSandbox management API 的 attestation-bound `residual=0` receipt 已进入 PostgreSQL Authority 后才推进 Campaign；不读取本地 receipt JSON，任一失败立即 HOLD。
- [x] 完成迁移 10761–10767 的确定性渲染、静态检查和 clean PostgreSQL 定向 smoke。
- [x] 完成 contracts、agent-runtime、platform、worker、web 与 sandbox 的任务相关 test/typecheck/build。
- [ ] 在实际代码与冻结契约提交且工作树 clean 后创建 v13；逐条执行 30 个真实 DeepSeek/Falcon db24 Run。
- [ ] v13 任一 Run 失败后立即停止，不重试、不继续下一 slot、不创建 v14；先固定六层定位证据。
- [ ] 30/30 通过后运行数据库结果驱动的最终 Gate，并确认无残留 OpenSandbox/container。

Gate：PRD 每项 AC 都有自动测试或真实运行证据；v13 尚未达到 30/30 前不得标记最终验收完成。

## 真实验收证据（Falcon db24 / DeepSeek）

| 场景 | Run | 结果 |
| --- | --- | --- |
| 渠道营销投入、收入与 ROI 对比 | `1187a162-ee9a-8a3d-a464-a68bf3f23bcb` | `SUCCEEDED`；QueryEvidence `sha256:24d1b611…`；同源图表 `sha256:51f1c94c…` |
| 订单与客户关系 | `ffd4b4e4-78ea-8f9f-b98f-7ebdd0c8fbc9` | `SUCCEEDED`；只选择 Semantic Agent |
| 解释同比增长 | `4359572d-d04e-8ef3-9a0c-aae9f21cf750` | `SUCCEEDED`；两次 Root turn 后保留原始直答正文，无 Subagent |
| 查询渠道 ROI 并生成正式报告 | `aacc2d0a-1102-8913-aee6-242e964061aa` | `SUCCEEDED`；Text2SQL -> QueryEvidence `sha256:23764144…` -> Report `sha256:b325a81f…` |

浏览器确认公开活动只展示模型请求、实际选中的 Subagent、完成状态及已提交 Artifact；没有 prompt、CoT、credential、target 或 raw provider payload。Docker 检查为 0 个 sandbox/opensandbox 容器。

以上是 v12 前的历史 smoke，只证明 Root V3 基础路径，不替代新的 30 Run 验收。v12 的首个失败 Run 已按硬规则冻结；新的 v13 只能在本轮代码与冻结契约形成新 commit 后创建。

## Validation Commands

```bash
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/agent-runtime typecheck
pnpm --filter @data-agent/agent-runtime test:unit
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/semantic typecheck
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/worker typecheck
pnpm --dir apps/worker exec vitest run <task-owned-tests>
pnpm --dir apps/web exec vitest run test/falcon24-resolution-trace-gate.spec.ts
uv run --directory services/sandbox --group dev pytest tests/operators
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

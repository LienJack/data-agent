# RQ009 Governed Result Loop 验收账本

基线：RQ009 固定方案、OpenSandbox `180554b146dceec254a5b98318c4c6fad056ff6b`、PostgreSQL 17、
`deepseek/deepseek-v4-flash`。本账本只把可重复执行的测试、实际迁移或实机探针记为通过；缺少 Provider 凭据、生产隔离或
生产 Provider 或隔离证明缺失时保持 HOLD，不用 mock 代替。

## 20 条故障注入

| # | 注入/断言 | 当前证据 | 状态 |
|---:|---|---|---|
| 1 | 模型消息不含 raw operator output | `analysis-tool-loop.spec.ts` 的新鲜与 Journal-recovery 两条消息投影测试 | PASS |
| 2 | 模型消息不含 sealed/temp path | 同一测试断言无 `/workspace/`；publish contract 无 path 字段 | PASS |
| 3 | host、Binding、Publisher 三段 hash 闭合 | runtime Binding hash、ledger load hash、Publisher operator value hash | PASS |
| 4 | 暂存字节或 Binding 返回值被替换即拒绝 | `governed-result-bridge.spec.ts` 与 runtime content-hash fault | PASS |
| 5 | protected prefix 的赋值、删除、alias、`globals()` 修改被拒绝 | `services/sandbox/tests/operators/test_cell_policy.py` | PASS |
| 6 | 绕过策略后修改治理值，Publisher 拒绝 | `result-publisher.spec.ts` 的 changed operator value fault | PASS |
| 7 | generation 重建按序重放 Model Cell + Server Binding | `governed-result-bridge.spec.ts` 的 ordered replay test | PASS |
| 8 | result 已提交、Binding 未提交时只重绑，不重跑算子 | `governed-result-bridge.spec.ts` pending-result test | PASS |
| 9 | 相同幂等键与 request 返回同一 result/receipt | migration 10745 的 ledger lock/replay 分支与 lifecycle exact replay | PASS |
| 10 | 相同幂等键、不同 request 进入 conflict/HOLD | migration 10745 `ANALYSIS_OPERATOR_RESULT_IDEMPOTENCY_CONFLICT` | PASS |
| 11 | Stage 后、Oracle 前崩溃可恢复且无公开 artifact | `analysis-lifecycle-authority.spec.ts` 的 `PUBLISH_STAGE_CREATED` recovery | PASS |
| 12 | Oracle reject 零权威可见提交 | `deterministic-analysis-run.spec.ts` hard-fail case；authority RPC 只接受 durable Oracle record | PASS |
| 13 | stale worker fence 不可写 | `assert_analysis_lifecycle_fence` 锁定 active attempt/outbox fence；迁移实装 | PASS |
| 14 | 最终事务只能 all-old/all-new | migration 10747 单事务写 artifact/current/receipt/outbox，并绑定 stage/operator/oracle/explanation | PASS |
| 15 | Stage 后拒绝 Python/operator/finalize | runtime freeze test 覆盖 Cell、operator 和 finalizer | PASS |
| 16 | Sandbox/egress 清零；过期 orphan stage 回收 | 三 profile 实机均 `0→2→0`；10748–10751 cleanup owner + Worker startup/periodic sweep；PostgreSQL 故障注入 PASS | PASS |
| 17 | `pids=32` 失败，128 在三个 profile 通过 | `opensandbox-analysis-attestation.json` 固定失败与三个实机 profile 峰值 | PASS（功能）；生产隔离另行 HOLD |
| 18 | operator `16 MiB+1`、closure artifact `64 MiB+1` 拒绝 | bridge 与 stage contract 边界测试 | PASS |
| 19 | `/workspace/outputs` 写入/发布路径退役 | publish contract、runtime extraction 与 `sandbox:analysis:unique` | PASS |
| 20 | result/table/chart/operator receipt 同一 closure | stage hash 含三类 artifact、governed refs、operator finalization；10747 再交叉校验 | PASS |

RQ009 当前结论：`20 PASS / 0 HOLD`。Stage cleanup 由 `data_agent_u6_cleanup_owner` 的窄 security-definer RPC 执行：EVIDENCE capability
和 backend scope 双重校验、每批最多 100 条、`FOR UPDATE SKIP LOCKED`、已提交 stage 排除、子表先删、不可变 receipt、范围级串行与幂等冲突拒绝。
普通 Worker 只有 RPC EXECUTE，没有 stage 表权限；cleanup owner 的 UPDATE 仅供行锁，RLS `WITH CHECK false` 与删除专用 trigger 禁止实际更新。

PostgreSQL 17 故障注入结果：`deleted_count=1`、`replay_same_receipt=true`、冲突返回
`ANALYSIS_RESULT_STAGE_CLEANUP_IDEMPOTENCY_CONFLICT`、`committed_stage_preserved=true`，测试事务最终 `ROLLBACK`。

## 运行门禁

- `pnpm exec vitest run`：RQ009 相关 contracts/worker/platform/runtime 测试。
- `uv run pytest tests/operators/test_cell_policy.py -q`：protected symbol AST policy。
- `pnpm sandbox:analysis:unique`：唯一 OpenSandbox Cell Python runtime，PostgreSQL SQL Sandbox 保留。
- `pnpm exec tsx scripts/verify-opensandbox-analysis-attestation.ts`：镜像、lock、operator registry、三 profile 计数。
- `pnpm exec tsx scripts/render-migration.ts 10743 --verify` 至 `10751 --verify`：迁移内容寻址。
- PostgreSQL 17 实际 `pnpm dev:migrate`：10743–10751 已应用。
- `pnpm verify:release`：`GO / RELEASE_READY`；仅代表仓库发布合同通过，不覆盖下列外部硬门禁。
- 收尾资源检查：三个 profile 的 sandbox/egress 均归零，本轮 OpenSandbox server 已停止；无引用的 M0 探针镜像已删除。

## 外部硬门禁

- DeepSeek Strict 真实探测：`0/100`，原因是当前环境没有 `DEEPSEEK_API_KEY`；禁止 fallback，状态 **HOLD**。
- Falcon24 五题 × cold/warm × 3：`0/30`，同一凭据阻断；不得用 fixture 记作真实 DeepSeek 运行，状态 **HOLD**。
- 生产隔离：本地 Docker runc、`secure_access=false` 只证明功能；Kata/gVisor + Cilium 未证明，状态 **HOLD**。

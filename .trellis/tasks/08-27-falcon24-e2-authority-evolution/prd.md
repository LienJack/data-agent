# Falcon24 Semantic Generation 2 与 E4 原子权威恢复

> 执行状态（2026-08-28）：W1-W7 已实施并通过全量验证；被拒绝的 generation-1 repair 现场已按用户授权封存到可恢复审计 stash。
> W8 对专用 E3 数据库应用 migration 与原子激活 E4 仍需再次明确授权；诊断与正式门禁只能在 W8 成功后按 fail-closed 顺序执行。

## 1. Goal

在完整保留 Semantic generation 1 与 Falcon E1/E2/E3 历史的前提下，修复初始语义发布链的数据契约断裂：
由既有唯一语义发布权威在服务器端从固定且已批准的 ChangeSet 编译一个 generation 2 后继 Release，使用与生产读端共享的
运行时闭包校验器和确定性 smoke 证明其可执行，再与 Falcon E4 baseline、workspace defaults 和 current authority 在同一
PostgreSQL 事务内原子激活。原子激活后先完成一条非计分诊断链，只有诊断 PASS 才允许创建 E4-Q1；只有 E4-Q1 16/16
才允许创建 E4-C1，并完成 30/30。

## 2. Verified Execution Evidence

以下是截至暂停点已经核实并纳入实施前置条件的执行现场：

- 执行 worktree 分支为 `codex/falcon24-e1-authority-reset`，暂停时 HEAD 为
  `ed40397940c389b57f15afb6beb9e80a771846a6`。
- 专用数据库容器为 `data-agent-falcon24-e1-e81a29c6`，数据库为 `data_agent`，migration frontier 为
  `20260725010782_app_data_agent_falcon24_analysis_publication`。
- 当前 Falcon Authority Epoch 为 E3；`baseline_id=72f12b06-d18f-5b42-9d3d-cb483d8771f0`，baseline hash 为
  `sha256:8d82bcbfa1a93b1b3c0a163d681a6eb866a5f96101fb2b8b9eaa27477c59cefe`。
- 当前 Semantic pointer 仍为 generation 1；`release_id=3275db1d-d273-5434-a2cf-e186e1306da5`，release digest 为
  `sha256:8ccb810c0444e83075beb59eb2dbeee9da7759200c806a776e8fcab9e74a9d4a`。
- generation 1 的 executable、relationship、runtime restriction 三类生产 projection payload 都仅包含
  `release_set_hash`，无法通过当前生产读路径的可执行投影合同。
- E3-Q1 在 ordinal 0 已不可变 HOLD；首个失败层为 `SQL_DATA_PREPARATION`，错误码为
  `SEMANTIC_RELEASE_PROJECTION_INVALID`。该 attempt 不得 retry、resume 或贡献后续成绩。
- E1、E2、E3 的 Semantic Release staging receipt 的 subject/evidence hash 完全相同；旧 Finalizer 只证明“与前任相同”，
  没有证明 projection 可被生产运行时解释。

因此，本问题不是测试波动或外部瞬态失败，而是发布端与生产消费端之间的数据合同断裂。

## 3. Immutable Boundaries

- **R-G2-01 历史不可变。** 禁止 UPDATE/DELETE generation 1 的 source release、三类 runtime projection、graph、pointer 历史；
  禁止重写 E1/E2/E3 baseline、receipt、activation、Run、gate、Artifact 或诊断事实。保护范围只由本条和完成判定明列的权威历史
  决定；经只读证据确认既不被 current closure/receipt 引用、也不属于上述集合的重构前损坏非权威数据可以丢弃，但只能走已审查的
  lifecycle 或 forward migration，不能用手工 SQL、兼容 fallback 或删除受保护历史来“修复”当前状态。
- **R-G2-02 PostgreSQL 唯一权威。** PostgreSQL 是 Release、stage、pointer、defaults、Falcon current、Run、gate、receipt 与
  outbox 的唯一权威。禁止手工 SQL 修数据、Worker fallback、UI/内存 current 或维护窗口替代事务正确性。
- **R-G2-03 单一发布权威。** `publishReviewedSemanticChangeSet` / `createPostgresSemanticPublicationAuthority` 是唯一 Semantic
  publish authority。必须演进现有 Port/Adapter；不得建立允许 CLI 传 projection payload/digest 的第二写入口。
- **R-G2-04 服务器生成内容。** ChangeSet、review、source snapshot、compiler bundle、四类 projection payload/digest、
  release digest、stage digest 和各类 receipt hash 均由服务器读取固定引用后重新生成或验证。CLI 只可传业务引用、expected
  version/CAS 与 idempotency key。
- **R-G2-05 哈希域分离。** generation 1 的 `release_set_hash` 仅作为历史格式保存。generation 2 使用正常
  `release_digest`；`stage_digest`、`validation_receipt_hash`、`smoke_receipt_hash`、`activation_receipt_hash` 各自有独立
  schema、canonical material 和命名，禁止互相冒充。
- **R-G2-06 Epoch 冻结。** E4 成功激活后，任何 frozen closure 的代码、合同、migration、build 或资产变化都进入 E5；
  不允许在 E4 内替换实现或重新签发 baseline。
- **R-G2-07 真实隔离声明。** `production_isolation_proven=false` 时始终保持 `production_gate=HOLD`；功能 PASS 不得被描述为
  production GO。

## 4. Functional Requirements

### 4.1 Successor staging

- **R-G2-08 候选暂存域。** generation 2 必须先进入独立 staging domain，不得在 smoke 之前写正式
  `semantic_source_release` 或推进 production pointer。
- **R-G2-09 状态机。** Stage 状态仅允许 `STAGED -> SMOKE_PASSED -> PROMOTED` 或
  `STAGED -> REJECTED`。Payload identity 插入后不可变；只允许受控 CAS 状态转换。
- **R-G2-10 多失败历史。** 同一 target generation 可有多个历史失败 `stage_id`，但同一 scope/target generation 只能有一个
  live stage。只有 `PROMOTED` stage 才能进入正式 Release 表。
- **R-G2-11 幂等与崩溃安全。** 同 idempotency key + 同 canonical input 返回同一 stage；同 key 不同 input 冲突；stage
  事务中断不得留下 header、projection 或 receipt 的半写状态。

### 4.2 Shared runtime validation

- **R-G2-12 单一闭包校验。** 从 Worker 生产读端提取共享 `verifySemanticReleaseEnvelope` /
  `validateSemanticRuntimeClosure`，Semantic publisher stage 与生产 read port 必须调用同一实现。
- **R-G2-13 可证明范围。** 校验 schema/version、canonical digest、release digest、ID/reference closure、datasource/release
  一致性、metric formula/aggregation/binding/dependency、dimension binding/hierarchy、relationship endpoints/join、Formula AST
  slot/dependency、time domain/time column、runtime restriction 与 graph/source binding。
- **R-G2-14 不超额声明。** 当前 schema 无法结构化证明的内容不得伪装为 PASS。例如 quality constraint 仍为自由文本时，只校验
  可结构化引用；若要证明字段引用，必须先演进合同并提供兼容与 migration 策略。

### 4.3 Deterministic smoke

- **R-G2-15 Worker-owned smoke。** Stage smoke 由 Worker 精确加载 `stage_id`，不调用模型/provider、不创建计分 Run，
  使用共享闭包校验器并构造确定性语义计划。
- **R-G2-16 固定 smoke 目标。** 计划固定使用 `metric.order_revenue`、`dimension.order_month`、窗口
  `[2023-11-01T00:00:00Z, 2024-11-01T00:00:00Z)`，明确 `Asia/Shanghai` 日历语义。
- **R-G2-17 Smoke receipt。** `semantic-runtime-smoke-receipt@1.0.0` 必须绑定 stage、candidate Release、四类 projection
  digest、resolved IDs/bindings、plan hash、validator/build identity、PASS/FAIL 与 receipt hash。PASS CAS 为
  `SMOKE_PASSED`；语义失败终结为 `REJECTED`；进程中断保持 `STAGED`，可用同一幂等键重放。

### 4.4 E4 proof and atomic activation

- **R-G2-18 Proof v2。** `falcon24-semantic-release-authority-proof@2` 必须绑定 generation 1 predecessor、generation 2
  candidate、四类 projection、ChangeSet、review、source snapshot、compiler bundle、validation/smoke receipts 与 expected
  semantic pointer/runtime/default versions。旧 generation-1 proof builder 仅用于历史读取。
- **R-G2-19 合法后继而非相等。** Successor proof 证明 lineage、`generation=current+1`、CAS 与 candidate closure；删除
  “successor subject/evidence 必须等于 predecessor”的错误条件。
- **R-G2-20 单事务切换。** generation 2 正式 promotion、semantic pointer/runtime、workspace defaults、E4 baseline/session/current、
  semantic outbox、combined activation receipt 与 stage `PROMOTED` 必须在同一 PostgreSQL 事务内完成。任何错误只能观察
  all-old（gen1/E3）或 all-new（gen2/E4）。
- **R-G2-21 固定锁顺序。** 全局顺序为 semantic fence，随后 Falcon advisory/current locks，再锁 semantic pointer/runtime、
  workspace defaults、current Epoch、candidate stage、E4 baseline、attempt/session；所有写入口必须遵循同一顺序。
- **R-G2-22 污染拒绝。** 激活前必须证明尚无 E4 formal Run、config、Artifact、gate 或 diagnostic 污染，并验证 baseline exact
  绑定 candidate generation 2 与 smoke receipt。
- **R-G2-23 提交后核对。** Finalizer 提交后必须通过生产 read port 重新加载 semantic pointer、runtime pointer、workspace
  defaults 与 current E4 并逐项核对 exact ref；不一致时只能报告严重故障并冻结执行，禁止原地补写。

### 4.5 Diagnostic and formal gates

- **R-G2-24 单次非计分诊断。** 原子激活后先且只执行一个 active diagnostic attempt，固定业务问题为：
  “最近 12 个完整月的订单收入趋势如何？请按月展示，并生成折线图。”
- **R-G2-25 诊断证据。** 必须从真实 Q&A 页面提交，并在 exact Run 可用 Trace UI 证明
  `Semantic -> Text2SQL -> SQL -> QueryEvidence -> typed Arrow -> Python operator -> AnalysisReport -> Chart` 与
  residual=0。API-only、直达 Trace URL、`BLOCKED` 节点或后端日志不能通过。
- **R-G2-26 诊断失败。** Frozen closure 需修改时进入 E5；只有已证明为外部依赖且 frozen closure 未变，才可创建新的
  diagnostic attempt，绝不 resume 同一 Run。
- **R-G2-27 E4-Q1。** 诊断 PASS 后，单一 immutable attempt 严格串行完成 G1=1、G2=5、G3=5、G4=5，合计
  16/16；首次失败立即 HOLD，无 retry/resume/跨 attempt 拼接。
- **R-G2-28 E4-C1。** 只在同一 E4 baseline 的 winning E4-Q1 存在后创建，严格完成 5 题 × COLD/WARM × 3 = 30/30；
  首次失败立即 HOLD，Qualification Run 不得复用。

## 5. Acceptance Criteria

- [x] **AC-G2-01** Exact E3 fixture 升级前后，generation 1 与 E1/E2/E3 的行数、identity、hash、document 和 projection bytes
  完全不变；正式表具有数据库级 UPDATE/DELETE 防护与最小 grants。
- [x] **AC-G2-02** generation 2 由唯一 Semantic publication authority 基于 fixed refs 在服务器端编译；客户端不能伪造
  payload/digest；stage header、四类 projection 与 validation receipt 原子写入。
- [x] **AC-G2-03** Shared validator 被 publisher stage、Worker smoke 和生产 read port 共用，负例矩阵覆盖 metric、dimension、
  relationship、formula、time、quality 与 runtime restriction。
- [x] **AC-G2-04** Deterministic smoke 精确加载 stage、零模型/provider 调用，PASS/REJECT/replay/crash 行为符合状态机并产生
  可复核 receipt。
- [x] **AC-G2-05** Combined activation 的失败注入和并发测试只观察 all-old 或 all-new；workspace defaults、semantic
  pointer/runtime 与 Falcon current 永远不存在跨代混合。
- [x] **AC-G2-06** `falcon24-semantic-release-authority-proof@2` 证明 predecessor->candidate lineage、generation+1、四类
  projection 与 validation/smoke receipts，不再要求 successor 等于 predecessor。
- [ ] **AC-G2-07** 原子激活后 exact current 为 generation 2/E4，生产端口重载核对全部 exact refs；combined activation
  receipt、outbox 与 stage PROMOTED 完整。
- [ ] **AC-G2-08** 单一诊断 attempt 通过真实 Q&A 与 Trace UI 证明完整链、Artifact 可用和 residual=0；其结果不计分。
- [ ] **AC-G2-09** E4-Q1 达到 16/16，随后 E4-C1 达到 30/30；每个正式 slot 均有同源 QA/Trace UI receipts 与 exact
  Run/baseline/build/gen2 release 绑定。
- [x] **AC-G2-10** Contracts、Semantic、Platform、Worker、Web、PostgreSQL 17 fresh/upgrade、concurrency、RLS/security、
  build/typecheck 和 public-data scans 全部通过；每个批准后的实施包有 focused validation 与独立 scoped commit。
- [ ] **AC-G2-11** 最终报告明确 generation 1/E1-E3 未变、gen2/E4 identities、diagnostic、16/16、30/30、residual=0，
  并如实保留 `production_isolation_proven=false` / `production_gate=HOLD`。

## 6. Rejected Alternative: Repair Generation 1 Projections In Place

原 worktree 中未提交的 `repair_falcon24_bootstrap_projections` 方向被明确否决。六文件现场已按用户明确授权封存到
`audit/rejected-generation1-repair-2026-08-28` 命名 stash，且 tracked diff/untracked blob 指纹复核一致；不得 restore 到执行路径、
drop、提交、执行或用于修改数据库。否决原因：

1. **违反不可变性。** 原地 UPDATE generation 1 projection payload 会改变 E1/E2/E3 已经引用的历史 Release bytes。
2. **形成第二发布权威。** 允许 CLI 传入 projection payload/digest 并由修复 RPC 接受，绕过现有 reviewed ChangeSet publisher。
3. **缺少运行时证明。** 仅校验 payload hash 等于既存 digest，不能证明生产闭包、binding 与 deterministic plan 可执行。
4. **破坏原子性。** 先补 semantic payload、后激活 E4 会产生可观察的 gen1 已变/E3 仍 current 窗口；服务暂停不能补救。
5. **错误延续 predecessor equality。** 修补旧 bytes 后仍沿用同一 release/staging proof，无法表达合法 successor lineage。

正确路径是 immutable generation 1 + staged generation 2 + shared validator + deterministic smoke + combined E4 activation。

## 7. Out of Scope

- 原地修复、删除或重写 generation 1/E1-E3 历史。
- 手工 SQL、隐藏 compatibility shim、Worker fallback、双 publisher 或第二 current pointer。
- 用模型生成 projection payload/digest，或让 CLI 代替服务器编译。
- 在 smoke 前写正式 generation 2 source release，或分两次提交 semantic 与 Falcon activation。
- API-only 门禁、直接 Trace URL、恢复旧 attempt、跨 attempt 拼证据或放宽 Oracle/closure validator。
- 伪造 production isolation、部署生产、修改外部 OpenSandbox 基础设施。

## 8. Planning Gate

W1-W7 已完成并通过 focused/full validation 与 scoped commits。被拒绝的 generation 1 repair 只保留在命名审计 stash 中，不得恢复
或执行。W8 仍是独立授权边界：在再次批准前不得向专用 E3 数据库应用 migration、调用 activation RPC、创建 E4 diagnostic/gate
attempt 或运行正式门禁。

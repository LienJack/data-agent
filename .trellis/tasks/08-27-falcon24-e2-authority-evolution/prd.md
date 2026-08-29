# Falcon24 Semantic Generation 2、E4 原子恢复与 E5 前向构建权威

> 执行状态（2026-08-29）：W1-W8-R4 已完成。10797 已应用，`e432` 已经既有 capability authority 封存为 `HOLD`；clean build 上
> 唯一一次 `e433` Finalizer 已把 generation 2 与 E4 在同一事务中激活并通过 production-port readback。当前 exact authority 为 E4，
> semantic pointer/runtime/workspace defaults 均为 generation 2，E4 diagnostic、qualification 与 campaign 均为零。
> E4 build attestation 随后被证明错误包含 Turbo 已明确排除的 `.next/cache/**`：dry-run 的 `excludedOutputs` 在
> `parseTurboBuildDryRun` 中被丢弃，导致证明签入不可重建 cache bytes。E4 已冻结且不可原地重签。用户已明确授权进入 E5 并无人值守执行；
> 本文第 12 节为该授权的前向修正，出现冲突时以第 12 节为准。

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
- **R-G2-07A 固定 ChangeSet 与真人批准。** Falcon24 generation 2 的 ChangeSet 必须由服务端执行固定仓库 builder 后按合同重验，
  先进入 scope 级幂等、append-only 的 review-preparation 域。评审只能由当前 reviewer policy 下的真人通过治理 Port 提交；Finalizer
  不接受外部 ChangeSet/review hash，不自动批准，未获得 exact APPROVE document 时稳定停止。

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
- [x] **AC-G2-07** 原子激活后 exact current 为 generation 2/E4，生产端口重载核对全部 exact refs；combined activation
  receipt、outbox 与 stage PROMOTED 完整。
- [ ] **AC-G2-08** 单一 E5 诊断 attempt 通过真实 Q&A 与 Trace UI 证明完整链、Artifact 可用和 residual=0；其结果不计分。
- [ ] **AC-G2-09** E5-Q1 达到 16/16，随后 E5-C1 达到 30/30；每个正式 slot 均有同源 QA/Trace UI receipts 与 exact
  Run/E5 baseline/build/gen2 release 绑定。
- [x] **AC-G2-10** Contracts、Semantic、Platform、Worker、Web、PostgreSQL 17 fresh/upgrade、concurrency、RLS/security、
  build/typecheck 和 public-data scans 全部通过；每个批准后的实施包有 focused validation 与独立 scoped commit。
- [ ] **AC-G2-11** 最终报告明确 generation 1/E1-E3 未变、gen2/E4 frozen identities、E5 identities、diagnostic、16/16、30/30、residual=0，
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
或执行。用户已对 packet `801bfa69-2ea6-49d9-9a6a-676b0e3facd6` 作出 exact APPROVE，并明确批准 W8。第一次 Finalizer 只执行一次，
以 `SEMANTIC_SUCCESSOR_DEPENDENCY_POINTER_REQUIRED` HOLD；只读核对证明 stage/E4/diagnostic 均为零、current 仍为 E3/gen1。
10794 已应用并通过 all-old 历史核对；10794 后第一次 Finalizer 生成 generation 2 stage、完成 deterministic smoke，随后以
`BUILTIN_TEAM_SKILL_REVISION_CONFLICT` 停止。10795 已应用，`e430` 已以原 failure code 封存为 `HOLD`。commit
`eedf64cfdcb213ae66669ce4299df8ebe3ff9d17` 的 clean build 上，使用新 staging id `e431` 的 Finalizer 只执行一次，并因旧 smoke
idempotency key 与新 Worker receipt command hash 冲突而返回 `FALCON24_SEMANTIC_SUCCESSOR_SMOKE_PROCESS_FAILED`；只读审计证明
`e431` 未落库且 current 仍为 E3/gen1。用户已批准 W8-R3；10796 应用后只允许使用全新 `e432` 执行一次 Finalizer，不得重用
`e431`、直接 UPDATE receipt/stage 或连续重跑。E4 成功前不得创建 diagnostic/gate attempt 或运行正式门禁。

## 9. W8-R2 Requirements and Evidence

- **R-G2-32 Skill revision immutability。** `Frozen Semantic Definitions`、`Frozen Semantic Relationships`、
  `Frozen Semantic Lineage` 的当前 body 与历史 revision 2 bytes 不同，必须追加 revision 3 并通过既有 Skill Registry CAS 推进 head；
  禁止改写数据库 revision 2 或把当前 body 继续发布为 revision 2。
- **R-G2-33 Pre-baseline session recovery。** Supporting receipt/Team materialization 在 baseline 创建前失败时，Finalizer 必须调用
  `hold_falcon24_authority_staging_session(jsonb)`，只允许 exact successor、exact staging id、exact retained-assets hash 且无 baseline 的
  `STAGED -> HOLD`。同一 failure code 可重放；不同 reason、错误 hash、已有 baseline 或 terminal session 必须失败关闭。
- **R-G2-34 No direct recovery DML。** 已遗留的 `e430` 只能通过显式确认的
  `hold:falcon24-authority-staging` CLI 和 capability-authorized Port 封存；CLI 不包含 `pool.query`/`client.query`，也不接受任意 session payload。
- **R-G2-35 New attempt identity。** `e430` 成为 HOLD 后不得恢复、清空 receipt 或重新 STAGED。下一次 Finalizer 必须使用新 staging id、
  新 clean build identity 和当前源码产生的 AGENT_PROFILES receipt；generation 2 stage/smoke 可按原幂等身份精确复用。
- 实现 commits：`297b8ead`（三个 Semantic Skill 追加 rev3）与 `2305d9c6`（Contracts/Platform/Web/10795 recovery）。
- 10795 rendered checksum 为 `sha256:6a367834c337db45823104c28e4ecc2445b3ab73270fb0bbf766a20aad4f6d9d`；已在专用容器内
  exact `data_agent` clone 上通过 PostgreSQL 17 apply、owner/grant/postcondition、HOLD/replay/conflict 验证，scratch database 已删除。
- 专用权威 `data_agent` 已为 frontier 10795，Falcon E3、semantic gen1，`e430=HOLD`；新 `e431` 未落库，E4 baseline/activation 为零。

## 10. W8-R3 Build-bound Smoke Revalidation

- **R-G2-36 Build-bound idempotency。** Finalizer 的 successor smoke 幂等身份必须绑定 exact `stage_identity` 与完整
  `RuntimeBuildIdentity`，使用 `falcon24-e4-successor-smoke-identity@2.0.0` canonical hash 派生 key。同 stage/同 build 返回同一 key；
  build identity 任一字段变化必须产生不同 key。
- **R-G2-37 Append-only revalidation。** `semantic.commit_semantic_successor_smoke(jsonb)` 保留 `STAGED` 首次 PASS/FAIL 状态机，并允许
  `SMOKE_PASSED + new key + PASS` 追加新的 build-bound SMOKE receipt。旧 validation/smoke receipt、stage identity 与
  `smoke_passed_at` 不得更新或删除。
- **R-G2-38 Revalidation fail closed。** `SMOKE_PASSED + FAIL`、同 key/不同 command、重复 receipt hash、错误 stage digest 或 receipt
  closure 必须整笔失败；stage 保持 `SMOKE_PASSED`，receipt count/hash 不变。
- **R-G2-39 Exact proof binding。** Finalizer 必须使用本轮 Worker 真实返回并经 Port 重验的 `smoke_receipt_hash` 构造 proof v2 和 E4
  baseline。不得搜索“任意最新 PASS”、复用旧 build receipt 或覆盖旧 receipt。
- 实现 commit `cd09c721`；10796 是 10795 之后的 forward migration，只 `CREATE OR REPLACE` 唯一 smoke commit RPC，并在迁移事务前后对全部既有 successor
  stage/receipt 做 ordered canonical count/hash 比较；rendered checksum 为
  `sha256:4b3541be45d3e117510a497910de45f918b7a12111c338348b7bbd1de8217286`。
- exact `data_agent` clone 上已验证：新 Worker build 追加 PASS、same-key replay 返回同一 receipt、same-key/different-build conflict、
  `SMOKE_PASSED + FAIL` 返回 `40001` 且零状态/历史变化。scratch database 已删除，未创建新 Docker container。
- 10796 已应用到专用权威库，frontier/checksum exact；迁移本身未改变 stage/receipt bytes、E3 或 gen1 current。
- clean build 绑定 commit `58aa8c4beff99688dda20762db7a6fb839d21003`，generation
  `sha256:301255df49d96d59c9b25ebe72b33c824d904b55b7be62ee7a33a8e794dd87c9`，`git_dirty=false`。
- `e432` Finalizer 只执行一次并返回 `FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH`。新 smoke receipt
  `sha256:4537769aa592b9b931991b93cab7761e7d26c66474071572792a2faaa97d6524` 已 append；stage 仍 `SMOKE_PASSED`。
- `e432` baseline `8f38ab8f-5325-512a-b082-6ed0ad99b50f` / `sha256:f5bfc0673721900c679814cd530a46f1706ec8b2a2d271db77d0c179c1d68ead`
  为 `STAGED`，attempt `b7f671ea-3e0b-5ed0-afdc-638eca529037` 为 `OPEN`；semantic/Falcon current、defaults、E4 diagnostic/formal counts
  仍为 all-old E3/gen1/zero。

## 11. W8-R4 Review Gate: Activation Hash Domain and Attempt Closure

- **R-G2-40 Source revision hash domain。** `semantic_source_revision.source_digest` 是 fixed ChangeSet digest，必须与
  `stage.change_set_hash` 比较；`stage.source_snapshot_hash` 是 physical schema snapshot digest，只能同 exact snapshot evidence 比较。
  两者不得要求相等。
- **R-G2-41 Candidate revision closure。** Combined activation 必须同时验证 source revision、candidate revision 与 stage authority IDs：
  source revision digest=ChangeSet hash；candidate revision 的 `source_revision_id` 与 `revision_digest` 分别等于 stage source revision 与
  ChangeSet hash；candidate head 仍为 `PUBLISHING` 且指向 exact candidate revision。
- **R-G2-42 Post-baseline failure closure。** Combined promotion 失败后，Finalizer 必须用既有
  `holdActivationAttempt` Port 将 exact OPEN attempt、STAGED baseline/session 原子终结为 HOLD，并保留原稳定 failure code。进程若在错误与
  HOLD 之间崩溃，只能通过 confirmation-gated capability CLI 对 exact refs 恢复；禁止直接 DML。
- **R-G2-43 Fresh attempt identity。** `e432` 终结 HOLD 后不得重开、复用 baseline 或 attempt。10797 与自动 HOLD 逻辑经审查、测试、提交、
  应用后，必须用新 clean build 和全新 `e433` 只执行一次 Finalizer。
- 计划中的 10797 只前向 `CREATE OR REPLACE` combined activation RPC，迁移前后 snapshot 全部既有 successor/Falcon staging/baseline/attempt
  history；不修改 10783、不更新 e432、不创建第二 activation authority。
- 用户已明确批准 W8-R4。实现 commit `04d5db4e` 固定 10797 checksum
  `sha256:c5afa3d4b8babc91b61b2bd3d6f3edc18324502254270d08e8d63049dc18e984`，并完成 Web/Platform/Contracts 全量、三层 typecheck、
  renderer/inventory/Biome 与 PostgreSQL 17 populated-clone 验证。权威执行仍按独立 gate：先用 Port 封存 e432，再应用 10797，最后只运行一次 e433。

## 12. E5 Forward Build Authority Amendment

### 12.1 Verified trigger and immutable boundary

- E4 已于 `2026-08-28T11:59:59.741684Z` 激活；baseline
  `4e52c876-0bd4-56b0-9407-87e2eb3418c0` / `sha256:e63c3074e81a455b0457d4330d6c53d05a6e59001d3c9455ede6b6a3eee25b98`
  与 activation attempt `18d48688-5737-5952-b2d8-cb3fcd578012` 只读冻结。
- 当前 semantic Release 为 generation 2：`18472091-59b1-5d86-b399-9605ca627040` /
  `sha256:9c53ca74db82181ff46a591ee4e2b88d63e5c9b4e6e3fa157f10fa085ca74dd6`。E5 不编译 generation 3，不推进 semantic
  pointer/runtime/defaults；它只证明并冻结新的可重建 Web/Worker build closure。
- `turbo --dry=json` 对 Web 同时返回 `outputs=[".next/**"]` 与 `excludedOutputs=[".next/cache/**"]`。当前 parser 只保留前者，
  因而 E4 attestation 错误签入 cache。禁止修改、替换或重签 E4 attestation、baseline、receipt 或 activation。

### 12.2 E5 requirements

- **R-E5-01 Output identity 完整。** `TurboBuildTaskIdentity` 必须同时规范保存 include outputs 与 excluded outputs；task signature、
  attestation schema、hash、readback 和 guard 使用同一 canonical identity。`.next/cache/**` 的任意创建、删除或 byte 变化不得改变 Web output digest。
- **R-E5-02 证明版本前进。** 新 attestation 使用 `workspace-build-attestation@2.0.0`；v1 只读验证历史。v2 对缺失、重复、绝对路径、`..`、
  空 include、include/exclude 冲突和越界 symlink fail closed；不得把未知 Turbo 字段静默解释为已证明输出。
- **R-E5-03 Retained semantic proof。** 新 `falcon24-retained-semantic-release-authority-proof@1.0.0` 绑定 target E5、exact current E4、
  exact generation-2 release、semantic pointer/runtime/workspace-default versions、datasource、四类 production projection digest 与新 build identities。
  服务端通过 production read ports 重算该证明；CLI 不传 proof digest 或 semantic payload。
- **R-E5-04 单一 activation authority。** 演进既有 `activate_falcon24_authority(jsonb)` 接受
  `falcon24-activation-request@3.0.0`，不得新增第二 current pointer 或第二 Falcon activation authority。v2 保留为 E2/E3 历史兼容；v3 只允许
  `expected current=E(n-1)`、`target=En` 且 target ordinal 至少 5。
- **R-E5-05 单事务 retained rollover。** v3 在一个事务中锁 Falcon activation fence/current、semantic pointer/runtime、workspace defaults、
  E5 stage/baseline/attempt；验证三类 semantic refs 仍为 exact gen2、E5 无 Run/config/artifact/diagnostic/gate 污染、六类 receipt exact 后，
  仅激活 E5 baseline/session/current。semantic rows 与 defaults bytes/version 必须保持不变。
- **R-E5-06 锁序。** 所有相关入口统一为 semantic fence advisory lock -> Falcon activation advisory lock -> Falcon current -> semantic pointer/runtime ->
  workspace defaults -> stage/baseline/attempt。锁序由 migration 注释、并发测试和失败注入共同固定。
- **R-E5-07 崩溃恢复。** stage/receipt/baseline 失败通过既有 capability HOLD authority 终结；activation 失败只能观察 E4/gen2 全旧状态；
  activation 成功后不回退 E4。任何后续 frozen closure 修改必须进入 E6。
- **R-E5-08 E5 诊断与门禁。** 诊断、qualification、campaign 合同不再写死 E4，而是绑定 canonical current epoch；E5 唯一 gate IDs 为
  `E5-Q1` 与 `E5-C1`。E4 零 diagnostic/gate 事实保持不变。诊断问题与动态 Tool Loop/full Trace UI/residual=0 要求不变。
- **R-E5-09 首败停止。** E5 单一诊断首次失败即写 immutable FAIL/HOLD 并停止；E5-Q1 或 E5-C1 任一首个 slot 失败即 HOLD，不 retry、
  resume、跨 attempt 拼证据或用 API-only 代替答案入口 Trace UI。

### 12.3 E5 acceptance

- [ ] **AC-E5-01** cache mutation characterization 失败后，v2 parser/attestation 测试证明 excluded outputs 被保存、哈希并执行；v1 历史仍可读。
- [ ] **AC-E5-02** 10798 PostgreSQL 17 fresh + exact E4 clone upgrade、rollback、RLS/security、failure injection 和 concurrency 全部 PASS；
  E1-E4、gen1/gen2、pointer/runtime/default bytes 无漂移。
- [ ] **AC-E5-03** E5 clean build/attestation `git_dirty=false`，guard 在 cache 删除、重建和增量写入后保持稳定，非 cache output 变化稳定拒绝。
- [ ] **AC-E5-04** capability-gated Finalizer 只运行一次并原子得到 E5/gen2；post-commit production readback 证明 Falcon current=E5，
  semantic pointer/runtime/defaults exact 未变，E4 immutable facts 未变。
- [ ] **AC-E5-05** 唯一 E5 diagnostic PASS；随后 E5-Q1 16/16、E5-C1 30/30、exact Run Trace UI 与 residual=0 全部可复核。
- [ ] **AC-E5-06** 最终仍如实报告 `production_isolation_proven=false` / `production_gate=HOLD`，瞬态容器和轮换凭据完成回收。

## 13. 2026-08-29 audited terminal status

E5 已成功激活，但其唯一 exact Web build bytes 随后的本地 Next build 被覆盖且不可由 clean build 重现。按照 epoch 冻结边界，没有伪造或
回签 E5；实现以已提交的 retained-authority 通用化前进到 E6。E6 在 commit
`86ce7f1d1ae50ef74df5d935a5199470503b4890` 上原子激活，current baseline 为
`a3a275b5-7584-57e3-afcf-37cd229de675`，semantic pointer/runtime/defaults 仍是 exact generation 2，受保护的 generation 1、
E1-E5 历史没有被修改。

唯一 E6 非计分 diagnostic attempt `133460e8-0d5e-5ae5-ba20-1709f08b1796` 的 exact Run
`f0e98c36-18dd-8f12-bd9b-df7c05212f37` 在第一次 Root model preflight 以
`PROVIDER_PROFILE_NOT_AVAILABLE`、`retryable=false` 失败。修复需要改变 baseline 已冻结的 `AGENT_PROFILES` closure，因此失败分类为
`FROZEN_CLOSURE_CHANGE_REQUIRED`；禁止将其解释为可重试外部依赖。E6-Q1/E6-C1 均未创建。

失败 receipt 的唯一 CLI 调用被 `FALCON24_DIAGNOSTIC_SEMANTIC_RELEASE_MISMATCH` 拒绝。只读代码/数据库审计证明
`createPostgresFalcon24DiagnosticAuthority.complete` 没有像 `begin` 一样向事务传入 `semantic_domain`；在 forced RLS 下
`semantic_runtime_activation` 对 RPC owner 不可见，而数据库中 pointer/runtime/attempt 的 exact generation 2 值实际一致。当前 attempt
因而仍为 `ACTIVE` 且 receipt count=0。不得用手工 SQL、临时调用面或非 E6 build 绕过；这是新的 frozen-closure 缺陷。根据首次正式诊断失败
stop condition，本轮在此停止，不能声称 AC-E5-05 或总任务完成。

## 14. E7 forward recovery amendment

用户在 E6 首败现场冻结并完成清理后明确授权继续。E7 只允许前向修复两个已证实的缺口：Diagnostic completion 的
`semantic_domain` 事务上下文遗漏，以及 exact Effective Model 缺少 `AVAILABLE` execution certification。E6 Run、event、attempt、
baseline、semantic generation 2 与所有更早历史保持原字节；不得 resume E6 Run、制造第二个 E6 diagnostic、直接 DML 或把失败改判为
外部依赖。

### 14.1 Requirements

- **R-E7-01 Single diagnostic authority.** Platform `complete` 与 `begin` 一样在同一 capability transaction 设置
  `app.semantic_domain=falcon24`。E6 orphan 不由新 CLI 或手工 SQL关闭；唯一 `complete_falcon24_diagnostic(jsonb)` 由 E7 activation
  request@4 在同一事务内调用。
- **R-E7-02 Exact predecessor failure.** request@4 必须绑定 E6 attempt/run/manifest、exact current E6 authority、gen2 release、Run terminal
  event `PROVIDER_PROFILE_NOT_AVAILABLE` 与 `retryable=false`。只允许
  `FROZEN_CLOSURE_CHANGE_REQUIRED / PROVIDER_PROFILE_NOT_AVAILABLE`；已有 receipt、非 ACTIVE attempt、非 FAILED Run 或任何 E6 Q1/C1
  均失败关闭。
- **R-E7-03 All-old/all-new recovery.** 10799 的单一 `activate_falcon24_authority(jsonb)` 在一个 PostgreSQL transaction 中调用既有
  diagnostic completion、推广 E7 provider certification、激活 E7 baseline/session/current。失败时保持 E6 attempt ACTIVE + current E6；
  成功时只观察 E6 attempt FAILED + immutable receipt + current E7。
- **R-E7-04 Real execution certification.** E7 不把历史 API authentication 当作 execution certification。必须以真实 DeepSeek credential
  smoke 生成 `model-execution-certification@1.0.0`，精确绑定 system-default profile/config、deployment、context window、
  `AT_LEAST_ONCE_ONLY` 与 canonical receipt hash。
- **R-E7-05 Candidate visibility fence.** certification 先通过演进后的唯一 ModelCertificationReceipt store 写成非 active candidate，并绑定
  exact E7 staging id。`list_provider_execution_profiles()` 只读取 active、由 current E7 binding 推广且与 LLM staging proof exact 的 receipt；
  候选在 E6、崩溃窗口或错误 target 下不可见。
- **R-E7-06 LLM proof evolution.** E5/E6 historical LLM predecessor-equality 只读保留。E7 LLM supporting proof 的 subject 继续绑定相同
  model/provider authority，evidence 前进并加入 exact certification ref/hash/execution-profile hash/build/deployment；不得伪称新 evidence 与
  E6 相等。
- **R-E7-07 Dynamic Tool Loop unchanged.** E7 只修 authority closure。Root 每轮仍只决定当前 Tool Call；不存在业务 DAG、固定路由、
  keyword dispatch 或 Host 预声明未来链路。
- **R-E7-08 Formal first-failure rule.** E7 只允许一个非计分 diagnostic。PASS 后才可依次 E7-Q1 16/16、E7-C1 30/30；任一正式阶段首败
  必须写 immutable FAIL/HOLD 并停止，禁止 retry/resume/跨 attempt 拼证据。

### 14.2 Acceptance

- [ ] **AC-E7-01** Adapter regression 证明 begin/complete 均设置 exact semantic domain；forced-RLS PostgreSQL 负例不再把一致的 pointer/runtime
  误报为 release mismatch。
- [ ] **AC-E7-02** 10799 fresh + exact E6 populated upgrade、RLS/security、failure injection、replay 与双连接 concurrency PASS；E1-E6、gen1/gen2
  和原 E6 Run/event bytes 在迁移前后不变。
- [ ] **AC-E7-03** 真实 DeepSeek certification candidate 在 E6 不可被 execution-profile reader 选中；E7 原子激活后 exact profile 为
  `AVAILABLE`，且回执、LLM proof、baseline 和 current binding 完整闭合。
- [ ] **AC-E7-04** E7 activation 后 E6 attempt=`FAILED` 且恰好一个 receipt，current=E7，semantic pointer/runtime/defaults 仍 exact gen2，
  不存在中间混合状态。
- [ ] **AC-E7-05** 唯一 E7 diagnostic 通过真实 composer 与答案入口 Trace UI 证明
  Semantic -> Text2SQL -> SQL -> QueryEvidence -> typed Arrow -> Python -> AnalysisReport -> Chart，五类 Artifact 可用且 residual=0。
- [ ] **AC-E7-06** E7-Q1=16/16、E7-C1=30/30；最终审计仍如实保留
  `production_isolation_proven=false / production_gate=HOLD`。

### 14.3 Operational preflight

真实认证前必须从受控进程环境解析 `DEEPSEEK_API_KEY`，绝不写入参数、日志、数据库或 evidence。变量缺失时 certification CLI 在创建
Run/candidate 前返回零写入 HOLD；不得用历史 credential ref、认证时间戳、假响应或其他模型代替。该项是外部 secret 前置条件，不授权读取
shell history、日志或其他非权威残留来恢复密钥。

## 15. E8 provider-reader binding recovery amendment

E7 已在一次 request@4 中原子激活：E6 orphan diagnostic 现为 immutable FAILED 且只有一个 receipt，真实 DeepSeek certification stage
已 PROMOTED，semantic pointer/runtime/defaults仍为 exact generation 2。提交后 production reader却把 exact target profile降级为
`STALE/selectable=false`。只读比对证明原始 profile与 stage的 profile/config/execution hash/certification ref七项全部相等；10799 wrapper在
选择 stage时错误写成 `current_epoch.activation_attempt_id=stage.activation_attempt_id`，其中 `stage` 是尚未赋值的 PL/pgSQL record，表别名实际为
`row`。因此查询永不选中 candidate。这是 E7 frozen closure缺陷；E7 diagnostic/Q1/C1均为0，禁止原地替换函数。

### 15.1 Requirements

- **R-E8-01 Immutable E7 failure.** 10800新增 append-only `falcon24_epoch_closure_failure_receipts` 与唯一 record/load authority。record RPC
  必须在 current exact E7 下由服务器同时重算：PROMOTED E7 stage、原始 profile exact match、公开 reader observed STALE；随后写入
  `FROZEN_CLOSURE_CHANGE_REQUIRED / PROVIDER_PROFILE_BINDING_NOT_SELECTED`。receipt写入必须先于任何 E8 staging/activation。
- **R-E8-02 No in-place E7 behavior change.** 10800安装后，公开 reader在 current ordinal `<8` 时必须委托 frozen 10799 implementation，
  因而 E7继续稳定返回 STALE。只有 current原子切到 E8后才选择修正分支；维护窗口不能替代这一 dispatch边界。
- **R-E8-03 Fresh E8 certification.** 新 E8 build必须重新执行一次真实 credential certification，生成 target E8、inactive、build-bound stage；
  不复用 E7 proof冒充新 build closure。E7 reader仍不可见该 candidate。
- **R-E8-04 Request/result v5.** activation request@5绑定 exact E7 failure receipt、exact E8 LLM stage、current E7、gen2与版本；result@5返回
  failure receipt ref/hash、promoted certification与 E8 authority。v4只读保留E7历史。
- **R-E8-05 Atomic switch.** 10800演进同一个 `activate_falcon24_authority(jsonb)`；单事务验证 failure receipt、stage/artifact、LLM staging receipt、
  model/deployment、E8 baseline后，推广 candidate并调用既有 retained activation core切到E8。失败只观察 E7/STAGED/inactive；成功只观察
  E8/PROMOTED/active/AVAILABLE。
- **R-E8-06 Formal gates.** E8激活和 post-readback AVAILABLE后才允许创建唯一正式 diagnostic；首败规则与动态 Tool Loop、Trace UI、
  residual=0、Q1 16/16、C1 30/30要求不变。

### 15.2 Acceptance

- [x] **AC-E8-01** E7 failure receipt由服务器重算且append-only；伪造stage/ref/readiness/current或重复不同payload全部拒绝。
- [x] **AC-E8-02** PostgreSQL 17 fresh/exact E7 upgrade证明迁移前后 E7公开输出相同；all-old/all-new、RLS、replay和双连接并发通过。
- [ ] **AC-E8-03** exact E8 build真实 certification在 E7不可见；一次request@5后 current E8且exact profile AVAILABLE，gen2/defaults不变。
- [ ] **AC-E8-04** 唯一 E8 diagnostic PASS，随后 E8-Q1 16/16、E8-C1 30/30；正式首败立即 immutable HOLD并停止。

## 16. E9 current-profile certification authority amendment

E8 已按 request@5 原子激活，公开 `list_provider_execution_profiles()` 在 exact Worker capability 下把目标
profile 投影为 `AVAILABLE/selectable=true`。唯一正式 E8 diagnostic attempt
`8e000000-0000-5000-8000-000000000101` / Run
`f816b823-716d-8648-8b13-f320b76ca6a3` 仍在 Provider 网络调用前以
`PROVIDER_TRANSPORT_PROFILE_NOT_AVAILABLE` 终止，并已写入 immutable FAIL receipt
`sha256:27a2458e45986c41f9d1d7e3109fa140885594d59afe0c75285fccc957459747`。E8-Q1/E8-C1 均为零。

只读数据库与源码闭包证明：公开 reader 返回的 certification ref 属于 E7 certification Run/Artifact；生产
`resolveAvailableProfile` 随后却通过通用 `ArtifactRepository.resolveArtifact/verifyCommitted` 解析该 ref。通用
resolver 正确要求 Artifact 的 Run、baseline 与 activation 等于 current E8，因此返回 `null`。问题不是 profile
不可见，也不是 credential/provider 外部失败，而是“current profile authority”错误复用了“current Run Artifact
authority”。不得放宽通用 Artifact Epoch 隔离，也不得重写 E7/E8 receipt。

### 16.1 Requirements

- **R-E9-01 Immutable E8 failure.** 保留 E8 Run/event/attempt/diagnostic receipt 原字节；不 retry/resume 同一 Run，
  不在 E8 内替换 Worker 或数据库函数。E9 activation 必须绑定该 exact terminal receipt、E8 current binding 与
  generation 2 closure。
- **R-E9-02 Dedicated current-profile resolver.** 演进唯一 Provider execution authority，新增 backend-only
  PostgreSQL resolver。它只在 certification ref 同时绑定 current epoch 的 `PROMOTED` LLM stage、current
  activation、exact profile/config/execution hash 与 immutable Artifact 时返回 claims。Worker production dispatcher
  使用该专用 resolver；通用 Artifact resolver 继续拒绝跨 Epoch Artifact。
- **R-E9-03 Fresh E9 certification.** clean E9 build 必须重新运行真实 credential certification，生成 target E9、
  inactive、build-bound stage。E8 runtime 不得看见 E9 candidate；E9 激活后公开 profile 与专用 certification
  resolver 必须同时闭合为同一 ref/hash。
- **R-E9-04 Request/result v6.** request@6 绑定 exact E8 diagnostic receipt（attempt/run/manifest/receipt hash/
  failure class/code）、E9 stage、current E8、retained gen2 与 expected versions。result@6 返回 exact predecessor
  diagnostic receipt、promoted certification 与 E9 authority；v2-v5 仅保留历史 replay。
- **R-E9-05 Atomic successor switch.** 10801 继续演进同一个 `activate_falcon24_authority(jsonb)`。单事务按
  semantic fence -> Falcon activation advisory -> diagnostic advisory -> current -> semantic/runtime/defaults ->
  predecessor diagnostic receipt -> E9 stage/artifact -> target baseline 的顺序锁定并重验。失败只观察 E8/STAGED/
  inactive；成功只观察 E9/PROMOTED/active，且 gen2/defaults 不变。
- **R-E9-06 Dynamic Tool Loop unchanged.** 修复只改变 Provider authority 解析边界；Root 仍逐轮决定当前 Tool Call，
  Host 不声明业务 DAG，不增加 fixed/keyword route 或 Direct-QA fallback。
- **R-E9-07 Unattended forward recovery.** 每个 formal diagnostic/Q1/C1 attempt 仍是 one-shot，失败必须先写
  immutable FAIL/HOLD，禁止 retry/resume/拼接；若修复属于内部 frozen closure，则自动进入 E(n+1)，不等待逐 Epoch
  审批。只有受保护历史修改、生产/外部发布、不可恢复广泛删除或本地无法安全取得的外部 credential 才停止。

### 16.2 Acceptance

- [ ] **AC-E9-01** 单元/集成负例证明 generic Artifact resolver 仍拒绝 E7 receipt under E9，而 dedicated current-profile
  resolver 只接受 current PROMOTED stage 的 exact ref/hash/claims；staged、旧 stage、换绑 ref 或越权均失败关闭。
- [ ] **AC-E9-02** 10801 PostgreSQL 17 fresh + exact E8 populated upgrade、RLS/grants、rollback、replay、failure
  injection 与双连接 concurrency PASS；E1-E8、gen1/gen2、E8 failed Run/receipt bytes 无漂移。
- [ ] **AC-E9-03** 一次 live E9 certification + request@6 后 current=E9、stage=PROMOTED、public profile=AVAILABLE，
  Worker 专用 resolver readback PASS，semantic pointer/runtime/defaults 仍 exact gen2。
- [ ] **AC-E9-04** 新 E9 diagnostic 通过真实 composer 与答案入口 Trace UI，完整证明 Semantic -> Text2SQL -> SQL ->
  QueryEvidence -> typed Arrow -> Python -> AnalysisReport -> Chart，residual=0。
- [ ] **AC-E9-05** E9-Q1=16/16、E9-C1=30/30；最终审计保留真实
  `production_isolation_proven=false / production_gate=HOLD`，并清理轮换 credential、临时服务、浏览器和沙箱容器。

## 17. E10 versioned resolver recovery amendment

E9 request@6 已原子提交为 all-new：current baseline
`7d2e476b-81e0-5390-8604-540009cfd717`、activation
`55d3a881-8fd7-5c54-abbc-3f158f0f79c9`，fresh certification stage
`e9000000-0000-5000-8000-000000000902` 已 `PROMOTED` 且 Artifact active。Finalizer 随后的 dedicated
readback 失败；在 exact backend context 下调用 10801 resolver 得到 PostgreSQL `42702`：PL/pgSQL record
变量 `stage` 与查询表别名 `stage` 令 `stage.app_id` ambiguous。E9 尚无 diagnostic/Q1/C1，禁止修改 10801、
重放 request@6 或在 current E9 下替换原 resolver。

### 17.1 Requirements

- **R-E10-01 Immutable E9 finalization failure.** 10802 新增 append-only finalization-failure authority。record RPC
  只接受 expected E9 authority、已推广的 E9 stage ref 与幂等 identity；服务器必须在同一事务内重构 exact
  resolver command、实际观察旧 resolver 的 `42702`、哈希旧函数定义并生成
  `FROZEN_CLOSURE_CHANGE_REQUIRED / CURRENT_PROVIDER_CERTIFICATION_RESOLVER_AMBIGUOUS` receipt。receipt 必须在
  E10 certification/staging 前提交，E9 baseline/stage/Artifact 和 E8 diagnostic bytes 不变。
- **R-E10-02 Versioned resolver fence.** 10802 不 `CREATE OR REPLACE` 10801 resolver。新增 backend-only
  `resolve_current_provider_execution_certification_v2(jsonb)`，使用无歧义 alias，并在 current ordinal `<10`
  时 fail closed。Worker E10 build 改用 v2；旧 v1 只保留 E9 失败现场与历史验证。
- **R-E10-03 Fresh successor proof.** clean E10 build 必须执行新的 live credential certification；candidate 在
  E9 为 STAGED/inactive，v2 resolver 不可见。不得复用 E9 stage 或旧 Artifact 冒充 E10 closure。
- **R-E10-04 Request/result v7.** request@7 绑定 exact E9 finalization-failure receipt、fresh E10 stage、current
  E9、generation 2 与 expected versions；result@7 返回 exact receipt ref、promoted certification 与 E10 authority。
  v2-v6 继续委托 frozen pre-E10 activation。
- **R-E10-05 Atomic switch and readback.** 唯一 activation RPC 在一个事务内按 semantic fence -> Falcon advisory ->
  current -> semantic/runtime/defaults -> E9 failure receipt -> E10 stage/artifact -> target baseline 顺序锁定，推广
  candidate 并切到 E10。提交后必须通过 public profile 与 v2 claims resolver 双 readback；失败不得重放同一
  activation。
- **R-E10-06 Formal gates unchanged.** 只有 E10 post-readback PASS 后才能创建唯一 formal diagnostic。动态 Root
  Tool Loop、答案入口 Trace UI、residual=0、Q1 16/16、C1 30/30 与正式首败停止规则不变。

### 17.2 Acceptance

- [ ] **AC-E10-01** E9 failure receipt 由服务器通过真实 `42702` 重算且 append-only；伪造 current/stage/ref、旧函数
  不再失败、不同 payload 重放或越权全部拒绝。
- [ ] **AC-E10-02** 10802 PostgreSQL 17 fresh + exact E9 populated upgrade、RLS/grants、rollback/replay/concurrency
  PASS；v1 在 E9 保持原失败，v2 在 E9 fail closed，E1-E9/gen1/gen2/E8 receipt bytes 无漂移。
- [ ] **AC-E10-03** 一次 live E10 certification + request@7 后 current=E10、stage=PROMOTED、public profile=AVAILABLE、
  v2 claims exact PASS，semantic pointer/runtime/defaults 仍指向同一 generation 2。
- [ ] **AC-E10-04** 唯一 E10 diagnostic 经真实 composer 和答案入口 Trace UI 证明完整动态 Tool Loop、五类 Artifact
  与 residual=0；随后 E10-Q1=16/16、E10-C1=30/30。

## 18. E11 cross-turn Specialist call authority amendment

E10 已成功激活并通过 public profile 与 v2 certification resolver readback。唯一正式 E10 diagnostic attempt
`e1000000-0000-5000-8000-00000000d110` / Run `b25484bb-8f9d-870d-bc5c-96212971e83e`
在动态 Root Tool Loop 内终止，并已保存 immutable FAIL receipt
`sha256:789a5e478fb6e056b9632e682fe4d91420129e2bfcc2449d5824bfca8a6949d4`：
`FROZEN_CLOSURE_CHANGE_REQUIRED / ROOT_AGENT_TURN_BUDGET_EXHAUSTED`。E10-Q1/E10-C1 均为零。

事件与 Team authority 证明：四个 Root 轮次分别创建四个不同的 `governed-text2sql-agent` child task；首个 task 的
`sql.compiler.compile` 实际完成两个 Provider 调用，随后以
`TEAM_TEXT2SQL_CANDIDATE_POLICY_REJECTED` 返回。第二至第四个 child task 尚未发起 Specialist Provider I/O，均在
`RunExecutionContext` 以 `PROVIDER_LOGICAL_CALL_DUPLICATE` 失败。源码闭包证明
`specialistProviderJson` 的 logical call identity 只绑定 `run_id + stage + repair_index`，遗漏了本轮已持久化的
child `task_id`，所以跨 Root turn 的合法新 Tool Call 与旧 Tool Call 必然碰撞。现有安全事件没有持久化被拒绝 SQL
或精确 policy 子码，因此本方案不推断首轮候选的具体缺陷。

### 18.1 Requirements

- **R-E11-01 Immutable E10 failure.** E10 diagnostic Run、43 条 event、四组 Team task/handoff、attempt 与 terminal
  receipt 保持原字节；禁止 retry/resume 该 Run、删除失败 task 或把后续证据拼接到 E10。
- **R-E11-02 Task-scoped Specialist identity.** Specialist logical call identity 必须绑定
  `run_id + child_task_id + specialist_stage + call_index`。同一 task/同一 index 重放仍稳定返回 duplicate；同一 Run
  不同 Root turn 产生的不同 accepted child task 必须得到不同 logical ID。repair index 仍只表示同一 task 内的有界候选修复。
- **R-E11-03 Dynamic loop unchanged.** Root 每轮仍只选择当前 Tool Call；Host 不预声明未来链路、不按关键词路由、
  不建立业务 DAG。新 identity 只修复当前 call 的幂等域，不能绕过 Profile、Artifact、预算、SQL/Sandbox 或恢复门禁。
- **R-E11-04 Safe rejection feedback.** Text2SQL 候选最终被拒绝时，Root Tool Result 应保留已有 allowlisted stable
  policy code；不得持久化或公开 raw SQL、Provider response、prompt、参数值或数据库细节。无法识别的错误继续收敛到通用
  `TEAM_TEXT2SQL_CANDIDATE_POLICY_REJECTED`。
- **R-E11-05 Reuse existing successor authority.** E10 terminal diagnostic 已满足
  `falcon24-activation-request@6.0.0` 的通用 `target>=E9` successor 合同；10801/10802 已把 v6 委托链保留并要求
  `target=current+1`。E11 不新增 10803、不替换任何既有 RPC。Finalizer 只需按显式 recovery evidence 在 E9+
  选择 terminal-diagnostic v6 或 finalization-failure v7，并在 target>=E10 时统一使用 v2 certification resolver readback。
- **R-E11-06 Fresh E11 build and certification.** Worker/Web 变更进入新的 clean build closure，重新运行 target E11
  live certification并生成 STAGED/inactive candidate；E10 runtime 不得看见该 candidate。request@6 必须绑定 exact
  E10 diagnostic receipt、fresh E11 stage、current E10、retained gen2 与 expected versions。
- **R-E11-07 Scratch vertical proof before formal execution.** 在专用权威库的 exact physical clone 上先激活 E11，
  创建非 diagnostic、非 Q1/C1 的开发 Run，证明至少一个跨 Root turn 相同 Specialist Profile 的新 task 不再发生 logical-ID
  collision，并让固定诊断问题完成 Text2SQL/QueryEvidence/Analysis/Chart 闭包。该证据不能替代正式 composer/Trace UI 门禁。
- **R-E11-08 Formal continuation.** 权威库 E11 原子激活与 production-port readback 后创建唯一 E11 diagnostic；通过后
  执行 E11-Q1 16/16，再执行 E11-C1 30/30。任一失败先保存 immutable FAIL/HOLD；根据用户最新授权，内部 frozen
  closure 缺陷继续前进 E(n+1)，但绝不重试同一正式 Run/attempt。

### 18.2 Acceptance

- [ ] **AC-E11-01** Worker regression 证明 task A 与 task B 的相同 Specialist stage 得到不同 logical ID；task A
  同一 call replay仍 duplicate；repair 0/1 identity不同且均绑定 task A。
- [ ] **AC-E11-02** Finalizer tests 证明 E10 diagnostic receipt可通过 request@6 激活 E11，v2 resolver完成 readback；
  E10 finalization-failure v7 历史路径不变，配置同时提供两种 predecessor evidence 时失败关闭。
- [ ] **AC-E11-03** Focused/full tests、typecheck/build、Trellis/spec检查、clean build attestation、fresh certification、
  exact clone activation与非正式垂直 canary PASS；E1-E10、gen1/gen2和 E10 failure receipt bytes无漂移。
- [ ] **AC-E11-04** 一次 E11 diagnostic 通过真实 composer与答案入口 Trace UI，证明完整动态 Tool Loop、五类 Artifact
  和 residual=0；随后 E11-Q1=16/16、E11-C1=30/30。
- [ ] **AC-E11-05** 最终审计保留真实 `production_isolation_proven=false / production_gate=HOLD`，停止本任务服务，
  删除瞬态 credential/sandbox/scratch资源，仅保留既有四个长期容器和 rejected-repair审计 stash。

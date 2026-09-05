# Falcon24 Semantic Generation 2、E4 原子恢复与 E5 前向构建权威

> 最新需求权威（2026-08-31）：用户允许简化反复失败的门禁，优先证明 Semantic + Text2SQL 协作。
> 第 21 节核心协作验收已完成（四题 4/4）；见 research/core-collaboration-verification-ec3c1e61.md。
> 第 20 节原四层 15 回合及旧 Epoch 记录保留，不改判 PASS；延期项不自动续跑。

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

## 19. E11 Terminal Closure requirement（覆盖 18.1-18.2 的前向恢复条款）

- **R-E11-T01 Terminal scope.** E11是本任务最后一个允许的 Epoch；禁止 E12+、新 migration/RPC/架构阶段和历史回写。
  Owning-code closure冻结在 `8cefa61a`，E1-E10、gen1/gen2及全部历史证据不可变。
- **R-E11-T02 Gated sequence.** 唯一顺序为 Scratch Preflight -> 单次 Scratch Vertical Canary -> live E11单次 stage/activation
  -> 单次 Diagnostic -> Q1 16/16 -> C1 30/30 -> audit/cleanup。上一阶段 exact PASS 是下一阶段 admission条件。
- **R-E11-T03 Dynamic evidence.** Canary与Diagnostic都必须从 authenticated composer进入，在同一 Run证明 Root读取结构化
  ToolResult后动态闭合 Semantic、Text2SQL、governed SQL、QueryEvidence、typed Arrow及适用的Analysis/Chart，并从答案入口打开
  exact可用 Trace UI。Direct QA、固定SQL、关键词路由、业务DAG、API-only、直接Trace URL和BLOCKED渲染全部失败关闭。
- **R-E11-T04 Exhausted repair budget.** `faa7e2b1`和`8cefa61a`已消费两次局部产品修复；终局方案提交后不得再修改产品代码。
  同 HEAD/同输入的构建或进程抖动每步最多同构重试2次；第三种产品缺陷、migration、E12、外部 credential或新架构需求直接HOLD。
- **R-E11-T05 Formal first-failure stop.** Diagnostic/Q1/C1任一首次失败保存 immutable FAIL/HOLD，禁止retry/resume/拼证据，
  直接审计清理并提交handoff。终态只有 COMPLETE或HOLD。

### 19.1 Terminal acceptance

- [ ] **AC-E11-T01** Scratch clone在clean attestation/fresh certification/request@6后all-new，RLS/replay/history-zero-drift PASS。
- [ ] **AC-E11-T02** 单次 Scratch Canary满足同Run动态链、typed evidence、答案入口exact Trace UI与residual=0。
- [ ] **AC-E11-T03** 仅在scratch PASS后，live E11 activation、唯一Diagnostic、Q1 16/16、C1 30/30全部PASS。
- [ ] **AC-E11-T04** canonical audit、真实production isolation、资源清理、spec/Trellis验证、scoped commit和clean worktree PASS；
  否则以完整handoff进入HOLD并明确任务未完成。

## 20. 四层业务门禁与无人值班闭环（最终需求覆盖）

本节是 2026-08-29 用户确认后的最终产品需求。它覆盖本文此前仍要求 `Q1 16/16 + C1 30/30`、产品修复预算为零、
或任一内部缺陷立即终止任务的条款；历史 attempt、Run、receipt 和失败事实继续不可变，只是不再作为未来验收规模。

### 20.1 Goal 与范围

最终目标不是继续扩大 Epoch 或重复跑题，而是在同一个冻结 build 上，用自然业务问题证明：Root 能动态调用正确的
Semantic、Text2SQL、Analysis、Report/Chart Agent；同一窗口的后续问题能继承并纠正上下文；真实 Q&A Agent 页面与
exact Run 轨迹页面均可用。正式业务门禁只运行下列 15 个用户回合，不再执行旧 16+30 重复矩阵。

范围内包括 Root/Agent Harness、Semantic fallback、Text2SQL/Analysis/Report/Chart、Conversation/Run/Artifact 证据、
Q&A Agent 页面、轨迹页、浏览器恢复、门禁 authority、无人值班恢复与最终审计。生产隔离认证、移动端完整适配、历史 Run
迁移、旧门禁补分和用固定业务 DAG/SQL 绕过 Agent 均不在本闭环范围。

### 20.2 最终四层题库

#### L1：单 Agent（5 个独立 Conversation/Run）

1. `我想看订单收入的同比增长，系统里应该怎么算？需要使用哪些收入和时间口径？`
   - 期望只调用 Semantic Agent；读取已发布的订单收入、时间字段和术语/公式图。
   - 精确同比术语不存在时，Semantic Agent 必须以已治理原语形成 request-scoped 可执行解释并友好回答，不能直接暴露
     “索引未找到”“未受治理定义”或让用户重述完整问题。
2. `当前工作区里的“客单价”是怎样计算的？它与客户订单总金额有什么区别？`
   - 期望只调用 Semantic Agent，正确区分订单行平均金额与客户累计金额。
3. `订单、客户、客户反馈和配送信息之间怎样关联？`
   - 期望只调用 Semantic Agent，并给出已发布关系、方向与关键 Join。
4. `列出最近10笔订单的订单编号、下单日期和订单金额。`
   - 期望只调用 Text2SQL Agent，返回受限、可复核的 10 行结果。
5. `基于这份已经确认的数据表，写一段给经营负责人的简短摘要，不增加表中没有的结论。`
   - 在同 Run 注入已验收表格输入，期望只调用 Report Agent，且所有事实可回指输入证据。

#### L2：两个 Agent（2 个独立 Conversation/Run）

6. `最近12个完整月的订单收入同比表现如何？按月给出本期收入、上年同期收入和同比增速。`
   - 期望 `Semantic -> Text2SQL`；先闭合指标、时间与同比口径，再查询。
7. `各营销渠道投入产出表现如何？按正式口径给出总投入、营销收入和ROAS渠道对比表。`
   - 期望 `Semantic -> Text2SQL`；ROAS 按 `SUM(revenue_generated) / NULLIF(SUM(spend), 0)` 聚合后计算，
     不能汇总或平均源表 ROAS。

#### L3：单轮多 Agent（2 个独立 Conversation/Run）

8. `最近12个完整月的订单收入有没有持续上升或下降？说明趋势强度，给出折线图和经营结论。`
   - 期望动态形成 `Semantic -> Text2SQL -> Analysis -> Report/Chart`，但 Host 不预排业务 DAG。
9. `过去一年各营销渠道投入效果如何？比较不同渠道和目标人群的投入、转化与回报，并结合订单收入、新客和订单量，指出值得继续投入和需要收缩的渠道。`
   - 期望动态多 Agent；结论必须区分相关性与因果性，并附表格/图表证据。

#### L4：同一窗口多轮、多 Agent（2 个 Conversation，各 3 个 Run）

场景 A 固定在同一个浏览器窗口和 Conversation 中顺序提交：

1. `最近12个完整月的订单收入同比表现如何？请给出月度趋势图。`
2. `其中下降最明显的3个月，按客户类型拆开看看，主要差异来自哪里？`
3. `把总体趋势和这3个月的拆解合成一份经营摘要，保留原趋势图，再增加客户类型对比图。`

场景 B 固定在另一个浏览器窗口内的同一个 Conversation 中顺序提交：

1. `各营销渠道的总投入、营销归因收入和ROAS表现如何？给出渠道对比图。`
2. `我说的回报不是ROAS，改成净ROI，也就是扣除投入后的回报率，再按渠道重算。`
3. `只看投入增长但净ROI下降的渠道，再按目标人群拆开，说明可能原因和下一步建议。`

L4 必须证明每条用户消息创建不同 Run、Conversation ID 保持不变、resource version 单调增加、`其中/这3个月/只看`
正确指代，后一轮纠正覆盖旧口径。历史 assistant 文本和 summary 只能帮助理解语境，不能冒充数据/语义证据；当前 Run
需要重新验证事实，或引用合同允许的 exact accepted Artifact。净 ROI 使用 `(营销收入-投入)/投入`，不得复用 ROAS 结果。

### 20.3 分阶段业务与 UI/Trace 验收

每个用户回合只允许一次正式模型提交。Run 到达终态后先执行业务验收：回答正确性、期望 Agent 数量/顺序、公式/SQL/Oracle、
证据闭包和用户可读错误。业务验收失败时不再打开图表或深度遍历轨迹，直接进入门禁外修复；业务验收通过后，使用同一个
Conversation/Run 做确定性浏览器验收，不再次向模型提问。

Q&A Agent 页面必须满足：真实 composer 提交一次；用户消息、Agent 执行状态和终态回答按序可见；预期表格/图表可展开；
无错误 banner 或永久 loading；刷新后恢复同一 Conversation/Run 且不重复调用；L4 三轮连续显示且纠正后的答案不回退旧口径。

轨迹页必须从答案入口点击进入 exact Run，不能直接拼 URL。页面应显示 Root turn、Subagent task/tool、公开安全事件、accepted
Artifact lineage、表格/图表/报告预览；切换 Run、返回对话和刷新均保持 exact focus；不得出现 `BLOCKED` 占位冒充成功，
也不得用 API-only receipt 代替页面可用性。

### 20.4 Token 与重复运行约束

- 正式门禁共 15 个用户回合，每个冻结 build 最多各提交一次；废止 16+30、COLD/WARM 和三次重复。
- L1 未全过不运行 L2，L2 未全过不运行 L3，L3 未全过不运行 L4。
- Browser E2E 复用已经回答成功的 Run；DOM、URL、Artifact/hash、刷新和截图核验不触发第二次模型回答。
- 默认使用 deterministic rubric、受治理公式、独立 SQL/分析 Oracle 和公开事件断言；只有无法确定的文本质量才允许一次
  小型 evaluator，不运行多评委或对抗评审。
- 失败只保存必要的结构化事件、首张失败截图和最小日志；成功每个场景保存一组 receipt，不录制长视频或重复截图。

### 20.5 无人值班执行合同

内部可修复问题不能让任务静默停止。正式 Run 失败先写 immutable attempt/Run evidence，然后退出门禁，在隔离 worktree 中按
“最小复现 -> failing test -> scoped fix -> focused validation -> scoped commit -> clean build/attestation -> scratch canary -> 新正式
attempt”自动前进。正式 Run 本身不得 retry/resume，也不得跨 build/attempt 拼接 PASS；代码变化后从 L1 重新证明同一 baseline。

同一根因指纹连续出现三次时不继续盲重试，而是自动进入 deeper diagnostic：缩小到最早失败层、读取持久化 Run/Tool/Artifact
证据、形成新的 failing test，再继续修复。上下文压缩、进程退出或浏览器断开后按持久化 checkpoint 恢复，不重复已提交的
Provider、SQL、Sandbox 或 Artifact side effect。

无人值班任务的生命周期只允许从 `ACTIVE` 前进到唯一终态 `COMPLETE`；`WAITING_EXTERNAL` 只是 `ACTIVE` 下的非终态子状态，不能提交阻断结论、
结束任务或要求用户第二天手工恢复。遇到本地暂时无法安全取得的 credential、外部系统强制审批、目标服务不可达或需要额外授权的
生产操作时，先保存 checkpoint 和 exact unmet condition，继续所有不依赖该条件的实现、测试、页面修复、证据整理与审计工作。

当前四层门禁使用 request-scoped Semantic fallback，不发布全局语义 Candidate，因此“同比”等缺失术语不产生真人语义审批边界。
如果未来实现意外产生需要真人治理的 Candidate，它保持 DRAFT，不能由 Agent 冒充真人批准，但也不能停止主任务：控制器继续其他
可运行工作；确实只剩该条件时，关闭昂贵的临时 Web/Worker/Sandbox，使用不调用模型的递增间隔探针持续复查审批/credential/服务状态，
条件满足后自动重建运行环境并从 checkpoint 继续。受保护历史和安全门禁仍不能通过手工 DML、伪造 Secret 或自动批准绕过。

普通测试失败、SQL/路由/页面缺陷、构建错误和可恢复进程故障都必须进入修复循环。外部等待期间也必须保留状态、最近探针时间、
下一次复查时间和唯一恢复步骤，任务保持 `in_progress`，不发送“已阻断/已结束”的最终结论。

### 20.6 Final acceptance

- [ ] **AC-FL-01** L1 五题在同一 frozen baseline 上全部 PASS，且每题只出现一个预期 Specialist Profile。
- [ ] **AC-FL-02** L2 两题全部 PASS，动态顺序为 Semantic 后 Text2SQL，公式、时间与数据结果可复核。
- [ ] **AC-FL-03** L3 两题全部 PASS，Root 基于 Tool Result 动态决定后续调用，表格、分析、报告和图表同源。
- [ ] **AC-FL-04** L4 两个三轮 Conversation 全部 PASS，正确处理指代、筛选、口径纠正、跨 Run 历史与证据边界。
- [ ] **AC-UI-01** 15 个正式用户回合的 Q&A Agent 页面均从真实 composer 提交并可见终态结果；刷新不重复 Run/调用。
- [ ] **AC-UI-02** 每个通过的 Run 都能从答案入口打开 exact 可用轨迹；Agent、Tool、Artifact、表格/图表/报告预览与返回交互正常。
- [ ] **AC-AUTO-01** 内部失败可自动修复并在新 build/attempt 上重启；crash/replay 不重复已提交副作用。
- [ ] **AC-AUTO-02** 外部条件缺失时任务保持 `ACTIVE/WAITING_EXTERNAL`，先继续独立工作，再以无模型探针持续复查并自动续跑；
  不因“需要真人审批”或 credential 暂不可用结束任务。
- [ ] **AC-FINAL-01** PostgreSQL authority、protected history、credential、安全边界、sandbox residual、服务/浏览器/scratch 清理、
  focused/full checks、scoped commits 与 clean worktree 全部闭合；production isolation 仍按真实证据单独声明。

## 21. 核心协作验收（2026-08-31 用户范围调整）

用户允许在门禁反复失败时降低题目难度，并在语义层定义所需公式或术语；核心结果是 Semantic 与 Text2SQL 能真实协作。
本节覆盖第 20 节尚未完成的复杂 Analysis、分群趋势、多输入、跨 Run 报告和 15 回合全过的当前前置要求。
已提交能力保留；暂停继续扩建月度分群方法。原四层合同、旧失败记录和既有安全边界不变。

当前验收版本为 `falcon24-core-collaboration@1.0.0`，固定题目见 `research/core-collaboration-v1.json`。
四个独立问题覆盖：语义同比口径说明、最近十笔订单、正式 ROAS 渠道汇总、显式净 ROI 渠道汇总。
其中两道汇总题必须证明 Root 依据真实 Semantic 工具结果再调用 Text2SQL；只出现 Agent 名称或流畅答案不算协作证据。
不要求额外 Analysis/Report 调用或生成图表；如果答案实际提供图表，其数据与页面仍须验证。不能给模型提供 gold SQL 或已算结果。

语义定义优先复用当前已发布 Metric/Formula/Dimension。请求级公式由现有 Semantic Context 承载，明确口径且不冒称全局已发布。
如确实需要新增可复用术语/公式，用户允许走现有 Candidate/ChangeSet/review/publish 流程；不得用聊天授权伪造 exact 治理批准。
本版已有收入、投入、ROAS 和 request-scoped ratio 原语，先不创建非必要的全局对象。

- [x] **AC-CORE-01** 同一 clean build、专用物理 scratch、baseline/release/datasource/profile 下四题均通过独立业务复核；不拼接历史 PASS。
- [x] **AC-CORE-02** 两道协作题有同 Run 的 Semantic Context → accepted SQL → QueryEvidence，来源列、聚合公式、NULL/零分母与源数据一致。
- [x] **AC-CORE-03** 每题真实 composer 只提交一次；业务通过后复用同 Run 验证答案、表格、实际 Agent、答案入口 Trace、Artifact 和刷新恢复。
- [x] **AC-CORE-04** 保存四题 question/Conversation/Run、build/binding、答案/证据 hash、原始失败与当前验证记录；不将 scratch 证明写成原四层正式 PASS。
- [x] **AC-CORE-05** 相关回归/clean build、受保护历史、服务清理和 scoped commits 闭合。最终单独报告核心协作结果、原四层状态和 production isolation。

2026-08-31 核心里程碑完成，见 [验收报告](research/core-collaboration-verification-ec3c1e61.md)。四题源码构建为 `ec3c1e61`，
live 348 表零漂移；原四层及 child 未完成项保持延期，不因核心交付归档整个父任务。

核心任务交付可在上述五项完成后结束；旧 E16 失败与 E17 正式激活/四层验收不会因本版核心证明自动改变。
恢复完整四层或生产发布时仍需对应门禁，不得将 `CORE_COLLABORATION_VERIFIED` 当成生产发布凭据。
内部错误继续最小修复与新构建验证；外部依赖按既有 checkpoint/无模型复查边界处理。

## 22. 恢复复杂四层验收（2026-08-31 用户再次确认）

用户明确要求：“现在是四题通过，但是复杂的四层问题还没验收，你继续”。本节覆盖 §21 对复杂能力和完整四层的延期停止条件；
核心四题仍是 `ec3c1e61` 上已完成的独立里程碑，不改写、不重复计分，也不充当新构建四层 PASS。

恢复 §20 的 15 回合、分层顺序和全部 AC-FL/UI/AUTO/FINAL。先补现有链路缺口，再以新 clean build、fresh 专用物理 scratch
证明，满足既有门禁后才通过原前向恢复流程激活 E17。不得回退现场到 E4/E11 或恢复旧 16+30 矩阵。
业务 PASS 后复用同 Run 检查答案和 Trace；普通缺陷继续修复，只有全部验收闭合才完成。

用户先前允许通过明确术语/公式降低歧义的授权仍有效，但不能掩盖缺失能力、伪造语义批准、放宽来源/安全/Oracle 或拼接历史 PASS。
ROAS 始终以实际已发布 AST 为准：当前是 `CASE WHEN SUM(spend)=0 THEN 0 ELSE SUM(revenue_generated)/SUM(spend) END`；
§20.2 的旧 NULLIF 文案不覆盖该发布事实。净 ROI 仍按显式请求口径推导，不复用 ROAS 身份。
连续对话在本次 L4 两组三轮中验收；child 的历史 C7 失败保留为缺陷证据，不额外增加一套重复模型题目作为前置。

### 22.1 B3 前向明确口径（原题与失败不改写）

依据用户允许明确术语/公式、降低歧义的授权，新B3验收文案为：

`比较数据中最近两个完整的营销表现自然月：时间字段使用已发布维度“blinkit_marketing_performance date”，每个月指该字段所在的自然月；本题的收入指标使用已发布的“营销归因收入”。
以较早月为基期、较晚月为本期，沿用刚才的净ROI口径，先汇总每个渠道的营销投入和营销归因收入，筛选总营销投入增加且净ROI下降的渠道，
再按目标人群展示这些渠道两个月的营销投入、营销归因收入和净ROI，说明可能原因和下一步建议。`

“完整月”仍由当前发布的时间前沿与Semantic request-scoped窗口决定，不按本机日期或覆盖min/max猜测。
净ROI为(聚合收入−聚合投入)/NULLIF(聚合投入,0)，先聚合再相除；下降指净ROI差额<0，不是平均组内增速。
渠道筛选先于人群展示，选中渠道的全部人群都保留，不能仅保留自身符合条件的人群；零/缺失/非正基期不得强判有效回报下降。
若无渠道符合条件，如实报告空集合，不通过改比较期寻找结果。建议须标为待验证假设，不把两个月差异说成持续趋势或因果。
§20原B3与V1门禁hash、所有失败Run保留。本版先作为新scratch预检；正式使用前必须更新版本化manifest与原authority绑定，
不允许将新题答案写入旧题receipt。其余15题覆盖/5+2+2+6顺序与来源、安全、同Run UI要求不降低。

### 22.2 B3 Semantic Provider 传输闭包

`966760f5` fresh scratch 中 A1/A2/A3/B1/B2 已通过独立业务与同 Run QA/Trace；原 B3 和把净 ROI、完整月、筛选顺序全部
显式写入题面的独立诊断，各自连续四次在 `semantic-query-selection-intent@1.0.0` 的 Mastra Structured Output 阶段失败。
八次均为完整 Provider 已知响应、零 Semantic Artifact、零 SQL/Analysis，证明题面降歧义不能修复传输缺口。

- **R-FL-JSON-01** Semantic 仍必须返回原 strict selection schema；不得改成自由文本、Host 关键词路由或确定性业务答案。
- **R-FL-JSON-02** exact schema 可由服务端注册 `JSON_TEXT` delivery；DeepSeek 只发一次原生 JSON-mode 请求，Host 对完整原文
  执行 `JSON.parse -> 原Zod strict schema -> canonicalize`，任何格式或 schema 错误失败关闭。
- **R-FL-JSON-03** delivery mode 不能由用户、题库、模型或 Run payload 选择；不增加调用/turn/token预算，不提取/修补 JSON，
  不改变 marker、usage、response protection、Oracle、Semantic/Text2SQL/Analysis authority 或 live 数据。
- **R-FL-JSON-04** `JSON_TEXT` 的 system instructions 必须包含 registry 由同一 Zod schema 生成的 exact canonical JSON Schema；该字节串
  纳入 trusted input upper bound。禁止自然语言近似 schema、客户端 schema、模型自报 schema、默认填充或类型强制转换。
- **R-FL-JSON-05** Semantic provider response 对 set-like ID 数组先验证 exact ID 与唯一性，再由 Host 仅按完整 ID 字符串确定性排序；
  ambiguity 的 candidate 与集合本身同样规范化。Host 不得增删/替换成员、操作或歧义，不得读取题面决定 membership；规范化结果必须再通过
  原 final strict intent schema。排序是无语义的序列化闭包，不是候选修补或业务路由。
- **AC-FL-JSON-01** 离线真实 SDK wire 覆盖一次请求、`json_object`、零 tools、strict PASS 与空白/非JSON/错schema拒绝；新 clean
  build/fresh scratch 的 B3 必须真实形成 Semantic -> Text2SQL -> Analysis 后，才证明修复有效。
- **AC-FL-JSON-02** `b4a237db` 新构建首题 Run 的四个 Semantic 调用全部到达 JSON schema mismatch、零业务 Artifact；该失败不可重提，
  只能由再一个 clean build/fresh scratch 从 A1 前向证明 canonical schema instruction 闭包。
- **AC-FL-JSON-03** `82aed231` fresh scratch 的 A1/A2/A3/B1/B2 均完成独立业务与同 Run QA/Trace；B3 四次均在
  set-like ID 数组第 2 项的 canonical-order refinement 失败，零 Semantic/SQL/Analysis。新 build 必须从 A1 重跑六题，不能把前五题拼入。
- **AC-FL-JSON-04** provider-only schema 必须证明乱序但成员合法的 selected/candidate/ambiguity 集合确定性规范化后通过 final strict schema；
  重复 ID、未知字段、非法 ID、空 intent、跨字段未绑定仍失败关闭。新 build 的 B3 必须真实形成 Semantic -> Text2SQL -> Analysis，
  单测或 `a43cc9f2` 前五题不能替代业务证明。

### 22.3 Semantic 业务术语与时间维度闭包

`d6484404` fresh scratch 的 A1/A2/A3/B1/B2 已完成独立来源、阶段、业务和同 Run QA/Trace；B2 真实使用分类准备参考后通过。
B3 唯一 Run `fdd08691-e2b0-805c-8fec-8b6030add4e0` 四次停在 Semantic provider strict schema，零业务 Artifact，未重提。
该 Run 的冻结检索把泛化别名“收入”强命中 `metric.order_revenue`，而 `metric.marketing_revenue` 只有“营销归因收入”别名；
营销事实时间维度只有技术名且被裁剪。因而“营销收入 + 最近两个完整月”没有形成可选的营销指标/月份原语闭包。

- **R-FL-TERM-01** `metric/formula.marketing_revenue` 同时发布“营销收入”和“营销归因收入”；`metric.order_revenue` 只保留“订单收入”，
  不再把无业务限定的“收入”冒充订单收入。
- **R-FL-TERM-02** `dimension.runtime_time_blinkit_marketing_performance_date` 发布“营销日期”和“营销月份”；B3 题面显式使用“营销月份”并
  定义为营销表现事实日期所在的自然月。其他事实表时间维度不得共享该营销别名。
- **R-FL-TERM-03** 多个 request-scoped operations 的 Semantic 输出必须把全部 operation 引用的 Metric/Dimension ID 做并集后放入 selected 集合；
  Host 仍不补成员、不读取题面路由、不替换公式。净 ROI 不得复用 Published ROAS，仍是 `SUBTRACT_DENOMINATOR + SUM_BEFORE_RATIO + NULL`。
- **R-FL-TERM-04** E5+ Finalizer 是 retained-semantic rollover，不会发布源码 catalog 的新别名。每个新 scratch 必须从 active executable projection
  回读 exact aliases/Release；源码 ChangeSet 测试不能冒充已发布语义。generation 3 尚未通过唯一 successor authority 发布前，B3 只使用当前
  generation 2 已发布的“营销归因收入”与 `blinkit_marketing_performance date`，把术语含义写在 request-scoped 题面中；不得修改 gen2 或另建 publisher。
- **AC-FL-TERM-01** change-set 与 provider prompt 聚焦测试先 RED 后 GREEN；新 clean build/fresh physical scratch 必须从 A1 重跑六题，
  B3 真实形成 Semantic -> Text2SQL -> Analysis、独立 source/stage/business Oracle 与同 Run 浏览器 Trace 后才算闭合。
- **AC-FL-TERM-02** 新题面在当前 generation 2 上执行零模型、只读检索，必须同时选中渠道、目标人群、营销投入、营销归因收入与营销事实时间维度；
  该 probe 只证明检索输入闭包，不替代 B3 Provider/SQL/Analysis 或正式四层 PASS。

### 22.4 NAS OpenSandbox 数据面闭包

`94c10171` fresh scratch 的 A1 已形成 Semantic 与 Text2SQL/QueryEvidence，但本机 Worker 使用 DIRECT endpoint mode 时无法访问
NAS Docker 临时 Sandbox endpoint；两次 Analysis side effect 超时后 Run 失败。管理 API health 成功不能证明该数据面可达。

- **R-FL-SBX-01** OpenSandbox endpoint mode 必须由 Worker 到 Sandbox 数据面的真实可达性决定：同机或临时端口可达用 DIRECT；
  本机 Worker 只经 SSH 访问 NAS 管理 API 时用 SERVER_PROXY。不得以题目、模型输出或失败后 fallback 动态选择。
- **R-FL-SBX-02** 两种模式必须复用同一 runtime、镜像、Cell policy、Operator registry、receipt closure 与清理契约；SERVER_PROXY
  不是旧执行器、模型降级、Authority 替代或 production isolation 证明。
- **AC-FL-SBX-01** 从 Worker 所在主机运行正式无模型 runtime probe，报告 exact endpoint mode，完成双 Sandbox、Cell、Operator、
  receipt、session close，且管理 API/NAS Docker residual 均为零。新 clean build/fresh scratch 仍须从 A1 重跑六题。

### 22.5 分类比较稳定排名闭包

`abb1e38c` 的 B1 已证明 Semantic 与 Text2SQL 数值正确，但 Analysis 发布的 `highest` 成员集合未按值稳定降序，原 FULL Oracle 正确拒绝。
分类描述性方法可像既有月度面板一样携带无数据 Python 参考实现，只定义原合同的计数、极值和稳定排序；不得携带来源行或预计算答案。
Agent 仍执行真实 Cell，原 Sandbox/Publisher/FULL Oracle/修复预算不变，Host 不得修补错误成员或数值。新 build 必须从 A1 重跑六题；
旧 A 组三题和 B1 失败均保持不可变。组件修复记录见
[B1 分类排名复盘](research/complex-abb1e38c-category-ranking-reference.md)。

### 22.6 Formula-only Analysis Metric 权威收敛

`f55990b0a2` 的 A1/A2/A3 已完成独立业务与同 Run QA/Trace；B1 唯一 Run
`21da02cb-8b29-8648-aa6a-95fbe56a6cb3` 的 Semantic/Text2SQL 已产出4渠道正确表、SQL与图，随后 Analysis 以
`CATEGORY_COMPARISON_AUTHORITY_INVALID` 失败。QueryEvidence把投入、营销归因收入和ROAS都保留为合法FORMULA；旧Analysis编译只读取
METRIC列，空集合触发selected closure fallback，把无关`metric.order_revenue`也带入，随后精确Context检查正确拒绝。

- **R-FL-FMA-01** FORMULA列不得改写成METRIC；Analysis只从accepted binding的canonical Formula与精确物理来源反查同一retrieval closure内
  已有Published Metric，生成最小`requested_metric_ids`。无关召回Metric必须裁剪，无法收敛时失败关闭。
- **R-FL-FMA-02** category/monthly/monthly-panel planner只消费已编译的精确AnalysisContext作为Metric capability集合；FORMULA与
  REQUEST_DERIVED仍仅是DIRECT数据来源，不新增Skill、单位、粒度、维度或统计权威。
- **R-FL-FMA-03** B1使用当前已发布术语“营销归因收入”降低歧义；这不是新语义发布，也不改变ROAS/净ROI口径。
- **AC-FL-FMA-01** 聚焦测试必须覆盖Formula-only营销结果、额外订单收入召回裁剪、FORMULA角色保留以及三类planner原有authority漂移拒绝。
  scoped commit后必须新clean build/fresh physical scratch从A1重跑六题；本轮A组三个PASS与失败B1不可拼接。

### 22.7 受验经营摘要的单调用传输闭包

`362c7e96` fresh scratch 的 A1/A2 已完成独立业务与同 Run QA/Trace；A3 的第二次正常 Analysis 委派已形成正确48行分群同比
QueryEvidence、受验双节点Program，并完成第一个节点。第二个节点在原FULL Oracle之后生成精确`final_summary_constraint`，但零工具
Structured Output以顶层`invalid_type`被拒绝，随后原Root回合预算耗尽。失败Run保持不可变，不把已完成节点或历史A1/A2拼成PASS。

- **R-FL-AFINAL-01** 只有内部Executor在原FULL Oracle后生成合法`final_summary_constraint`时，request-isolated Analysis FINAL schema
  才固定为`JSON_TEXT`；无约束Analysis FINAL仍使用默认Structured Output。
- **R-FL-AFINAL-02** 仍只允许原一次DeepSeek零工具JSON-mode调用。完整原文必须依次通过JSON解析、同一两字段literal strict schema与
  executor逐字复验；禁止第二次模型调用、Host替换、提取、修补、默认值或宽松类型转换。
- **R-FL-AFINAL-03** delivery mode、literal schema和canonical schema instruction均由服务端生成，用户、题库、模型与Run payload不可选择；
  task hash、预算、usage、protected response、Explanation记录和恢复校验保持原权威。
- **AC-FL-AFINAL-01** TDD须证明受约束FINAL使用JSON_TEXT、不同约束互不污染且改变task hash、无约束FINAL仍为Structured Output，
  TOOL/空白/超长约束零调用拒绝；随后新clean build/fresh physical scratch必须从A1重跑六题并通过同Run业务/QA/Trace。

### 22.8 Root 到 Analysis 的冗余输入收窄

`ce2a488d` fresh scratch 的 A1 已真实形成 SemanticQueryContext、SqlArtifact、12行 QueryEvidence 与折线图。Root 随后两次都选择
`governed-analysis-agent`，Profile、输出类型与用途正确，但同时传入 QueryEvidence 和该 Profile 不接受的 SemanticQueryContext；两次均在
Catalog admission 前以 `ROOT_AGENT_PROVIDED_UNSUPPORTED_INPUT_ARTIFACT` 被拒，最终耗尽四个 Root 正常回合。旧 Run 保持不可变，不能重提。

- **R-FL-RNARROW-01** Root Harness 只可删除同一委派中目标 Profile 不支持的冗余 input refs，并且收窄后至少保留一个原调用中已经存在、
  且由该 Profile 明确接受的 exact ref；不得补造、替换、跨 Run 复制或把全无效输入收窄为空输入。
- **R-FL-RNARROW-02** Profile、objective、`output_usage`、requested output types、预算、tool call identity 与受支持 ref 的字节和顺序全部保持；
  不增加模型调用、Root turn、工具调用或权限。收窄后仍完整执行原 Catalog、accepted Artifact、scope/hash 与 admission 校验。
- **R-FL-RNARROW-03** 不支持输出、未知 Profile、全无效输入、未验收引用及任何权限/hash/outcome 错误继续失败关闭；本规则不是 Host 路由、
  业务计划器或 Analysis 输入扩权。受保护 ProviderResponse 保留原调用，admission receipt 记录实际收窄后的引用。
- **AC-FL-RNARROW-01** TDD须证明 QueryEvidence+SemanticQueryContext 对只接受 QueryEvidence 的 Analysis 收窄为 exact QueryEvidence，原参数不变；
  仅 SemanticQueryContext 仍拒绝。完成 focused/full validation 与 scoped commit 后，必须用新 clean build/fresh physical scratch 从 A1 重跑六题。

### 22.9 多节点 Analysis 的 Side Effect 时间闭包

`5d7a80dd` fresh scratch 的 A1/A2 已完成独立业务与同 Run QA/Trace。A3 重新形成 48 行正确分组同比证据；第一次 Analysis 在默认
60 秒 Side Effect deadline 到达时已生成部分受治理产物，但没有返回完成 receipt，Root 收到 `RUN_SIDE_EFFECT_TIMEOUT`。第二次正常 Analysis
委派随后以 orchestration failure 结束，最终耗尽四个 Root 回合。Run 保持 FAILED；未验收 Analysis Artifact 不计答案或 PASS。

- **R-FL-STIME-01** Worker 默认总 Run execution 仍为 300 秒，默认单 Side Effect deadline 调整为 180 秒；部署仍可在原 10–900,000ms
  合同内显式收窄或覆盖。programmatic runner fallback 与 daemon 默认必须一致。
- **R-FL-STIME-02** 调整只给同一次已准入 Side Effect 足够的完成窗口；不得扩大冻结 Root/Profile/task 预算，不增加 Provider/Analysis 调用、
  repair 次数或权限，也不得把超时后的未验收 Artifact 变为 accepted observation。
- **R-FL-STIME-03** 总 Run abort、显式更小部署 deadline、任务 deadline、fence 与取消继续优先；真正超过新 deadline 仍必须 abort、无 receipt、失败关闭。
- **AC-FL-STIME-01** TDD须锁定默认 180 秒和显式覆盖；Worker official unit、typecheck/build、Biome、Trellis/diff 与 scoped commit 通过后，
  必须再用新 clean build/fresh物理scratch从A1重跑六题，不能拼接 `5d7a80dd` 的 A1/A2。

### 22.10 B 组预检收敛为 Semantic + Text2SQL 事实闭包

`4b26b01e` fresh scratch 的 A1/A2/A3 已连续通过独立业务、QA 和 Trace。B1 唯一 Run
`cf4a62f5-046c-8641-91a1-2d4392fb7d5f` 保留 FAILED：Root 前两次 Semantic 委派均在受治理 catalog tool 执行中失败，
第三次才接受 SemanticQueryContext；第四回合 Text2SQL 正确提交 SqlArtifact、4 行 QueryEvidence 和渠道图，但把输出标为
`CONTINUATION_INPUT`，随后 Root 四回合耗尽，答案为空。独立源数据 Oracle 已证明四渠道投入、营销归因收入和已发布 ROAS 全部正确；
失败不能计 PASS，也不重提。

依据用户已明确授权“多次不过时可降低难度，去语义层定义公式或术语，主要证明语义层+Text2SQL Agent 协作”，下一版
`complex-l4-semantic-defined@4.0.0` 只收敛非计分 B 组预检题面；A 组三题、正式 §20 的 15 回合门禁、来源/安全/Oracle/同 Run UI 均不变：

1. `使用已发布公式“营销ROAS”（formula.marketing_roas；按渠道先汇总营销归因收入与营销投入，汇总投入为0时结果为0，否则以汇总收入÷汇总投入计算），由 Semantic 解释该发布公式、Text2SQL 按渠道输出总营销投入、营销归因收入和ROAS并给出渠道对比图。本题不要求额外统计分析或因果解释。`
2. `沿用同一渠道范围，把回报改为请求级“净ROI”：先按渠道分别汇总营销归因收入和营销投入，再计算（汇总收入－汇总投入）÷汇总投入。由 Semantic 形成 REQUEST_ONLY/NONE 口径、Text2SQL 重算并给出渠道对比图；不要复用ROAS列，本题不要求额外统计分析或因果解释。`
3. `比较数据中最近两个完整的营销表现自然月：时间字段使用已发布维度“blinkit_marketing_performance date”，收入使用已发布的“营销归因收入”；以较早月为基期、较晚月为本期，沿用请求级净ROI，筛选总营销投入增加且净ROI下降的渠道，再按目标人群列出这些渠道两个月的营销投入、营销归因收入和净ROI并给出对比图。由 Semantic 解析 RECENT_COMPLETE_PERIODS + AGGREGATE_RATIO，Text2SQL 完成事实表与图；只报告数据差异和口径，不做原因、因果或建议分析。`

- **R-FL-BFACT-01** 上述题面只能引用 active generation 2 已有的 Formula/Metric/Dimension 和请求级 operator；不得发布新公式、
  修改 retained release、由 Host 填 ID 或另建第二套语义权威。ROAS 仍按已发布 AST，净 ROI 仍为 REQUEST_ONLY/NONE + REQUEST_DERIVED。
- **R-FL-BFACT-02** B1/B2/B3 的预期完成链是动态 `Semantic -> Text2SQL -> FINAL_ANSWER`；QueryEvidence 与图能完整回答时必须以
  `FINAL_ANSWER_EVIDENCE` 结束，不为未请求的分析预留回合。Semantic 或 Text2SQL 缺失、当前 Run 来源错误、公式/窗口/分组错误仍失败。
- **R-FL-BFACT-03** 只降低额外分析与自由叙事要求；SQL、数值、公式、时间窗、history binding、Artifact lineage、一次提交、同 Run QA/Trace
  和 live authority 零漂移要求不降低。必须用新 clean build/fresh物理scratch从A1重跑六题，不拼接 `4b26b01e` 的 A组三个 PASS。

### 22.11 B3 完整事实面板先行

`2217ff9c` clean build/fresh E17 scratch 已在同一冻结 epoch 连续通过 A1/A2/A3/B1/B2。B3 唯一 Run
`54be4db1-e8b2-8485-a1e3-6333d3607f36` 接受了当前 Run 的 `SemanticQueryContext`，其中同时封存
`RECENT_COMPLETE_PERIODS`、`AGGREGATE_RATIO`、营销月份、渠道、目标人群、营销投入和营销归因收入；随后三个 Text2SQL task
的六个候选全部在 compile 前失败关闭，终态 `ROOT_AGENT_TURN_BUDGET_EXHAUSTED`，没有 SqlArtifact、QueryEvidence 或答案。
冻结诊断只读取 reason code、Profile/Artifact ref 和安全事件摘要，未读取 Provider 原文。

原 `4.0.0` 题面把“先筛渠道、再拆人群”写在 Text2SQL 事实要求之前，模型据此反复生成 SQL 内筛选、额外 query shape、错分组或错窗口候选；
而现有 `AGGREGATE_RATIO` 证明子集只接受一个 exact complete-month 窗口内的直接聚合，并允许把月份、渠道、目标人群全部作为分组维度。
这是执行顺序歧义，不需要放宽证明器、发布新公式或修改 active generation 2。

依据用户已授权在多次失败时明确语义术语/公式，前向非计分 profile 版本化为 `complex-l4-semantic-defined@4.1.0`，B3 文案为：

`继续使用上两题的渠道范围和请求级净ROI口径。比较数据中最近两个完整的营销表现自然月：时间字段使用已发布维度
“blinkit_marketing_performance date”，收入使用已发布的“营销归因收入”。由 Semantic 解析 RECENT_COMPLETE_PERIODS +
AGGREGATE_RATIO；Text2SQL 先按营销月份、渠道、目标人群输出完整的两月分组事实面板，每组包含营销投入、营销归因收入和
先汇总后相除的净ROI，并给出完整面板对比图。SQL阶段不要筛选渠道、不要只返回入选人群，也不要使用历史答案预选。
最终回答再依据当前Run完整面板，在渠道层分别汇总两个自然月，筛出本期总营销投入增加且净ROI下降的渠道，并列出这些渠道的
全部目标人群两月事实；若无符合渠道则如实报告。只报告数据差异和口径，不做原因、因果或建议分析。`

- **R-FL-BPANEL-01** 复杂度不降为单维或单月：Semantic 必须保留双月、渠道、目标人群、两个源 Metric 和请求级净 ROI；Text2SQL
  必须返回完整 `month × channel × audience` 面板，不能在 SQL 内 CTE/HAVING/额外过滤、预选渠道或裁掉未入选组。
- **R-FL-BPANEL-02** 渠道层筛选只能发生在完整当前 Run QueryEvidence 可见之后；渠道净 ROI 必须先分别汇总收入/投入再相除，不能平均
  人群净 ROI。历史 B1/B2 回答只绑定连续意图，不是 B3 数值证据。
- **R-FL-BPANEL-03** 原 `4.0.0`、失败 Run 和六个 candidate hash 保持不可变。`4.1.0` 不增加 Root/Text2SQL repair、模型调用、权限、
  Formula 或 publisher；公式、窗口、source Oracle、图、同 Run QA/Trace 和 live authority 标准不降低。
- **AC-FL-BPANEL-01** 完成 scoped docs commit 后，关闭旧现场并证明 live E16 零漂移；用新 clean build/fresh physical scratch 从 A1
  连续重跑六题。只有 B3 同一 Run 的 SemanticQueryContext、SqlArtifact、完整 QueryEvidence、独立 source/business Oracle、答案和 Trace
  全部通过，才算六题预检闭合；不得拼接 `2217ff9c` 的五个 PASS。

### 22.12 A2/B3 的 Analysis 交接与描述性边界

`f02d610a` clean build/fresh E17 scratch 的 A1、B1、B2 已完成独立业务 Oracle 和同 Run QA/Trace。A2 Run
`32110f83-ac3a-8594-b38e-014537158d9e` 的 Semantic、Text2SQL、48 行月度客户类型面板和独立源 Oracle 全部正确，但 Root 直接用
QueryEvidence 完成答案，没有委派 Analysis，因而没有受验 Stage、AnalysisReport 或两张确定性图。B3 Run
`807a1d26-29c5-888e-98ce-627283a72780` 已真实完成 `Semantic -> Text2SQL -> Analysis`，32 行完整双月面板、渠道筛选
`SMS`、全部四类人群、stage result 与独立 Oracle 均零差异；输出另含按目标人群轴的空筛选和明确标注的待验证假设/下一步。

两题都没有产品数据或公式错误。前者是题面未把 Analysis 作为必需交接，后者是 `4.1.0` 禁止任何原因/建议的文案与已验收
`ratio_rollup` 方法的标准描述性结尾不一致。依据用户允许明确语义术语和降低反复失败的叙事难度，前向非计分 profile 版本化为
`complex-l4-semantic-defined@4.2.0`；其余四题不变：

- A2：`沿用上一题最近12个完整月的同比窗口。由 Semantic 保留订单收入、订单月份、客户类型和同比口径，Text2SQL 输出完整的
  12个月 × 客户类型同比事实面板；随后必须交给 Analysis Agent，计算整体同比下降最大的3个月及各客户类型对整体同比变化的贡献，
  并发布整体同比趋势图和客户类型对比图。不能只返回48行原始表格，也不能用历史答案替代当前Run证据。`
- B3：`继续使用上两题的渠道范围和请求级净ROI口径。比较最近两个完整的营销表现自然月：Semantic 解析已发布营销日期、营销归因收入、
  RECENT_COMPLETE_PERIODS + AGGREGATE_RATIO；Text2SQL 先输出完整 month × channel × audience 两月事实面板，SQL阶段不得预筛。
  随后必须交给 Analysis Agent，从完整当前Run面板按渠道重新汇总并筛出本期投入增加且净ROI下降的渠道，列出入选渠道的全部目标人群事实。
  以渠道筛选为主要结论；Analysis可同时报告其他受验分类轴。只作描述性比较，任何可能原因或下一步必须明确标为待验证假设，禁止因果或持续趋势断言。`

- **R-FL-AHANDOFF-01** A2/B3 必须在同一 Run 形成当前 SemanticQueryContext、SqlArtifact、QueryEvidence、受验 Analysis Stage、
  AnalysisReport 和所需图；Root 直接总结原始表不满足这两题。B1/B2 仍允许 `Semantic -> Text2SQL -> FINAL_ANSWER`，不得统一强塞 Analysis。
- **R-FL-AHANDOFF-02** A2 必须保留 48 行完整面板、整体重组与三个月排名，并发布恰好两类必需图。B3 必须保留 32 行完整面板、
  父渠道先汇总再相除和入选渠道全部子组；额外分类轴只能补充，不能替代渠道主结论。
- **R-FL-AHANDOFF-03** “待验证假设”不是因果证明。答案必须把事实、口径与假设分区，不能声称持续趋势、根因或确定性建议。
  `4.2.0` 不修改生产分析方法、SQL proof、公式、权限、publisher、repair 或模型预算。
- **AC-FL-AHANDOFF-01** 关闭 `f02d610a` 现场并证明 live E16 零漂移后，用新 clean build/fresh physical scratch 从 A1 重跑六题；
  不拼接本轮 A1/B1/B2 或 A2/B3 的部分事实。六题全部完成独立 source/stage/business Oracle 和同 Run QA/Trace 后才进入 F5/F7。

### 22.13 B3 精确公开时间维度必须进入冻结检索闭包

`a7d34c53` 的 `4.2.0` 同一 frozen build/scratch 已连续通过 A1/A2/A3/B1/B2；A2 按新合同真实完成 Analysis、48 行面板、两图和同 Run
UI。B3 Run `978479c0-63e6-805f-9537-86766d5be830` 的首次 Semantic 委派为 `MODEL_STREAM_PROTOCOL_VIOLATION`，随后三次均以
`TEAM_SEMANTIC_SELECTION_OUTSIDE_FROZEN_CLOSURE` 失败，零 Artifact、SQL 或 Analysis，最终 `ROOT_AGENT_TURN_BUDGET_EXHAUSTED`。

当前 Run 的 intent/retrieval hash 正确，但 `4.2.0` 把此前成功题面中的公开维度名“blinkit_marketing_performance date”缩写为
“已发布营销日期”。冻结检索集合因此只有渠道、目标人群、投入与收入，没有 `contains.column.blinkit_marketing_performance.date` 或
`dimension.runtime_time_blinkit_marketing_performance_date`；对照 `f02d610a` 成功 B3，这两项都曾由精确公开名选入。Semantic 尝试选择闭包外
时间对象被正确拒绝，不能放宽 frozen-closure 防火墙。

前向非计分 profile 版本化为 `complex-l4-semantic-defined@4.3.0`。A1/A2/A3/B1/B2 与 `4.2.0` 完全相同；B3 只恢复精确公开名称：

`继续使用上两题的渠道范围和请求级净ROI口径。比较数据中最近两个完整的营销表现自然月：时间字段使用已发布维度
“blinkit_marketing_performance date”，收入使用已发布的“营销归因收入”。由 Semantic 解析 RECENT_COMPLETE_PERIODS +
AGGREGATE_RATIO；Text2SQL 先输出完整 month × channel × audience 两月事实面板，SQL阶段不得预筛。随后必须交给 Analysis Agent，
从完整当前Run面板按渠道重新汇总并筛出本期投入增加且净ROI下降的渠道，列出入选渠道的全部目标人群事实。以渠道筛选为主要结论；
Analysis可同时报告其他受验分类轴。只作描述性比较，任何可能原因或下一步必须明确标为待验证假设，禁止因果或持续趋势断言。`

- **R-FL-TIME-CLOSURE-01** 题面只使用 active generation 2 的公开对象名，不携带内部 node ID、物理 SQL、结果值或 Host 注入；Semantic 仍须
  从冻结目录解析并提交 Context。精确名称必须使日期列与唯一营销日期维度进入 retrieval receipt，不能依赖 Agent 越界补选。
- **R-FL-TIME-CLOSURE-02** `4.3.0` 不改变 `4.2.0` 的 Analysis 必需交接、32 行完整面板、渠道主筛选、假设边界、proof、预算或 UI 标准。
  旧 `4.2.0` Run 与前五题 PASS 保持历史，不能拼接。
- **AC-FL-TIME-CLOSURE-01** scoped docs commit 后审计并关闭 `a7d34c53`；新 clean build/fresh physical scratch 从 A1 连续重跑六题。
  B3 只有当前 Run retrieval/Context、完整 QueryEvidence、Analysis Stage、source/business Oracle、答案和 QA/Trace 全部通过才闭合预检。

### 22.14 请求派生列与单 Analysis Stage 必须由题面显式约束

`a35b67b5` 的 `4.3.0` 已证明精确公开维度名修复有效：B3 Run `b721daf0-620b-8205-ba2a-c154b309bbef` 的 frozen selection
同时包含营销事实日期列与 `dimension.runtime_time_blinkit_marketing_performance_date`，当前 Run SemanticQueryContext 也正确产生
`RECENT_COMPLETE_PERIODS` 和请求级 `AGGREGATE_RATIO` 两个 interpretation。失败转移到 Text2SQL compile：三次候选都只输出月份、渠道、目标人群、
投入和收入五列，遗漏与 request derivation 对应的 `net_roi` 输出绑定，因而被 `QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID`
正确拒绝；零 SQL 执行、QueryEvidence 或 Analysis。

同一 epoch 的 A2 Run `0eaaaa1b-8842-8b4e-a4b8-d3799657ad1f` 虽然当前 Run 事实正确，却把一个问题拆成四个 Analysis task/stage，
重复答案与图表，违反一次交接和恰好两类必需图的业务合同。A1、B1、B2 已完成独立业务及同 Run UI 验收，但都只保留为诊断证据，不能跨 epoch
拼成 PASS。前向非计分 profile 版本化为 `complex-l4-semantic-defined@4.4.0`；A1/A3/B1/B2 不变：

- A2：`沿用上一题最近12个完整月的同比窗口。由 Semantic 保留订单收入、订单月份、客户类型和同比口径，Text2SQL 输出完整的12个月 ×
  客户类型同比事实面板；随后只委派一个受治理 Analysis task，并在同一个 Analysis Stage 内一次完成整体同比下降最大的3个月、各客户类型对
  整体同比变化的贡献，同时一次发布整体同比趋势图和客户类型对比图。不得拆成多个 Analysis task/Stage，不得重复发布同一分析或图；不能只返回
  48行原始表格，也不能用历史答案替代当前Run证据。`
- B3：`继续使用上两题的渠道范围和请求级净ROI口径。比较数据中最近两个完整的营销表现自然月：时间字段使用已发布维度
  “blinkit_marketing_performance date”，收入使用已发布的“营销归因收入”。由 Semantic 解析 RECENT_COMPLETE_PERIODS +
  AGGREGATE_RATIO；Text2SQL 必须输出完整 month × channel × audience 两月事实面板，共32行，每行包含营销投入、营销归因收入和按该分组
  先汇总后相除的请求级净ROI，SQL阶段不得预筛。随后只委派一个受治理 Analysis task，从完整当前Run面板按渠道重新汇总并筛出本期投入增加且
  净ROI下降的渠道，列出入选渠道的全部目标人群事实。以渠道筛选为主要结论；Analysis可同时报告其他受验分类轴。只作描述性比较，任何可能原因
  或下一步必须明确标为待验证假设，禁止因果或持续趋势断言。`

- **R-FL-EXPLICIT-BINDING-01** B3 的 QueryEvidence 必须含 `month/channel/target_audience/spend/revenue/net_roi` 六个受验绑定；
  `net_roi` 必须引用当前 SemanticQueryContext 的 REQUEST_ONLY interpretation。不能删掉派生列、把它伪装成已发布公式或由 Host 补列。
- **R-FL-SINGLE-STAGE-01** A2 只允许一个当前 Run Analysis task/stage，一次发布两类必需图；不得将多个重复 Stage/Report/Chart 合并为 PASS。
  B3 同样只允许一次 Analysis 交接，父渠道比例仍从完整32行面板按 SUM-before-ratio 重算。
- **R-FL-44-SCOPE-01** `4.4.0` 只澄清已有语义/编译/编排合同，不改变 frozen closure、编译器、SQL proof、方法实现、模型预算、Oracle、权限、
  live authority 或 UI 标准。
- **AC-FL-44-01** 关闭 `a35b67b5` 并证明 live E16 零漂移后，以新 clean build/fresh physical scratch 从 A1 重跑六题；六题同 epoch
  全部完成独立 source/stage/business Oracle 和同 Run QA/Trace 后才进入 F5/F7。

### 22.15 `4.4.0` 六题同纪元闭合，正式门禁仍须新权威

`e5dc68c8` clean force build、full unit gate 与 fresh E17 physical scratch 已在同一个冻结 baseline 上连续完成 A1/A2/A3/B1/B2/B3。
六个 Run 分别为 `8a0a153a-34ad-8fd8-95aa-bbd4d84e919e`、`9ebdec0e-a934-8977-b3e3-34c4b5924745`、
`7e194e22-595a-8171-9019-63c2d49f950b`、`7d7c6ab4-c999-8be3-88c2-d34052ba7232`、
`bf920b92-c9b0-8dcd-892e-bf8627147643` 与 `ea240149-cb75-8f66-bb60-bd449d5da022`；全部完成独立 source/stage/business
Oracle，并在业务通过后复用同 Run 打开答案入口 Trace、全部节点/Artifact 详情和刷新恢复，节点数依次为 73/76/80/73/73/98。

A2 现在只有一个受治理 Analysis task/stage，并在同一 stage 一次发布两类必需图。B3 冻结精确日期列/维度及两个请求解释，Text2SQL 返回
32 行、`month/channel/target_audience/spend/revenue/net_roi` 六个绑定；单个 Analysis stage 从完整面板重算，渠道主筛选唯一为 `SMS`，
保留四类目标人群，并只输出明确标注的待验证假设。详情见
[六题闭合证据](research/complex-e5dc68c8-six-turn-closure.md)。

- **AC-FL-44-01** 已满足，但这六题是 `formal_gate_pass=false` 的非计分预检，不能改写为 §20 的 15 回合正式 PASS。
- **R-FL-FORMAL-FRESH-01** 记录本节会形成新 HEAD；F5/F7 必须从该新 HEAD 重新 clean build、fresh 专用物理 scratch 和 fresh
  four-layer attempt 开始，禁止复用 `e5dc68c8` 的 build、baseline、Conversation、Run 或 Artifact。
- **R-FL-FORMAL-VERSION-01** 正式 15 回合沿用 §20 的 5/2/2/6 层级和一次性 authority，同时把本节已经验证的公开公式、请求级术语、
  完整面板与单 Analysis Stage 合同写入新的版本化 manifest；不得把非计分 profile 或旧 manifest hash 冒充新 authority。

### 22.16 正式 manifest v2 冻结协作难度，不降低证据难度

正式 authority 使用 `falcon24-four-layer-gate-manifest@2.0.0`。15 回合及 5/2/2/6 数量保持不变；v2 只把已经在 §22.15
闭合的公开语义写进题面和 rubric：同比使用最近 12 个完整月及 12 行结果合同，ROAS 使用当前 active Semantic Release 已发布公式，
趋势题要求一次 Semantic→Text2SQL→单 Analysis 交接，营销题要求精确日期维度、32 行六列完整面板、请求级
SUM-before-ratio 净 ROI 与单 Analysis Stage。Report 只在题目要求时出现，不能再把非必要 Report 当作 Semantic/Text2SQL 协作通过的前提。

- **R-FL-MANIFEST-V2-01** v2 turns 的 canonical hash 固定为
  `sha256:4ecf4742d2f8a201b3abe9609177441a0672a629becb4f58a23c18b7c7251142`；历史 v1 继续绑定
  `sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9`。schema version 与另一版本 turns/hash 混配必须失败关闭。
- **R-FL-MANIFEST-V2-02** migration 10817 只能前向替换 `begin_falcon24_four_layer_gate(jsonb)` 的 manifest 版本校验，必须保持已有
  attempt/turn/history 表逐字节不变、函数 owner/ACL 不变，并保留 v1 begin/replay 能力。
- **R-FL-MANIFEST-V2-03** v2 不允许 Host 注入 SQL、内部对象 ID、结果值、关键词路由或模型输出；Semantic 仍从 active catalog
  解析并签发当前 Run Context，Text2SQL 仍编译、执行并产出同 Run QueryEvidence，业务 Oracle 和 UI/Trace 标准不变。
- **AC-FL-MANIFEST-V2-01** scoped commit 后必须以该 commit 重做 clean force build/full unit/attestation，创建 fresh physical scratch、
  fresh activation 和唯一 v2 attempt；`e5dc68c8` 预检及迁移验证副本均不得升级为正式证据。

### 22.17 表格 UI 证据覆盖独立 TABLE 与图表源表

- **R-FL-TABLE-UI-01** `table_required=true` 时，当前 Run 内真实可见的独立 TABLE Artifact 或已展开的 governed chart source table
  都是合格表格可见性证据；observer 不得把独立 QueryEvidence 表误判为无表格。
- **R-FL-TABLE-UI-02** 修复只增加稳定 DOM 标记和 observer selector，不放宽可见性、current Run、build、刷新、Agent 状态、错误横幅、
  business receipt 或 Trace receipt 检查。
- **AC-FL-TABLE-UI-01** 首个失败 attempt 保持 immutable；focused tests 与 scoped commit 后，以新 clean build/fresh scratch/fresh
  attempt 从 L1-01 重跑，禁止复用其前三题 PASS。

### 22.18 纯明细题冻结直接 Text2SQL 边界

v2 正式执行证明 L1-04 的数据、SQL、Oracle、TABLE UI 和 Trace 均可通过，但 Root 也可能把纯明细请求先交给 Semantic；当 Semantic
对并不需要的指标/时间对象留下空候选歧义时，Text2SQL 会正确 fail-closed。正式门禁不能依赖 Root 恰好跳过这次无关预解析。

- **R-FL-MANIFEST-V3-01** 保留 v1/v2 题库不可变；v3 只将 L1-04 澄清为纯订单明细查询，明确无需先解释指标或时间语义并直接交给
  Text2SQL。不得注入 SQL、内部对象 ID、结果值或 Host 关键词路由。
- **R-FL-MANIFEST-V3-02** L1-04 仍必须由当前 Run 的 Text2SQL 产出恰好 10 行 QueryEvidence，独立 PostgreSQL Oracle、TABLE UI、
  business 与 Trace 标准不变。
- **R-FL-MANIFEST-V3-03** migration 10818 只能在精确 post-10817 函数 hash 上增加 v3 schema/turns hash；历史实体、v1/v2 replay、
  owner、SECURITY DEFINER 与 ACL 必须保持不变。
- **AC-FL-MANIFEST-V3-01** 实现与真实 PostgreSQL 三版本 replay 验证后创建 scoped commit；正式证据必须从该 commit 重新 clean build、
  fresh physical scratch、fresh E17 activation 和 fresh v3 attempt 开始。

### 22.19 客单价题只验收已发布公式

v3 的 L1-02 已由 Semantic 正确命中已发布 `formula.average_order_value`，但旧题面同时要求解释未发布的“客户订单总金额”，导致
`SemanticQueryContext` 附带空候选 FORMULA 歧义。Host 因而正确拒绝自动结算，Root 随后两次返回非 JSON 并耗尽 turn budget。这不是
客单价公式缺失，也不是 Semantic 与 Text2SQL 协作能力失败；继续依赖模型猜测一个未治理术语会让门禁验证偏离业务目标。

- **R-FL-MANIFEST-V4-01** 保留 v1/v2/v3 题库不可变；v4 只把 L1-02 收敛为直接询问已发布
  `formula.average_order_value` 的分子、分母和零订单处理，并只保留 `published-aov-definition` rubric。L2–L4、其余14题、Agent 合同、
  当前 Run 证据、Oracle、UI/Trace 与 authority 标准不变。
- **R-FL-MANIFEST-V4-02** v4 turns canonical hash 固定为
  `sha256:1b197368096673c1015935308f2db4a4fcddb0f3cc04c73b627cd7ce4d97503f`；schema version 与 v1/v2/v3 turns/hash 混配必须失败关闭。
- **R-FL-MANIFEST-V4-03** migration 10819 只能在精确 post-10818 ledger/checksum 与函数 hash 上增加 v4 分支；历史实体、四版本
  replay、owner、SECURITY DEFINER 与 ACL 必须保持不变。
- **AC-FL-MANIFEST-V4-01** 真实 PostgreSQL 四版本验证与 scoped commit 后，正式证据必须从该 commit 的 clean build、fresh physical
  scratch、fresh E17 activation 和 fresh v4 attempt 开始；任何旧 attempt 的局部 PASS 仍不可组合。

### 22.20 containment 物理列闭包与显式明细题

`ff960257` 已消除 L1-04 的模型上下文预算阻塞；新 v4 attempt `cf8646cf-2d4f-4731-8c3a-af8a3b712445` 的 L1-01～L1-03
再次完成 business/QA/Trace。L1-04 已进入真实 Text2SQL 候选生成，但宽泛题面检索了无关时间对象，导致 temporal compile 在候选所需列之外
失败。同一 scratch 的非计分显式物理列 canary 随后成功 compile 并执行，最终只因检索选择的是
`contains.column.blinkit_orders.*`，而模型投影和 QueryEvidence 仅按同名 `column.blinkit_orders.*` 查找而失败。

- **R-FL-CONTAINED-COLUMN-01** 已验证检索闭包中的 `contains.column.<table>.<column>` 只授权同名
  `column.<table>.<column>` 进入 Text2SQL 模型投影与 QueryEvidence selected set。对应 active release physical binding、datasource 与
  schema snapshot 仍须逐项验证；不存在 containment 选择或已发布 binding 时继续失败关闭。
- **R-FL-MANIFEST-V5-01** 保留 v1～v4 题库不可变；v5 只把 L1-04 写成显式
  `falcon_db_24.blinkit_orders` 三列、date cast、降序和参数化 `LIMIT 10` 的纯物理列查询。它仍由 Semantic 检索闭包和 Text2SQL
  compile/execute/QueryEvidence 协作完成，不允许 Host 注入候选 SQL 或结果。
- **R-FL-MANIFEST-V5-02** v5 turns canonical hash 固定为
  `sha256:040e238b038f8ec2d246f553ac26a1d7abc6067f152e4106f7aca93859c6d55c`。migration 10820 只能在 exact post-10819
  ledger/checksum 与函数 hash 上增加 v5 分支，历史表、五版本 replay、owner、SECURITY DEFINER 与 ACL 保持不变。
- **AC-FL-MANIFEST-V5-01** focused 回归、真实 PostgreSQL 迁移/replay、scoped commit 后，必须从新 commit clean build、fresh
  physical scratch、fresh E17 activation 和 fresh v5 attempt 自 L1-01 重跑；v4 的前三题 PASS 与 canary 均不可拼接。

### 22.21 已接受表格到 Report Agent 的显式交接

v5 attempt `3e95d599-edcf-4777-bc1f-3a5630ea179d` 的 L1-01～L1-04 已在同一 build/scratch 完成 business、QA 与 Trace；
L1-05 的 exact current-Run accepted table 也已绑定，但 Root 两次在任何 Tool Call 之前违反结构化响应协议，Run 因而失败。
该题唯一业务目标是验证已接受表格到 Report Agent 的交接，不需要让 Root 猜测“直接格式化”还是“委派报告”。

- **R-FL-MANIFEST-V6-01** 保留 v1～v5 题库不可变；v6 只把 L1-05 写成显式委派 Report Agent，并继续要求只消费
  current-Run accepted table、不查询其他数据、不增加表外结论。expected Agent、rubric、accepted-input、Oracle、QA/Trace 和 L2～L4 均不变。
- **R-FL-MANIFEST-V6-02** v6 turns canonical hash 固定为
  `sha256:959a850d482cd49fb8840da0a2f7c0cdc1a788bcbe1f00430bbd591afd07b22a`。migration 10821 只能在 exact post-10820
  ledger/checksum 与函数 hash 上增加 v6 分支；历史表、六版本 replay、owner、SECURITY DEFINER 与 ACL 保持不变。
- **AC-FL-MANIFEST-V6-01** focused 回归、真实 PostgreSQL 迁移/replay、scoped commit 后，必须从新 commit clean build、fresh
  physical scratch、fresh E17 activation 和 fresh v6 attempt 自 L1-01 重跑；v5 前四题 PASS 不得复用。

### 22.22 渠道 ROAS 的 Semantic → Text2SQL 两步交接必须单义

v6 attempt `a9782700-abc4-47ab-b1b9-68d6032dab6c` 已完整通过 L1 五题和 L2-01。L2-02 的发布
`formula.marketing_roas` 已在 route decision、retrieval selected set 和 inference mandatory closure 中存在；失败不是公式缺失。
Root 前两次给 Semantic objective 增加“当前窗口/时间语义”，Semantic 因选择冻结闭包外对象被正确拒绝；第三次又把 objective 改成
`semantic-only`，虽生成合法 `SemanticQueryContext`，却不再委派 Text2SQL，最终只有定义、没有渠道表。

- **R-FL-MANIFEST-V7-01** 保留 v1～v6 题库不可变；v7 只把 L2-02 冻结为两步：Semantic 只选择
  `dimension.marketing_channel`、`metric.marketing_spend`、`metric.marketing_revenue`、`formula.marketing_roas`，不选择额外时间口径或关系；
  随后 Text2SQL 对全部可用营销数据按渠道输出 `channel/total_spend/marketing_revenue/roas`，不得添加日期过滤或在 Semantic 后结束。
- **R-FL-MANIFEST-V7-02** expected Agent 仍精确为 Semantic + Text2SQL 两个 task；ratio-of-sums、零投入返回0、QueryEvidence、业务 Oracle、
  QA/Trace 和 L3～L4 均不变。不得增加 Host Router、固定 DAG、自动补 SQL 或放宽 frozen closure。
- **R-FL-MANIFEST-V7-03** v7 turns canonical hash 固定为
  `sha256:df80081985d2a65f2ea161bb079a8b2a1dfa2930a90090493f3be6f640032795`。migration 10822 只能在 exact post-10821
  ledger/checksum 与函数 hash 上增加 v7 分支；历史表、七版本 replay、owner、SECURITY DEFINER 与 ACL 保持不变。
- **AC-FL-MANIFEST-V7-01** 真实 PostgreSQL 迁移/replay、focused validation 与 scoped commit 后，必须从新 commit 的 clean build、
  fresh physical scratch、fresh E17 activation 和 fresh v7 attempt 自 L1-01 重跑；v6 已通过的六题不得拼接复用。

### 22.23 Root Tool Call 不得被低于 Team 合同的输出硬上限截断

- **R-FL-ROOT-OUTPUT-01** Production Root 单次 provider 请求的 `max_output_tokens` 上限为4096，并继续受认证模型
  `effective_output_ceiling_tokens` 与有效 context headroom 的更小值约束；不得保留额外2048硬上限。
- **R-FL-ROOT-OUTPUT-02** 本项不增加 provider 调用次数、Root 四回合、工具权限或修复重试，也不改变 manifest、Agent contract、
  business/QA/Trace rubric。未闭合 Tool Call 仍失败关闭，Host 不得拼接或补写模型输出。
- **AC-FL-ROOT-OUTPUT-01** 回归必须证明原 profile ceiling 4000 被完整传入 provider，而不是截为2048；focused validation 与 scoped
  commit 后，从新 clean build、fresh physical scratch、fresh v7 attempt 自 L1-01 重跑，旧 L1 四题 PASS 不得复用。

### 22.24 Semantic 专职范围不得覆盖 Root 终态意图

v7 attempt `78d327e2-a020-450d-991a-d6d2bfd44ec2` 已在同一 build/scratch 完整通过 L1 五题和 L2-01。L2-02 Run
`31a7dde2-6242-83aa-a598-46f032edf3d3` 中，Root 首个原生 Tool Call 明确选择 Semantic、将产物标记为
`CONTINUATION_INPUT`，并要求随后继续完成渠道 ROAS 数据查询。Semantic 正确返回仅含四个已发布对象的合法
`SemanticQueryContext`；其 `answer_scope=SEMANTIC_FACTS_ONLY` 只描述本次专职语义任务的范围。Worker 却仅据该字段自动生成最终答案，
覆盖了 Root 已持久化的 continuation 意图，导致 Text2SQL 从未获得第二次委派。attempt 已按真实
`AGENT_CONTRACT_MISMATCH` 不可变封存。

- **R-FL-SEMANTIC-TERMINAL-01** Semantic 自动结算必须同时满足：已验收 `SemanticQueryContext` 的
  `answer_scope=SEMANTIC_FACTS_ONLY`、无未决歧义，并且对应 Root observation 的
  `output_usage=FINAL_ANSWER_EVIDENCE`。两条终态信号缺一不可。
- **R-FL-SEMANTIC-TERMINAL-02** `output_usage=CONTINUATION_INPUT` 时，Worker 必须把完整 observation 历史返回 Root 的下一次正常
  provider turn，使 Root 自主选择后续 Agent；不得因 specialist answer scope 提前结算，也不得丢弃先前失败 observation。
- **R-FL-SEMANTIC-TERMINAL-03** 本修复只消费现有 Root 决策字段，不增加关键词 Router、固定 DAG、自动 Text2SQL 调度、SQL 注入或
  semantic authority 放宽；非法 Context、未决歧义及错误产物继续失败关闭。
- **AC-FL-SEMANTIC-TERMINAL-01** 测试矩阵必须覆盖 `CONTINUATION_INPUT` 与
  `FINAL_ANSWER_EVIDENCE` 两种 Semantic usage，证明前者继续 Root、后者仍可确定性结算，并保留 observation 历史。focused validation
  与 scoped commit 后，必须从新 clean build、fresh physical scratch、fresh E17 activation 和 fresh v7 attempt 自 L1-01 重跑；
  本次六题 PASS 不得拼接复用。

### 22.25 已完整观测的 Root Schema 拒绝不得冒充未知 Provider 结果

v7 attempt `4da7380e-1dc2-4377-82c6-06efaa186ee2` 已在同一 build/scratch 完整通过 L1 五题、L2 两题和
L3-01。L3-02 Run `d46227a0-d8d0-8337-85f4-65ba316060b8` 的首个 Root provider generation 在没有任何 Tool
Call 时完整结束，返回的是可解析 JSON，但第二个 section 不符合服务端 `root-agent-final-answer@1.0.0` Schema。旧 bridge 已经完整读取
原响应、finish reason 和 usage，却仍将该确定性拒绝投影为 `DISPATCHED_OUTCOME_UNKNOWN`，Team 因而无法使用既有正常 Root 回合纠正格式。
Run/attempt 已按真实失败不可变封存，前八题 PASS 不复用。

- **R-FL-ROOT-SCHEMA-REJECTION-01** 只有同时满足“原始流完整结束、无 Tool Call 或其他非文本活动、finish reason 为 stop/length、
  usage 未越界、完整文本等于已观测 delta、JSON 可解析但不符合服务端 Response Schema”的响应，才可投影为新的
  `MODEL_RESPONSE_SCHEMA_INVALID / DISPATCHED_OUTCOME_KNOWN / retryable=false`。缺少任一证明时继续保持未知结果并失败关闭。
- **R-FL-ROOT-SCHEMA-REJECTION-02** Direct Root dispatcher 只把上述已知拒绝与既有 empty/invalid-JSON 拒绝统一映射为
  `PROVIDER_RESPONSE_REJECTED`，由持久 checkpoint 消耗下一个普通 Root turn 并反馈 Schema 约束。不得同 call 重试、修补/提取字段、
  接受部分值、重放响应、增加回合预算或固定后续 Agent。
- **R-FL-ROOT-SCHEMA-REJECTION-03** 持久 Provider transport 必须保留相同已知拒绝语义；Tool Call 后的错误、未完整流、未知 finish、
  超预算、Structured Output 内部故障以及一般 `MODEL_STREAM_PROTOCOL_VIOLATION` 不得被降级为可恢复的 Schema 拒绝。
- **AC-FL-ROOT-SCHEMA-REJECTION-01** 回归必须覆盖 AUTO/JSON_TEXT wrong-schema 与 extra-field、event certainty、Direct Root 分类、
  persisted transport 和 Root checkpoint repair；focused validation 与 scoped commit 后，必须从新 clean build、fresh physical scratch、
  fresh E17 activation 和 fresh v7 attempt 自 L1-01 重跑，本次八题 PASS 不得拼接。

### 22.26 Root 必须保持用户显式语义范围，不能把“当前数据”改写为时间窗口

v7 attempt `ca939d37-25dd-4889-b18f-c6e81de80f49` 已在同一 build/scratch 完整通过 L1 五题、L2 两题和 L3-01。L3-02 Run
`9ba72726-6311-81cb-ac27-af279acb57d6` 的前两次 Root Semantic objective 都为题目自行增加了“当前时间窗口/时间语义”，Semantic 的
完整响应因不符合选择 Schema 被安全拒绝；§22.25 的已知拒绝通道正确让 Root 在普通下一回合恢复。第三次去除该额外时间范围后，Semantic
与 Text2SQL 均成功并接受 Artifact，但四个 Root 回合已耗尽，且 Text2SQL objective 还遗漏了题面显式要求的 conversions，无法进入唯一
Analysis Stage。attempt 已按真实 `ROOT_AGENT_TURN_BUDGET_EXHAUSTED` 不可变封存，前八题 PASS 不复用。

- **R-FL-ROOT-SCOPE-01** “当前数据/当前事实/active release”只限定答案的 authority 与 freshness；在用户或继承意图没有给出期间、
  窗口或比较范围时，Root 不得据此要求 Semantic 选择额外时间语义、可执行当前窗口、日期过滤或无关关系，Text2SQL 保持 all-time/unbounded。
- **R-FL-ROOT-SCOPE-02** 用户显式枚举的维度、指标、公式、输出列、分组键和图表要求必须在需要它们的 Semantic、Text2SQL、Analysis
  objective 中完整传递；不得静默漏项、改变含义或加入无关语义范围。多步链路必须在完整面板基础上进入后续能力。
- **R-FL-ROOT-SCOPE-03** 本项只收紧通用 Root system contract，不按关键词、case ID 或固定 profile 路由，不修改 v7 manifest、四回合预算、
  Provider 重试、Artifact admission、业务 Oracle、QA/Trace 或 authority 门槛。
- **AC-FL-ROOT-SCOPE-01** Harness 回归必须同时证明“当前数据不构成时间窗口”和“显式业务项跨链路保持”；focused validation 与 scoped
  commit 后，必须从新 clean build、fresh physical scratch、fresh E17 activation 和 fresh v7 attempt 自 L1-01 重跑，本次八题
  PASS 不得拼接。

### 22.27 营销转化必须复用现有发布对象，不创建影子指标

v7 attempt `4b851d00-eded-4ebd-a6c6-1e3bf8eaf3f3` 的 L1 五题、L2 两题和 L3-01 在同一 build/scratch 完成
business/QA/Trace PASS。L3-02 Run `9ea0054a-eade-8373-8e98-e941e517153c` 中，§22.26 已使 Root 保留全部业务字段且不再
增加请求时间窗口；Semantic 仍把“营销转化”解析为空候选 METRIC。active generation 2 实际已有
`metric.conversions` 和 `formula.conversions=SUM(conversions)`，发布别名为“转化量”。该 Run 在 Text2SQL I/O 前按
`TEXT2SQL_SEMANTIC_CONTEXT_AMBIGUOUS` 失败，attempt 已不可变封存，前八题 PASS 不复用。

- **R-FL-MANIFEST-V8-01** 保留 v1～v7 题库不可变；v8 只将 L3-02 冻结为三步委派，并显式复用 active release 的
  `metric.conversions`、`formula.conversions`、`metric.marketing_spend`、`metric.marketing_revenue`、
  `formula.marketing_roas`、`dimension.marketing_channel` 和 `dimension.target_audience`。不得创建同义影子 Metric 或 Formula。
- **R-FL-MANIFEST-V8-02** Text2SQL 对全部可用营销数据按 `channel × target_audience` 输出六列完整事实表且不得添加日期过滤；随后只进入
  一个 governed Analysis task/Stage。表、图、同源 lineage、非因果结论、business Oracle、QA/Trace 与动态 Agent 数量边界不变。
- **R-FL-MANIFEST-V8-03** v8 turns canonical hash 固定为
  `sha256:b741d7abc1e929ef6cacf0a482e4b2235e5442756eb2d4f75cdc3dbcc6846d43`。migration 10823 只能在 exact post-10822
  ledger/checksum 与函数 hash 上增加 v8 分支；历史表、八版本 replay、owner、SECURITY DEFINER 与 ACL 保持不变。
- **AC-FL-MANIFEST-V8-01** focused 回归、真实 PostgreSQL v1～v8 replay、scoped commit 后，必须从新 commit 的 clean build、fresh
  physical scratch、fresh E17 activation 和 fresh v8 attempt 自 L1-01 重跑；本次八题 PASS 不得拼接。

### 22.28 多单位比较不得降级 Analysis 权威，门禁改用单一已发布度量

v8 attempt `9771bf1a-d0df-437c-9ba4-48dda36f78ea` 已在 commit `43bcc102`、同一 fresh physical scratch 与同一
E17 activation 下完成 L1 五题、L2 两题和 L3-01 的 business/QA/Trace PASS。L3-02 Run
`66f7c8ed-ae09-87de-836e-2aa141d923ec` 中，Semantic 精确选择了 v8 枚举对象，Text2SQL 也提交了16行六列
`channel/target_audience/total_spend/marketing_revenue/conversions/roas` QueryEvidence；Analysis 在创建 Stage 前两次以
`CATEGORY_COMPARISON_AUTHORITY_INVALID` 拒绝。根因是 category comparison 同时收到 `unit.count` 与 `unit.currency`，触发既有
`UNIT_MISMATCH` 守卫；它是防止混合单位进入同一比较图的正确失败关闭，不能通过放宽 planner/compiler 修复。Run 最终按
`ROOT_AGENT_TURN_BUDGET_EXHAUSTED`、attempt 按真实 FAILED 不可变封存。

- **R-FL-MANIFEST-V9-01** 保留 v1～v8 题库不可变；v9 只前向替换 L3-02，使用已发布
  `metric.conversions`（定义引用 `formula.conversions=SUM(conversions)`）、`dimension.marketing_channel` 和
  `dimension.target_audience`。不得选择投入、收入、ROAS、时间语义或额外关系。
- **R-FL-MANIFEST-V9-02** Text2SQL 仍须对全部可用营销数据按 `channel × target_audience` 输出完整三列事实表；随后只委派一个
  governed Analysis task，在同一 Stage 发布完整事实表与转化量对比图。业务 Oracle、QueryEvidence lineage、QA/Trace、非因果结论及
  Agent 动态协作门槛不降低。
- **R-FL-MANIFEST-V9-03** v9 turns canonical hash 固定为
  `sha256:04ee93aa5fc9eb0e21ae58c5d7b9503ffa8705866b1af11461e7881c444f7de9`。migration 10824 只能在 exact post-10823
  ledger/checksum 与函数 hash 上增加 v9 分支；历史表、九版本 replay、owner、SECURITY DEFINER 与 ACL 保持不变。
- **AC-FL-MANIFEST-V9-01** focused 回归、真实 PostgreSQL v1～v9 replay、scoped commit 后，必须从新 commit 的 clean build、fresh
  physical scratch、fresh E17 activation 和 fresh v9 attempt 自 L1-01 重跑；v8 的八题 PASS 不得拼接。

### 22.29 Worker 新租约必须能恢复同一 Run 的历史 checkpoint

v9 attempt `966091b9-6d20-46d9-9373-ace1bb9449d8` 在 `e138c1e1` 完成 L1-01、L1-02 的 business/QA/Trace。
L1-03 Run `96323cb9-3332-81eb-ad71-98fc62fe3199` 已接受 Semantic 产物，随后本地 Worker 中断。
新 Worker 在 fence=2 接管时因快照仍记录原 attempt/fence=1 而报 `ROOT_AGENT_LOOP_SNAPSHOT_INVALID`；attempt 已不可变封存为 FAILED。

- **R-FL-LEASE-RECOVERY-01** 合法的同 Run 持久化 checkpoint 必须可由后继租约恢复；原写入租约与当前执行租约不能强制相等。
  同 fence 异 attempt、未来 fence、旧 fence 复用当前 attempt、跨 Run/Scope、非法版本/hash/引用继续失败关闭。
- **R-FL-LEASE-RECOVERY-02** 恢复必须保留已接受输入、工具结果、Root 回合及终态，不重复 Provider、SQL、Sandbox 或 Artifact 副作用；
  后续 checkpoint 与写入继续使用当前租约的权限和 fence。未知副作用及已封存正式失败不因本修复获得重试权限。
- **AC-FL-LEASE-RECOVERY-01** 必须先精确复现新租约下 accepted-input/tool/terminal 三种恢复失败，再用同租约/新租约与非法来源矩阵验证；
  focused 验证、scoped commit 后从新 clean build、fresh physical scratch 和 fresh v9 attempt 自 L1-01 重跑。

### 22.30 月度比较必须在统计前识别 pandas 缺失表示

v9 attempt `7be3d293-3f00-480e-aede-cc4fbe2820df` 在 `d63b5716` 完成前七题 business/QA/Trace，L3-01
Run `3402eaaf-7b68-834c-8366-74111c262e75` 在 Analysis 发布前被独立 Oracle 拒绝。两个原序列各有 6 个 NULL，
暂存统计却为 observed=12/missing=0，极值和排名含 NULL；原完整表图数值保留。attempt 已封存 FAILED。

- **R-FL-MONTHLY-NULL-01** 分析 Cell 在计数、排序、排名、算术前必须区分 pandas 缺失表示与有效数值；0 仍为观测，原行、日历端点和缺口不得变化。
- **R-FL-MONTHLY-NULL-02** 可为既有月度描述性方法提供不含数据/答案的计算参考及精确 source metadata，遵循已有分类/分群方法模式。
  模型仍提交并实际执行 Cell；Host 不执行参考或注入结果，独立 Oracle、Publisher、stage、预算和 v9 题库不变。
- **AC-FL-MONTHLY-NULL-01** 回归先红后绿；原 Agent 镜像真实 Arrow/pandas 的 NULL/NaN/NA、0、端点/缺口、别名/列序/时区逐字段校验，
  原输入不变，旧失败输出继续拒绝。focused 验证和 scoped commit 后以 fresh build/scratch/v9 attempt 自 L1-01 重跑，不拼接前七题。

### 22.31 终态入口不能代替 QA Artifact 就绪

`20d7f063` 的 v9 attempt `73d1612f-2736-41c1-b4bb-d8630b10732a` 完成 L1 五题 business/QA/Trace。
L2-01 Run `6be6a170-7146-89a9-a5bd-46d803f4abe5` business PASS，但首次 QA 表格尚未渲染，刷新后出现，attempt 已封存 FAILED。

- **R-FL-QA-READY-01** 首次与刷新后均须按原 rubric 有界等待当前 Run 的答案、必需表/图及 loader 就绪，不能只等待终态入口。
- **R-FL-QA-READY-02** 不降低表图、身份、Agent、Build、刷新或错误检查；不重提业务、不调用模型、不改写原失败回执。
- **AC-FL-QA-READY-01** 真实等待表达式回归先红后绿、同一浏览器只读复验、focused validation 和 scoped commit 后，
  以新 clean build/fresh physical scratch/v9 attempt 从 L1-01 验收15题；本次五题不拼接。

### 22.32 纯公式结果的支撑 Metric 必须传递到 ResearchBrief

`06628bba` 的 v9 attempt `7693bb8e-877f-4f5c-b817-ed806a76de78` 在同一构建下完成前八题 business/QA/Trace PASS。
L3-02 Run `6ac09e67-3a96-8cc7-bab1-cd38ebae67f5` 的16行转化量与源表完全一致，结果合法标记 `FORMULA/formula.conversions`。
上游已解析支撑 `metric.conversions`，但 Brief 重扫直接 METRIC 列得到空引用，在原 schema 的 min(1) 处失败。原 attempt 已封存 FAILED，
Analysis Stage/Sandbox 执行为0，live authority writes=0；不能把 SQL 正确计为本题 PASS。

- **R-FL-FORMULA-BRIEF-01** 支撑 Metric 集合由既有发布/检索/物理依赖解析一次，Context 与 Brief 必须复用该集合；不得重标结果角色。
- **R-FL-FORMULA-BRIEF-02** 原 Brief 非空指标、来源、Oracle、预算和发布边界不变；缺失支撑或 Context 换绑在副作用前失败关闭。
- **AC-FL-FORMULA-BRIEF-01** 完整装配回归先红后绿，覆盖纯公式、无支撑、Context 错绑及原混合结果；focused 验证与 scoped commit 后
  用 fresh build/physical scratch/v9 attempt 从 L1-01 验收全部15题，前八题不拼接。

### 22.33 多轮门禁区分资源快照与消息轮次

`1c24ed3b` 的 v9 attempt `64530f4a-8df6-49c0-8956-871cd8996aab` 已完成前10题 business/QA/Trace PASS；
L3-02 的 FORMULA-only 事实表、唯一 Analysis Stage 和完整表图均通过。L4-A-02 在 claim 前以
`FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH` 拒绝，未产生该题 Run 或模型调用。
同一 Conversation 已有两条消息，resource_version 仍为1，这是正常产品语义；原门禁误要求每轮严格加一。
原 attempt 经原 supersede RPC 封存 FAILED/version52，前10题不复用。

- **R-FL-RESOURCE-SNAPSHOT-01** 本节前向澄清 §20.2 的资源版本递增要求：v10 同组 Conversation ID 必须相同，
  resource_version 单调不减，且每次 claim 必须与当前服务端资源版本精确一致。消息推进由严格顺序的 turn ordinal、
  scenario index、唯一 Run 和当前 Run 冻结的对话输入证明，不靠资源版本加一。
- **R-FL-RESOURCE-SNAPSHOT-02** v1～v9 保留旧规则和回放语义；v10 复用 v9 全部15题、rubric 和 turns canonical hash
  `sha256:04ee93aa5fc9eb0e21ae58c5d7b9503ffa8705866b1af11461e7881c444f7de9`。
  禁止为通过门禁而重命名、移动、切换资源以人为增加版本；不改业务 Oracle、Agent 协作、QA/Trace 或安全要求。
- **R-FL-RESOURCE-SNAPSHOT-03** migration10825 只在 exact post10824 frontier/checksum 和原 begin/claim 函数 hash 上
  前向更新原 RPC；保留 owner、ACL、SECURITY DEFINER、CAS、Run 唯一性、scope 和全部历史表。
- **AC-FL-RESOURCE-SNAPSHOT-01** Contracts 与真实 PostgreSQL 先红后绿，覆盖 v1～v10、相等/增加/倒退、同组第二/三轮、
  换对话、过期快照、前轮未通过、重复 Run、顺序及 CAS 冲突。诊断夹具全部回滚，受保护历史逐表 count/hash 不变。
  scoped commit 后从新 clean build、fresh physical scratch/E17/v10 attempt 完整验收15题，再做 live E17、F7和最终清理。

### 22.34 Report 不得为无单位输入补币种

`759c2a86` 的 v10 attempt `a10b9a9d-c948-464e-88d9-0a34b7c9cf75` 前四题 business/QA/Trace PASS。
L1-05 Run `2ee80595-2495-8cca-8755-af5e104f1b90` 只调用 Report，原表三行金额和数值计算正确，但报告加入了输入未注明的“元”。
原 controller 已按 no-unsupported-claims 失败封存 FAILED/version24；没有执行本题 QA/Trace 或后十题，没有 live authority 写入。

- **R-FL-REPORT-UNIT-01** 单位、币种和缩放只能来自当前已验收证据；缺失时明确披露，不得从回答语言、地区、数据集或用户措辞推断。
  显式单位原样保留；不更改 accepted table 来追认答案，不在模型输出后替换币种，不增加 Semantic/Analysis 或固定路由。
- **R-FL-REPORT-UNIT-02** 本次仅收紧原 REPORT Provider 生成指令。输入投影、Artifact/Scope/Run/hash、原响应 schema、调用与预算均保持；
  原 v10 题库、rubric、15题范围、Oracle 和安全边界不变。Prompt 回归不等于真实文本事实正确。
- **AC-FL-REPORT-UNIT-01** 实际 dispatcher 回归先红后绿，覆盖未指定/通用币种/CNY/INR/显式缩放，校验输入原样、task identity、一次零工具调用。
  focused validation 和 scoped commit 后，用 fresh build/physical scratch/E17/v10 attempt 完整验收15题，随后 live E17、F7和最终清理；
  前四题不拼接，历史失败不重放。

### 22.35 Report 单位缺失披露必须进入最终答案

`12b8e2b3` 的 v10 attempt `ba3417b7-5fc9-444f-954f-cc8eac7ea686` 已完成前11题原 rubric、
QA、Trace；但逐项需求复核发现 L1-05 Run `82df306a-38cf-885d-85a2-1858bacbf8c5`
只保留无单位数字，没有明确披露单位缺失，不满足 R-FL-REPORT-UNIT-01。原三个 rubric PASS 不能证明该额外要求。
原 attempt 在 READY/version56 经既有 supersede RPC 封存 FAILED/version57；后四题未提交，live authority 未写。

- **R-FL-REPORT-DISCLOSURE-01** 数值摘要的最终 answer 须明确说明证据中的单位/币种/缩放边界，缺失就披露；
  裸数字或“未使用其他信息”不代替披露。简短摘要、不得新增结论的要求不排除证据限制说明；显式单位不能误称缺失。
- **R-FL-REPORT-DISCLOSURE-02** 只细化原 REPORT 生成指令，不替换/追加模型输出，不改 accepted input、schema、调用预算、
  路由、题库或历史 receipt。语义层与数据源证据仍为事实来源。
- **AC-FL-REPORT-DISCLOSURE-01** 实际 dispatcher 离线请求回归覆盖缺失/通用币种/显式币种/缩放、原 context/hash 与一次零工具调用。
  新 frozen build 的 L1-05 在继续后续题目前，须同时核验原 rubric 和本条披露；prompt 测试不能代替实际答案。
  全15题及 live E17/F7/390px/历史/资源闭包仍须完成，当前11题不拼接为新构建成绩。

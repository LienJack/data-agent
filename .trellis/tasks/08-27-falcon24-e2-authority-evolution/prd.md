# Falcon24 Semantic Generation 2 与 E4 原子权威恢复

> 执行状态（2026-08-28）：W1-W7 已实施并通过全量验证；被拒绝的 generation-1 repair 现场已按用户授权封存到可恢复审计 stash。
> 用户已批准 exact review packet 与 W8。10795 已应用，旧 `e430` 已通过 capability-gated authority 封存为 `HOLD`；随后 clean build
> 上唯一一次 `e431` Finalizer 因既有 smoke 幂等键未绑定 Worker build 而失败关闭，且未留下 `e431` session、E4 baseline 或 activation。
> 当前仍为 E3/gen1，generation 2 candidate 保持 `SMOKE_PASSED`。W8-R3 与 10796 已提交并应用；其后只运行一次 `e432`
> Finalizer，新 build smoke PASS 已 append，但 combined activation 因把 ChangeSet digest 与 schema snapshot digest 混为同一哈希域而 HOLD。
> `e432` 当前为 STAGED session/baseline + OPEN attempt，E4/current 未移动；诊断与正式门禁只能在 W8 成功后按 fail-closed 顺序执行。

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
- 本节当前是 review gate。未经用户明确批准 W8-R4，不实现 10797、不调用 HOLD Port、不运行 `e433`。

# Falcon24 Semantic Generation 2、E4 原子恢复与 E5 前向构建权威 — Implementation Plan

> W1-W7 已于 2026-08-28 实施并全量验证。用户已批准 exact review packet 与 W8；10795 已应用，旧 `e430` 已封存为 HOLD。
> clean build 上唯一一次 `e431` Finalizer 因 smoke 幂等键未绑定 Worker build 而失败关闭，current 仍为 E3/gen1 且无 E4 污染。
> W8-R3 与 10796 已应用；随后只运行一次 `e432` Finalizer，新 smoke PASS 已 append，但 combined activation 因错误混用 ChangeSet/snapshot
> digest 而 HOLD。用户已批准 W8-R4；代码/迁移/测试已提交为 `04d5db4e`，权威库尚未执行 e432 HOLD、10797 或 e433。
> current 仍为 E3/gen1；`e432` 保留 STAGED baseline/session 与 OPEN attempt，等待受控权威执行。
>
> 2026-08-29 amendment：e432 已 HOLD、10797 已应用、e433 已唯一执行并原子激活 E4/gen2。E4 的 attestation 后验发现错误签入
> `.next/cache/**`，且原物理 cache bytes 已不可恢复。E4 不得重签；用户已授权进入 E5 并无人值守。第 6 节 E5 包替代下方历史 W9/W10
> 的 E4 执行标签，E4 diagnostic/Q1/C1 保持零行。

## 0. Current Freeze

### W0-R — Review-only planning freeze（审计现场已封存）

- [x] 以下未提交实现文件已按用户 2026-08-28 的明确授权原样封存到可恢复审计 stash；不得 restore 到执行路径、drop、提交或执行：
  - `apps/web/package.json`
  - `apps/web/src/cli/bootstrap-falcon24-e1.ts`
  - `apps/web/src/cli/finalize-falcon24-authority.ts`
  - `apps/web/test/bootstrap-falcon24-e1.spec.ts`
  - `apps/web/test/falcon24-authority-finalization.spec.ts`
  - `apps/web/src/cli/repair-falcon24-semantic-projections.ts`
- [x] 将 generation 1 原地 repair 明确记录为 rejected alternative。
- [x] 在 `prd.md` / `design.md` / `implement.md` 记录 generation 2 staging、shared validator、smoke、combined E4 activation、
  diagnostic 与 gate 方案。
- [x] 冻结审计指纹：5 个 tracked dirty 文件的 binary diff SHA-256 为
  `b33ac56c06211c9c1421c5e332d8d93c1f7f48f44e94d6c6b450f2878d139f68`；untracked repair CLI 的 Git blob 为
  `992536063ea3414f16ea0a07500e1d765b176e19`。
- [x] 审计 stash 为 `audit/rejected-generation1-repair-2026-08-28`；`git stash show` 的六文件集合与上述 tracked diff/blob 指纹均已
  从 stash 对象重新计算并精确匹配。stash 不属于可执行实现，也不进入任何 build/database 命令。
- [x] 用户评审并明确批准 W1-W7；随后已明确批准 exact review packet 与 W8。

W0 方案提交：`35f55d21 docs: plan Falcon24 generation 2 E4 recovery`。W1 合同与共享 validator 提交：
`a86a9494 feat: define semantic successor runtime closure`。

## 1. Global Preconditions After Approval

- 只在 `codex/falcon24-e1-authority-reset` worktree 工作，root checkout 保持不动。
- Rejected dirty 实现已经用户授权移入命名审计 stash；后续实现只能修改 clean HEAD，禁止 restore/drop/执行该 stash。
- PostgreSQL 17 migration frontier 必须仍是 10782；专用 E3 数据库与 E1/E2/E3 历史只读快照先导出审计摘要。
- 每个工作包先写失败测试/characterization，再实现；focused validation通过后只 stage 该包 owned files，创建一个 scoped commit。
- 不 stage `apps/web/next-env.d.ts`、`apps/web/tsconfig.tsbuildinfo`、qualification manifests、截图、日志、凭据或生成的本地证据。
- 任一工作包失败立即停止并报告；不得提高 retry、重跑正式 gate、手工修数据或扩大权限推进。

## 2. Work Packages

### W0 — Freeze evidence, PRD/design/implement/runbook

**Ownership**

- `.trellis/tasks/08-27-falcon24-e2-authority-evolution/{prd,design,implement}.md`
- 新增 E4 review/runbook 文档（批准后确定路径）
- 必要的 `.trellis/spec/` 更新，仅记录获批合同

**Work**

- [x] 记录 exact E3 current、gen1 Release/projection failure、E1/E2/E3 baseline/receipt/run/gate evidence 与 hashes。
- [x] 固定 rejected alternative 审计指纹；当前处置为原样保留且不得覆盖/暂存/提交。
- [x] 三个 review question 按推荐默认项批准：free-text quality 缩小声明、diagnostic 独立 10784、bootstrap 复用唯一 Port并 fail closed。
- [x] 运行 Trellis task validation 与 Markdown/static consistency check。

**Gate / commit**

- 文档内部 schema、RPC、锁序、状态机、恢复、文件边界、测试矩阵一致。
- Commit（批准后）：`docs: plan Falcon24 generation 2 E4 recovery`。

### W1 — Contracts and shared runtime closure validator

**Ownership**

- `packages/contracts/src/artifacts/semantic-lifecycle.ts`
- `packages/contracts/src/evals/falcon24-authority-baseline.ts`
- `packages/contracts/src/runs/authority-epoch.ts`
- `packages/semantic/src/production/runtime-closure-validator.ts`
- `packages/semantic/src/production/{publisher,publication-projection,index}.ts`
- 对应 Contracts/Semantic tests 与 exports

**Work**

- [x] Test-first 定义 successor stage、projection set、validation/smoke receipt、proof v2、combined activation refs/hash domains。
- [x] 提取 `verifySemanticReleaseEnvelope` / `validateSemanticRuntimeClosure`，保持生产 read port 可复用的纯合同边界。
- [x] 覆盖 metric、dimension、relationship、formula AST、time、quality 当前结构化字段、restriction、graph/source closure。
- [x] 明确 quality free-text 不在字段级证明范围。

**Validation**

- Focused contract and semantic tests；malformed/unknown/tamper/hash-domain/reference negative matrix。
- Contracts/Semantic typecheck/build；architecture scan 确认 validator 不依赖 Web/Worker。

**Stop conditions**

- Validator 与当前生产读端需要不同 envelope 时停止，先解决单一合同，禁止复制校验器。

**Commit**

- `feat: define semantic successor runtime closure`。

### W2 — 10783 successor staging storage and combined activation RPC

Status: completed on 2026-08-28.

**Ownership**

- `infra/supabase/apps/data-agent/migration-sources/10783/`
- `infra/supabase/apps/data-agent/migrations/20260725010783_app_data_agent_semantic_successor_e4_activation.sql`
- `scripts/migration-manifests.json`
- migration renderer/inventory/test-support owned by 10783

**Work**

- [x] 新增三张 stage/receipt 表、exact constraints、one-live-stage index、append-only/immutability triggers、RLS/minimal grants。
- [x] 为既有正式 Release/projection/graph 历史补数据库级 UPDATE/DELETE deny protection，不改任何现存 row bytes。
- [x] 新增 server-owned stage/smoke CAS functions 与
  `app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)`。
- [x] Combined RPC 实现固定锁顺序、exact E3/gen1 preconditions、stage/smoke/baseline binding、E4 pollution scan、formal promotion、
  semantic pointer/runtime/defaults/E4/outbox/receipt/stage PROMOTED 的单事务切换。
- [x] Postconditions 审计 function definition、owner、RLS、grants、trigger、constraint、ledger/checksum。

**Validation**

- Renderer write/verify；migration inventory。
- PostgreSQL 17 fresh chain。
- Exact E3 fixture upgrade，pre/post generation 1/E1-E3 counts/hashes/documents/projection bytes相同。
- Direct UPDATE/DELETE deny、scope/RLS/grant越权、same-key replay/different-key conflict。
- Failure injection + two-session concurrency only all-old/all-new；lock-order/no-deadlock。

**Evidence**

- 10783 declarative renderer write/verify PASS；最终 checksum
  `sha256:bbbec227c257178bc6c92654ab4a7ec0a4cc2520cb303d16c909914b97703930`（W5 增加旧 activation RPC
  fail-closed 后的当前值）。
- Migration renderer、workspace inventory 与 10783 static contract：3 files / 17 tests PASS；scoped Biome 与 `git diff --check` PASS。
- Platform typecheck、`bash -n` smoke harness、workspace migration inventory verifier 与完整 Supabase SQL static checks PASS。
- 复用既有 PostgreSQL 17 容器，在临时 scratch database
  `data_agent_semantic_successor_w2_52de40d0` 从 C7 frozen database clone 后应用 10783；migration checksum、owner/ACL/postconditions 与
  pre/post formal-history row count/digest 全部 PASS，没有新建 Docker 容器。
- `61-semantic-successor-e4-activation-assertions.sql` 返回
  `SEMANTIC_SUCCESSOR_E4_ACTIVATION_ASSERTIONS_READY`：覆盖 exact four projections、derived idempotency digest、same-key replay/conflict、
  malformed validation/smoke/version rejection、direct DML denial、generation-one formal history immutability、proof v2 evidence binding 与 late-failure rollback。
- PostgreSQL 双连接竞争观察值固定为 pre-commit `1:E3:1:SMOKE_PASSED`、post-commit
  `2:E4:2:PROMOTED:1`；两条并发调用和后续 replay 返回同一 activation hash，promotion 后 stage replay 返回 `PROMOTED`。
- 专用 E3 database/container 未读取、未迁移、未激活；W8 仍要求新的用户明确授权。

**Stop conditions**

- 任何 pre/post历史 byte漂移、direct backend DML、partial current或相反锁序立即停止；不应用到专用 E3 DB。

**Commit**

- `feat: stage semantic successors for atomic E4 activation`。

### W3 — Publisher and PostgreSQL adapter staging authority

**Ownership**

- `packages/semantic/src/production/publisher.ts`
- `apps/web/src/lib/postgres-semantic-publication.ts`
- Platform Semantic adapter/exports/tests（评审时确认实际文件）

**Work**

- [x] 演进唯一 `SemanticPublicationAuthorityPort`：stage/load/promote；保留 shared compiler/hash/write kernel。
- [x] `stageReviewedSuccessor` 仅接收 refs/CAS/idempotency，服务器锁定并读取 ChangeSet/review/snapshot/compiler bundle。
- [x] 服务器调用 `compileSemanticPublicationProjection` 和 shared validator，重算 projection/release/stage/validation hashes。
- [x] Validation PASS 时 stage header、exact four projections、validation receipt 同事务写入并以 STAGED 可见；candidate 编译后
  validation FAIL 时同事务写完整 stage/projections、validation/rejection receipts并终结为 REJECTED；前置 ref/CAS 无效则不写 stage。
  Client payload/digest 无可达参数面。
- [x] 历史 E1 bootstrap 已退役为纯 fail-closed admission guard；它不读数据库、不写 generation 1、不提供 projection/publisher 面，
  并明确要求现有 exact E3 环境从唯一 `finalize:falcon24-authority` 入口建立 gen2/E4。

**W3 evidence（2026-08-28）**

- `semantic-change-set-publication@2` 的 compiler bundle hash 只绑定 compiler/source/snapshot/runtime-closure 合同，不再随业务
  ChangeSet 内容漂移；release/projection identity 绑定 exact ChangeSet 与 physical snapshot hash。
- PostgreSQL adapter 固定按 semantic fence → active pointer → candidate revision → source revision → review → publish attempt →
  domain → immutable catalog snapshot 顺序读取；同一 `pg` client 不并发发锁请求。Catalog snapshot bytes、ChangeSet/review 三份副本、
  compiler bundle 与 CAS 全部在调用 10783 stage RPC 前重验。
- `packages/semantic/test/semantic-successor-publication-projection.spec.ts` 证明最小 Falcon order revenue/month generation 2 envelope
  由服务器编译后通过 shared validator；snapshot byte tamper fail closed。
- `apps/web/test/postgres-semantic-successor-publication.spec.ts` 证明错误 scope 在 connect 前拒绝，record RPC 收到的四类 payload
  来自 server compiler 而非 command；严格 command schema 拒绝额外 `projections` 字段。
- Falcon24 全量 characterization 已把既有 Source 的时间域统一为 half-open `Asia/Shanghai` 合同，并显式生成缺失的 runtime time
  dimensions / 多列物理 formula dependencies。W3 提交时 `cohort_retention` / `repeat_purchase_rate` AST slots 尚无受审
  dependency definitions，shared validator 会稳定返回 `SEMANTIC_RUNTIME_FORMULA_DEPENDENCY_INVALID`；该 blocker 已在 W5 以
  `GROUP_COUNT` + `cohort_customers` / `retained_customers` / `repeat_customers` 结构化定义解决，未放宽 validator。
- 聚焦验证：Semantic/Worker typecheck PASS；5 个测试文件 27 tests PASS；10 个 owned files Biome 与 `git diff --check` PASS。
- 用户授权封存审计现场后，`72ff3bc0` 将历史 bootstrap 缩减为 40 行纯 admission guard：无确认时 `NOT_RUN`；确认后稳定
  `HOLD / FALCON24_E1_BOOTSTRAP_RETIRED_SEMANTIC_SUCCESSOR_REQUIRED / NO_GENERATION_1_WRITES`。该入口不连接数据库，不能创建
  新 gen1；现有 exact E3 恢复只走唯一 successor publisher 与 E4 combined activation Finalizer。

**Validation**

- Idempotency replay/conflict、stale pointer、scope mismatch、server recomputation、transaction interruption、no-half-stage。
- Port conformance tests；production import graph 确认没有第二 publisher/repair adapter。

**Stop conditions**

- 若实现需要让 CLI 传 projection payload/digest 或绕过 reviewed ChangeSet，退回设计。

**Commit**

- `feat: stage reviewed semantic successors`。

### W4 — Worker deterministic stage smoke

**Ownership**

- `apps/worker/src/semantic/semantic-release-read-port.ts`
- 新增 Worker stage smoke runtime/CLI/tests
- `apps/worker/package.json` script（如需要）

**Work**

- [x] 生产 read port 改为调用 shared validator，不保留 Worker 私有近似 schema。
- [x] Stage smoke 精确加载 stage envelope；固定 metric/dimension/window/Asia-Shanghai 计划。
- [x] 明确禁止 model/provider、正式 Run、计分 gate 与网络副作用。
- [x] 生成 smoke receipt，PASS CAS `SMOKE_PASSED`；semantic FAIL receipt + CAS `REJECTED`；process interruption留在 STAGED。

**Evidence (2026-08-28, W4)**

- 新增 `PostgresSemanticSuccessorSmokeAuthority`：按 `stage_id` 加载未提升候选、按 exact `release_id` 加载已提升四投影
  envelope，并通过唯一 `commit_semantic_successor_smoke` RPC 提交 exact receipt；生产 read port 与 stage smoke 均调用
  `verifySemanticReleaseEnvelope` + `validateSemanticRuntimeClosure`，generation 1 缺少 promoted successor 时继续以
  `SEMANTIC_RELEASE_PROJECTION_INVALID` fail closed。
- Worker smoke 仅接受 authority/build identity，没有 model/provider/Run/gate/network 依赖；固定
  `metric.order_revenue`、`dimension.order_month`、`Asia/Shanghai` 与
  `[2023-11-01T00:00:00.000Z, 2024-11-01T00:00:00.000Z)`，绑定 exact stage、四类 projection、resolved binding、
  validator 与 Worker build 后生成确定性 plan/receipt hash。进程在唯一 commit RPC 前中断时零写入；PASS/FAIL/replay
  均由 PostgreSQL CAS/幂等约束封口。
- 10783 增加窄的 `load_promoted_semantic_successor_release(jsonb)` read RPC，返回前逐项核对正式 source release、三类 runtime
  projection、graph binding 与 immutable staged bytes；更新后 migration checksum 为
  `sha256:bbbec227c257178bc6c92654ab4a7ec0a4cc2520cb303d16c909914b97703930`（包含 W5 旧入口权限收紧）。
- PostgreSQL 17 临时库 `data_agent_semantic_successor_w2_52de40d0` 实跑 migration + assertions PASS：FAIL receipt 在测试
  子事务中观察到 `REJECTED` 后回滚，PASS/replay 通过，combined activation 后 exact release loader 返回 `PROMOTED`；专用
  E3 数据库未连接、未修改。
- 验证：Contracts 97 files / 943 tests PASS；Platform 106 files / 667 tests PASS；Worker 86 passed + 2 skipped files、
  405 passed + 9 skipped tests；Contracts/Platform/Worker typecheck PASS，Worker build PASS；migration renderer/inventory、
  focused Biome 与 `git diff --check` PASS。

**Validation**

- Exact stage/digest/build fence；零 provider calls spy；deterministic plan hash；PASS/FAIL/replay/crash。
- Worker focused/full tests、typecheck/build；production read fixture 与 stage fixture调用同一 validator。

**Stop conditions**

- Smoke 需要模型来决定 metric/dimension/binding，或创建正式 Run，立即停止。

**Commit**

- `feat: verify semantic successors with deterministic smoke`。

### W5 — Proof v2, Finalizer and atomic activation adapter

**Ownership**

- `packages/platform/src/runs/postgres-authority-epoch.ts`
- `packages/platform/src/semantic/falcon24-retained-authority-proof.ts`
- `apps/web/src/lib/falcon24-successor-authority-staging.ts`
- `apps/web/src/cli/finalize-falcon24-authority.ts`
- 相关 Platform/Web tests

**Work**

- [x] 新 proof v2 绑定 gen1 predecessor、gen2 candidate、四类 projection、source/compiler、validation/smoke、expected versions。
- [x] 删除 successor=predecessor proof requirement；保留旧 builder only for history verification。
- [x] 删除 CLI 对 `prepareWorkspaceAuthority` 的调用；E4 supporting authority 只读加载 exact E3 defaults，不从 gen1 current 推导或写入
  successor ref。
- [x] Finalizer固定 stage -> smoke -> proof -> stage E4 receipts/baseline/session -> combined RPC -> production-port readback。
- [x] Readback mismatch 只报告 severe incident并冻结，不执行补写/rollback。

**Validation**

- Proof lineage/generation+1/CAS/tamper tests。
- Finalizer no-activation-before-smoke、combined command refs-only、post-commit exact readback。
- Fault injection与 W2 RPC一起证明 atomicity。

**Stop conditions**

- Finalizer 任一步在 combined RPC 之前更新 semantic pointer/defaults/current，立即停止。

**Evidence（已完成的 clean boundary）**

- Platform 新增 successor-only proof builder：从 exact `SMOKE_PASSED` stage、PASS validation、PASS smoke 与 expected CAS
  构造 `falcon24-semantic-release-authority-proof@2.0.0`；显式证明 gen1 -> gen2 lineage、四投影、source/compiler 与不同
  hash domain，不再要求 successor proof 等于 predecessor proof。旧 generation-1 builder 仅保留 historical compatibility 名称。
- Semantic Formula AST 新增结构化 `GROUP_COUNT(group_by, having)`，复购客户由 orders 上按 customer 分组且
  `COUNT(DISTINCT order_id)>1` 证明；新增三条 reviewed helper metrics 后，cohort/repeat ratio 只引用同 generation 的逻辑指标，
  允许复合指标没有伪造的直接物理 dependency column。Falcon 全量 envelope shared validator 由唯一
  `SEMANTIC_RUNTIME_FORMULA_DEPENDENCY_INVALID` 变为 PASS，且断言投影中不出现不可信 `customers.total_orders` fallback。
- Contracts 98 files / 945 tests、Semantic 29 files / 182 tests、Worker 86 passed + 2 skipped files / 405 passed + 9 skipped
  tests、Contracts/Evals/Semantic/Worker typecheck/build 与 focused Biome PASS。
- 普通 `PostgresFalcon24AuthorityEpoch.activate` 对 E4 及以后在 PostgreSQL I/O 前返回
  `FALCON24_COMBINED_SEMANTIC_ACTIVATION_REQUIRED`；10783 同时撤销 `data_agent_backend` 对旧
  `activate_falcon24_authority(jsonb)` 的 EXECUTE，仅保留 combined RPC。
- 10783 renderer write/verify、Platform proof/adapter/static tests、Platform full unit 107 files / 671 tests、typecheck/build、
  focused Biome 与 `git diff --check` PASS；全量测试发现的大载荷 NDJSON fixture 未等待 stdout flush 问题已先以独立
  `ef57bf9d` 修复并经 7/7 聚焦测试验证。
  当前 checksum 为 `sha256:bbbec227c257178bc6c92654ab4a7ec0a4cc2520cb303d16c909914b97703930`。
- 复用现有 PostgreSQL 17 容器，将任务 scratch DB `data_agent_semantic_successor_w2_52de40d0` 从 C7 frozen template 重建后
  应用 10783，并重跑 `61-semantic-successor-e4-activation-assertions.sql`，返回
  `SEMANTIC_SUCCESSOR_E4_ACTIVATION_ASSERTIONS_READY`；专用 E3 database/container 未连接、未修改。
- 先前因冻结审计现场而未接线的 Finalizer 条目已在用户授权封存后完成；审计 stash 保持独立且未被 restore、执行或吸收。
- 新增 server-only `falcon24-successor-finalization` 协调器，已经把正确顺序固定为生产读口 exact E3/gen1/CAS preflight ->
  唯一 publication authority stage -> Worker deterministic smoke -> 重载 `SMOKE_PASSED` stage -> proof v2 -> E4 staging callback ->
  refs-only combined RPC -> production closure/promoted Release readback。协调器没有 projection payload/digest 参数，也没有 post-commit
  补写/rollback 接口；receipt baseline/attempt 换绑、mixed readback 或 readback I/O 失败均以稳定 severe code 冻结后续执行。
- 新协调器测试 7/7 PASS，覆盖严格顺序、Worker capability 传递、smoke/rejected stage 的 activation-before-smoke 禁止、refs-only
  combined command、receipt 换绑、stale preflight 与 post-commit severe readback。Contracts dependency/semantic architecture 19/19 PASS，
  scoped Biome 与 `git diff --check` PASS。
- `76af77c8` 补齐 Direct Semantic Editor 的 `GROUP_COUNT(group_by, having)` 创建/编辑模型并提升 Formula AST v2；8 个 Web
  聚焦测试和 1 个 contract test PASS。Web typecheck 此后只剩冻结 bootstrap/repair 审计现场错误。
- `74645c51` 强制 Finalizer 对 Worker smoke receipt 的 exact build identity 做二次核对，防止 stage PASS 被错误 build 冒用。
- Contracts 增加 refs-only `falcon24-semantic-authority-closure-load@1.0.0` 与严格
  `falcon24-semantic-authority-closure@1.0.0`；10791 新增只读 closure RPC，Platform reader 在单个 `REPEATABLE READ` snapshot
  内读取 current authority、semantic pointer/runtime 与 workspace defaults，并拒绝 mixed Release refs。backend 只有 RPC
  EXECUTE，无 pointer/runtime/defaults 表级 SELECT。
- 在通用 W7 scratch DB 上前向应用 10791 后，真实 RPC 返回 E4、pointer/runtime/default versions 均为 2、三处 generation 均为 2、
  exact Release ref 相同；权限观察为 backend execute=true、public execute=false、三张权威表 backend SELECT=false。10791 checksum
  为 `sha256:59bc6176a5df701b053c0efd08c0b97927218e4307963723789102113af54dcb`；专用 E3 database/container 未连接、未修改。
- Web 增加 capability-bound production readback adapter，把 closure reader 与 existing promoted-successor reader 绑定到同一 domain；
  增加 bounded Worker smoke process adapter，只经环境传 stage/domain/idempotency/build identity refs，严格解析 stdout receipt，拒绝
  stderr、stage/build mismatch，且不把 child diagnostics 泄漏给调用方。readback 3/3、smoke process 3/3、Finalizer 8/8 聚焦测试 PASS。
- `b7c2cef3` 新增 clean E4 staging authority：任何 PostgreSQL 写入前先 exact 验证 `SMOKE_PASSED` stage 与 proof v2；开始 E4
  staging session 后只接受五类 exact supporting receipts，再把 candidate `release_digest` 与 proof `proof_hash` 分别写入
  `SEMANTIC_RELEASE` receipt 的 subject/evidence hash，构建并暂存 baseline 和 deterministic OPEN activation attempt。该端口没有
  semantic pointer、workspace defaults、current authority 或 `activate` 写方法，combined RPC 仍是唯一切换点。
- E4 stager 7/7、与 Finalizer/readback/Worker smoke 合并聚焦 21/21 PASS；覆盖严格调用顺序、幂等 replay、stage/proof 换绑、
  supporting receipt 缺失、sandbox isolation 冒充、semantic receipt 替换和非 exact OPEN attempt。scoped Biome、`git diff --check`
  PASS；当时 Web typecheck 的剩余错误仅来自尚未获准封存的审计现场，后续已由 `713181b5` / `72ff3bc0` 的 clean 接线消除。
- `bcc89692` 新增 read-only workspace supporting-authority preflight，替代旧 `prepareWorkspaceAuthority` 中危险的 defaults CAS：
  只从生产 Effective Config read port 加载现有 E3 defaults，验证 exact scope/defaults revision、generation-1 predecessor
  id/generation/digest、datasource/model/schema snapshot/policies 和空 extension collections，再返回冻结 refs。模块没有 defaults writer；
  stale/missing/cross-scope/malformed closure 均在 supporting receipt staging 前拒绝。
- Supporting preflight 5/5、W5 clean Web modules 合并聚焦 26/26 PASS；scoped Biome 与 `git diff --check` PASS。
- `713181b5` 完成实际 Finalizer 接线：仅接受 E4，读取 exact E3/gen1/defaults，要求 reviewed ChangeSet/review refs，调用唯一
  `createPostgresSemanticPublicationAuthority`，执行 deterministic Worker smoke、proof v2、E4 supporting staging、combined activation
  与生产端口 readback；删除旧 defaults CAS、generation-1 equality receipt、普通 `epoch.activate` 及失败后补写路径。6 个聚焦文件
  32/32 tests、Web typecheck PASS。
- `72ff3bc0` 退役 generation-1 bootstrap；2 个文件 10/10 tests、Web typecheck PASS。`571d1cd8` 随后将两个 Web root contract imports
  收窄到 domain subpaths，Contracts dependency boundary 15/15、相关 Web tests 5/5、Web typecheck PASS。

**Commits**

- `713181b5 feat(web): activate Falcon semantic successor atomically`。
- `72ff3bc0 fix(web): retire invalid Falcon generation-one bootstrap`。
- `571d1cd8 fix(web): use scoped contract imports`。

### W6 — Diagnostic authority and gate prerequisite

**Ownership**

- Diagnostic Contracts/Platform/Web control/tests
- 独立 10790 source/rendered/manifest/support（10784-10789 已由 Root Harness 占用）
- Qualification begin RPC/adapter 的 diagnostic prerequisite

**Work**

- [x] 新增 append-only diagnostic attempts/receipts；同 E4 baseline/gen2 Release 一个 active attempt。
- [x] 固定业务问题与 exact source/build/baseline/gen2 binding。
- [x] 诊断结果 immutable；失败不得 resume Run。
- [x] E4-Q1 begin 必须看到 exact PASSED diagnostic receipt，否则 fail closed。

**Validation**

- One-active concurrency、append-only/RLS/grants、wrong baseline/build/release rejection、Q1 prerequisite。
- Diagnostic失败分类：frozen change -> E5；external unchanged -> new attempt ID。

**Evidence**

- `falcon24-diagnostic-attempt@1` / `falcon24-diagnostic-receipt@1` 冻结 exact E4 + gen2 + source/build；PASS receipt 绑定
  browser QA/Trace hashes、五个 exact Artifact、实际观察到的动态 Tool Loop 闭包和 sandbox residual=0。
- 10790 已在现有通用 PostgreSQL 17 容器的任务 scratch DB `data_agent_falcon24_w6_08195096` 实际应用；frontier 为
  `20260725010790_app_data_agent_falcon24_diagnostic_authority`，backend 可执行新 diagnostic/Q1 wrapper，但不能执行
  `begin_falcon24_qualification_pre_diagnostic`。专用 E3 容器/数据库未连接、未修改。
- Contracts full：99 files / 949 tests；Platform full：109 files / 679 tests。10790 render verify、workspace migration inventory、
  Contracts/Platform typecheck/build 与 focused Biome 均通过。
- `observed_execution_path` 仅是完成后的验收证据；动态 Tool Loop 仍由 Root 逐轮决定当前下一次 Tool Call，Host 不据此选择
  后续业务能力。
- `d6ddff86` 补齐真实 W9/W10 接线：Web `falcon24:diagnostic:control` 支持 manifest/submit/status/trace/complete/fail；浏览器从真实
  composer 使用 deterministic non-scoring claim 创建 exact Run，Trace UI 提交同源 QA/Trace receipts；Worker
  `falcon24:diagnostic:reclaim` 独立证明 residual=0，不 claim Qualification/Campaign slot。E4-Q1 manifest 改用
  `falcon24-qualification-manifest@3.0.0` 并强制绑定同一 PASSED diagnostic receipt。相关 Web 5 files / 20 tests、Worker reclamation
  9/9、Web/Worker typecheck 与 scoped Biome PASS。
- `1b1c48f8` 修复真实 PostgreSQL begin 边界：Platform diagnostic adapter 在 begin 的同一事务设置
  `app.semantic_domain=falcon24`，否则 10790 RPC 会稳定拒绝；失败测试转绿，Platform/Web typecheck PASS。Diagnostic CLI 同时确保
  screenshot 目录在浏览器取证前存在。
- `e5525cfc` 将共享 sandbox reclamation helper 的 identity 收窄为 canonical Falcon gate（Q1/C1），使 non-scoring E4-Q1 diagnostic
  receipt 可生成，同时保留正式 campaign CLI 的 C1 输入边界；10/10 聚焦测试、Worker typecheck/build PASS。`4664e969` 证明 diagnostic
  browser claim 在客户端到服务器的请求中只投影 idempotency key，不泄漏 attempt/run identity，也不伪造 acceptance fence。

**Stop conditions**

- Diagnostic被计入Q1/C1分数，或API-only receipt可使Q1 begin通过，立即停止。

**Commits**

- `feat: require an E4 diagnostic proof before qualification`。
- `d6ddff86 feat(evals): wire Falcon E4 diagnostic gate`。
- `1b1c48f8 fix(evals): bind Falcon diagnostic semantic scope`。
- `e5525cfc fix(evals): allow diagnostic sandbox reclamation`。
- `4664e969 test(web): constrain diagnostic browser claims`。

### W7 — Full static, migration, concurrency and security qualification

**Ownership**

- 仅测试/证据/runbook修订；不在此包新增行为功能。

**Work / Validation**

- [x] Contracts、Semantic、Platform、Worker、Web focused/full suites、typecheck/build。
- [x] 10783 fresh PG17 + exact E3 fixture upgrade；10790 同样验证。
- [x] 历史 immutability pre/post digest、RLS/grants/capability scope、direct DML denial。
- [x] Combined activation failure-injection/concurrency all-old/all-new。
- [x] Production import graph：无 repair RPC、第二 publisher、Worker fallback、client projection payload面。
- [x] Docker inventory保持单一专用数据库；不创建新的数据库容器。

**W7 evidence（2026-08-28 全绿；不包含 W8 专用数据库执行）**

- Final clean HEAD 全量结果：Contracts 99 files / 950 tests、Semantic 29 / 182、Platform 111 / 684、Worker
  86 passed + 2 skipped files / 406 passed + 9 skipped tests；四个 package 的 typecheck/build 全部通过。
- Web 未排除任何 Falcon 审计测试：130 passed + 1 skipped files / 537 passed + 1 skipped tests；full lint（512 files）、typecheck 与
  Next production build 全部通过。build 仅报告两个既有 Evals installer 动态 `fs.stat` 警告，exit 0；格式基线修复独立提交为
  `b688af7c`。
- `infra/supabase/test-support/static-check.sh` 全绿；10783 checksum
  `sha256:bbbec227c257178bc6c92654ab4a7ec0a4cc2520cb303d16c909914b97703930`，10790 checksum
  `sha256:1fa18ed845d99c4964b11bd92169119b42a7eb040e5cf5918761675d1c5f1294`，10791 checksum
  `sha256:59bc6176a5df701b053c0efd08c0b97927218e4307963723789102113af54dcb`。
- 通用 PostgreSQL 17 容器内的 W7 scratch DB `data_agent_falcon24_w7_a26b976e` 从已验证 exact E3/10783 fixture
  前进应用 10784-10791。并发 observer 只看到 `1:E3:1:SMOKE_PASSED` 或 `2:E4:2:PROMOTED:1`；两个并发调用和 replay
  返回同一 activation receipt hash `sha256:9bd409a44e0fa89bbcd7e43d63518b481320b413b7e6b2e808490f0069230966`。
- activation 前后 generation 1 source release digest 均为
  `sha256:4756735c7f6f0095efe00273cf1b0f4ae52def1f4f9bcca399a12d4bf53bd1fd`；E1-E3 baseline digest 均为
  `sha256:67637a6e5d9d3119cbbfebe3769a49a4ea0f103dc92015a1149ac770292c56f6`；正式 generation 2 恰好一条。
- 新增 `62-falcon24-diagnostic-authority-assertions.sql`，实际通过 one-active closure、append-only trigger、RLS/grants、backend
  direct-DML denial 与旧 qualification mutator 隐藏，输出 `FALCON24_DIAGNOSTIC_AUTHORITY_ASSERTIONS_READY`。
- Docker 仍只有 `data-agent-postgres`、`data-agent-clamav`、`data-agent-neo4j` 与唯一专用
  `data-agent-falcon24-e1-e81a29c6`；W7 未连接、未修改专用 E3 数据库。
- Production graph 扫描未发现 repair RPC/CLI、第二 publisher、Worker fallback、client projection payload 面或 bootstrap semantic SQL。
  唯一 successor publisher 为 `publishReviewedSemanticChangeSet` + 单一 `createPostgresSemanticPublicationAuthority`；实际 Finalizer 只调用
  该 authority 与 combined activation，历史 bootstrap 只返回 fail-closed 结果。Docker 复核仍只有既有四个容器，审计 stash 未变化。
- W8 授权前的二次就绪审计发现旧 retained verifier 把三个已由 generation 2 合法演进的当前源码路径误判为 E1 历史损坏。
  `c0d88ebf` 保持 `falcon24-retained-assets@1.0.0` bytes 不变，改为从 manifest 首次引入提交 `5eb4714e` 读取并验证三个历史 Git blob，
  同时继续对 E4 当前消费的 31 个 dataset/LLM/runtime 文件严格验 hash；当前三个 semantic drift 仅作为显式前向差异报告。2 个测试文件
  13/13、focused Biome、CLI preflight、OpenSandbox attestation 与 runtime uniqueness 全部 PASS；未连接数据库或启动新容器。
- 用户补充的数据处置边界：只有本计划明列的 generation 1/E1-E3 权威历史不可丢失。若 W8 只读审计发现重构前损坏数据，必须先证明
  它不被 current closure/receipt 引用且不属于完成证据；此后才可经已审查 lifecycle/forward migration 丢弃，禁止手工 SQL 或把
  “可丢弃旧数据”扩大到受保护集合。

### W7-R — Fixed ChangeSet and human-review readiness

- [x] 新增 10792 review-preparation storage/RPC/security/postconditions；scope-level idempotency 支持第二名有效 principal 重放同一固定
  ChangeSet，append-only review document 仅向 backend 开放 capability/RLS 只读证据，所有 direct DML 继续拒绝。
- [x] `PostgresSemanticGovernanceService.submitDecision` 只调用 `human_record_semantic_review_decision(jsonb)`；backend 不再能执行内部
  `record_review_decision`。
- [x] `getPacketDetail` 对 successor packet 重算 packet digest 与 frozen ChangeSet hash，返回 exact
  `semantic-successor-review-evidence@1.0.0` payload，并从该 payload 派生可读 diff/impact；收件箱/详情 quorum 来自 policy snapshot 与
  真实 decision rows。验证失败 fail closed，不允许审核盲批。当前仓库提供普通治理 API；没有可用治理 UI 时不得把 API 证据表述为 UI
  证据。
- [x] 单一 `createPostgresSemanticPublicationAuthority` 增加 prepare/replay 与 approved-attempt 方法；CLI 无 projection payload、
  candidate digest 或第二 publisher 面。
- [x] 新增固定 ChangeSet server builder 与 `prepare:falcon24-successor-review`；该 CLI 首次调用只创建 `WAITING_REVIEW` packet，重放时
  如实返回当前 successor 状态；它不批准、不 stage、不 smoke、不激活。
- [x] Finalizer 删除 `FALCON24_SUCCESSOR_CHANGE_SET_*` / `FALCON24_SUCCESSOR_REVIEW_*` 输入，按固定顺序执行 build → review replay →
  exact human approval → PREPARED attempt → stage/smoke/combined activation。
- [x] 复用既有 `data-agent-postgres`，从已验证模板克隆 scratch DB `data_agent_falcon24_w7_review_10792`；10792 PostgreSQL 17 upgrade、
  rollback fixture、跨 principal replay、hash/CAS/quorum、只读 review evidence、无提前正式发布全部 PASS。专用 E3 数据库未连接。
- [x] 新 checksum 通过第二个短生命周期 scratch DB 的 PG17 upgrade/rollback fixture 后，确认两者均无活动连接且不属于权威历史或
  完成证据，已删除 `data_agent_falcon24_w7_review_10792` 与 `data_agent_falcon24_w7_review_10792b`；保留已验证模板与专用 E3
  数据库原样。
- [x] Replay 在批准与 publish preparation 后分别返回当前 `APPROVED` / `PUBLISHING`，不再固定谎报 `WAITING_REVIEW`；Publication Port
  与 review CLI 接受并保留 successor 可达的 review/publish 状态，Finalizer 因此可从已批准/已准备状态幂等继续，并对 rejected、expired
  或 stale 状态稳定停止。
- [x] 10792 当前 checksum：`sha256:9457e523edfd72d1f227f5109aea204e6ab8ed76a0f10cfd4b6f62a619cee055`。
- [x] Scoped commits：`483243e0`、`9c0aef74`、`c3b30bae`、`5b8a326e`、`b47f10cf`、`b326b837`。
- [x] Final qualification：Contracts 99 files / 951 tests；Platform 111 files / 684 tests；Web 132 passed + 1 skipped files / 548 passed + 1
  skipped tests；三个 typecheck、10792 renderer、全 Supabase static check、Trellis validate 与 PostgreSQL rollback fixture PASS。强制八包
  release build PASS，
  仅保留两个既有 Evals installer 动态 `fs.stat` warning。
- [x] Commit `ae0beb0c` 的 clean build attestation：generation
  `sha256:37695368a6226b3fe78f5f363e329f1043097f6c8386e37299a7f3379083ef94`，Web build
  `sha256:2955282f7313c0069fc37abf0744e4bc253d102ef5a4b29d5c68879ec410ee85`，Worker build
  `sha256:b0426a8f2067a55ca1c7971ade25959fd6764468067c69b866d81b172b314615`，`git_dirty=false`。
- [x] Retained verifier `READY`（historical=3/current=31）；OpenSandbox attestation 为 `production_gate=HOLD`、
  `production_isolation_proven=false`；runtime uniqueness PASS。Docker 仍只有既有四个运行容器，专用 E3 数据库未连接。

**Stop conditions**

- 任一验证失败不进入 W8；修复回到拥有该行为的工作包并创建新的 scoped commit。若修改 frozen E4 closure，重新构建后续 identity。

**Commit**

- 仅在确有 owned test/runbook change 时：`test: qualify semantic E4 atomic activation`。

### W8 — Dedicated E3 database stage and atomic E4 activation

**Preconditions**

- 用户再次明确批准执行数据库变更与 E4 activation。
- W1-W7 commits/build attestations固定；专用容器仍为 `data-agent-falcon24-e1-e81a29c6`，不创建新 DB 容器。
- 当前 worktree 不提供 `DATABASE_URL` 或显式 Falcon scope；授权后必须在一次性 server shell 注入专用 `data_agent` DSN，并从数据库
  capability/deployment 事实只读确认 environment/workspace/principal/datasource。不得复用普通开发库 DSN，也不得把 CLI fallback 当作证据。

**Work**

- [x] 应用并核对 10783-10793 forward migrations 与 E1-E3/gen1 审计摘要。
- [x] 将已通过 exact-clone Oracle 的 10794 应用于专用数据库并再次核对 protected history。
- [x] 通过唯一 publisher stage generation 2；运行 deterministic smoke PASS。
- [x] 构建 E4 proof/receipts/baseline/session，combined transaction原子激活。
- [x] 使用生产端口核对 semantic pointer/runtime/defaults=current gen2，Falcon current=E4，receipt/outbox/stage PROMOTED exact。
- [x] 再次证明 generation 1/E1-E3 bytes未变与 `production_gate=HOLD`。

**2026-08-28 execution evidence**

- 专用 `data_agent` 只读审计确认迁移前 frontier 为 10782、Falcon current=E3、semantic current=generation 1；
  三类 generation-1 runtime projection payload 仍只有历史 `release_set_hash`，E3-Q1 仍为
  `SQL_DATA_PREPARATION / SEMANTIC_RELEASE_PROJECTION_INVALID` HOLD。
- 10783-10792 应用后，E1-E3/gen1/current/defaults 的保护行 count/hash 保持不变；10790 只为既有
  qualification 行增加三个全 NULL diagnostic reference 列，投影排除新列后的 canonical hash 与迁移前 exact match。
- 旧环境缺少 successor review policy closure。前向 Migration 10793 只为 exact
  `E3 + falcon24 + generation 1` scope 插入一个 policy revision、一个 current-owner assignment 与一个 policy pointer；
  checksum=`sha256:f6370a0956fb3e4a96abdc539543324db4bd6d0c558134f55b650048177c2c25`，
  scoped commit=`6a512f6e`。
- 10793 先在专用库 exact clone 验证，再应用于专用库。除 ledger 和三张允许变更表外，379 张用户表的
  ordered canonical count/hash 前后全部一致；E3、generation 1、runtime/defaults exact refs 均未移动。
- clean build attestation 绑定 commit `6a512f6e297e8f4d9606671812ed6ff07f4c61e3`，generation
  `sha256:f2c7a7ed1aa3586916e5c68c1a275ed35dd3a3447966430b2beadacd3bfb71d1`，`git_dirty=false`。
- 正常 governance preparation 已创建 `WAITING_REVIEW` packet
  `801bfa69-2ea6-49d9-9a6a-676b0e3facd6`，packet digest
  `sha256:4593fc62603fc23386d07320bc08f35b7642de6142116bd2bafb0715f79fea84`；frozen ChangeSet
  `159121ff-0a5a-53d2-8734-f46d98f1775b` / `sha256:5dbd303d8ecd34b1e98ae936314d7a90e18b8832594049678c9ed3aec996ee72`
  含 158 assertions、0 conflicts、5/5 competency PASS。用户已对该 exact packet 提交真人 APPROVE：decision
  `d71e9f3f-65fb-4eeb-ba15-49d89a44c202`，decision digest
  `sha256:dc5a40d9defe677d3c9c4d58882242b2058daed8bf72f9a0d2e11c228d3b895e`，decision-set digest
  `sha256:37344c680121fbcda9a4972a4920500efed85156811c131d3196bb355d11a157`；packet 保持 `CLOSED/APPROVED`。
- exact approval 后第一次 Finalizer 只执行一次，以 `SEMANTIC_SUCCESSOR_DEPENDENCY_POINTER_REQUIRED` HOLD。只读核对证明 Falcon
  current=E3、semantic/runtime pointer=gen1/version 2、candidate 仍 `APPROVED`、successor stage=0、E4 baseline/activation/session=0、
  diagnostic=0；没有 partial activation 或被拒绝 stage。
- 根因是旧 greenfield bootstrap 虽已写 immutable generation-1 Release、三类 projection、validation、COMMITTED attempt 与 pointer，
  但早于通用 publisher 的 catalog/dependency fence 合同，缺少 `semantic_catalog_fence` 与
  `semantic_dependency_pointer`。历史 attempt 的 catalog epoch/dependency generation 为 0/0，不能由 Finalizer 猜测或手工补写。
- 前向 Migration 10794 仅为 exact E3/gen1/零 successor-E4 污染 scope，从 immutable bootstrap evidence 重算并 INSERT catalog fence
  与 dependency pointer；checksum=`sha256:052c07b894b5ce6468e2b368122f67d1a9d983fcb99d1e57c16fe92901f85219`，
  scoped commit=`45d1c94e`。期望值为 catalog epoch 0、dependency generation 1、schema digest
  `sha256:12f028d95464af08d4311a56168381d1c99dcb5ecfe8f2f11779e348db5a76e0`、compiler digest
  `sha256:ca65d92516a3e1027487918fdd838c81affd40f687ebaecb16260d02e1c1cd17`、closure policy digest
  `sha256:11fae155322246aaf3e8a3219378063dd21b440bd02311b6a56205a4a825dd7b`。
- 10794 已在同一既有专用 PostgreSQL 容器内、由 exact `data_agent` 克隆出的 scratch database
  `data_agent_falcon24_w8_dependency_10794` 验证：应用前 frontier=10793 且 fence/pointer=0/0；应用与 replay 后 ledger/fence/pointer
  始终=1/1/1，380 张非允许用户表 ordered canonical count/hash drift=0，E3/gen1/review exact 不变，stage/E4/diagnostic=0。
  该 migration 已应用到权威 `data_agent`；380 张非允许用户表 aggregate hash 仍为
  `sha256:63d20c74c0191a446b95c13d6e08a1d3c3ae70f2f48e28a745c7628f745697a0`，E3/gen1 未变。

**W8-R2 evidence and next gate**

- 10794 后唯一一次 Finalizer 创建 successor stage `44eb7b8d-27e4-556a-8833-7e7c293a04cc`，candidate generation 2
  `18472091-59b1-5d86-b399-9605ca627040` / `sha256:9c53ca74db82181ff46a591ee4e2b88d63e5c9b4e6e3fa157f10fa085ca74dd6`，
  validation receipt `sha256:06860d254853aa9a71d7bde24f91f233eeadd8f7e4ee5033d72d71b0fa0bdcb2` 与 smoke receipt
  `sha256:4b51d04e3ceefcbc25a5b1ed97443b5112a16bc9fab02a62bb344094fe487411` 均 PASS。
- Falcon supporting session `00000000-0000-4000-8000-00000000e430` 已写五类 supporting receipts，但 Team materialization 返回
  `BUILTIN_TEAM_SKILL_REVISION_CONFLICT`；无 SEMANTIC_RELEASE receipt、E4 baseline、activation attempt、diagnostic 或 formal gate。
- `297b8ead` 将三个已改变 body 的 Semantic Skill 从目标 revision 2 推进为 3；测试证明既有不同 hash 的 immutable revision 2 会通过
  Registry CAS 追加 revision 3，不会冲突或覆盖历史。
- `2305d9c6` 增加 strict HOLD contract/Port、Finalizer pre-baseline failure closure、显式恢复 CLI 与 migration 10795；checksum
  `sha256:6a367834c337db45823104c28e4ecc2445b3ab73270fb0bbf766a20aad4f6d9d`。
- 聚焦验证：Contracts/Platform/Worker/migration 6 files / 36 tests，Web 3 files / 17 tests；Contracts、Agent Runtime、Platform、Web
  typecheck PASS，10795 renderer verify PASS。专用容器 exact clone 已完成 PostgreSQL 17 apply、HOLD、same-reason replay、different-reason
  conflict 与 owner/grant/ledger postcondition，随后删除；未创建新 Docker container。
- [x] 用户批准 W8-R2 数据库步骤后，将 10795 应用于专用 `data_agent` 并核对 frontier/checksum 与 protected history。
- [x] 通过 `hold:falcon24-authority-staging` 以 exact `e430` / retained hash / 原 failure code 封存旧 session，核对 `HOLD` 且
  current 仍 E3/gen1；禁止直接 DML。
- [x] 在 commit `eedf64cfdcb213ae66669ce4299df8ebe3ff9d17` 上生成 clean Web/Worker build identity，使用新 staging id `e431`
  运行一次 Finalizer；结果为 `FALCON24_SEMANTIC_SUCCESSOR_SMOKE_PROCESS_FAILED`，未重跑。
- [x] 只读审计确认 `e431` 未落库、E4 baseline/activation/diagnostic/formal gate 均为零，current 保持 E3/gen1；进入 W8-R3。

**W8-R3 build-bound smoke recovery**

- [x] scoped implementation commit：`cd09c721`（Web build-bound key、10796、manifest 与聚焦测试）。
- [x] TDD 定义 `buildFalcon24SuccessorSmokeIdempotencyKey`：同 stage/同 Worker build 稳定重放，不同 exact build 产生不同 key。
- [x] 新增 forward migration 10796，只演进唯一 `commit_semantic_successor_smoke(jsonb)`：允许 `SMOKE_PASSED + PASS + new key`
  append receipt；禁止 `SMOKE_PASSED + FAIL`、同 key/不同 command、receipt hash 重用和 terminal new write。
- [x] Migration 事务对全部既有 successor stage/receipt 做 ordered canonical count/hash 前后比较；owner 为
  `data_agent_u6_rpc_owner`，public/anon/authenticated/service_role revoke，仅 backend execute。
- [x] 聚焦验证：Web typecheck；Web 2 files / 11 tests；migration/inventory 2 files / 8 tests；Biome、renderer verify、diff check PASS。
- [x] 既有专用容器的 exact `data_agent` clone 已完成 PostgreSQL 17 apply、new-build PASS append、same-key replay、
  same-key/different-build conflict、`SMOKE_PASSED + FAIL` rollback；旧 receipt/stage timestamp 未变，scratch 已删除，未新建 Docker。
- [x] 将 scoped code/migration 与 spec commits 固定后，在专用 `data_agent` 应用 exact 10796 checksum
  `sha256:4b3541be45d3e117510a497910de45f918b7a12111c338348b7bbd1de8217286`，再次核对 all-old E3/gen1 与历史 bytes。
- [x] 基于 commit `58aa8c4beff99688dda20762db7a6fb839d21003` 生成 clean Web/Worker build identity，只用全新 staging id `e432`
  执行一次 Finalizer；结果为 `FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH`，未重跑。
- [x] 只读审计：新 build smoke receipt append PASS；e432 session/baseline=`STAGED`、attempt=`OPEN`；Falcon current E3、semantic/runtime gen1、
  promotion/diagnostic/formal gates=0。唯一失败 fence 为 source revision digest 被错误同 schema snapshot digest 比较。

**W8-R4 review-only recovery package**

- [x] 用户明确批准 W8-R4 后，TDD 演进 Finalizer post-baseline failure closure，并新增 confirmation-gated activation HOLD recovery CLI。
- [x] 新增 forward migration 10797：source revision digest 对 `stage.change_set_hash`；candidate revision source/digest/head closure exact；其余 combined
  activation fence、锁序、atomic writes不变。
- [x] 聚焦 Contract/Platform/Web/migration/PG17 populated-clone、failure injection/concurrency/security 验证；implementation scoped commit=`04d5db4e`。
- [ ] 先通过既有 `holdActivationAttempt` authority 将 exact e432 attempt/baseline/session 终结 HOLD；禁止直接 DML。
- [ ] 应用 10797、生成新 clean build，仅用 `e433` 运行一次 Finalizer。ACTIVE 才进入 production readback/W9；HOLD 则再次停止审计。

**W8-R4 implementation evidence**

- 10797 checksum=`sha256:c5afa3d4b8babc91b61b2bd3d6f3edc18324502254270d08e8d63049dc18e984`；前置 exact 10796 checksum，
  migration 对 14 类 authority/source/review 表做 ordered canonical snapshot，保持既有锁序、单事务 atomic writes、owner 与 narrow ACL。
- Finalizer unit 覆盖 promote failure exact HOLD once + original error rethrow、HOLD dual-failure stable error、success/receipt/readback 不误 HOLD；
  activation recovery CLI 覆盖 confirmation 与 Port-only 边界。
- PostgreSQL 17 scratch：apply 前后 all-old；first HOLD、same-reason replay、different-reason conflict；invalid CAS rollback；两个 concurrent valid
  activation 返回同一 receipt，最终 E4/gen2/runtime/defaults/stage 全部 all-new。三个 scratch database 均已删除，未创建新 Docker container。
- 全量证据：Web 135 files / 556 passed + 1 skipped；Platform 111 files / 685；Contracts 99 files / 951；三层 typecheck PASS。
  第一次 Contracts 与 Web/Platform 并行时 15 个 15s fixture timeout；无并发负载下失败 5 files 134/134、随后 Contracts full 951/951，判定为资源争用。
- 聚焦证据：Web 2 files / 12；migration/static 4 files / 18；10797 renderer、全部 migration renderer、workspace migration inventory、Biome、
  `git diff --check` PASS。旧 `61` fixture 在 live-shaped clone 因缺少 fresh-harness deployment mapping 于业务断言前触发 `DA_SCOPE_FORBIDDEN`；
  事务回滚，另用同一 production Port 的 live-shaped rollback/concurrency/activation 测试覆盖本迁移行为，不把 fixture 环境缺口冒充通过。
- 文档提交前权威库未变化：frontier 10796、Falcon E3、semantic/runtime/defaults generation 1、stage `SMOKE_PASSED`、e432 attempt `OPEN`；
  audit stash `audit/rejected-generation1-repair-2026-08-28` 保持不变。

**Stop conditions**

- Stage/validation/smoke失败：保持 gen1/E3，stage按状态机REJECTED或STAGED，停止。
- Activation失败：必须完整gen1/E3；若出现partial，严重事故并停止。
- Activation成功后任何frozen change都进入E5。

**Commit**

- 无运行数据库内容提交；只在有批准的证据索引/runbook更新时 scoped commit。

### W9 — Historical E4 diagnostic plan（由 E5-W5 替代）

**Preconditions**

- Exact E4/gen2/readback PASS；Web/Worker exact frozen builds运行；residual preflight=0。

**Work**

- [ ] 创建且只创建一个 active diagnostic attempt。
- [ ] 真实浏览器提交固定问题，等待终态答案，从答案入口进入 exact Run Trace。
- [ ] 验证 Semantic/Text2SQL/SQL/QueryEvidence/Arrow/Python/AnalysisReport/Chart、Artifact可用、QA/Trace同源、residual=0。
- [ ] Finalize immutable diagnostic PASS receipt；不计分。

**Stop conditions**

- 首次失败立即停止。需要 frozen change -> E5；仅外部依赖且 closure未变 -> 报告并等待批准新的 diagnostic attempt。

**Commit**

- 只提交批准的安全证据索引，不提交截图、raw rows、provider payload或秘密。

### W10 — Historical E4-Q1 and E4-C1 plan（由 E5-W6 替代）

**Preconditions**

- Exact PASSED diagnostic receipt 与同一 E4 baseline/build/gen2 Release。

**E4-Q1**

- [ ] 创建单一 immutable E4-Q1 attempt/manifest。
- [ ] 严格串行 G1=1、G2=5、G3=5、G4=5，共16/16；首败 HOLD并停止。
- [ ] 每 slot 真实浏览器 submit ->终态答案->答案入口->exact Trace交互；全链、Artifact、同源 receipts、residual=0。

**E4-C1**

- [ ] 仅在 winning Q1 certificate后创建单一 E4-C1。
- [ ] 严格串行5题×COLD/WARM×3=30；不复用Q1 Run；首败HOLD并停止。
- [ ] Finalize winning campaign与local functional evidence。

**Completion audit**

- [ ] generation 1/E1-E3未变；gen2/E4 identities；diagnostic；16/16；30/30；exact Trace UI；residual=0。
- [ ] 明确 `production_isolation_proven=false` / `production_gate=HOLD`，不声称生产GO。
- [ ] Trellis check/spec update/final scoped commit/finish-work；任何缺证据项不得勾选完成。

## 3. Package Dependency Order

```text
W0 approval
  -> W1 contracts/shared validator
  -> W2 10783 storage/RPC
  -> W3 publisher staging authority
  -> W4 deterministic smoke
  -> W5 proof/finalizer/combined adapter
  -> W6 diagnostic authority
  -> W7 full qualification
  -> W7-R fixed ChangeSet + human review readiness
  -> explicit DB/activation approval
  -> W8 stage + atomic E4 activation
  -> W9 single diagnostic
  -> W10 E4-Q1 then E4-C1
```

任何上游包发生行为变更，下游 build/proof/attestation 必须重建；E4 激活后则不重建 E4，直接进入 E5。

## 4. Global Risk Gates

- **G-A History mutation：** generation 1/E1-E3 任一 byte/hash/count 变化，立即停止。
- **G-B Dual authority：** 出现 repair writer、client projection payload、第二 publisher/current pointer，退回设计。
- **G-C Split activation：** 任意并发/失败注入可观察 mixed gen1/E4 或 gen2/E3，拒绝发布。
- **G-D Validator drift：** stage/smoke/read port 使用不同 closure逻辑，拒绝发布。
- **G-E Gate pollution：** diagnostic计分、slot retry/resume、API-only UI、跨 attempt拼接，attempt HOLD。
- **G-F Isolation overclaim：** local functional PASS 被标为 production GO，最终验收失败。

## 5. Approval Boundary

W1-W7 已按工作包边界实施并提交，被拒绝的 dirty repair 实现继续只保留在审计 stash。用户已明确批准专用 E3 数据库 migration、
exact review packet 与 E4 activation；该授权允许应用已审查的 10794 和一次修正后的 Finalizer，但不允许手工 SQL、连续重跑或放宽
stop condition。W8 成功前不创建 E4 diagnostic/Q1/C1；成功后 W9/W10 仍服从单次诊断、首败 HOLD、无 retry/resume 与真实 Trace UI
证据边界。

## 6. E5 Unattended Forward Plan

用户在 E4 build closure 缺陷被完整证明后明确指示“进去 E5，进去无人值班”。这构成对 PRD 第 12 节和 Design 第 17 节所述前向边界的
实施批准；没有未决产品/风险选择。每个包必须 focused validation + scoped commit，且下一包只消费已提交的前一包。

### E5-W0 — Freeze E4 and amend Trellis artifacts

- [x] 只读核对 frontier=10797、current=E4、semantic gen2、E4 diagnostic/qualification/campaign=0。
- [x] 记录 Turbo `outputs`/`excludedOutputs` 证据与不可恢复的 E4 cache 结论。
- [x] PRD/design/implement 明确 E5 retained-semantic rollover、10798、E5-D1/Q1/C1、锁序、崩溃窗口、文件与测试边界。
- [x] `git diff --check`、Trellis validate 后 scoped commit：`docs(falcon24): plan E5 build authority rollover`。

### E5-W1 — Workspace build attestation v2

- [x] 先加 failing characterization：dry-run 含 `excludedOutputs` 时 parser 当前丢失；cache byte mutation 当前改变 digest。
- [x] `TurboBuildTaskIdentity` 增加 `excluded_outputs`；严格规范 glob、排序/去重、include/exclude 分域；task signature/output walker 共用。
- [x] attestation v2 写入新字段和新 hash；v1 reader 保持历史只读兼容，writer 只能创建 v2。
- [x] 覆盖 malformed/越界/symlink、cache mutation stable、non-cache mutation mismatch、build 前后 exclude drift。
- [x] `pnpm vitest run tests/workspace-build-integrity.spec.ts`、相关 scripts typecheck/Biome/diff check。
- [x] scoped commit：`fix(build): preserve excluded Turbo outputs`。

### E5-W2 — Contracts and 10798 retained activation

- [x] Contract：retained semantic proof@1、activation request@3、diagnostic@2、qualification manifest@4；所有 epoch/gate ID 由 canonical epoch 派生。
- [x] Platform：authority Port 的 v3 method；E4 combined successor path保持不变；diagnostic/qualification adapters 使用 manifest epoch。
- [x] 10798 演进既有 `activate_falcon24_authority(jsonb)`：v2 历史兼容、v3 exact E4->E5/gen2 retained closure、固定锁序、零污染、all-old/all-new。
- [x] 10798 同时演进 diagnostic/Q1 DB authority，使 PASSED diagnostic prerequisite 对 E5-Q1 生效，不回写 E4。
- [x] fresh PostgreSQL 17、exact E4 populated clone、migration replay/rollback、RLS/grants、stale refs、failure injection、两并发调用。
- [x] Contracts/Platform focused + full tests、typecheck、renderer/inventory/static migration checks。
- [x] scoped commit：`feat(falcon24): add retained semantic E5 activation`。

**Evidence（2026-08-29）**

- 10798 rendered checksum 为 `sha256:18b91331ab0c3820aa016aa985e125ed7b4140820050bb1ac7efc6fb563f346a`；
  `render-migration.ts 10798 --verify` 与 `--all --verify` 均 PASS。
- exact E4/gen2 authority clone `data_agent_e5_w2_scratch` 上，10798 install、history snapshot/postcondition、stale version all-old、
  E5 activation/replay、diagnostic v2 PASS/FAIL storage、qualification v4 prerequisite 与 semantic/defaults canonical byte equality全部 PASS；
  默认夹具最终 `ROLLBACK` 后仍为 `E4|E5 rows=0`。
- 单独的 scratch-only E6 overlap probe 让第一个事务在 activation 后继续持锁，第二个事务并发进入同一 v3 RPC；两者返回相同
  `E6 / baseline e602 / attempt e603` binding，最终只有一个 `ACTIVATED` attempt。semantic release仍为 exact gen2，pointer/runtime
  generations仍为 `3/3`，workspace defaults revision仍为 `4`。无 authority context 的 Backend调用稳定拒绝为
  `DA_CONTEXT_FORBIDDEN`。
- PostgreSQL 17 空库链按仓库真实顺序安装到 10798，10798 checksum postcondition返回 true；随后全量 smoke 在与本包无依赖、
  本包未修改的旧 `32-provider-invocation-authority-assertions.sql` 失败为
  `PROVIDER_INVOCATION_CROSS_RECORD_CLOSURE_ASSERTION_FAILED`。该后置失败未重跑、未计作全量通过，也不否定已完成的 fresh install证据。
- Contracts 99 files / 956 tests、Platform 112 files / 694 tests与 7 个聚焦文件 / 49 tests均 PASS；两包 typecheck PASS；
  owned TypeScript Biome与迁移静态合同 6 tests PASS。瞬态 fresh container与 scratch database均已删除；专用 authority database仍为
  migration 10797/current E4。

### E5-W3 — E5 Finalizer and gate controls

- [x] 将 supporting-context loader 泛化为 exact current generation >=2，不改变 E4 predecessor loader 的历史行为。
- [x] E5 Finalizer 只从 production read ports读取 gen2/projection/defaults，服务器构造 retained proof，阶段化六类 receipt/baseline/attempt。
- [x] Finalizer 调用 activation request@3；失败立即 exact HOLD，成功后 production readback证明 E5/gen2且 semantic/default bytes/version不变。
- [x] Diagnostic、qualification、acceptance、Worker reclamation CLI 全部从 manifest/current 推导 E5；仅历史 E4 contract builder保留显式 E4分支；动态 Tool Loop 不变。
- [x] Web/Worker focused + full tests、typecheck、no client payload/digest/static boundary scans。
- [x] scoped commit：`feat(falcon24): finalize E5 retained authority`。

**Evidence（2026-08-29）**

- `finalizeFalcon24RetainedAuthority` 从 production closure + exact promoted release reader加载 E4/gen2，复用 shared envelope/runtime
  validator，服务器构造 retained proof@1和 activation request@3；CLI 的 E5 分支在任何 ChangeSet/review/compiler/publisher调用前返回，
  不暴露 projection payload/digest 参数，也不写 semantic pointer/runtime/defaults。
- retained staging 为 E5 阶段化五类 supporting receipt、server proof绑定的 semantic receipt、baseline和唯一 OPEN attempt；E4历史
  successor staging仍走原 wrapper。激活失败只 HOLD exact E5 attempt；成功 readback要求 current=E5 且 gen2 release、三项 version和
  promoted envelope bytes全部与激活前一致。
- Diagnostic attempt/receipt对 E4继续使用历史 v1，对 E5+使用 v2；run/conversation/browser/screenshot身份从 epoch派生。
  Qualification 对 E4使用 manifest v3、E5+使用 v4并绑定同 epoch PASSED diagnostic；browser trace gate接受 E4+ diagnostic；
  Worker reclamation从 attempt epoch派生 `${epoch}-Q1`。Agent acceptance本来已从 gate/campaign manifest派生，无 E4专用路由。
- Web全量单测 `135 passed / 1 skipped files，565 passed / 1 skipped tests`；新增/相关 6 文件聚焦 `44 tests`和 retained
  staging/finalizer复核 `14 tests`均 PASS。Worker sandbox reclamation `10 tests`、Web/Worker typecheck、owned Biome、
  `git diff --check`全部 PASS。

### E5-W4 — Clean build, migration and one atomic activation

Preconditions：前三包已提交、worktree clean、专用容器仍唯一、E4/gen2 exact、E5 污染=0。

- [x] 在 exact committed HEAD 强制构建 Web/Worker，生成 attestation v2 与 identities，`git_dirty=false`。
- [x] 删除/重建/写入 `.next/cache/**` 后 guard仍 PASS；修改一个非 cache output 的副本时 guard稳定 FAIL，随后恢复副本并重新验证原 identity。
- [x] 在 exact E4 clone 应用 10798 并运行 populated fixture；scratch DB 删除。
- [x] 权威库应用 10798，核对 migration checksum 与 E1-E4/gen1/gen2/default canonical bytes无变化。
- [x] 使用全新 deterministic E5 staging identity运行 Finalizer且只运行一次。
- [x] ACTIVE 后核对 current=E5、semantic pointer/runtime/defaults exact gen2未变、E4 frozen facts未变、E5 diagnostic/gates=0。
- [x] 若任一步失败：写入既定 HOLD（适用时）并停止，不重新运行 Finalizer；本次所有步骤首次通过，未触发该分支。
- [x] 只提交安全 evidence index/runbook，不提交 attestation 临时文件、log、secret 或 raw DB data。

**Evidence（2026-08-29）**

- exact commit `4044eec436ee2cfca084a82886b6853228ae7bd5` 强制构建 8/8 packages PASS；attestation
  `workspace-build-attestation@2.0.0`，generation `sha256:d27602e7e2c49044749dcb2e3a57626fcf25b2e317552a5ef48496163ae455b2`，
  Web build `sha256:cf1c1513d41f08fea3b85ecfeb663d02e642a2ff4fcc14276f181b0bcadce8bf`，Worker build
  `sha256:5bc93b50c9b707c95d036a8c35add67047a60dbfb0140a2f7d9a3bafb30c798c`，`git_dirty=false`。
  `.next/cache` probe 后 guard PASS；非 cache `BUILD_ID` probe稳定返回 `DEV_WORKSPACE_BUILD_OUTPUT_MISMATCH`，恢复字节后再次 PASS。
- 同一专用 PostgreSQL 17 容器内从 exact E4 权威库克隆 `data_agent_e5_w4_scratch`；10798安装、populated fixture的 stale
  all-old、activation/replay/conflict、diagnostic v2、qualification v4、semantic/defaults byte equality全部 PASS，默认 rollback 后 E4且
  E5 rows=0；scratch已删除。
- 权威库单次应用 10798，ledger checksum
  `sha256:18b91331ab0c3820aa016aa985e125ed7b4140820050bb1ac7efc6fb563f346a`。迁移前后 gen1、gen2、semantic pointer、
  runtime activation、workspace defaults、E1-E4 baseline canonical hashes逐项相同；迁移后 E5 baseline/diagnostic/Q1/C1仍为0。
- deterministic staging id `58adb8bc-62c9-5b9f-ba29-68a93e14e9cb` 的 Finalizer只调用一次并返回 ACTIVE：E5 baseline
  `f0ae49cd-fdcb-5ac8-99e1-26865405271b` / `sha256:f3274aa55998f10fd5196449a5b78ec6a7497a05d5bdd3cf7c76a7bc0d080948`，
  activation attempt `b74512a0-784d-5c06-92e9-06eba0247f2f`，retained proof
  `sha256:f2387e1c3b0bb941802a01c115a0d41b3d5a192fbc4187147beca2c8b83f1be1`。
- post-readback current=E5；release仍为 gen2 `18472091-59b1-5d86-b399-9605ca627040` /
  `sha256:9c53ca74db82181ff46a591ee4e2b88d63e5c9b4e6e3fa157f10fa085ca74dd6`；pointer/runtime/defaults versions仍为
  `3/3/4`且 canonical hashes与迁移/激活前相同。gen1/gen2、四类 gen2 projection与 E1-E4 baseline保持不变；E5 diagnostic、
  qualification、campaign均为0；production isolation仍为真实 `false/HOLD`。长期 Docker仍只有既有四个容器。

### E5-W5 — One non-scoring E5 diagnostic

- [ ] 轮换专用账号 credential；只在进程环境/安全临时文件使用，绝不输出或提交 secret。
- [ ] 启动 exact E5 Web/Worker；按需启动瞬态 OpenSandbox，记录 container identity，结束即清理。
- [ ] residual preflight=0 后创建且只创建一个 E5 diagnostic attempt。
- [ ] 从真实 authenticated composer 提交固定问题；等待终态答案；从答案入口打开 exact Run Trace UI。
- [ ] 证明 Semantic -> Text2SQL -> SQL -> QueryEvidence -> typed Arrow -> Python operator -> AnalysisReport -> Chart；打开五类 Artifact；residual=0。
- [ ] 完成 immutable PASS receipt，验证不计分；首次失败写 FAIL/HOLD，立即停止且不重试。

### E5-W6 — E5-Q1 then E5-C1

- [ ] 用 exact E5 diagnostic receipt 创建唯一 E5-Q1；严格串行 G1=1、G2=5、G3=5、G4=5，共 16/16。
- [ ] 每 slot composer -> answer -> exact Trace UI；同源 receipts、完整链、Artifact、residual=0；首败 HOLD并停止。
- [ ] 仅在 winning E5-Q1 certificate 后创建唯一 E5-C1；5 题 x COLD/WARM x 3，共 30/30，不复用 Q1 Run。
- [ ] C1 每 slot 同样真实 UI 证据；首败 HOLD并停止。

### E5-W7 — Final audit and cleanup

- [ ] 对 generation 1、E1-E3、gen2/E4、E5 做 canonical count/hash/identity 审计；受保护历史零变化。
- [ ] 核对唯一 diagnostic PASS、E5-Q1 16/16、E5-C1 30/30、exact Trace UI、residual=0。
- [ ] 核对 `production_isolation_proven=false` / `production_gate=HOLD`，禁止描述为 production GO。
- [ ] 停止本任务启动的服务；删除全部瞬态 sandbox/container/scratch DB/credential temp；保留四个既有长期容器。
- [ ] `trellis-check`、spec update、Trellis validate、最终 scoped docs commit；task policy允许时 archive。

### E5 stop conditions

- Formal diagnostic/Q1/C1 第一次失败：数据库写 immutable FAIL/HOLD 后立即停止，不 retry/resume。
- 任何 mixed E4/E5 或 semantic/defaults drift：严重事故，停止；不得补偿 DML。
- 任何受保护历史修改、生产/外部发布、长期基础设施或不可恢复广泛删除：停止并汇报。
- 其余计划内本地失败在 owning package 修复、重新验证并形成新 commit；尚未激活 E5 时可生成新的 candidate build identity。

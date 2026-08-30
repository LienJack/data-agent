# Falcon24 Semantic Generation 2、E4 原子恢复与 E5 前向构建权威 — Implementation Plan

> 最新执行入口（2026-08-29）：从本文第 25 节 F0-F7 开始。前文步骤保留为历史进度；与第 25 节冲突的未完成项不再执行。

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

## 7. E6 forward execution and terminal HOLD

### E6-W0 — Forward authority implementation

- [x] E5 build bytes不可恢复后，保留 E5 immutable history并按设计前进 E6；没有重签 E5、回退 E4 或制造 semantic generation 3。
- [x] Finalizer/retained authority 从 hard-coded E5 泛化为 canonical E5+、exact predecessor ordinal；focused 26 tests、Web typecheck、
  Web full 568 tests与 owned Biome/diff check PASS。
- [x] scoped commit：`86ce7f1d fix(falcon24): advance retained build authority`。
- [x] exact commit clean build attestation：generation
  `sha256:908dfc900ceca88454ac9179b9fea1718154456da509bf861c708e020ce01cd3`，Web build
  `sha256:831f0b611d64b450d845824fd7150c4ee5613cbb0439f26d0fd482e9c24aadcf`，Worker build
  `sha256:5bc93b50c9b707c95d036a8c35add67047a60dbfb0140a2f7d9a3bafb30c798c`；两侧 guard PASS。
- [x] Finalizer只执行一次并激活 E6：baseline `a3a275b5-7584-57e3-afcf-37cd229de675` /
  `sha256:d40f1b97d753e0de2dd9158fe744221cfef093c954735a3784e94f54aa98186a`，activation attempt
  `9f730577-c230-5e98-ab31-448b8183fc36`，retained proof
  `sha256:ab7f5433dbf04db00ee389f363a34dee028ed7ad3fed640b1a442900a78b1ad1`。
- [x] post-readback current=E6；semantic release仍为 gen2 `18472091-59b1-5d86-b399-9605ca627040` /
  `sha256:9c53ca74db82181ff46a591ee4e2b88d63e5c9b4e6e3fa157f10fa085ca74dd6`，pointer/runtime/defaults versions仍为
  `3/3/4`；E6 diagnostic/Q1/C1 pre-count=0。

### E6-W1 — One diagnostic and mandatory stop

- [x] 专用账号 credential轮换；exact E6 Web/Worker和瞬态 OpenSandbox启动；提交前 residual=0。
- [x] 只创建一个 attempt `133460e8-0d5e-5ae5-ba20-1709f08b1796`，manifest
  `sha256:1fc8cf6e26330b497484114376772f0c63adf7cbe9ac9512493b3a89d1ae2118`；真实 authenticated composer只提交一次，
  exact Run=`f0e98c36-18dd-8f12-bd9b-df7c05212f37`。
- [x] Run 首次 Root model preflight 在 sequence 4 失败：`PROVIDER_PROFILE_NOT_AVAILABLE`，sequence 5 terminal FAILED，
  `retryable=false`；未调用 Provider，未产生下游业务链。
- [x] 失败按 frozen `AGENT_PROFILES` closure分类为 `FROZEN_CLOSURE_CHANGE_REQUIRED`；没有重试/新 attempt，也未开始 E6-Q1/C1。
- [ ] immutable FAIL receipt：唯一 CLI fail 调用被 `FALCON24_DIAGNOSTIC_SEMANTIC_RELEASE_MISMATCH` 拒绝。根因是 Platform
  diagnostic `complete` 漏传 `semantic_domain`，forced RLS 下 runtime pointer不可见；attempt仍 ACTIVE、receipt count=0。按不可变性边界不以
  SQL、第二权威或未绑定 build 绕过。
- [x] cleanup：Web/Worker/OpenSandbox server停止；sandbox residual=0；轮换 auth profile与精确临时目录已删除；scratch DB=0；
  Docker只保留 `data-agent-falcon24-e1-e81a29c6`、`data-agent-postgres`、`data-agent-clamav`、`data-agent-neo4j`。
- [x] 审计 stash `audit/rejected-generation1-repair-2026-08-28` 未恢复、未执行、未改写。

### Terminal decision

正式诊断第一次失败已触发 hard stop。E6-Q1/E6-C1保持 0；`production_isolation_proven=false`、production gate=`HOLD`。由于终态
receipt persistence 本身需要新的 frozen-closure 修复，本任务不满足完成判定，不能继续门禁或声称完成。

## 8. E7 unattended forward execution

用户已在上述 terminal audit 后明确“授权”，批准按 PRD §14 / Design §19 前进；E6 首败和既有历史仍不可改写。

### E7-W0 — Plan and evidence freeze

- [x] 核对 current E6/gen2、唯一 E6 Run FAILED、diagnostic ACTIVE/receipt=0、E6-Q1/C1=0、frontier=10798、worktree clean。
- [x] 证明 Platform complete 漏传 semantic domain；证明 exact model profile/config/authentication存在但 ModelCertificationReceipt=0。
- [x] 更新 PRD/design/implement/runbook，校验 schema/RPC/锁序/状态机/恢复/文件/测试一致；本包验证后 scoped commit。

### E7-W1 — Diagnostic and activation authority v4

- [x] 先写 adapter failing regression，再让 `complete` 与 `begin` 使用相同 semantic domain transaction context；commit
  `906379ac` 固定 forced-RLS 回归与相同 domain binding。
- [x] Contracts 增加 activation request@4/result@4，固定 E6 failure binding与 server-owned nested completion hash；commit
  `722e5b58`。
- [x] 10799 演进唯一 activation RPC；同事务调用唯一 diagnostic completion并切换 E7；commit `0451d28f` / `048ae13a`，
  最终 checksum=`sha256:c01e24c352b0f040e64dff536e587af81f00be45090c11a20f4094691ba8d1d2`。
- [x] focused/full tests、typecheck、renderer/inventory/static checks与 scoped commits完成；真实 PostgreSQL 17 又发现并前向修复
  artifact revision歧义、staged certification promotion immutability guard和 activation-attempt歧义（`182d711a`、`386d6946`、
  `02112995`），没有修改既有迁移或历史数据。

### E7-W2 — Provider execution certification staging

- [x] 增加 inactive certification candidate table、RLS/grants、stage/load/reject/promote narrow authority；不新增 runtime profile writer。
- [x] 演进 ModelCertificationReceipt store 支持 E7 staged commit，继续要求 live-smoke draft与 ACTIVE Run/fence。
- [x] execution-profile reader只暴露 current E7 PROMOTED exact binding；E6/staged/rejected candidate均不可见。
- [x] E7 LLM proof绑定 certification/deployment/execution-profile/build；Finalizer不再要求 E7 evidence等于 E6 predecessor。
- [x] Worker preparation CLI只用既有 Run/Queue/Event/Artifact authority；credential缺失零写入、输出永不含 secret。
- [x] commits `347ca1fa`、`968ddd06`、`d47ad76b` 完成 focused/full tests；W3 no-network probe只证明 staging合同和
  inactive/E6-invisible行为，不冒充 W4 真实 Provider certification。

### E7-W3 — 10799 proof and code validation

- [x] PostgreSQL 17 fresh install与 exact E6 physical clone验证完成；final-code all-new一次得到 exact E7，transaction中段故障注入
  只观察 all-old，双连接 Finalizer序列化为同一个 exact E7 binding；migration replay/rollback、protected history bytes、RLS/grants/
  capability和 immutable trigger narrow exception均已核对。
- [x] Contracts/Platform/Worker/Web focused/full tests、typecheck、Biome、public-data/secret scans、renderer/inventory/static checks和
  `git diff --check`通过；最终 HEAD 的 PostgreSQL 17 integration为 Platform 13 passed/1 skipped、Web 1 passed、Worker 11 passed/1 skipped。
- [x] owned source/rendered/registry/support均已 scoped commit；专用权威库仍停在 E6且 10799 count=0；scratch databases、physical
  backup目录及 `data-agent-falcon24-e7-w3-*` 容器已删除，Docker只保留既有四个长期容器。

### E7-W4 — Certification, migration and one activation

- [x] exact commit `bddfbc7c` clean build/attestation：generation `sha256:2b8c3226abd4bca4f55459d0cae37f9f750845647f89d87f53c4ee2c6e3030a0`，
  Web `sha256:faa0fe3dac628fdd3ac26939010e535dcd94de006ed4b07accdb8686fd5964d9`，Worker
  `sha256:c27a7fd297b8aa5f37e97cd2ddc73d090b6f5433ff9b482bcf1ac24115c19781`；双guard PASS。
- [x] 权威库应用10799 checksum `sha256:c01e24c352b0f040e64dff536e587af81f00be45090c11a20f4094691ba8d1d2`；22表
  pre/post canonical snapshot byte-identical，迁移后仍current E6、stage/E7 rows=0。
- [x] 受控映射本地 `DeepSeekAPIKey` 为进程内 `DEEPSEEK_API_KEY`；真实preparation Run
  `4aaeaaf9-024e-5969-8a63-b4df4fdf95d8` PASS，stage `254d67ff-14e8-501e-ae68-4b6b5dc587b2` inactive且E6 reader不可见。
- [x] staging `e7f809ae-3181-5089-9459-27e3bfd8d408` 的Finalizer/request@4只调用一次并ACTIVE：baseline
  `b56b8ce2-fc16-572f-a821-30b7d506b90c` / `sha256:fa2170a98f446b63757f2db514a8847ef7d03cdea70b06c379b21dbdb5d37839`，
  activation `1f3f080c-d1f7-5ad2-a839-37fc5e94cab7`；E6 diagnostic receipt=1，semantic/defaults gen2不变，E7 gates=0。
- [ ] post-readback FAILED：target profile仍 `STALE/selectable=false`。原始profile与stage七字段全相等；10799 public reader误用未赋值
  PL/pgSQL record `stage.activation_attempt_id` 而非表别名 `row.activation_attempt_id`，故永远不选中stage。E7 frozen，diagnostic仍0；前进E8。

### E7-W5 — One non-scoring diagnostic

- [ ] 轮换应用账号；启动 exact E7 Web/Worker和瞬态 OpenSandbox；提交前 residual=0。
- [ ] 只创建一个 E7 diagnostic；真实 composer只提交固定问题一次，从答案入口打开 exact Run Trace UI。
- [ ] 核对完整动态 Tool Loop、五类 Artifact、chart和 residual=0；写 immutable PASS。首败写 FAIL/HOLD并立即停止。

### E7-W6 — Formal gates

- [ ] exact E7 diagnostic PASS 后创建唯一 E7-Q1，严格串行完成 G1=1/G2=5/G3=5/G4=5。
- [ ] winning Q1 后才创建 E7-C1，5题 x cold/warm x3；每 slot同源 UI evidence/residual=0。
- [ ] 任一阶段首败 HOLD并停止，不 retry/resume/跨 attempt拼接。

### E7-W7 — Audit and cleanup

- [ ] canonical audit E1-E7、gen1/gen2、E6 failure receipt、E7 certification/diagnostic/Q1/C1、Trace UI与 residual。
- [ ] 保留真实 production isolation false/HOLD；停止服务并删除 credential temp、sandbox/container/scratch DB。
- [ ] trellis-check、spec/runbook/evidence更新、最终 scoped commit；满足全部 AC 后才完成 goal。

## 9. E8 unattended forward execution

### E8-W0 — Freeze E7 post-readback failure

- [x] 只读核对current E7、E6 immutable receipt=1、E7 stage PROMOTED/artifact active、semantic/defaults exact gen2、E7 diagnostic/Q1/C1=0。
- [x] 定位 public reader alias defect并更新PRD/design/implement/runbook；不修改10799、不原地修E7。
- [x] scoped plan commit `e1b987dc`。

### E8-W1 — Failure receipt and activation v5

- [x] Contracts新增closure-failure receipt、request/result@5；Platform ports只走唯一authority（`b6865884`、`43566cfd`）。
- [x] 10800新增append-only receipt与record/load RPC；public reader按epoch dispatch，E7输出不变、E8使用修正alias。
- [x] 10800演进唯一activation RPC，原子推广fresh E8 certification并激活E8；v2-v4历史兼容。W3发现
  `FOR SHARE` 需要RPC owner的UPDATE privilege，已由immutable trigger + migration postcondition约束并在`0810eb91`修复。

### E8-W2 — Finalizer and proof

- [x] Finalizer target E8加载server-verified E7 failure与fresh E8 stage，构造v5；E7 recovery path保持只读历史（`ba9c7f1e`）。
- [x] post-commit生产reader必须 exact AVAILABLE，否则严重故障且不得formal diagnostic；窄 record CLI只提交stage业务引用（`a3e9378d`）。

### E8-W3 — PostgreSQL and code proof

- [x] PG17 fresh/exact E7、E7 reader equality、receipt负例、all-old/all-new、replay、RLS/security、双连接并发。
- [x] full/focused tests、typecheck、Biome、renderer/inventory/diff checks；scoped commits与scratch cleanup。

**E8 W1-W3 evidence（2026-08-29）**

- 10800 rendered checksum=`sha256:f388b153ccc9264b5f68fb4b7d718860331370ce144625ffd2bb24c61f66e307`；专用权威库仍停在10799/E7。
- exact E7停机物理卷克隆的Falcon catalog inventory/content digest分别保持
  `sha256:85dc4e7f64a0b0944ac653b95d446c253b44995e0e2574b3d393f3fb3d2cde87` /
  `sha256:7728f3d652812ef0a7e69fcd59abbcbd859892af839ee13f82a005b35c7251fb`；逻辑dump因CTID顺序变化不作为exact fixture。
- W3 real certification绑定clean generation `sha256:4508684743e7f169ea9bdab79f4b70d5e018b1c44c487e685d4f7050d9352411`；一次request@5
  激活临时E8 baseline `12436bcc-e8f8-53a0-b4c7-d389b3baa186`，post-reader exact target profile AVAILABLE/selectable=true。
- post-readback semantic pointer/runtime仍为release `18472091-59b1-5d86-b399-9605ca627040` generation 2，defaults revision=4，E8
  diagnostic/Q1/C1=0，production isolation仍HOLD。
- 首次非正式activation因RPC owner缺failure-receipt row-lock权限回滚为完整E7，并把该临时staging/baseline置HOLD；修复后使用新
  staging/stage id成功，未改写HOLD证据。所有transient container/volume、scratch DB已删除，长期Docker恢复4个。
- 最终双连接用同一clean build/staging/stage并发运行两个Finalizer，二者均幂等返回同一E8 baseline
  `a0a550d4-6687-59d6-82e3-2a42852c8f3a`与activation `809226c5-871f-53cb-ac6f-19b383e7efe1`；数据库只有
  1 session / 6 receipts / 1 ACTIVE baseline / 1 ACTIVATED attempt / 1 PROMOTED stage / 1 active certification artifact，E8 gates=0。

### E8-W4 — Dedicated migration and activation

- [ ] clean committed build；权威库应用10800且protected history不变；server record E7 immutable closure failure。
- [ ] 一次真实E8 certification，E7 reader仍STALE；一次Finalizer/request@5原子激活E8。
- [ ] readback E8/exact AVAILABLE/gen2 unchanged/E8 gates=0；之后才进入唯一formal diagnostic。

### E8-W5-W7 — Formal execution and audit

- [ ] 唯一E8 diagnostic PASS并通过答案入口Trace UI、五类Artifact与residual=0。
- [ ] E8-Q1 16/16后E8-C1 30/30；任一首败immutable HOLD并停止。
- [ ] canonical final audit、production false/HOLD、服务/credential/sandbox/scratch清理、Trellis验证和最终scoped commit。

## 21. E9 execution packages

### E9-W0 — Freeze E8 and prove the resolver mismatch

- [x] 保存 exact E8 diagnostic FAIL receipt；确认 Q1/C1=0，禁止 retry/resume 同 Run。
- [x] 在 exact backend capability 下证明 public profile=`AVAILABLE/selectable=true`。
- [x] 证明 certification Run/Artifact 均为 E7，而 generic current Artifact resolver 要求 E8，因此 production
  `resolveAvailableProfile` 返回 null；排除 credential/provider dispatch 与 semantic projection 问题。
- [x] 更新 PRD/design/implement，明确 dedicated current-profile authority、v6 atomic activation、崩溃恢复和测试矩阵。

### E9-W1 — Contracts and dedicated resolver

- [x] 增加 request/result@6 与 predecessor terminal diagnostic receipt strict contract、builder/verifier/negative tests。
- [x] 增加 backend-only current provider certification resolver command/result；server 重算 ref/hash/claims，client 不传 payload/digest。
- [x] Worker production dispatcher 只用 dedicated resolver 授权 current profile；generic Artifact resolver 保持不变并有回归测试。
- [x] Contracts/Platform/Worker focused tests、typecheck/lint与 scoped commits完成（`aac4d85f`）。

### E9-W2 — 10801 and activation authority

- [x] 新增 10801 source fragments 与 rendered SQL，不修改 10800；演进唯一 activation RPC并新增窄 certification resolver。
- [x] fresh PostgreSQL 17、exact E8 populated clone、RLS/grants、idempotent replay、failure injection、双连接 all-old/all-new。
- [x] canonical table hash证明 E1-E8、gen1/gen2、E8 failed Run/receipt bytes不变；renderer/registry/inventory PASS。
- [x] scoped commit `beb8cb62`；权威库应用前再次核对 frontier/checksum/protected history。

### E9-W3 — Finalizer and clean build

- [x] Finalizer E9 加载 terminal predecessor diagnostic receipt与fresh stage，构造 request@6；不再误用 E8 closure-failure receipt路径。
- [x] post-commit readback同时核对 E9 current、gen2 pointer/runtime/defaults、public AVAILABLE与 dedicated claims resolution。
- [x] focused Web/Platform tests、release build integrity、clean web/worker build identity/attestation；scoped commit `8ff79ea7`。

### E9-W4 — Live certification and atomic activation

- [x] 权威库应用10801 checksum `sha256:3e02122c78486eb2743b1b23c4387a7b363172335a27af5663d829085d2d7099`，25表 history guard PASS。
- [x] clean generation `sha256:31f9e03509badc73456eb0098010ca5d45104dc168d46a451cc096bce2316bc6` 下一次 live E9 certification PASS；E8时 stage STAGED/inactive。
- [ ] request@6 已原子激活 E9 baseline `7d2e476b-81e0-5390-8604-540009cfd717` / activation
  `55d3a881-8fd7-5c54-abbc-3f158f0f79c9`，但 post-readback 捕获 v1 resolver `42702` ambiguous alias。E9冻结、gates=0；前进 E10。

### E9-W5 — Formal diagnostic

- [ ] 新建唯一 E9 diagnostic attempt，通过真实 composer提交固定业务问题。
- [ ] exact answer-entry Trace UI证明动态 Root Tool Loop与 Semantic/Text2SQL/SQL/QueryEvidence/Arrow/Python/Report/Chart 全链，
  无 BLOCKED/error banner，residual=0。
- [ ] PASS receipt append-only；若首败，先写 immutable FAIL/HOLD且不 retry，再按内部 frozen closure前进 E10+。

### E9-W6-W7 — Q1, C1 and final audit

- [ ] E9-Q1 16/16；只在同 baseline winning Q1后运行 E9-C1 30/30。
- [ ] 任一 formal slot首败只写 HOLD，不 resume/跨 attempt拼证据；内部 closure修复走 successor Epoch。
- [ ] canonical final audit、exact Run Trace UI/evidence index、production false/HOLD、credential/service/browser/sandbox/scratch清理。
- [ ] Trellis验证、最后 scoped commit；只有全部 acceptance evidence闭合后标记 goal complete。

## 22. E10 unattended forward execution

### E10-W0 — Freeze E9 post-commit readback failure

- [x] 证明 request@6 为 all-new：current E9、stage PROMOTED、Artifact active、E8 diagnostic receipt未变；未重放 Finalizer。
- [x] exact backend-context SQL 捕获 `42702 / stage.app_id ambiguous`，定位10801 v1 resolver变量/alias冲突；E9 diagnostic/Q1/C1均为0。
- [ ] 更新 PRD/design/implement并 scoped commit；10801和 E9历史保持不变。

### E10-W1 — Failure receipt, contracts and versioned resolver

- [ ] Contracts增加 finalization-failure receipt、provider resolver request/result@2、activation request/result@7与负例。
- [ ] 10802新增 append-only failure authority；server实际观察旧 v1 `42702`后才可record。
- [ ] 新增 v2 resolver并要求current>=E10；Worker production dispatcher无fallback改用v2。
- [ ] focused tests/typecheck/Biome、scoped commits。

### E10-W2 — Atomic E10 activation authority

- [ ] 10802演进唯一activation RPC：v2-v6历史委托，v7绑定 E9 failure receipt + fresh E10 stage并原子切换。
- [ ] PG17 fresh/exact E9 upgrade、history hash、RLS/security、rollback/replay/concurrency、renderer/inventory PASS。
- [ ] Finalizer/record CLI E10路径与post-readback v2；focused tests、clean build、scoped commit。

### E10-W3 — Live record, certification and activation

- [ ] 权威库应用10802；record immutable E9 finalization failure receipt。
- [ ] 一次 live E10 certification，E9下 v2不可见；一次 request@7 原子激活 E10。
- [ ] readback E10/public AVAILABLE/v2 exact claims/gen2 unchanged/E10 gates=0。

### E10-W4-W6 — Formal diagnostic, gates and audit

- [x] 唯一 E10 diagnostic经真实 composer提交一次；Run在首轮 Text2SQL 两次候选被拒后，后三个 Root turn的
  新 child task均被错误 `PROVIDER_LOGICAL_CALL_DUPLICATE` 阻断，最终 immutable
  `ROOT_AGENT_TURN_BUDGET_EXHAUSTED` FAIL。没有 retry/resume；E10-Q1/C1=0。
- [ ] E10-Q1 16/16；winning Q1后 E10-C1 30/30；任一formal首败immutable HOLD并停止。
- [ ] canonical final audit、production false/HOLD、credential/service/browser/sandbox/scratch清理、Trellis验证与最终scoped commit。

## 23. E11 unattended forward execution

### E11-W0 — Freeze E10 failure and close the design

- [x] 只读核对 E10 current/gen2、唯一 diagnostic receipt、43 条 Run event、四个不同 Text2SQL child task、Q1/C1=0。
- [x] 证明 Specialist logical ID遗漏 child task：首 task产生 base+repair两个 Provider call，后续三个 task均在 Provider I/O前 duplicate。
- [x] 记录无法从安全事件证明首轮具体 SQL policy 子码，不推断 raw candidate。
- [x] PRD/design/implement/spec明确 task-scoped identity、safe feedback、既有 request@6复用、锁序、恢复、文件和测试边界。
- [x] Trellis validate、Markdown/diff check后 scoped docs commit（`7fc7ee57`）。

### E11-W1 — Worker dynamic Tool Loop identity fix

- [x] 先写 failing regression：同 Run、不同 accepted child task、相同 TEXT2SQL stage/call_index当前生成相同 logical ID并被 duplicate。
- [x] Specialist identity绑定 run/task/stage/call_index；同 task重放仍相同，repair index与跨 task均分域。
- [x] 候选最终失败只返回 allowlisted stable policy code；raw candidate/parameters/prompt/provider output不进入 Event或Artifact。
- [x] Worker focused 3 files / 16 tests、typecheck、build、owned Biome与diff check PASS；scoped commit。

实现使用 `specialist-provider-call@2:<task_id>:<stage>:<call_index>` 作为既有 Team deterministic UUID 的 material。
测试先以两个缺失 helper稳定失败，再证明同 task replay identity相等、repair index不同、下一 Root turn child task不同，并断言
真实 Text2SQL Tool 调用把该 task-scoped ID传入 Run provider capability。最终候选 rejection只允许
`TEXT2SQL_SQL_SHAPE_REJECTED`、`TEXT2SQL_SQL_DANGEROUS`、`TEXT2SQL_SEMANTIC_BINDING_OUT_OF_RANGE`；其他 code收敛为
`TEAM_TEXT2SQL_CANDIDATE_POLICY_REJECTED`。

### E11-W2 — Evidence-driven retained Finalizer

- [x] Finalizer configuration对 E9+要求 fresh LLM stage和 exactly one predecessor diagnostic attempt或 finalization failure receipt；
  E7/E8专用历史分支不变。
- [x] `finalizeFalcon24RetainedAuthority`按 recovery kind选择既有 v6/v7，不再把 target>=10硬编码为 finalization failure。
- [x] target>=E10无论v6/v7均用 current certification resolver v2完成post-readback；v1没有fallback。
- [x] 增加 E10->E11 request@6、E9->E10 request@7 regression、missing/both evidence、readback mismatch tests。
- [x] Web focused tests、Platform v6/v7 adapter regression、typecheck/build/Biome/static boundary scan全部PASS；无
  10803/migration变更。

W2先用 E10->E11 terminal diagnostic fixture稳定复现 `FALCON24_RECOVERY_ACTIVATION_KIND_MISMATCH`，再集中由
`resolveFalcon24RetainedRecoveryKind`约束 stage + exactly-one predecessor evidence。`finalizeFalcon24RetainedAuthority`按实际
receipt kind构造 request@6或request@7；E10+ post-readback只调用resolver v2。聚焦验证为 Web 2 files / 29 tests、Platform
authority adapter 1 file / 16 tests、Web typecheck和production build PASS；Turbopack仅保留既有 Test Center动态文件访问warning。

### E11-W3 — Full proof and scratch vertical canary

- [ ] Contracts/Agent Runtime/Platform/Worker/Web focused+full suites、typecheck/build、Trellis/spec checks全部通过。
- [ ] exact E10 physical clone核对 protected-history snapshot；用 fresh certification + request@6激活 scratch E11，证明 all-old/all-new、
  replay、RLS/grants和 gen2/defaults byte equality。
- [ ] 在 scratch E11上启动 exact Web/Worker和瞬态 sandbox，运行非 diagnostic/non-scoring Q&A canary；证明新 Text2SQL child task
  不再 logical-ID collision，固定问题完成 QueryEvidence/typed Arrow/Python/Report/Chart并从答案入口打开 Trace UI。
- [ ] 若 canary暴露 SQL policy mismatch，在尚未激活 E11 的 owning code内 TDD修复、重新 clean build并重建 certification；不放宽 AST/security。
- [ ] 清理 scratch service/browser/sandbox/database；只保留四个长期容器。

### E11-W4 — Dedicated certification and atomic activation

- [ ] exact committed HEAD clean build attestation；fresh E11 live certification STAGED/inactive，E10 reader不可见。
- [ ] 使用全新 staging/baseline/attempt，通过 request@6绑定 exact E10 diagnostic receipt并只原子激活一次。
- [ ] production readback核对 current=E11、public AVAILABLE、v2 claims exact、semantic pointer/runtime/defaults仍 gen2、E10 receipt不变、E11 gates=0。

### E11-W5 — Formal diagnostic and gates

- [ ] 创建唯一 E11 diagnostic；真实 authenticated composer只提交固定问题一次，从答案入口进入 exact Trace UI。
- [ ] 证明 Semantic -> Text2SQL -> SQL -> QueryEvidence -> typed Arrow -> Python operator -> AnalysisReport -> Chart、五类 Artifact和 residual=0；写 PASS receipt。
- [ ] 创建唯一 E11-Q1，严格串行 G1=1/G2=5/G3=5/G4=5，共16/16；winning后创建 E11-C1，5题 x COLD/WARM x3，共30/30。
- [ ] 同一正式 Run/attempt不 retry/resume、不跨 attempt拼证据；内部 frozen closure缺陷先写immutable FAIL/HOLD再自动前进 E12+。

### E11-W6 — Final audit and cleanup

- [ ] canonical audit generation1/E1-E3、gen2/E4-E11、各失败receipt、唯一winning diagnostic/Q1/C1与Trace UI receipts；protected bytes零漂移。
- [ ] production isolation保持真实 false/HOLD；停止服务、关闭浏览器、删除轮换credential temp、sandbox/container/scratch DB。
- [ ] audit stash保持原样；Trellis check/spec update/validate与最终scoped commit；全部AC闭合后才完成goal。

## 24. E11 Terminal Closure（终局执行方案，覆盖第 23 节未完成步骤）

> 生效时间：2026-08-29。此节覆盖第 23 节中“失败后进入 E12+”以及任何无限前向恢复表述。只允许
> `COMPLETE` 或 `HOLD` 两种终态；不得以“继续调查”结束。

### 24.1 Freeze 与唯一状态机

- E1-E10、generation 1/generation 2、全部 FAIL、receipt、Run、gate 与 Artifact 字节不可变；审计 stash
  `audit/rejected-generation1-repair-2026-08-28` 原样保留。
- E11 owning-code closure 冻结在 `8cefa61a18d60d37bba425fe4006cd1456c30411`。本节文档提交可以前进 Git HEAD，
  但不得改变该提交后的应用、合同、迁移或测试代码；后续 attestation 必须记录实际 clean Git HEAD，并同时记录 owning-code commit。
- 禁止 E12+、新 migration、新 authority epoch、新 RPC/架构阶段、Direct QA、固定 SQL、关键词路由、业务 DAG、跳过 UI、
  跳过 authority gate、手工 DML 修权威数据或回写历史。

```text
FREEZE
  -> SCRATCH_PREFLIGHT
  -> SCRATCH_CANARY
  -> LIVE_STAGE
  -> LIVE_ACTIVATE
  -> FORMAL_DIAGNOSTIC
  -> Q1_16_OF_16
  -> C1_30_OF_30
  -> AUDIT_CLEANUP
  -> COMPLETE

任一步确定性失败 -> immutable evidence（若该 authority 已存在）+ handoff -> AUDIT_CLEANUP -> HOLD
```

进入下一状态的唯一输入是上一状态的 exact PASS 证据。`SCRATCH_CANARY` 前不得触碰权威库 E11；scratch 未 PASS 不得
stage live candidate。Formal Diagnostic、每个 Q1 slot、每个 C1 slot 都是 one-shot；第一次 FAIL 后不 retry、resume、跨 attempt
拼证据或创建后继 Epoch。

### 24.2 Scratch Preflight

输入：

- exact E10 physical clone；current baseline `da72a26e-c23b-5abf-af32-6393a1495a73`；E10 diagnostic attempt
  `e1000000-0000-5000-8000-00000000d110` 与 Run `b25484bb-8f9d-870d-bc5c-96212971e83e`；
- retained gen2 release `18472091-59b1-5d86-b399-9605ca627040`；
- frozen owning-code commit `8cefa61a`，以及本终局方案的 scoped docs commit。

按顺序执行并保存命令、退出码和摘要：

```bash
pnpm vitest run <E11-owned focused suites>
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/worker typecheck
pnpm --filter @data-agent/web typecheck
pnpm turbo run build --force --filter=@data-agent/web... --filter=@data-agent/worker...
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-27-falcon24-e2-authority-evolution
git diff --check
```

使用既有 release identity 工具生成 clean attestation；必须证明 `git_dirty=false`、exact Git commit、Web/Worker build ID 和同一
generation ID。随后只用既有 E11 certification CLI 创建 fresh request@6 stage（STAGED/inactive），并用既有 Finalizer 在 clone 内
原子激活。验证：

- activation rollback 只能观察 all-old，commit 后只能观察 all-new；replay 为同结果或 stable conflict；
- RLS/grants拒绝越权；E10 reader看不到 inactive candidate；
- E1-E10、gen1/gen2、E10 FAIL receipt 的 canonical row count/hash/bytes 与 clone 前快照相同；
- activation readback 的 Web/Worker/generation identity 与 fresh stage、attestation完全一致。

本节落盘前的一次 scratch Finalizer 已返回
`FALCON24_AUTHORITY_RELEASE_BUILD_IDENTITY_MISMATCH`，没有激活 E11、没有提交 canary、没有触碰权威库。执行阶段先以只读
readback比较 attestation、fresh certification stage、candidate release/baseline三方 identity；只有证明属于同 HEAD/同输入的
stale stage或进程抖动，才可按同构 preflight重新生成 fresh stage。若需要代码、迁移、历史修改或第三种产品修复，直接 HOLD。

### 24.3 Repair 与 retry 预算

scratch 已消费两次不同的局部产品修复预算：

1. `faa7e2b1`：禁止 `to_char` 时间分桶并引导 typed `date_trunc`；
2. `8cefa61a`：为 text-backed time column增加受策略允许的显式时间类型转换。

因此从本终局方案提交后起，产品代码修复预算为 **0**。只允许同 HEAD、同配置、同业务输入的构建/进程抖动同构重试，单一步骤
最多 2 次；认证 stage 必须使用新的幂等 identity，旧 STAGED/inactive历史保留。identity mismatch只有在只读证据证明是 stale
preflight输入时才能重建；若是代码/合同缺陷则直接 HOLD。任何 external credential无法本地安全轮换、新架构、新 migration、E12+
需求或第三个不同产品缺陷均直接 HOLD。

### 24.4 Scratch Vertical Canary

仅在 preflight 全 PASS 后启动 exact attested Web/Worker 与瞬态 OpenSandbox。通过 authenticated composer **只提交一次**：

```text
最近 12 个完整月的订单收入趋势如何？请按月展示，并生成折线图。
```

唯一 PASS 合同：同一 Run 内 Root 在收到结构化 Tool Result 后进入下一 Root turn，动态完成
`Semantic -> Text2SQL -> governed SQL -> QueryEvidence -> typed Arrow`；结果形状适合该问题，故还必须产生同源
`Python operator -> AnalysisReport -> Chart`。普通 `input_artifact_refs` 必须绑定上一轮 accepted Artifact；Host不能预声明后续链路。
从该答案入口点击进入 exact Run Trace，页面必须可用并显示上述事件/Artifact lineage；API-only、直接 trace URL、BLOCKED页面、
后端日志或跨 Run证据不通过。记录 Run ID、conversation/answer ref、event counts、artifact IDs/hashes、trace entry ref、residual=0。
一次提交失败即 HOLD，不得第二次提交。

### 24.5 Formal once

只有 Scratch Canary 完整 PASS 才执行：

1. 在权威库创建 fresh E11 STAGED/inactive certification；保存 request@6 exact input/output，证明 E10 reader不可见；
2. 通过既有 RPC 原子激活一次；production-port readback核对 current E11、public AVAILABLE、exact build/certification、gen2/defaults
   不变、E10 receipt不变、E11 formal counts为零；
3. 从真实 composer提交唯一 E11 Diagnostic；从答案入口检查 exact Trace UI与 residual=0；
4. Diagnostic PASS后严格串行 Q1：`G1=1, G2=5, G3=5, G4=5`，必须 16/16；
5. winning Q1后严格串行 C1：5题 × COLD/WARM × 3，必须 30/30。

Diagnostic/Q1/C1任一正式首次失败必须写既有 authority支持的 immutable FAIL/HOLD，并立即进入 cleanup；禁止 retry/resume、
替换 Run、跨 attempt拼接、把 dev canary冒充 formal evidence或进入 E12。

### 24.6 Crash windows 与恢复

| 窗口 | 可观察状态 | 唯一动作 |
|---|---|---|
| build/test中断 | E10 current，scratch未变 | 同 HEAD/同输入最多重跑2次 |
| certification事务回滚 | E10 + 无半 stage | 新幂等 identity重放同输入 |
| certification commit后中断 | E10 + STAGED/inactive | exact load；不得改 payload |
| scratch activation rollback | scratch E10 + inactive stage | 只读分类；同构抖动可重跑 |
| scratch activation commit | scratch E11 all-new | readback后才启动 canary |
| canary进行中进程崩溃 | 单次 Run/提交事实可能已存在 | 不重新提交；以持久化 Run判 PASS或HOLD |
| live activation rollback | live E10 all-old | 不补偿DML；进入HOLD |
| live activation commit | live E11 all-new | readback；只创建唯一Diagnostic |
| formal首败 | immutable FAIL/HOLD | cleanup + handoff，任务未完成 |

### 24.7 Evidence、commit boundaries 与终态

- `TC0`：本终局方案只拥有 PRD/design/implement；Trellis validate、Markdown/diff check后 scoped commit。
- `TC1`：若仅需 fresh stage/同构操作，不产生代码 commit；运行证据写回本节/PRD/design/spec后单独 scoped commit。
- 产品代码不再允许修改。不得把并行/生成文件、attestation、credential或 runtime log纳入 Git。
- `COMPLETE` 必须同时证明 exact Run receipts、Artifact lineage、Root/Semantic/Text2SQL/Analysis/Chart事件、residual=0、protected
  history零漂移、真实 `production_isolation_proven` 值、Diagnostic PASS、Q1 16/16、C1 30/30。
- `HOLD` handoff必须包含唯一 blocker、最小复现命令、Run/attempt/reason code、已通过门禁、禁止捷径、下一步唯一动作，并明确
  原任务未完成；不使用“继续调查”作为第三种状态。
- 两种终态都必须停止本任务 Web/Worker/browser/OpenSandbox，删除 scratch container/volume与临时 credential，只保留既定长期
  容器，核对 audit stash，更新 Trellis/spec、focused validation、scoped commit并确保 worktree clean。

## 25. 四层门禁最终实施计划（覆盖第 23-24 节未完成步骤）

> 本节是最新执行入口。旧 `Q1 16/16 + C1 30/30`、产品修复预算为零和内部首败直接 HOLD 的未完成项不再执行；历史事实保留。

### F0 — 方案冻结（本轮）

- [x] 固定 L1-L4 的 9 个单轮问题与 2 组三轮 Conversation，共 15 个用户回合。
- [x] 固定 Semantic 缺失定义的友好 fallback，不向用户展示索引/治理命中失败。
- [x] 固定“业务 PASS 后复用同 Run 做 QA/Trace E2E”，不重复模型回答。
- [x] 固定无人值班软失败恢复，以及非终态 `WAITING_EXTERNAL` 持续复查；不因审批/credential等待结束任务。
- [x] 更新 PRD/design/implement，Trellis validate、Markdown/diff check；docs-only scoped commit 在本轮完成。

### F1 — 四层 gate contract 与 authority

- [x] 先写 Contracts/Evals failing tests：5/2/2/6 顺序、L4 Conversation 分组、15 次唯一问题、期望 Agent 范围、business/UI/Trace
  分阶段 receipt、旧 build/跨 attempt/跨 Conversation拒绝。
- [x] 新增 four-layer manifest/receipt v1 与 deterministic rubric；旧 qualification/campaign contract只读保留。
- [x] 在验证后的下一 frontier（10803）新增 append-only attempt/turn authority与 server RPC；不修改10774/10779或历史行。
- [x] Platform adapter、RLS/grants、fresh/populated upgrade、rollback/replay/concurrency、renderer/inventory全部 PASS。
- [x] Contracts/Platform focused + typecheck/Biome；分别创建 scoped commits（`c2de9f93`、`c5a94a8e`、`d050d319`、`87bfa271`）。

### F2 — Semantic UX 与 Root/Conversation 闭环

- [x] 为同比缺失精确 term 建立 failing test：Semantic读取订单收入/时间治理原语，生成 request-scoped 同比解释并继续，不直接拒答。
- [x] 覆盖客单价辨析、关系图、营销投入/收入/ROAS聚合公式及净 ROI 纠正；禁止静默发布全局定义。
- [x] 覆盖 L1 单 Specialist、L2 Semantic后Text2SQL、L3动态多Agent、L4 ordered history/指代/纠正/summary不作证据。
- [x] 覆盖 crash/replay不重复 Provider、SQL、Sandbox或Artifact side effect；移除/拒绝任何case/关键词路由捷径。
- [x] Worker/Agent Runtime focused + typecheck/build/Biome；Contracts 与 Worker/Agent Runtime 分别创建 scoped commits
  （`c9179a80`、`f239bfc1`），四层聚焦套件 80/80、Provider/Side Effect/Sandbox 恢复套件 62/62 PASS。

### F3 — Web gate controller 与页面验收

- [x] Gate controller每个 turn只提交一次，terminal后先 business rubric；FAIL不执行深度UI/Trace，PASS才继续同Run浏览器检查。
- [x] Q&A Agent页面覆盖 composer、activity、answer、table/chart、error/loading、refresh/reconnect、不重复Run。
- [x] Trace必须从答案入口进入 exact Run，覆盖Root/Subagent/Tool、Artifact lineage/preview、Run切换、返回与刷新。
- [x] L4两个browser session各保留一个Conversation连续三轮；验证resource version、三个Run与纠正后的口径。
- [x] 1440px逐Run正式检查；全部PASS后复用已有Conversation做390px smoke，不重新调用模型。
- [x] Web focused/browser contract tests、typecheck/build/Biome；scoped commit。

**F3 evidence（2026-08-30）**

- `4c5936be`、`249c2cb4`、`962f765d`、`64983c7a`、`1020c395` 与 `78b80e8f` 依次闭合 browser claim、可恢复
  controller、QA/Trace 页面 evidence、submit fence、业务失败 receipt 与 exact Run business evidence；`3ed30c2a` 新增
  `begin/status/advance/finalize/smoke-390` 可执行控制入口和 15 个 deterministic Run/Conversation identity。
- Controller 在 durable terminal 后先验证公开事件、answer、实际 Specialist、Artifact 与独立 rubric evidence；business FAIL 直接固化失败并
  跳过 QA/Trace，PASS 才恢复同一 Run 的 1440px 页面检查。claim 后浏览器中断可从 authority/Run 状态恢复，已存在 Run 时不再提交。
- QA receipt 核对真实 composer 消费、terminal answer、table/chart rubric、error/loading、刷新前后 exact Run count=1 与 frozen Web build；
  Trace receipt 只能从答案入口进入，逐节点核对 Root/Subagent/Tool、accepted Artifact lineage/preview、Run 切换、返回与刷新。
- L4-A/L4-B 分别使用固定 browser session 与单一 deterministic Conversation，三轮使用不同 Run 且每轮冻结当时的 resource version；
  业务 evidence 绑定每轮 rubric，包含指代、趋势拆解与 ROAS 到净 ROI 纠正检查。390px 入口只在 attempt PASSED 后读取 L4 最终 Run，
  复用既有 Conversation，不调用 composer/model，并只申请 READ capability。
- Web 相关 9 个 focused/browser 文件 44/44 tests PASS；Web typecheck 与 production build PASS（仅保留两条既有 Turbopack 动态文件
  tracing warning）；F3 全部 22 个 Web owned files Biome、commit diff check PASS。正式浏览器运行与真实 15 回合仍只在 F5 执行，
  此处没有创建 Run、调用模型或写 scratch/live authority。

### F4 — 无模型的低成本预检

- [x] worktree clean、owned commit/build identity、migration checksum、retained assets、Semantic Release/Profile/Datasource/Sandbox attestation核对。
- [x] Contracts/Agent Runtime/Platform/Worker/Web focused/full、typecheck/build、Trellis/spec、forbidden scan先通过；失败只在本阶段修复。
- [x] exact predecessor physical clone上应用新migration，证明protected history零漂移与all-old/all-new activation。
- [x] 启动attested scratch Web/Worker/OpenSandbox，用一个非正式趋势问题完成动态Semantic/Text2SQL/Analysis/Chart和答案入口Trace。
- [x] scratch失败进入自动修复环，不触碰live successor；PASS后清理scratch并冻结clean build。

**F4 evidence（2026-08-30）**

- 冻结代码为 `7ca87e75e23bb8715e3e0f8594c4d4302a36debe`，attestation generation/Web/Worker SHA-256 依次为
  `30d5e08bd45a3432cbb2b25aeb676cd0a9bc7d496fb3e7bf14ee9a466632b329`、
  `f149fc406330149a147f3ba8e6e76d5dd61f4649216acb372bbbc4c663b63d36`、
  `b96a84003a133023d5881c57d2e29f6f4823b24184c2b9fc50d3b0186a3d724a`，build manifest记录
  `dirty=false`。NAS-only runtime、gen2 Semantic Release `18472091-59b1-5d86-b399-9605ca627040`、Falcon datasource、
  sandbox镜像与显式binding均通过readback；OrbStack全程保持关闭。
- 单并发full unit gate 15/15 tasks、typecheck 16/16、force production build 8/8、migration render/inventory、Trellis validate、
  forbidden scan、diff check和F4修复涉及的15个owned TypeScript文件Biome均PASS。一次误用默认并发的full unit运行因本机资源争用
  出现跨包timeout；同批失败套件隔离重跑14/14与99/99、随后单并发full gate全部通过。整仓`pnpm lint`仍报告20个error和
  53个warning，均位于本轮owned修复之外的既有文件；本轮没有借F4扩大范围改写该历史lint债务。
- exact predecessor clone在10803-10805迁移后共有215条ledger；截至10802的213条前序记录与live E10逐字闭合，MD5均为
  `f52a83b88310288133fd90cc128a5027`。10803 checksum为
  `sha256:ff25d3e347e3645634f280bec34f26d0718ce727a0638e7f9316b9155b351892`；scratch激活只发生在隔离物理库，
  live E10仍停在212条应用ledger且authority bytes未变。
- 真实composer只提交一次“最近 12 个完整月的订单收入趋势如何？请按月展示，并生成折线图。”；Conversation
  `4ca296d8-fc48-42ae-ba54-b956ec408e18`、Run `25bcddbd-5503-8b85-9d87-ac664e02101e`最终
  `SUCCEEDED`，共58个event、2个side-effect commit。Root动态完成Semantic -> Text2SQL -> Analysis -> Chart；首次Report
  因`NameError`失败后在同Run重新派发成功，没有resume旧Run或手工修库。
- 同一答案包含12行QueryEvidence `a4272859-e98e-8dbf-96e7-b4fdd81c5a38`、AnalysisReport
  `c04710a0-9f4f-5c17-b5c1-b26be604eb57`、折线图 `fa673cbe-a092-59ab-9ae2-414a6fac3d8b`与
  DerivedAnalysisEvidence `2f1a20d5-221a-5b77-adfa-8ce6a2be2439`。答案入口打开exact Run/event 58 Trace，核对
  74 nodes、41 calls、Root/Subagent/Tool、accepted Artifact lineage/preview和Publisher；刷新后仍恢复同一Run/event，返回答案页通过。
- terminal前后sandbox sweep均为`residual=0`。证据冻结后已停止本轮Web/Worker/browser/OpenSandbox，删除当前canary专用容器
  `data-agent-falcon24-f4-month-c5b14db1`、同名pgdata卷、Keychain credential和55446转发；55433 live、55448 datasource
  以及接管边界要求保留的既有physical/audit scratch资产未被触碰。F4至此PASS，允许进入F5，旧失败Run保持immutable。

### F5 — Live activation 与四层正式门禁

- [ ] fresh live certification在predecessor下STAGED/inactive；单事务激活fresh successor并完成production-port readback。
- [ ] 创建唯一 four-layer attempt，按 L1五题 -> L2两题 -> L3两题 -> L4两组三轮严格串行。
- [ ] 每一 turn：真实composer一次提交 -> terminal business receipt -> 同Run QA receipt -> 答案入口 exact Trace receipt -> finalize。
- [ ] 任一层未完整PASS不得claim下一层；正式业务FAIL保存immutable evidence后进入F6，不继续消耗高层问题token。
- [ ] 全部15回合必须绑定同一baseline/build/release/profile；L4每组固定Conversation且三个Run可逐一打开。

### F6 — 无人值班修复循环

- [ ] 自动读取首个失败Run/Tool/Artifact/页面receipt，生成稳定root-cause fingerprint与最小复现。
- [ ] 对内部缺陷执行TDD修复、focused validation、scoped commit、clean build、scratch canary；若live已激活则以前向Epoch保留失败历史。
- [ ] 新build创建fresh attempt并从L1重跑；禁止resume旧Run、跨attempt/build拼PASS或手工DML修权威。
- [ ] 同一瞬态错误最多同构重放2次；第三次转 deeper diagnostic，而不是继续盲重试或静默停止。
- [ ] 外部credential、外部系统强制审批、长期服务不可达或额外生产授权进入非终态`WAITING_EXTERNAL`：先清空独立backlog，
  再关闭昂贵瞬态服务，以5/15/30分钟无模型探针复查；条件恢复后自动重建环境并从checkpoint续跑。
- [ ] 四层门禁不得因同比等缺失术语创建全局Semantic Candidate；若未来出现治理DRAFT，只准备review packet，不冒充真人审批，
  同时继续所有不依赖该审批的工作。

**F6 四层失败前向恢复（2026-08-31，进行中）**

- 新 build `b076864a` 的非正式 canary Run `5fd5d744-5efc-8c0b-b141-c52e436a1d3e`：business oracle、同 Run 答案刷新、
  42/42 Trace node details、4/4 Artifact previews、Team/SQL 刷新及返回通过；证据封存于本任务 audit 的
  `f6-yoy-canary-b076864a/result.json`。这不是正式四层 PASS。Web/Worker/OpenSandbox 已停止，未写 live authority。
- [x] Contracts request@8/result@8：严格引用真实四层首失败 turn receipt，不伪造 attempt terminal 或 Diagnostic。
  新恢复契约 5 tests 与既有 authority 契约 14 tests 全通过，Contracts typecheck 通过；数据库持久化首失败/权限验证仍待实现。
- [x] Platform/Finalizer/CLI：从现有 four-layer port 读取并验证 predecessor，沿既有 activation RPC 传递 exact evidence。
  Platform 17 tests、Web recovery/finalization/preflight 40 tests 与两包 typecheck 通过；不代表尚未实施的数据库迁移或正式验收通过。
- [x] 10814 实现：版本分派、真实失败闭包、同事务 certification promotion、scope/lock/replay/ACL/null 防护。
  checksum `sha256:eb85edc9df631ab973357bfa242ed556e81aad63613503dd6cf9640823fdf520`；Platform migration/adapter 22 tests 与 typecheck 通过。
  NAS 专用克隆 `data-agent-falcon24-f6-recovery-9fdd38f3`（55457，system identifier `7679875188972822568`）
  完成安装回滚及安装后 346 张既有表 count/hash 守卫，原 scratch 同样未变；另有 103 项真实 E11 前驱拒绝边界通过。
  新空库 `data-agent-falcon24-f6-prefix-9fdd38f3`（55458）跑通完整 migration prefix、runner 的必选历史/锁检查及
  10814 selected assertions；未声称全部 post-prefix assertions 通过。live 写入和 provider 调用均为 0。
  正向认证/激活、activation rollback/replay/concurrency 仍待下一验证步骤，不把安装或负例通过当成恢复验收。
- [ ] 完整 fresh-prefix 与 populated rollback/replay/concurrency/history guard；通过后才允许 live migration。
- [ ] 新 clean build 的 scratch canary；fresh live stage/epoch/attempt，正式 15 题重新从 L1 开始。

**F6 READY 轮次恢复边界（2026-08-30）**

- `e676a450-5768-48d9-a264-ab7890fe0323` 的旧构建在 L1 前三题自动门禁 PASS 后，人工页面复核发现 Root 标签及失败
  Specialist 活动未闭合；`6443b8a2`、`6d163113` 修复前后端，并加强真实 DOM gate。原收据保留为历史，不能拼入新构建 PASS。
- 既有 supersede RPC 只允许零题 READY，无法在两题之间安全退出旧构建。新增前向迁移 `10812`，checksum
  `sha256:28b74d01eeb3d56cddbee69cf98892ff524c3cefc3cdee8b199a8c3cb7ffcfb2`；复用同一 RPC/authority，不增加第二套发布权威。
- 只允许 READY 且 ordinal 0–14、完整 PASSED 前缀与 pristine PLANNED 后缀、无在途 Run/terminal receipt；锁与 CAS 下仅把 attempt
  标为 `FAILED/FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED`，保留 ordinal 和全部 turn/receipt，不伪造失败题目或 Run。
  SQL 入口显式拒绝 null protocol/reason/hash/version；READ/browser 无执行权限，backend 无直接 UPDATE 权限。
- 最终稿在 NAS 专用物理克隆 `data-agent-falcon24-f6-supersede-v2-6d163113`（loopback 55456）应用成功，13 张受保护表的
  count + canonical SHA-256 前后相等。并发两次替代仅一次成功，另一次 VERSION_CONFLICT；全部 15 条 turn 逐项不变。
  零题兼容、四种 null 拒绝、错版本、终态重放、真实 CLAIMED 状态拒绝及 ACL 检查全部通过，无模型调用。
- 初稿的安装语法失败已验证事务全回滚；初稿 null CAS 缺陷在第一份测试克隆复现后修正，未改写该测试库 ledger。
  最终稿重新从未迁移的专用 scratch 建立第二份物理克隆验证。证据为 audit 中 `10812-final-clone-{supersession,boundaries}.json`。
  此项只证明恢复协议，非业务四层 PASS；生产 authority 尚未因本迁移变更。新构建仍须 fresh attempt 从 L1 重跑。

### F7 — 最终审计、页面证据与闭环

- [ ] 输出 L1-L4 矩阵：question/Conversation/Run、实际Agent序列、answer/artifact hashes、business/QA/Trace receipts与token usage。
- [ ] 证明15回合真实答案页可用、每个exact Trace可从答案进入、L4上下文/纠正正确、refresh/replay无重复副作用。
- [ ] 核对protected history零漂移、最新authority/build/release/profile exact、sandbox residual=0、production isolation真实状态。
- [ ] 停止本任务Web/Worker/browser/OpenSandbox，删除scratch/container/volume和临时credential；保留既定长期容器和audit stash。
- [ ] 更新spec/runbook/Trellis，运行final focused/full/validate/diff checks；每个完成小任务scoped commit，最终worktree clean。
- [ ] 只有全部AC-FL/UI/AUTO/FINAL闭合才标记COMPLETE；任何外部等待都保持任务`in_progress`，不得标记blocked或结束。

### 验证命令族

```bash
pnpm vitest run <owned focused suites>
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/worker typecheck
pnpm --filter @data-agent/web typecheck
pnpm turbo run build --force --filter=@data-agent/web... --filter=@data-agent/worker...
pnpm db:migrations:render:check
pnpm db:migrations:inventory:check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-27-falcon24-e2-authority-evolution
git diff --check
```

每次只运行当前工作包需要的子集；模型题库在 F4 scratch canary 与 F5 正式门禁之前不会启动。

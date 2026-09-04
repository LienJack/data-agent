# Falcon24 Semantic Generation 2、E4 原子恢复与 E5 前向构建权威 — Implementation Plan

> 最新执行状态（2026-08-31 用户明确续执行）：PRD §22 恢复复杂四层；第 26 节核心四题 4/4 保持历史完成。
> 从第 25 节 F6 复杂能力预检继续：月度分群方法/独立 Oracle/唯一生产接线，然后核对多输入与 L4 证据闭包。
> 能力离线闭合后才做新 clean build、fresh scratch、原流程 E17 激活和同构建 15 回合；live 仍 E16 FAILED。
> [此前核心交付复核](research/core-scope-final-recheck-2026-08-31.md) 是历史检查点，其延期停止条件已被本次明确续执行覆盖。

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
- [x] forward migration prefix、必选 history/lock、selected assertions 与 populated rollback/replay/concurrency/history guard；
  未声称全部 post-prefix assertions 通过。下述 `e82471c5` fresh 实证完成后才进入 live migration。
- `7fd7676c` clean build 8/8 tasks、单并发 full unit gate 15/15 tasks 通过。首次逻辑克隆 Finalizer 在 dataset
  predecessor proof 处 HOLD（激活 RPC=0）；9 表逻辑 hash 相同但两表物理行序不同。失败克隆与认证保留且容器停止。
- 从 live 在线物理备份建立独立克隆 `data-agent-falcon24-f6-physical-recovery-7fd7676c`（55460，独立 volume，
  `cluster_name=falcon24-recovery-physical-7fd7676c`，无 replication），backup manifest 与原 E11 dataset proof 通过。
  10812–10814 均完成真实 rollback + apply、346 表历史与旧 ledger 零漂移；live authority 未写。
- 克隆 fresh credential certification Run `1a993ff7-19c6-5195-beb6-2fdc13e8fb78` 通过；正常 Finalizer 生成的 request@8
  通过 promotion 后错误注入全回滚、成功激活后回滚，随后并发首调用真实提交 E12，第二调用暴露 active certification 锁 RLS 缺口。
  克隆 E12 baseline `76ba3e8c-2eee-54eb-b0e7-afc208f8baa2` 与 activation `f65a4b39-f516-5def-8801-1c1a7bf8b8cf`
  已保留，未倒退。此为非计分 integration 验证，不是 formal gate PASS。
- [x] 10815：exact current recovery certification 锁可见性前向修复，checksum
  `sha256:9db12283ff7d6c9c92ee6cc7b0a273a4e89668f749fd22d3613f59947ff85a1e`。SQL regression 先复现
  `FALCON24_CURRENT_CERTIFICATION_LOCK_INVISIBLE`；在既有已提交 E12 克隆应用后，exact replay 与 deactivation/no-op/payload
  拒绝均通过，347 表历史与旧 ledger 零漂移，安装回滚通过。新空库 `data-agent-falcon24-f6-lock-prefix-7fd7676c`
  （55461）完整 prefix/必选历史与锁检查/10815 selected assertions 通过；并非全部 post-prefix assertions。
  新 clean build 下的 fresh certification、首次并发激活和完整 Finalizer readback 仍需重新证明，不能拼接此次历史验证作正式 PASS。
- [ ] 新 clean build 的 scratch canary；fresh live stage/epoch/attempt，正式 15 题重新从 L1 开始。

**E12 实证与 L2-02 恢复缺陷（2026-08-31）**

- `e82471c5` clean force build 8/8、单并发 full unit 15/15 tasks 通过。独立物理克隆 55462 上的正常 Finalizer
  request@8 完成 promotion 后失败全回滚、激活后回滚、并发首提交/第二次 exact replay、冲突拒绝和 ACTIVE readback。
  非计分同比 canary Run `491821bb-e564-80f7-8429-5b44ffc2a6f7` 的业务 oracle、同 Run QA、42/42 Trace 节点和
  3/3 Artifact 预览通过；原克隆和失败历史保留，服务停止。
- live 55433 在迁移前完成 `pg_basebackup` + `pg_verifybackup`，备份 volume
  `data-agent-falcon24-e11-pre-e12-e82471c5-backup` 从未启动。10812–10815 逐项安装后，346 张既有表与旧 ledger 的
  canonical count/hash 均未变化。首次认证失败保留；独立只读 capability probe 5/5 后，fresh stage 的正常认证通过。
- E12 baseline `2d6419d1-af40-514e-b46b-1131600497cb`、activation `ab1617ff-e709-5234-a463-860228fe77ba`
  由正常 Finalizer 激活。formal attempt `94cd5014-e6a1-4da5-a491-865e760fb9cf` 的 L1 5/5 和 L2-01 通过业务/QA/Trace。
  L2-02 Run `e0fa0832-8eb0-8516-be9e-753a27299108` 只返回定义，真实 business FAIL；QA/Trace 未运行，后续 8 题未提交。
- 失败 checkpoint 证明 Root 明确要求 `CONTINUATION_INPUT`，但 Semantic 快捷终止漏查 usage。已补双条件守卫与恢复回归，
  详见 `research/e12-semantic-continuation-regression.md`。四步串行链的最终收敛预算风险须另行确定性验证。
- 从从未启动的备份另建无网络、默认只读审计克隆，346 张表均匹配迁移前指纹；live 的旧行无删除，除 current epoch 指针、
  capability 撤销/heads 前进外旧行无变化。审计 `e12-history-diff-1788116086100.json` 保留，克隆已停止，backup volume 未修改。
- E12 的六题通过前缀仅为该失败 attempt 的历史证据，不能拼入下一构建。Web/Worker/OpenSandbox 与本轮 browser 已停止；
  任务保持 in_progress，production isolation 仍为 false/HOLD。下一步是修复验证、scoped commit、fresh scratch/epoch/attempt。
- `cbf9a8bd` 修复 Semantic continuation 提前结束，34 项相关测试与 Worker typecheck 通过。
  独立回归进一步证实第四次串行委派的 final evidence 被预算耗尽覆盖；已补无模型的确定性答案验收与 checkpoint 恢复，
  `max_root_turns=4` 不变，verifier 拒绝与 continuation 耗尽仍失败。38 项相关测试与 typecheck 通过，详见
  `research/root-final-evidence-settlement.md`。这两项修复尚未替代新的 scratch/正式业务证明。

**E13 非正式 ROAS canary 与绑定诊断（2026-08-31）**

- `e88c1689` clean build/attestation 与 full unit gate 通过；新物理克隆 55464 正常认证/Finalizer 激活 scratch E13，
  live 仍 E12。真实 Run `38ad317a-1c9d-86db-8f5b-3c21f6c0086b` 已从 Semantic 继续 Text2SQL，但在编译 membership 守卫失败。
- 非正式业务 FAIL、QA/Trace 未执行，失败证据与截图已封存、昂贵服务/browser 停止；正式 E13 stage/attempt 未写入。
- 精确区分 result/time binding 诊断，不改变拒绝条件、不输出候选内容，回归先 RED 后 GREEN。只读 catalog 又证实独立 ROAS
  Formula 没有对应 Metric，现有输出合同无法诚实绑定；下一小任务须修复公式输出闭包，不能靠伪造 metric 或放宽 allowlist。
  详见 `research/e13-semantic-binding-diagnostics.md`。任务保持 in_progress，不能将诊断通过当成 canary/正式 PASS。

**独立 Published Formula 输出闭包（2026-08-31，离线实现已验证）**

- Candidate/QueryEvidence 使用 FORMULA kind/role，不创建 Metric 或更改 gen2；编译/执行前与 evidence acceptance 共用
  已发布 AST + selected Metric dependency + active PhysicalBinding + snapshot 的精确证明。拒绝算式改写、参数漂移、
  缺失/歧义/未选依赖、跨 grain 与整数除法截断；Formula hash 绑定 release、Formula、实际 Metric/slot/physical sources。
- accepted Context 独立列出 Formula IDs 并限制依赖 Metric；两个安全诊断走原 repair/事件白名单。Analysis Arrow 与真实
  加密 materialization receipt 保留 Formula 身份及 source_binding_hash，不扩大 Published Metric 方法权限。
- Platform datasource 10 suites / 142 tests、Worker teams/analysis/provider 40 suites / 271 tests、Contracts artifact/
  materialization 2 suites / 10 tests 通过；Contracts/Platform/Worker typecheck、owned TS Biome、diff check 和 Trellis validate 通过。
  Trellis 仍提示两份既有长文可能在自动注入时截断，本轮按已读完整规范执行，没有将自动注入视为完整阅读。
- 扩大回归发现四个历史 E1 路由 fixture 缺少 `d3b8e408` 已要求的 output_usage；单独修复提交 `03643bc2`，6/6 通过，
  严格运行时守卫未变。Formula 修复未覆盖该提交，也未修改旧 canary/attempt。
- 下一步：scoped commit → 新 clean force build/attestation/full unit → fresh NAS 物理 scratch → 单次 ROAS 业务/QA/Trace canary。
  通过后才能正常认证/Finalizer 激活 live E13、创建全新 attempt 从 L1 开始。live 仍 E12，production isolation=false/HOLD。

**Formula canary 业务失败与未声明时间选择修复（2026-08-31）**

- `506c3cb8` clean force build 9/9、full unit 15/15（6 cached）通过；NAS fresh physical clone 55465 的 manifest/
  dataset proof 完整匹配。正常认证/Finalizer 只激活 scratch E13，live E12 未变。
- canary Run `e0deb349-fc57-83f8-ad96-b7bd8ce82dd5` SUCCEEDED，独立 Formula 绑定成立，但 SQL 含日期过滤而
  evidence.time_window=null，原题全量四渠道 oracle 全 FAIL。封存为 `UNDECLARED_TEMPORAL_FILTER`，QA/Trace=null；
  Web/Worker/OpenSandbox/browser 停止、临时 auth vault 删除，失败库与生成物保留。
- 共享 AST/CTE 反向检查补到 compile、执行前和 evidence acceptance；覆盖文本日期的 selected Metric 物理关系，
  所有时间条件位置与 alias 派生，不生成 SQL、不改变 gen2。新增安全诊断指导同时修复 SQL/声明，保留 adapter 原脱敏合同。
- Platform 11 suites/179 tests、Worker 40 suites/277 tests、两端 typecheck、11 owned TS Biome 通过。
  细节和五维分析见 `research/e13-undeclared-temporal-selection.md`。下一步 scoped commit、新 clean build/fresh scratch，
  通过后 fresh live E13/15 回合；旧 E12 与两个 E13 failed canary 均只作为历史，不拼接 PASS。

**E13 正式首题失败与 Root AUTO 输出修复（2026-08-31）**

- `bb23f0bb` force build 9/9、full single-concurrent unit gate 15/15（12 cached）通过；fresh scratch 55466 的
  canary Run `f239cfd4-6821-8bb6-b5e9-0fe14231b252` 四渠道全量 oracle PASS，QA/Trace PASS。
  两次只读 UI 验证 harness 失败记录保留：先允许合法 terminal FAILED 活动，再等待实际 chart hydration；未重提问题。
- 正常认证/Finalizer 激活 live E13 baseline `1f2a0b86-0fb2-5f9e-b52c-fa6ade84a7a3`。此前物理备份
  `data-agent-falcon24-e12-pre-e13-bb23f0bb-backup` 已校验、never-started；347 表指纹及 ledger 审计保留。
- fresh formal attempt `c31efada-c780-43dc-8151-e8167db5af9e` 首题 Run
  `8ef759dc-cbd8-8132-8df3-a8ba87e6ac16` FAILED/49 events，business=FALCON24_RUN_FAILED，QA/Trace=null，
  后续14题未提交。Semantic-only 之后 Root 产生无效 Text2SQL 调用；已封存不可变 FAIL 并停止临时服务/browser/auth vault。
- 对照 E12 数据请求反例，不撤销 continuation 守卫。离线复现并修复 AUTO 无工具返回 text、结束分支却读取 object 的缺陷；
  完整最终答案 Schema 从原 Zod 定义派生，明确 output_usage 只针对当前请求。Root 下一正常轮仍可自主 final，Host 不改观察。
- Agent Runtime unit 27 suites/170 tests、真实 pinned Mastra offline integration 26/26、Worker providers/teams
  27 suites/195 tests、Agent Runtime/Worker typecheck 通过；TDD 正向 JSON 与 prompt schema 均先 RED 后 GREEN。
  细节见 `research/root-auto-final-answer-completion.md`，UNKNOWN 的具体原因不作超出证据的归因。
- 下一步：scoped commit → clean force build/attestation/full unit → fresh NAS scratch 同时验证 semantic-only 与 ROAS →
  使用 E13 首个失败 turn 的真实 receipt 正常激活 E14 → fresh 15 回合从 L1 开始。production isolation=false/HOLD，任务 ACTIVE。

**E14 正式最近订单失败与跨表时间来源修复（2026-08-31）**

- `74813f90` force build 9/9、full single-concurrent unit gate 15/15（12 cached）通过；fresh scratch 55467
  semantic-only Run `f79aa924-0f0a-8e4d-96de-6aef050319f8` 与 ROAS Run `b617255b-03b5-8f3e-8669-5b5993b50a2b`
  均 business/QA/Trace PASS。ROAS 内部发生四次候选拒绝后在既有有界恢复中成功；四渠道独立 source oracle 全量相等，不隐去失败活动。
- 正常认证/Finalizer 激活 live E14 baseline `15fbecad-578f-5fa3-9a14-b1f6999ad004`；前置备份
  `data-agent-falcon24-e13-pre-e14-74813f90-backup` 已校验且 never-started，347 表与 ledger 指纹保留。
- formal attempt `b428c7ca-9168-4c77-8b1f-489db038a8ea` 的 L1-01/02/03 全部 PASS；L1-04 Run
  `8b2b9e3e-e110-8735-a050-23b8d6549fee` FAILED/74 events，无 QueryEvidence/SqlArtifact。
  first failure 为 `FALCON24_RUN_FAILED`，terminal turn receipt `sha256:d5fdde166e01dd5cf24625af293e8e6a33f2bbca11759ae119ab729a9cb3e052`；
  QA/Trace=null，后续11题 PLANNED，无 Run/提交。昂贵服务和本轮浏览器/vault 已停止，旧 attempt 不重跑。
- 实际冻结上下文只读探针稳定证明：配送 Metric 合法跨表引用订单日期，反向时间守卫却强制同表。
  两个合成最近订单 SQL 在修复前均 binding invalid、修复后均 PASS；不是复原历史被拒 SQL，也没有模型/数据查询调用。
- 修复复用既有 exact physical binding 解析，仅为跨表时间选择目标列；同表无需额外 Dimension 的限制识别保留。
  Platform focused 119/119、Worker focused 79/79、Platform/Worker typecheck 通过；新 Platform 两个参数化用例先 RED 后 GREEN，
  Worker 需重建 Platform dist 后验证。缺失/错 datasource/逻辑列/lifecycle/snapshot 均拒绝，隐藏时间过滤仍在 I/O 前拒绝。
  详见 `research/cross-table-metric-time-source.md`。
- 下一步：scoped commit → clean force build/attestation/full unit → fresh scratch 最近订单 + semantic-only + ROAS
  → 正常 live E15 → 新 attempt 全15回合。旧 PASS 不拼接，production isolation=false/HOLD，任务保持 ACTIVE。

**E15 正式结果类型失败与安全修复反馈（2026-08-31）**

- `e4612435` force build 8/8（0 cached）、single-concurrent full unit 15/15（12 cached）通过，build generation
  `sha256:152c579de60b2e89c48453307ac6e1b867f7b960816c3a433940687ae855247f`。
  fresh NAS scratch 55468 的最近订单 Run `ec075c4b-8ca8-8b56-a6c1-2df403fe36dd`、semantic-only Run
  `fbe7536f-65fa-8b74-8ec8-1b4681a60530`、ROAS Run `659607db-f352-8030-b3e9-1687d756bb4b`
  均业务/QA/Trace PASS。两条数据题独立 source oracle 相等；只读 harness 的 chart 约束/hydration 修正保留失败记录，未重提问题。
- live 备份 `data-agent-falcon24-e14-pre-e15-e4612435-backup` 已物理验证且 never-started，347 表/ledger 指纹保留。
  初始 helper 图片 hash 误替换由 guard 在备份/写入前阻断，修正 exact literal 后才执行正常备份和激活。
  E15 baseline `eb6f538e-257a-57a2-9071-9e97ba8849c0`、activation `05f5c9b5-8b82-5691-8a70-64847a2d447c`。
- formal attempt `092a7136-6ec4-4888-a90e-b2129090cb2c` 前三题 PASS；L1-04 Run
  `fdd424d2-6663-83f7-9b9a-a295fb371cbb` FAILED/87 events，无 Artifact，四次 Text2SQL 委派各两候选均发生类型绑定拒绝。
  首个失败 turn receipt `sha256:2f1ad732fedcc29f5933a5bc8384caa53c93d439bf78284a366424e022fe9360`；
  QA/Trace=null，后11题未提交。过早只读 terminal/oracle 检查被 guard 拒绝，未产生 PASS；terminal 后正常封存 FAIL。
  本轮 Web/Worker/OpenSandbox/browser/vault 已停止，所有旧审计与 scratch 保留。
- 独立零行 scratch RowDescription 探针证明 raw text SELECT 与排序 cast 独立；历史 SQL/OID 未落盘，明确不反推具体写法。
  修复仅在既有错误、bounded repair context 和无值公开诊断之间传递 exact-length 逻辑类型枚举，保留严格拒绝/权限/原重试预算。
- Platform focused 122/122、Worker focused 80/80、两包 typecheck、Biome、diff check、Trellis validate 通过。
  Platform 三个新 observed-type 断言先 RED 后 GREEN；测试联合类型收窄问题已修正并重验。validate 仍有两份历史大文件截断警告，未作无关修改。
  Trellis before-dev/check/break-loop 约束了原契约复用、跨层脱敏与规范同步；详见 `research/postgresql-result-type-repair-feedback.md`。
- 下一步：scoped commit → clean force build/attestation/full unit → fresh scratch 最近订单/semantic-only/ROAS
  → 正常 live E16 → 全新15回合。旧 PASS 不拼接，production isolation=false/HOLD，任务保持 ACTIVE。

**E16 请求内同比结果绑定失败与修复（2026-08-31）**

- `f76fc2da` force build 8/8（0 cached）、full unit 15/15（12 cached），generation
  `sha256:5736857faa5eeaac342b65e425465ee5dddfe82356a9e58191519af38adc9159`。
  fresh NAS E16 scratch container `data-agent-falcon24-e16-f76fc2da`，远端55469/本机55470、独立 volume/cluster。
  最近订单 `35354a64-df5c-8d7f-8039-20fd747d858f`、semantic-only `e1f1f187-6491-84d9-964d-151b2fde5a1d`、
  ROAS `7c0bbd95-5f34-8834-be3b-9250c5aa0b23` 业务/QA/Trace 均 PASS。ROAS 曾有一次 Semantic provider 协议错误，
  在同 Run 正常 bounded recovery 后成功，不能称零错误。harness v5 按 accepted chart refs 等待 hydration，无问题重提。
- live 前置物理备份 `data-agent-falcon24-e15-pre-e16-f76fc2da-backup` verified/never-started，347表历史与 ledger 指纹保留。
  live E16 baseline `012151cb-280a-5803-a6b5-d1d8d7600931`、activation `bae3ba83-2440-52a8-899e-4bd8b2e65664`。
- formal attempt `fdc6192b-007e-4cde-bb95-bba0f1fc82a1` / E16-FL1：L1五题业务/QA/Trace全部 PASS；
  semantic 三题、订单 Run `961a8e65-ceb8-8383-96b0-9cc674c67f67`、Report Run `dad280bf-e715-8598-980f-f4ae0331b450`
  均沿本 Run exact artifacts 验收。Report 仅消费明确 accepted table input，没有新增推断。
- L2-01 Run `54843d21-f9aa-82d5-bca6-7986cf66eb0b` FAILED/74 events，六次 compile
  `TEXT2SQL_SEMANTIC_RESULT_BINDING_OUT_OF_RANGE`；只有 accepted SemanticQueryContext。
  已正常封存 attempt FAILED/version29，失败 turn receipt
  `sha256:636dd3943d248caa8bac548725b960d0edd5ebedb58ce80162f7e7cf56f27c87`。
  QA/Trace=null，后九题未提交；本任务 Web/Worker/OpenSandbox 与4个剩余 browser sessions 已停止，vault 已删除。
  原数据库、备份、scratch、audit 全保留；本机55469为无关 browser listener，未触碰。
- 修复：明确 REQUEST_DERIVED Candidate/QueryEvidence/Analysis 身份，exact Context/解释 hash；compile/admission/acceptance
  共用单表双 CTE 月度 SUM 的语义证明，重标 Metric 不能逃逸；LEFT JOIN 同期 nullable，严格 OID、原重试预算保留。
- Contracts 41/41、Platform 163/163、Worker 115/115 focused 通过。重标 Metric 负例先 RED（返回空数组）后 GREEN。
  真实冻结 Context + E16 scratch 只读探针得到12个月/6个同期 NULL，独立 source sums 一致，真实 OID 1114/701/701/701；
  provider_calls/authority_writes/artifact_commits 均0。TimeDomain依赖兼容和探针时区/浮点断言问题均在离线阶段解决。
  证据：`formal-e16-f76fc2da-fdc6192b/runtime/request-derivation-readonly-probe.json`；不是正式 PASS。
- 下一步：scoped commit → clean force build/full unit/attestation → fresh scratch 新增月度同比业务/QA/Trace，复验订单/semantic/ROAS
  → 使用 E16 真失败 receipt 正常激活 E17 → 新15回合从 L1。任务保持 ACTIVE，其他派生/多表形态未声明支持，production isolation=false/HOLD。

**E17 scratch 同比失败：指令一致性与诊断修复（2026-08-31）**

- `f9e64ac7` force build 8/8（0 cached）、single-concurrent full unit 15/15（6 cached），generation
  `sha256:fbc4a12cd05c9baf4bd54e78b3afc0a5f26c92c3c9d2a63355495e1970b366c8`。
  fresh NAS scratch `data-agent-falcon24-e17-f9e64ac7`、55471、专用 volume/cluster，物理备份校验及原始数据
  9表/70列/121445行/1902NULL 证明一致。scratch certification/finalization 正常完成；live E16 未变。
- 第一个同比 canary `7a3bb95a-daeb-4281-b93c-f087abcb5764`，Run `7144b8e6-c4e7-86bc-8d92-89b57a91a1f7`
  FAILED/74 events。Semantic 成功，SQL 四次别名拒绝、两次派生表达式拒绝；三组候选修复前后 hash 分别相同。
  只有 accepted SemanticQueryContext，没有 SQL/QueryEvidence。业务失败已留档，未执行 QA/Trace，其他三题未提交。
  source 与 failure 保存在 `e17-yoy-canary-f9e64ac7`；owned Web/Worker/OpenSandbox/browser/vault 已关闭，scratch/audit 保留。
- 修复已证实的 prompt 矛盾（禁止 CTE 预平移）及无细分诊断缺口；共用有限 registry，不放宽任何 SQL 条件、不暴露值。
  新检查点错误与提示相反建议断言先 RED；正向/反例、并发隔离、原 repair/public-event 脱敏链均验证。
  Platform focused 177/177、Worker focused 98/98、两包 typecheck、Biome/diff check 与 Trellis validate 通过（原两份大文件警告保留）。
  详见 `research/e17-comparison-proof-diagnostics.md`。历史候选 SQL 未保存，不能冒称已找到其精确错误。
- 下一步 clean scoped commit/build/full unit → 全新隔离 scratch 先同比后回归。live 仍 E16 FAILED，后继仍 E17；任务 ACTIVE。

**E17 scratch 三题 PASS / ROAS FAILED：显式候选修复轮（2026-08-31）**

- `a029cb71` force build 8/8、single-concurrent full unit 15/15，generation
  `sha256:7a3034254e12481d4b9aa99a52f7b5bdf169e1ba3f3b3ae03e5c1d2013b7f9ce`。
  fresh NAS `data-agent-falcon24-e17-a029cb71`、55472、专用 volume/cluster，pg_verifybackup 与9表/70列/121445行/1902NULL 相等。
  scratch baseline `160fa0fb-8971-5011-a94c-8a76b9f747f3` 正常激活；live E16 未变。
- 同比 Run `2298164d-c154-83b7-af05-c18afcef06fa` 业务/QA/Trace PASS（83 nodes/3 artifacts）：12个月、6个未覆盖同期 NULL，
  exact source sums/rates 匹配；同 Run 五次拒绝后 bounded recovery 成功，不称零错误。
- 订单 `f067fd13-b26c-8b72-ba71-14ac7c85fa9d` PASS（27 nodes/2 artifacts）；semantic
  `fb009b96-6f54-8001-b5ff-b31d95e4d145` PASS（21 nodes/1 artifact）。QA 主视图已人工图像核对。
  订单曾有未提交空 Conversation 的 datasource/model NULL，pre-submit guard 两次拦截且零 Run/marker；
  等正常目录加载后新建正确绑定 Conversation 才唯一提交。旧空 Conversation 保留 F7 清理，不伪称业务重试。
- ROAS `10649939-0cc3-8c64-8ed7-f0e38ccb30b8` FAILED/74 events，三次 alias、三次 Formula 拒绝，无 QueryEvidence。
  `e17-roas-canary-a029cb71/failed-run-source.json` 与一次业务失败记录保留；QA/Trace 未执行。
  所有本轮 owned Web/Worker/OpenSandbox/browser/vault 已关闭；scratch/历史/audit 保留。
- 修复包改为 strict Host contract；Provider 将原冻结上下文保持 system，追加被拒 Candidate 与明确 Host 修复 user 消息。
  强调已发布 ROAS CASE 的零值0不得改为 NULLIF 的 NULL；不增加预算、不改验证器、不重写 SQL。
  Worker focused 100/100、Contracts 14/14 通过；真实 dispatcher/model-port capture 确认不同消息/hash、相同预算/工具和非法包零 dispatch。
  详见 `research/e17-explicit-candidate-repair.md`。真实模型效果未验证，三个旧 PASS 不可复用。
- 当前继续 ACTIVE：先完成本修复 scoped commit，再补齐 L4 AGGREGATE_RATIO/净 ROI 的 REQUEST_DERIVED 结果绑定已知缺口；
  随后新 clean build/full unit/fresh physical scratch，全部 canary 闭合后才可正式 E17 从 L1 重做15回合。

**E17 预检：净 ROI 请求结果证明（2026-08-31）**

- 显式修复轮已提交 `525a77d3`。接续实现 L4 已知 AGGREGATE_RATIO 缺口：双 allowlist 纳入 exact interpretation，
  共享 Context/源 SUM/hash 验证，单表直接分组净 ROI 与 raw Metric 投影逐一证明；未发布新 Formula。
- 正向绑定与 METRIC/FORMULA 重标反例先 RED（旧实现分别拒绝合法请求、错误返回空 bindings），新实现 GREEN。
  Platform focused 225/225；Worker focused 101/101；真实 compiler parameterization、NULLIF/CASE NULL、分组/来源/类型/
  时间请求不得丢失、空集 SUM nullable 与旧月度同比/Published Formula 回归均覆盖。额外 Contracts 12/12、Analysis 消费25/25
  通过；Platform/Worker typecheck、Biome/diff、Trellis validate 通过（原两份大文件警告保留）。详见 `research/e17-net-roi-result-binding.md`。
- `e17-roas-canary-a029cb71/net-roi-readonly-probe.json`：专用 NAS scratch 55472/cluster exact/read_only=on，
  现有冻结发布内容+仅内存请求解释，经真实 Worker compile/shared proof/真实 PG query，4渠道与独立源 SUM/rate oracle 一致。
  OID 25/701/701/701，角色 DIMENSION/METRIC/METRIC/REQUEST_DERIVED；provider_calls/authority_writes/artifact_commits=0，
  interpretation_accepted_as_artifact=false。不重建历史失败 SQL、不把探针记为业务 PASS。
- 当前仍 ACTIVE、live E16 FAILED/E17 未激活。本项 scoped commit 后新 clean build/full unit/attestation，fresh physical scratch
  从同比及三题回归重做，并新增净 ROI 真实 canary；业务通过后才执行各自 QA/Trace。旧三个 PASS 不复用。
  带窗/跨表 ratio 等更广形态仍不宣称支持；正式前继续核查所需能力，不能靠删要求、改 oracle 或增加预算通过。

**E17 scratch 关系 metadata 闭包修复（2026-08-31）**

- `49cbc84c` force build8/8、single-concurrent full unit15/15、attestation 通过。fresh NAS scratch55473/独立volume与cluster，
  原数据指纹一致；正常认证、scratch baseline `e573ce52-2149-5cfe-88a9-c4b77b5382c4` 激活，live E16 不变。
- 同比唯一提交 Run `5a82c71e-e24b-88b0-a267-9b3f8f9b8533` FAILED/74 events：4次 request binding 拒绝、2次 alias 拒绝，
  仅 accepted SQC，无 SQL/QueryEvidence。一次业务失败记录及完整 source 封存在 `e17-yoy-canary-49cbc84c`，未做 QA/Trace。
  其他四 canary 未提交；owned Web/Worker/OpenSandbox/browser/vault 均已停止，数据库/volume/audit 保留。
- 离线复现确认结果层遗漏已验证 mandatory Relationship metadata；两算子8个回归中的两个正例先 RED，其余反例保持拒绝。
  只补 requested metadata membership，不改 executable selection、SQL证明、发布或预算。Platform233/233、Worker90/90 focused通过。
- 重建 Platform 后，真实 Worker compile/shared proof/只读 PG query 对原 SQC 成功：12个月/6个 NULL，OID1114/701/701/701，
  独立源金额/同比一致。`monthly-readonly-probe.json` 明确 synthetic Candidate、historical_candidate_reconstructed=false、
  provider_calls/authority_writes/artifact_commits=0；不是模型/正式 PASS。详见 `research/e17-request-relationship-closure.md`。
- 当前 ACTIVE；完成 scoped commit 后 fresh clean build/full gate/scratch 重新验证五题。live E17 尚未激活，旧 PASS 不拼入。

**E17 scratch 投影检查点细分（2026-08-31）**

- 关系闭包修复提交 `5327d719`；force build8/8、single-concurrent full unit15/15、attestation通过，generation
  `sha256:9f524201e0c35f2317b990d87684c058007f468b8eab6bdbb7b27b271c50b90f`。
  NAS fresh scratch55474/独立volume/cluster、exact源镜像与pg_verifybackup、原数据指纹一致；认证与scratch正常激活完成。
- scratch baseline `f77e766f-a8b9-5011-9cda-03c0f4415a13`；唯一同比 Run `1e4dbc77-45c1-8b7f-a4c8-9ba06affe52f`
  FAILED/74 events：2次alias、4次CURRENT_PROJECTION，无SQL/QueryEvidence。完整source与一次业务failure保存在
  `e17-yoy-canary-5327d719`，QA/Trace未执行，其他四题未提交。owned服务/browser/vault关闭，scratch/audit保留；live仍E16。
- 离线仅细分月桶参数、时间输入与SUM输入的六个有限诊断，不改SQL支持条件、发布、预算或历史；逐表达式重置checkpoint。
  六个编译round-trip反例先RED，后Platform241/241、Worker131/131聚焦测试通过；包含公开repair与真实dispatcher离线capture。
  详见 `research/e17-monthly-projection-diagnostics.md`。历史候选原文不可恢复，不宣称已证明具体SQL错误。
- 任务ACTIVE：本项scoped commit后新clean build/full gate/fresh scratch继续；仍不能激活live E17或拼入旧PASS。

**E17 同构建五项基础回归与复杂能力前置（2026-08-31，进行中）**

- `cc9ff33e` force build8/8、single-concurrent full unit15/15、attestation通过；fresh物理scratch55475/cluster
  `falcon24-e17-cc9ff33e`，baseline `864d636a-7032-5fc7-b7cf-1e887dd9874e`；原数据proof一致，live未变。
- 同比 `9f17195a-11d5-86ac-be35-2f25f4123abc`、最近订单 `36539d60-a72b-8bdf-bf4e-2bbccbae64db`、
  语义 `b4e26921-88b7-8755-8090-2940eb540ff3`、ROAS `5546ab5c-0fd7-8340-9f47-2650e66cf3c6`、
  净ROI `279c33d8-5ef4-83f8-a6e7-52de360f46c1` 全部 business/QA/Trace PASS，分别45/27/21/45/42个节点。
  audit分别为 `e17-{yoy,orders,semantic,roas,net-roi}-canary-cc9ff33e`。每题一次composer，未改oracle/harness，均非正式证据。
- 同比12个月/6个受coverage限制的NULL；订单10行源记录一致；两个渠道比例各4行源SUM/rate一致。ROAS一次公式拒绝后
  原预算内成功，净ROI无候选拒绝，保留REQUEST_DERIVED/NONE且不复用ROAS身份。五个浏览器/vault及owned服务均已关闭，
  scratch无非终态Run，NAS无运行中analysis Sandbox；全部数据库/volume/audit保留。
- 正式前发现 production `methodRegistry/createSingleSeriesAnalysisOracle` 仅支持12月/2列/1 Metric；复杂渠道、人群与多指标
  尚不具备闭包。先精确带窗/月度ratio输入，再受治理分群/多指标Analysis方法，再核对跨Run/Report链；不为评分删题或增预算。
- [x] 精确RECENT_COMPLETE_PERIODS + AGGREGATE_RATIO的共享SQL/Context证明：Platform308/308、Worker136/136、双方typecheck、
  Platform build、9个TS文件Biome通过。新增SQL/Context正例先RED再GREEN；缺失coverage负例再次RED后补齐拒绝规则。
  真实源只读探针48行/12月/4渠道与独立SUM/比例oracle一致；未更改原Context、未调用模型/提交artifact或绕过生产Context gate。
  该探针不证明新Run接受或完整Workercompile；详情与audit路径见 `research/e17-complex-capability-preflight.md`，随本小项scoped commit。
- [ ] Analysis注册/契约/oracle按已发布能力及真实输入形态扩展，沿现有Sandbox与原子publisher；focused validation + scoped commit。
  - [x] 直接投影源列身份前置：ResultContract@2可选显式input/output，保留role/ID/type/NULL/Arrow/同输入门禁。
    契约新增正例先因unknown source失败；schema通过后Worker正例仍因重复Metric失败，投影修复后通过。
    Contracts6文件41/41、Worker7文件71/71、两包typecheck/build与4文件Biome通过；原无source契约golden hash固定。
    不注册新方法、不创建模型Run或触碰live；§25.21与Python Sandbox code-spec随本小项scoped commit。
  - [x] FORMULA/REQUEST_DERIVED直接结果角色保留：Host从原accepted QueryEvidence证明额外lineage，不授予Metric/Skill能力。
    契约两正例及runtime四正/反例先RED；修复后Contracts43/43、Worker92/92、两包typecheck/build与6文件Biome通过。
    13类来源漂移、未接受来源和Metric升级均执行前拒绝；两role真实Arrow保留NULL，staged chart parser保留role。
    无模型调用、无新方法/新Run/live写入。V3图表NULL、具体方法/oracle、全量时间窗及跨Run闭包仍待后续小项。
  - [x] V3缺失观测闭包：显式derived-analysis-chart@1.1.0允许LINE/BAR/HORIZONTAL_BAR的NULL并保留月份，每measure须有真实值。
    旧1.0 golden hash固定，旧版NULL/其他七类图的NULL/全空measure/非法数值/旧hash篡改均拒绝；原行数/字节限制不变。
    Platform趋势不删行、不把未知delta填0，Worker三role staged chart及Web各measure断点回归通过。
    新Contracts预期行为8项、Platform1项、Worker3项先RED；修复后Contracts36/36、Platform19/19、Worker52/52、Web18/18，
    四包typecheck、Contracts build通过；本项不新增方法、模型Run、live写入或正式PASS。
  - [x] 月度多结果方法的输入/输出契约：exact12月、单MONTH维度、2–4个NUMBER结果，各列保留source/role/NULL；
    只授权原Metric的CHART_DATASET，Host规则声明描述性比较，不注入预计算答案。新23项及原编译/投影/发布回归共83/83，
    Worker typecheck/build通过。尚未切换production注册；接续独立oracle和唯一生产composition，再验证真实执行链。
  - [x] 月度多结果独立oracle：源QueryEvidence/真实Arrow重算，逐字段核对完整RESULT/TABLE/CHART及bytes/hash/ref；
    重封hash后的错误数值/排序/补零/换列/额外总结/因果声明拒绝；零端点、不能跨缺口、有限输入运算溢出闭合。
    新32项oracle回归与原路径共117/117，Worker typecheck/build和4文件Biome通过。时间窗函数只抽取复用，规则未改。
    仍未注册production方法，未创建Run或触碰live；下一小项为现有唯一composition接线。
  - [x] 唯一production composition接入月度多结果方法/独立oracle，原两列趋势与两项统计义务保持；Host规则随registry hash，
    只给exact method/skill/contract节点。初始4个生产接线回归因旧single-series形态限制失败，修复后10文件132/132，
    Worker typecheck/build通过；新叙述投影保留已验数值，缺规则/错方法与删旧算子均拒绝。
    未改预算/Root路由/发布器，未创建模型Run或live写入；后续全量范围、多维/多输入及跨Run闭包仍待完成。
  - [x] 全量已接受输入范围契约：candidate2.1/Program1.1/envelope1.1保留null，只授权原accepted QueryEvidence，
    Gate对null也精确比较，禁止虚构/丢弃窗口、比较窗、时间grain与统计义务；旧有窗Program与hash不变。
    新Worker范围行为8项先RED（另3项fixture封hash方式修正后重测），Contracts新wire正例先RED；
    Worker11文件144/144、Contracts5文件59/59、Platform2文件42/42，Contracts/Worker/Platform/Research typecheck通过，
    Contracts及Worker build通过。真实source authority负例、旧单指标统计和新月度oracle保持，原发布封包两版可读。
    本项没有生产渠道方法、模型Run、数据库写入或正式PASS；接着补渠道/分群形态与独立oracle。
  - [x] 真实来源nullable前置纠正：cc9同比12个月DATETIME列元数据nullable=true，实际非空；按值验证而非拒绝元数据。
    DATE/DATETIME两个正例先RED，修复后4文件84/84、Worker typecheck/build及2文件Biome通过；实际NULL/重复/缺月仍拒绝。
    专用scratch55475只读检查同一原QueryEvidence shape由拒绝变为PASS，0模型/0权威写入；不视作完整方法或新Run通过。
  - [x] 分类方法叶子契约：1–2分类/1–4结果/≤200行，完整tuple/原列/NULL/行序与原Metric能力不变；描述性排名与原表图。
    新22项及原编译/发布等5文件75/75、Worker typecheck/build、3文件Biome通过。测试最初因方法模块缺失失败，
    ratio fixture补齐原SUM_BEFORE_RATIO/NULL声明；没有放宽原来源schema。独立oracle与production接线接续，未调用模型或写库。
  - [x] 分类独立oracle及唯一production接线：原QueryEvidence/真实Arrow重验、源行独立计算，完整RESULT/TABLE/CHART与字节/ref/hash匹配；
    任意重封hash的值/排序/group/表图/补零/额外事实/因果漂移拒绝。exact method/skill/contract/Host规则闭合，原统计/月度方法不变。
    初始oracle模块缺失RED；分类30项（含生产selector）与原路径10文件共185/185，Worker typecheck/build通过；
    真实Arrow到表图、两级分类与NULL、叙述数值保留。公共helper仅复用字节/ref/JSON检查且进入实现摘要，没有复用业务算法。
    这是离线组件验证，stub receipt不是真实Sandbox证据；0模型/0数据库写入，月份×分类、混单位/多输入和跨Run闭包继续处理。
  - [x] 显式分类分面读取契约：V3 facet_key/transform1.2封原字段身份与全表；旧1.0/1.1拒绝新字段，原golden hash保持。
    Web按原分类再按measure分图，series/NULL/源行不变，不造复合源列；标签/独立轴/PENDING有静态回归。
    初始6项新版本行为RED；Contracts53/53、Web26/26，Contracts/Web/Worker/Platform typecheck及Contracts build通过。
    仅读取与映射，生产publisher/Trace接线仍待完成；没有浏览器E2E、模型或库写入，live E17未激活。
  - [x] 原publisher/Trace的facet producer-consumer：Host选publish1.1、Chart1.1、V3 transform1.2；旧输入与RESULT/TABLE字节不变。
    原始STRING/DIMENSION字段、版本与template逐层闭合；Trace缺source/非DIMENSION两个重封hash反例先RED后GREEN，公共DTO不透传数据。
    Contracts53/53、Worker145/145、Platform40/40及四包typecheck、三包build通过；含原模型工具循环/统计路径与擅改旧oracle图合同拒绝。
    unit暂存中的空JSON measure不是oracle PASS；未调用模型、写库或创建E17正式Run。继续月度分群及其他未闭合能力。
  - [x] 分类行数入口收紧到原BAR的64行，合同与rank schema同界；两项64/65边界先RED，64行同时通过V3原schema。
    4文件69/69、Worker typecheck/build通过；不扩大图表预算、不丢行，历史证据不改。接续月度分群。
  - [x] 月度分群前复用既有描述性合同编码，保留原来源/applicability/独立oracle；clean23dcc9ad预先捕获5个合同hash，重构前后完全相同。
    8文件140/140、Worker typecheck/build及4文件Biome通过；没有新增方法权限、业务算术或生产写入。
- [ ] 所需能力离线闭合后最终clean build/full unit/fresh scratch，再fresh E17正式15回合从L1。当前ACTIVE，live E16 FAILED。

**2026-08-31 用户恢复四层后的接续切片**

- [x] `fd42ac59` clean worktree 接管；NAS SSH 可达，普通 PostgreSQL/Neo4j healthy，Falcon live 独立容器仍绑定 55433。
  本次只读检查未启动 Web/Worker/OpenSandbox 或写数据库；旧 core/C7 checkpoint 与 volume 保留。
- [x] 月度分群叶子：复用描述性合同编码和月度 schema，原月份/分类/measure 身份与 NULL 保留；≤32组/384行/16分面。
  恢复草稿先观察缺模块 RED；修正草稿误改冻结 fixture 后，30项新测试及旧方法/固定hash/编译回归共5文件93/93通过，Worker typecheck/build通过。
  仅叶子合同，无 production 注册、Oracle、模型调用或数据库写入；不能记为复杂业务 PASS。
- [x] 月度分群独立 source/Arrow Oracle 与唯一 production composition；37项 Oracle 回归（数值/排名/组/NULL/变化对/表图/字节/来源）、
  原端点及溢出边界通过。新生产选择5项/Oracle接线1项先RED后GREEN，单序列统计与原方法不变。
  摘要消费4项先RED，改新结果为受界JSON对象后GREEN，未改原始行隐藏或预算。Worker Analysis/Teams49文件578/578，
  focused10文件213/213、Worker typecheck/build和7文件Biome通过；仅离线验证，无模型Run/live写入。
- [ ] 核对复杂多输入及 L4 当前 Run 事实重验、指代、口径纠正、报告/图表组合；有缺口先做 focused 修复与 scoped commit。
  - [x] Report 输入契约补齐：r5 接收原 admission 的当前 Run QueryEvidence/AnalysisReport，可组合多份证据；
    Host 保留原分析章节/图引用，完成阶段重验全部来源与章节，不增加 Root 回合、路由或发布权限。
    先观察缺模块/旧Profile RED，后补输入/生产Tool/真实admission与完成校验；旧占位哈希夹具改为真实已提交引用。
    最终 Worker Analysis/Teams/dispatcher、admission和依赖边界54文件643/643，Worker typecheck/build、9文件Biome、
    Trellis validate/diff check通过；没有调用外部模型或写库，复杂四层业务仍待fresh scratch/正式15回合。
- [x] clean6b354a6e build8/8/full unit15/15及scratch原认证/Finalizer通过；真实L4A1出现planner协议失败，Semantic/Text2SQL已接受，
  Python尚未执行。保留FAILED Run，不继续后续题或UI；live348表before/after一致，当前临时服务/browser停用。
  已补安全结构诊断和producer→display回归，实际provider失败原因仍待新build证明，详见 [失败记录](research/complex-6b354a6e-planner-failure.md)。
- [x] 8a82aac1 fresh scratch再次L4A1，安全诊断真实闭合：两次planner在非空operator_obligations[0]发生schema custom拒绝；
  接受输入对应现有描述性月度方法required_operator_obligations=[]。提示改为完整复制Host声明、明确空数组，不改schema或预算。
  Run48a12b09-191d-8798-b767-00c3d0b383c6 FAILED保留，未进入Python/UI；live348表仍完全一致。
- [x] 1f53b91e fresh scratch L4A1真实Semantic→Text2SQL→Analysis SUCCEEDED，57 events/无错误；独立源值/同比/表图/结论及QA刷新通过。
  Trace却HTTP400：reader旧枚举不识别已由publisher发布的REQUEST_DERIVED，完整回合仍未PASS。新5项回归中2项先RED，
  改共享schema后GREEN；旧Run用真实READ capability只读重建73节点/73详情通过，仅修复诊断、不补算UI。
  live348表前后完全一致，临时服务/browser已停，见 [Trace缺口记录](research/complex-1f53b91e-trace-role.md)。
- [x] 3f876865 fresh scratch L4A1进入Python，两次Analysis均AttributeError且一次repair用尽，Run FAILED/72events；
  原始错误未保留，不声称具体原因已知。补固定accessor错误的安全反馈与逻辑DATE/dtype契约；4项RED→GREEN，
  NAS原image离线复现Arrow文本日期的`.dt`故障并验证显式转换不改值。live348表不变，未继续A2/UI，
  见 [Cell反馈记录](research/complex-3f876865-cell-feedback.md)。
- [x] 1ff782a6 fresh scratch L4A1 Run SUCCEEDED/57events，1次Python/零repair；12月独立源Oracle通过。
  业务复核发现解释两次把单边NULL写成两端缺失，故独立business FAIL，未继续A2/UI；原成功Run与报告未覆盖。
  FINAL补当前objective与逐字段NULL/0说明，2项RED→GREEN；live348表不变、临时服务/转发/capability清理，
  见 [解释边界记录](research/complex-1ff782a6-narrative.md)。
- [x] 1d3f2ec1 fresh scratch A1业务数值/来源及同Run QA/Trace/刷新通过（保留editorial与formal profile差异警告）；
  A2 FAILED/55events，无SQL：Root理解到前题的收入同比，但Semantic只冻结当前客户类型，出现两次范围外选择。
  同Run冻结历史user intent接入、当前release重检索与多句有界候选预算修复中；不扩大总80节点或绕过选择校验。
  无模型离线重放已恢复月份/收入/客户与join，见 [多轮断点](research/complex-1d3f2ec1-conversation-intent.md)。
- [x] 10816最终稿NAS clean/populated、347业务表不变与rollback安全验证通过，附加intent/query hash由commit RPC重算；
  Contracts10、Semantic185、Worker629、Platform8、migration12项及4包typecheck通过。live未迁移，测试资源停机保留。
- [ ] 新clean build/scratch验证完整L4A/B及后续正式15回合，
  816d6a0e新scratch A1独立业务与QA/Trace73节点通过；A2首Root调用协议失败/5events，未进入Semantic。
  frozen历史3条存在，但不能记为检索修复的端到端证明。已补raw-free adapter阶段诊断，不放宽schema或重试；
  live348表不变，临时服务/browser/auth/capability清理、scratch停机保留，见 [协议断点](research/complex-816d6a0e-root-protocol.md)。
- [x] 201ef834新scratch A1业务及QA/Trace76节点通过；A2检索历史绑定已真实通过，但接受的SemanticContext遗失12月窗口，
  Text2SQL无accepted evidence且Run FAILED。补齐Semantic Specialist的原冻结Task用户意图投影与请求hash绑定；
  不复制旧答案、不扩大历史窗口或重试。分组同比AST能力仍需单独闭合后才启动下一新构建。
  live348表不变，本轮临时资源精确清理、scratch停机保留；详见 [A2窗口断点](research/complex-201ef834-semantic-window.md)。
- [x] 分类同比沿原proof/resolver接入一个已选atomic文本维度和可选认证非fanout LEFT JOIN；保留来源键、NULL与原修复预算。
  compiler/coverage、QueryEvidence/source绑定、SQL反例及独立NAS合成PostgreSQL预期通过；正式多层仍未通过。
  见 [分类同比证明](research/grouped-yoy-proof.md)，下一步新clean build/fresh scratch验证A/B复杂多轮。
- [x] 50bd7f1e新scratch A1业务及QA/Trace76节点通过；A2 Run SUCCEEDED但独立business FAIL：Root跳过本Run Semantic，
  多别名Metric绕过比较证明并读到覆盖外同期，Analysis把个别组环比误称总体同比。保留原失败，未提交A3/B。
  原resolver补无比较解释的重复Metric输出拒绝，Root澄清历史assistant不是本轮Tool Result；先RED后验证，不加路由/重试。
  live348表不变，临时服务/凭据清理、scratch停机保留；见 [A2比较边界](research/complex-50bd7f1e-comparison-boundary.md)。
- [ ] 补齐结构化同比分群事实/总体完整性证明与摘要口径，再新构建继续A/B；不能用模型叙述补算或把单组变化称为总体变化。
  - [x] 查询端完整性：原有界证明扩展外层FULL、合并月/分类身份，保留仅同期组与NULL；普通SQL默认仍拒绝FULL。
    proof封存精确本期/同期输出与两期分类覆盖，进入原QueryEvidence/hash，旧无字段payload保持可读且不获完整性声明。
    两个合法RED→PASS、错误合并/补零/维度FULL等反例、元数据漂移及Worker原firewall接线验证；NAS无网络tmpfs合成执行
    证明确实保留PRIOR_ONLY=200且current=NULL，随后精确删除纯测试实例。未调用模型、未写Falcon authority。
    下游同比排名/贡献Oracle尚未完成；见 [完整分类比较](research/complete-period-group-proof.md)。
  - [x] 分析端完整性：原月度分群方法读取封存角色与BOTH范围，独立计算总体同比排名和分类增速贡献，
    不使用组均值/环比/旧Run答案；缺失、零/负基数及不足3月显式保留。结果对象进入原Publisher及FULL Oracle，摘要优先保留。
    手算与真实Arrow/生产Oracle接线、重封hash的错误总体/排名/贡献等拒绝，8文件204项与Worker typecheck通过。
    仅离线证明，尚未新模型业务验收；见 [同比事实闭合](research/complete-period-analysis-proof.md)。
  - [x] b7f2c2be新scratch A1 FAILED/74events，只有Semantic产物，未进入SQL执行/Analysis；3次Text2SQL任务各2候选均比较形态拒绝，
    最终Root预算耗尽。原候选只有hash，direct Specialist响应未持久化，不能据此断言具体SQL错误。
    原通用形态诊断拆为SELECT/CTE/期间JOIN检查点，6个新RED反例转PASS；Platform207、Worker101及Platform typecheck通过。
    live348表不变，Web/Worker/OpenSandbox/browser/auth和55490转发清理，scratch停机保留；临时capability删除。
    见 [形态断点与防复发](research/complex-b7f2c2be-structural-checkpoints.md)。下一步先补可证明的比较SQL骨架，非再次只为观察而跑模型。
  - [x] 比较SQL骨架：当前SemanticQueryContext经原发布/物理/AST证明后提供模型输入，结构字段固定而结果仍待真实查询；
    无分类/同表分类/认证关联分类采用同一语义编译，完整分类TABLE交给Analysis。保留原错误候选，不在失败后自动替换。
    Platform五文件297项、Worker三文件48项与两包typecheck通过，Trellis/diff/Biome通过；
    完成scoped commit后新clean build，不记作复杂题PASS。原失败SQL具体原因仍未知，没有用模板伪造历史修复证明。
  - [x] 3252b416新scratch A1的Semantic/Text2SQL和独立来源校验通过；Analysis阶段65events FAILED，
    原stage保留后发现38个日历字段偏早一月，数值一致。原Arrow UTC instant未按封存业务时区呈现是可复现边界缺陷。
    Host输入只投影原批准DATETIME维度时区，绑定身份/恢复/提示一致；DATE/NULL/数值/字节不变，Oracle不放宽。
    NAS同镜像无网络Python8项通过，focused128项与Worker typecheck通过；详见 [日历边界](research/complex-3252b416-calendar-boundary.md)。
    原失败Run不重放；源348表不变，本轮临时服务清理、scratch停机保留。新clean build继续A/B，尚未复杂题PASS。
  - [x] 47916676新scratch A1 Run SUCCEEDED/57events，Semantic/Text2SQL/Analysis接受，独立stage结果0差异；
    但摘要错称5月是唯一正增长（实际6/7月）及持续下降，因此业务FAIL，未做UI、未提交A2/B。
    原FINAL统一省略数组，现仅给已受验月度多结果合同保留完整12行聚合序列，预算不变，原Oracle不变；
    明确排名/日历和负同比/降幅变化区别，3项RED后144项focused与Worker typecheck通过。
    见 [摘要时间序列边界](research/complex-47916676-narrative-chronology.md)；源348表不变，临时服务清理、scratch停机保留。
    下一步仍为新clean build/fresh scratch业务A/B；不能据结构化结果通过把错误文字视为PASS。
  - [x] d9a91228新scratch A1业务及同Run QA/Trace通过（73节点/5产物，原stage独立算法0差异），仍非formal profile PASS。
    A2 FAILED/50events：冻结历史含12月意图，但已接受语义只有同比操作，缺窗口，Text2SQL prepare三次拒绝且零查询。
    现于已消歧DATA同比上下文commit前拒绝缺窗口并反馈Semantic/Root；不默认日期、不增预算、不改原SQL proof。
    缺窗口先RED，完整窗口/纯定义/歧义兼容；Worker134与Agent Runtime8项、两包typecheck通过。
    见 [同比窗口完整性](research/complex-d9a91228-comparison-window.md)；源348表不变，本轮临时服务清理，scratch停机保留。
    下一步新clean build/fresh scratch从A1开始，未提交A3/B或formal15，不拼接本次A1。
  - [x] a7438392新scratch A1 SUCCEEDED/57events、来源/原stage0差异，但摘要同时写7月+0.96%和下半年持续负，业务FAIL。
    没有A2/UI，不能声称新窗口校验已获真实证明；源348表不变，本轮临时服务清理，scratch停机保留。
    按用户允许降低重复失败题难度，月度/分组同比改用原Oracle后受验事实文本和当前请求literal响应约束，
    仍实际调用模型且拒绝不匹配文本；记录前/恢复时重验，不替换旧答案、不改值/表/图/SQL proof、原调用预算不变。
    37文件432项相关测试、Worker typecheck、Biome/Trellis/diff通过；不以单测代替下一真实Run。
    见 [事实摘要边界](research/complex-a7438392-factual-summary.md)；新clean build后从A1继续复杂链路，未签formal15 PASS。
  - [x] 40a04db9新scratch A1受限事实展示及同Run UI/Trace通过（73节点/5产物），原stage0差异。
    A2已具备同比+12月语义，48行分群来源和整体重组独立PASS，但计划SOURCE_AUTHORITY拒绝后，原Run内第二次Analysis又两次KeyError month_str，整轮FAILED。
    先修规划输入缺必需Metric/Dimension投影、缺时间维度误报来源无效；原数据权限/Oracle不变，不补齐候选。
    两项RED转PASS；Python准备错误仍待修。见 [计划权限边界](research/complex-40a04db9-plan-authority.md)。
    源348表不变，本轮临时服务精确关闭，scratch和volume保留；未提交A3/B或formal15，下一步继续修复而非重复失败Run。
  - [x] 原月度分群execution_contract新增无数据Python准备参考与显式原列/时间类型；模型实际Cell仍走原策略/执行/Publisher/Oracle。
    NAS原Agent镜像12种数据边界逐字段对原Oracle0差异，原operator镜像Cell策略通过，原输入不变，未调用模型/数据库。
    固定方法参考辅助执行不等同自由算法合成；见 [分群准备边界](research/complex-40a04db9-panel-preparation.md)。
  - a97bd856新scratch A1业务+同Run UI/Trace通过，A2在SQL窗口校验失败（0 QueryEvidence/0 Stage），
    Root将排名数误当取数窗口并向Semantic要求缩窗；已修正排名/窗口分责和定向SQL反馈，原校验不变。
    Root/repair两项RED→GREEN及合法操作顺序/缩窗拒绝回归；旧运行348表无漂移，服务关闭、卷与历史保留。
    尚未证明A2 Python参考/复杂A-B闭环，formal15仍未开始；见 [排名窗口复盘](research/complex-a97bd856-ranked-window.md)。
    下一步新clean build/fresh scratch从A1验证，不复用40a04db9 A1或失败A2。
  再继续上述 F5 / F7；不另跑 child 历史六问，也不复用 core4 PASS。
  - d9c3c7e3新scratch A1业务+73节点UI/Trace通过；A2运行SUCCEEDED，完整48行来源及Python结构化输出
    原算法0差异，但额外V2 SQL图丢category，48行重复12个x。整体业务FAIL，未验UI/提交A3。
    共用V2自动图现在对重复x返回null，原QueryEvidence和正确V3分群图不变，不改SQL/Oracle或模型预算。
    见 [自动图身份边界](research/complex-d9c3c7e3-group-chart.md)；旧scratch停机保留、源348表无漂移。
  - 70b520e8新scratch A1业务+73节点UI/Trace通过；A2完整48行/同比/分解/最差月份来源Oracle通过，
    额外V2图已不生成，但Root向Analysis多传SemanticQueryContext，在admission前失败，未创建Analysis/Stage。
    仅输入/输出Artifact类型校验新增checkpoint后的正常回合反馈，原四回合预算、目录/权限/Oracle不变。
    Worker61+AgentRuntime11聚焦测试及两包typecheck通过；旧Run不重放，源348表不变，临时服务关闭、卷保留。
    见 [Root类型反馈闭包](research/complex-70b520e8-root-type-feedback.md)；A2整体FAIL，formal15仍未开始。
  - 5d1cf6f0新scratch A1及A2均业务+同Run UI通过（分别73/76 Trace节点）；A2完整48行、分群Python输出
    原算法0差异、整体同比排名/贡献均通过来源核验。没有拼接旧构建PASS。
    A3首个Root调用为`AUTO_RESPONSE_INVALID_JSON`→OUTCOME_UNKNOWN，未执行Subagent；独立B1 Root把coverage
    当请求过滤，3个Text2SQL task各2候选失败。原失败保留，B2/B3未提交，formal15未开始。
    Root补齐coverage≠请求窗口规则，并在历史/观察之后重申原响应协议；不改SQL、权限、Provider失败处理或预算。
    95项聚焦测试与两包typecheck通过；源348表不变，服务/两浏览器关闭、scratch卷保留。
    见 [Root交接复盘](research/complex-5d1cf6f0-root-handoff.md)；后续需新clean build验证真实效果。
  - 8cc4d933新scratch A1来源12行/同比Oracle通过，但Operator沙箱NAS端口冲突，分析未执行便失败；
    后续Root仍为AUTO_RESPONSE_INVALID_JSON。原Run保留FAILED，A2/A3及独立B组未提交，formal15未开始。
    OpenSandbox同版本117源码文件迁至NAS同机控制面，强制占用端口探针及原双沙箱/算子/零残留探针通过，均无模型。
    源348表不变，旧本机服务/两浏览器关闭、scratch卷保留；不改模型预算、Oracle或production isolation HOLD。
    见 [NAS控制面复盘](research/complex-8cc4d933-sandbox-colocation.md)，后续从新clean build/fresh scratch继续。
  - 针对重复 Root AUTO 非JSON，真实固定 SDK 离线 wire 的6项先RED，现只对DeepSeek AUTO有工具请求开启json_object语法约束；
    native tool仍auto，原schema/失败/marker/一次调用/预算不变。Agent Runtime82+Worker46项、两包typecheck通过；
    见 [Root JSON传输复盘](research/complex-8cc4d933-root-json-transport.md)，不声称旧失败或新复杂题已通过。
  - e75cdbb9新scratch先B1：Root不再增加coverage过滤，但6次SQL候选为发布公式表达式不一致，0查询/整体FAIL。
    独立A1业务及同Run UI通过（75 Trace节点/5产物），NAS原双沙箱执行和Python结果0差异；A2完整48行来源Oracle通过，
    后续Root仍AUTO_RESPONSE_INVALID_JSON，未启动Analysis，整体FAIL。A3/B2/B3及formal15未提交。
    现仅补充私有协议形态/计数，不保存原文、不重放、不放宽校验；Agent Runtime58+Worker15项及两包typecheck/前者build通过。
    见 [协议观测复盘](research/complex-e75cdbb9-protocol-observation.md)。源348表不变，本轮服务/浏览器关闭、scratch停机保留；
    NAS无残留Analysis sandbox，控制面留用。继续处理发布公式交接和新构建真实验证，不据JSON mode宣称问题已解决。
  - 当前已请求的发布Formula增加原AST证明后的无数据表达式参考，复用相同Metric物理依赖与冻结上下文预算；
    不提供整条替代查询、不修改口径/绑定/Oracle、不增加模型调用。Platform223+Worker55项及两包typecheck/Platform build通过。
    见 [Formula参考复盘](research/complex-e75cdbb9-formula-reference.md)；真实新B1尚待验证，原e75失败不重放。
  - d36893ad新scratch B1/B2及独立A1业务+同Run UI通过（42/58/75 Trace节点）；B1首次候选匹配原发布CASE公式，
    B2 request-only净ROI正确，渠道三指标分轴图未压缩比率，A1 Python原算法0差异。
    B3 Root完整216字节空白/stop、A2已接受48行之后Root完整2048字节空白/length；均旧OUTCOME_UNKNOWN，
    保留原FAILED，不重放。A3/formal15未提交。首个认证失败与后续独立新stage认证/Finalizer PASS分别保留。
    live348表不变，本轮Web/Worker/两浏览器已关闭，scratch停机保留，55502转发已取消。
    现修复窄完整空响应的持久拒绝与下一正常Root回合反馈，原四回合预算、Oracle、安全/未知结果边界不变。
    见 [完整空响应复盘](research/complex-d36893ad-root-empty-response.md)；下一步新clean build/fresh scratch验证A/B，
    不拼接本轮或历史core4 PASS，也不声称正式15题已通过。

  - f6614a06新scratch A1/A2/B1/B2业务及同Run UI通过（73/72/92/79 Trace节点）；
    A3/B3各四次完整空白Root响应，known FAILED/checkpoint/单次调用边界正确，但无Subagent，整体FAIL。
    现仅分离历史显示答案与Root输出协议：agent/text逐条JSON观察包装，保留原内容/角色/来源/顺序/Task hash，
    不再充当assistant输出示例；原user及当前观察不改，新增字节计入原预算。93项focused、Worker typecheck、
    两条实际冻结Task离线hash/round-trip验证通过；模型空白因果仍待新构建实测。
    live348表不变，临时服务和浏览器关闭、55504转发取消、scratch卷保留；
    见 [历史显示边界复盘](research/complex-f6614a06-history-presentation.md)，formal15尚未开始。

  - 60a3236d新scratch A1/A2/B1/B2业务及同Run UI通过（73/76/61/45 Trace节点）；A3完整NON_JSON仍UNKNOWN，
    B3前三次Semantic Schema拒绝、第四次接受但无时间窗口且耗尽Root预算，无SQL/Analysis；两题FAILED、formal15未开始。
    现仅补完整非JSON纯文本的确定拒绝与原checkpoint反馈，真实Schema校验语法示例，不修复模型原文或重放UNKNOWN。
    live348表不变，本轮临时服务/浏览器关闭、55505取消、scratch停机保留。
    下一独立工作项版本化B3比较期间与渠道先筛选口径；先完成离线backlog，再新构建验证，不拼接旧PASS。
    见 [完整文本拒绝复盘](research/complex-60a3236d-complete-text-rejection.md)。

> 接续60a缺口的两月窗口支持：PRD §22.1 / design §28已明确新版B3，但旧V1题库与receipt不改。
> monthly panel前向到method@2，由已验收窗口识别2/12月；2月端点比较不冒充持续趋势，12月同比规则不变。
> DATE/DATETIME两项先RED，新增窗口/生产选择及旧面板、月度Oracle共179项通过，Worker typecheck/build通过。
> NAS原Agent Python3.12及operator Cell policy实际验证14种参考输入，独立Host Oracle逐字段0差异、原DataFrame不变，
> model_calls=0、authority_writes=0；审计`monthly-panel-two-month-reference-probe-959d130c.json`。
> 渠道先筛选/再拆人群仍是下一独立工作项，未开始新的模型运行，不声称B3或formal15 PASS。

> 前向两期分层实现：sealed比例映射→两轴父组原值汇总→父组筛选→保留全部子组；接入原planner/Python/FULL Oracle/FINAL。
> 173项focused、Worker typecheck/build通过；原NAS Python及operator policy22种输入逐字段0差异，含不满足父筛选的子组、
> 0/负/NULL、无入选组、别名/顺序与浮点；原DataFrame不变、模型0调用、authority0写入。
> 审计`monthly-panel-ratio-boundary-probe-557a7201.json`；新A/B业务与同Run UI未执行，不拼接60a PASS，formal15仍未开始。

> `209de7a4` fresh scratch 的 A1/A2/B1 已通过独立来源 Oracle 与同 Run QA/Trace；A3 的 Semantic/Text2SQL完成并保留
> 48行当前Run证据，但Analysis首次发布因表类型拒绝，一条修复Cell成功后Host仍允许继续Python，下一Cell及恢复重放超时，
> 最终保留`FALCON24_ANALYSIS_PUBLICATION_TERMINAL_HOLD`，未验UI且不重放。现将原单次Publisher修复预算收紧为
> 拒绝后只允许一条修复Cell、成功后只允许重新发布，并补表容器精确无数据反馈；不增加预算/timeout、不放宽Publisher/Oracle。
> 见 [A3发布修复复盘](research/complex-209de7a4-analysis-publish-repair.md)；修复提交后须新build/fresh scratch重验，
> 当前B2旧构建虽已终态但尚未业务/UI复核，B3未提交，complex preflight/formal15均未PASS。

> `72ae42df` fresh scratch 的 A1/A2 业务及同Run QA/Trace通过；A2真实触发表类型拒绝后，仅一条修复Cell和一次重新发布即成功，
> 证明发布修复状态机生效。A3的Semantic/Text2SQL/Analysis、48行来源、整体同比排名和stage结果均通过，但只发布一张单面板
> 分组折线图，未满足“保留整体趋势图并增加客户类型对比图”，独立业务复核冻结为
> `COMPLEX_A3_REQUIRED_TWO_CHARTS_MISSING`，不验UI、不改写原Run。现把原`period_comparison`的12月整体同比和最差月完整分组
> 确定性投影为两个顶层集合，合同要求原始表+两张派生表、恰好两张图；模型一次发布，FULL Oracle逐表逐图验证。
> 仍按封存比较角色/源形状选择，不按题目关键词，不增加调用/修复/权限预算；两期B3无该同比映射，保持原合同。
> 见 [A3双图合同复盘](research/complex-72ae42df-two-chart-contract.md)；修复提交后须新build/fresh scratch从A1重跑六题，
> 本构建A1/A2不能拼接，formal15仍未PASS。

**F6 READY 轮次恢复边界（2026-08-30，历史）**

> 以下为历史记录；当前 forward recovery 已到 E16 FAILED，下一 fresh epoch 为 E17，见上一节。

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

## 26. 核心协作执行（当前入口）

### C0 — 固定范围与保留草稿

- [x] 依据用户新指示固定 `research/core-collaboration-v1.json` 四题；同步 PRD §21、design §26，不更改旧 FL1 合同。
- [x] 两份自有月度分群 RED 草稿移到 `research/deferred-monthly-panel/*.ts.txt`；未实现模块不再纳入当前测试发现。
- [x] JSON 四题唯一性/顺序、两个协作场景、一次提交/非正式边界、草稿退出测试发现与 Trellis/diff 检查通过；docs-only scoped commit。

### C1 — 新构建与隔离预检

- [x] 审计当前 live E16 与已保留 scratch；新 clean force build/full unit/attestation，不复用 cc9 的 PASS。
- [x] 新建显式 NAS scratch 物理克隆，验证 source dataset/发布身份/受保护历史；原认证及 Finalizer 仅作用 scratch。
- [x] 启动 attested Web/Worker 与必要依赖；保持 OrbStack 关闭，不连接普通 NAS data_agent 作为 Falcon authority。

预检记录：`fa03e0ed` force build 8/8 通过，full unit 在 DeepSeek Strict 的可选facet投影处失败，未创建/激活新scratch、未调用模型。
补充真实model与authority两个schema分支测试，先观察3个RED；改为closed/all-required object union后Agent Runtime 15/15、Contracts 11/11、
Worker 84/84，以及Contracts/Agent Runtime/Worker typecheck、Contracts build通过。投影器与原payload/版本/refinement不放宽；新构建重新验证。
只读live审计捕获348张表：既有347张加单独统计的`platform.migration_ledger`，没有缺表；live仍E16。

### C2 — 四题单链路证明

- [x] 依次执行 C1 语义口径、C2 最近订单、C3 发布 ROAS、C4 显式净 ROI；每题一次 composer，不重新提交已存在 Run。
- [x] 先真实独立业务 oracle，再同 Run QA/Trace/Artifact/Agent/SQL 页与刷新；表格必须，图表非必需但显示后须验证。
- [x] 内部失败保留 exact 证据、定位最小缺陷；修复后 focused validation/scoped commit，再新 clean 构建证明，不拼 PASS。

### C3 — 核心交付与清理

- [x] 汇总四题同构建/同 baseline 证据及使用量；明确 `CORE_COLLABORATION_VERIFIED` 不等于旧 FL1 PASSED。
- [x] 比较 live authority 与历史，清理本次临时服务/browser/credential；保留旧失败克隆/backup/audit。
- [x] 更新本节与核心报告、验证/scoped commit，交付核心协作结果；原 E17 live 激活、完整四层和 production isolation 单独列状态。

闭合记录：clean `ec3c1e61` force build 8/8（0 cache）、full unit 15/15 task（6 cache）、attestation PASS；
新 NAS scratch 55476 与 live 克隆前348表一致，9表/70列/121445行来源完整，原认证/Finalizer仅激活scratch。
四题同baseline真实composer各一次，业务/QA/Trace/刷新4/4，节点21/27/45/42全部打开；两道渠道题同Run语义到SQL证据闭合。
ROAS同Run一次候选修复保留；只读harness的SQL直接引用误判单独纠正，同一Run重验，无模型重跑，原失败及旧结果元数据差异明确记录。
live348表after与before完全相同；本轮Web/Worker/OpenSandbox及4个browser/auth清理，专用scratch停机保留checkpoint，55476转发取消，
本轮capability文件删除。普通NAS数据库healthy，OrbStack关闭，旧资源未批量清理。
7条已报告usage合计105601 tokens、6条未报告，完整总量未知；恢复认证不计入该小计。
完整ID/hash/失败/清理见 [核心验收报告](research/core-collaboration-verification-ec3c1e61.md)。当前核心范围完成；不继续扩建延期复杂能力或启动live正式题库。

## 27. 复杂四层当前执行（82aed231 前向恢复）

- [x] `966760f5` clean build/fresh physical scratch 中 A1/A2/A3/B1/B2 完成独立 Oracle、业务、QA/Trace 与刷新验证；A3 新双图合同真实通过。
- [x] 原 B3 单次 Run 保留 FAILED：四个 Semantic logical call 均 `STRUCTURED_OUTPUT_REJECTED`，零业务 Artifact；未重提同一 Run。
- [x] 独立显式定义诊断把净 ROI、两完整月、父渠道先筛选、子人群全保留和非因果建议写全，仍四次同形失败；确认不是题面歧义。
- [x] TDD 增加 server-owned response schema delivery mode 与 DeepSeek 零工具 JSON text 路径；完整原文仍经原 strict schema，失败不修补。
- [x] 完成 Agent Runtime/Worker focused、typecheck/build、Biome、Trellis/diff，更新规范与研究记录并随本小任务 scoped commit 封存。
- [x] `b4a237db` clean force build 8/8（0 cache）、full unit 15/15、attestation PASS；fresh NAS scratch 55509 完成物理备份验证、
  10816 与347业务表无漂移证明、数据集三 hash、一次 LLM certification和 E17 scratch-only activation，live仍E16。
- [x] `b4a237db` A1 新 Run `cf11f7e9-6bdd-81f3-b93c-f3b6c70d3040` 不可变 FAILED：四次 Semantic 都由空白前进到
  `RESPONSE_SCHEMA_MISMATCH`，零 Semantic/SQL/Analysis Artifact；没有重提，也没有继续拼 A2-B3。
- [x] TDD锁定 registry canonical JSON Schema bytes 与 JSON_TEXT exact system instruction；仍一次 `json_object`、零 tools、完整原文 strict
  parse，无 coercion/default/repair。focused 51 tests先RED 6项，再GREEN 51/51。
- [x] 完成本轮 Agent Runtime/Worker回归、typecheck/build、Biome、Trellis/diff并随 scoped commit封存 `b4a237db` failure evidence。
- [x] `82aed231` clean force build 8/8（0 cache）、full unit 15/15、attestation PASS；fresh NAS scratch 55510 完成物理备份、
  10816/347业务表/9表70列121445行数据集证明、独立新stage认证及E17 scratch-only activation，live仍E16。
- [x] 同一 build/scratch 的 A1/A2/A3/B1/B2 依次完成一次composer、独立来源/阶段/业务复核和同 Run QA/Trace；Trace分别
  73/76/76/86/73节点全开，A3双图、B1发布ROAS、B2请求级净ROI均真实通过，不拼旧build。
- [x] B3唯一 Run `aa8c1da4-00ae-8fc8-9007-57cf3e7ec0c4` 永久FAILED：四次 Semantic均
  `RESPONSE_SCHEMA_MISMATCH`，诊断为一个 set-like ID 字段的第2项 custom refinement；零Semantic/SQL/Analysis Artifact，未重提。
- [x] 聚焦TDD先RED 1/17，再把 canonical ID order 明确定义为完整ID字符串升序、非题目/角色/重要性顺序；Host strict parse、
  原数组和失败关闭不变。见 [B3 canonical selection order](research/complex-82aed231-semantic-id-order.md)。
- [x] `94c10171` clean force build 8/8（0 cache）、full unit 15/15、attestation PASS；fresh NAS scratch 55511完成物理克隆、
  10816/347业务表/9表70列121445行证明、独立stage认证与E17 scratch-only activation，live仍E16。
- [x] `94c10171` A1唯一Run `818af266-7161-877d-8801-725d3ff609bc` 的Semantic/Text2SQL/QueryEvidence成功；本机Worker错用
  DIRECT而不能访问NAS临时Sandbox endpoint，两次Analysis side effect超时后FAILED。SERVER_PROXY简化探针及正式双沙箱/Cell/Operator/
  receipt probe均PASS，管理API与NAS Docker residual=0；旧Run不重提。见 [NAS代理复盘](research/complex-94c10171-opensandbox-proxy.md)。
- [x] `a43cc9f2` clean force build 8/8（0 cache）、full unit 15/15、attestation PASS；fresh NAS scratch 55512完成10816、
  347业务表、9表70列121445行、独立认证与E17 scratch-only activation；SERVER_PROXY真实投入业务运行，live仍E16且前后348表一致。
- [x] 同一build/scratch的A1/A2/A3/B1/B2依次完成真实Semantic/Text2SQL/Analysis、独立来源/阶段/业务复核与同Run QA/Trace；B3唯一Run
  `ff20e734-2ad0-8166-94de-07af61678358` 四次Semantic均在set-like ID数组第2项custom refinement失败，零业务Artifact且未重提。
- [x] provider-only canonicalization聚焦TDD先RED：乱序集合在final strict schema拒绝；实现后只排序已验证且唯一的ID/ambiguity集合，
  复用全部跨字段约束并再次由final strict schema验证。Worker registry已绑定该schema，prompt不再要求模型承担无语义排序；成员/操作/公式
  不修补。见 [B3集合序列化复盘](research/complex-a43cc9f2-semantic-set-canonicalization.md)。
- [ ] 新 scoped commit 后重新 clean force build/fresh scratch，以 SERVER_PROXY 从A1重跑六题；不拼接 `82aed231` 前五题或
  `94c10171` Semantic/Text2SQL前缀，B3业务通过后复用同 Run验 QA/Trace。
- [ ] 六题预检闭合后继续 F5/F7 版本化15回合、authority、页面与最终清理；只有全部 AC 才 COMPLETE。

当前细节见 [Semantic JSON text 复盘](research/complex-966760f5-semantic-json-text.md)。
`b4a237db` 进展与下一闭包见 [Semantic canonical schema instruction 复盘](research/complex-b4a237db-semantic-schema-instruction.md)。

修复验证：TDD RED 先证明原 Mastra Structured Output 仍被使用；GREEN 后 Agent Runtime unit 193、integration 46、security 67、
contract 32 与 focused 51 tests PASS，Worker official unit 101 与 focused 114 tests PASS；两个 package typecheck/build、6 个 owned code/test
Biome、`git diff --check` 和 Trellis validate PASS。Worker provider 目录的非官方 broad run另暴露两个既存旧断言，它们期望历史 assistant
消息直入 prompt，与当前未改动的 untrusted observation 安全合同冲突；本修复未掩盖或纳入该无关旧测试。

canonical schema instruction修复验证：Agent Runtime unit 193、integration 46、security 67、contract 32、focused 51 tests，Worker official
unit 101与受影响 focused 116 tests全部PASS；两个 package typecheck/build、4个owned code/test Biome、diff与Trellis validate PASS。
`b4a237db` live before/after 348表完全一致；旧Web/Worker/browser/auth精确关闭，scratch容器停机且volume作为失败checkpoint保留。

NAS endpoint mode修复验证：新增静态合同先RED后GREEN；修改后的正式SERVER_PROXY runtime probe真实完成双沙箱、Cell policy、
stateful symbols、Operator registry/result、单回执closure和session close，管理API与NAS Docker residual均为0。owned TypeScript Biome、
focused test、diff与Trellis validate PASS；`94c10171` live before/after 348表一致且仍E16，旧Web/Worker/browser/SSH转发精确关闭，
scratch容器停机、volume保留。既有同文件8-operator宽测试因当前manifest已有12项仍独立失败，未借本修复改写无关历史断言。

Semantic set canonicalization修复验证：Contracts semantic suite 31、Worker dispatcher/production tools 107、Agent Runtime JSON transport 51项
全部PASS，三包typecheck/build、4个owned TypeScript Biome、diff与Trellis validate通过；工作区unit gate以既有单并发模式15/15任务通过。
默认并发的首次宽跑因CPU争用出现多包计时型超时，单并发同测试无失败；未据此放宽timeout或修改无关测试。组件通过仍不计B3业务PASS。

`abb1e38c` 新构建/scratch 的 A1/A2/A3 已在同一会话中完成独立业务、QA/Trace与刷新；B1唯一Run
`1b7b5940-38be-839a-9ed7-fc50eb64de56` 保留FAILED。Semantic/Text2SQL及四渠道数值正确，Analysis仅把两个`highest`数组的正确成员
以错误顺序发布，FULL Oracle按原行独立重算后拒绝，未重提。前向修复为分类方法增加无数据Python准备参考，不放宽Oracle、不修补输出、
不增加预算；focused 55、Worker typecheck/build、Biome/diff及bundled Python实算通过。见
[B1 分类排名复盘](research/complex-abb1e38c-category-ranking-reference.md)。提交后重新clean build/fresh scratch，从A1重跑六题。

`d6484404` 新构建/scratch 的 A1/A2/A3/B1/B2 已完成独立来源、阶段、业务及同 Run QA/Trace；B2 真实走过 Semantic、Text2SQL、
NAS OpenSandbox Analysis 与新分类准备参考。B3 唯一 Run `fdd08691-e2b0-805c-8fec-8b6030add4e0` 四次 Semantic strict schema 拒绝后
FAILED，零 Semantic/SQL/Analysis Artifact，未重提。冻结检索证明无限定“收入”命中订单收入、营销事实日期维度被裁剪。
前向修复已以 RED→GREEN 聚焦测试锁定营销收入/订单收入词典拆分、营销月份维度别名及多 operation membership 自检；Host schema、成员、
预算和 Oracle 不放宽。见 [d6484404 Semantic 术语闭包复盘](research/complex-d6484404-semantic-term-closure.md)。完成 scoped commit 后必须
重新 clean build/fresh scratch，从 A1 重跑六题，不拼接本轮五个 PASS。
组件验证：change-set/provider 聚焦 22/22、Worker official unit 101/101、Worker typecheck/build、5 个 owned TypeScript Biome、
Trellis task validate 与 `git diff --check` 均通过；这些仍不是新 B3 业务 PASS。

`05944523` clean build/full unit/fresh E17 scratch 后的 active projection 回读发现：E17 Finalizer 正确走 retained-semantic 分支，generation 2
仍保留旧 aliases；源码 catalog 新别名没有发布。因而暂停模型门禁，不把 activation ACTIVE 冒充术语发布。按用户允许降低题目歧义的边界，
B3 改为直接引用 generation 2 的“营销归因收入”与 `blinkit_marketing_performance date`。零模型、只读重编译已同时选中渠道、目标人群、
营销投入、营销归因收入和营销事实时间维度；provider call=0、authority write=0。见
[active release readback](research/complex-05944523-active-release-readback.md)。下一步仍须在同一 build/fresh scratch 从 A1 重跑六题，
不能把该检索 probe 或 `d6484404` 五个 PASS 拼入业务结果。

`f55990b0a2` 同一build/scratch的A1/A2/A3完成独立source/stage/business与同Run QA/Trace（73/76/81节点）；B1唯一Run
`21da02cb-8b29-8648-aa6a-95fbe56a6cb3` 在Semantic/Text2SQL正确产出4渠道结果后，因三个结果列均为FORMULA而触发
`CATEGORY_COMPARISON_AUTHORITY_INVALID`，未进入Analysis且未重提。前向实现从accepted Formula canonical ID/精确物理依赖收敛原Published
Metric capability，裁剪无关订单收入；三类planner消费编译后的精确Context但保留FORMULA角色。聚焦117/117先GREEN；完成官方验证与
scoped commit后必须新clean build/fresh scratch从A1重跑六题，本轮A组三个PASS不计入新epoch。

`362c7e96` 新构建/scratch 的 A1/A2 分别以Run `95a12be2-4dea-8384-a48f-815f4f17f057`、
`9efeb574-8589-86ca-8a2a-d41bd0d16e48` 完成独立业务与同Run QA/Trace。A3唯一Run
`79a82d53-432a-8475-ad1c-64a9cdd89449` 保留FAILED：首个Analysis Program时间窗拒绝后，Root在原预算内正常委派第二个受验双节点Program；
第一个节点完成，第二节点FULL Oracle后FINAL响应以顶层`invalid_type`触发`RESPONSE_SCHEMA_MISMATCH`，随后Root预算耗尽。没有提交原子
Analysis Artifact，失败Run未重提；live before/after 348表一致且仍E16，临时Web/Worker/browser/SSH转发已关闭。

聚焦测试先RED证明带literal的request-isolated registry仍是Structured Output，再仅为合法内部`final_summary_constraint`固定JSON_TEXT；
不同literal继续改变task hash且schema互不污染，无约束FINAL仍为Structured Output，非法TOOL/空白/超长约束零Provider调用拒绝。
本项不增加模型重试或Host替换。Worker聚焦26、受影响dispatcher/Analysis 72、官方unit 101与Agent Runtime JSON transport 51项全部PASS；
两个包typecheck/build、owned Biome、Trellis validate及diff check通过。scoped commit后必须用新clean build/fresh物理scratch从A1重跑六题；
本轮A1/A2不计入新epoch。

`ce2a488d` clean build/full unit/fresh E17 scratch 的 A1 Run `605a3f62-4ee1-8a45-98a6-31e55d179053` 保留 FAILED：
Semantic 与 Text2SQL 已提交 SemanticQueryContext、SqlArtifact、12行 QueryEvidence 和折线图；Root 后两回合均正确选择 Analysis，
但都额外携带 Analysis 不接受的 SemanticQueryContext，Catalog 在 admission 前拒绝并耗尽四回合。没有 Analysis Artifact，旧 Run 未重提。

- [x] 只用 protected response 的结构字段、tool/profile/ref 类型和 checkpoint reason code 定位失败；未公开模型原文或工具 objective。
- [x] TDD先RED证明混合有效/冗余输入仍被整体拒绝；GREEN 后 Harness 只在至少保留一个受支持 exact ref 时删除冗余不支持 ref，
  全无效输入仍以原错误拒绝，Provider原参数对象不变。
- [x] Agent Runtime unit 193、integration 46、security 67、contract 32，Worker Root/dispatcher/team focused 168、official unit 101，
  workspace 单并发 unit gate 15/15 全部通过；两个包 typecheck/build、owned Biome、Trellis validate 与 diff check 通过。
- [x] 创建 scoped commit。
- [ ] 停止当前 Web/Worker/浏览器和旧 scratch，核对 live E16 零漂移；新 clean force build/fresh物理scratch从A1重跑六题，不拼接 ce2a488d 的
  Semantic/Text2SQL 前缀。六题闭合后继续 F5/F7 15回合、同Run QA/Trace、authority 与最终清理。

`5d7a80dd` clean force build 8/8、workspace unit 15/15、fresh物理scratch 55520、数据集/认证/E17 scratch-only activation 与
SERVER_PROXY 无模型探针闭合。A1 Run `3a1e6807-169f-8877-82f5-b85feebe3a66`、A2 Run
`6d06e45d-aeea-83d0-9f64-284588482f50` 均完成 Semantic→Text2SQL→Analysis、独立 source/stage/business Oracle 和同 Run
QA/Trace（73/80 节点），证明 Root 输入收窄有效。

A3 Run `e5c84cff-6291-85ce-969e-27bc9b1057e5` 保留 FAILED：Semantic/Text2SQL 重新提交正确 48 行证据；第一次 Analysis 在默认
60 秒 Side Effect deadline 以 `RUN_SIDE_EFFECT_TIMEOUT` 返回 FAILED observation，第二次正常委派以
`GOVERNED_ANALYSIS_ORCHESTRATION_FAILED` 结束，最终 Root budget exhausted。数据库中可观察到未被 child acceptance 接受的 Analysis/图表，
但 Root observation 没有 output_ref，答案为空，未计 PASS、未重提。

- [x] TDD先RED证明 daemon 默认仍为 60 秒；默认与 programmatic runner fallback 调整为 180 秒后GREEN，并锁定显式90秒覆盖仍生效。
- [x] Worker daemon/runner focused 47、official unit 101 全部 PASS；Worker typecheck/build、3 个 owned TypeScript Biome、
  Trellis task validate 与 `git diff --check` 通过。显式 90 秒 override 仍生效，未增加 Root 回合、模型预算或业务 Oracle 难度。
- [x] 创建 scoped commit。
- [ ] 审计并关闭 `5d7a80dd` 现场；新 clean build/fresh物理scratch从A1重跑六题，不拼 A1/A2。

`4b26b01e` clean build/full unit/fresh E17 scratch 的 A1/A2/A3 已连续通过独立 source/stage/business 与同 Run QA/Trace，
节点数分别为 73/76/76；A3 单次 Analysis 已正常返回 accepted output，证明 180 秒 Side Effect 前向修复有效。

B1 唯一 Run `cf4a62f5-046c-8641-91a1-2d4392fb7d5f` 保留 FAILED：前两次 Semantic catalog tool 失败，第三次接受
SemanticQueryContext，第四回合 Text2SQL 提交正确 SqlArtifact、4 行 QueryEvidence 和渠道图但声明 `CONTINUATION_INPUT`，随后 Root
budget exhausted、答案为空。独立源数据 Oracle 对 App/Email/SMS/Social Media 的投入、营销归因收入和 ROAS 全部 PASS；这些正确前缀不计题目 PASS。
live before/after 348 表一致且仍 E16，Web/Worker/browser/55521 已关闭，scratch volume 保留，Sandbox residual=0。

- [x] 仅读取 ProviderResponse 的 native tool/profile/ref 类型、hash、公开 team task 状态与 reason code；未公开模型 objective/原文。
- [x] 按用户授权将下一版非计分 B 组预检收敛为已发布术语/公式 + Semantic→Text2SQL 事实表/图，不要求额外 Analysis、原因或建议；
  A 组三题和正式15回合门禁不变，来源/公式/Oracle/UI/authority标准不降。
- [x] Trellis task validate 与 `git diff --check` 通过，创建 scoped docs commit；随后新 clean build/fresh物理scratch从A1重跑六题，
  不拼本轮 A1/A2/A3。

`03a5a2be` clean build/full unit/fresh E17 scratch 已在同一 frozen build 连续完成 A1/A2/A3/B1/B2 的独立业务、QA/Trace 与刷新。
B1 真实证明已发布营销 ROAS 的 Semantic→Text2SQL 协作；B2 真实证明请求级净 ROI 的 `REQUEST_ONLY/NONE` 解释、当前 Run 重算、
无 ROAS 结果列复用及四渠道精确源表 Oracle。B3 唯一 Run `2855437c-4431-8646-8e47-f5e89d0fc174` 在 Root 首次调用即收到
DeepSeek 402，5 events、0 Specialist、0 Artifact，保留 immutable FAILED 且未重提。官方无模型余额探针返回
`is_available=false`，故当前进入非终态 `ACTIVE/WAITING_EXTERNAL`，不是门禁 PASS 或任务终止。见
[03a5a2be Provider 等待 checkpoint](research/complex-03a5a2be-provider-wait-checkpoint.md)。

- [x] live before/after 348 表 fingerprint 完全一致且仍 E16；Web/Worker、浏览器/auth、55523 与 scratch container 已关闭，
  volume 作为 checkpoint 保留，普通 NAS 数据库 healthy，OrbStack 未启动，Sandbox residual=0。
- [x] 独立 backlog、失败分类、恢复边界和唯一恢复步骤已固化；等待期间不创建 Run、不调用模型、不写 gate/authority。
- [ ] 按 `5m -> 15m -> 30m` 无模型探针复查；首次 `is_available=true` 后从新 clean build/fresh physical scratch 的 A1 重跑六题，
  不拼本轮五个 PASS；六题闭合后继续 F5/F7 15 回合正式门禁。

充值后官方余额探针恢复可用；`a58533a4` clean build/full unit/fresh E17 scratch已重新启动六题。A1 Run
`81fb7414-52d1-86df-9f0f-42caa7c7d594`完成Semantic→Text2SQL→Analysis、业务Oracle和同Run QA/Trace。
A2 Run `89e2cd42-d58f-88bf-acdb-09ab13246368`保留FAILED：Semantic/Text2SQL/48行证据与首个Analysis节点FULL Oracle均正确，
第二个关键`MATERIAL_CHANGE`节点与首节点执行身份完全相同，因`material_change=false`未激活后被旧Executor归为dependency failure，
原子stage在Explanation后终态HOLD且未提交authority。

- [x] PostgreSQL只读结构审计排除余额、stage TTL、Sandbox、Publisher、Oracle、Explanation和Root预算；旧Run/stage不重提、不提交。
- [x] compiler聚焦TDD先RED 1/11，再仅折叠精确重复的直接条件叶；不同method与有后继的重复节点保持原DAG，12/12 GREEN。
- [x] 受影响Analysis回归49/49、Worker official unit 101/101、typecheck/build、owned Biome、workspace单并发unit gate
  15/15（14 cache）、Trellis validate与diff check通过。
- [x] 创建scoped commit。
- [ ] 审计并关闭`a58533a4`现场，核对live E16零漂移；新clean build/fresh physical scratch从A1重跑六题，不拼本轮A1或A2前缀。
- [ ] 六题闭合后继续F5/F7版本化15回合、同Run QA/Trace、authority、浏览器页面和最终清理。

`2217ff9c` clean build/fresh E17 scratch 已在同一 frozen epoch 连续完成 A1/A2/A3/B1/B2 的业务、QA/Trace 与刷新。
B3 唯一 Run `54be4db1-e8b2-8485-a1e3-6333d3607f36` 接受当前 Run SemanticQueryContext 后，三个 Text2SQL task 的六个候选
依次在 `QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID`、`TEXT2SQL_RATIO_QUERY_SHAPE_REJECTED`、
`TEXT2SQL_RATIO_GROUP_REJECTED` 与 `TEXT2SQL_REQUEST_TIME_WINDOW_MISMATCH` 失败关闭；无 SqlArtifact/QueryEvidence，最终
`ROOT_AGENT_TURN_BUDGET_EXHAUSTED`。原 Run 未重提，旧五题不拼接。

- [x] 只读结构诊断确认 active Semantic、物理 binding、双月 window 与请求级净 ROI 已完整进入 Context；问题是题面诱导 SQL 内先筛，
  与 aggregate-ratio 只接受完整直聚合面板的证明子集冲突，不是余额、发布权威、数据库或权限故障。
- [x] 按用户授权将非计分 B3 前向版本化为 `complex-l4-semantic-defined@4.1.0`：保留双月、渠道、目标人群和净 ROI，明确
  Text2SQL 先返回完整 `month × channel × audience` 面板，Root 再基于当前 Run 事实做渠道层筛选；不放宽 proof 或增加预算。
- [x] Trellis validate、diff check 通过；本项由 scoped docs commit 完成。随后审计/关闭 `2217ff9c` 现场，证明 live E16 零漂移。
- [ ] 新 clean build/fresh physical scratch 从 A1 连续重跑六题；B3 同 Run完整面板、source/business Oracle、答案、QA/Trace 通过后，
  才进入 F5/F7 正式15回合。

`2217ff9c` 现场现已关闭：live after audit 的348张表fingerprint与before逐表一致，authority仍为E16；Worker停机前为exact build且IDLE。
本轮两个browser/auth、Web/Worker、55525 forward与scratch container已关闭，volume保留checkpoint；NAS普通PostgreSQL/Neo4j healthy，
OrbStack仍为0。审计与清理receipt分别为 `complex-2217ff9c-after.json` 和 `complex-2217ff9c-runtime-cleanup.json`。

- [x] `2217ff9c` frozen epoch 安全收口完成，无 live authority 写入或临时运行残留。

`f02d610a` clean build/full unit/fresh E17 scratch 已执行 `4.1.0` 六题前缀。A1、B1、B2 分别完成独立 source/business Oracle、
同 Run QA/Trace 与刷新。A2 Run `32110f83-ac3a-8594-b38e-014537158d9e` 虽 SUCCEEDED 且 48 行事实、整体重组和最差三个月
Oracle 正确，但只走 Semantic/Text2SQL，缺 Analysis Stage、Report 与两张图，故本题 gate FAIL，不提交 A3。

B3 Run `807a1d26-29c5-888e-98ce-627283a72780` 已真实走 Semantic/Text2SQL/Analysis；32 行完整面板、独立源 Oracle、stage result
零差异，渠道主筛选唯一为 `SMS`，四类目标人群均保留。答案同时输出目标人群轴空筛选与明确标注的待验证假设/下一步，和 `4.1.0`
“不做原因或建议”文案冲突，因此当前题面仍不签 business/UI PASS。

- [x] 只读独立复算确认 B3 QueryEvidence、Analysis 输入、受验 Stage 输出和 selected axes 零差异；不是 Semantic/Text2SQL、公式或数据故障。
- [x] 将前向非计分 profile 版本化为 `complex-l4-semantic-defined@4.2.0`：A2/B3 显式要求 Analysis 交接；B3 允许清晰标注的待验证假设，
  仍禁止因果与持续趋势断言。其余四题、proof、Oracle、预算和 UI 标准不变。
- [x] Trellis validate、diff check 与 scoped docs commit。
- [x] 审计并关闭 `f02d610a` 现场，核对 live E16 零漂移；新 clean build/fresh physical scratch 从 A1 重跑六题，不拼本轮结果。
- [ ] 六题闭合后继续 F5/F7 版本化 15 回合、同 Run QA/Trace、authority、浏览器页面与最终清理。

`f02d610a` live after audit 对 348 张表的 fingerprint 与 before 逐表一致，authority 仍为 E16；Worker 停机前 exact build 且最后周期 IDLE。
本轮两个 browser/auth、Web/Worker、55526 forward 与 scratch container 已关闭，volume 只作停止 checkpoint 保留；NAS 普通数据库 healthy，
OrbStack 仍为 0。receipt 为 `complex-f02d610a-after.json` 与 `complex-f02d610a-runtime-cleanup.json`。

`a7d34c53` clean build/full unit/fresh E17 scratch 的 A1/A2/A3/B1/B2 已连续完成独立 source/stage/business Oracle 与同 Run QA/Trace；
Trace 节点分别为 73/76/80/73/73。A2 按 `4.2.0` 真实走 Semantic/Text2SQL/Analysis、48 行完整面板和两张必需图，修复目标已获运行证明。

B3 唯一 Run `978479c0-63e6-805f-9537-86766d5be830` 首次 Semantic 为 stream protocol violation，随后三次均因选择冻结闭包外对象失败；
零 Artifact，终态 FAILED，未做业务/UI 验收。intent/retrieval hash 正确，但当前冻结 selection 漏掉营销日期列和营销日期维度；对照成功
`f02d610a`，原因是 `4.2.0` 将精确公开维度名缩写为泛称。

- [x] 只读 safe event、ProviderTask intent receipt 与上一成功 B3 selection 对照，确认不是余额、数据库、发布权威或 Semantic 防火墙缺陷。
- [x] 前向版本化 `complex-l4-semantic-defined@4.3.0`：只恢复公开维度名“blinkit_marketing_performance date”，保留 `4.2.0` 的
  Analysis 交接、完整面板、描述性假设边界和全部 proof。
- [x] Trellis validate、diff check 与 scoped docs commit。
- [x] 审计并关闭 `a7d34c53` 现场，证明 live E16 零漂移；新 clean build/fresh scratch 从 A1 重跑六题，不拼前五题。
- [ ] 六题闭合后继续 F5/F7 版本化 15 回合、同 Run QA/Trace、authority、浏览器页面与最终清理。

`a7d34c53` live after audit 的 348 张表 fingerprint 与 before 逐表一致，authority 仍为 E16；Worker 停机前 exact build 且 IDLE。
本轮两个 browser/auth、Web/Worker、55527 forward 与 scratch container 已关闭，volume 只作停止 checkpoint 保留；普通 NAS 数据库 healthy，
OrbStack 为 0。receipt 为 `complex-a7d34c53-after.json` 与 `complex-a7d34c53-runtime-cleanup.json`。

`a35b67b5` clean build/full unit/fresh E17 scratch 已执行 `4.3.0`。A1、B1、B2 分别完成独立 source/stage/business Oracle 与同 Run
QA/Trace；B2 Run `3dc175e8-ad69-8a6c-86d2-3e843811a839` 的四渠道 QueryEvidence 与数据库逐项一致，单 Analysis Stage、两图和73个
Trace节点均通过。A2 Run `0eaaaa1b-8842-8b4e-a4b8-d3799657ad1f` 产品事实正确但拆成四个重复 Analysis task/stage 与八张图，业务拒绝，
所以 A3 未提交。

B3 Run `b721daf0-620b-8205-ba2a-c154b309bbef` 已确认 `4.3.0` 将正确日期列/维度纳入 frozen selection，Semantic 双 interpretation
正确；三个 Text2SQL 候选稳定遗漏请求级 `net_roi` 输出列，以 `QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID` 在 compile 阶段失败，
零 datasource execution/QueryEvidence/Analysis，最终 turn budget exhausted。

- [x] 只读保存当前 Run frozen intent/retrieval、Semantic Context、74个事件及三次五列候选拒绝证据，确认日期闭包修复有效且新断点为 request
  derivation output binding。
- [x] 前向版本化 `complex-l4-semantic-defined@4.4.0`：B3 明确32行六列面板及请求级 `net_roi`；A2 明确唯一 Analysis task/stage 与一次
  发布两类必需图。其余题、proof、Oracle、权限、预算和 UI 标准不变。
- [x] Trellis validate、diff check 与 scoped docs commit。
- [x] 审计并关闭 `a35b67b5` 现场，证明 live E16 零漂移；新 clean build/fresh scratch 从 A1 重跑六题，不拼本轮局部 PASS。
- [ ] 六题闭合后继续 F5/F7 版本化 15 回合、同 Run QA/Trace、authority、浏览器页面与最终清理。

`a35b67b5` live after audit 的348张表 fingerprint 与 before 逐表一致，authority 仍为 E16；Worker 停机前为 exact build 且最后周期
IDLE。本轮两个 browser/auth、Web/Worker、55528 forward 与 scratch container 已关闭，volume 只作停止 checkpoint 保留；NAS 普通
PostgreSQL/Neo4j healthy，OrbStack 为0。receipt 为 `complex-a35b67b5-after.json` 与 `complex-a35b67b5-runtime-cleanup.json`。

`e5dc68c8` clean force build 8/8、workspace 单并发 full unit 15/15、fresh E17 physical scratch、certification/activation 和
SERVER_PROXY 无模型探针通过。`complex-l4-semantic-defined@4.4.0` 六题在同一 baseline 连续闭合：

- [x] A1/A2/A3 Run 为 `8a0a153a-34ad-8fd8-95aa-bbd4d84e919e`、`9ebdec0e-a934-8977-b3e3-34c4b5924745`、
  `7e194e22-595a-8171-9019-63c2d49f950b`；A2 单 Analysis Stage、48行面板和两类图通过。
- [x] B1/B2/B3 Run 为 `7d7c6ab4-c999-8be3-88c2-d34052ba7232`、`bf920b92-c9b0-8dcd-892e-bf8627147643`、
  `ea240149-cb75-8f66-bb60-bd449d5da022`；B3 六列32行面板、单 Stage、SMS 与四类人群通过。
- [x] 六题各自 source/stage/business Oracle 与同 Run QA/Trace/刷新通过，Trace 节点为73/76/80/73/73/98；这是
  `formal_gate_pass=false` 的非计分预检，不是15回合 authority PASS。
- [x] 记录六题冻结证据，Trellis validate、diff check 后创建 scoped docs commit。
- [x] 关闭 `e5dc68c8` 现场并证明 live E16 零漂移：after audit 的348张表 fingerprint与before逐表一致且authority仍E16；
  Worker停机前为exact build/IDLE。两个browser/auth、Web/Worker、55529 forward与scratch container已关闭，volume保留checkpoint；
  普通NAS PostgreSQL/Neo4j healthy，OrbStack为0，receipt为 `complex-e5dc68c8-after.json` 与
  `complex-e5dc68c8-runtime-cleanup.json`。
- [ ] 以新 HEAD clean force build/fresh physical scratch 建立版本化正式 manifest/attempt，从 L1-01 严格执行15回合，业务通过后才做
  同 Run QA/Trace；全部通过后前向激活 E17、完成 F7 authority/页面/资源最终清理。

`ae3e1524` 基线上已实现正式 `falcon24-four-layer-gate-manifest@2.0.0` 与 migration 10817：v2 将用户批准且六题预检通过的公开
同比窗口、ROAS 公式、请求级净 ROI、精确日期维度、完整面板和单 Analysis Stage 写入15回合题面/rubric；历史 v1 blueprint/hash 与 replay
保持可用，两个版本互相混配失败关闭。v2 只要求业务所需的 Semantic/Text2SQL/Analysis，Report 仍按题面可选，所有业务/UI/authority proof
保持原强度。

- [x] Contracts/Evals/Web/Platform focused regression、三包 typecheck/build、迁移 render/inventory/static check、owned Biome 与 diff check通过。
- [x] disposable E17 PostgreSQL 物理副本应用10817；受保护历史零漂移、v1/v2各自begin+replay+supersede PASS、v2 schema与v1 turns/hash混配被
  `FALCON24_FOUR_LAYER_MANIFEST_INVALID` 拒绝，live writes 为0；副本、volume与55530 forward已删除。
- [x] workspace 单并发 full unit 15/15 tasks通过；force production build 9/9、0 cache通过。一次误用默认并发造成资源竞争型跨包超时，
  未放宽 timeout 或修改无关测试，随后 exact single-concurrent gate 无失败。
- [x] 本项以 scoped commit 收口；随后从该 commit 重新 clean build/full unit/attestation，创建 fresh E17 physical scratch 和唯一 v2 attempt，
  自 L1-01执行15回合。

首个 v2 正式 attempt `bd57f9cd-365b-47f1-a397-cdbc932088e6` 在 L1-04 immutable FAIL：L1-01～L1-03 的 business/QA/Trace
均 PASS；L1-04 Run `562a1b63-596f-8630-968c-c15c518e4e9f` 的 10 行 QueryEvidence、答案与独立源数据 Oracle PASS，但页面 observer
只识别图表源表 selector，漏掉截图中真实可见的独立 TABLE Artifact。

- [x] 为独立表增加稳定 `artifact-data-table` DOM 标记，four-layer QA 同时接受独立表和 `chart-source-table`。
- [x] Artifact component、four-layer browser gate tests、Web typecheck 与 owned Biome 通过；失败 attempt 不重放、不改写。
- [ ] scoped commit 后重做 clean build/full unit/attestation，创建 fresh E17 physical scratch/activation/attempt，从 L1-01 全量重跑。

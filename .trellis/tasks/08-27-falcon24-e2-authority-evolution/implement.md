# Falcon24 Semantic Generation 2 与 E4 原子权威恢复 — Implementation Plan

> W1-W7 已于 2026-08-27 获用户“执行”批准。W8 数据库应用与 E4 activation 仍需再次明确授权。

## 0. Current Freeze

### W0-R — Review-only planning freeze（本轮）

- [x] 保留以下未提交实现文件原样供审计，不 reset、删除、覆盖、暂存、提交或执行：
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
- [x] 用户评审并明确批准 W1-W7；W8 保持独立 hard stop。

W0 方案提交：`35f55d21 docs: plan Falcon24 generation 2 E4 recovery`。W1 合同与共享 validator 提交：
`a86a9494 feat: define semantic successor runtime closure`。

## 1. Global Preconditions After Approval

- 只在 `codex/falcon24-e1-authority-reset` worktree 工作，root checkout 保持不动。
- 先由用户决定如何处置 rejected dirty 实现；未经授权仍不得 reset/delete/overwrite。若其与批准后的文件 ownership 重叠，
  必须先获得明确处置指令，不能静默覆盖。
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
  `sha256:ac529bd370b56b0d4f492d384cb0e1fdb70f567481d0a0617de6599b543ce0b0`。
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
- [ ] Fresh bootstrap admission 复用同一 Port；gen2 current 前 Web/Worker readiness fail closed。

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
  dimensions / 多列物理 formula dependencies。当前剩余 `cohort_retention` / `repeat_purchase_rate` AST slots 尚无受审 dependency
  definitions，shared validator 稳定返回 `SEMANTIC_RUNTIME_FORMULA_DEPENDENCY_INVALID`，因此只会写 `REJECTED` stage，绝不会伪装
  为可执行 generation 2。该 Source 合同缺口必须在 W5 prepare/review 前结构化解决，禁止 validator fallback。
- 聚焦验证：Semantic/Worker typecheck PASS；5 个测试文件 27 tests PASS；10 个 owned files Biome 与 `git diff --check` PASS。
- Fresh bootstrap wiring 仍与冻结审计文件 `apps/web/src/cli/bootstrap-falcon24-e1.ts` 重叠，本包不覆盖该文件；在用户明确处置
  rejected implementation 前保持 admission fail closed，并在 W5 composition 一并接入唯一 Port。

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

- [ ] 生产 read port 改为调用 shared validator，不保留 Worker 私有近似 schema。
- [ ] Stage smoke 精确加载 stage envelope；固定 metric/dimension/window/Asia-Shanghai 计划。
- [ ] 明确禁止 model/provider、正式 Run、计分 gate 与网络副作用。
- [ ] 生成 smoke receipt，PASS CAS `SMOKE_PASSED`；semantic FAIL receipt + CAS `REJECTED`；process interruption留在 STAGED。

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
- `apps/web/src/cli/finalize-falcon24-authority.ts`
- 相关 Platform/Web tests

**Work**

- [ ] 新 proof v2 绑定 gen1 predecessor、gen2 candidate、四类 projection、source/compiler、validation/smoke、expected versions。
- [ ] 删除 successor=predecessor proof requirement；保留旧 builder only for history verification。
- [ ] 拆分 `prepareWorkspaceAuthority`，禁止从 gen1 current 自动推导 E4 semantic ref。
- [ ] Finalizer固定 stage -> smoke -> proof -> stage E4 receipts/baseline/session -> combined RPC -> production-port readback。
- [ ] Readback mismatch 只报告 severe incident并冻结，不执行补写/rollback。

**Validation**

- Proof lineage/generation+1/CAS/tamper tests。
- Finalizer no-activation-before-smoke、combined command refs-only、post-commit exact readback。
- Fault injection与 W2 RPC一起证明 atomicity。

**Stop conditions**

- Finalizer 任一步在 combined RPC 之前更新 semantic pointer/defaults/current，立即停止。

**Commit**

- `feat: activate E4 with semantic generation 2 atomically`。

### W6 — Diagnostic authority and gate prerequisite

**Ownership**

- Diagnostic Contracts/Platform/Web control/tests
- 若评审决定独立 migration：10784 source/rendered/manifest/support
- Qualification begin RPC/adapter 的 diagnostic prerequisite

**Work**

- [ ] 新增 append-only diagnostic attempts/receipts；同 E4 baseline/gen2 Release 一个 active attempt。
- [ ] 固定业务问题与 exact source/build/baseline/gen2 binding。
- [ ] 诊断结果 immutable；失败不得 resume Run。
- [ ] E4-Q1 begin 必须看到 exact PASSED diagnostic receipt，否则 fail closed。

**Validation**

- One-active concurrency、append-only/RLS/grants、wrong baseline/build/release rejection、Q1 prerequisite。
- Diagnostic失败分类：frozen change -> E5；external unchanged -> new attempt ID。

**Stop conditions**

- Diagnostic被计入Q1/C1分数，或API-only receipt可使Q1 begin通过，立即停止。

**Commit**

- `feat: require an E4 diagnostic proof before qualification`。

### W7 — Full static, migration, concurrency and security qualification

**Ownership**

- 仅测试/证据/runbook修订；不在此包新增行为功能。

**Work / Validation**

- [ ] Contracts、Semantic、Platform、Worker、Web focused/full suites、typecheck/build。
- [ ] 10783 fresh PG17 + exact E3 fixture upgrade；若有 10784 同样验证。
- [ ] 历史 immutability pre/post digest、RLS/grants/capability scope、direct DML denial。
- [ ] Combined activation failure-injection/concurrency all-old/all-new。
- [ ] Production import graph：无 repair RPC、第二 publisher、Worker fallback、client projection payload面。
- [ ] Docker inventory保持单一专用数据库；不创建新的数据库容器。

**Stop conditions**

- 任一验证失败不进入 W8；修复回到拥有该行为的工作包并创建新的 scoped commit。若修改 frozen E4 closure，重新构建后续 identity。

**Commit**

- 仅在确有 owned test/runbook change 时：`test: qualify semantic E4 atomic activation`。

### W8 — Dedicated E3 database stage and atomic E4 activation

**Preconditions**

- 用户再次明确批准执行数据库变更与 E4 activation。
- W1-W7 commits/build attestations固定；专用容器仍为 `data-agent-falcon24-e1-e81a29c6`，不创建新 DB 容器。

**Work**

- [ ] 只应用已验证的 forward migrations；先后核对 ledger/checksum与E1-E3/gen1审计摘要。
- [ ] 通过唯一 publisher stage generation 2；运行 deterministic smoke PASS。
- [ ] 构建 E4 proof/receipts/baseline/session，combined transaction原子激活。
- [ ] 使用生产端口核对 semantic pointer/runtime/defaults=current gen2，Falcon current=E4，receipt/outbox/stage PROMOTED exact。
- [ ] 再次证明 generation 1/E1-E3 bytes未变与 `production_gate=HOLD`。

**Stop conditions**

- Stage/validation/smoke失败：保持 gen1/E3，stage按状态机REJECTED或STAGED，停止。
- Activation失败：必须完整gen1/E3；若出现partial，严重事故并停止。
- Activation成功后任何frozen change都进入E5。

**Commit**

- 无运行数据库内容提交；只在有批准的证据索引/runbook更新时 scoped commit。

### W9 — Single non-scoring E4 diagnostic

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

### W10 — E4-Q1 and E4-C1

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

W1-W7 可按工作包边界实施并提交，但不得执行或吸收被拒绝的 dirty repair 实现。W8 前必须再次获得用户对专用 E3 数据库 migration
应用与 E4 activation 的明确授权；此前不调用 activation RPC、不创建 E4 diagnostic/Q1/C1。W8 成功后，W9/W10 仍服从单次
诊断、首败 HOLD、无 retry/resume 与真实 Trace UI 证据边界。

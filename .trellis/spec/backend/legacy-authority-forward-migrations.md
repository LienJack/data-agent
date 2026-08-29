# 旧权威后继发布闭包

> 本文记录旧环境缺失后继发布治理或运行时依赖闭包时的前向 Migration 合同。

## 1. Scope / Trigger

- 已存在不可改写的历史 Semantic Release/Falcon authority，当前仍需保持精确
  `E3 + generation 1`，但后继发布入口因缺少 reviewer policy、assignment 或 pointer
  而失败关闭时适用。
- 该场景只允许 checksum-bound 前向 Migration 补齐治理闭包；不能 UPDATE/DELETE 历史
  Release、projection、pointer、baseline、receipt、Run、gate、Artifact 或 workspace defaults，
  也不能用手工 SQL 直接创建 review packet 或 decision。

## 2. Signatures

```text
semantic.semantic_reviewer_policy_revision
semantic.semantic_reviewer_assignment
semantic.semantic_reviewer_policy_pointer
semantic.prepare_falcon24_successor_review(jsonb) -> jsonb
semantic.human_record_semantic_review_decision(jsonb) -> jsonb
app_data_agent.u2_canonical_sha256(jsonb) -> text
app_data_agent.u6_uuid_v5(uuid,bytea) -> uuid
```

Migration 只能为 exact scope 写入 policy revision、membership-version-bound assignment、
policy pointer 与 ledger；review preparation 和 human decision 仍由上述正常治理 RPC 分开执行。

## 3. Contracts

- Migration 必须从数据库锁定并证明当前 authority epoch、semantic domain、active release
  generation 与 source release exact match；找不到 exact scope 时不猜测、不扩大范围。
- pointer 缺失时，policy revision、assignment、successor review preparation 中任一 partial
  state 都必须失败关闭。pointer 已存在时不改写，只由 postcondition 验证其完整闭包。
- 新 policy payload 和 digest 由 PostgreSQL 构造并用 canonical SHA-256 重算；assignment
  必须来自恰好一个未撤销的当前 owner membership，并绑定 exact membership version。
- 确定性 UUID 的域分隔必须在 `bytea` 中拼接：
  `convert_to(part,'UTF8') || decode('00','hex') || convert_to(next,'UTF8')`。
  PostgreSQL `text` 不允许 NUL，禁止先用 `chr(0)` 拼 text 再 `convert_to`。
- Migration 提交前验证 policy payload/digest、pointer version/digest、live assignment、
  quorum/min-reviewers exact closure。成功后仍保持 review preparation=0、decision=0、stage=0；
  通用数据库执行授权不能冒充某个 exact packet 的人工 APPROVE。
- populated upgrade 需对除 ledger 与三张允许变更表外的全部用户表做有序 canonical
  count/hash 前后比较；任何差异都视为历史权威污染。

## 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 前置 frontier/checksum、PostgreSQL 版本或 relation/function inventory 漂移 | baseline/inventory/function drift，整笔回滚 |
| policy/assignment/pointer 或 preparation 存在 partial state | `FALCON24_SUCCESSOR_REVIEW_POLICY_PARTIAL_STATE` |
| 当前未撤销 owner 不是恰好一个 | `FALCON24_SUCCESSOR_REVIEW_POLICY_OWNER_INVALID` |
| policy digest、pointer 或 assignment/quorum 闭包不一致 | `FALCON24_SUCCESSOR_REVIEW_POLICY_POSTCONDITION_FAILED` |
| 非允许变更用户表 count/hash 变化 | upgrade verification 失败，禁止继续 review/stage |
| packet 未获 exact human decision | 保持 `OPEN/PENDING + generation 1/E3`，禁止 stage/smoke/activation |

## 5. Good / Base / Bad Cases

- Good：在 exact populated clone 先执行 forward Migration，证明非允许变更表全部 byte-equivalent，
  再把同一 checksum 应用于专用数据库并通过治理 service 生成 `WAITING_REVIEW` packet。
- Base：目标环境已经有完整 policy pointer 时 Migration 不写 policy 数据，只验证现有 closure。
- Bad：为让 Finalizer 通过而手工 INSERT reviewer row、自动写 APPROVE、修补 generation 1
  projection，或把服务暂停当作原子事务替代品。

## 6. Tests Required

- 静态测试断言 exact `E3 + falcon24 + generation 1` guard、partial-state/owner error、三张允许写表，
  并拒绝受保护表 UPDATE/DELETE。
- renderer test 固定 source segments、manifest、header/body checksum 与已渲染 SQL bytes。
- PostgreSQL 17 populated-clone upgrade 覆盖真实旧环境零 policy 闭包、确定性 assignment UUID、
  canonical policy digest、ledger frontier 与 postcondition。
- upgrade 前后逐表比较所有非允许变更用户表的 row count/canonical hash；专门复核
  Falcon current、semantic/runtime pointer、workspace defaults、E1-E3/gen1 exact refs。
- governance service 必须重算 packet digest/ChangeSet hash并返回 diff、impact、quorum；测试证明
  preparation 不产生 decision/stage，只有 human decision RPC 能关闭 packet。

## 7. Wrong vs Correct

```sql
-- Wrong: PostgreSQL text 不能包含 NUL
convert_to(domain || chr(0) || environment, 'UTF8')

-- Correct: 在 bytea 哈希域拼接分隔符
convert_to(domain, 'UTF8')
  || decode('00', 'hex')
  || convert_to(environment, 'UTF8')
```

## 8. Legacy Runtime Dependency Closure Scope / Trigger

- 旧 greenfield bootstrap 已不可变发布 exact `E3 + falcon24 + generation 1`，但早于通用 publisher
  的 catalog/dependency fence 合同，因而没有 `semantic_catalog_fence` 与
  `semantic_dependency_pointer` 时适用。
- 该缺口只能由 checksum-bound 前向 Migration 补齐。Migration 必须先证明 successor stage、target-generation-2
  publish attempt、E4 baseline/session/diagnostic/formal gate 全部为零；第一次 Finalizer 若已失败关闭，也必须证明它
  没有留下上述 partial state。
- 只允许 INSERT 缺失的 fence/pointer 与 ledger。禁止 UPDATE/DELETE generation 1、E1-E3、current pointer、
  workspace defaults 或 review packet，禁止手工 SQL 伪造依赖值。

## 9. Runtime Dependency Signatures

```text
semantic.semantic_catalog_fence
semantic.semantic_dependency_pointer
semantic.semantic_source_release
semantic.semantic_publish_attempt
semantic.semantic_publication_validation_receipt
semantic.semantic_runtime_restriction_projection
app_data_agent.u2_canonical_sha256(jsonb) -> text
```

Migration 10794 从 immutable generation-1 bootstrap evidence 重算并插入：

```text
catalog_fence_epoch = 0
catalog_schema_digest = sha256:12f028d95464af08d4311a56168381d1c99dcb5ecfe8f2f11779e348db5a76e0
dependency_generation = 1
compiler_bundle_digest = sha256:ca65d92516a3e1027487918fdd838c81affd40f687ebaecb16260d02e1c1cd17
closure_policy_digest = sha256:11fae155322246aaf3e8a3219378063dd21b440bd02311b6a56205a4a825dd7b
```

这些常量是 exact fixture 的预期 postcondition，不是可由 CLI 提交的 payload。SQL 必须从 validation receipt、
bootstrap policy、historical COMMITTED attempt、source release 与 runtime restriction 的 canonical bytes 重新推导并比较。

## 10. Runtime Dependency Contracts

- 先验证 PostgreSQL 17、10793 exact frontier/checksum、当前 E3、active/runtime generation 1 exact closure；任何 scope
  或 bytes 漂移都整笔回滚。
- fence 与 pointer 必须同时缺失或同时完整。只缺一张表的 partial state 不是可修复基线，稳定失败关闭。
- bootstrap validation receipt 的 schema snapshot 重算 `catalog_schema_digest`；source release/attempt/restriction/
  validation candidate-set evidence 必须闭合为同一 `compiler_bundle_digest`；bootstrap policy、pointer、revision、
  release-set、validation 与 restriction 必须闭合为同一 `closure_policy_digest`。
- 已存在 exact fence/pointer 时只验证、不重写，重复应用保持一行 ledger、一行 fence、一行 pointer。
- populated upgrade 对除 ledger、catalog fence、dependency pointer 外的全部用户表做有序 canonical count/hash
  比较；generation 1/E1-E3/review bytes 必须完全不变。
- 10794 只补齐既有唯一 publisher 的前置 closure，不创建第二 publisher，不 stage generation 2，也不改变 current。

## 11. Runtime Dependency Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 10793 frontier/checksum、PostgreSQL 版本或 exact E3/gen1 scope 漂移 | baseline/inventory drift，整笔回滚 |
| E4、successor stage 或 target-generation-2 publish attempt 已存在 | polluted target，禁止 provisioning |
| fence/pointer 仅一者存在 | `FALCON24_SEMANTIC_DEPENDENCY_PARTIAL_STATE` |
| validation receipt、attempt、policy 或 restriction 证据缺失/不唯一 | bootstrap evidence invalid，整笔回滚 |
| 任一 canonical digest 重算不等于 exact generation-1 evidence | dependency provisioning mismatch，整笔回滚 |
| 两行均已存在且 exact | idempotent verify；不新增、不改写 |
| 非允许用户表 count/hash 变化 | populated-upgrade verification 失败，禁止 Finalizer |

## 12. Runtime Dependency Good / Base / Bad Cases

- Good：从专用 E3 数据库 exact clone 应用 10794，证明 380 张非允许用户表 count/hash drift=0，再将同一
  rendered checksum 应用于专用数据库；Finalizer 之后才可重新进入正常 stage preparation。
- Base：fence/pointer 已由通用 publisher 完整建立且值与 generation-1 bootstrap evidence exact match；Migration
  只校验 postcondition。
- Bad：看到 `SEMANTIC_SUCCESSOR_DEPENDENCY_POINTER_REQUIRED` 后直接手工 INSERT 任意 digest，或再次运行
  Finalizer 期待偶然通过。这绕过 canonical derivation、ledger checksum 与 all-old 恢复证明。

## 13. Runtime Dependency Tests Required

- 静态测试断言 exact 10793 checksum、E3/gen1 scope、零 E4/零 successor 污染、partial-state 失败与只 INSERT
  三张允许表。
- 10794 renderer/manifest 测试固定其 source segments、rendered SQL 与 header/body checksum；加入 pre-baseline HOLD 后，workspace
  migration inventory 的当前 frontier=10796、next=10797。
- PostgreSQL 17 exact populated clone：应用前 fence/pointer=0/0，应用后=1/1，replay 后仍=1/1。
- 对 380 张非允许用户表比较 row count/canonical hash；另行复核 E3 baseline、generation 1 release/projections、
  review packet/decision 与 stage/E4/diagnostic counts。
- 负例覆盖 partial fence、错误 receipt digest、错误 attempt generation、错误 policy hash 与已污染 target generation。

## 14. Runtime Dependency Wrong vs Correct

```sql
-- Wrong: 手工选择一个看似合理的 digest，绕过 immutable evidence
insert into semantic.semantic_dependency_pointer (..., compiler_bundle_digest)
values (..., 'sha256:guessed');

-- Correct: checksum-bound migration 内重算并比较 exact bootstrap evidence；
-- 只有所有 precondition 成立时，才在同一事务 INSERT fence、pointer、ledger。
select app_data_agent.u2_canonical_sha256(validation_receipt_json)
  into derived_validation_hash;
```

## 15. Scenario: Falcon Pre-baseline Staging HOLD

### 15.1 Scope / Trigger

- Trigger：Falcon successor staging session 已为 `STAGED`，supporting receipt 或 Team materialization 在 baseline 创建前失败。
- 目的：append-only 保留已写 receipts，并将 session 受控终结为 HOLD；不建立 baseline/attempt，不删除 receipt，不重用 staging id。
- Post-baseline 失败不走本 RPC，必须继续使用 activation-attempt HOLD authority。

### 15.2 Signatures

```text
falcon24StagingHoldRequestV2Schema
falcon24StagingHoldResultV2Schema
PostgresFalcon24AuthorityEpoch.holdStagingSession(capability, request)
app_data_agent.hold_falcon24_authority_staging_session(jsonb) -> jsonb
pnpm --dir apps/web hold:falcon24-authority-staging
```

锁顺序固定为 `falcon24-authority-staging advisory -> current authority FOR UPDATE -> staging session FOR UPDATE`。

### 15.3 Contracts

Request exact keys：

```json
{
  "schema_version": "falcon24-staging-hold-request@2.0.0",
  "authority_epoch": "E4",
  "staging_id": "uuid",
  "expected_retained_assets_hash": "sha256:<64 hex>",
  "failure_code": "STABLE_UPPER_SNAKE_CASE"
}
```

Adapter 仅在服务器端追加 `command_hash`。Result 固定为 `falcon24-staging-hold@2.0.0`、`status=HOLD`，并回显 exact epoch、
staging id、retained hash 与 failure code。CLI 环境键：

- required：`DATABASE_URL`、`FALCON24_STAGING_ID`、`FALCON24_EXPECTED_RETAINED_ASSETS_HASH`、
  `FALCON24_STAGING_FAILURE_CODE`、`DATA_AGENT_ALLOW_FALCON24_STAGING_HOLD=YES`；
- fixed/default：`FALCON24_AUTHORITY_EPOCH=E4`、deployment/workspace/principal 与 environment 仍按 Finalizer 的 server context 解析；
- CLI 只调用 capability authority 与 Port，禁止 `pool.query`、`client.query` 或 session payload/DML 输入。

### 15.4 Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| exact keys/schema/UUID/hash/reason/command hash 错误或含潜在秘密 | `FALCON24_AUTHORITY_STAGING_HOLD_INVALID` |
| current 不存在或 target 不是 `current+1` | `FALCON24_CURRENT_AUTHORITY_NOT_FOUND` / `FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR` |
| session 不存在或 retained hash 不同 | `...SESSION_NOT_FOUND` / `...HOLD_MISMATCH` |
| session 已有任何 baseline | `FALCON24_AUTHORITY_STAGING_HOLD_BASELINE_EXISTS` |
| session 已 HOLD 且 failure code 相同 | idempotent replay，返回同一 HOLD document |
| session 已 HOLD 但 failure code 不同 | `FALCON24_AUTHORITY_STAGING_HOLD_CONFLICT` |
| session 已 CONSUMED | `FALCON24_AUTHORITY_STAGING_SESSION_TERMINAL` |
| supporting failure 后 HOLD authority 自身失败 | `FALCON24_E4_STAGING_HOLD_FAILED`，禁止继续 baseline/activation |

### 15.5 Good / Base / Bad Cases

- Good：Finalizer 在 Team materialization 失败后调用 Port，session `STAGED -> HOLD`，原稳定 reason 继续向上抛出，current 保持 all-old。
- Base：进程在 HOLD 返回后丢失响应；同一 exact request 重放返回同一 HOLD document。
- Bad：直接 UPDATE session、删除已写 receipts、把 HOLD 恢复为 STAGED、重用同一 staging id，或让 pre-baseline RPC 接受已有 baseline。

### 15.6 Tests Required

- Contract：strict request/result、E1/未知字段/错误 hash/reason 拒绝。
- Platform：服务端 command hash、correlation id、RPC 名称、stable DB error mapping 与 exact result parse。
- Web：supporting receipt 不完整和 Team revision conflict 都先调用 HOLD；成功后抛回原 reason；HOLD 失败不得 stage baseline。
- Migration：exact 10794 checksum、PG17、helper/session inventory、owner/security-definer/search path、public revoke/backend grant、
  migration 前后 session bytes 不变。
- PostgreSQL clone：apply、first HOLD、same-reason replay、different-reason conflict、baseline-exists refusal，并确认权威库未受 scratch 影响。

### 15.7 Wrong vs Correct

```sql
-- Wrong: 绕过 capability/RLS 并留下无 failure reason 的现场修补
update app_data_agent.falcon24_authority_staging_sessions
set status='HOLD' where staging_id=:id;

-- Correct: client 只提交 exact CAS material；Adapter 生成 command_hash，RPC 锁定并验证 scope/current/session/baseline
select app_data_agent.hold_falcon24_authority_staging_session(:server_built_command);
```

当 source-owned Skill body 改变时，同样禁止复用已发布 revision：必须提高 revision，通过 Skill Registry append + CAS 推进 head；
数据库中的旧 revision bytes 即使来自重构前也属于已引用权威历史，不能按“可丢弃旧数据”处理。

## 16. Scenario: Build-bound Successor Smoke Revalidation

### 16.1 Scope / Trigger

- Trigger：同一 immutable successor stage 已 `SMOKE_PASSED`，但新的 clean Worker build 必须重新执行 deterministic smoke 并让 E4 proof
  绑定新 build receipt。
- 原因：stage identity 不随 Worker build 变化；receipt/command hash 包含完整 Worker build。复用 stage-only idempotency key 会将合法新
  receipt 错判为 same-key/different-command conflict。

### 16.2 Signatures

```text
buildFalcon24SuccessorSmokeIdempotencyKey({
  stage_identity: sha256,
  worker_build_identity: RuntimeBuildIdentity
}) -> Promise<uuid>

semantic.commit_semantic_successor_smoke(jsonb) -> jsonb
```

数据库 RPC 名称和命令 schema `semantic-successor-smoke-commit@1.0.0` 不变；10796 是 forward behavior evolution，不修改 10783。

### 16.3 Contracts

- idempotency material schema 固定为 `falcon24-e4-successor-smoke-identity@2.0.0`，字段仅为 exact stage identity 与完整
  `runtime-build-identity@1.0.0`。
- `SMOKE_PASSED` 仅接受 outcome `PASS` 的新 key。新 SMOKE receipt append-only；stage payload/status/`smoke_passed_at` 与旧 receipts
  均不变。
- same key/same command 在状态 fence 前返回旧 receipt，支持 commit-response crash recovery。
- Finalizer 只使用当前 Worker 调用返回并重新验证的 receipt hash，不查询“最新 PASS”或覆盖旧 hash。

### 16.4 Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 同 stage、同 Worker build、同命令重放 | 返回 exact 既有 receipt；receipt count 不变 |
| 同 key、不同 receipt/command hash | `SEMANTIC_SUCCESSOR_IDEMPOTENCY_CONFLICT` |
| `STAGED + PASS` | append SMOKE，CAS 为 `SMOKE_PASSED` |
| `STAGED + FAIL` | append SMOKE/REJECTION，CAS 为 `REJECTED` |
| `SMOKE_PASSED + PASS + new build-bound key` | append SMOKE；stage/timestamp 不变 |
| `SMOKE_PASSED + FAIL` | `SEMANTIC_RUNTIME_SMOKE_FENCE_MISMATCH`；零写入 |
| `REJECTED/PROMOTED + new key`、错误 digest/closure 或重复 receipt hash | fail closed；零写入 |

### 16.5 Good / Base / Bad Cases

- Good：固定 stage + 新 clean Worker build 派生新 key，Worker 重新验证并 append PASS；proof v2 绑定本轮返回 receipt。
- Base：进程在 commit 后丢失响应；同 build 派生同 key，RPC 返回同一 receipt，不追加重复历史。
- Bad：把 key 只绑定 stage、UPDATE 旧 receipt 的 build identity/hash，或从多条 PASS 中任意选择一条构造 proof。

### 16.6 Tests Required

- Unit：同 exact build key 稳定、build identity 任一变化导致 key 不同。
- Static migration：exact 10795 checksum、RPC 状态分支、无 receipt UPDATE/DELETE、owner/search path/ACL、source/rendered checksum。
- PostgreSQL 17 exact populated clone：应用 10796 前后 stage/receipt ordered canonical count/hash不变；随后验证 PASS append、replay、
  conflict、FAIL rollback、旧 receipt bytes 与 `smoke_passed_at` 不变。
- Finalizer：新 build receipt 进入 proof/baseline；失败时 `e432`/E4 零污染并保持 E3/gen1。

### 16.7 Wrong vs Correct

```typescript
// Wrong: stage 相同就复用 smoke key；新 Worker receipt 必然与旧 command hash 冲突
stableUuid(`smoke:${stageIdentity}`);

// Correct: build 是 receipt identity 的一部分，因此也必须进入 operation idempotency identity
await buildFalcon24SuccessorSmokeIdempotencyKey({
  stage_identity: stageIdentity,
  worker_build_identity: workerBuildIdentity,
});
```

## 17. Scenario: Post-baseline Activation Failure Closure

### 17.1 Scope / Trigger

- Trigger：E4 baseline/session 已 `STAGED`、activation attempt 已 `OPEN`，但
  `activate_falcon24_authority_with_semantic_successor(jsonb)` 在事务提交前失败并保持完整 E3/gen1。
- 该路径只终结失败 attempt；它不能重开旧 baseline、修改 successor stage/receipt、修补 generation 1，或创建第二 activation authority。
- Combined activation 已提交后的 receipt/readback failure 属于严重 post-commit incident，禁止调用 HOLD，因为数据库可能已经是 E4/gen2。

### 17.2 Signatures

```text
Falcon24ActivationAttemptHoldRequest {
  schema_version: "falcon24-activation-request@2.0.0"
  authority_epoch: "E4"
  attempt_id: uuid
  baseline_id: uuid
  expected_baseline_hash: sha256
  failure_code: STABLE_UPPER_SNAKE_CASE
}

finalizeFalcon24SemanticSuccessor({ hold_activation_attempt(request), ... })
PostgresFalcon24AuthorityEpoch.holdActivationAttempt(capability, request)
pnpm --dir apps/web hold:falcon24-authority-activation
app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb) -> jsonb
```

10797 `CREATE OR REPLACE` 现有 combined activation RPC；不新增并行 RPC。锁序保持
`semantic fence -> Falcon advisory/current -> semantic pointer/runtime/defaults -> stage -> baseline/attempt/session`。

### 17.3 Contracts

- Source revision 和 physical snapshot 是不同哈希域：
  `semantic_source_revision.source_digest = stage.change_set_hash`；不得与
  `stage.source_snapshot_hash` 比较。
- Candidate closure 必须同时满足 `revision_id=stage.candidate_revision_id`、
  `source_revision_id=stage.source_revision_id`、`revision_digest=stage.change_set_hash`，且 candidate head 为
  `PUBLISHING` 并指向同一 revision。
- Finalizer 只捕获 `promoteStagedSuccessor` 的提交前异常，随后对 exact baseline/attempt/hash 调用一次
  `hold_activation_attempt`；HOLD 成功后原错误原样抛回。未知错误文本归一为
  `FALCON24_COMBINED_ACTIVATION_FAILED`。
- HOLD 自身失败返回 `FALCON24_E4_ACTIVATION_HOLD_FAILED`，内部 cause 同时保留 activation 与 HOLD 两个异常；不得继续 readback、诊断或门禁。
- 独立恢复 CLI 必须要求 `DATA_AGENT_ALLOW_FALCON24_ACTIVATION_HOLD=YES`、`DATABASE_URL`、
  `FALCON24_ACTIVATION_ATTEMPT_ID`、`FALCON24_ACTIVATION_BASELINE_ID`、
  `FALCON24_ACTIVATION_EXPECTED_BASELINE_HASH`、`FALCON24_ACTIVATION_FAILURE_CODE`。CLI 只经 capability authority 和既有 Port；禁止 raw query/DML。
- 10797 以前沿 10796 exact checksum 为前置，迁移前后 snapshot 既有 successor stage/projection/receipt、Falcon staging/baseline/attempt、
  source/review/candidate/publish authority rows。除 ledger/function definition/ACL 外，历史 bytes 不得变化。

### 17.4 Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| promote 提交前失败，exact attempt 仍 OPEN | exact attempt/baseline/session `-> HOLD`，再抛回原 failure code |
| same baseline/hash/reason HOLD 重放 | idempotent 返回同一 HOLD authority |
| same refs 但 reason 不同 | `FALCON24_AUTHORITY_ACTIVATION_HOLD_CONFLICT` |
| baseline/hash/scope/current E3 不匹配 | fail closed；零直接 DML |
| activation 失败且 HOLD 也失败 | `FALCON24_E4_ACTIVATION_HOLD_FAILED`，停止 |
| activation receipt 校验或 post-commit readback 失败 | 不 HOLD；报告 severe incident 并冻结执行 |
| source revision 对 snapshot hash、candidate revision closure 缺失 | combined activation rollback，保持 all-old |
| 10796 frontier/checksum、RPC owner/ACL/body 或历史 snapshot 漂移 | 10797 整笔回滚 |

### 17.5 Good / Base / Bad Cases

- Good：combined activation 在提交前失败，Finalizer 经 Port 把 exact OPEN attempt 封存为 HOLD；修复并提交新代码后，以新 staging id 和新 clean build 再尝试。
- Base：进程在 HOLD commit 后丢失响应；confirmation-gated CLI 用同一 exact request 重放并读回同一 HOLD。
- Bad：捕获整个 Finalizer 并在 post-commit readback mismatch 时 HOLD，或直接 UPDATE attempt/baseline/session；前者可能把已激活 E4 标成失败，后者绕过 capability、CAS 与审计。

### 17.6 Tests Required

- Finalizer unit：成功不 HOLD；promote failure exact HOLD once 且重抛原异常；HOLD failure 保留双 cause；receipt/readback failure 不 HOLD。
- CLI：无 confirmation 返回 `NOT_RUN`；严格解析 exact env；源码断言只用 capability/Port，无 `pool.query`/`client.query`。
- Migration static：10796 checksum、source/candidate hash-domain、锁序、原子写、owner/search path/ACL、source/rendered checksum。
- PostgreSQL 17 populated clone：apply 前后历史 snapshot 不变；first HOLD、same-reason replay、different-reason conflict；失败 CAS 只观察 all-old。
- Concurrency：两个相同有效 activation 命令返回同 receipt；无效 CAS rollback 后仍 all-old；成功后 pointer/runtime/defaults/E4/stage 只能 all-new。

### 17.7 Wrong vs Correct

```typescript
// Wrong: receipt/readback 也在同一个 catch 内，可能对已提交的 E4 调用 HOLD
try {
  return await verifyAndReadback(await promote(command));
} catch (error) {
  await holdAttempt(error);
}

// Correct: 只包围提交前 promote；receipt 与 readback 在 catch 外 fail-severe
let activationResult;
try {
  activationResult = await promote(command);
} catch (error) {
  await holdExactAttempt(error);
  throw error;
}
return verifyAndReadback(activationResult);
```

## 18. Scenario: Frozen Diagnostic Orphan and Provider Certification Successor

### 18.1 Scope / Trigger

- 当前 Falcon epoch 的唯一正式 diagnostic Run 已不可重试地 FAILED，但 completion adapter 因事务上下文缺失未能写终态 receipt，留下
  `ACTIVE` orphan attempt。
- 同一失败还证明 current frozen model closure 缺少 exact `AVAILABLE` execution certification；修复必须进入 successor epoch。
- 该场景禁止直接完成旧 attempt、在旧 epoch 暴露新 profile、resume旧 Run或新建同 epoch diagnostic。

### 18.2 Contracts

- `complete_falcon24_diagnostic` 仍是唯一 diagnostic terminal writer；successor activation 只能在同 transaction 内以 server-built exact
  FAIL command调用它。
- successor activation command必须绑定 predecessor attempt/run/manifest、FAILED Run terminal code与 `retryable=false`，并限制固定
  failure class/code。数据库从 append-only event重算，不相信 CLI 自报。
- live provider smoke receipt先写成 inactive candidate并绑定 successor staging。execution-profile reader只接受 current epoch推广的 binding；
  STAGED/REJECTED candidate与旧 current均不可见。
- successor LLM proof绑定 exact certification Artifact、execution profile、deployment、recovery capabilities、model config与 build identity；旧
  predecessor-equality proof只读保留。
- activation锁序固定为
  `semantic fence -> Falcon activation advisory -> diagnostic advisory -> current -> semantic pointer/runtime -> defaults -> predecessor diagnostic -> provider candidate -> target authority`。
- activation失败必须整笔保持 old diagnostic ACTIVE、candidate inactive、old current；成功必须同时得到 predecessor FAILED receipt、candidate
  active/PROMOTED、successor current。不得用维护窗口代替该原子性。

### 18.3 Validation and recovery

| Condition | Result |
|---|---|
| credential缺失 | 创建 preparation Run前零写入 HOLD |
| live smoke/Run/fence失败 | candidate不存在或REJECTED；正式 diagnostic不重试 |
| candidate已STAGED但激活失败 | old current + orphan ACTIVE + candidate不可见 |
| predecessor event/code/run不闭合 | activation rollback，稳定 authority error |
| activation commit | old diagnostic FAILED receipt恰好一条 + successor/profile all-new |
| 同命令重放 | 返回同一 activation/diagnostic/certification refs，不追加 receipt |

Migration必须 snapshot E1-current、semantic release/projection、Run/event、diagnostic与provider artifact历史；除新 candidate、function/ACL/ledger外
迁移前后 count/hash不变。测试必须覆盖 forced RLS semantic-domain context、inactive visibility、错误 profile/deployment/hash、failure injection、
双连接锁序与 v3 historical replay。

### 18.4 Wrong vs Correct

```text
Wrong: 新代码直接 complete 旧 attempt，再另一次事务激活 profile/E7。
Correct: provider receipt先处于不可见 candidate；唯一 activation transaction调用唯一 completion并推广 candidate与E7。
```

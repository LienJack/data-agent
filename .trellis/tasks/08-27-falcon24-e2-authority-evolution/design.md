# Falcon24 Semantic Generation 2 与 E4 原子权威恢复 — Design

> Review-only。本文定义待批准的目标设计，不授权代码、migration、数据库或门禁操作。

## 1. Scope / Trigger

### 1.1 Trigger

E3-Q1 ordinal 0 以 `SQL_DATA_PREPARATION / SEMANTIC_RELEASE_PROJECTION_INVALID` HOLD。当前 generation 1 的
executable、relationship、runtime restriction payload 只有 `release_set_hash`，而生产 read port 需要严格的可执行投影 schema。
E1/E2/E3 又都复用了相同 Semantic staging proof，因此现有 Finalizer 的 predecessor-equality 检查无法证明运行时闭包。

### 1.2 Design outcome

```text
immutable generation 1 + current E3
  -> reviewed ChangeSet successor stage (server compiled)
  -> shared runtime closure validation
  -> deterministic Worker smoke
  -> staged E4 baseline/proofs
  -> one PostgreSQL transaction promotes gen2 and activates E4
  -> post-commit production-port verification
  -> one non-scoring diagnostic
  -> E4-Q1 16/16
  -> E4-C1 30/30
```

### 1.3 Non-goals

- 不原地修补 generation 1，不重写 E1/E2/E3。
- 不增加接受 client projection payload/digest 的 repair RPC。
- 不以服务暂停、人工 SQL、Worker fallback 或第二 publisher 代替 authority transaction。

## 2. Signatures

### 2.1 Semantic publication Port

现有 `SemanticPublicationAuthorityPort.publishAtomically` 必须演进，仍由
`publishReviewedSemanticChangeSet` / `createPostgresSemanticPublicationAuthority` 承担唯一 publish authority：

```ts
interface SemanticPublicationAuthorityPort {
  stageReviewedSuccessor(
    capability: Capability,
    command: StageReviewedSemanticSuccessorCommand,
  ): Promise<PortResult<SemanticSuccessorStage>>;

  loadStagedSuccessor(
    capability: Capability,
    query: { readonly stage_id: string },
  ): Promise<PortResult<SemanticSuccessorStageEnvelope>>;

  promoteStagedSuccessor(
    capability: Capability,
    command: CombinedFalcon24SemanticActivationCommand,
  ): Promise<PortResult<CombinedFalcon24SemanticActivationReceipt>>;
}
```

普通 Semantic Studio publish 若不参与 Falcon combined activation，仍复用同一 compiler/validator/正式写入 kernel；不得复制
projection 编译、hash 或 Release insert 逻辑。

### 2.2 Stage command

CLI/Web 只提交业务引用、expected CAS 与幂等键，不提交任何 projection payload/digest：

```ts
type StageReviewedSemanticSuccessorCommand = {
  readonly schema_version: "stage-reviewed-semantic-successor-command@1.0.0";
  readonly command_id: string;
  readonly idempotency_key: string;
  readonly scope: {
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: string;
    readonly semantic_domain: string;
  };
  readonly change_set_ref: { readonly change_set_id: string; readonly change_set_hash: ContentHash };
  readonly review_ref: { readonly review_id: string; readonly review_hash: ContentHash };
  readonly source_snapshot_ref: {
    readonly snapshot_id: string;
    readonly snapshot_revision: number;
    readonly snapshot_hash: ContentHash;
  };
  readonly compiler_bundle_ref: {
    readonly compiler_version: string;
    readonly compiler_bundle_hash: ContentHash;
  };
  readonly expected_predecessor: {
    readonly release_id: string;
    readonly generation: number;
    readonly release_digest: ContentHash;
  };
  readonly expected_pointer_version: number;
  readonly target_generation: number;
};
```

服务器在 semantic fence 内读取并锁定 ChangeSet、review、snapshot 和 pointer，重新验证 hash/scope/status，调用
`compileSemanticPublicationProjection`，再生成 candidate Release、四类 projection、validation receipt 与 stage digest。
Source/ref/precondition 在 candidate identity 建立前失败时不写 stage；candidate 编译完成后若 shared closure validation 失败，则在
一个事务内写入完整 stage header、四类 projection、VALIDATION/REJECTION receipts，并把逻辑上的 `STAGED -> REJECTED` CAS
一并提交，外部只观察完整 `REJECTED` stage。Validation PASS 才以 `STAGED` 对外可见。

### 2.3 Shared runtime validator

```ts
function verifySemanticReleaseEnvelope(
  candidate: unknown,
): Promise<VerifiedSemanticReleaseEnvelope>;

function validateSemanticRuntimeClosure(
  envelope: VerifiedSemanticReleaseEnvelope,
): Promise<SemanticRuntimeClosureValidationReceipt>;
```

`VerifiedSemanticReleaseEnvelope` 必须包含 exact scope/datasource/release/source、四类 projection 与 compiler identity。生产
`semantic-release-read-port`、stage validation 和 Worker smoke 只能调用这两个共享入口；不得各自维护近似 schema。

### 2.4 Worker smoke

```ts
type RunSemanticSuccessorSmokeCommand = {
  readonly schema_version: "run-semantic-successor-smoke-command@1.0.0";
  readonly command_id: string;
  readonly idempotency_key: string;
  readonly stage_id: string;
  readonly expected_stage_digest: ContentHash;
  readonly expected_worker_build_id: ContentHash;
};
```

输出 `semantic-runtime-smoke-receipt@1.0.0`，不创建正式 Q&A Run，不调用模型/provider：

```ts
type SemanticRuntimeSmokeReceipt = {
  readonly schema_version: "semantic-runtime-smoke-receipt@1.0.0";
  readonly receipt_id: string;
  readonly stage_id: string;
  readonly stage_digest: ContentHash;
  readonly candidate_release: ReleaseReference;
  readonly projection_digests: ProjectionDigestSet;
  readonly resolved_metric_id: "metric.order_revenue";
  readonly resolved_dimension_id: "dimension.order_month";
  readonly resolved_binding_hash: ContentHash;
  readonly plan_hash: ContentHash;
  readonly calendar_timezone: "Asia/Shanghai";
  readonly window_start: "2023-11-01T00:00:00.000Z";
  readonly window_end_exclusive: "2024-11-01T00:00:00.000Z";
  readonly validator_identity: VersionedHashReference;
  readonly worker_build_identity: RuntimeBuildIdentity;
  readonly outcome: "PASS" | "FAIL";
  readonly failure_code: string | null;
  readonly receipt_hash: ContentHash;
};
```

### 2.5 E4 semantic proof

`falcon24-semantic-release-authority-proof@2` canonical material：

```ts
type Falcon24SemanticReleaseAuthorityProofV2 = {
  readonly schema_version: "falcon24-semantic-release-authority-proof@2.0.0";
  readonly authority_epoch: "E4";
  readonly predecessor_release: ReleaseReference; // exact gen1
  readonly candidate_release: ReleaseReference;   // exact gen2
  readonly projections: ProjectionReferenceSet;   // executable/relationship/restriction/graph
  readonly change_set_ref: VersionedHashReference;
  readonly review_ref: VersionedHashReference;
  readonly source_snapshot_ref: VersionedHashReference;
  readonly compiler_bundle_ref: VersionedHashReference;
  readonly validation_receipt_ref: VersionedHashReference;
  readonly smoke_receipt_ref: VersionedHashReference;
  readonly expected_versions: {
    readonly semantic_pointer: number;
    readonly semantic_runtime: number;
    readonly workspace_defaults: number;
  };
  readonly proof_hash: ContentHash;
};
```

旧 generation-1 proof schema/builder 保留为 read-only history decoder，不能生成 E4 staging receipt。

### 2.6 Combined activation RPC

```sql
app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb) returns jsonb
```

Command exact keys：`schema_version`、`command_id`、`idempotency_key`、`scope`、`authority_epoch=E4`、
`expected_current_authority`、`expected_semantic_predecessor`、`stage_ref`、`smoke_receipt_ref`、`baseline_ref`、
`activation_attempt_ref`、`expected_versions`、`command_hash`。它只携带 refs/hash/CAS，不携带 projection payload。

Result 为 `combined-falcon24-semantic-activation-receipt@1.0.0`，绑定 exact E4 authority、generation 2 Release、workspace
defaults、stage、smoke、outbox event、transaction identity 与 `activation_receipt_hash`。

## 3. Storage and Contracts

### 3.1 `semantic.semantic_successor_release_stage`

| Field | Contract |
| --- | --- |
| Scope | `app_id`, `tenant_id`, `environment`, `semantic_domain` |
| Identity | `stage_id`, `command_id`, `principal_id`, `idempotency_key`, `idempotency_digest` |
| Predecessor | `predecessor_release_id`, `predecessor_generation`, `predecessor_release_digest`, `expected_pointer_version` |
| Source | `change_set_id/hash`, `review_id/hash`, `source_snapshot_id/revision/hash`, `compiler_version/bundle_hash` |
| Candidate | `target_generation`, `candidate_release_id`, `candidate_release_digest`, `datasource_id`, `stage_digest` |
| State | `status` = `STAGED | SMOKE_PASSED | REJECTED | PROMOTED`, `created_at`, nullable terminal timestamps |

约束：`target_generation=predecessor_generation+1`；同 scope/target generation 仅一个 `STAGED` 或 `SMOKE_PASSED` live row；
identity/payload fields 禁止 UPDATE；状态只能由 security-definer CAS RPC 前进。Validation failure 可在 stage 创建事务内完成
`STAGED -> REJECTED`，但不能暴露半写 `STAGED`。

### 3.2 `semantic.semantic_successor_projection_stage`

每个 stage 恰好四行：`EXECUTABLE`、`RELATIONSHIP`、`RUNTIME_RESTRICTION`、`GRAPH`。字段为 scope、`stage_id`、
`projection_kind`、`projection_id`、canonical `projection_payload`、`projection_digest`、`created_at`；唯一键
`(scope, stage_id, projection_kind)`。Payload/digest 插入后禁止 UPDATE/DELETE。

### 3.3 `semantic.semantic_successor_stage_receipt`

Append-only receipts：`VALIDATION`、`SMOKE`、`REJECTION`、`PROMOTION`。字段为 scope、`stage_id`、`receipt_kind`、
`receipt_id`、`receipt_schema_version`、`receipt_json`、`receipt_hash`、`created_at`。同 stage/receipt kind 可有多个尝试时必须有
独立 receipt identity，但状态机只接受与 current state/expected digest 对应的 receipt。

### 3.4 Formal history immutability

若既有正式 source release、runtime projections、graph binding/nodes/edges 尚无数据库级不可变保护，migration 10783 为它们增加
拒绝 UPDATE/DELETE 的 trigger，并撤销不必要的 direct DML。Promotion owner 只经 combined activation RPC 获得最小 INSERT 权限。

### 3.5 Hash domains

| Hash | Canonical domain |
| --- | --- |
| `projection_digest` | 单个 typed canonical projection payload |
| `release_digest` | generation 2 Release envelope，不含自身 digest |
| `stage_digest` | predecessor + source refs + candidate Release ref + 四类 projection refs，不含 stage status/timestamps |
| `validation_receipt_hash` | closure validation receipt，不含自身 hash |
| `smoke_receipt_hash` | deterministic plan/result/build receipt，不含自身 hash |
| `proof_hash` | E4 semantic authority proof，不含自身 hash |
| `activation_receipt_hash` | combined all-new binding/outbox receipt，不含自身 hash |

所有 TypeScript hash 必须由 PostgreSQL canonical hash 交叉校验。不同表中的相同字符串若属于不同域，也不得用相同字段名或比较逻辑
暗示等价。

## 4. Runtime Closure Contract

共享 validator 至少验证：

1. Envelope 与四类 payload 的 strict schema/version、unknown-field rejection、canonical digest。
2. Release/source/change set/review/compiler/snapshot 的 scope、datasource、generation 与 digest closure。
3. 所有 entity ID 唯一；所有引用存在并属于同一 datasource/Release。
4. Metric aggregation、formula、physical table/column binding、formula dependency 闭合。
5. Dimension physical binding、parent/child hierarchy、data type 与 filter/time semantics 闭合。
6. Relationship endpoints、join binding、cardinality/grain 引用闭合。
7. Formula AST slots 与声明 dependency 一一对应，无缺失/多余 slot。
8. Metric `time_domain`、`time_column` 与可执行时间 dimension/binding 闭合。
9. Runtime restriction 与 graph/source binding 闭合。
10. Quality constraint 只验证当前结构化合同能够证明的 ID/ref/severity/sensitivity；自由文本表达式不宣称字段级证明。

## 5. State Machine, Transaction and Lock Order

### 5.1 Stage state machine

```text
compiled + validation FAIL --same transaction--> REJECTED
compiled + validation PASS ---------------------> STAGED
STAGED --smoke PASS CAS--> SMOKE_PASSED --combined activation--> PROMOTED
   |
   +--smoke semantic failure CAS--> REJECTED
```

- `REJECTED`、`PROMOTED` terminal，不可 reopen。
- Worker crash before receipt/transition：保持 `STAGED`；相同 idempotency 可重放。
- 同 target generation 新修订使用新 `stage_id`，历史失败 stage append-only 保留。

### 5.2 Global lock order

所有可能同时触碰 Semantic 与 Falcon authority 的 RPC 必须按以下顺序：

1. `semantic.lock_semantic_authority_fence(scope, domain)`。
2. Falcon scope advisory lock / current authority lock。
3. `FOR UPDATE`：semantic active pointer。
4. `FOR UPDATE`：semantic runtime activation/pointer。
5. `FOR UPDATE`：workspace defaults/current version。
6. `FOR UPDATE`：Falcon current Epoch。
7. `FOR UPDATE`：candidate stage 与 exact smoke receipt。
8. `FOR UPDATE`：E4 baseline、activation attempt/session。

任何其他复合写入口必须复用同一顺序，避免相反锁序死锁。锁超时返回稳定 error，不做补偿写。

### 5.3 Combined activation transaction

`activate_falcon24_authority_with_semantic_successor` 在一个事务内：

1. 建立 capability/RLS context，按固定顺序取锁。
2. 校验 current exact=E3；semantic exact=generation 1；workspace defaults 指向 gen1；expected versions 全等。
3. 校验 stage=`SMOKE_PASSED`、target=current+1、validation/smoke receipts 与 stage digest exact。
4. 校验 E4 baseline/session/attempt=`STAGED` 且 semantic proof v2 exact 绑定 candidate/smoke。
5. 拒绝任何 E4 formal Run、effective config、Artifact、gate 或 diagnostic 污染。
6. 从 stage 插入正式 generation 2 source Release、三类 runtime projection、graph/source binding/nodes/edges，提交
   publish attempt 与 candidate status。
7. CAS 更新 semantic pointer/runtime pointer。
8. 以 old-gen1 exact ref/version 为前置条件 CAS workspace defaults 到 gen2 exact ref。
9. 激活 E4 baseline/session/current authority。
10. 写 semantic outbox、combined activation receipt，将 stage CAS 为 `PROMOTED`。
11. 返回 exact E4/gen2 binding。任一步失败整笔 rollback。

### 5.4 Crash and recovery

| Crash/failure point | Observable authority | Recovery |
| --- | --- | --- |
| Stage transaction before commit | 无 stage 或完整旧 stage | 同 idempotency 重放 |
| Shared validation fails after candidate compile | gen1/E3；完整 stage REJECTED | 新 ChangeSet/review/new stage_id |
| Smoke process exits | gen1/E3；stage STAGED | 同 smoke idempotency 重放 |
| Smoke semantic failure | gen1/E3；stage REJECTED | 修复 frozen inputs，new stage_id |
| Combined activation any statement fails | 完整 gen1/E3 | 修复原因后重新调用同一 idempotent activation command |
| Combined activation commits | 完整 gen2/E4 | 不回退；任何 frozen change 进入 E5 |
| Post-commit readback inconsistent | 数据库已提交 gen2/E4，视为严重故障 | 冻结所有执行并人工审计；禁止补写/回退 |

## 6. Finalizer and Gate Flow

### 6.1 Finalizer split

`prepareWorkspaceAuthority` 不得再从 current generation 1 自动推导 E4 semantic ref。顺序固定为：

1. `stageReviewedSuccessor` 生成并验证 gen2 stage。
2. Worker deterministic smoke；得到 PASS receipt。
3. 构造 proof v2 和 E4 `SEMANTIC_RELEASE` staging receipt。
4. 暂存其余 E4 receipts、baseline、session/attempt，但不激活。
5. 调用 combined activation RPC。
6. 提交后用生产 Semantic read port 与 Falcon authority port 重载并核对 pointer/runtime/defaults/current。

### 6.2 Diagnostic authority

新增 append-only diagnostic attempt/receipt authority；每个 E4 baseline/gen2 Release 同时最多一个 active attempt。E4-Q1 begin 必须
验证同一 E4 baseline、source/build、gen2 Release 的 PASSED diagnostic receipt。诊断固定真实业务问题，走完整模型/SQL/Python/UI
链，但不创建计分 slot。

诊断失败若需要 frozen closure 变更则进入 E5；若为已证明的外部依赖且 closure 未变，创建新 diagnostic attempt ID，不 resume Run。

### 6.3 Formal gates

- E4-Q1：G1=1、G2=5、G3=5、G4=5；strict zero retry，首败 HOLD。
- E4-C1：只绑定同 baseline 的 winning Q1；5 题 × COLD/WARM × 3 = 30；首败 HOLD。
- 每个 slot 从真实 Q&A composer 提交，经答案入口进入 exact Run Trace；禁止 API-only、直达 URL、`BLOCKED` 冒充 PASS。
- 必须证明 `Semantic -> Text2SQL -> SQL -> QueryEvidence -> typed Arrow -> Python operator -> AnalysisReport -> Chart`、
  QA/Trace receipt 同源与 residual=0。

## 7. Validation & Error Matrix

| Condition | Stable failure / terminal behavior |
| --- | --- |
| ChangeSet/review/snapshot/compiler ref 不存在、scope/hash 不同 | `SEMANTIC_SUCCESSOR_SOURCE_CLOSURE_INVALID`，无 stage |
| target generation != predecessor+1 | `SEMANTIC_SUCCESSOR_GENERATION_INVALID`，无 stage |
| expected pointer/version stale | `SEMANTIC_SUCCESSOR_POINTER_STALE`，无 stage |
| 同 idempotency key 不同 canonical input | `SEMANTIC_SUCCESSOR_IDEMPOTENCY_CONFLICT` |
| 四类 projection 非 exact 4 行或 digest 不闭合 | `SEMANTIC_RUNTIME_CLOSURE_INVALID`，完整 stage 原子 REJECTED |
| Metric/dimension/formula/join/time ref 越界 | 类型化 closure failure，stage REJECTED |
| Smoke stage/digest/build mismatch | `SEMANTIC_RUNTIME_SMOKE_FENCE_MISMATCH`，不改状态 |
| Smoke deterministic plan 无法解析 | FAIL receipt + stage REJECTED |
| Combined activation current 不为 exact E3/gen1 | `FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH`，全旧 |
| Stage 不是 SMOKE_PASSED | `FALCON24_COMBINED_ACTIVATION_SMOKE_REQUIRED`，全旧 |
| E4 baseline 未绑定 gen2/smoke | `FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH`，全旧 |
| E4 已有 Run/config/Artifact/gate/diagnostic 污染 | `FALCON24_E4_AUTHORITY_POLLUTED`，全旧 |
| workspace defaults CAS stale | `FALCON24_COMBINED_ACTIVATION_DEFAULTS_STALE`，全旧 |
| 锁超时/并发 winner 已提交 | 稳定 conflict；读取后只观察 all-old 或 all-new |
| Post-commit readback 不一致 | severe incident + execution freeze；禁止修补 |

## 8. Good / Base / Bad Cases

- **Good：** fixed reviewed ChangeSet -> server compile -> exact four projections -> shared validator PASS -> smoke PASS -> E4 staged ->
  combined transaction all-new -> production readback exact -> diagnostic PASS -> Q1/C1。
- **Base：** stage 已完整提交但 Worker 在 smoke 前退出；gen1/E3 保持 current，相同 smoke command 安全重放。
- **Bad：** CLI 提供 projection payload/digest，RPC UPDATE generation 1，再单独激活 E4。该路径同时违反历史不可变、单一 publisher、
  runtime proof 与原子切换。
- **Bad：** Combined activation 把 Semantic pointer 提交为 gen2 后再调用 Falcon activation。即使服务暂停，也存在数据库可观察的
  split-brain，不可接受。

## 9. Tests Required

### 9.1 Contracts

- Strict schema、unknown fields、hash-domain 混用、tamper、缺失/越界 refs。
- Proof v2 predecessor/candidate lineage、generation+1、smoke/validation binding；拒绝 predecessor equality 替代 lineage。

### 9.2 Shared validator

- Metric aggregation/formula/binding/dependency 正负例。
- Dimension binding/hierarchy/time 正负例。
- Relationship endpoints/join/grain 正负例。
- Formula AST slot/dependency 正负例。
- Quality constraint 只测试结构化可证明部分，明确不声明自由文本字段闭包。
- Runtime restriction、graph/source/datasource/release mismatch 正负例。

### 9.3 Publisher and migration

- Same-key replay、different-payload conflict、transaction rollback、client payload/digest injection impossible。
- PostgreSQL 17 fresh install 与 exact E3 fixture upgrade。
- Upgrade pre/post 比较 generation 1/E1-E3 counts、hash、documents、projection bytes 完全相同。
- Immutability trigger、RLS、grants、capability scope 与 direct DML denial。

### 9.4 Concurrency and failure injection

- 每个 combined activation statement 前/后注入失败，外部连接只能读到 all-old 或 all-new。
- 两个 concurrent activation command 只允许一个 winner；无死锁或 partial current。
- Defaults old-gen1 precondition 与 gen2 postcondition均断言。

### 9.5 Smoke, Finalizer and gates

- Smoke exact stage load、零 model/provider calls、PASS/REJECT/replay/process interruption。
- Finalizer 顺序、proof v2、staged-only before activation、post-commit readback；无 predecessor equality。
- Diagnostic authority one-active、immutable receipts、Q1 begin dependency。
- 真实集成证明 SQL/QueryEvidence/Arrow/Python/Chart/Trace UI 与 residual zero。

## 10. Wrong vs Correct

### Wrong

```ts
await repairGeneration1Projection({ payload, digest });
await finalizeFalcon24Authority({ epoch: "E4" });
```

### Correct

```ts
const stage = await authority.stageReviewedSuccessor(capability, refsAndExpectedCasOnly);
const smoke = await worker.runSemanticSuccessorSmoke(stage.stage_id);
const e4 = await stageFalcon24E4Baseline({ stage, smoke });
await authority.promoteStagedSuccessor(capability, combinedActivationRefsOnly(e4, stage, smoke));
await verifyAllNewThroughProductionPorts(e4, stage);
```

## 11. File Boundary

### Contracts

- `packages/contracts/src/artifacts/semantic-lifecycle.ts`
- `packages/contracts/src/evals/falcon24-authority-baseline.ts`
- `packages/contracts/src/runs/authority-epoch.ts`
- 对应 contract tests 与 public exports。

### Semantic

- `packages/semantic/src/production/publisher.ts`
- `packages/semantic/src/production/publication-projection.ts`
- 新增 `packages/semantic/src/production/runtime-closure-validator.ts`
- `packages/semantic/test/semantic-publication-lifecycle.spec.ts` 与 validator tests。

### Platform

- `packages/platform/src/runs/postgres-authority-epoch.ts`
- `packages/platform/src/semantic/falcon24-retained-authority-proof.ts`
- Semantic PostgreSQL adapter/exports/tests；复用现有 publication kernel，不创建第二 adapter authority。

### Worker

- `apps/worker/src/semantic/semantic-release-read-port.ts`
- 新增 stage smoke runtime/CLI 与 tests；package script 仅接收 stage/ref/idempotency。

### Web

- `apps/web/src/lib/postgres-semantic-publication.ts`
- `apps/web/src/cli/finalize-falcon24-authority.ts`
- Diagnostic/qualification controls 与 tests。
- `bootstrap-falcon24-e1.ts` 只能阻止未来环境暴露无效 current；不得用于修补既有 generation 1。若 fresh bootstrap 仍生成历史
  gen1，服务 admission 必须保持关闭，随后通过同一 successor stage/smoke/combined promotion 建立 gen2 后才开放 Web/Worker。

### Database/spec/runbook

- 10783：successor stage storage、immutability、stage/smoke CAS、combined activation RPC、renderer/registry/support。
- Diagnostic authority 若评审选择独立边界，则使用后续 forward migration，不回写 10783。
- 更新 Falcon gate、Agent runtime、E4 runbook 与本 Trellis 任务文档。

## 12. Rejected Alternative

未提交的 generation 1 repair 实现保留审计但不执行。它允许 CLI 传 projection bytes、由窄 RPC UPDATE 历史 payload，再让
Finalizer验证新 bytes；该模式仍是第二 publish authority，并且不能将 gen2 semantic promotion 与 E4 current/defaults 原子绑定。
因此它不是临时方案，也不能作为 migration backfill。

## 13. Open Review Questions

1. **Quality constraint contract：** W1 是否仅验证当前可结构化字段并明确缩小声明（建议），还是本轮先结构化 expression refs 并承担
   额外 migration/compatibility scope？
2. **Diagnostic storage migration：** diagnostic authority 放入 10783，还是作为 W6 的独立后续 migration（建议独立，避免核心
   activation migration 同时承载 gate policy）？
3. **Fresh bootstrap admission：** 由部署编排显式执行 gen2 stage/smoke/promotion，还是 bootstrap 命令内部调用相同 Port；无论选择哪种，
   Web/Worker readiness 都必须在 gen2 current 前 fail closed，且不能出现专用 repair path。

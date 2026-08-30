# Falcon24 Semantic Generation 2、E4 原子恢复与 E5 前向构建权威 — Design

> 最新设计权威（2026-08-29）：以本文第 25 节“四层业务门禁与持续执行技术设计”为准。前文保留历史设计与证据；
> 与第 25 节冲突的 16+30、零修复预算或内部首败终止条款已被覆盖。

> W1-W7 已于 2026-08-28 实施并全量验证，用户已批准 exact review packet 与 W8。10795 已应用，`e430` 已封存为 HOLD；clean build
> 上唯一一次 `e431` Finalizer 因旧 smoke 幂等键未绑定 Worker build 而失败关闭，current 仍为 E3/gen1，且没有 `e431`/E4 污染。
> W8-R3 与 10796 已应用；随后只运行一次 `e432` Finalizer，新 build smoke PASS 已 append，但 combined RPC 因错误比较两个哈希域而
> HOLD。用户已批准 W8-R4；修复已提交为 `04d5db4e`，但权威库尚未执行 e432 HOLD/10797/e433。current 仍为 E3/gen1；
> `e432` 保留 STAGED baseline/session 与 OPEN attempt，等待受控执行。
>
> 2026-08-29 amendment：W8-R4 已完成且 E4/gen2 已原子激活。E4 build attestation 后验发现遗漏 Turbo `excludedOutputs`，
> 因而不可复现；E4 已冻结，用户授权前进 E5。本文第 17 节为 E5 的权威设计，冲突时覆盖旧 W9/W10 的 E4 标签。

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

### 2.1A Fixed ChangeSet and human review preparation

后继 migration 10792 在正式 successor stage 之前增加 review-preparation 域：

- `semantic_successor_review_preparation` append-only 绑定 predecessor exact ref、pointer CAS、固定 ChangeSet、candidate revision 与 review
  packet；`scope + idempotency_key` 唯一，允许另一名同 scope 授权操作员继续同一 packet。
- `semantic_successor_review_decision_document` append-only 保存严格 `semantic-review-decision@1.0.0`；backend 仅能按 capability/RLS
  SELECT 该证据，不能直接 DML。
- `prepare_falcon24_successor_review(jsonb)` 只接受 server-verified ChangeSet 和 expected CAS，创建 `WAITING_REVIEW` candidate 与
  `HUMAN_REVIEW` packet；不写正式 Release/pointer/runtime/E4。
- `human_record_semantic_review_decision(jsonb)` 是治理 Port 唯一真人入口；服务端重算 review hash，满足 quorum 后才把 candidate 推进
  `APPROVED`。Finalizer 与 review-preparation CLI 都不能调用它自动批准。
- `prepare_falcon24_successor_publish_attempt(jsonb)` 只消费 exact closed APPROVED packet/review document，把 candidate CAS 到
  `PUBLISHING` 并创建幂等 `PREPARED` attempt；仍不写正式 Release/pointer/runtime/E4。
- 普通治理 `getPacketDetail` 对该 packet 必须 fail-closed 重算 packet digest 与 ChangeSet hash，并返回
  `semantic-successor-review-evidence@1.0.0` 的 exact append-only payload；列表和详情 quorum 必须来自
  `quorum_rules_snapshot` 与真实 decision rows，不能使用 UI placeholder。用于 diff/impact 的显示投影只能从已验证 ChangeSet 派生，
  不能替代或省略 exact evidence。
- `prepare_falcon24_successor_review` 的幂等 replay 必须返回 candidate 当前真实状态，不能把历史首写状态冒充当前状态；Publication Port
  与 review CLI 必须保留 successor 可达的 review/publish 状态。`REJECTED`、`REVIEW_EXPIRED`、`STALE_REBASE_REQUIRED` 等非成功终态
  随后由发布准备稳定拒绝，而不是被适配器误判成损坏响应。

Web 的 `buildFalcon24SuccessorChangeSet` 只能执行固定仓库脚本并再次调用 `verifySemanticChangeSet`。CLI 不接收 ChangeSet、review、
projection 或 release digest；专门的 review-preparation CLI 只打开 packet。普通治理 API 必须先向真人展示上述 exact evidence；若部署
存在消费该 API 的治理 UI，可由 UI 完成同一流程，但没有可用 UI 时不得声称已产生 UI 审核证据。真人批准后，Finalizer 重新构建同一
ChangeSet、重放 preparation、读取批准文档并准备 attempt，随后才进入唯一 `stageReviewedSuccessor`。

### 2.1B Legacy bootstrap dependency closure

旧 generation 1 由早于通用 publisher fence 合同的 greenfield bootstrap 发布：正式 Release、三类 projection、validation、
COMMITTED publish attempt 与 active/runtime pointer 完整，但 `semantic_catalog_fence` 和 `semantic_dependency_pointer` 缺失。
Finalizer 因此在创建 successor stage 之前返回 `SEMANTIC_SUCCESSOR_DEPENDENCY_POINTER_REQUIRED`。该 HOLD 不是 stage failure；
只读 postcondition 必须证明 successor stage、E4 baseline/session/diagnostic 全为零，current 仍为 exact E3/gen1。

Migration 10794 是唯一允许的恢复路径：它要求 10793 exact frontier、PostgreSQL 17、E3/gen1 exact closure 与零 successor/E4
污染，只从 immutable generation-1 bootstrap receipt/policy/attempt/release/restriction 重新推导 catalog epoch/schema digest、
dependency generation、compiler bundle digest 与 closure policy digest。它只 INSERT 缺失的 catalog fence、dependency pointer 和
ledger；不 UPDATE/DELETE 历史，不 stage candidate，不移动任何 pointer。两行必须同时缺失或同时 exact，partial state 稳定失败。

全局锁/执行顺序不变：10794 在 Finalizer 之外先独立提交并完成 populated-upgrade hash Oracle；之后新的 clean build 才可重新进入
`semantic fence -> active/runtime pointer -> candidate/review/attempt -> stage -> smoke -> Falcon locks/current`。因此 provisioning
不与 combined activation 争夺或倒置锁，也不把维护窗口当作事务正确性。

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

1. 服务端重建固定 ChangeSet，重放/打开 human review packet；没有 exact APPROVE document 时停止。
2. `prepareApprovedSuccessor` 读取严格 review document 并创建唯一 `PREPARED` publish attempt。
3. `stageReviewedSuccessor` 生成并验证 gen2 stage。
4. Worker deterministic smoke；得到 PASS receipt。
5. 构造 proof v2 和 E4 `SEMANTIC_RELEASE` staging receipt。
6. 暂存其余 E4 receipts、baseline、session/attempt，但不激活。
7. 调用 combined activation RPC。
8. 提交后用生产 Semantic read port 与 Falcon authority port 重载并核对 pointer/runtime/defaults/current。

提交后的 authority closure 通过后继 migration 10791 提供的
`load_falcon24_semantic_authority_closure(jsonb)` 读取。命令只包含 `semantic_domain`，服务端从当前 capability/RLS scope
解析 tenant、deployment 和 principal；单个 `REPEATABLE READ` 快照必须同时返回 current Falcon authority、semantic pointer、
semantic runtime 和 workspace defaults。四者任一缺失、跨 scope、Release ref 不一致或 schema 无效都 fail closed，不能用多次普通
查询拼成“看似一致”的 readback。正式 generation 2 envelope 则由既有 successor authority 按 exact
`semantic_domain + release_id` 加载；Finalizer 同时核对 closure、PROMOTED stage 与 combined receipt。

### 6.2 Diagnostic authority

新增 append-only diagnostic attempt/receipt authority；每个 E4 baseline/gen2 Release 同时最多一个 active attempt。E4-Q1 begin 必须
验证同一 E4 baseline、source/build、gen2 Release 的 PASSED diagnostic receipt。诊断固定真实业务问题，走完整模型/SQL/Python/UI
链，但不创建计分 slot。

实现使用后继 migration 10790（设计评审时预留的 10784 已被 Root Harness 的 10784-10789 占用）：

- `falcon24_diagnostic_attempts` 冻结 attempt/run、exact E4 binding、generation 2 Release、source fingerprint、Web/Worker build
  identities、固定问题及 manifest hash。唯一 partial index 只允许同一 baseline/gen2 closure 一个 `ACTIVE` attempt。
- `falcon24_diagnostic_receipts` 为 append-only terminal receipt；attempt 仅允许 `ACTIVE -> PASSED|FAILED`，任何终态都不能 resume
  原 Run。失败只允许 `FROZEN_CLOSURE_CHANGE_REQUIRED` 或 `EXTERNAL_DEPENDENCY`。
- `begin_falcon24_diagnostic` 在写入前同时核对 current E4、PROMOTED generation 2 stage、semantic pointer/runtime 和 workspace
  defaults；Platform adapter 必须在同一 transaction 设置 `app.semantic_domain=falcon24`。若 E4-Q1 已开始则拒绝，防止诊断后补。
- `complete_falcon24_diagnostic` 的 PASS 必须从同一 exact Run 读取已持久化 `QA_E2E` + `TRACE_UI` browser receipts，核对五个 exact
  Artifact、完整页面路径和 `falcon24-sandbox-reclamation-receipt@3` 的 residual=0。命令中的
  `observed_execution_path` 仅记录执行完成后实际发生的 Tool/Artifact 顺序；Root 仍逐轮只决定当前下一次 Tool Call，Host 不据此
  选择或调度后续业务能力。
- `falcon24-qualification-manifest@3` 增加 exact diagnostic receipt ref。E4-Q1 只接受 v3；原 v2 仍只用于非 E4 历史/后继入口。
  PostgreSQL wrapper 在同一事务中验证 PASSED receipt 后调用既有唯一 qualification authority，旧 pre-diagnostic mutator 不向
  backend 授权。
- Web `falcon24:diagnostic:control` 以 manifest/submit/status/trace/complete/fail 命令控制一个非计分 attempt。浏览器 claim 只传递
  deterministic idempotency，不携带 formal acceptance fence；实际 Q&A 仍从真实 composer 创建并进入答案页 Trace UI。
- Worker `falcon24:diagnostic:reclaim` 只加载同一 active attempt、核对 runtime attestation、回收 exact Run 并输出 residual=0 receipt；
  不调用 Qualification/Campaign authority。Web complete 再由 PostgreSQL 原子核对 Run、UI receipt、五 Artifact 与 reclamation closure。

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
| 固定 ChangeSet 尚无 exact human APPROVE document | `SEMANTIC_SUCCESSOR_APPROVED_REVIEW_REQUIRED`；保留 review packet，gen1/E3 不变 |
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
- `packages/platform/src/runs/postgres-falcon24-semantic-closure.ts`
- `packages/platform/src/semantic/falcon24-retained-authority-proof.ts`
- Semantic PostgreSQL adapter/exports/tests；复用现有 publication kernel，不创建第二 adapter authority。

### Worker

- `apps/worker/src/semantic/semantic-release-read-port.ts`
- 新增 stage smoke runtime/CLI 与 tests；package script 仅接收 stage/ref/idempotency。
- `apps/worker/src/evals/falcon24-diagnostic-reclamation-cli.ts`；只消费 diagnostic attempt，不 claim formal gate。

### Web

- `apps/web/src/lib/postgres-semantic-publication.ts`
- `apps/web/src/cli/finalize-falcon24-authority.ts`
- `apps/web/src/cli/falcon24-diagnostic.ts`、E4 qualification v3 receipt binding 与 browser deterministic diagnostic claim tests。
- `bootstrap-falcon24-e1.ts` 已退役为纯 fail-closed admission guard：无确认返回 `NOT_RUN`，有确认也只返回
  `FALCON24_E1_BOOTSTRAP_RETIRED_SEMANTIC_SUCCESSOR_REQUIRED` 与 `NO_GENERATION_1_WRITES`。它不连接数据库、不创建 gen1、也不编排
  publisher。现有 exact E3 环境只通过 `finalize:falcon24-authority` 使用唯一 successor Port 与 combined E4 activation。

### Database/spec/runbook

- 10783：successor stage storage、immutability、stage/smoke CAS、combined activation RPC、renderer/registry/support。
- 10791：refs-only Falcon24 semantic authority closure readback RPC；不写数据、不扩 backend 表级 SELECT。
- Diagnostic authority 若评审选择独立边界，则使用后续 forward migration，不回写 10783。
- 更新 Falcon gate、Agent runtime、E4 runbook 与本 Trellis 任务文档。

## 12. Rejected Alternative

Generation 1 repair 实现只保存在 `audit/rejected-generation1-repair-2026-08-28` 命名审计 stash 中，不进入工作树或执行路径。它允许
CLI 传 projection bytes、由窄 RPC UPDATE 历史 payload，再让 Finalizer 验证新 bytes；该模式仍是第二 publish authority，并且不能将
gen2 semantic promotion 与 E4 current/defaults 原子绑定。因此它不是临时方案，也不能作为 migration backfill；禁止 restore/drop/执行。

## 13. Approved Review Decisions

用户于 2026-08-27 以“执行”批准按推荐默认项推进：

1. **Quality constraint contract：** W1 只验证当前可结构化字段、严格 schema、唯一 identity、severity/sensitivity；自由文本 expression
   不声明字段级闭包。若未来需要字段引用证明，必须新增结构化合同与兼容 migration，不能回填解释旧文本。
2. **Diagnostic storage migration：** W6 使用独立 migration；实施时因 10784-10789 已被 Root Harness 合法占用，实际编号前进为
   10790，避免修改历史 migration，也避免让 10783 核心原子激活 migration 同时承载 diagnostic/gate policy。
3. **Fresh bootstrap admission：** 因 combined activation 合同要求 exact E3 predecessor，旧 E1 bootstrap 不得伪造 E3 或建立另一套
   promotion authority；它被退役为纯 fail-closed guard。现有 E3 恢复只走唯一 Finalizer/Port，gen2 current 前 Web/Worker 保持关闭。

## 14. W8-R2 Pre-baseline Recovery Design

### 14.1 Root cause and immutable fix

Commit `148889cad4a79112baf923fee19923f0dbf1fb35` 改变了三个 Semantic Skill body，也正确推进了 Semantic Product Profile，
但遗漏 Skill revision 2 -> 3。专用库中 revision 2 是已经发布的不同 immutable bytes，因此该事实不是可丢弃的旧数据损坏。
修复只在源码把三个 Skill 目标 revision 推进为 3；`materializeBuiltinTeamProfiles` 仍通过现有 list/CAS/commit Port 追加新 revision 并推进 head。

### 14.2 State machine

```text
begin E4 staging -> STAGED
  supporting receipts / Team materialization fail before baseline
    -> hold_falcon24_authority_staging_session(exact CAS) -> HOLD
  all supporting receipts accepted
    -> semantic receipt -> baseline -> activation attempt -> combined activation -> CONSUMED
```

HOLD 是终态；旧 receipt 保留且不可改写。旧 `e430` 封存后，下一次 Finalizer 使用新 staging id。RPC 在同一事务中按
Falcon staging advisory -> current authority row -> exact staging session row 的顺序加锁；baseline 存在时拒绝该 recovery path，
由既有 activation-attempt HOLD authority 负责 post-baseline 失败，避免两条 HOLD 权威重叠。

### 14.3 Failure handling

`stageFalcon24E4SuccessorAuthority` 只包围 baseline 之前的 supporting receipt verification。原始稳定错误会成为 session failure code；
HOLD 成功后继续抛出原错误。若 HOLD 自身失败，则返回 `FALCON24_E4_STAGING_HOLD_FAILED`，并将原错误与 HOLD 错误保留为内部 cause，
禁止继续 baseline/activation。独立恢复 CLI 要求 confirmation、E4、staging id、expected retained-assets hash 与稳定 failure code；
它先通过正常 capability authority 核对 current=E3，再调用同一 Port，不直接执行 SQL。

## 15. W8-R3 Build-bound Smoke Revalidation Design

### 15.1 Root cause and identity contract

`stageIdentity` 只覆盖 ChangeSet/review/source snapshot/compiler/predecessor，因此不同 Worker build 对同一 stage 会得到同一旧 smoke key；
但 `semantic-runtime-smoke-receipt@1.0.0` 明确包含完整 `worker_build_identity`，新 build 必然产生不同 receipt/command hash。10783 的原始
RPC 将 same key/different command 正确判为 conflict，所以问题在调用端幂等身份，不是 stage 或历史 receipt 损坏。

```text
smoke_identity = canonical_sha256({
  schema_version: falcon24-e4-successor-smoke-identity@2.0.0,
  stage_identity,
  worker_build_identity
})
smoke_idempotency_key = stable_uuid("falcon24:E4:semantic-smoke-idempotency:" + smoke_identity)
```

### 15.2 RPC state machine and lock order

10796 不建第二 authority，也不修改 10783 历史 migration；它在同一函数签名上前向演进：

```text
same key + same command                      -> exact receipt replay
same key + different command                 -> IDEMPOTENCY_CONFLICT
STAGED + PASS + new key                      -> append SMOKE; CAS SMOKE_PASSED
STAGED + FAIL + new key                      -> append SMOKE + REJECTION; CAS REJECTED
SMOKE_PASSED + PASS + new build-bound key    -> append SMOKE; stage/timestamps unchanged
SMOKE_PASSED + FAIL                          -> FENCE_MISMATCH; append/update count = 0
REJECTED/PROMOTED + new key                  -> FENCE_MISMATCH
```

锁顺序保持 `semantic authority fence -> exact stage FOR UPDATE -> receipt uniqueness check`。same-key replay 在 terminal/status fence 之前，
确保进程丢失响应后仍可读取原 receipt；任何新写先验证完整 receipt/hash/closure，再检查 receipt hash 唯一性并 append。

### 15.3 Crash recovery and activation binding

- 进程在 Worker 验证后、RPC 前中断：无新 receipt；同 build 派生同 key 可安全重放。
- RPC commit 后、Finalizer 收包前中断：same key/same command 返回 exact 已写 receipt，不追加第三份。
- revalidation FAIL 或幂等冲突：事务回滚，current 仍 E3/gen1，stage 仍 `SMOKE_PASSED`。
- revalidation PASS：Finalizer 只消费本轮返回的 exact receipt hash 构造 proof；combined activation 失败仍整笔 all-old。

### 15.4 File boundaries and tests

- Web：`finalize-falcon24-authority.ts` 只负责 build-bound key；不选择或伪造 receipt。
- Database：10796 source/rendered SQL/manifest 只演进 `semantic.commit_semantic_successor_smoke(jsonb)` 的受控状态机与 grants。
- Tests：helper 覆盖同 build replay/不同 build divergence；migration 测试覆盖 exact 10795 baseline、无 receipt UPDATE/DELETE、ACL 与历史快照；
  PostgreSQL 17 exact clone 覆盖 append PASS、replay、conflict、FAIL rollback 和 scratch cleanup。

## 16. W8-R4 Activation Hash-domain and Attempt-closure Design

### 16.1 Verified root cause

10783 combined RPC 当前要求：

```sql
semantic_source_revision.source_digest = stage.source_snapshot_hash
```

实际 authority contract 是：

```text
source_revision.source_digest = stage.change_set_hash
  = sha256:5dbd303d8ecd34b1e98ae936314d7a90e18b8832594049678c9ed3aec996ee72

stage.source_snapshot_hash
  = sha256:2f7c897391912725829b6751c29d1374ab06b2c02ab94953f0b47a09cd1f2bb2
```

前者绑定 reviewed ChangeSet，后者绑定 physical schema snapshot；不相等是正确状态。只读重算证明 DB-side expected proof hash 与
SEMANTIC_RELEASE staging receipt evidence 均为
`sha256:4af0f2980ed0bd14b0fbeb5b7d76377c2bb8c2390418fd1c8a54fd06ea83ddeb`；baseline/ref/attempt/session、6 receipts、review、dependency、
publish attempt、candidate head 与 4 projections 的其余 fence 全部通过。

### 16.2 Forward RPC correction

10797 只演进现有 `activate_falcon24_authority_with_semantic_successor(jsonb)`：

```sql
exists semantic_source_revision(
  revision_id = stage.source_revision_id,
  source_digest = stage.change_set_hash)

exists semantic_candidate_revision(
  revision_id = stage.candidate_revision_id,
  source_revision_id = stage.source_revision_id,
  revision_digest = stage.change_set_hash)
```

保留所有既有 command/proof/smoke/default/lock/atomic promotion fence；禁止用删除 source-revision 检查、比较任意 digest 或修改 stage 行来绕过。

### 16.3 Post-baseline failure state machine

```text
STAGED baseline + OPEN attempt
  combined activation PASS -> one transaction ACTIVE/PROMOTED/E4/gen2
  combined activation FAIL -> same call returns error; Finalizer immediately calls holdActivationAttempt
                            -> attempt/baseline/session become HOLD in existing authority transaction
  process crash before HOLD -> explicit confirmation-gated recovery CLI calls the same Port with exact refs/reason
```

`e432` 必须先按后一条 recovery path 终结为 HOLD。HOLD 后新 Finalizer 使用 `e433`；不得复用/清空 `e432` receipts、baseline 或 attempt。

### 16.4 Tests and crash windows

- Migration static/PG17：exact 10796 baseline，function owner/ACL/lock order不变，错误 hash-domain 条件消失，source+candidate revision closure完整。
- Populated clone：迁移前后 successor receipt/stage 与 Falcon e430/e432 session/baseline/attempt ordered canonical bytes不变。
- Finalizer：promote failure 调用 exact hold once；hold failure 返回专用 stable code；success path不调用 hold。
- Recovery CLI：confirmation、exact attempt/baseline/hash/reason、same-reason replay、different-reason conflict；CLI 禁止直接 query/DML。
- Concurrency/failure injection：combined RPC 仍只观察 all-old/all-new；failure 后 closure 最终为 HOLD，不留下可被下一 attempt 误用的 OPEN。

### 16.5 Implemented evidence

- Scoped implementation commit：`04d5db4e`；10797 rendered checksum：
  `sha256:c5afa3d4b8babc91b61b2bd3d6f3edc18324502254270d08e8d63049dc18e984`。
- Finalizer 的 catch 只包围 `promoteStagedSuccessor`。成功、receipt mismatch、post-commit readback mismatch/failure 均不调用 HOLD；
  promote failure 调用 exact HOLD once，HOLD failure 以 `FALCON24_E4_ACTIVATION_HOLD_FAILED` 保留双 cause。
- 新 `hold:falcon24-authority-activation` CLI 要求显式 confirmation 与 exact attempt/baseline/hash/reason，只调用 capability authority 和
  `holdActivationAttempt` Port。
- PostgreSQL 17 exact clone：10797 apply 后 E3/gen1/Open 仍 all-old；HOLD first/replay/conflict 通过；无效 CAS 完整 rollback；两个并发
  valid command 返回同一 receipt，最终只观察 E4/gen2/defaults gen2/stage PROMOTED。
- Web full 135 files / 556 passed + 1 skipped；Platform full 111 files / 685 passed；Contracts full 99 files / 951 passed；
  Web/Platform/Contracts typecheck、10797 renderer、workspace migration inventory、Biome、diff check 全部 PASS。
- 临时 scratch databases 已删除，未创建 Docker container，权威 `data_agent` 在文档提交时仍为 frontier 10796、E3/gen1、e432 OPEN。

## 17. E5 Retained-Semantic Epoch Rollover

### 17.1 First-principles boundary

需要改变的是被 Falcon baseline 冻结的 build closure，不是 semantic Release。generation 2 已由唯一 publisher 编译、smoke 并原子发布，
且 production pointer/runtime/defaults exact 一致。为修复 attestation 而制造 generation 3 会产生没有业务语义变化的伪 successor；原地重签 E4
又破坏 Epoch 冻结。因此最小正确状态变换为：

```text
all-old: Falcon E4 + semantic gen2 + attestation v1 (immutable historical)
  -> stage E5 supporting receipts + retained-semantic proof + attestation v2
  -> activate_falcon24_authority(request@3) in one PostgreSQL transaction
all-new: Falcon E5 + the exact same semantic gen2 + attestation v2
```

### 17.2 Build attestation v2

Turbo task identity 规范化为：

```ts
interface TurboBuildTaskIdentity {
  task_id: string;
  package_name: string;
  directory: string;
  task_hash: string;
  outputs: readonly string[];
  excluded_outputs: readonly string[];
}
```

Parser 从 dry-run 的 `outputs` 与 `excludedOutputs` 分别读取，排序、去重并验证相对 glob；output walker 只以 `outputs` 为 include，
只以 `excluded_outputs` 为 exclude。二者同时进入 task signature 与 attestation hash。v2 reader 只接受 exact keys；v1 reader 继续按历史字段和历史
hash 公式校验，但不能用于创建 E5 identity。cache mutation characterization 必须证明 exclude 的执行语义，而不仅是 JSON 中出现该字段。

### 17.3 Retained semantic proof and activation command

`falcon24-retained-semantic-release-authority-proof@1.0.0` 由服务器从 production closure 构造，绑定：

- expected current E4 exact binding 与 target E5；
- gen2 release/datasource/digest；semantic pointer、runtime pointer、workspace defaults exact version；
- executable、relationship、runtime-restriction、graph projection digests；
- Web/Worker build ID 与 generation ID；
- proof hash 独立哈希域。

Semantic staging receipt 的 `subject_hash=gen2 release_digest`，`evidence_hash=retained proof hash`。客户端只传 scope、expected exact refs、
staging/baseline/attempt id 与 idempotency key；不传 projection payload/digest 或 proof hash。

既有 `activate_falcon24_authority(jsonb)` 增加 request@3 分支：

```ts
{
  schema_version: "falcon24-activation-request@3.0.0";
  authority_epoch: "E5";
  attempt_id: UUID;
  baseline_id: UUID;
  expected_baseline_hash: Hash;
  expected_current_authority: AuthorityBindingV2; // exact E4
  expected_semantic_release: SemanticReleaseRef;  // exact gen2
  expected_versions: {
    semantic_pointer: number;
    semantic_runtime: number;
    workspace_defaults: number;
  };
  retained_semantic_proof_hash: Hash;
  command_hash: Hash;
}
```

v2 分支保持 E2/E3 历史行为；v3 仅接受 target ordinal >=5、exact `current+1`、generation >=2。Port 不再用“epoch >=4”粗粒度拒绝，而是 E4 semantic
successor 仍只能走 combined RPC，E5+ retained semantic 只能走 request@3。

### 17.4 Transaction and lock order

10798 对 v3 使用固定顺序：

```text
semantic scope fence advisory lock
-> Falcon activation advisory lock
-> Falcon current FOR UPDATE
-> semantic active pointer FOR UPDATE
-> semantic runtime pointer FOR UPDATE
-> workspace defaults pointer/revision FOR UPDATE
-> E5 staging session/baseline/activation attempt FOR UPDATE
-> supporting receipts FOR SHARE
```

随后验证 exact E4/current、exact gen2 三指针、retained proof 与 SEMANTIC_RELEASE receipt、baseline 六 receipt、E5 零 Run/config/artifact/
diagnostic/qualification/campaign/gate 污染。提交只更新 attempt/baseline/session/Falcon current；semantic/defaults 行不得 UPDATE。事务后再次用 production
ports readback，并比较迁移/激活前后的 semantic rows canonical bytes。

### 17.5 Diagnostic and formal gates

Diagnostic v2 与 Qualification manifest v4 以 canonical successor epoch 代替 E4 literal，并派生 `${epoch}-Q1`；DB 从 current authority 与
exact diagnostic receipt 验证 E5。Acceptance campaign 已使用 epoch-derived identity，继续要求同一 winning E5-Q1。E4 原有零行不会回填。

执行顺序仍是动态 Agent Tool Loop：Root 每轮只决定下一 Tool Call，Tool Result 回到 Root 后再决策；Host 只验证当前 call、scope、artifact、
安全、预算、幂等与最大轮数，不声明业务 DAG。诊断及每个正式 slot 都必须由 composer 提交并从答案入口进入 exact Trace UI。

### 17.6 Crash and recovery matrix

| Window | Observable state | Recovery |
|---|---|---|
| build/attestation failure | E4/gen2 | 修复未冻结代码，生成新 E5 candidate；不触库 |
| E5 stage/supporting failure | E4/gen2 + terminal HOLD stage | 新 staging identity；不删历史 |
| v3 activation failure | E4/gen2 all-old | exact attempt capability HOLD；禁止补写 |
| v3 activation commit | E5/gen2 all-new | 不回退；后续 frozen change 进入 E6 |
| diagnostic first failure | E5 diagnostic immutable FAIL/HOLD | 停止，不 retry |
| Q1/C1 first failure | exact E5 gate HOLD | 停止，不 resume/拼接 |

### 17.7 File boundary and validation matrix

- Build：`scripts/lib/workspace-build-integrity.ts`、release/entry consumers、`tests/workspace-build-integrity.spec.ts`。
- Contracts：authority activation v3、retained proof、diagnostic v2、qualification v4 与 tests。
- Platform：PostgreSQL authority/diagnostic/qualification adapters 与 tests。
- Web：E5 Finalizer、diagnostic/qualification controls、package scripts 与 tests。
- Worker：diagnostic reclamation 的 epoch-derived fence 与 tests。
- Database：10798 source/rendered SQL、registry/inventory、fresh + exact E4 clone fixtures。
- Docs/Trellis：本任务 PRD/design/implement 与 E5 runbook/evidence index。

负例必须覆盖 excludedOutputs 丢失/伪造、cache/non-cache mutation、stale E4/ref/version、gen3 injection、proof hash-domain 混用、E5 污染、RLS 越权、
事务失败注入、并发双激活、诊断/资格跨 epoch receipt 和 campaign 未绑定 winning Q1。

## 18. E6 diagnostic first-failure audit

### 18.1 Observed state

E6 retained activation 已提交，且 semantic Release 仍为 exact generation 2。唯一正式 diagnostic 的事件序列只到：

```text
1 run.accepted
2 run.leased
3 run.tool_started  model.request@1.0.0
4 run.tool_failed   PROVIDER_PROFILE_NOT_AVAILABLE
5 run.failed        PROVIDER_PROFILE_NOT_AVAILABLE, retryable=false
```

没有 Semantic/Text2SQL/SQL/Analysis Artifact，也没有 Provider dispatch。`PROVIDER_PROFILE_NOT_AVAILABLE` 表示 Effective Model 没有 exact
`AVAILABLE` execution profile；由于 `AGENT_PROFILES` 是 Falcon baseline 的 frozen supporting proof，修复属于
`FROZEN_CLOSURE_CHANGE_REQUIRED`。不能创建第二 diagnostic attempt，不能开始 Q1/C1，也不能在 E6 内补 profile。

### 18.2 Terminal receipt persistence defect

现有 authority 的 `begin` 调用在事务内设置 `app.semantic_domain=falcon24`，但 `complete` 调用遗漏该参数。10798 的
`complete_falcon24_diagnostic(jsonb)` 在完成 FAIL 前读取 semantic pointer/runtime；pointer 另有 scope-only SELECT policy，而 runtime
只有要求 `app.semantic_domain` 的 policy。因此 forced RLS 下 runtime row 不可见，合法 FAIL command 被稳定拒绝为
`FALCON24_DIAGNOSTIC_SEMANTIC_RELEASE_MISMATCH`。数据库只读核对的 pointer/runtime/attempt release id、generation 和 digest 没有漂移。

不得以 superuser SQL、直接 DML、临时第二 adapter 或未绑定 E6 的源码执行来制造 receipt。现场保持：Run=`FAILED`、diagnostic
attempt=`ACTIVE`、terminal receipt count=0、E6-Q1/E6-C1=0、production gate=`HOLD`。若未来获批继续，必须先把
`semantic_domain` 事务上下文和 exact AVAILABLE provider profile 纳入新的前向 epoch 方案，同时设计如何在不改写 E6 历史的条件下终结该
orphan ACTIVE attempt；不能 resume 原 Run。

### 18.3 Stop and cleanup

首次正式诊断失败触发 hard stop。Web、Worker 与本任务 OpenSandbox server 已停止；OpenSandbox list 和 Worker sweep 均为 residual=0；
轮换 auth profile、临时 secret、OpenSandbox DB/config 和本地 build 备份已删除。Docker 只保留既有四个长期容器。

## 19. E7 atomic diagnostic recovery and provider execution closure

### 19.1 State and storage

10799 是 10798 之后的唯一 forward migration，不修改已发布 SQL。新增候选域：

```text
falcon24_llm_execution_certification_stage
  S + target_epoch + staging_id + stage_id
  profile/config/resource/provider/model
  certification Artifact ref + receipt hash + execution_profile_hash
  deployment id/hash + recovery capabilities
  proof_hash + status(STAGED|PROMOTED|REJECTED)
```

身份字段插入后不可变；只有窄 RPC 可做 `STAGED -> PROMOTED|REJECTED`。认证 store 的 E7 staging method 仍验证权威 live-smoke draft、
ACTIVE certification Run/fence、scope 和 canonical content，但把 Artifact 写为 `is_active=false` 并在同事务写 stage binding。普通 commit 路径
保持原语义。execution-profile reader 对 Falcon current E7+ 只接受 current epoch 的 PROMOTED binding、active Artifact、exact LLM receipt
proof 三者闭包；因此候选不会改变 E6 runtime。

### 19.2 Contracts and ports

- `falcon24-llm-execution-authority-proof@1.0.0`：服务器从 staged certification、model catalog、deployment 与 build identity构造。
- `falcon24-activation-request@4.0.0`：保留 v3 retained material，并增加 exact
  `predecessor_diagnostic_failure` 与 `llm_execution_stage_ref`。CLI 不提交 receipt bytes、projection payload、credential 或自报 digest。
- `falcon24-retained-activation-result@4.0.0`：返回 E7 authority binding、E6 diagnostic receipt ref/hash 与 promoted certification ref/hash。
- `PostgresFalcon24AuthorityEpoch.activateRetainedWithRecovery` 演进现有 adapter 并仍调用
  `app_data_agent.activate_falcon24_authority(jsonb)`；不创建平行 activation RPC。
- `ModelCertificationReceiptStore.stageFalcon24Successor` 是现有权威 store 的候选写阶段；live smoke draft brand 与 generic commit 相同，不能由 CLI
  结构化对象伪造。

### 19.3 Lock order and transaction

全局顺序固定为：

```text
semantic fence
-> Falcon activation advisory
-> Falcon diagnostic advisory
-> Falcon current
-> semantic pointer/runtime
-> workspace defaults pointer/revision
-> predecessor E6 diagnostic attempt/run/events
-> E7 certification stage/artifact
-> E7 baseline/activation attempt/session/receipts
```

request@4 在锁内重验 E6 exact current、gen2、stage/baseline、零 E7 Run/gate污染，以及 E6 Run 的唯一失败事件。随后由同 transaction 构造标准
`falcon24-diagnostic-complete@1.0.0` FAIL command并调用唯一 completion function；验证其 receipt 后推广 certification、激活 E7。任一步失败
整笔回滚。成功后 postcondition 再验证 E6 receipt、current E7、profile binding 和 semantic/defaults unchanged。

### 19.4 Provider certification flow

一个非计分、非 diagnostic 的 E7 preparation Run 只用于 live certification。专用 Worker CLI 通过现有 repository/queue/event/fence authority
完成 accept -> lease -> leased event -> live DeepSeek smoke -> staged receipt -> terminal Run；不直接 INSERT/UPDATE Run/Artifact。CLI 先验证 credential
存在、target=E7、current=E6、正式 E6 diagnostic 已失败但尚无 receipt、E7 target zero-pollution；任一 preflight 失败时零写入。该 Run 不得作为
diagnostic/Q1/C1 evidence。

### 19.5 Crash recovery

| Window | Observable state | Recovery |
|---|---|---|
| credential/config preflight fail | E6 orphan ACTIVE，无 preparation Run | 补齐 secret 后用同 deterministic operation；不算 formal retry |
| live smoke fail | certification Run terminal FAIL，无 staged candidate | 修复外部 credential/profile；新 preparation Run，E6 formal diagnostic不重试 |
| staged certification commit 后崩溃 | E6 current，inactive candidate STAGED | same-key load/replay；reader仍不可见 |
| E7 stage/baseline fail | E6 current + terminal HOLD target；candidate仍不可见 | 新 staging id；旧 candidate可受控 REJECT |
| request@4 任一步失败 | E6 diagnostic仍 ACTIVE，certification仍 inactive，current E6 | exact target attempt HOLD；修复代码后前进新 epoch/staging |
| request@4 commit | E6 diagnostic FAILED + E7/profile all-new | 不回退；后续 frozen change前进 E8 |
| E7 diagnostic/Q1/C1 首败 | exact immutable FAIL/HOLD | 立即停止，不 retry |

### 19.6 Tests and file boundary

- Contracts：request/result/proof strict schema、hash domain、epoch+1、错误 failure class/code/ref。
- Platform：diagnostic domain context、activation v4 proof correlation、certification staging adapter；错误不得泄漏 SQL/secret。
- Worker：credential zero-write preflight、live-smoke brand、Run/fence、candidate replay/conflict、secret redaction。
- Web：E7 Finalizer 顺序、LLM proof lineage、v4 commit/readback、pre/post-commit error boundary。
- Database 10799：candidate table/RLS/grants、list reader visibility、unique RPC evolution、populated history snapshot、all-old/all-new concurrency。
- Runbook/Trellis：E7 exact identities、single-run evidence、Trace UI、residual 和 cleanup。

PostgreSQL fixtures必须覆盖：inactive candidate在 E6 不可见；错误 profile/config/deployment/receipt hash失败；activation rollback不写 E6 receipt；
成功只产生一个标准 diagnostic receipt并推广一个 certification；same-command replay返回同一 result；v3 E5/E6历史 replay语义不变。

## 20. E8 forward-only provider selection repair

### 20.1 Observed defect and state fence

E7 activation binding为 baseline `b56b8ce2-fc16-572f-a821-30b7d506b90c` / activation
`1f3f080c-d1f7-5ad2-a839-37fc5e94cab7`。E6 receipt、E7 stage与artifact均正确提交，原始 provider profile的七个 identity字段也与 stage完全相等；
10799 public wrapper只因 record-variable/table-alias混用未选中 stage。10800不得 `create or replace` 后让 current E7立即得到新语义。设计采用
epoch dispatch：把10799 wrapper保留为 `list_provider_execution_profiles_pre_e8()`；新 public wrapper在 current `<E8` 完整委托它，在 E8+
才执行使用 `row.activation_attempt_id` 的修正查询。

### 20.2 E7 closure failure receipt

新增表 `app_data_agent.falcon24_epoch_closure_failure_receipts`，identity为 scope + receipt_id，唯一约束 exact authority binding + failure code；
payload/DELETE不可变。record RPC只接受 expected authority、E7 stage ref和幂等identity，服务端锁 current/stage并读取 original/public profile documents：

```text
original profile == stage exact seven-field binding
public reader      == STALE + selectable=false
current            == exact E7 activation bound to PROMOTED stage
```

满足后服务器生成 evidence hash与receipt hash，写
`FROZEN_CLOSURE_CHANGE_REQUIRED / PROVIDER_PROFILE_BINDING_NOT_SELECTED`。load RPC只返回同一canonical document。该 receipt在 E8 staging前
提交；它不修改E7 baseline、reader、diagnostic或gate。

### 20.3 Activation v5 and lock order

request@5 = retained v3 material + `predecessor_closure_failure_ref` + `llm_execution_stage_ref`。E8使用fresh build-bound live certification stage。
10800 wrapper锁序固定：semantic fence -> Falcon advisory -> current -> semantic/defaults -> E7 failure receipt -> E8 stage/artifact ->
target baseline/LLM receipt -> retained activation core。成功前设置transaction-local stage/attempt fence，执行
STAGED->PROMOTED和artifact inactive->active，然后用重新哈希的v3 command调用已冻结 retained core；全部同事务。

public reader的E8分支只接受 target=current、status=PROMOTED、stage activation attempt=current activation attempt以及七字段完全相等的profile；
其余历史 AVAILABLE profile统一降级STALE。结果@5回传 exact failure receipt与certification binding供Platform复核。

### 20.4 Crash and test matrix

| Window | Observable state | Recovery |
|---|---|---|
| 10800 install | current E7，public reader仍STALE | record immutable E7 failure；不得诊断 |
| E7 failure record | current E7 + append-only HOLD evidence | stage fresh E8 candidate |
| E8 certification/staging | E7 + inactive E8 candidate | same-key replay或新stage，非formal |
| request@5 rollback | E7 + E8 candidate仍STAGED/inactive | 修复未冻结E8代码后重新证明 |
| request@5 commit | E8 + candidate PROMOTED/active/AVAILABLE | 开始唯一E8 diagnostic |

测试覆盖strict schema/hash domain、receipt server recomputation、E7 behavior byte equality、E8 alias修正、RLS/grants、artifact immutability、
failure injection、双连接concurrency、v2-v4历史兼容、fresh/exact E7 upgrade，以及post-readback semantic/defaults canonical equality。

## 21. E9 dedicated current-profile certification resolution

### 21.1 Proven boundary mismatch

E8 production capability transaction 返回的 profile 是 exact `AVAILABLE`，但其 certification ref 指向 E7：

```text
current Falcon: E8 / c988e145-5914-5255-80c0-087256835f26
profile: 0e9a602e-4af0-5d69-a227-3906a703d28b / config 2 / AVAILABLE
certification Run: ad93b6e9-5545-55b2-bba3-f46cd0927116 / E7
certification Artifact: 1dfdece2-4c8c-4a40-b670-3e751a3d36a5 / E7
execution profile hash: sha256:998dbe7f3020fada0a741b612ae7a8648eca48968f8940cdfff70152af7b7965
```

`createPostgresModelCertificationReceiptStore.resolve/verify` 委托通用 Repository；该 Repository 的 current-authority
join 要求 `run.authority_epoch=current` 且 Artifact baseline/activation 与 current 相同。因此 E7 receipt 在 E8 返回
`null/false`。公开 list 与 transport resolver 使用了不同的 authority predicate，形成读后不可执行裂缝。

### 21.2 Authority split

保留通用 Artifact resolver 的 current-Epoch约束。新增窄 RPC：

```text
app_data_agent.resolve_current_provider_execution_certification(jsonb) -> jsonb
```

命令只带 `schema_version + model_profile_id + model_config_version + certification_receipt_ref`。数据库从当前 capability
重新解析 current epoch、current activation、唯一 `PROMOTED` stage 与 immutable Artifact；重算 ref、content hash、
execution profile hash、profile/config/provider/model/deployment 闭包后才返回 certification claims。它不接受任意 Artifact
ID，不返回 credential/URL/header，也不授予通用历史 Artifact 读取能力。

Worker 数据流改为：

```text
list_provider_execution_profiles
  -> exact AVAILABLE technical projection
  -> resolve_current_provider_execution_certification(exact ref)
  -> verifyModelExecutionCertificationClaims
  -> authorizeAvailableExecutionModelProfile
  -> transport authorization
```

list、claims resolver 与 transport envelope 必须三重核对同一 profile/config/ref/execution hash。任一步失败只返回稳定
authority reason，不做 provider dispatch。

### 21.3 E9 activation v6

10801 把当前 activation function 重命名为 `activate_falcon24_authority_pre_e9`，新 wrapper 对 v2-v5 原样委托；v6
只允许 canonical successor E(n+1)，并绑定已终结的 predecessor diagnostic receipt：

```text
falcon24-activation-request@6.0.0
  retained v3 fields
  predecessor_diagnostic_receipt:
    attempt_id/run_id/manifest_hash/receipt_hash
    failure_class/failure_code
  llm_execution_stage_ref
```

数据库验证 diagnostic=`FAILED`、Run=`FAILED`、receipt=`FAIL`、terminal hash 与 command exact，且 failure class 为
`FROZEN_CLOSURE_CHANGE_REQUIRED`。随后推广 fresh E9 certification candidate，并调用 frozen retained v3 core 完成
baseline/session/current 切换。E8 diagnostic 已有 receipt，因此 v6 不再次调用 completion authority。

### 21.4 State and crash windows

| Window | Observable state | Recovery |
|---|---|---|
| E9 live smoke 前失败 | current E8，无 E9 stage | 修复外部 credential 后重新 preparation；不触碰 E8 formal Run |
| E9 stage commit 后崩溃 | E8 + STAGED/inactive | 同 key load/replay；public/dedicated resolver 均不可见 |
| baseline/activation staging HOLD | E8 + immutable target HOLD | 新 staging/attempt；旧 target 不复用 |
| request@6 任一步失败 | E8 + STAGED/inactive | 整事务回滚，target attempt HOLD；修复 frozen closure 时前进新 Epoch |
| request@6 commit | E9 + PROMOTED/active + dedicated resolver PASS | 不回退；下一 frozen change 前进 E10 |
| formal attempt failure | immutable FAIL/HOLD | 不 retry；内部 closure 缺陷以前向 Epoch继续 |

### 21.5 Files and tests

- Contracts：`packages/contracts/src/runs/authority-epoch.ts` v6 request/result 与 negative matrix。
- Platform：`packages/platform/src/runs/postgres-authority-epoch.ts` v6 adapter；Provider current-certification resolver port/adapter。
- Worker：`apps/worker/src/providers/production-run-bound-provider-dispatcher.ts` 改用专用 resolver；测试证明 generic resolver
  不再参与 production profile authorization。
- Web：retained finalization/CLI 对 E9+ 使用 terminal diagnostic receipt recovery，post-activation 同时核对 public profile 与
  dedicated resolver。
- Database：10801 source/rendered/registry；fresh、exact E8 upgrade、history hash、RLS/grants、rollback/replay/concurrency。
- Docs：Falcon runbook、Trellis PRD/design/implement 和 evidence index。

负例至少覆盖：wrong current/stage/status/activation、wrong profile/config/ref/hash、inactive artifact、claims tamper、cross-scope/
principal、v6 old/non-terminal diagnostic、failure hash drift、E9 stage/build mismatch、partial promotion 与 generic Artifact access widening。

## 22. E10 versioned current-certification resolver

### 22.1 Frozen E9 boundary

10801 activation 已成功提交，故 v1 resolver 的 ambiguous alias 已属于 E9 frozen closure。10802 不能替换它。新增
`falcon24_finalization_failure_receipts` 保存 exact E9 authority、PROMOTED E9 stage、旧 resolver identity、observed
SQLSTATE `42702`、definition/evidence/receipt hashes。record RPC 在 advisory lock 与 current/stage row locks 下由服务器
构造 certification ref，并在嵌套 exception block 中调用 v1；只有捕获 `ambiguous_column` 才能写 receipt。表级
UPDATE/DELETE trigger、forced RLS、scope unique key 与 idempotency conflict 保证 append-only。

### 22.2 Versioned read authority

新增 `resolve_current_provider_execution_certification_v2(jsonb)`；命令/结果 schema 前进到 `@2.0.0`，payload 仍只含
profile/config/exact receipt ref。函数使用 `cert_stage_row`、`cert_artifact_row` 等互不重名 alias，并重算 stage/current/
Artifact/claims/deployment 闭包。current ordinal `<10` 返回 NOT_AVAILABLE，因此安装 10802 后 E9 的可观察执行语义仍由
失败的 v1 冻结；只有 E10 原子切换后 v2 才可返回 claims。Worker production dispatcher 只调用 v2，通用 Artifact
resolver与 v1 均不作为 fallback。

### 22.3 Activation v7

request@7 = retained v3 material + `predecessor_finalization_failure_receipt` + `llm_execution_stage_ref`。10802 将 10801
wrapper冻结为 `activate_falcon24_authority_pre_e10`，v2-v6完整委托；v7 锁定并重验 E9 failure receipt、fresh E10
stage/artifact、model/deployment和 E10 baseline/LLM receipt，transaction-local fence 后推广 candidate，再以重新哈希的
v3 command调用 retained core。结果@7返回 failure ref与 certification binding。锁序固定为 semantic fence -> Falcon
activation advisory -> current -> semantic/runtime/defaults -> failure receipt -> candidate -> target baseline，所有失败只观察
E9/STAGED/inactive或 E10/PROMOTED/active，不存在混合状态。

### 22.4 Crash and test matrix

| Window | Observable state | Recovery |
|---|---|---|
| 10802 install | current E9；v1仍42702，v2 NOT_AVAILABLE | record exact E9 finalization failure |
| failure receipt commit | E9 + append-only receipt | fresh E10 certification；不得改 receipt |
| E10 stage commit | E9 + STAGED/inactive | same-key preparation replay；v2仍不可见 |
| request@7 rollback | E9 + candidate STAGED/inactive | 修复未冻结 E10 candidate代码后新 target attempt |
| request@7 commit | E10 + PROMOTED/active + v2 PASS | 开始唯一 E10 diagnostic；不回退 |
| formal diagnostic/Q1/C1 首败 | immutable FAIL/HOLD | 立即停止，不 retry/resume |

测试覆盖 v1 E9 exact failure、v2 E9 fence/E10 success、server-observed 42702 receipt、strict v7 hash domain、RLS/grants、
history snapshots、fresh/exact E9 upgrade、failure injection、replay与双连接 all-old/all-new。文件边界为 Contracts provider/
epoch contracts、Platform provider/epoch adapters、Worker dispatcher、Web recorder/Finalizer、10802 source/rendered/manifest与对应测试。

## 23. E11 task-scoped Specialist logical-call recovery

### 23.1 Proven identity collision

四个 Root turn 的 accepted child task identity 分别不同，但当前 Specialist logical call material 为：

```text
data-agent/team-runtime@1\0provider:text2sql
data-agent/team-runtime@1\0provider:text2sql:repair:1
```

它没有 child `task_id` 或 Root turn delegation identity。`RunExecutionContext` 正确地在同一 Run 内拒绝已消费 logical ID，
因此第二个 child task 的首次 Text2SQL Provider call 被误判为旧调用重放。修复后的唯一公式为：

```text
specialist_call_id = stable_uuid({
  namespace: "data-agent/specialist-provider-call@2",
  run_id,
  task_id,
  stage,
  call_index
})
```

`task_id` 已由 Host admission 从 `run + root turn namespace + tool_call_id` 确定性生成并持久化，不依赖模型自报。
同 task/同 stage/同 index 仍是同一 logical call；不同 task 即使 Profile/stage/objective 相同也属于不同的当前 Tool Call。

### 23.2 Failure feedback without leaking candidates

Text2SQL compiler/AST/runtime 已产生 allowlisted stable error code。候选修复循环继续只在内存中把 rejected candidate和安全
diagnostic code交给同一 Specialist；invalid candidate不提交 Artifact。预算耗尽时只把 safe code作为 Root Tool Result 的
`error_code`，未知或不合规 code回退通用 `TEAM_TEXT2SQL_CANDIDATE_POLICY_REJECTED`。Run event仍不保存 raw SQL、参数、Prompt或
Provider response。这样 scratch canary能定位 contract mismatch，但不会扩大公开数据面。

### 23.3 No database migration and E11 activation path

E11 不需要新表、列或 RPC。现有 request@6/response@6 合同与 10801 RPC 从一开始就接受 canonical target ordinal `>=9`，
并在锁内要求 `target=current+1`、exact terminal diagnostic receipt、fresh certification stage与 retained gen2 closure；10802 对 v6
完整委托 frozen pre-E10 implementation。新增 request@8 或 10803只会复制现有 authority。

Web Finalizer 从“ordinal决定 recovery kind”改为“target最低版本 + exactly-one server-loaded predecessor evidence”：

```text
E7       -> legacy diagnostic recovery v4
E8       -> closure failure v5
E9+      -> terminal diagnostic v6 OR finalization failure v7 (exactly one)
target>=E10 certification readback -> v2 resolver
```

E10历史仍使用 finalization failure v7；E11使用 E10 terminal diagnostic v6。两条路径均通过同一 retained staging、同一
`activate_falcon24_authority(jsonb)` 与同一 post-readback，CLI不接受 receipt bytes、proof hash、projection或candidate payload。

### 23.4 State, locks and crash recovery

```text
E10 current + immutable diagnostic FAIL
  -> fresh E11 live certification STAGED/inactive
  -> E11 supporting receipts/baseline/OPEN attempt
  -> request@6 transaction
       semantic fence -> Falcon activation advisory -> diagnostic advisory
       -> current -> semantic/runtime/defaults -> E10 diagnostic/run/receipt
       -> E11 stage/artifact -> E11 baseline/LLM receipt
  -> E11 current + stage PROMOTED/artifact active + gen2 unchanged
```

| Window | Observable state | Recovery |
|---|---|---|
| build/certification前失败 | E10 + immutable FAIL | 修复未激活 E11 code，fresh preparation；不触 E10 Run |
| certification commit后崩溃 | E10 + E11 STAGED/inactive | same-key load/replay；E10 reader不可见 |
| baseline/activation失败 | E10 + target HOLD，candidate inactive | 新 staging/attempt；旧 target不复用 |
| request@6 rollback | E10 + E11 STAGED/inactive | all-old；禁止补偿 DML |
| request@6 commit | E11 + PROMOTED/active + gen2 unchanged | production ports核对后才运行正式 diagnostic |
| E11 formal failure | immutable FAIL/HOLD | 不 retry；内部 closure缺陷前进 E12+ |

### 23.5 Files and tests

- Worker：`apps/worker/src/teams/production-team-tools.ts` 与 tests；task-scoped identity、safe rejection code、同 context
  cross-turn regression。
- Web：`apps/web/src/lib/falcon24-retained-finalization.ts`、Finalizer CLI与 tests；evidence-driven E9+ recovery、E11 v6、
  target>=E10 v2 resolver readback、exactly-one config。
- Specs/Trellis/runbook：Agent Team runtime identity和 E11 evidence。
- Database：无 migration文件；只重跑现有 v6 exact E10 populated clone、rollback/replay/concurrency/RLS 与 protected-history snapshot。

测试矩阵必须覆盖同 task replay、跨 task相同 stage、repair index、跨 Run、safe code fallback、E11 request@6 proof splice、
同时提供/完全缺少 predecessor evidence、E10 v7 regression、v2 readback mismatch、scratch canary和正式 Trace UI。

## 24. E11 Terminal Closure design override

本节覆盖 23.4 中“E11 formal failure进入 E12+”的恢复动作。E11之后无 successor；状态机只允许
`FREEZE -> SCRATCH_PREFLIGHT -> SCRATCH_CANARY -> LIVE_STAGE -> LIVE_ACTIVATE -> DIAGNOSTIC -> Q1 -> C1 -> AUDIT -> COMPLETE`
或从任一步进入 `HOLD -> AUDIT`。禁止跳边、回边、重试正式节点或另建业务路径。

### 24.1 Authority and identity fences

- owning-code commit固定 `8cefa61a`；文档证据提交与运行 attestation分别记录，不得借文档提交吸收产品代码变更。
- Scratch和live都复用现有 request@6、v2 resolver、`activate_falcon24_authority(jsonb)`及固定锁序；没有新schema/RPC。
- certification stage、candidate baseline/release、Web/Worker identity与attestation必须四方exact。identity mismatch在事务前失败关闭；
  只读证明确认为同HEAD stale preflight输入时才可用新幂等key重建stage，不能UPDATE旧stage。
- Scratch Canary和Formal节点使用不同authority域；dev Run永远不能成为Diagnostic/Q1/C1 prerequisite。

### 24.2 Runtime and evidence fence

Root每轮只决定当前Tool Call。Subagent ToolResult以结构化观察返回Root；下一轮只能通过普通`input_artifact_refs`引用已验收
Artifact。Host只校验当前call，不预排业务DAG。`SemanticQueryContext -> SqlArtifact -> QueryEvidence -> typed Arrow ->
AnalysisReport/Chart`的每条边必须同Run、同release/datasource/schema、accepted-before-consume。Trace只允许从exact答案入口进入。

### 24.3 Terminal failure matrix

| Failure | Durable evidence | Terminal action |
|---|---|---|
| stale stage/build identity | old stage保持inactive；新key同HEAD重建最多2次 | 再次mismatch则HOLD |
| third product defect/code change required | 当前Run/command/error摘要 | HOLD，无E12/修复 |
| scratch canary FAIL/crash after submit | 唯一Run、event/artifact/error | HOLD，不重新提交 |
| live activation rollback/readback mismatch | all-old或严重postcondition evidence | HOLD，不补偿DML |
| Diagnostic/Q1/C1首次FAIL | immutable FAIL/HOLD receipt | HOLD，不retry/resume |
| audit/history drift | hash/row/byte diff | HOLD，禁止改历史 |

两种终态都执行凭据、浏览器、Web/Worker、OpenSandbox、scratch container/volume清理；COMPLETE还必须有Diagnostic、16/16、30/30
和residual=0，任何缺项都只能HOLD并提交可接手handoff。

## 25. 四层业务门禁与持续执行技术设计（最终覆盖）

本节覆盖本文先前的 16+30 门禁、E11 后禁止内部修复和“首个内部缺陷直接终止”设计。E1-E10 历史不变；当前 E11 尚未激活，
因此四层门禁合同、代码与 build 在 scratch 证明后作为 fresh E11 closure 激活。若 E11 正式运行后发现新的内部 frozen-closure
缺陷，则保存 E11 失败事实并以前向 Epoch 自动恢复，不修改或重放失败 Run。

### 25.1 Gate authority 与数据模型

现有 `10774/10779` 把资格门禁硬编码为 16 slots，Campaign 又固定 30 slots，不能无损表达 5/2/2/6 的四层题库。
实现使用验证后的下一 migration frontier（当前预计 `10803`）新增 append-only 四层 gate authority，而不修改旧表、旧函数或历史行：

```text
four_layer_gate_attempt
  scope: app/tenant/environment/principal
  gate_id + attempt_id + authority_epoch + baseline/build/release hashes
  manifest_hash + status + current_layer + next_turn + terminal_receipt

four_layer_gate_turn
  layer + scenario_id + turn_index + expected_agent_contract
  conversation_id + conversation_resource_version + run_id
  question_hash + answer_hash + public_event_hash
  accepted_artifact_refs + business_receipt
  qa_ui_receipt + trace_ui_receipt + terminal_status
```

`begin -> claim_turn -> record_business -> record_qa_ui -> record_trace_ui -> finalize_turn -> finalize_attempt` 全部通过 server-owned
RPC、expected version、advisory/row lock、RLS 与幂等 key 仲裁。上一层完整 PASS 才能 claim 下一层；业务 FAIL 后 UI receipt 必须保持
空；任何 code/build/release hash 变化都不能继续旧 attempt。旧 Qualification/Campaign 只保留历史读取，不再是完成条件。

题库、顺序、期望 Agent 范围、公式/术语 rubric、是否需要表格/图表、L4 Conversation 分组以及 UI/Trace 合同共同计算 manifest hash。
Evaluator sealed Oracle 仍与生产上下文隔离，不能把 gold SQL、期望答案或固定调用链注入 Root。

### 25.2 Root 动态 Tool Loop 与语义 fallback

Host 只给 Root 冻结的 Conversation history、Agent Cards、当前可调用工具、预算与已验收 Artifact，不根据题号选择 Agent。
门禁在 Run 完成后观察实际 Tool/Task 序列并评分：L1 恰好一个 Specialist，L2 恰好 Semantic 与 Text2SQL 两个能力且后者消费前者
已验收 context，L3/L4 允许 Root 根据 Tool Result 动态继续 Analysis/Report/Chart。

Semantic 解析链固定为治理机制而非业务硬编码：

```text
exact term/formula lookup
  -> missing: decompose requested concept
  -> bind governed metric/dimension/relationship/time primitives
  -> synthesize request-scoped executable interpretation
  -> continue Semantic answer or hand off exact context
  -> only when multiple interpretations materially change the answer: ask one concise clarification
```

缺失命中、索引 reason code、候选检索状态只进入安全内部 Trace；用户答案说明采用的口径和可调整项，不把内部缺失当成拒答。
request-scoped 解释不自动写回 Published Semantic Release，也不允许模型自行发明物理 Join 或发布全局公式。

### 25.3 单次模型调用、后置 UI/Trace 检查

正式 turn 使用真实 `/w/:workspaceId/qa` composer 提交一次并冻结 Run。浏览器等待 durable terminal event，随后 Gate Evaluator 先读取
同一 Run 的公开事件、accepted Artifact、Oracle/公式结果和最终 answer：

```text
submit once -> wait terminal -> business rubric
  FAIL -> persist failure -> repair loop（不做深度 UI/Trace）
  PASS -> same Run QA page checks -> click answer trace entry -> exact Trace checks -> finalize turn
```

QA/Trace 检查由固定 selector、URL/Run/Conversation identity、DOM 可见性、Artifact hash 和 refresh/replay 断言完成；不通过另一个
聊天模型重新提问。仅当 CSS/rendering 无法由 DOM 判断时保存截图供失败诊断，不能用截图替代 exact authority receipt。

Q&A Agent 页面验收覆盖 composer、streaming/activity、terminal answer、Markdown/table/chart preview、error/loading、刷新恢复与 L4 连续消息。
Trace 验收必须从答案按钮进入，覆盖 exact focus、Root/Subagent/Tool 公开事件、Artifact lineage/preview、Run 切换、返回对话和刷新恢复。
桌面 1440px 是逐 Run 正式 viewport；全部通过后复用已保存 Conversation 做一次 390px 展示 smoke，不重新调用模型。

### 25.4 L4 Conversation/Run 恢复

每个 L4 场景固定一个浏览器 session 与一个 Conversation，三轮分别创建三个 Run。Run admission 冻结当时的
`conversation_id + resource_version + ordered visible_messages`；后一轮新增消息不能污染前一 Run。Provider summary 明确标记为
untrusted context，不是 Semantic/Data Artifact。

当前合同首期仍要求事实在 current Run 重新验证；如果后续开放跨 Run Artifact 复用，只能由 server 选择同 workspace/conversation、
exact accepted/hash-match 的引用。无论是否重新查询，上一轮 assistant prose 都不能进入 `accepted_artifact_refs`。刷新或 SSE 中断时从
PostgreSQL events 恢复 exact Run cursor；已存在 terminal/tool/artifact checkpoint 时不得重复 Provider/SQL/Sandbox side effect。

### 25.5 无人值班控制器

```text
PREFLIGHT
  -> SCRATCH_VERTICAL_CANARY
  -> LIVE_STAGE_ACTIVATE
  -> L1 -> L2 -> L3 -> L4
  -> FINAL_AUDIT_CLEANUP -> COMPLETE

business/internal failure
  -> persist FAILED attempt
  -> CLASSIFY -> MINIMAL_REPRO -> TDD_FIX -> FOCUSED_CHECK -> SCOPED_COMMIT
  -> CLEAN_BUILD -> SCRATCH_CANARY -> fresh epoch/attempt -> L1

external condition unavailable
  -> CHECKPOINT -> RUN_INDEPENDENT_BACKLOG
  -> WAITING_EXTERNAL (ACTIVE, non-terminal)
  -> deterministic backoff probe -> condition ready -> RESTORE -> resume checkpoint
```

同一可重试基础设施错误最多同构重放两次；第三次相同 fingerprint 自动转为最小复现和代码/配置诊断，而不是继续盲重试或结束。
每个独立修复都有 focused test 与 scoped commit，staging 只包含任务拥有文件。服务、浏览器或上下文中断后读取 attempt/Run/checkpoint
恢复。外部 credential、外部系统强制审批、长期服务不可达或需要额外生产授权时进入非终态 `WAITING_EXTERNAL`：先扫描并完成
所有不依赖该条件的 backlog；没有独立工作后关闭昂贵的瞬态 Web/Worker/Sandbox，以 `5m -> 15m -> 30m`、最高 30 分钟的确定性
backoff 探针复查 Secret Resolver、审批 document 或服务 health。探针不调用模型、不创建 Run、不写正式 gate；条件满足后自动重建
环境并从 exact checkpoint 继续。

四层门禁的 request-scoped Semantic fallback 不产生全局 Candidate，因此不要求真人语义批准。如果未来工作确实产生治理 Candidate，
Agent 只可准备 DRAFT/review packet，不能冒充 reviewer；该分支等待期间主控制器仍继续其他工作。受保护历史、Secret 和安全门禁不能
靠自动审批、手工 DML、日志取密或降低校验绕过。任务状态始终保持 `in_progress`，直到全部验收进入 `COMPLETE`。

### 25.6 Crash windows

| 窗口 | 可观察状态 | 恢复 |
|---|---|---|
| gate claim 前崩溃 | 无 Run | 同幂等输入重新 claim |
| Run 已创建、浏览器断开 | RUNNING/terminal events 持久化 | 重连 SSE/trajectory；不重新 submit |
| business PASS、UI 未检查 | business receipt 已写，UI receipt 空 | 直接恢复同 Run 页面检查 |
| QA PASS、Trace 未检查 | QA receipt 已写 | 从答案入口恢复 exact Trace，不提新问题 |
| turn finalize 前崩溃 | receipts 齐全、next_turn 未推进 | 幂等 finalize |
| 正式业务 FAIL | attempt immutable FAILED | 门禁外修复；新 build/attempt 从 L1 开始 |
| live activation rollback | predecessor all-old | 修复后 fresh stage；禁止补偿 DML |
| live activation commit | successor all-new | readback后继续或保存失败并前向恢复 |

### 25.7 主要改动边界

- Contracts/Evals：四层 manifest、turn/attempt receipt、题库 rubric 与 deterministic evaluator。
- PostgreSQL/Platform：下一 frontier 的 append-only four-layer authority、RLS、adapter、fresh/populated/rollback/replay/concurrency tests。
- Worker：Semantic fallback、Root Tool observation/turn recovery、L1-L4 route/evidence负例；不增加 case router。
- Web：四层 gate controller、同 Run business/UI/Trace 分阶段 receipt、L4 same-session submission、页面恢复测试。
- Specs/Runbook/Trellis：废止 16+30 完成条件，记录无人值班状态机、硬阻断和最终证据索引。

严禁修改 E1-E10 history、复用失败 Run、Direct QA、固定 SQL/业务 DAG、API-only UI PASS、把 assistant 文本当证据、把 request-scoped
语义解释静默发布为全局定义，或将 `production_isolation=false` 描述为生产 GO。

### 25.8 F6 四层失败的前向恢复输入

2026-08-31 只读复核：live E11 baseline `4afa8ded-1d65-5eea-90ee-d0b7c27031bb` 未变；其原冻结 build 的
attempt `46b61e31-a57a-4d50-8202-8c592b323d7c` 与首题均为 FAILED，真实 terminal turn receipt 为
`sha256:d5b4587294162d3e825e46587e9f753cfe07b03a41b42ec4a2bd752ead3a1b8e`。Attempt terminal receipt 为空是现有
阶段模型的合法状态，不能补造。E11 没有 Diagnostic，故现有 request@6/@7 不能表达这个恢复原因。

在既有 retained Finalizer 与 `activate_falcon24_authority(jsonb)` 上增加 request@8/result@8；只接受 exact successor
且 target >= E12，保留 gen2 语义权威。输入绑定 predecessor attempt、manifest hash、首个失败 turn ordinal/Run、真实 turn
terminal receipt hash 与 failure code；CLI 从现有 four-layer read port 读取，不能从调用者文本合成失败证据。Manifest 与 receipt
均重新校验内容 hash、baseline/activation/release/build 和题目 identity。服务器另外验证同 principal/scope 的持久化 FAILED
attempt/turn、首失败一致性、阶段 receipt 闭包，以及 predecessor baseline 的冻结 source/Web build。

前向迁移使用经 inventory 分配的 10814，复用同一 RPC 的版本分派与既有 retained activation 内核。锁顺序延续
semantic fence -> activation advisory -> current/pointer/runtime/defaults -> failed attempt/turn -> LLM stage/certification ->
catalog/model/deployment -> target baseline/staging receipt；仅 STAGED/inactive 的 fresh certification 可随新 epoch 原子提升。
幂等重放必须绑定原 command hash 与 exact failure/stage；并发或 stale predecessor 不能制造第二个 current authority。旧协议及
旧 RPC 内核保留，内部入口不授予 backend/browser，历史失败表只读，不增加第二套 publisher、Diagnostic 或失败权威。

旧内核不保存外层恢复 command hash，因此增加与 activation attempt 一对一的只追加
`falcon24_retained_recovery_activation_receipts`（command/result + hashes）。只由原 activation RPC 在同一事务写入，用于拒绝
同 activation ID 的异内容重放；不修改旧 activation/失败行，不作为新的 current pointer。旧 request@2–7 仅保留其 E2–E11
目标范围；E12+ 必须走 request@8，不能通过公开 RPC 的旧版本分支绕过真实失败与 fresh certification 检查。

验证必须覆盖 unknown/missing/null 字段、hash 篡改、错 epoch/scope/principal/baseline/build/Run/首失败、PASS 冒充失败、不同
manifest 拼接、fresh stage 与 result 错配、权限和并发 CAS；先跑 focused tests，再在 NAS 专用物理库执行完整 fresh-prefix 及
populated rollback/replay/history hash 守卫。以上通过前不迁移或激活 live。新代码 clean build 后还要 fresh scratch canary，
随后新 epoch 的正式 attempt 从 L1 开始；任何旧 build 的 PASS 均不拼入。

10814 的真实物理克隆验证发现：首次激活及其事务回滚正确，但已激活认证在 `SELECT FOR UPDATE` 时受 E7
UPDATE USING 的 `not is_active` 限制而不可见，导致 exact replay 错报 stage mismatch。10815 只新增 current
request@8 的 exact certification 锁可见策略，绑定 scope/principal、PROMOTED stage、current activation 和一对一
recovery receipt；`WITH CHECK(false)`，不增加 grant、不修改 RPC/旧 policy/immutable trigger。结合既有 promotion
CHECK 与不可变 trigger，deactivation、no-op 和 payload UPDATE 均须拒绝；锁读取仍防止 certification revoke 竞态。

克隆入场检查必须先重算原 dataset proof。当前遗留 content digest 使用物理 `ctid` 行序；逻辑 copy 即使 9 表内容
multiset hash 全相等，也不一定保持该证明。已观察到两张表行序差异；保留失败副本，采用 PostgreSQL 在线物理备份、
校验 backup manifest、独立 volume/loopback port/cluster_name 且不启用 replication，精确重现原 proof 后才继续。
不为测试方便修改旧 proof/hash 或把逻辑相等当成冻结发布闭包相等。

### 25.9 独立 Published Formula 的查询输出绑定

E13 scratch 的只读诊断确认：gen2 `formula.marketing_roas` 是独立 Formula，没有同名 Metric。保留发布目录不变，
在现有 Candidate/QueryEvidence 绑定增加明确的 `FORMULA` kind/role；不得把公式改名为 Metric、借用收入指标的 hash，
或创建第二个发布权威。旧字段/历史 hash 不变，新输出仅由新冻结 build 消费。

- 先验证 exact selected Formula，再从选中 Metric 的已发布依赖、active PhysicalBinding 和 exact Schema Snapshot
  解析每个 slot；缺失、歧义、跨粒度或未选依赖失败关闭。公式 hash 绑定 release、公式 AST 与实际依赖，不伪造单一 aggregate。
- Formula 列为 NUMBER、`aggregate=null`、非空 formula hash，保留所有规范排序的 physical sources 与依赖 grain。
  受支持的数值聚合/算术/CASE 表达式须在查询 I/O 前与 SQL 的实际输出表达式重验；未知结构拒绝，不能只校验自报公式 ID。
  原有 SQL AST、防越权、只读、类型、窗口和 Artifact acceptance 守卫继续生效。
- Analysis 输入 materialization 保留 FORMULA 身份与 exact evidence hash，不把它转为 Published Metric。分析仍只能用已有
  Metric authority 编译方法约束；Formula 可以随同表格作为已绑定数值输入，不扩大方法或数据权限。Report/Chart/Trace 复用
  相同 QueryEvidence，不创建新的口径或数据源。
- 测试覆盖真实公式绑定、SQL 算式偏离/AVG 源 ROAS/缺失或歧义依赖/未选公式/篡改 hash、旧物理列与 Metric 历史回读，
  以及 compile 前零 I/O、Analysis receipt 保留 role、同 Run Table/Chart/Trace。全链通过前不激活 live E13。
- 首版只证明单个物理 FROM 的直接 typed aggregate/算术/CASE 输出；CTE、join、cast、window、DATE_BUCKET/GROUP_COUNT
  失败关闭。除法另校验 PostgreSQL 数值提升，避免同形 SQL 的整数截断；不通过加 SQL 模板或自动 cast 偷换口径。
  相同证明用于 compile/execute 前与 evidence acceptance；accepted Context 排除的 Metric 不得用于 Formula 依赖。

### 25.10 无窗口证据必须排除未声明的时间选择

`506c3cb8` scratch E13 canary 成功绑定 Formula，但保留 SQL 日期 WHERE、删除 time_window 的候选被接纳；
Run SUCCEEDED 而全量渠道 oracle 全部 FAIL。业务失败立即封存，QA/Trace 不运行，live 仍 E12。

compile/adapter admission/evidence acceptance 共用纯 AST/CTE 时间依赖检查：native 时间列、selected Metric 的
text-backed time_column_id 与 selected 时间 Dimension 通过 exact physical snapshot/binding 定位。WHERE/HAVING/
JOIN/FILTER/CASE 里的时间选择必须声明窗口，派生 alias/布尔列不能隐藏；没有时间 Dimension 不是跳过限制的理由。
当前保守子集拒绝时间非空判断和时间相等 JOIN；普通日期投影、分组/latest-row 排序保持合法。该检查只作拒绝，
不发布 Dimension、不重写 SQL，也不替代已声明窗口的原有正向证明。新错误仅加到原安全诊断/repair 白名单。

新 clean build 后使用 fresh physical scratch 重做原题全量 oracle；不能变更 oracle 去迎合不完整结果，也不能重用
失败 build 的 PASS。只有业务、QA、Trace 均通过才允许正常 live E13 activation 与从 L1 开始的全新正式 attempt。

### 25.11 Root AUTO 最终答案的文本闭包

`bb23f0bb` scratch ROAS 已通过全量业务、QA 与 Trace；正常 live E13 激活后，正式首题 semantic-only 失败。
E13 attempt `c31efada-c780-43dc-8151-e8167db5af9e`/Run `8ef759dc-cbd8-8132-8df3-a8ba87e6ac16`
封存为 FAILED，后续 14 题未提交。与 E12 ROAS 反例对照，两者都是 CONTINUATION_INPUT + SEMANTIC_FACTS_ONLY，
不能让专职任务范围覆盖整个请求的 continuation。

修复位于已有 Root/Provider 边界：AUTO 无工具输出从 text 严格解析，再走同一 Response Schema；原生工具、REQUIRED、
无可选工具的 structured-output 分支保持不变。Root 从可执行 Schema 获得完整最终答案格式，usage 只针对当前请求，
不得为假想未来问题继续执行或生成 no-op 工具调用。下一轮 Root 可自主用已验收事实结束，Host 不替它改变先前 usage。

离线证明不代替业务验证。新 clean build 必须在 fresh NAS scratch 同时验证 semantic-only 与真实 ROAS 请求，
再以 E13 的真实失败 receipt 正常前向激活 E14；E14 fresh attempt 从 L1 重做 15 回合，不能复用 E13 通过项。

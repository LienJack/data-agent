# Falcon24 Semantic Generation 2、E4 原子恢复与 E5 前向构建权威 — Design

> 最新设计权威（2026-08-31）：当前核心协作切片以第 26 节为准。第 25 节及此前正式四层设计/失败证据保留；
> 不因核心验收简化而修改其合同或历史状态。

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

### 25.12 跨表 Metric 时间来源不能被本表假设误拒

`74813f90` 的 scratch semantic-only/ROAS 均通过业务、QA、Trace，正常 live E14 后正式前三题 PASS；
L1-04 最近订单 Run `8b2b9e3e-e110-8735-a050-23b8d6549fee` FAILED，attempt
`b428c7ca-9168-4c77-8b1f-489db038a8ea` 已封存，后续 11 题未提交。该事实不撤销 Root AUTO 修复。

从该 Run 的真实冻结上下文读取的配送 Metric，其 table_id 为配送表而 time_column_id 为订单表日期。
反向时间守卫错误地要求二者同表，在 SQL I/O 前拒绝合法最近订单候选。只读离线探针对两个合规合成 SQL 稳定复现；
历史被拒 SQL 未持久化，不从 candidate hash 反推或声称知道其全文。

保持同表 Metric dependency 定位；跨表则复用原 physicalSources，要求 exact qualified column binding、datasource、
active lifecycle 和 snapshot。该来源仅用于识别未声明时间选择，不授权 Dimension/时间窗口，不改 SQL 或发布目录。
compile、adapter admission 与 evidence acceptance 继续共用此守卫；缺失/错绑定失败关闭。

新 clean build 后 fresh NAS scratch 必须证明最近10笔订单的真实 source oracle、QA 和 Trace；同时复验 semantic-only
与全量 ROAS 以保护已有边界。全部通过后，使用 E14 首个失败 turn 的真实 receipt 正常前向激活 E15，fresh 15 回合从 L1 开始。

### 25.13 结果类型拒绝必须提供安全且可行动的修复反馈

`e4612435` 的 fresh scratch 最近订单、semantic-only、全量 ROAS 均通过业务/QA/Trace；live E15 正常激活后，
formal attempt `092a7136-6ec4-4888-a90e-b2129090cb2c` 前三题 PASS，L1-04 Run
`fdd424d2-6663-83f7-9b9a-a295fb371cbb` FAILED/87 events，8 次 EXECUTE 类型绑定拒绝，无 Artifact。
它已越过 E14 的 compile 缺陷；不回退跨表时间修复。E15 已封存，后11题未提交，临时服务停止。

历史候选仅有 hash，不能证明具体 SQL 或实际 OID；明确区分未知的历史写法与确定的反馈缺口。
专用 scratch 的零行只读探针证明 raw text SELECT + timestamp ORDER BY 仍返回 STRING，SELECT date/timestamp cast
分别返回 DATE/DATETIME。旧 bounded repair 只有错误码/原候选，无法获知真实返回类型。

保留严格 OID 绑定校验；只在列数/名/序对齐时附带受支持逻辑类型。Worker 复用 Candidate 枚举与 exact length
校验后，把数组加入原 repair rejection 与无值诊断；错误文本、SQL、行值、未知 metadata 不转发。compile 后清除反馈，
不增加重试或新权威。Prompt 明确 SELECT 与排序 cast 区别，不允许通过重标发布 Dimension 类型绕过语义。

完成离线测试与 scoped commit 后，fresh build/scratch 重验最近订单、semantic-only、全量 ROAS；全通过才可使用
E15 真实失败 turn receipt 正常激活 E16，并从 L1 重做15回合。E15 的三个 PASS 不可拼接。

### 25.14 请求内同比输出契约

`f76fc2da` 的 E16 scratch 三题全部业务/QA/Trace PASS，正常 live E16 后正式 L1 五题全部 PASS。
L2-01 Run `54843d21-f9aa-82d5-bca6-7986cf66eb0b` FAILED/74 events，六候选在 compile 被
`TEXT2SQL_SEMANTIC_RESULT_BINDING_OUT_OF_RANGE` 拒绝；只有 SemanticQueryContext，无 QueryEvidence。
真实上下文只有收入 Metric/SUM Formula 与月 Dimension，但含本请求同比解释。历史 SQL 不在存储中，不能推断每个候选写法。

补全 request-scoped operator → Candidate → PostgreSQL AST proof → QueryEvidence → Analysis input 的闭包：
新增明确 `REQUEST_DERIVED` kind/role 与 exact interpretation/context hash，不新增 publisher、不冒充 Published Formula。
按 `backend/text2sql-resolved-context.md` 的限定双 CTE 月度 SUM 子集验证来源、窗口、年度 LEFT JOIN、原始值、算式和零值；
不能通过把结果改回 METRIC 绕过证明。Comparison raw value 的 NULL 保留，真实 OID gate 和 bounded repair 预算不变。
其余请求算子/多表派生未在本变更宣称支持；不足时继续安全的离线修复，不能放宽验证器。

只读原 SQC + 专用 NAS scratch 探针证明12个月/6个未覆盖同期 NULL、独立源汇总相等；这不是 formal acceptance。
完成 scoped commit、clean build/full unit 后，fresh scratch 必须增加月度同比业务/QA/Trace canary，并复验最近订单、
semantic-only、全量 ROAS。使用 E16 真失败 receipt 正常前向 E17，再从 L1 重做全部15回合，旧五个 PASS 不能复用。

### 25.15 同比证明的指令一致性与无值诊断

`f9e64ac7` fresh E17 scratch 首个同比 canary Run `7144b8e6-c4e7-86bc-8d92-89b57a91a1f7`
FAILED/74 events：前四候选缺关系别名，后两候选未通过派生证明；三组 repair 前后 candidate hash 相同。
未激活 live E17，其余三个 canary 未提交。历史 SQL 未落盘，不能将总错误码解释成具体 SQL 写法。

代码核查确认提示词既要求只在 JOIN 平移，又残留允许 CTE 预平移的相反建议；删除后者，不扩大证明子集。
证明器只增加有限检查点诊断，原拒绝条件/总错误消息/SQL 不变。固定 registry 同时约束证明类型、Worker 可公开码及
Provider 修复说明；不包含 SQL、AST、标识符、参数、异常 cause，不新增数据权威或执行入口。
每次证明保存独立 checkpoint；并发错误不能串线。原两候选预算不变，未知 diagnostic 不得透传。

下一 fresh scratch 仍以 E16 FAILED 为 live 前驱，先同比再三条回归；全部业务/QA/Trace PASS 后才可正式 E17。

### 25.16 明确的候选修复轮与 ROAS 原始语义

`a029cb71` fresh scratch 同比、最近订单、semantic-only 均通过业务/QA/Trace；ROAS Run
`10649939-0cc3-8c64-8ed7-f0e38ccb30b8` FAILED/74 events，仅 accepted SQC。六候选中三次关系别名拒绝、
三次 Formula 表达式拒绝；两个 repair 对仍为相同 hash。失败已封存，未执行 ROAS QA/Trace，未激活 live E17。

实际 SQC 的已发布 ROAS Formula 规定 denominator=0 时为0，不是 NULL；保留该 AST，不将 NULLIF 写法视为等价。
历史候选 SQL 未保存，不能证明这些候选具体如何偏离。代码确认修复包被放进 system，而最新 user 文本仍是初次问题；
改为原 system/user 不变、追加 rejected Candidate assistant 与 Host feedback user 的显式修复轮。
生产者与消费者共用 strict schema，静态提示强调别名及原 Formula 零值规则；task hash/call id/预算/工具/校验不变。
离线穿透真实 dispatcher 的 capture 测试必须覆盖完整消息与 fail-closed，不把 mock 结果记为 provider PASS。

另发现 L4 净 ROI 的 AGGREGATE_RATIO 已存在请求解释，但结果绑定目前只接通 PERIOD_COMPARISON_RATE。
正式激活前必须补齐该已知闭包缺口并单独验证/提交；不能借用 ROAS Formula 身份或新增另一套发布权威。
两项修复后重新 clean build/fresh scratch；旧 scratch 的三个 PASS 不可拼入新构建。

### 25.17 L4 净 ROI 请求结果闭包

代码审计确认 AGGREGATE_RATIO 已能形成请求解释，但 Provider projection、compiler allowlist 和 evidence resolver
仍只接通 PERIOD_COMPARISON_RATE。净 ROI 不能以收入 Metric 或已发布 ROAS Formula 身份执行。
补齐同一 REQUEST_DERIVED 路径：exact Context/来源校验、限定同表 SUM-before-ratio AST proof、QueryEvidence 与 Analysis 角色传递。
身份/schema/hash domain/发布权威保持现有合同；两个派生子集共享原始 SUM 来源证明与 hash builder。

全量渠道净 ROI 支持直接分类维度分组、两个原始 SUM 与一个派生结果；输入同粒度、分组具备既有权限，所有投影及分组逐一验证。
CASE NULL 和 NULLIF 的零值语义相同，不能借用已发布 ROAS 的0。空集 raw SUM 同样 nullable。细分错误复用原无值反馈路径。
初期不声明时间窗口/跨表 ratio 证明；当前请求已含窗口时必须失败关闭，禁止删窗口或假称已支持 L4 全部形态。

离线测试加只读 NAS 真实源探针证明工程路径；探针解释只在内存构造，未 accepted 为 Artifact、未发新 Run、无模型调用或权威写入。
最新 clean build 后 fresh scratch 重新验证同比/订单/semantic/ROAS，并增加净 ROI 的真实问题、业务 oracle 和随后 QA/Trace。
正式15回合仍须同一 fresh attempt 全通过；已知缺口与真实失败继续按 ACTIVE controller 离线修复，不拼接旧 PASS。

### 25.18 请求派生结果的 mandatory Relationship metadata 闭包

`49cbc84c` scratch 同比 Run `5a82c71e-e24b-88b0-a267-9b3f8f9b8533` FAILED/74 events，无 QueryEvidence。
无模型重放原 accepted Context 与合法合成 Candidate，在请求闭包 membership 处复现拒绝；Scope/Run/回执/资源/物理绑定全部一致，
唯一漏项是 verified inference receipt 的 `relationship.order_customer`。此遗漏在净 ROI 修复之前已存在，旧成功 Context 未显式请求该关系。

结果层仅补上 Context 实际投影且原 inference receipt 授予的 Relationship metadata；不改全局 executable selection helper，
不授权其他 Metric/Dimension/物理列/Join。原 SQL AST 子集、窗口、身份/hash、发布与重试预算完全不变。
两算子正例先 RED 后 GREEN，并覆盖未授予关系、metadata 冒充输出对象和回执篡改。真实 NAS 只读重放原 Context：12个月/6个 NULL，
独立源金额/同比相等；未重建历史失败 SQL、无模型或权威写入，不算业务 PASS。下一 clean build/fresh scratch 重做所有 canary。

### 25.19 月度投影证明的可区分无值诊断

`5327d719` fresh scratch 同比 Run `1e4dbc77-45c1-8b7f-a4c8-9ba06affe52f` FAILED/74 events，无 QueryEvidence。
两次 alias 与四次 CURRENT_PROJECTION 拒绝；未再出现请求闭包拒绝，但新 Context 未显式请求该 Relationship，不能单凭此 Run 证明该分支。
失败记录及数据库保留，其余四题未提交。投影总码不能区分 unit、时间输入与 SUM，历史 SQL 未落盘，不能猜测实际表达式。

保留所有 SQL 接纳/拒绝条件，仅在纯证明内增加 CURRENT/PRIOR MONTH_UNIT、TIME_INPUT、SUM_INPUT 六个固定检查点，
统一经原 registry、Worker allowlist、显式两候选 repair 和模型消息传递。逐表达式重置诊断；不泄露 AST/标识符/SQL/值，不扩大调用预算。
六个 parser/deparse 回归先 RED 后 GREEN，公开链路与真实 dispatcher 的离线 capture 全覆盖；正向 SQL/参数 round trip 保持通过。
本项证明可观测性修复，不宣称历史候选根因已查明或模型问题已解决；新 clean build/fresh scratch 才能继续业务验证。

### 25.20 复杂分析前置：精确月窗的请求比例输入

`cc9ff33e` 的同一 fresh scratch 五项基础 canary 均已通过 business → QA → Trace。正式前源码审计确认：
生产 Analysis registry/oracle 仅支持12个月单指标趋势；请求净 ROI 仍只支持全量单表，不能据此激活正式门禁。
先补齐带窗数据输入，再补 Analysis 方法；所有正式需求和冻结题库不变，live 继续 E16 FAILED。

本小项沿原 AGGREGATE_RATIO proof 支持与 RECENT_COMPLETE_PERIODS 一起接受的 exact current window：
时间 Dimension 必须在 Context/发布/选择/物理绑定中一致，属于两个 SUM Metric 的 allowed dimensions，且两者使用同表同时间列。
窗口必须等于 Host 解析值并落在两个非空发布 coverage 内，时区相同；任一 min/max 缺失即拒绝。
纯 AST 证明 WHERE 只有 direct time >= $start AND time < $end，
参数序号与声明逐一相等。text time 仅显式 timestamp cast；可输出同一时间维度的 MONTH bucket，并与分类维度共同精确 GROUP BY。
不接受任意日期、额外条件、过滤后比例、跨表、CTE、窗口函数、隐藏分组或丢弃原时间要求。原无窗证明与历史 hash 不变。

先写真实 compiler round-trip 和 exact Context 的失败测试，再修改共享证明、结果解析和公开修复提示。
验证正例含窗口总计/月度渠道分组；反例含来源、权限、双指标 coverage/时区、错下上界/参数、月桶、额外筛选与无窗退化。
这只闭合查询输入，不声称已完成复杂 Analysis、跨 Run 指代或正式15题；后续依原 ACTIVE 流程逐项补齐。

### 25.21 Analysis 直接投影的显式源列身份

同一个发布 Metric 可在接受的 QueryEvidence 中分别投影本期与同期；仅按 role/object_id 选择源列会产生二义性。
在原 ResultContract@2 的 RESULT_COLLECTION column mapping 中增加可选 `source={input_name,output_name}`，
由 Host 方法编译器指定并进入原 contract hash。只允许 DIRECT lineage 且精确列出该 input.output；不是新执行授权。
Worker 投影同时匹配显式输入名/输出列名与原语义 role/object_id，重验同一 QueryEvidence 与 Arrow，再保留原类型/NULL/月历校验。
缺显式映射的旧契约仍只接受唯一来源；不得按第一个命中、current/prior 关键词、输出位置或值猜测消歧。
跨输入拼表、重复同名输入、错语义角色/身份、遗漏lineage与错列均失败关闭。无新增字段的旧契约hash保持不变。
本小项先覆盖本期/同期共用Metric与NULL同期的离线回归；尚不注册新Analysis方法，也不宣称REQUEST_DERIVED表契约闭包。

### 25.22 Analysis 消费已接受比例列，但不升级方法权限

ResultContract 表列保留 `FORMULA/REQUEST_DERIVED` 原角色，仅允许 NUMBER、DIRECT collection与精确source映射，
不得出现在metric_bindings。Program Compiler增加Host-only accepted QueryEvidence输入，从原生产resolveCommitted结果传入；
重验精确引用、Run/Scope、Context receipt、Release与Schema revision/hash，且新角色列逐一匹配source/role/id/type。
仅这些已证明的直接投影对象ID可进入结果lineage；metric_refs、dimension_refs、Skill capabilities仍来自原Published AnalysisContext。
REQUEST_DERIVED的解释依赖必须包含在当前节点原指标/维度选择内。缺证据、换角色/列、跨Context/Run或试图选其为Metric均拒绝。
继续使用原Publisher和staged chart读路径；不引入方法fallback或新的语义发布对象。nullable V3图表与具体分析方法另行闭合。

### 25.23 Analysis V3 缺失观测不能被删行或补零

同比真实缺失值须经同一受治理图表链保留。新增 `derived-analysis-chart@1.1.0`，仅LINE/BAR/HORIZONTAL_BAR允许NULL y，
每个measure至少一个真实观测；这不是统计样本充分性证明。其他图类保持finite-number要求，所有行/字节/绑定限制不变。
旧1.0非空文档原hash可读，document和preview均拒绝旧版本NULL y。两个producer明确采用新版本，不改写任何历史。
Platform趋势points逐点投影，保留缺失月份与absolute_delta=NULL；全空序列不发图。Worker保存原直接投影全部行，
Web继续各measure分图与invalidType=break。NULL/行顺序/值进入同一dataset hash；补零、删行或换序不能沿用旧凭据。
先RED回归后focused验证；本项不新增方法、不调用模型、不激活live E17，业务能力与四层正式门禁仍待后续闭合。

### 25.24 月度多结果的描述性比较方法

第一切片只接受原12月、一个MONTH维度、2–4个NUMBER结果列；原Metric≤3且必须通过原CHART_DATASET和applicability门禁。
ResultContract保留每列精确source/role/ID/NULL，observations直接投影全部月度行；结果字段分别容纳各measure的缺失数、
极值、最低/最高3点、原窗口首尾变化与最大相邻月下降。NULL端点/零分母保留NULL，不跨缺口、不求比例平均、不做显著性或因果推断。
Host只向模型提供Schema与计算规则，不提供已算答案；独立oracle须从原QueryEvidence/Arrow重新验算，再走现有atomic publisher。
新方法不是旧单指标统计趋势的fallback；输入形态/发布能力驱动可用项，不能按问题关键词或case选路。

当前先闭合输入/ResultContract/执行说明与23个离线测试。独立oracle与production接线为紧接着的小项；在其通过前不注册新生产入口。
全量时间范围、渠道×人群、多输入与跨Run报告仍保持待完成，不能用此一维方法冒充全部复杂Analysis已支持。

独立oracle小项现已完成：重验原12月QueryEvidence/Arrow，从源值重算全部描述性字段，与RESULT/TABLE/CHART整体精确比较；
即使错误输出重新封hash也不能通过。拒绝额外自由文本结论和因果声明，FULL只覆盖固定描述性合同；不产生material-change阈值结论。
实现hash绑定oracle模块内容和执行规则，原Brief与oracle共用未改变的时间窗归一化。32项oracle回归连同原路径共117项通过；
仍没有production方法注册或真实模型Run，下一步在唯一composition接线并验证，不能直接记为业务通过。

生产composition接线随后完成：原两列single-series保留原编译器及两个算子；多列须通过完整月度比较输入门禁。
Host-only execution_contract随既有registry hash进入上下文，只传给exact匹配节点；oracle选择器同时核对method/skill/contract，
原方法不退化为新描述性方法。10个focused文件132项通过，包含生产选择器、原算子拒绝与后续叙述数值保留；无预算变化。
这里只证明离线生产组件接线，不是Sandbox服务、真实模型问答或正式门禁证据；全量范围、多维/多输入与跨Run闭包继续处理。

### 25.25 全量分析不虚构请求日期

前置真实来源复核补充：保留的cc9同比QueryEvidence月份为DATETIME且nullable=true，但12个实际月份均完整。月度比较输入门禁
改为验证实际值，不把nullable元数据误当实际NULL；表合同保留原nullable。真实空月/缺月/重复月仍拒绝，未修改原输入或历史Run。
此修复通过84项focused及只读来源shape检查；后者不是完整Analysis/Sandbox或新模型验收。

QueryEvidence无窗时原Brief已有nullable表达，Program却强制有窗且Gate对无窗Brief跳过比对。现在显式全量以candidate2.1/
Program1.1/envelope1.1表达；Compiler必须从原accepted QueryEvidence重验Run/Scope/Context/Release/Schema与null范围，Gate始终
精确比对Brief和节点。null仅限无时间grain、无统计算子、无比较窗的open-python描述性节点，不能借此注册任意分析方法。
原有窗编译仍产生旧Program1.0/Host2.0，2.1候选的有窗结果与2.0完全相同；旧封包golden hash保留。Hash domain随显式版本，
原Wire/publisher读取新增精确tuple，不增加数据库写入口或修改历史。Host提供approved_time_window，模型不从coverage猜日期。
此小项只解除范围契约断裂；渠道形态/独立oracle、分群多输入与跨Run报告仍须继续完成，不激活live E17或记为真实业务PASS。

### 25.26 分类多结果描述性方法

限定1–2个STRING/atomic分类、1–4个NUMBER结果、1–200行，原Metric≤3且原CHART_DATASET/applicability不变。每个完整tuple唯一，
nullable元数据与实际空值区分；观察表保留原顺序/角色/NULL/全部分类。bar.grouped用第一个分类作x、第二个原分类作series，
不虚构复合源列。各measure给出计数/极值/最低最高3组，rank以原行号消除同值歧义；不合计或平均比率、不宣称增长或因果。
Host规则不含预计算值；现阶段只增加方法叶子和22个测试，连同现有编译/发布等75项通过，Worker typecheck/build通过。
独立oracle/生产注册随后闭合；混单位/粒度、多输入、月×渠道变化与跨Run报告仍待后续处理，不以此方法兜底任意问题。

独立oracle及唯一production接线现已闭合：原QueryEvidence/真实Arrow重验后从源行独立计算，与完整RESULT/TABLE/CHART精确比对；
重封hash后的错误数值/排序/分组/NULL/额外事实仍拒绝。FULL仅为固定描述性合同，material_change=false，不推导因果或统计能力。
production按原分类形态运行完整编译器，exact method/skill/contract与Host执行规则匹配；不改Root/预算/原publisher。
月度与分类只抽取公共字节/ref/JSON闭包，两个oracle各自计算业务期望；实现摘要绑定叶子和公共模块。10文件185/185及Worker typecheck/build通过，
包括真实Arrow投影、两级分类/NULL、叙述与旧方法回归。这是离线组件证明，没有真实Sandbox/模型Run或数据库写入；继续剩余复杂形态。

### 25.27 月×分类×分类的显式分面

现有chart只有x+series，直接把三维来源画成两维会混合客群。增加V3可选facet_key，显式指向第二原始分类；不用复合虚构源列、
不筛掉原表、不开第二publisher。新transform1.2封完整原表和facet身份；旧1.0/1.1拒绝新字段，未带字段的旧hash保持。
UI仅按原分类值分区再按measure分图，series/NULL/顺序不变；最多16分面，原全表行/字节限制不增加，无观测分面不伪造曲线。
当前完成Contracts读取与Web确定性映射，53项Contracts/26项Web及四包typecheck通过；最初6个新版本行为RED。
没有真实浏览器/模型/数据库写入。接续现有publisher/Trace producer-consumer闭包，然后月度分群方法与oracle；此项不是业务门禁PASS。

原publisher与Trace接线现已完成：model只声明可选facet_field，Host选择publish1.1并保留合同拥有的intent/template/table；
Chart1.1与V3 transform1.2显式封分面。无facet仍原1.0字节结构；完整原表、RESULT/TABLE不因显示分区而改变。
Trace两个重封hash反例先RED（缺source、非DIMENSION），补共享字段/schema版本重验后通过；原canonical/raw hash/Scope/Run边界不变。
Contracts53/53、Worker8文件145/145、Platform40/40及四包typecheck、Contracts/Worker/Platform build通过。原分类oracle擅加facet仍拒绝。
仅离线publisher暂存/Trace组件验证，无真实Sandbox/模型/数据库写入；实际月度分群方法和后续业务链仍待完成。

随后纠正分类方法行数闭包：最初200行入口与原V3 BAR的64行限制不一致，现将方法/合同/rank schema收紧到64，不扩大图表预算、不删行。
64/65两项边界先RED，64行同时通过原BAR schema；旧少量分类/独立oracle/生产接线回归保持。该修改只影响新构建编译，不回写历史合同。

月度分群前抽出已有月度/分类的固定ResultContract编码，调用者仍保留原source proof/方法适用性/发布权限和独立oracle。
在clean `23dcc9ad`实现上先固定5个合同hash，重构前后都通过，8文件140/140及Worker typecheck/build通过；
公共函数不包含方法选择或业务算术，不改变合同/执行规则/输出或历史hash。新月度分群随后复用这一源列编码。

## 26. 核心协作切片：简化问题，不弱化来源证明

不新增 publisher、数据库 gate authority 或可变四层题库。使用现有专用 scratch recovery/Finalizer 与正常 UI 提问路径，
将四个问题及其检查固定为任务级 `falcon24-core-collaboration@1.0.0` 证据配置。其报告是核心协作验收，不是 FL1 receipt。
原 `falcon24-four-layer-gate-manifest@1.0.0` 的 5/2/2/6、15 回合及所有历史 hash 完全保留。

1. 冻结新 clean commit/attestation，创建 NAS 专用物理克隆；显式验证 cluster/system id/port/Release/Profile/Datasource。
2. 同一克隆经原 recovery certification 和 Finalizer 激活 scratch baseline，禁止脚本分支写 live。
3. 四题按固定顺序运行，各一个新 Conversation、一次正常 composer 提交；Root 仍自主决定调用，不注入固定 DAG/答案。
4. 独立只读复核 Semantic Context、SQL/QueryEvidence、真实源行；通过后再读同 Run 答案页与完整 Trace，不重复调用模型。
5. 汇总 build/baseline/binding 和四题证据，检查无跨 Run/build 拼接；核心报告与原四层/production isolation 状态分别输出。

ROAS 使用实际已发布 Formula 的聚合与零分母规则，不用旧文案覆盖发布值；净 ROI 明确为
`(SUM(营销收入)-SUM(投入))/NULLIF(SUM(投入),0)`，由请求级 Semantic Interpretation 绑定两个已发布 Metric，publication effect 必须 NONE。
语义题不执行 SQL，最近订单题可直接走原受治理 Text2SQL；两道渠道题必须有真实 Semantic 在先、Text2SQL 在后。
不要求固定一次内部修复或精确 Specialist 调用次数；同一 Run 的合法候选修复可被完整记录，最终必须取得 accepted evidence。

月度分群草稿仅两份未实现测试，移至 `research/deferred-monthly-panel/*.ts.txt` 保留。它们不是已通过测试或生产代码，
已观察到的 RED 原因为目标模块尚未实现。恢复该增强项前须重新确认范围、实现与验证，不能让草稿阻塞当前全量回归。

核心预检发现分面optional property破坏DeepSeek Strict工具schema投影。保留旧/新两种输入字节，改为两个closed且各自all-required的
object分支，沿用相同字段/refinement；Provider投影器不放宽。真实model与authority schema均加入回归，不因本次无需Analysis而跳过此缺陷。

## 27. 复杂四层恢复入口（2026-08-31）

PRD §22 恢复 §25 的动态 Agent / 原 gate authority / 新构建前向恢复设计；§26 的暂停增强项不再是当前停止条件。
从现有描述性方法扩展月份×分类输入，复用来源证明、ResultContract 编码、Sandbox、atomic publisher 和 V3 分面，
不引入平行分析运行时或第二套发布权威。每个方法必须有独立源数据 Oracle，且仅凭形状与已发布能力注册，不按题号/关键词路由。
多输入和连续对话先核对当前实际实现；优先在当前 Run 重验数据，不把历史回答转为 accepted evidence。
旧月度分群草稿继续作为设计证据；重新读取并补齐边界后才进入生产测试，不能把旧 RED 或离线 PASS 当成真实模型验收。

首个叶子限定每组完整12月、1–2分类、1–4数值结果，最多32组/384行/16分面。原值及NULL稳定按月投影，按完整tuple分别比较。
结果包含每组每measure的既有月度描述性字段，以及同组端点absolute change一正一负的measure对；不移动端点、不平均比例、不做因果。
复用原ResultContract构造器、月度字段schema和时区日历转换，旧5个合同hash不变；独立source/Arrow Oracle和唯一生产接线紧接着实施。

Oracle/生产接线现已闭合：原 Arrow/source 重新验证，按组独立重算每列月度结果和反向变化对，完整 RESULT/TABLE/CHART 精确一致。
复用原 Host 月度算术，implementation digest 包含该真实模块 URL 的内容摘要；无模型输出参与期望计算。
消费链测试发现裸结果数组被既有 narrative projection 省略，故新方法用 `measure_n={groups:[...]}` / `opposed_changes={pairs:[...]}`；
不改摘要8KiB/field与24KiB预算，不额外传原始 observations。新方法此前未注册/执行，旧方法格式/hash保持。
37项 Oracle 测试包含真实 Arrow、重新封hash后的错误输出、NULL/零/负端点、溢出、原图表分面和摘要；生产选择6项新增行为先RED后GREEN。
Worker Analysis/Teams 49文件578项、typecheck/build/Biome通过。此为组件验证，所有 Sandbox receipt 为明确 unit fixture；仍无模型/数据库写入。

Report 交接修复：旧 discovery 说可消费 analysis Artifacts，但卡片/Tool/完成校验实际只容许单 QueryEvidence。
使用原 admission 的当前 Run `input_artifact_refs` 接收 QueryEvidence/AnalysisReport，产品修订 r4→r5，不新增路由、权威或回合。
每份输入及原章节引用先重验 exact hash/Scope/Run；原分析章节与图引用由 Host 保留，模型仅生成新摘要（≤原章节20,000字符）。
来源取所有输入与所引用报告的 source_refs 并集；沿用16来源/100章节/任务上下文字节预算，超界明确失败，不静默裁掉证据。
完成校验独立重读输入，比较全部来源与保留章节；单QE上下文保持。跨Run、未验收/篡改引用、错输出闭包均拒绝。
此为多能力结果组合，不把历史答案变为事实，不允许 Report 计算新指标，不改变 Analysis 单输入限制或混单位方法适用性。

## 28. B3 两期比较与先汇总后筛选（前向版本）

PRD §22.1只明确原请求的期间和筛选层次，不改历史V1题目或authority。先扩展现有月度面板为方法`@2`：
由已接受QueryEvidence时间窗口识别2或12个完整连续月，每个原分类tuple必须覆盖全部窗口；1/3/11月、缺月、重复或半月拒绝。
2月只支持端点描述比较，不作为趋势强度证据；原12月同比排名合同继续要求12月。原group/value/NULL/来源/图表预算不变。
Python参考显式接收month_count，独立Host Oracle复用原月度算术；不按题号、自然语言关键词或历史答案选择方法。

随后独立实现两分类分层汇总：原request-only比例operator绑定的分子/分母必须能对应唯一可加Metric来源列，
分别汇总后重算比例；每个原分类轴都能提供上层对比，模型按已接受语义选择渠道轴，不以列名猜角色。
先在渠道层筛选，再保留该渠道全部细分组；完整原表/图不删行，数字由独立Oracle核验，不能以组内opposed_changes代替。
这一后续能力尚未因窗口支持而完成；新scratch运行须等其闭合，正式15题须先前向版本化门禁再执行。

分层实现现已接入原@2 planner、Python参考、独立FULL Oracle、优先叙述投影及source-constrained FINAL。
两分类轴均保留全部父组，只为入选父组展开所有子组，不以列顺序认定渠道；2月净比例角色来自sealed operator的唯一可加Metric列。
保留原结果表/图，不裁掉未入选组；缺失/零/非正分母不强判有效下降。原窗口、来源、字节/回合预算不扩。
当前仅离线与原Python镜像证明，非B3业务PASS；真实Root→Semantic→Text2SQL→Analysis协作仍待新构建验证。

## 29. L4-A3 确定性双图发布合同（前向修复）

`72ae42df` 的 A3 已证明当前 Run 的 Semantic、Text2SQL、Analysis、48行 QueryEvidence 与分类同比算术正确，
但原 `monthly-group-panel.result` 只授权一张原始分组面板图，无法合法同时交付 §20.2 要求的整体趋势图和客户类型对比图。
失败 Run 与业务复核保持不可变；修复只作用于后续 clean build。

仅当 planner 从已验证 AnalysisContext/QueryEvidence 得到封存的 `PERIOD_COMPARISON_RATE`、
`BOTH_PERIOD_GROUPS` 与完整12月分类面板时，Host 从独立 `period_comparison` 确定性投影两个结果集合：
`overall_trend_rows` 固定12行本期/同期/同比，`largest_decline_group_rows` 按已排名下降月和源分组顺序保留完整分组、
组同比与整体增速贡献。选择不读取题目、题号、列名或历史回答；两月 `ratio_rollup` 与无同比映射输入保持原单图合同。

同一 ResultContract 保留原 `monthly_panel` 全量表，并新增两个 `RESULT_COLLECTION` 表；图合同恰好为整体同比折线和
下降月份分组对比柱图。模型在一个原 `publish_analysis_result` 调用中绑定3表2图，不能画原始面板混合图、选行、补算、
漏图或增加第三张图。Python preparation reference 仍是无数据算法参考，不替代真实 Cell、Publisher 或 Oracle。

FULL Oracle 从当前 Run 原 Arrow 重新计算 `period_comparison` 及两个集合，逐项比较 RESULT、3张表、2张图、绑定、顺序和 hash；
任何篡改按既有 `RESULT/TABLE/CHART_MISMATCH` 或 closure 错误失败关闭。修复不新增模型调用、Cell/Publisher repair、timeout、
权限、数据库状态或发布权威。组件验证后必须新 clean build、fresh 专用 scratch，从 A1 开始重跑 A/B 六题；旧 A1/A2 不拼接。

## 30. Semantic 零工具 JSON 文本传输（前向修复）

`966760f5` 的原 B3 与显式定义版 B3 共八次停在 Semantic Structured Output，Provider response artifact 仅有空白文本，
没有可供 Host 修复的 selection candidate。A1/A2/A3/B1/B2 同构建均已通过，且显式题面仍复现，因此缺口位于
DeepSeek 零工具 Structured Output transport，不位于业务公式、SQL、数据库或题面歧义。

服务端 response schema registry 新增冻结的 delivery mode，默认 `STRUCTURED_OUTPUT`；只有 Semantic selection exact version
注册为 `JSON_TEXT`。数据流固定为：

```text
server-owned schema + JSON_TEXT
  -> exact canonical JSON Schema appended to server-owned system instructions
  -> original SDK response_format=json_object, tool_choice=none, one fetch
  -> fully drain original text/usage
  -> JSON.parse exact full text
  -> same registered Zod strict schema
  -> canonical JSON -> protected response -> existing Semantic Host validation
```

该模式只改变传输表示，不改变语义 Authority。不得剥 fence、截取第一个对象、删除尾随 prose、补字段、修改集合成员、
重放调用或在失败后伪造 candidate。空白/非JSON可沿用完整响应 known rejection；合法 JSON 但错 schema 仍是协议失败。
delivery mode 不进入 request contract，用户/模型无法覆盖；工具调用、Text2SQL、Analysis、Report 和其他 schema 保持原模式。

测试必须同时锁定 registry 默认值、server-owned override、DeepSeek wire 的 `json_object`/零 tools/一次 fetch、strict canonical output、
exact canonical schema instruction、错 schema/非JSON/空白拒绝和 raw-free diagnostic。`b4a237db` 证明仅有 `json_object` 语法约束时，
模型可返回 JSON 但嵌套类型不满足 strict schema；因此 schema instruction 是 transport contract，不是答案修补。真实验收仍需再一个
clean build/fresh scratch 从 A1 重跑全链，单测与旧构建 PASS 都不计业务 PASS。

`82aed231` 证明 exact JSON Schema 解决了字段/嵌套形状，但 B3 的多维选择连续四次落在
`canonicalIdsSchema` 的数组第2项 refinement：JSON Schema 本身不能表达完整字符串升序。`94c10171` 再次增加提示后，`a43cc9f2`
虽在同一构建通过 A1/A2/A3/B1/B2，B3 四次仍以相同 refinement 失败，证明排序提示不是可靠的语义传输合同。

前向实现把 Semantic selection 分为两个边界：provider-only response schema 先用同一 `versionIdentifierSchema` 验证每个 ID、拒绝重复项，
随后只按 JavaScript 默认字符串顺序规范化 selected/candidate 集合及 ambiguity 集合；再执行与最终 intent 相同的非空、操作唯一、操作引用
已选 primitive 等跨字段约束。最终 `semanticQuerySelectionIntentSchema` 仍要求原 canonical 顺序，并在生产 team tool 中再次 strict parse。
该规范化不得增删、替换 ID，不得增删 operation/ambiguity，不读取题号、自然语言或发布目录，也不补任何公式、窗口、关系或答案；Semantic
仍负责真实 membership 与 request-scoped operation，Text2SQL 仍只消费最终严格产物。换言之，Host 只拥有集合序列化，不拥有语义选择。

### 22.3 NAS OpenSandbox endpoint mode

OpenSandbox 管理面和 Sandbox 数据面分开判断。`DIRECT` 仅适用于 Worker 可访问 Docker 临时发布 endpoint 的拓扑；当 Worker 在 Mac、
控制服务与 Docker 在 NAS，且 SSH 只转发管理 API 时，Worker 固定使用 `SERVER_PROXY`，由同一 OpenSandbox server 代理 ready/execd 请求。
该选择是 server-owned deployment config，不进入 Run、题库或 Agent contract，运行中不 fallback。

正式 runtime probe 接受两种显式布尔值并在报告中分别输出 `DIRECT`/`SERVER_PROXY`，其余双沙箱隔离、Cell policy、Operator binding、
receipt closure 和 close 检查完全相同。immutable attestation 保留既有本地 DIRECT 证据；NAS SERVER_PROXY probe 只证明当前拓扑可执行。
任何旧失败 Run 保持不可变，配置修复后仍通过新 clean build/fresh scratch 从 A1 前向验证业务四层。

## 31. 分类比较无数据准备参考

`CATEGORY_COMPARISON_PREPARATION_REFERENCE` 与月度面板参考使用同一权威边界：它是 execution contract 中的数据无关算法说明，
不是 Host 执行器或 Oracle 期望来源。模型把函数复制到实际 Cell，并只传 `source_columns/dimension_columns/measure_fields`；
函数在派生 DataFrame 上保留原行和完整分类 tuple，把数值转为 JSON-native finite float，再以 `(value, source_row_index)` 升序或
`(-value, source_row_index)` 降序构造 top-3。Publisher 与独立 Oracle 仍逐字节重验 RESULT/TABLE/CHART。

该修复只消除“模型重复实现固定排序算法”的非业务难度，不改变 Semantic membership、Text2SQL、公式、Analysis 来源或自然语言结论；
错误成员、错误值、漏组、重排 observations 仍失败关闭。`abb1e38c` B1 失败与 A 组三题不进入新 build 计分。

## 33. Formula-only QueryEvidence 的能力权威收敛

QueryEvidence的FORMULA身份是Text2SQL已验证的发布公式/物理绑定，不是Metric。Analysis Context编译新增纯authority投影：先取直接METRIC列；
若不存在，再从FORMULA列的canonical Formula ID与`relation_name + column_name`来源集合，匹配Semantic closure内Metric的发布Formula及完整
dependency columns，输出排序后的最小Metric ID集合。route/retrieval中无关Metric不进入Context；空集合拒绝，不回退全选。

planner不再从结果列角色重复猜Metric，而使用上述编译后AnalysisContext的精确Metric集合做formula hash、allowed dimension、CHART_DATASET、
单位、粒度、空值与applicability验证。ResultContract表列、lineage和materialization仍保留FORMULA/REQUEST_DERIVED原角色；该投影不读取题面、
题号或数据值，不创建Metric、不修改Release、不授予额外Skill。任何canonical Formula、物理来源、selected closure或Context漂移仍失败关闭。

## 34. Analysis FINAL literal 的 JSON 文本交付

月度与分群合同在FULL Oracle后已有唯一服务端事实摘要；Executor把它作为`final_summary_constraint`收窄原
`analysis-agent-final@1.0.0`两字段schema。`362c7e96` A3证明literal收窄本身不能保证DeepSeek Structured Output返回顶层对象。

Dispatcher仅在该内部约束存在且FINAL阶段合法时创建request-isolated registry descriptor，并把delivery mode固定为`JSON_TEXT`：

```text
verified summary literal + original two-field schema
  -> request-isolated Zod literal schema + canonical JSON Schema instruction
  -> one DeepSeek json_object request, tool_choice=none
  -> JSON.parse complete original text
  -> same literal strict schema + canonicalize
  -> protected response
  -> executor exact literal assertion -> Explanation authority
```

无约束Analysis FINAL继续走原Structured Output；共享registry不变。该设计不增加Provider调用、Root/Analysis回合、token、repair或恢复预算，
也不将服务端文本当作模型响应。空白、非JSON、额外字段、错类型或literal不匹配仍失败关闭；恢复路径继续校验原Explanation hash和literal，
不重放历史调用。真实业务证明必须用修复提交后的新构建和fresh物理scratch从A1开始，旧失败Run与旧PASS均不拼接。

## 32. 营销术语与完整月选择闭包

`d6484404` 的 B3 在 Semantic transport canonicalization 之后仍四次出现顶层集合第 1 项的 strict custom 拒绝。
冻结检索证据显示 mandatory closure 是渠道、目标人群和订单收入；营销收入/投入仅是 optional recall，营销事实日期维度已被裁剪。
这不是 Text2SQL、Python 或数据结果错误，而是发布词典把无限定“收入”绑定订单收入、又没有可直接命中的营销月份名称。

前向源码修复调整下一次 successor ChangeSet 的语义：订单收入去掉泛化“收入”别名，营销收入 Metric/Formula 增加“营销收入”，营销事实日期维度增加“营销日期/营销月份”。
但 E5+ Finalizer 只 retained 当前 generation 2；源码变化不会进入 E17 active projection。新 scratch 必须先回读 active executable projection，
不得把 ChangeSet 单测或 E17 activation 当作新别名已发布。generation 3 尚未由唯一 successor authority 发布时，新版 B3 直接引用 generation 2
已有的“营销归因收入”与 `blinkit_marketing_performance date`，并在 request scope 内解释自然月。Semantic provider 仍从冻结 catalog 选择成员；提示仅要求
`RECENT_COMPLETE_PERIODS + AGGREGATE_RATIO` 多操作引用的 Metric/Dimension ID 做全集 membership 自检。Host 不生成 operation、
不追加 ID、不改变 strict schema/预算/重试/Oracle，也不把 Published ROAS 当净 ROI。该 change-set 会产生新 release/hash，只能在新 scratch
通过未来受治理 successor 链路；当前复杂预检不为降低题目另建 publisher，不修改旧 release、旧 Run 或 live E16。

## 35. Root 委派输入的单调收窄

Root Provider 的受保护响应仍是原始事实，Harness 在把原生 tool call 转为候选决策时先验证冻结 Catalog，再对每个调用执行单调收窄：

```text
original input refs
  -> lookup exact selected Profile in verified frozen catalog
  -> keep refs whose artifact_type is in accepted_input_artifact_types
  -> apply only when kept count is between 1 and original count - 1
  -> strict Root decision/catalog validation
  -> accepted Artifact verification and normal admission receipt
```

因此 Analysis 的 `[QueryEvidence, SemanticQueryContext]` 可变为 `[QueryEvidence]`，但 `[SemanticQueryContext]` 不会变成空输入并继续执行。
算法不读取问题、题号、objective、数据值或历史回答，不选择 Profile，也不改变输出、用途、预算、引用身份和顺序；权限集合只减不增。
未知 Profile、无受支持引用、错误输出类型、未验收/跨 Run 引用仍走原失败关闭与有界 verifier feedback。原 ProviderResponseArtifact 与实际
delegation receipt 分别保留修复前调用和修复后受理输入，恢复时不重放 Provider 调用。新构建/fresh scratch 必须证明 Analysis 真正执行并由原
Oracle/Publisher 验收；Harness 单测不计业务 PASS。

## 36. Run Side Effect 的分层 deadline

Worker 的 Run 总执行 deadline 与单 Side Effect deadline 是两层不同边界。总执行默认 300 秒，负责终止整个 lease execution；单 Side Effect
默认从 60 秒调整为 180 秒，允许一次 Analysis 委派内的多节点 Provider、Sandbox、Oracle 与 Publisher 正常闭合，同时仍给总 Run 留出终止边界。
部署显式 `WORKER_SIDE_EFFECT_TIMEOUT_MS` 继续按原 10–900,000ms schema 解析；没有新增题目、Profile 或模型可选开关。

```text
accepted Analysis delegation
  -> one executeSideEffectOnce identity
  -> 180s default effect deadline (or explicit deployment override)
  -> existing AbortSignal + task/run/fence checks
  -> completed output -> immutable receipt -> child acceptance
  -> timeout/error -> no receipt and FAILED observation
```

该变化不延长 Root 四回合、不增加 Analysis repair/provider/tool 次数，也不改变 task 自报的 600 秒上限；实际执行仍取部署、Run、task 与取消信号
中更早生效的边界。Side Effect 内部已产生但未完成 child acceptance 的 staged/committed Artifact 不会出现在 Root accepted output ref 中；
后续新委派不得把它当作恢复 receipt。新 build/fresh scratch 必须从 A1 重验，真实证明 A3 在一次 Analysis 委派内完成原子 acceptance。

## 37. B 组事实型公式协作预检

`4b26b01e` B1 证明 active release、Semantic 和 Text2SQL 可以形成正确的发布 ROAS 结果，但自由表述使 Root 连续三次尝试 Semantic 后才接受
Context，最后一次 Text2SQL 又被标成 continuation，四回合内没有 FINAL。前向预检不改变 Harness、预算或 active release，而把用户已经授权的
术语/公式边界直接写进 B 组题面：

```text
published Formula/Metric/Dimension names or request-only operator definition
  -> Semantic resolves exact active IDs, formula AST and request-scoped interpretation
  -> Text2SQL consumes exact SemanticQueryContext
  -> current-Run SqlArtifact + QueryEvidence + governed chart
  -> FINAL_ANSWER_EVIDENCE (no unrequested Analysis)
```

B1锚定 `formula.marketing_roas`；B2锚定同一收入/投入Metric并要求 `AGGREGATE_RATIO` 的 REQUEST_ONLY/NONE 解释；B3同时锚定
`blinkit_marketing_performance date`、营销归因收入、RECENT_COMPLETE_PERIODS 与该请求级净 ROI。题面不会携带物理列、SQL、结果值或隐藏 ID 集，
Semantic 仍必须从冻结 active catalog 解析并提交 Context，Text2SQL 仍必须按 Context 编译和执行。Host 不做关键词路由、不生成答案、
不将历史回答作为证据。

该变化只删除未请求的统计分析、原因推断和管理建议，不减少事实复杂度：B3仍包含双月、渠道筛选、目标人群分组和请求级比例。
独立 Oracle 继续从物理源重新聚合；图、history binding、同 Run QA/Trace 和 live E16 审计保持原标准。A 组三题继续证明
Semantic→Text2SQL→Analysis，B 组三题专门证明 Semantic→Text2SQL 的公式/术语协作，两者不得跨 Run 或跨 build 拼接。

## 38. Analysis 精确重复条件叶的编译收敛

`a58533a4` A2已经形成正确Semantic Context、SQL、48行QueryEvidence以及首个Analysis节点的FULL Oracle PASS，
但模型候选DAG又声明了一个与首节点执行身份完全相同的关键`MATERIAL_CHANGE`叶节点。首节点受验结果为
`material_change=false`，旧Executor将次节点归为dependency failure，导致整个原子stage在Explanation之后终态HOLD。

修复发生在Host compiler、任何Cell或stage创建之前：只删除唯一依赖等于activation source、source为`ALWAYS`、同criticality、
method registry IDs、Metric/Dimension IDs、time/comparison window、parameters与operator obligations的canonical JSON全部相同，且没有任何
后继依赖/activation引用的条件叶。Program budget按保留节点重算。不同方法/合同/参数/窗口/义务、非叶和真实条件能力节点继续保留。

该设计删除的是同一计算的重复执行请求，不把条件未触发伪装成成功，不改变Executor的critical HOLD、Oracle、Explanation或Authority语义，
也不从题目或数据值选择能力。旧A2与stage保持不可变；修复提交后仍须新clean build/fresh scratch从A1重跑六题。

## 39. B3 完整面板先行的协作边界

`2217ff9c` B3 已接受同时包含 `RECENT_COMPLETE_PERIODS`、`AGGREGATE_RATIO`、月份、渠道与目标人群的当前 Run
SemanticQueryContext；六个 Text2SQL candidate 分别停在 request derivation binding、ratio query/group shape 与 resolved time window
校验，compile 前零 datasource I/O。现有 aggregate-ratio proof 本来就支持多个直接 Dimension 分组，但只接受 exact resolved window 的
单层直聚合，不接受 SQL 内先筛渠道的 CTE/HAVING/额外 predicate。旧题面的业务顺序和 SQL 执行顺序混写，是此次候选漂移的直接诱因。

前向 `4.1.0` 采用两段式合同：Semantic 仍封存全部操作和对象；Text2SQL 只负责完整
`month × channel × audience × {spend,revenue,net_roi}` 当前 Run 事实面板及对应图；Root 在 accepted QueryEvidence 后才做渠道层汇总筛选，
并保留入选渠道的全部人群。父渠道净 ROI 从父级 SUM revenue/SUM spend 重算，禁止平均子组比例。若没有入选渠道就返回空集合，不能改窗口。

这一变化只明确能力顺序，不把 B3 改成单月/单分类，也不新增 Host SQL、答案生成、关键词路由、Formula、publisher、repair 或 call budget。
原 proof、来源、窗口、zero-denominator、完整面板 Oracle、history binding 与同 Run UI 标准不变。旧 `4.0.0` Run 和 hashes 不改写；
scoped commit 后必须新 build/fresh scratch 从 A1 重跑六题。

## 40. Analysis 必需交接与标准输出契约

`f02d610a` 证明两个相反但同源的题面歧义。A2 的 48 行完整事实和答案数值正确，却因题面只描述“拆开看看”而允许 Root 在
QueryEvidence 后直接结束，绕过已有 `monthly_panel` Analysis 与两图 Publisher。B3 则真实进入 `ratio_rollup` Analysis；Host 受验输出按所有
已选分类轴做父级筛选，并在事实后生成明确受限的 hypotheses/next steps。`4.1.0` 把任何原因或建议都判失败，会把标准受验输出误判为业务错误。

`4.2.0` 只调整编排合同。A2 在 Text2SQL 完整面板后显式要求 Analysis Agent、整体同比排名、客户类型贡献和两张既有确定性图；B3 在完整
双月面板后显式要求 Analysis Agent，以渠道 rollup 为主验收，同时允许受验方法报告其他分类轴。B3 的叙述分为 observed facts、口径和
clearly-labeled hypotheses；假设不能升级为因果、持续趋势或确定建议。Root 直接原表总结对 A2/B3 都失败，B1/B2 仍保持事实问答短链。

这不是按题目关键词新增 Host 路由，也不改变编译器、Executor、方法选择、Oracle、Publisher 或答案后处理。方法仍由当前 Run 的受验源形状和
operator obligations 选择；父比例仍按 SUM-before-ratio，完整窗口/分组/来源 proof 不变。旧 Run、Stage、Artifact 与 profile 保持不可变；
新 profile 必须在新 frozen build/fresh scratch 从 A1 完整重跑，禁止跨 epoch 合成 PASS。

## 41. 公开维度名驱动冻结检索，不允许 Specialist 越界补选

`a7d34c53` B3 的 ProviderTask/semantic receipt 证明 conversation/history 与 intent hash 均正确；断点发生在检索和 Semantic 之间。
`4.2.0` 的泛称“已发布营销日期”未选中营销事实日期列或 runtime time Dimension，而成功的 `f02d610a` 题面使用完整公开名
“blinkit_marketing_performance date”时，两者都在 frozen selection 内。Semantic 后续选择日期对象被 mandatory closure 拒绝是预期安全行为。

`4.3.0` 仅恢复 catalog 中用户可见的精确维度标题，使 retrieval query 在 Root 委派前冻结正确对象；不把内部 ID、SQL、列 binding 或结果值
写入题目，不由 Host 扩充 selected object IDs，也不改变 Semantic schema。Text2SQL 的完整面板先行和 Analysis 的渠道主 rollup 顺序保持
`4.2.0`。因此验证必须同时检查 intent/retrieval hashes、selected date column/dimension、current Run Context 和后续完整业务链，不能只看最终答案。

失败 Run 不重提。scoped commit 后关闭旧 epoch，以新 build/generation、fresh scratch 和新 Conversation 从 A1 重跑，旧五题不计入新 PASS。

## 42. 请求派生输出列与单 Stage 编排是同一问题合同的两个边界

`a35b67b5` B3 证明 retrieval 闭包已经修复：精确公开日期名同时冻结了 physical date column 和唯一营销日期 Dimension，Semantic 也在当前
Run 生成了正确的时间窗口与净 ROI request interpretation。Text2SQL 的候选 shape 却只有五列。Compiler 拒绝它不是偶发模型错误，而是
QueryEvidence 合同要求每个 request derivation 有同 Context hash 的 `REQUEST_DERIVED` 输出 binding；题面只说“事实面板”而未列出净 ROI，
使模型稳定遗漏该列。

`4.4.0` 因此把完整面板的逻辑 schema 写成六列，并明确 `net_roi` 是当前请求级 SUM-before-ratio 派生值。这不注入 SQL 或结果值，Semantic
仍拥有 operator，Text2SQL 仍必须通过现有 compiler/proof。Analysis 之后从32行子组面板重新做父渠道汇总，不能平均子组比例。

A2 的四个重复 Analysis Stage 则说明“必须交给 Analysis”仍不足以约束一次问题交接。`4.4.0` 将 A2 定义为单 task/single stage：一个 accepted
QueryEvidence、一个 Analysis Stage/Report，在该 stage 内同时完成整体月份排名、客户类型贡献和两类图发布。重复 stage、重复答案或重复图不能
靠后处理折叠为 PASS。该约束只影响非计分题面及验收器，不新增 Host 路由、方法、Publisher 或额度。

新 epoch 必须从 A1 重跑。B3 要同时证明 frozen selection、双 interpretation、六列 QueryEvidence、单 Analysis Stage、32行 source/stage
Oracle 和同 Run UI；A2 要证明单 Stage 与恰好两类必需图。旧 epoch 的局部 PASS 只用于回归定位。

## 43. 六题预检闭合后的正式门禁切换

`e5dc68c8` 的六题非计分 profile 已在同一 clean build/fresh physical scratch 内闭合。A、B 两个 Conversation 分别保持单一
Conversation ID，六个 Run 都完成独立业务 Oracle 后才浏览答案与 Trace；73/76/80/73/73/98 个节点全部打开并在刷新后保持 exact Run。
B3 的完整32行六列面板、当前请求净 ROI、单 Analysis Stage、`SMS` 渠道主筛选和四类人群是正式题面可复用的已验证业务合同，
但其 Run 与 receipt 不是 four-layer authority 行。

正式切换采用新的冻结闭包，而不是在运行中的非计分 scratch 上“升格”：先提交本证据形成新 HEAD，再 force build/full gate，创建 fresh
NAS 专用物理 scratch、fresh E17 scratch activation 和唯一 four-layer attempt。正式 manifest 保留原 5/2/2/6、层间首败停止、一个回合一次
composer、business 先于 UI/Trace、L4 两个固定 Conversation；只版本化已经批准和预检过的自然语言定义：已发布 ROAS 的实际 AST、请求级净 ROI、
精确营销日期维度、完整面板、单 Analysis Stage 和描述性假设边界。manifest 不注入 SQL、内部对象 ID 或结果值。

正式 15 回合仍不能组合预检 PASS。每个正式 turn 必须由 gate authority claim 当前 ordinal，绑定同一个 formal build/baseline/release/profile，
terminal 后写 deterministic business receipt；只有 business PASS 才打开同 Run QA/Trace 并 finalize。全部 turn PASS 后才能通过前向恢复流程把
live E16 激活为 E17，随后做 production-port readback、390px smoke、live/protected-history 审计和资源清理。

## 44. 双版本 manifest 的不可变映射

Contracts 同时保留 v1 blueprint 和当前 v2 blueprint，并由 manifest schema version 选择唯一题库；构造器默认 v2，verifier 不允许调用方用
v1 schema 包装 v2 turns 或反向混配。v2 保持 15 个 turn_id、5/2/2/6 层级、Conversation 模式和一次性 ordinal，只收敛题面与 rubric：
公开公式/术语在 Semantic 层定义，Text2SQL 仍必须消费签发后的 SemanticQueryContext，复杂趋势再交给唯一 Analysis Stage。Report 是按题面
选择的展示消费者，不再是每个协作回合的必选 Agent。

数据库以 migration 10817 前向更新 begin RPC。RPC 对 v1/v2 分别校验 exact canonical turns hash，其他 manifest identity、当前 E17 authority、
active-attempt 排他和 replay 条件完全复用。迁移前锁定并摘要四个受保护 schema 的实体表；迁移后逐表比较，同时核验 RPC body、owner、PUBLIC
revoke 和 backend execute grant。migration ledger 是唯一被允许新增的持久化行。

实现完成提交与正式证据 epoch 分离：实现提交可以用 disposable E17 copy 证明 migration 及 v1/v2 replay，但正式 controller 必须从该提交做
新 generation/build attestation，再创建新的物理 scratch、activation、manifest 和 attempt。这样难度收敛发生在版本化业务合同，不发生在
Oracle、同 Run 绑定、UI/Trace 或 live authority 上。

## 45. 独立 TABLE Artifact 是正式表格可见性证据

首个 v2 正式 attempt `bd57f9cd-365b-47f1-a397-cdbc932088e6` 的 L1-01 至 L1-03 完整通过；L1-04 的当前 Run
`562a1b63-596f-8630-968c-c15c518e4e9f` 业务 receipt 与独立 PostgreSQL Oracle 均 PASS，页面截图也展示了 10 行
QueryEvidence 表格，但 QA observer 只查询 `chart-source-table`。该 selector 只标记图表的等价源表，独立 `TABLE` projection
没有对应标记，因此生成了不可重试的 `FALCON24_QA_UI_OBSERVATION_FAILED`。

前向修复为 `ArtifactWorkspaceTable` 增加统一的 `artifact-data-table` 标记，并让 four-layer QA 同时接受独立表和图表源表。
它只修复“已经真实可见的表格是否被 observer 识别”，不改变 table-required rubric、Artifact 内容、业务 Oracle、Run、答案、Trace
或 live authority。失败 attempt 保持 immutable；新 commit/build/fresh physical scratch/fresh attempt 必须从 L1-01 重走。

## 46. 纯明细查询不经过无关 Semantic 预解析

selector 修复后的 v2 attempt 已证明同一 build 的 L1-04 QueryEvidence、Oracle、TABLE QA 与 Trace 可以闭合；另一次 attempt 中 Root
却先调用 Semantic，生成带空候选歧义的 `SemanticQueryContext`，随后 Text2SQL 以
`TEXT2SQL_SEMANTIC_CONTEXT_AMBIGUOUS` 正确拒绝。这个差异来自题面路由含混，不是 datasource、编译器或 UI 回归。

v3 保持15题、Agent contract、rubric 与所有证据门槛，只把 L1-04 的用户可见问题写成“纯订单明细、无需先解释指标或时间语义、直接由
Text2SQL 查询”。这仍是模型读取的自然语言任务合同，不是 Host 关键词路由，也不向模型提供 SQL、内部对象 ID 或结果。

Contracts 同时冻结 v1/v2/v3，v3 turns canonical hash 为
`sha256:bc9fdac88acf23889beabeb2ae2c6f49d3df93d72c02d87ab1fde023e434564a`。migration 10818 以 post-10817
`prosrc` hash 为前置，通过唯一结构替换增加 v3 分支；迁移内逐表历史摘要和 ACL snapshot 保持 fail-closed。accepted-input L1-05
另采用“停 Worker→claim 得到 exact Run ID→以该 ID 重启 Worker”的运行顺序，避免把上一个 attempt 的 seed 或外部 ref 冒充当前 Run 输入。

## 47. 已发布客单价公式的单义门禁

v3 正式运行中，L1-02 的 Semantic task 已接受 `formula.average_order_value`，其产物也足以回答客单价公式；但同一题的“客户订单总金额”
没有已发布公式候选，Semantic 因此保留一个 `candidate_ids=[]` 的 FORMULA 歧义。Host 只对无未决歧义的
`SEMANTIC_FACTS_ONLY` 产物做确定性结算，所以拒绝该产物是正确的 fail-closed 行为。Root 后续的非 JSON 输出不能成为绕过歧义的理由。

v4 通过版本化题面删除这个未治理的第二术语，只要求 Semantic 解释明确给出的已发布公式 ID、分子、分母和零分母行为；rubric 同步缩减为
`published-aov-definition`。这不是降低四层证据链：L2–L4 的 Semantic→Text2SQL→Analysis 协作、复杂面板、单 Analysis Stage、业务
Oracle、QA/Trace、浏览器与 live authority 切换完全不变。旧 v1/v2/v3 blueprint、hash、attempt 和 receipt 均保持不可变。

Contracts 默认 v4，同时按 schema version 严格选择四套冻结 blueprint。v4 turns hash 为
`sha256:1b197368096673c1015935308f2db4a4fcddb0f3cc04c73b627cd7ce4d97503f`。migration 10819 在 exact post-10818
`prosrc` hash 上做唯一结构替换，仅增加 v4 schema/hash 分支；迁移前后比较全部受保护表摘要与函数 ACL。正式 v4 运行仍必须从新提交的
clean build、fresh physical scratch、fresh activation 和 fresh attempt 开始，禁止继承 v3 的任何局部 PASS。

## 48. containment 节点到发布物理列的精确投影

Falcon24 图检索将表列作为 `contains.column.<table>.<column>` 节点返回，发布执行目录则以
`column.<table>.<column>` 作为 physical binding 的 logical object identity。两者是同一已发布列的检索关系节点与执行对象，旧实现却在
Worker projection 和 Platform QueryEvidence 两侧都做了字符串精确比较，导致“已检索但未选择”的假阴性。

共享 Contracts helper 只接受两个固定前缀：原 `column.*` 保持不变，`contains.column.*` 去掉 `contains.`；其他对象返回 null。
Worker 将该 canonical id 加入冻结模型投影的 physical binding 过滤集合；Platform 用同一 helper 建立 selected physical-column set。
后续 `physicalSources` 仍要求唯一 active catalog binding、同 datasource、同 table/column 和同 physical snapshot 类型，因此映射不创建
binding、不授权兄弟列，也不绕过 semantic selection。

v5 仅前向替换 L1-04 题面，显式给出已公开物理表列、日期 cast、排序和参数化 limit，使冻结检索只围绕本题三列建立闭包，避免无关时间
对象参与 compile。完整业务表、独立 PostgreSQL Oracle、QA/Trace 与一次性 attempt 标准不变。Contracts 按 schema version 继续验证
v1～v5 blueprint；10820 对 begin RPC 做唯一结构替换并保留历史摘要与 ACL 校验。

## 49. 长答案后的 Trace 入口必须真实可点击

v5 正式 attempt 在 L3-01 已完成 business 与 QA 后，Trace observer 发现长答案末尾的运行轨迹入口虽然存在且未禁用，但 `block:center`
滚动把入口中心留在 Composer 覆盖区，`elementFromPoint` 命中 textarea，因而以 `FALCON24_TRACE_ENTRY_NOT_ACTIONABLE` 正确停止。
入口本身、Run、Trace 与页面数据均未漂移；问题是自动验收的滚动定位不能保证长内容末端进入可点击视口。

前向修复仍保留真实指针可操作性校验，只将入口二次定位改为 `block:start`。浏览器在内容末端会滚到容器最大位置，使入口落在消息区
底部留白内、避开 Composer；随后仍必须通过非零尺寸、视口边界、`elementFromPoint` containment 和真实 click。不得改为 DOM `click()`、
强制点击或跳过可操作性检查。旧 attempt 和已生成的 receipt 保持不可变，新提交必须重新 build 并从新 attempt 的 L1-01 全量证明。

## 50. 已接受表格的 Report 交接必须在题面中单义

v5 attempt `3e95d599-edcf-4777-bc1f-3a5630ea179d` 的前四题完整通过。L1-05 在 exact Run 绑定 accepted table 后，Root 首次返回
非 JSON，第二次返回不符合 `root-agent-final-answer@1.0.0` 的对象；两次都没有 native Tool Call。该失败发生在 Report admission 之前，
不是 accepted input、Report runtime 或答案事实验证失败。

v6 仅将 L1-05 的自然语言合同改为“只委派 Report Agent”，保留 Report Agent 作为唯一 expected specialist，也保留
accepted-table-only、management-summary、no-unsupported-claims 三项业务验收。Host 不新增关键词 Router、固定 DAG、模型响应修补或
自动 Report 调度；当前 Run Artifact admission 与最终 answer verifier 仍按原路径执行。旧 v1～v5 blueprint/hash/attempt 不变，10821
只在 exact post-10820 begin RPC 上追加 v6 hash。新正式证据必须来自新 commit/build/fresh physical scratch/fresh attempt。

## 51. 渠道 ROAS 两步交接不应让 Root 发明时间窗口

v6 attempt `a9782700-abc4-47ab-b1b9-68d6032dab6c` 的 L2-02 Run
`755a7323-6797-8da7-a8bf-31d88bb9008a` 证明发布公式本身已经进入冻结闭包：route 直接命中
`formula.marketing_roas`，retrieval selected set 含渠道、投入、收入和 ROAS，inference mandatory object 也是该公式。
失败由 Root 的 objective 漂移造成：前两次额外要求当前时间窗口，触发两次
`TEAM_SEMANTIC_SELECTION_OUTSIDE_FROZEN_CLOSURE`；第三次成功 Context 只含已发布对象，却被 Root 声明为
`semantic-only`，因此没有 Text2SQL task。Run 的 SUCCEEDED 不替代 exact Agent contract，business 正确以
`AGENT_CONTRACT_MISMATCH` 封存。

v7 只前向替换 ordinal 6 的模型可见题面，枚举四个已发布对象、明确全量无日期过滤、固定 Semantic 后继续 Text2SQL，并写出四列结果与
ratio-of-sums/零分母口径。Host runtime、模型自主原生 Tool Call、exact task admission、SQL compiler、QueryEvidence 与 UI/Trace
完全不变；特别不增加 deterministic router/DAG 或允许闭包外选择。v1～v6 blueprint 继续按 schema version 验证。10822 在 exact
post-10821 `prosrc` 上做唯一替换，追加 v7 turns hash
`sha256:df80081985d2a65f2ea161bb079a8b2a1dfa2930a90090493f3be6f640032795`，并保持逐表历史与 ACL 快照守卫。

## 52. Root native Tool Call 输出预算与 Team runtime 对齐

v7 attempt `333ecf97-aae1-496b-ae68-6d0509725181` 的 L1-01～L1-04 已在同一 build/scratch 完成 business、QA、Trace；
L1-05 exact accepted table 也按停 Worker、claim、精确 seed 的顺序绑定。Root 第一次完整非 JSON 被既有有界反馈拒绝；第二次已经选择
`report-writing-agent`，但 provider usage 精确到达 `output_tokens=2048`，native Tool Call 参数在字段中间截断，Run 以
`ROOT_AGENT_TOOL_CALL_INVALID` 失败。该 attempt 已不可变封存。

Production `run-bound-provider-dispatcher` 原先把 Root 输出再次硬编码截到 2048，而 `deriveTeamRuntimeTaskBounds` 已声明 4096；这是一处
跨层预算漂移，不是 Report/Semantic 权威或题面缺失。前向修复只把 Root 单次输出 ceiling 对齐到4096，并继续取认证模型
`effective_output_ceiling_tokens` 与 context headroom 的更小值。Provider 调用次数、Root 四回合、Tool allowlist、Catalog admission、
accepted Artifact、答案 verifier 和失败关闭规则均不改变；v7 manifest/10822 无需新版本。

## 53. 专职产物范围与根流程终态是两条独立轴

L2-02 的 provider 原始响应证明 Root 已把 Semantic Tool Call 声明为 `CONTINUATION_INPUT`；Semantic 返回的
`answer_scope=SEMANTIC_FACTS_ONLY` 也完全符合其被分配的第一步 objective。旧的
`terminalSemanticFactsDecision` 只读取第二条信号，于是把“专职任务已完成”误作“整个用户流程已完成”。这是 Worker 跨层编排合同错误，
不是模型未选择 Text2SQL，也不是发布 ROAS 公式缺失。

修复后的自动终态判定读取同一条 completed observation，并要求四项同时成立：profile 为 Semantic、Artifact 为已验收
`SemanticQueryContext`、Context 无未决歧义且 scope 为 semantic facts、Root usage 为 `FINAL_ANSWER_EVIDENCE`。若 usage 为
`CONTINUATION_INPUT`，正常 Root provider loop 接收原样 observation 历史并决定下一 Agent。这样 specialist scope 仍由 Semantic Host
验证，workflow terminality 仍由 Root 决定，两者不互相覆盖。

预防矩阵不只断言最终返回值，还验证 continuation 的下一次 provider 输入包含成功 Context 及完整历史；final-evidence 分支继续无需额外
provider call。实现不添加 Router/DAG、不自动选择 Text2SQL、不改 manifest 或 Agent allowlist。失败类别归为 B（Cross-Layer Contract）
与 D（Test Coverage Gap）：既有测试错误地把两种 `output_usage` 都期望为终态，现改为二维合同回归。

## 54. 完整 Schema 拒绝使用已知拒绝通道，未知协议故障仍失败关闭

L3-02 的 Provider 并未产生 Tool Call，原始 JSON、stream terminal、finish reason 与 usage 均被 bridge 完整观测；唯一失败是该 JSON
不满足服务端 Root response Schema。这个状态既不是已接受决策，也不是未知副作用。跨层投影应为：

```text
complete no-tool JSON text
  -> JSON parse succeeds
  -> server Schema rejects original value (no repair)
  -> bridge brands only this in-memory error as fully observed schema-invalid
  -> adapter emits MODEL_RESPONSE_SCHEMA_INVALID + DISPATCHED_OUTCOME_KNOWN
  -> Direct Root maps to PROVIDER_RESPONSE_REJECTED
  -> Team checkpoints rejection feedback and advances to the next existing Root turn
```

brand 使用不可序列化 WeakSet，只能由 bridge 在读取完整原流后附加；复制 diagnostic、手工构造相同错误码或只观察 Zod issue 都不能获得
known certainty。event contract 只允许 empty、invalid JSON 和 schema-invalid JSON 三种完整拒绝携带
`DISPATCHED_OUTCOME_KNOWN/retryable=false`。原始文本、解析对象和 schema issue 值均不进入公开事件或 checkpoint。

这不增加 provider attempt、Root turn、工具预算或路由规则。Tool activity、流中断、未知 finish、预算越界及任何未满足完整性条件的
schema/protocol 错误仍为 `DISPATCHED_OUTCOME_UNKNOWN` 并终止。该修复归类为 **B Cross-Layer Contract Gap** 与
**D Test Coverage Gap**：bridge 已知道确定性，但 adapter/event/Team 没有对应的安全负结果合同，测试也只覆盖了 empty 与 invalid JSON。

## 55. Root delegation objective 是用户范围的保真投影

L3-02 的事件和 provider 原文证明 §54 已按设计工作：两次完整 Semantic schema 拒绝都被 checkpoint 后交还给下一个普通 Root turn；第三次
Semantic 和第四次 Text2SQL 成功。新断点来自 objective 漂移而不是失败恢复：Root 把题面“当前数据”误作待解析时间窗口，并在后续
Text2SQL objective 丢掉显式 conversions，既浪费有界回合，也破坏完整面板。

修复位于 Root system message 的通用决策合同。它将 authority/freshness 短语与业务时间限制分开：没有用户提供或继承的期间时，
Semantic 和 Text2SQL 保持 all-time/unbounded，不选择额外时间对象。它还要求 Root 将用户枚举的维度、指标、公式、输出字段、分组和图表要求
逐步保真投影到所有需要它们的下游 objective，Analysis 只能消费完成该面板的 QueryEvidence。

该规则不读取题目 ID，不列出营销专用对象，也不决定 Profile 或 DAG；Root 仍从冻结 Catalog 自主选择下一步。manifest v7、Root 四回合、
Specialist 内层预算、Schema、Artifact admission 和所有 formal proof 不变。该修复归类为 **A Prompt/Instruction Gap** 与
**D Test Coverage Gap**，用 system-message regression 固定边界，再以 fresh one-shot epoch 验证实际协作。

## 56. L3 营销面板复用发布 conversions 权威

L3-02 的新失败不是 Root scope 漂移：首个 Root objective 已完整携带投入、归因收入、转化、ROAS、渠道和目标人群，且没有要求时间窗口。
断点位于自然语言入口与 active release 的命名差异：题面“营销转化”没有候选，而 generation 2 已有同一物理列上的
`metric.conversions` 与 `formula.conversions=SUM(conversions)`，别名是“转化量”。因此不演进第二套同义指标，也不靠未发布源码别名。

manifest v8 只前向改写 L3-02：第一步列出既有 canonical IDs，第二步冻结 all-time 六列 `channel × target_audience` 面板，第三步冻结
单 Analysis Stage。模型仍自主产生每个 Tool Call 和 SQL；Host 不按 case ID 路由、不生成 SQL、不补业务结果。v1～v7 继续按各自 turns hash
验证，10823 只扩展 begin RPC 的版本/hash allowlist，并以全表 digest、函数 owner/SECURITY DEFINER/ACL 和历史 replay 证明零数据漂移。
该收敛归类为 **C Semantic Contract Naming Gap** 与 **D Test Coverage Gap**；难度只在已发布术语入口上降低，证据门槛不变。

## 57. L3 分类比较保持单单位输入

v8 已证明 Semantic→Text2SQL 交接和六列事实表均可执行；真正断点位于 Analysis applicability，而不是术语、SQL 或数据缺失。分类比较当前
按所有选中 Metric 的发布单位做同质性校验，`conversions=unit.count` 与 spend/revenue 的 `unit.currency` 不能进入同一比较程序。
这个守卫防止将数量、金额和比率画到同一坐标或生成误导性排序，因此不修改通用 applicability、planner 或 compiler。

v9 将 L3-02 收敛为单一度量 `metric.conversions`，同时保留两个分类维度、三步原生 Tool Call、完整 QueryEvidence、唯一 Analysis
Stage、表格/图表同源和最终 QA/Trace。它降低的是题面度量组合复杂度，不是 Agent 协作、执行、证据或业务正确性标准。v1～v8 按各自
blueprint/hash 继续验证，10824 只扩展 begin RPC 的版本/hash allowlist，并用逐表 digest 与 RPC 安全边界守卫证明零历史漂移。

## 58. Root snapshot 区分原写入租约与当前执行租约

Queue 每次接管生成新 `attempt_id` 并递增 `worker_fence`；Event Store 在当前 Run/Scope 下验证并加载已提交 snapshot。
Root 原恢复校验将 snapshot provenance 与当前租约逐项相等比较，导致通用 Runner 支持的 crash recovery 在真实 Root executor 中失败。
既有 Root 测试只使用同一租约，未覆盖跨层组合，归类为 B（跨层契约）与 D（测试缺口）。

恢复接受两个来源：同 fence 且同 attempt，或更低 fence 且不同 attempt。更高 fence、同 fence 不同 attempt、同 attempt 跨 fence
均拒绝。其余 Run、Workflow、snapshot version、Root budget、accepted Artifact Scope 校验保持原样；Event Store hash 验证不绕过。
恢复后依旧通过当前租约 guard/CAS 提交新快照；原快照不重写、不改 hash，不把其 provenance 提升为当前写入权限。

测试用新租约重新签发 Effective Config Context Receipt，覆盖已接受输入、已完成 tool turn 和 terminal 三种恢复；验证后续 snapshot
使用新 attempt/fence，Root 从下一 turn 继续且不重复工具。已封存 `966091b9` 保持 FAILED；新构建与 fresh v9 attempt 独立验收。

## 59. 月度比较参考在运算前规范化缺失值

本次故障归类为 B（Arrow/pandas/JSON 跨层表示契约）与 D（未覆盖实际数值 dtype 的执行测试）。QueryEvidence 中的 NULL
在 pandas 浮点列中不是必然的 `None`，以 `is None` 过滤会将 NaN 计入观察/排名。Publisher 最后的 JSON 规范化只能恢复合法表示，
无法修复此前的 count/extrema。原 Oracle 拒绝是正确行为，不改变其算法或相等标准。

修复复用已有分类比较/分群面板的无数据参考模式：原月度 `execution_contract` 携带精确列、逻辑时间类型、时区及 Python preparation reference。
参考在派生副本上按明确业务日历规范日期、按 `pd.isna` 规范数值，再执行原计数、极值、稳定排名、首尾变化和相邻下降公式。
所有原行及源列保留，NULL 不补零、端点不移动、不跨缺口，非缺失无限值拒绝。通用 Agent 提示同步明确“统计前规范化，而非只在发布时转换”。

Host 不运行参考、不预计算答案、不改已经封存的 stage；模型仍提交实际 Cell，原 AST policy、Publisher 和 TypeScript 独立 Oracle 全部保留。
参考仅增加当前 method 的执行说明，不创建 Metric/Formula/Authority，不改 ResultContract/hash 算法、v9 manifest 或调用预算。
NAS 无模型探针用原 Agent image 的 Arrow→pandas 对真实失败输入及 7 个边界变体逐字段比对，两个旧误计序列均被定位且旧输出继续拒绝。
两只验证容器串行 `--rm`、无网络、512 MiB/1 CPU，峰值 1、残留 0；审计为 `monthly-comparison-null-reference-probe.json`，不计正式 PASS。

## 60. Trace 点击前必须观察布局稳定

根因属于 E（把单帧可点击误当成后续指针事件可点击）与 D（mock 未执行滚动帧）。`ede08965` 的正式批次前四题通过，
L1-05 business/QA 已通过，但返回答案后仍在平滑定位。只读帧与 trusted pointer 记录证明：CLI 在 y≈523 点击时，
按钮已从 y≈508 移到 y≈615，实际命中正文 `P`。这不是已修复的 Trace selection 重置，也不是模型或业务失败。

此前的 `block:start + elementFromPoint` 只验证一个时刻；单纯等待最终可点击也不足，因为自然滚动结束后按钮可能被 Composer 遮挡。
修复顺序为：同元素身份及矩形连续120ms稳定 → 原滚动定位及命中检查 → 同元素、同矩形、无遮挡连续120ms稳定 → 真实指针点击。
所有观察按 animation frame 进行且有25秒上限，不使用固定 sleep、DOM click、隐藏 Composer、扩大超时或重复提交。
搜索节点同样在筛选布局稳定后点击；节点/详情/产物/hash/刷新/切 Run 的原判定保持不变。

VM 回归执行实际等待表达式，覆盖移动、替换、遮挡、缺失、零尺寸、disabled、视口外和持续移动；原观察器测试核对操作顺序。
同一原 Chrome 对已封存 L1-05 的完整 Trace 只读验证通过，回执标记 `diagnostic_only=true/authority_writes=0`，不能计正式 PASS。
失败回执 `sha256:2769bce7cf867335a36b09ef8d13f772a63874c0601e1ef875bd782a66593ebc` 保留于原 attempt；
新提交必须重新冻结、build、fresh scratch 和15题。规范同步在 frontend/component-guidelines；仓库无对应 Trellis 分发模板。

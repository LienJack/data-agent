# U6 Result Key Metadata 生命周期与部署函数合同

> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED` · `u6-result-key-lifecycle@1.0.0`
> 本文冻结非秘密 Key metadata、首次启用、轮换、事故恢复与部署幂等边界；不证明外部
> KMS/keyring、`10590` 或 Hosted/Docker 已交付。

本文是 `research_result_key_versions`、
`research_result_key_transition_operations` 与四个 Key 部署函数的唯一合同。密文、
HMAC 与 Keyring Port 取 Invocation Result Crypto；表 Scope、普通锁级与 RLS 取
Execution Storage/Database Surface；一次性 DDL 取 Migration Safety。数据库只保存
hash/版本/状态，绝不保存 raw key、KMS URI、明文 alias 或可导出 handle。

## 1. Strict Wire 与函数签名

四个函数都固定为 `(envelope_json jsonb) RETURNS jsonb`、`VOLATILE CALLED ON NULL
INPUT SECURITY DEFINER SET search_path=''`，null/额外 key/错误 union 在取锁前失败：

```ts
type ResultKeyKind = "ENCRYPTION" | "COMMITMENT";
type ResultKeyState =
  | "STAGED" | "ACTIVE" | "DECRYPT_ONLY" | "VERIFY_ONLY"
  | "RETIRE_PENDING" | "RETIRED" | "COMPROMISED";
type ResultKeyPredecessorRef = {
  key_version: Version;
  key_reference_hash: Sha256;
  expected_state: "ACTIVE" | "COMPROMISED";
  expected_state_hash: Sha256;
};
type ResultKeyStageCommon = {
  protocol_version: "u6-result-key-stage@1.0.0";
  operation_id: ImmutableId;
  scope: AppScope;
  key_kind: ResultKeyKind;
  new_key_version: Version;
  new_key_reference_hash: Sha256;
  challenge_receipt_hash: Sha256;
  request_hash: Sha256;
};
type ResultKeyStageInput = ResultKeyStageCommon & (
  | { stage_mode: "BOOTSTRAP"; predecessor: null;
      incident_receipt_hash: null }
  | { stage_mode: "ROTATION";
      predecessor: ResultKeyPredecessorRef & { expected_state: "ACTIVE" };
      incident_receipt_hash: null }
  | { stage_mode: "COMPROMISE_RECOVERY";
      predecessor: ResultKeyPredecessorRef & { expected_state: "COMPROMISED" };
      incident_receipt_hash: Sha256 }
);
type ResultKeyActivateCommon = {
  protocol_version: "u6-result-key-activate@1.0.0";
  operation_id: ImmutableId;
  scope: AppScope;
  key_kind: ResultKeyKind;
  new_key_version: Version;
  expected_staged_state_hash: Sha256;
  request_hash: Sha256;
};
type ResultKeyActivateInput = ResultKeyActivateCommon & (
  | { predecessor: null }
  | { predecessor: ResultKeyPredecessorRef & { expected_state: "ACTIVE" } }
  | { predecessor:
        ResultKeyPredecessorRef & { expected_state: "COMPROMISED" } }
);
type ResultKeyRetireCommon = {
  protocol_version: "u6-result-key-retire@1.0.0";
  operation_id: ImmutableId;
  scope: AppScope;
  key_kind: ResultKeyKind;
  key_version: Version;
  expected_state_hash: Sha256;
  request_hash: Sha256;
};
type ResultKeyRetireInput = ResultKeyRetireCommon & (
  | { transition: "MARK_RETIRE_PENDING";
      expected_state: "DECRYPT_ONLY" | "VERIFY_ONLY";
      destruction_receipt_hash: null }
  | { transition: "COMMIT_RETIRED"; expected_state: "RETIRE_PENDING";
      destruction_receipt_hash: Sha256 }
);
type ResultKeyCompromiseInput = {
  protocol_version: "u6-result-key-compromise@1.0.0";
  operation_id: ImmutableId;
  scope: AppScope;
  key_kind: ResultKeyKind;
  key_version: Version;
  expected_state: Exclude<ResultKeyState, "RETIRED" | "COMPROMISED">;
  expected_state_hash: Sha256;
  incident_receipt_hash: Sha256;
  request_hash: Sha256;
};
type StoredResultKeyTransitionResult = {
  protocol_version: "u6-result-key-transition-result@1.0.0";
  operation_id: ImmutableId;
  request_hash: Sha256;
  scope: AppScope;
  key_kind: ResultKeyKind;
  key_version: Version;
  action:
    | "STAGE" | "ACTIVATE" | "MARK_RETIRE_PENDING"
    | "COMMIT_RETIRED" | "COMPROMISE";
  before_state: ResultKeyState | "ABSENT";
  after_state: ResultKeyState;
  predecessor: ResultKeyPredecessorRef | null;
  state_hash: Sha256;
  committed_at: Timestamp;
};
type ResultKeyTransitionResult =
  StoredResultKeyTransitionResult & { created: boolean };
```

函数名与 Input 唯一映射为
`stage_u6_result_key_version`、`activate_u6_result_key_version`、
`retire_u6_result_key_version`、`compromise_u6_result_key_version`。不存在 public/
deployment `restrict_u6_result_key_version`；ACTIVE 的正常降级只能作为 Activate
replacement 的同事务效果，避免留下不可恢复的“无 ACTIVE、又不满足 bootstrap”状态。

`request_hash` 逐字取 Migration Safety 的
`u6-deployment-command-request-hash@1.0.0`，数据库必须重算。
`state_hash` 不采用数据库 JSON 文本或 locale 时间。数据库与 TypeScript 必须把所有
`timestamptz` 规范化为 UTC、固定六位小数的
`YYYY-MM-DDTHH:mm:ss.SSSSSSZ`，再计算：

```text
sha256(
  UTF8("u6-result-key-state@1.0.0\0")
  || UTF8(JCS([
    app_id, tenant_id, environment, key_kind, key_version, state,
    key_reference_hash, stage_mode,
    predecessor_key_version, predecessor_key_reference_hash,
    predecessor_state_at_stage, predecessor_state_hash_at_stage,
    challenge_receipt_hash, stage_incident_receipt_hash,
    compromise_incident_receipt_hash, destruction_receipt_hash, staged_at,
    activated_at, restricted_at, retire_pending_at, retired_at, compromised_at
  ]))
)
```

数组位置、大小写与 null 都参与 hash；调用方只以 expected hash 做 CAS，数据库每次
状态变化后重算。BOOTSTRAP/STAGED 固定向量为：

```text
JCS array =
["11111111-1111-4111-8111-111111111111",
 "22222222-2222-4222-8222-222222222222","test","ENCRYPTION",
 "test-key-v1","STAGED",
 "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
 "BOOTSTRAP",null,null,null,null,
 "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
 null,null,null,"2026-07-27T00:00:00.000000Z",null,null,null,null,null]
state_hash =
sha256:1a12955567f8087b1eb8dafe82f0c60f828fa1dcd1eebb61a99b9b194d9c881c
```

## 2. 物理 metadata 与 replay authority

`research_result_key_versions` 的 PK 为 `(S,key_kind,key_version)`，并有：

- exact UQ `(S,key_kind,key_version,key_reference_hash)`；
- partial UQ `(S,key_kind) WHERE state='ACTIVE'`；
- partial UQ `(S,key_kind) WHERE state='STAGED'`；
- `stage_mode` immutable；
- `predecessor_key_version/predecessor_key_reference_hash/predecessor_state_at_stage/
  predecessor_state_hash_at_stage`：BOOTSTRAP 四者全 null；ROTATION/
  COMPROMISE_RECOVERY 四者全非空；CHECK 还要求 version/hash 两者同空同值。前两者与
  `S/key_kind` 组成 `ON DELETE NO ACTION MATCH SIMPLE NOT DEFERRABLE` composite FK，
  精确引用 predecessor 的 `(S,key_kind,key_version,key_reference_hash)` UQ；
- `key_reference_hash`、`challenge_receipt_hash`、`stage_incident_receipt_hash`、
  `compromise_incident_receipt_hash`、`destruction_receipt_hash` 与六个状态时间；
  stage input 的 incident 只写第一列，Compromise input 只写第二列，互不覆盖；无 secret。

`research_result_key_transition_operations` 为 append-only replay authority：PK
`(S,operation_id)`，保存 `request_hash/action/key_kind/key_version/predecessor ref/
before_state/after_state/state_hash/committed_at/result_json`，UQ
`(S,key_kind,key_version,action,operation_id)`；`result_json` 逐字段等于
`StoredResultKeyTransitionResult`，不存 response-only `created` 或 key/result bytes。
Transition receipt insert 与全部 metadata CAS 同事务：commit 前 crash 全回滚；commit
后 response 丢失，同 operation/hash 取 stored result 并附 `created=false`，首次提交
附 `created=true`；异 hash 冲突。

状态、kind 与六个时间列的 exact 矩阵为：

| state | key kind | `staged/activated/restricted/retire_pending/retired/compromised_at` |
| --- | --- | --- |
| `STAGED` | 两者 | `值/null/null/null/null/null` |
| `ACTIVE` | 两者 | `值/值/null/null/null/null` |
| `DECRYPT_ONLY` | 仅 ENCRYPTION | `值/值/值/null/null/null` |
| `VERIFY_ONLY` | 仅 COMMITMENT | `值/值/值/null/null/null` |
| `RETIRE_PENDING` | 两者 | `值/值/值/值/null/null` |
| `RETIRED` | 两者 | `值/值/值/值/值/null` |
| `COMPROMISED` | 两者 | `staged_at` 与 `compromised_at` 有值、`retired_at=null`；中间三列只能是截至事故前状态形成的连续前缀 |

所有非 null 时间单调不减。允许边只有 `ABSENT→STAGED→ACTIVE`；
`ACTIVE→DECRYPT_ONLY`（ENCRYPTION）或 `ACTIVE→VERIFY_ONLY`（COMMITMENT）；
两种 restricted state `→RETIRE_PENDING→RETIRED`；以及任一非 `RETIRED/
COMPROMISED` 状态 `→COMPROMISED`。`RETIRED`、`COMPROMISED` 均为吸收态；恢复通过
新 version，不改旧行。Predecessor 的四个 stage-time 字段从 STAGED 起永久不变。
BOOTSTRAP/ROTATION 的 `stage_incident_receipt_hash=null`，COMPROMISE_RECOVERY
非空；只有 COMPROMISED 的 `compromise_incident_receipt_hash` 非空，只有 RETIRED 的
`destruction_receipt_hash` 非空。每个 evidence hash 一旦写入即 immutable。

## 3. 唯一锁序与三种 Stage

四函数先走 Database Surface 的 PROVISION authority prefix，再按：

```text
scope-wide (S,key_kind) rotation advisory
→ (S,operation_id) transition-operation advisory / existing replay row
→ existing ACTIVE（至多一行）
→ existing STAGED（至多一行）
→ exact predecessor
→ exact target version
→ Preparation/Blob/commitment dependency rows（需要时，完整 PK bytes 顺序）
→ insert Key Transition Operation receipt
```

同 operation/hash 的 existing receipt 在重新通过 PROVISION authority 后直接返回
`created=false`，不得因当前 Key 状态已推进而把成功重放误判成 stale。所有查询显式
完整 `S`；absent row 由 advisory 串行。Stage 分支：

- **BOOTSTRAP**：`predecessor=null`，同 `S/kind` 从未有任何 Key Version/Transition，
  且 Inventory 查询证明没有 Preparation、Blob、Result 或 commitment dependency；
  只能插入第一张 STAGED。
- **ROTATION**：必须恰有一张 ACTIVE、没有 STAGED；predecessor exact 指向该 ACTIVE，
  state/reference/state hash 全匹配。新 version 必须此前不存在。
- **COMPROMISE_RECOVERY**：没有 ACTIVE/STAGED；predecessor 必须是该 kind 最近一次
  `compromised_at` 最大（并以 version UTF-8 bytes 破同值）的 COMPROMISED 行，且
  `incident_receipt_hash` 非空并与事故操作闭包匹配。历史受损 Result 仍失败关闭；
  recovery 只恢复后续新写，不能冒充旧密文可解。

三支都先验证外部 keyring challenge receipt 与
`new_key_reference_hash`，再插 STAGED。两个并发 Stage 只能一个成功；不能覆盖或重绑
已有 STAGED predecessor。

## 4. Activate、Retire 与 Compromise

Activate 重新锁定并重验 STAGED `state_hash`：

- BOOTSTRAP：仍无其他 Key/依赖行；直接 `STAGED→ACTIVE`。
- ROTATION：predecessor 仍是 exact ACTIVE，且其 CLAIMED Preparation 为零；同事务先
  `ACTIVE→DECRYPT_ONLY|VERIFY_ONLY`，再 `STAGED→ACTIVE`。
- COMPROMISE_RECOVERY：predecessor 仍为 exact COMPROMISED、仍无 ACTIVE；只把新行
  `STAGED→ACTIVE`，不复活或修改 predecessor。

同一 predecessor/state hash 的两个 Activate operation 只有一个 CAS winner；loser
全回滚。任何已经改变的 predecessor 都使 stale STAGED activation 失败，禁止重新选择
另一个 ACTIVE。

Retire 的 `MARK_RETIRE_PENDING` 只接受 matching restricted state，要求该 version 的
CLAIMED Preparation、AVAILABLE Blob 与未清 commitment 均为零，且
`destruction_receipt_hash=null`；`COMMIT_RETIRED` 只接受 RETIRE_PENDING，并要求外部
destroy/disable receipt hash 非空。两步均不可反向。

Compromise 可从任一非吸收状态原子进入 COMPROMISED，必须绑定 incident receipt；
ACTIVE 被 compromise 后允许的唯一恢复路径是上述 COMPROMISE_RECOVERY。RETIRED 与
COMPROMISED 吸收。任一函数失败都不得留下 Transition receipt 或部分 state change。

## 5. ACL、清理与必需 Oracle

四函数仅授 `data_agent_u6_provisioner` EXECUTE；Backend/Job/Public 无权，Provisioner
无底表 DML。两表普通 RLS 为 exact-S；App cleanup 时 Transition Operation 先于 Key
Version 在 rank 6 删除。Hosted/Docker 使用相同 metadata、hash、函数与 Oracle，但
外部 non-exportable keyring adapter 可以不同。

- 空数据库 BOOTSTRAP stage/activate 成功；有任一历史 Key 或 live dependency 时伪
  BOOTSTRAP 零写失败；
- 两连接并发 Stage 只有一个 STAGED；两个不同 Activate operation 只有一个 winner，
  stale successor 不能绑定新 ACTIVE；
- Rotation crash 在 old demote/new promote 任一点均整事务回滚，任何已提交观察都恰有
  一张 ACTIVE；
- 唯一 ACTIVE 不能被独立 restrict/retire；只有 replacement Activate 或带事故 receipt
  的 Compromise 可移除，后者可经 exact COMPROMISE_RECOVERY 恢复新写；
- response-loss replay 返回相同 state/result hash；同 operation 异 request 冲突；
- wrong predecessor kind/S/version/reference/state hash、两个 STAGED、跨 tenant、
  缺 challenge/incident/destruction receipt 全失败；
- Retire 在任一 CLAIMED/AVAILABLE/commitment dependency 存在时失败；两步完成后不可
  复活；COMPROMISED 永不 decrypt/verify fallback；
- Catalog、RLS、ACL、partial UQ、predecessor FK 与 operation receipt exact；本地
  metadata Oracle 不证明真实 KMS destroy、backup-window 清除或生产部署。

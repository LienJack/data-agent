# U6 Invocation Result 加密、终态准备与解密合同

> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED` ·
> `u6-invocation-result-crypto@1.0.0`
> 本文定义待实现边界，不证明密文存储、密钥轮换或密码擦除已经交付。

本文冻结三类 Result 正文、Terminal Preparation、密文 Command 与解密 Resolver；
Key metadata/部署状态机取 Result Key Lifecycle，其他 Wire/状态/锁序取对应分册，
reference candidate key/composite FK 取 Graph。

## 1. 明文 Candidate 与密文 Command 分离

明文只存在于 server 进程内。数据库的 `jsonb`、表、Operation、Audit、日志、错误、
Checkpoint 与 Redis 均不得接收 `body_base64url` 或 decoded bytes。

```ts
type CommitInvocationTerminalCandidateCommon = StrictCommandBase & {
  transition_id: ImmutableId; invocation_id: ImmutableId;
  outcome_usage_record_id: ImmutableId;
};
type CommitInvocationTerminalCandidateInput =
  | (CommitInvocationTerminalCandidateCommon & {
      resource_kind: "MODEL"; outcome: "COMPLETED";
      expected_state: "STARTED" | "OUTCOME_UNKNOWN";
      result_record_id: ImmutableId; body_base64url: ModelOutputBase64Url;
      actual: Extract<CompletedResourceUsage, { resource_kind: "MODEL" }>;
    })
  | (CommitInvocationTerminalCandidateCommon & {
      resource_kind: "SQL"; outcome: "COMPLETED";
      expected_state: "STARTED" | "OUTCOME_UNKNOWN";
      result_record_id: ImmutableId;
      secure_execution_receipt_record_id: ImmutableId;
      body_base64url: SqlOutputBase64Url;
      actual: Extract<CompletedResourceUsage, { resource_kind: "SQL" }>;
    })
  | (CommitInvocationTerminalCandidateCommon & {
      resource_kind: "TOOL"; outcome: "COMPLETED";
      expected_state: "STARTED" | "OUTCOME_UNKNOWN";
      result_record_id: ImmutableId; body_base64url: ToolOutputBase64Url;
      actual: Extract<CompletedResourceUsage, { resource_kind: "TOOL" }>;
    })
  | (CommitInvocationTerminalCandidateCommon & {
      resource_kind: "MODEL"; outcome: "FAILED";
      expected_state: "AUTHORIZED" | "STARTED" | "OUTCOME_UNKNOWN";
      actual: Extract<ResourceUsage, { resource_kind: "MODEL" }>;
      error_code: InvocationFailureCode<"MODEL">;
    })
  | (CommitInvocationTerminalCandidateCommon & {
      resource_kind: "SQL"; outcome: "FAILED";
      expected_state: "AUTHORIZED" | "STARTED" | "OUTCOME_UNKNOWN";
      actual: Extract<ResourceUsage, { resource_kind: "SQL" }>;
      error_code: InvocationFailureCode<"SQL">;
    })
  | (CommitInvocationTerminalCandidateCommon & {
      resource_kind: "TOOL"; outcome: "FAILED";
      expected_state: "AUTHORIZED" | "STARTED" | "OUTCOME_UNKNOWN";
      actual: Extract<ResourceUsage, { resource_kind: "TOOL" }>;
      error_code: InvocationFailureCode<"TOOL">;
    });

type ResultGovernanceBinding =
  | {
      resource_kind: "MODEL";
      projection_receipt_ref:
        ArtifactReferenceFor<"AgentDataProjectionReceipt">;
      model_profile: ModelProfileReference;
      data_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
      retention_policy_ref: RetentionPolicyReference;
      egress_policy_version: Version;
      dlp_scan: "PASS"; retention_check: "PASS"; deletion_due_at: Timestamp;
    }
  | {
      resource_kind: "SQL";
      secure_execution_receipt_record_id: ImmutableId;
      sql_artifact_ref: ArtifactReferenceFor<"SqlArtifact">;
      execution_permit_ref: ArtifactReferenceFor<"ExecutionPermit">;
      datasource_id: ImmutableId; data_snapshot_binding_hash: Sha256;
      data_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
      retention_policy_ref: RetentionPolicyReference;
      query_output_policy_version: Version;
      dlp_scan: "PASS"; retention_check: "PASS"; deletion_due_at: Timestamp;
    }
  | {
      resource_kind: "TOOL"; permit_ref: ToolInvocationPermitRef;
      policy_receipt_ref: ArtifactReferenceFor<"PolicyReceipt">;
      data_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
      retention_policy_ref: RetentionPolicyReference;
      tool_output_policy_version: Version;
      dlp_scan: "PASS"; retention_check: "PASS"; deletion_due_at: Timestamp;
    };
type ResultBlobAad = {
  protocol_version: "research-result-aad@1.0.0";
  scope: AppScope; run_id: ImmutableId; principal_id: PrincipalId;
  resource_kind: "MODEL" | "SQL" | "TOOL";
  result_record_id: ImmutableId; result_record_version: 1;
  blob_id: ImmutableId; invocation: InvocationBinding;
  canonical_request_digest: Sha256;
  output_binding:
    | StoredModelInvocationOutputBinding
    | StoredSqlInvocationOutputBinding
    | StoredToolInvocationOutputBinding;
  data_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  governance_binding_hash: Sha256;
  deletion_due_at: Timestamp; encryption_key_version: Version;
};
type EncryptedResultBlobBinding = {
  blob_id: ImmutableId; store: "research_invocation_result_blobs";
  encryption_protocol_version: "research-result-encryption@1.0.0";
  algorithm: "AES-256-GCM"; key_derivation: "HKDF-SHA256";
  ciphertext_hash: Sha256; aad_hash: Sha256;
  encryption_key_version: Version;
};
```

`CommitInvocationTerminalCandidateInput` 只供 server-only Adapter Port 使用，不能从包根、
Agent Tool Registry 或 RPC Schema 导出。`CommitInvocationTerminalDbCommand` 才是数据库
唯一接受的 Terminal Wire：

```ts
type CanonicalCiphertextBase64Url = string; // branded by strict schema
type ClaimTokenBase64Url = string; // branded by strict schema
type CanonicalEncryptedBytes = {
  ciphertext_base64url: CanonicalCiphertextBase64Url;
  nonce_base64url: string;      // decoded exact 12 bytes，encoded exact 16 chars
  auth_tag_base64url: string;   // decoded exact 16 bytes，encoded exact 22 chars
};
type CommitEncryptedInvocationTerminalCommand = StrictCommandBase & {
  command_kind: "ENCRYPTED_RESULT_TERMINAL";
  transition_id: ImmutableId; invocation_id: ImmutableId;
  outcome_usage_record_id: ImmutableId;
  resource_kind: "MODEL" | "SQL" | "TOOL"; outcome: "COMPLETED";
  preparation_id: ImmutableId; preparation_version: PositiveInt;
  claim_token_base64url: ClaimTokenBase64Url;
  result_blob_aad: ResultBlobAad;
  encrypted_blob: EncryptedResultBlobBinding & CanonicalEncryptedBytes;
};
type CommitFailedInvocationTerminalCommand =
  Extract<CommitInvocationTerminalCandidateInput, { outcome: "FAILED" }> & {
    command_kind: "FAILED_TERMINAL";
  };
type CommitInvocationTerminalDbCommand =
  | CommitEncryptedInvocationTerminalCommand
  | CommitFailedInvocationTerminalCommand;

type CommittedInvocationTerminalDbCommon = InvocationBinding & {
  canonical_request_digest: Sha256; committed_at: Timestamp;
  outcome_hash: Sha256; outcome_usage_ref: InvocationOutcomeUsageRef;
};
type CommittedInvocationTerminalDbResult =
  | (CommittedInvocationTerminalDbCommon & {
      resource_kind: "MODEL"; adapter_method: "MODEL_PROVIDER";
      state: "COMPLETED";
      result_ref: ModelInvocationResultRef;
      output_binding: StoredModelInvocationOutputBinding;
      usage: Extract<CompletedResourceUsage, { resource_kind: "MODEL" }>;
    })
  | (CommittedInvocationTerminalDbCommon & {
      resource_kind: "SQL"; adapter_method: "SQL_EXECUTOR";
      state: "COMPLETED";
      result_ref: SqlInvocationResultRef;
      secure_execution_receipt_ref: SecureSqlExecutionReceiptRef;
      output_binding: StoredSqlInvocationOutputBinding;
      usage: Extract<CompletedResourceUsage, { resource_kind: "SQL" }>;
    })
  | (CommittedInvocationTerminalDbCommon & {
      resource_kind: "TOOL"; adapter_method: "TOOL_ADAPTER";
      state: "COMPLETED";
      result_ref: ToolInvocationResultRef;
      output_binding: StoredToolInvocationOutputBinding;
      usage: Extract<CompletedResourceUsage, { resource_kind: "TOOL" }>;
    })
  | (CommittedInvocationTerminalDbCommon & {
      resource_kind: "MODEL"; adapter_method: "MODEL_PROVIDER";
      state: "FAILED"; result_ref: null; output_binding: null;
      error_code: InvocationFailureCode<"MODEL">;
      usage: Extract<ResourceUsage, { resource_kind: "MODEL" }>;
    })
  | (CommittedInvocationTerminalDbCommon & {
      resource_kind: "SQL"; adapter_method: "SQL_EXECUTOR";
      state: "FAILED"; result_ref: null;
      secure_execution_receipt_ref: null; output_binding: null;
      error_code: InvocationFailureCode<"SQL">;
      usage: Extract<ResourceUsage, { resource_kind: "SQL" }>;
    })
  | (CommittedInvocationTerminalDbCommon & {
      resource_kind: "TOOL"; adapter_method: "TOOL_ADAPTER";
      state: "FAILED"; result_ref: null; output_binding: null;
      error_code: InvocationFailureCode<"TOOL">;
      usage: Extract<ResourceUsage, { resource_kind: "TOOL" }>;
    });
```

四个 Base64Url 字段须用 RFC 4648 URL alphabet、无 `=` 且 re-encode 相等。decode 前
MODEL/TOOL `max_chars=1_398_102`、decoded `1..1_048_576` bytes，SQL
`max_chars=11_184_811`、decoded `1..8_388_608` bytes；nonce/tag/token 分别
`12/16/32` bytes、encoded `16/22/43` chars。ciphertext 不含 tag，decoded 长度等于
`output_binding.byte_length`；DB 重算 ciphertext/AAD hash。FAILED 夹带 preparation、
AAD/密文/nonce/tag/Blob 失败；AAD kind 必须匹配 Stored Output 与 Governance。

## 2. 跨实例 Terminal Preparation

MODEL/SQL/TOOL COMPLETED 的固定流程是：

```text
strict parse Candidate
→ decode/re-encode，重算 byte_length 与 Result digest
→ DLP/分类/Retention Policy 检查
→ prepare_invocation_terminal（无明文）
→ 仅 claim winner 派生 key、生成随机 nonce 并加密
→ commit_invocation_terminal（仅密文 Command）
→ server-only ciphertext Resolver + 进程内解密
```

准备请求只携带 Candidate 的非正文语义与治理结论：

```ts
type PrepareInvocationTerminalFacts =
  | (Omit<
      Extract<CommitInvocationTerminalCandidateInput,
        { resource_kind: "SQL"; outcome: "COMPLETED" }>,
      "body_base64url"
    > & {
      output_binding: StoredSqlInvocationOutputBinding;
      data_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
      retention_policy_ref: RetentionPolicyReference;
    })
  | (Omit<
      Extract<CommitInvocationTerminalCandidateInput,
        { resource_kind: "MODEL"; outcome: "COMPLETED" }>,
      "body_base64url"
    > & {
      output_binding: StoredModelInvocationOutputBinding;
      data_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
      retention_policy_ref: RetentionPolicyReference;
    })
  | (Omit<
      Extract<CommitInvocationTerminalCandidateInput,
        { resource_kind: "TOOL"; outcome: "COMPLETED" }>,
      "body_base64url"
    > & {
      output_binding: StoredToolInvocationOutputBinding;
      data_classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
      retention_policy_ref: RetentionPolicyReference;
    });
type ResultGovernanceBindingBeforeDeletion<T> =
  T extends ResultGovernanceBinding ? Omit<T, "deletion_due_at"> : never;
type TerminalInputCommitmentCommon = InvocationBinding & {
  protocol_version: "research-terminal-input@1.0.0";
  schema_version: "1.0.0"; scope: AppScope; run_id: ImmutableId;
  principal_id: PrincipalId; idempotency_key: IdempotencyKey;
  transition_id: ImmutableId; invocation_id: ImmutableId;
  outcome_usage_record_id: ImmutableId;
  outcome: "COMPLETED"; expected_state: "STARTED" | "OUTCOME_UNKNOWN";
  result_record_id: ImmutableId;
  canonical_request_digest: Sha256;
};
type TerminalInputCommitmentPayload =
  | (TerminalInputCommitmentCommon & {
      resource_kind: "MODEL";
      output_binding: ModelInvocationOutputBinding;
      actual: Extract<CompletedResourceUsage, { resource_kind: "MODEL" }>;
      governance_binding: ResultGovernanceBindingBeforeDeletion<
        Extract<ResultGovernanceBinding, { resource_kind: "MODEL" }>
      >;
    })
  | (TerminalInputCommitmentCommon & {
      resource_kind: "SQL";
      secure_execution_receipt_record_id: ImmutableId;
      output_binding: SqlInvocationOutputBinding;
      actual: Extract<CompletedResourceUsage, { resource_kind: "SQL" }>;
      governance_binding: ResultGovernanceBindingBeforeDeletion<
        Extract<ResultGovernanceBinding, { resource_kind: "SQL" }>
      >;
    })
  | (TerminalInputCommitmentCommon & {
      resource_kind: "TOOL";
      output_binding: ToolInvocationOutputBinding;
      actual: Extract<CompletedResourceUsage, { resource_kind: "TOOL" }>;
      governance_binding: ResultGovernanceBindingBeforeDeletion<
        Extract<ResultGovernanceBinding, { resource_kind: "TOOL" }>
      >;
    });
type StoredCommitmentOutput<O> =
  O extends ModelInvocationOutputBinding ? StoredModelInvocationOutputBinding :
  O extends SqlInvocationOutputBinding ? StoredSqlInvocationOutputBinding :
  O extends ToolInvocationOutputBinding ? StoredToolInvocationOutputBinding : never;
type StoredTerminalInputCommitmentFacts<T = TerminalInputCommitmentPayload> =
  T extends { output_binding: infer O }
    ? Omit<T, "output_binding"> & {
        output_binding: StoredCommitmentOutput<O>;
      }
    : never;
type PrepareInvocationTerminalInput =
  PrepareInvocationTerminalFacts & {
    terminal_input_commitment: HmacSha256;
    commitment_key_version: Version;
  };
type PreparedInvocationTerminal = {
  preparation_id: ImmutableId; preparation_version: PositiveInt;
  claim_token_base64url: ClaimTokenBase64Url; claim_expires_at: Timestamp;
  terminal_input_commitment: HmacSha256;
  commitment_key_version: Version;
  commitment_facts: StoredTerminalInputCommitmentFacts;
  result_blob_aad: ResultBlobAad;
  encrypted_blob_seed: Omit<
    EncryptedResultBlobBinding, "ciphertext_hash" | "aad_hash"
  >;
};
type PrepareInvocationTerminalResult =
  | { outcome: "CLAIMED"; preparation: PreparedInvocationTerminal }
  | {
      outcome: "TERMINAL_REPLAY";
      committed: Extract<CommittedInvocationTerminalDbResult,
        { state: "COMPLETED" }>;
    };
```

TERMINAL_REPLAY 的 `resource_kind` 必须与 Prepare input 相同。

`prepare_invocation_terminal` 在锁内从 Invocation/Start 及 matching Model、SQL 或 Tool
Authority rows 重建绑定并读取 exact Retention duration；DB 生成并冻结
`deletion_due_at/blob_id/encryption_key_version/ResultBlobAad`，调用方不得提交。
`governance_binding_hash` 固定为：

```text
sha256(
  UTF8("research-result-governance@1.0.0\0")
  || UTF8(JCS(ResultGovernanceBinding))
)
```

DB 从 locked facts、Retention 与 matching Kind Authority 重算，AAD 必须匹配。
Platform 入库前用 server-only 独立 commitment key 对
`UTF8("research-terminal-input@1.0.0\0") ||
UTF8(JCS(TerminalInputCommitmentPayload))` 计算 HMAC-SHA256；判别联合逐字段组装，
不得省略 null 或含 token/nonce/ciphertext/tag。Candidate 禁止 commitment/裸 Digest；
Adapter 只注入 digestless Stored Binding、HMAC/version。DB 不持 key、不验首写 HMAC，
只在 matching Kind Authority 下保存 opaque value，后续 constant-time 比较。
`commitment_key_version` 必须匹配数据库 locked ACTIVE commitment metadata；rotation
竞态返回可重试冲突，不能降级成未加钥 hash。Port 单元测试和 Hosted/Docker 向量负责
证明同 Candidate 得到同 HMAC、公共调用方不能覆盖该字段。

`research_invocation_terminal_preparations` 的表/PK/nullable CHECK 取 Execution
Storage §2/§4，reference candidate UQ/FK 取 Terminal Reference Graph §1/§4；该行保存 exact
`terminal_input_commitment`/key version、冻结 AAD/Blob Seed、
`CLAIMED|COMMITTED|TOMBSTONED|ABORTED`、claim token hash、
preparation version、claim expiry 与 DB time；绝不保存 token 原文。`preparation_id` 等于
command `transition_id`，物理 `terminal_transition_id=command.transition_id`。四态
nullable CHECK 与锁序只取 Execution Storage §4/§5；Transition pointer 是由状态 CHECK
守卫的 nullable immediate `MATCH SIMPLE` FK。每次 claim 固定 30 秒，使用数据库时钟：

- 已有 exact Terminal：返回持久 Result/Usage，不创建 claim；
- 已有 ABORTED：INITIAL stage 不复活，当前 OUTCOME_UNKNOWN 仅可使用唯一 LATE stage；
  LATE stage 固定 `RESEARCH_INVOCATION_LATE_TERMINAL_CLOSED`；
- 无 Terminal、无 claim：生成 32-byte 随机 token，仅保存其 SHA-256，返回
  `PreparedInvocationTerminal`；
- matching active claim：其他实例返回可重试
  `RESEARCH_RESULT_TERMINAL_PREPARATION_BUSY`，不能取得 token 或加密；
- matching expired claim：仅持有同一 live Candidate 并重算 exact HMAC 的调用可在
  冻结 AAD 上递增 `preparation_version`、换发 token；
- 同键异 `terminal_input_commitment`：`RESEARCH_INVOCATION_TERMINAL_CONFLICT`。

判定优先级固定为 exact Terminal → ABORTED stage closure → CLAIMED commitment/expiry；
ABORTED 已清 HMAC，不得退回“异 commitment”分支。

仅一个未过期 claimant；重放不派生 key。仍持 Candidate 才可在 expiry 后 takeover；
丢失 plaintext 后不得重调外部 I/O，只能按
Execution Storage §4/§5 调用专用 abort RPC：INITIAL 原子
`ABORTED + STARTED→OUTCOME_UNKNOWN`，LATE 原子 `ABORTED` 且保持
OUTCOME_UNKNOWN。旧 token/version 必败。INITIAL abort 后的
权威结果只能走唯一 `TERMINAL_LATE`；LATE abort 后 U6 v1 永久关闭 Terminal path，
保持不可发布。
DB 不出现未提交 Blob/Result/Usage。token 不进日志/Error/Trace，hash 不返回。
`claim_token_hash` 固定为
`sha256(UTF8("u6-terminal-claim@1.0.0\0") || base64url_decode(token))`，数据库以
constant-time byte compare 校验；禁止 hash encoded text。RPC Adapter、SQL logging、
APM 与错误序列化先删 token/密文字段；canary 扫应用日志、PG log/Audit 与 Trace。

## 3. 唯一锁序、写序与幂等

Preparation、COMPLETED/FAILED Terminal 与 Tombstone 的逐行锁 profile 唯一取
Execution Storage §5；COMPLETED 的 Key Version 固定 ENCRYPTION → COMMITMENT。
四类物理写序只取 Execution Storage §3；reciprocal FK 与 System Identity mapping
只取 Terminal Reference Graph §5/§6。

`commit_invocation_terminal` 验证 active claim token hash、preparation version、未过期、
frozen AAD/Seed、Output Binding 与全部 locked facts。随机密文字段不进入
`terminal_input_commitment`；同一 active claim 只允许一次成功提交。事务失败全部回滚。
SQL COMPLETED 同事务创建 digestless Secure SQL Execution Receipt；FAILED 不创建
Preparation、Result、Receipt 或 Blob。
`prepare_invocation_terminal` 返回 `PrepareInvocationTerminalResult`；
`commit_invocation_terminal` 返回 `CommittedInvocationTerminalDbResult`，二者都没有
正文或 ciphertext。COMPLETED Prepare replay
先在锁内重验 Result/Blob 仍为 AVAILABLE 且 DB time `< deletion_due_at`；否则返回
`REPLAY_SNAPSHOT_UNAVAILABLE`。server-only 外层 Port 必须使用 Result Decryption
Authority 读取密文、在进程内验密并组装含 `output` 的 `CommittedInvocation`，不得用
本次 Candidate 的明文回填 replay，也不得把 DB Result 伪装成已解密结果。FAILED replay
只有 terminal operation/OutcomeUsage metadata，无 Result/Blob 或解密路径。

## 4. 密码协议与固定向量

明文是 `base64url_decode(body_base64url)`。算法固定 AES-256-GCM，nonce 随机 12 bytes，
auth tag 16 bytes，ciphertext 不拼接 tag。32-byte data key 固定为：

```text
salt = UTF8(
  "data-agent-u6-result\0" + app_id + "\0" + tenant_id + "\0"
  + environment + "\0" + encryption_key_version
)
info = UTF8("u6-invocation-result@1.0.0\0" + blob_id)
data_key = HKDF-SHA256(master_key, salt, info, 32)
AAD = UTF8(JCS(ResultBlobAad))
```

master/data key 永不持久化、日志化或进入 Error。Hosted 与 Docker 必须通过相同向量：
`blob_id` 进入 HKDF info，使每个 Blob 使用独立 data key；nonce 仍必须由 CSPRNG 生成，
不能以 ID、时间或计数器替代。

```json
{
  "master_key_hex": "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  "commitment_key_hex": "f0e0d0c0b0a09080706050403020100000112233445566778899aabbccddeeff",
  "commitment_key_version": "test-commit-v1",
  "plaintext_utf8": "{\"answer\":42}",
  "app_id": "11111111-1111-4111-8111-111111111111",
  "tenant_id": "22222222-2222-4222-8222-222222222222",
  "environment": "test",
  "run_id": "33333333-3333-4333-8333-333333333333",
  "principal_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "idempotency_key": "u6-vector-terminal-1",
  "transition_id": "12121212-1212-4212-8212-121212121212",
  "outcome_usage_record_id": "13131313-1313-4313-8313-131313131313",
  "expected_state": "STARTED",
  "resource_kind": "MODEL",
  "outcome": "COMPLETED",
  "invocation_id": "44444444-4444-4444-8444-444444444444",
  "result_record_id": "55555555-5555-4555-8555-555555555555",
  "result_record_version": 1,
  "blob_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "reservation_id": "66666666-6666-4666-8666-666666666666",
  "reservation_seq": 1,
  "resource_lease_id": "77777777-7777-4777-8777-777777777777",
  "request_id": "88888888-8888-4888-8888-888888888888",
  "attempt_id": "99999999-9999-4999-8999-999999999999",
  "worker_fence": 7,
  "canonical_request_digest": "sha256:bb53d6f12529f4e733c1693f999b0ebbf765e5cef35e90049c5bc6b31aedd190",
  "output_protocol_version": "model-result@1.0.0",
  "output_media_type": "application/json; charset=utf-8",
  "output_byte_length": 13,
  "output_digest": "sha256:1fd3845655eb1d1b16955a2c1df71a0d50a242b5cfd604e45a3c175861b09594",
  "actual_invocations": 1,
  "actual_input_tokens": 17,
  "actual_output_tokens": 5,
  "actual_cost_microusd": 23,
  "data_classification": "INTERNAL",
  "projection_artifact_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "projection_revision": 1,
  "projection_content_hash": "sha256:1b250ea199bec73d392caad39d1167d6edc43c81f20edead86eea52c52b94fc1",
  "model_provider": "openai",
  "model_profile_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "model_profile_version": "v1",
  "model_id": "gpt-test",
  "model_profile_hash": "sha256:1900eab6c028483d7126599ee6f50de0d27907b5c65fa90524580b4b0f9852b0",
  "certification_artifact_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  "certification_revision": 1,
  "certification_content_hash": "sha256:b00a6c108553e242e3d69c510fcff6382f875613a5feac011254132fb1460a04",
  "retention_policy_id": "retention-test",
  "retention_policy_version": "v1",
  "retention_policy_hash": "sha256:8e220124401da6e1a0288a86b48eb316d254cd2a9b9399cfc9a07a2fbc0253e8",
  "egress_policy_version": "egress-v1",
  "dlp_scan": "PASS",
  "retention_check": "PASS",
  "governance_binding_hash": "sha256:cc5fb04b1394169329f53f77a8db62610bea5d9fcd9381a2971524942c6ca0a7",
  "deletion_due_at": "2030-01-01T00:00:00.000Z",
  "encryption_key_version": "test-key-v1",
  "nonce_base64url": "AAECAwQFBgcICQoL"
}
```

Projection/Certification Ref kind 固定为
`AgentDataProjectionReceipt/ModelCertificationReceipt` 并复用完整 `S/run_id`。
Commitment Payload 固定 protocol/schema，顶层展开 Invocation Binding，Model actual 与
不含 deletion time 的 Governance 必须 exact。按三份结构组装 flat vector 后应得到：

```text
output_digest =
  sha256:1fd3845655eb1d1b16955a2c1df71a0d50a242b5cfd604e45a3c175861b09594
request_digest =
  sha256:bb53d6f12529f4e733c1693f999b0ebbf765e5cef35e90049c5bc6b31aedd190
terminal_input_commitment =
  hmac-sha256:3810919b98ffd89c1a48b19f12838c73a3ddff9dbb65891fea670fe445210219
derived_key_hex =
  8a52ddc411b1e2e8045608469aac75bb25d29000746a600b332427274d6894ff
aad_hash =
  sha256:cbb0584e36d1139bc92a4133a9bd5de024c65e2656aaf56c2b9ff06a4fbd304c
ciphertext_base64url = 1nlerywZHxPke84x_g
ciphertext_hash =
  sha256:ca1c79dd0965f1ff14a48bc20a60285ae889a6160e98044aeeb91d76cd57140b
auth_tag_base64url = xituC6oF6uQd9L47-0zPGg
```

实施必须把该完整输入固化为仓库脚本和单元测试；仅文档中出现向量不构成交付证据。

## 5. Resolver、解密 Authority 与旧 Key Version

```ts
type ResolveInvocationResultCiphertextInput = StrictCommandBase & {
  result_ref:
    | ModelInvocationResultRef
    | SqlInvocationResultRef
    | ToolInvocationResultRef;
  access_reason: "INVOCATION_RETURN" | "IDEMPOTENT_REPLAY" |
    "AUTHORIZED_ANALYSIS";
};
type EncryptedInvocationResultEnvelope = {
  result_ref:
    | ModelInvocationResultRef
    | SqlInvocationResultRef
    | ToolInvocationResultRef;
  preparation_id: ImmutableId;
  terminal_input_commitment: HmacSha256;
  commitment_key_version: Version;
  commitment_facts: StoredTerminalInputCommitmentFacts;
  result_blob_aad: ResultBlobAad;
  encrypted_blob: EncryptedResultBlobBinding & CanonicalEncryptedBytes;
};
```

记录 `owner_kind=MODEL_ADAPTER_AUTHORITY|SQL_ADAPTER_AUTHORITY|
TOOL_ADAPTER_AUTHORITY` 只描述 Result 的事实
签发者，不等于读取能力。方法级解密唯一使用 `RESULT_DECRYPTION_AUTHORITY`：

1. 普通 `resolve_committed_*_invocation_result` 只返回 Ref、Stored Output Binding、
   治理与 Blob Hash metadata；Secure SQL Receipt 只返回 schema/count/execution
   metadata，均不返回 rows 或密文；
2. server-only `resolve_invocation_result_ciphertext(envelope_json jsonb)` 在事务内解析 exact
   `RESULT_DECRYPTION_AUTHORITY`、Scope/Principal/Result Ref、AVAILABLE、DB time <
   `deletion_due_at` 后，返回 strict encrypted envelope；
3. Platform Decryptor 从 versioned keyring 选择 exact `encryption_key_version`，重算
   AAD/hash 并验证 GCM tag；解密后重算 Output digest/length，把 envelope 的 stored
   commitment facts 补成 `TerminalInputCommitmentPayload`，以 exact
   `commitment_key_version` 重算 HMAC 并 constant-time 比较，最后才返回
   `ModelInvocationOutput|SqlInvocationOutput|ToolInvocationOutput`；
4. `RESULT_RETENTION_AUTHORITY` 与 `RESULT_ERASURE_AUTHORITY` 只有各自 Tombstone 权限，
   App Lifecycle Job 只有 environment cleanup 权限；三者都不能调用 ciphertext
   Resolver。Browser、Agent Tool、公共 package root 与 Redis 永远不可见 envelope 或
   keyring。

authority 解析后的成功/拒绝/限流均 append Execution Storage §2 Access Audit，锁取
§5；Audit 可含非秘密 key kind/version，但不含 token、AAD、ciphertext、nonce、tag、
key material 或 KMS reference。
`ALLOWED` 只允许 `RESULT_RESOLVED+denial_code=null`；其他 outcome 必须有 denial code，
且未解析字段整组为 null。每 `(S,principal_id)` 最多 `60 attempts/minute` 且
`20 distinct attempted_result_identity_hash/minute`；超限返回
`RESEARCH_RESULT_ACCESS_RATE_LIMITED` 并触发按 capability/result/key-version 聚合的
告警。authority 解析前不写 U6 行，Adapter 仅可 best-effort 发 identifier-free
`u6_auth_rejection_total{stage,code}` 聚合指标，且不算 durable Audit；其后失败用 PL/pgSQL subtransaction
保留，未知 SQL 异常整事务回滚。跨 S、过期、TOMBSTONED、错误 capability 与枚举须有 Oracle。
Audit retention/purge/legal hold 与 Hosted/Docker backup evidence 只取 Execution
Storage §2；缺证据保持 `HOLD / RELEASE_EVIDENCE_INCOMPLETE`。

Keyring 与数据库只共享不可逆 version metadata，不共享 secret：

```ts
interface ResultKeyring {
  encryptKey(scope: AppScope, version: Version): Promise<NonExportableKeyHandle>;
  decryptKey(scope: AppScope, version: Version): Promise<NonExportableKeyHandle>;
  signCommitment(scope: AppScope, version: Version,
    payload: TerminalInputCommitmentPayload): Promise<HmacSha256>;
  verifyCommitment(scope: AppScope, version: Version,
    payload: TerminalInputCommitmentPayload,
    expected: HmacSha256): Promise<boolean>;
}
```

Key、Blob、Preparation 的 candidate key、物理 kind 与 composite FK 只取 Terminal
Reference Graph。数据库绝不存 secret、KMS URI、明文 alias 或可导出 key。Hosted 使用按 `S` 隔离的外部
KMS/Secret-Store non-exportable handle；Docker 使用同一 Port 的 mounted secret/keyring
sidecar，production 禁止把 raw key 放进镜像、Supabase、Upstash、浏览器或普通环境转储。
每次 key handle 取得、HMAC sign/verify 与 decrypt 都写不含 key/result bytes 的安全审计。

Key metadata 的 exact state/time matrix、predecessor FK、BOOTSTRAP/ROTATION/
COMPROMISE_RECOVERY、append-only Transition Operation、部署函数与 crash/replay 只取
`u6-result-key-lifecycle-contract.md`。尤其不存在单独 restrict 唯一 ACTIVE 的入口；
正常降级必须与 successor activate 同事务，COMPROMISED 恢复也不能让旧 Result
fallback 到其他 key。本文只消费已由该合同授权的 ACTIVE/历史 restricted key。

Key 缺失报 `RESEARCH_RESULT_DECRYPTION_KEY_UNAVAILABLE`，
tag/AAD/ciphertext/digest/commitment 不一致报
`RESEARCH_RESULT_INTEGRITY_FAILURE`，过期或 TOMBSTONED 报
`REPLAY_SNAPSHOT_UNAVAILABLE`；三者都不降级为空正文或重新调用外部系统。

L2 Retention/Subject-Erasure Tombstone 清 live ciphertext/nonce/tag/HMAC/AAD/seed 并
令 Resolver 不可用；App cleanup 在删除完整 Terminal aggregate 前使用同一敏感字段
inventory，但只生成 lifecycle component receipt，不冒充 per-result erasure receipt。
MVCC/WAL/PITR/backup 上限
取部署 Retention Profile。若要求 per-result irreversible erasure，Release GO 保持
HOLD，直到交付独立 external key、KMS destruction receipt 与 backup-window Oracle；
shared master + row NULL 不构成该能力。

## 6. 必需 Oracle

- strict Candidate 与 DB Command 双向证明：DB command 永无 plaintext，SQL/FAILED
  夹带密码字段失败；
- 双 PG 连接证明只有一个 active claim winner，loser 零派生/加密；Terminal 提交后
  重放零派生/加密；只有仍持 live Candidate 的 expired takeover 可重加密且只提交一份；
- commit 前进程崩溃无孤儿：INITIAL abort 原子进入 OUTCOME_UNKNOWN，LATE abort
  保持 OUTCOME_UNKNOWN 并永久关闭 U6 v1 Terminal path，均零外部重调；
- nonce/tag/AAD/ciphertext/hash/key version/Scope/Result/Invocation 任一篡改失败；
- metadata Resolver、ciphertext Resolver、Retention、Subject Erasure、App Cleanup 与
  Decryption 权限不可互换；
- 到期但 Job 未执行、TOMBSTONED、旧 key 缺失均失败关闭且零 Provider/Tool I/O；
- rotation 在 scope advisory 下先 demote old、再 promote new；CLAIMED 阻断，且无
  `23505`、restricted-key 新签名/加密或部分 ACTIVE 状态；
- PostgreSQL、Audit、日志、Error、Checkpoint、Redis 对 sentinel 明文和
  `body_base64url` 检索为空；
- Hosted/Docker 使用同一机器向量、同一 keyring 接口与同一 Oracle。

# DataFoundry CoA Capability Ledger

本账本是 U1 的静态架构映射，不代表运行时完成度。机器权威位于
`PLATFORM_CAPABILITY_MANIFEST`；其 58 个条目同时固定 Owner、Authority、`PLANNED` 定义状态和
DAG 依赖。Manifest 解析器逐字段绑定完整冻结快照；`DELIVERED` 等运行状态不得写回定义，必须
通过后续单元提交真实 Receipt 后才可形成可运行 Projection，不能由本文档推断。

Evidence Kinds 只描述技术执行、权威、Artifact、审计和确定性验收证据。Provider 调用、Usage
Receipt、Context Capacity 与 Execution Recovery 均与任何商业语义解耦；Usage Receipt 只记录模型
调用用量与审计事实，不含金额、价格、结算或计费语义。

| Capability | Primary U-ID | Evidence Kinds |
| --- | --- | --- |
| M01 | U2 | AUTHORITY_RECEIPT |
| M02 | U3 | PROVIDER_INVOCATION,USAGE_RECEIPT |
| M03 | U6 | AUDIT_EVENT |
| M04 | U7 | ARTIFACT_PROOF |
| M05 | U9 | AUDIT_EVENT |
| M06 | U8 | EXECUTION_RECOVERY |
| M07 | U8 | EXECUTION_RECOVERY |
| M08 | U8 | AUTHORITY_RECEIPT |
| M09 | U8 | EXECUTION_RECOVERY |
| M10 | U9 | ARTIFACT_PROOF |
| M11 | U15 | ARTIFACT_PROOF |
| M12 | U14 | AUDIT_EVENT |
| M13 | U14 | AUTHORITY_RECEIPT |
| M14 | U16 | AUTHORITY_RECEIPT |
| M15 | U16 | AUDIT_EVENT |
| M16 | U10 | EXECUTION_RECOVERY |
| M17 | U10 | AUTHORITY_RECEIPT |
| M18 | U17 | ARTIFACT_PROOF |
| S01 | U4 | AUTHORITY_RECEIPT |
| S02 | U4 | AUTHORITY_RECEIPT |
| S03 | U4 | ARTIFACT_PROOF |
| S04 | U4 | ARTIFACT_PROOF |
| S05 | U4 | ARTIFACT_PROOF |
| S06 | U4 | ARTIFACT_PROOF |
| S07 | U4 | ARTIFACT_PROOF |
| S08 | U4 | AUTHORITY_RECEIPT |
| S09 | U4 | ARTIFACT_PROOF |
| S10 | U4 | ARTIFACT_PROOF |
| S11 | U4 | ARTIFACT_PROOF |
| S12 | U5 | AUTHORITY_RECEIPT |
| A01 | U11 | ARTIFACT_PROOF |
| A02 | U11 | ARTIFACT_PROOF |
| A03 | U11 | ARTIFACT_PROOF |
| A04 | U11 | AUTHORITY_RECEIPT |
| A05 | U5 | AUTHORITY_RECEIPT |
| A06 | U5 | DETERMINISTIC_ORACLE |
| A07 | U11 | ARTIFACT_PROOF |
| A08 | U11 | ARTIFACT_PROOF |
| A09 | U11 | ARTIFACT_PROOF |
| A10 | U5 | ARTIFACT_PROOF |
| R01 | U12 | CONTEXT_CAPACITY |
| R02 | U12 | AUTHORITY_RECEIPT |
| R03 | U13 | ARTIFACT_PROOF |
| R04 | U13 | EXECUTION_RECOVERY |
| R05 | U12 | AUTHORITY_RECEIPT |
| R06 | U13 | DETERMINISTIC_ORACLE |
| R07 | U9 | AUDIT_EVENT |
| R08 | U14 | AUDIT_EVENT |
| R09 | U12 | CONTEXT_CAPACITY |
| R10 | U18 | DETERMINISTIC_ORACLE |
| T01 | U20 | AUTHORITY_RECEIPT |
| T02 | U20 | ARTIFACT_PROOF |
| T03 | U20 | AUTHORITY_RECEIPT |
| T04 | U20 | ARTIFACT_PROOF |
| T05 | U19 | EXECUTION_RECOVERY |
| T06 | U19 | CONTEXT_CAPACITY |
| T07 | U20 | AUDIT_EVENT |
| T08 | U18 | EXECUTION_RECOVERY |

## U1 boundaries

- Bootstrap 只接受两个专属 Greenfield scope，且首发前必须同时满足
  `active_release=null` 与 `generation=0`，所有既有 Run/File/Payload 计数为零。
- U1 对这些 workspace empty 字段只生成 content-addressed Candidate，不赋予 Authority；U5 必须在
  PostgreSQL 激活事务中重新核验真实 workspace 状态，序列化 Candidate 不能替代该核验。
- Semantic Coverage Floor 固定为 in-scope relation、PK、FK 和 supported queryable column
  全覆盖；每个 FK 必须绑定 Join Edge 与 Evidence。
- Coverage assessment 内嵌的 effective adapter 只是显式 `CANDIDATE` descriptor，不是 Adapter
  Registry Authority；后续单元必须将其绑定受信 Registry/Receipt 后才能参与发布判定。
- Falcon Bootstrap Corpus、Public Case 和 Sealed Oracle 是三个 strict、互斥边界；Semantic
  Generation 只能接收 Bootstrap Corpus。
- Signer Registry 仅登记 canonical Ed25519 主素数阶子群 public verification point，并要求
  Workspace Admin 与 Platform Attestor 使用不同 key-id。Schema 不证明私钥持有权；U5 激活前必须
  通过 challenge-response proof-of-possession，登记 public key 本身不能获得签名 Authority。
- API、UI、Tool 与 Worker 共享同一个 Route Authorization Matrix，不能以调用通道放宽 Scope、
  Ownership、Version、Idempotency 或 TaskCapability 检查。

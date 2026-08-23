# U6 ObligationExecutionDecision v2 闭包合同

> 状态：`FROZEN_DESIGN_CONTRACT`
> 上位合同：`docs/design/u6-research-authority-contract.md`
> 下游合同：`docs/design/u6-research-wire-payload-contract.md`
> 实现状态：纯 Research Kernel 为 `KERNEL_CANDIDATE_ONLY`；生产 Authority 为
> `NOT_IMPLEMENTED`

本文单独冻结 OED v2 的 strict Payload、exact derivation replay、SqlArtifact 绑定与
受控 assurance 边界，避免主 Wire 合同超过 Trellis 32 KiB 注入上限。

```ts
type ObligationSemanticCheck =
  | "metric"
  | "metric_formula"
  | "time_window"
  | "timezone"
  | "grain"
  | "dimensions"
  | "grouping"
  | "joins"
  | "canonical_predicates"
  | "cohort"
  | "null_semantics"
  | "authorization_scope";

type ObligationExecutionDecisionPayload = {
  artifact_type: "ObligationExecutionDecision";
  protocol_version: "obligation-execution@2.0.0";
  brief_ref: ResearchBriefRef;
  obligation_ref: ProofObligationRef;
  query_contract_ref: QueryContractRef;
  sql_artifact_ref: SqlArtifactRef;
  semantic_release_ref: SemanticReleaseRef;
  policy_receipt_ref: PolicyReceiptRef;
  observation_contract_hash: Sha256;
  verdict: "PASS" | "FAIL";
  checks: Record<ObligationSemanticCheck, "MATCH" | "MISMATCH">;
  reason_codes: U6ResearchReasonCode[]; // 0..32，唯一
  evaluator_version: Version;
  decision_semantic_hash: Sha256;
};
```

## 1. Exact closure 与 Semantic Hash

1. OED 必须解析 exact ResearchBrief、EvidencePlan/ProofObligation、QueryContract、
   **SqlArtifact**、SemanticRelease 和 PolicyReceipt。
2. `sql_artifact_ref` 必须进入 Payload Reference Closure、Envelope `input_refs` 与
   `decision_semantic_hash`；所有引用必须与 Envelope 同 Scope/Run。
3. 12 个检查键必须完整且无额外键。`PASS` 要求全部 `MATCH` 且 Reason Code 为空；
   任一 `MISMATCH` 固定为
   `FAIL/OBLIGATION_QUERY_SEMANTICS_MISMATCH`。
4. `observation_contract_hash` 必须等于 exact Obligation 内重算值。OED Semantic Hash
   覆盖完整检查输入、Evaluator Version、Verdict 与 Reason Code；Envelope Hash 仍由
   Artifact Authority 独立重算。
5. SQL alias、注释、字符串、同 Scope Reference、调用方 boolean、raw PASS Gate 或
   self-sealed Permit 都不能证明 `metric_formula` 或 `authorization_scope`。

## 2. QueryEvidence 消费规则

QueryEvidence 不接受 raw/self-sealed OED。唯一输入形态为：

```ts
type ObligationExecutionDecisionDocumentResolution = {
  document: ObligationExecutionDecisionDocument;
  derivation_input: BuildObligationExecutionDecisionCandidateInput;
};
```

消费者必须重新执行 production OED builder，对重算 Payload 与 Document Payload 做
canonical exact compare，再验证：

1. OED 为 `PASS`；
2. OED 的 Brief、Obligation、QueryContract、SqlArtifact、SemanticRelease、
   PolicyReceipt 与当前 QueryEvidence closure 逐字相等；
3. OED `sql_artifact_ref`、ExecutionReceipt、ValidationReceipt、Sandbox Receipt 与
   SandboxResult 全部绑定同一个 exact SqlArtifact；
4. 一个 Query 同时服务多个 Obligation 时，必须基于同一 Execution 分别提交一张 OED
   和一张 QueryEvidence；S1 的 PASS 不能为 S2 背书；
5. 依赖 Obligation 的每条已满足入边都必须有 exact dependency QueryEvidence；无依赖
   时数组必须为空。

任一 replay、Reference、query hash、Frontier 或 Receipt 绑定不一致均失败关闭，不能
降级成普通证据不足后继续签发 Support/Coverage/Stop。

## 3. Candidate 与生产 Authority 边界

当前 `@data-agent/research` 不拥有 production Compiler/Policy/Persistence Authority。
普通 root 调用没有 process-local assurance 时，所有不能由纯闭包证明的检查必须为
`MISMATCH`，最终 OED 为 `FAIL`。

server 内部受控组合可以签发 identity-bound transient assurance，但必须满足：

- token 只存在于进程内 WeakMap，clone、spread、JSON round-trip 与跨模块伪造均失效；
- metadata exact 绑定 Brief、Plan、QueryContract、SqlArtifact、SemanticRelease、
  PolicyReceipt、compiler evidence hash 与 policy evidence hash；
- token 固定声明 `boundary=KERNEL_CANDIDATE_ONLY`、
  `persistence_authority=NONE`、`can_authorize_execution=false`；
- issuer 不从根包或 public server export 暴露；
- controlled fixture 成功只能证明纯内核协议，不得描述成生产授权或持久化提交。

Production SemanticQuery→LogicalPlan→SqlArtifact Compiler Receipt、真实 Policy
Authority、事务内 L2 Artifact Authority Adapter 与 OED Committer 仍为
`NOT_IMPLEMENTED`。后续 Platform 任务必须在真实事务内重新验证 exact SQL/Policy
闭包；不能把 transient assurance 持久化或跨请求复用。

## 4. 必需攻击 Oracle

- OED(S1) 与 QueryEvidence/Execution(S2) 组合失败；
- LogicalPlan/SqlArtifact 从 S1 换成 S2 后重封失败；
- SQL alias 正确但常量、谓词、注释或字符串错误时失败；
- 同 Scope、不同 exact PolicyReceipt 失败；
- raw/self-sealed OED 与旧 `1.0.0/obligation-execution@1.0.0` 元组失败；
- assurance clone、spread、JSON round-trip、缺 callback 与 callback 拒绝均失败；
- exact controlled fixture 正例只得到 `KERNEL_CANDIDATE_ONLY`。

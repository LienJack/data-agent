# U5 首版语义发布 Bootstrap Admission 与后续治理

## Goal

让一个已经完成 U1 Greenfield 输入冻结与 U4 Ontology Package 验证、但仍处于
`active_release=null && generation=0` 的语义域，能够由独立、非模型的 Bootstrap Publisher 原子发布首个
Published Semantic Release。首发成功后 Bootstrap 权限永久熔断；所有 generation≥2 变更继续使用既有
Candidate→人工 Review→Publish→Rollback 治理链。

## Background and Confirmed Facts

- U1 已提供 Greenfield Bootstrap Candidate、100% Semantic Coverage floor 与角色分离的 Ed25519 public signer
  registry 合同；这些仍是 Candidate，不是发布授权。
- U4 已提供 immutable Ontology Package Candidate、Validation Receipt 与 Preview Binding Authority；U5 只消费
  exact package/version/hash/receipt/projection，不创建第二份 Ontology 或 Graph Authority。
- 10610 已有 `semantic_source_release`、`semantic_active_pointer`、runtime activation 与人工 Review/Publish/Rollback
  基线，但旧 `bootstrap_domain` 只检查 signer 字符串，且普通 `prepare_publish_attempt` 要求人工批准的 Review Task。
- U2 Effective Config 只认可 `semantic_active_pointer` 指向的 exact `semantic_source_release`；U5 首发必须继续产出
  这条运行时可消费链，不能只写一个旁路 Release Set 表。
- 本任务使用隔离、无业务数据的 Greenfield fixture 验证 Authority。既有 Falcon 数据不重复导入，Falcon gate 只在
  U1–U20 完成后执行。

## Requirements

1. 新合同必须严格定义并 canonical hash：`SemanticBootstrapPolicyView`、verified domain-bootstrap receipt、
   deterministic validation receipt、不可委托 Publisher Grant ref、Initial Release Set、逐 Package admission receipt、
   `FirstReleaseAdmissionReceipt`、bootstrap capability tombstone与幂等结果。
2. Policy View 只暴露 scope、policy digest、Mandatory Manifest、coverage/lowerability/source boundary 与有效期；不得
   包含签名原文、private key、grant nonce、bearer material、Falcon sealed/gold/expected 或 Provider material。
3. Workspace Admin 与 Platform Attestor 必须使用不同 principal、不同 ACTIVE key revision 和不同 public material；
   packet scope/audience/policy/release-set/digest/nonce/expiry 必须全部闭合。未知、撤销、过期、重复 nonce 或签名不匹配
   必须在 domain genesis 创建前失败。
4. Ed25519 key revision 必须先完成一次 possession/activation challenge 才能从 STAGED 进入 ACTIVE；packet 的
   cryptographic verification 在独立 Platform verifier 内对 PostgreSQL-governed ACTIVE revision 执行。提交 verified
   receipt 的 RPC 仅授予专用 NOLOGIN verifier role，并在同事务再次锁定 key revision、scope、purpose、status、
   principal、nonce、expiry 与 packet digest。普通 backend/Agent/Worker 不得调用。
5. Publisher Grant 由 PostgreSQL Privileged Grant Authority 创建并持有，只向调用方暴露 content-addressed ref/hash；
   grant 绑定 issuer/key-id/audience/operator/scope/release-set/policy/candidate-set/revocation-epoch/issued/expires，且只能由
   专用 NOLOGIN publisher role在最末端事务内 CAS 消费一次。
6. Bootstrap validation 必须逐字绑定 U4 Candidate/Validation/Preview、Schema Snapshot、Source Bundle、Policy、
   Candidate Set Hash、runtime projection refs/hashes、Mandatory Manifest 与 coverage/lowerability/query-dry-run 结果。
   mandatory unresolved、open question、缺 mapping/join evidence、Formula AST/compiler drift、source pollution 或 stale ref
   均不得发布；optional ambiguity 保留 Candidate，但不进入 Initial Release Set。
7. 首发 RPC 必须先按 scope+idempotency key+request hash 查询已提交结果。精确重试返回原 Receipt；冲突重试失败。
   只有不存在已提交结果时，才检查 grant expiry、revocation、generation 与 active pointer。
8. 一个事务内必须锁 domain/pointer/grant/candidate-set，重验 verified domain receipt、policy、U4 receipts、runtime
   projections、`active_release=null && generation=0`，再原子写 generation 1 Initial Release Set、运行时可消费的
   `semantic_source_release`、逐 Package admission、First Release receipt、active pointer、`PUBLISHED_ONLY` activation、
   graph release bindings、grant consumption、capability tombstone、audit/outbox。任一步失败必须全回滚。
9. 10656 必须把既有治理表向前扩展为数据库可判定的系统 admission：Review Task 新增
   `packet_kind=SYSTEM_BOOTSTRAP_ADMISSION` 与 `approval_mode=SYSTEM_BOOTSTRAP_POLICY` 的合法组合，Publish Attempt 与
   Source Release 同样冻结该 approval mode；现有行及普通路径固定为 `HUMAN_REVIEW`。系统 admission 禁止任何
   `semantic_review_decision` 行，`decision_set_digest` 必须来自 Policy/Admission receipt，而不是虚构人工 decision。
   运行时 compatibility bridge 只把同一 Release Set digest 投影到既有 `semantic_source_release`，Initial Release Set
   与 admission receipts 仍是首发来源 Authority。
10. Bootstrap 成功后，即使使用新 key、新 nonce、新 policy 或新 grant，也必须因 tombstone、generation 或 active
    release 被永久拒绝。不得删除 v1 或重开 generation 0 特权。
11. 通用 Web Publish Route 必须严格拒绝 Bootstrap Policy/Grant 字段；AI、导入文件、MCP、Job payload 或客户端布尔值
    不能进入 bootstrap publisher。U5 仅提供 server-internal verifier/publisher composition 与只读 receipt projection。
12. generation≥2 必须继续依赖既有人工 Review/Publish/Rollback Authority。Bootstrap grant 不得用于普通 publish，
    普通 publish/rollback 也不能修改、替换或删除 bootstrap admission receipts。
13. OSI/Ossie import 仅 dry-run 转为内部 Package/AST/Patch Candidate；不得直接发布。Export 只读取 Published Release
    与 content hashes；交换协议不成为 Authority。
14. PostgreSQL 必须使用 forward-only 10656 migration：新增 Authority/Receipt 保持 append-only，并仅对 10610 治理表做
    approval-mode 约束扩展、对不安全旧函数做撤权/替换；使用 FORCE RLS、NOLOGIN owners、窄 EXECUTE grants、immutable
    receipts、稳定错误码和 renderer/static assertions，不 backfill、dual-read、导入或改写历史业务行。
15. “后续治理”必须在真实 PostgreSQL 上可执行，不能只靠 Web mock。10656 必须撤销旧 10610 bootstrap/publish/rollback
    函数的 PUBLIC 与不必要应用权限，修复旧 `commit_publish_attempt` 未写必填 `quorum_snapshot` 的运行时缺口，并用
    backend-context-bound、NOLOGIN-owned 的严格 Human Governance RPC 继续 generation≥2 Review/Publish/Rollback；系统
    bootstrap role 与 human publisher role 不得互相调用。

## Acceptance Criteria

- [x] Contracts 对所有 U5 document/ref/result 提供 strict schema、canonical builders/verifiers，并拒绝 raw signature、
  private/bearer material、非 canonical package set 与跨 scope splice。
- [x] 两个真实 Ed25519 test key 可完成 role-separated verification；错误 signature/key/status/purpose/principal/nonce/expiry
  在任何 domain/release 写入前失败，普通 backend 无 verified-receipt EXECUTE 权限。
- [x] Greenfield fixture 的 exact U4 Candidate Set 与 validation/projection receipts 经 deterministic gate 后，一次事务
  产生 generation 1、同 digest 的 Initial Release Set、runtime `semantic_source_release`、First Release receipt、逐 Package
  receipt、active pointer、`PUBLISHED_ONLY` activation、outbox 与 tombstone。
- [x] Candidate Set Root 是一条真实 10610 Candidate Revision manifest，且其 canonical package entries 与全部 U4 Package
  Candidate/Validation/Preview 一一闭合；`semantic_source_release.candidate_id` 必须指向该 root，不允许随意选取其中一个
  Package Candidate 充当集合身份。
- [x] 精确 Bootstrap 重试只返回原 Receipt 且所有 authority table 计数不变；改 hash 的同 key、generation>0、active
  release 非空、过期/撤销 grant、已消费 grant和 tombstoned domain 全部稳定拒绝。
- [x] mandatory unresolved、invalid U4 receipt、缺 join/mapping proof、Formula/compiler/source/policy/snapshot drift 与
  cross-workspace package set 均保持零 Release/Pointer mutation；optional unresolved 不进入 v1 但仍保留 Candidate。
- [x] U2 Defaults/Effective Config 能解析新 v1 的 exact release id/generation/digest；Graph Studio/Resolver 读取同一
  release-set package binding，不存在第二发布 Authority。
- [x] 普通 publish route 的 Bootstrap 字段、Agent actor 与 import direct-publish 机械失败；正常人工 v2 publish 与
  rollback characterization 不回归。
- [x] Fresh PostgreSQL 在 v1 system admission 后创建新的 base-release-bound Candidate、真实 Review Task/Decision，发布 v2
  并 rollback/roll-forward；v2 Source Release 包含真实 quorum snapshot/decision digest，所有 legacy unsafe RPC 对 PUBLIC
  与错误服务身份均不可执行。
- [x] Fresh PostgreSQL 17 全迁移与 U5 assertions、focused Contracts/Platform/Web、typecheck/build、renderer/static、
  Biome、diff-check 全绿。
- [x] scoped commit 只包含 U5 owned paths；不导入任何数据、不运行 Falcon gate、不调用 Provider、不新增商业计费。

## Out of Scope

- Semantic Agent 自动生成真实 Candidate、真实 Source ingestion 与 maintenance（U11/U20）。
- Workspace Journey（U17）、Falcon 28 Package 实际发布与最终评分（U18）。
- Text2SQL lowering/runtime（U13）、Studio UX（U17）、MCP/Knowledge/Files/Artifacts。
- 历史 Release 迁移、Backfill、Dual Read/Write、旧 API 兼容、数据导入、Provider 调用与 Billing/Pricing/Credit。

## Dependencies

- U1 capability/bootstrap/signer contracts。
- U2 Effective Config release resolution。
- U4 Ontology Package Candidate/Validation/Preview Authority，commit `dcfa9a0`。

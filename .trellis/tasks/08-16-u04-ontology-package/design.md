# U4 Technical Design

## Authority Flow

```text
SchemaSnapshot ref/hash + BusinessSourceBundle ref/hash + Policy digest
  -> OntologyPackageCandidate (strict, untrusted)
  -> canonicalize package and resolve deterministic stable IDs
  -> Graph v2 structural validator + package closure validator
  -> compile native/runtime preview
  -> compare Formula AST and compiler digests
  -> MandatoryReleaseManifest validation
  -> PostgreSQL immutable Candidate Package + Validation Receipt + Preview binding
```

Candidate parse、自洽 Hash 和 compiler success 都不授予发布权。PostgreSQL 是 Package/Validation/Preview receipt
Authority；既有 `semantic_candidate_revision` 与 Graph v2 projection 仍分别拥有 Candidate revision 和 Graph read
projection，U4 不复制它们。U5 必须消费 U4 committed package/validation refs 后才能做一次性 bootstrap publish。

## Contract Shape

`ontology-package.ts` 定义：

- `OntologyNamespace`：scope、workspace_id（必须等于 tenant_id）、semantic_domain、namespace_id。
- `OntologyPackageSourceBinding`：exact Schema Snapshot、Business Source Bundle、Policy digest；只接受 allowlisted source
  classes，显式拒绝 benchmark sealed/gold/expected/holdout。
- `OntologyPackageDependency` / `OntologyPackageImport`：目标 Namespace、Package ID/version/hash 与 import mode。
- `OntologyPropertySemantics`：BUSINESS_SUBJECT role、DIMENSION property semantics。
- `OntologyEdgeSemantics`：object property、taxonomy/alignment、inverse、domain/range/cardinality。
- `OntologyConstraint`：typed constraint、target、deterministic rule AST/hash、provenance、resolution status。
- `OntologyPhysicalMapping`：logical object、exact snapshot/datasource/physical identity、QUERYABLE/KNOWLEDGE_ONLY、evidence。
- `OntologyMetricBinding`：metric/formula/dimension/grain/time/unit closure 与 compiler digest。
- `MandatoryReleaseManifest`：v1 必须纳入的 Node/Edge/Constraint/Mapping/Metric IDs。
- `OntologyPackageCandidate`：上述对象、Graph v2 source、canonical package hash。
- `OntologyPackageValidationReceipt`：deterministic validator version、source/package/compiler hashes、issues、valid、DB time/hash。

所有 public boundary 使用 `z.strictObject`。Builder 对 hash 字段之外的 canonical material 计算 hash；Verifier 重新计算。
数组先按稳定复合键排序并拒绝 duplicate，不能靠 `Set` 静默吞掉冲突。

## Stable IDs

Stable ID material 固定为：

```text
ontology-object-id@1.0.0
+ namespace(app,tenant/workspace,environment,domain,namespace_id)
+ source(kind,source_id,source_version,source_hash,object_path)
+ semantic_role
```

输出使用 hash-derived canonical UUID。Source identity 相同但 role 不同必须不同；同 material 必须相同。调用方提供的
Graph node/edge ID 必须与 resolver 输出一致，物理对象继续由 Schema Snapshot materializer 生成，但要纳入 Namespace。

## Validation

校验器分三层并返回 canonical ordered issues：

1. Graph structural：复用现有 dangling edge、registry、Formula slot、cycle、grain/fanout checks。
2. Package closure：Namespace、source refs、dependency DAG、Stable ID、Domain/Range、Constraint、Provenance、Mapping、
   Metric/Formula/compiler digest。
3. Release admission preview：Mandatory Manifest exact set，所有 mandatory 对象 resolved/valid/queryable；optional unresolved
   只留 Candidate。

Compiler 输出增加 Package identity/hash、queryable object set、knowledge-only object set 与 formula AST digest map；runtime
projection只消费 QUERYABLE 且 mandatory-valid 的对象。

## PostgreSQL 10655

Greenfield migration `20260725010655_app_data_agent_ontology_package_authority` 新增三张 append-only 表：

- `semantic.ontology_package_candidates`
- `semantic.ontology_package_validation_receipts`
- `semantic.ontology_package_preview_bindings`

主键完整包含 app/tenant/environment/semantic_domain/package_id/version；Candidate ref 绑定现有
`semantic_candidate_revision`，Preview ref 绑定现有 Graph projection。窄 RPC `commit_ontology_package_candidate`、
`commit_ontology_package_validation`、`bind_ontology_package_preview`、`get_ontology_package_preview` 使用
`SECURITY DEFINER SET search_path=''`、exact scope、canonical hash、idempotent replay/conflict。普通 backend 无 direct DML；
新 NOLOGIN owner、FORCE RLS、immutable trigger 与精确 grant。

## Security and Greenfield Boundary

- 不读取 active/old Release，不接受 base release 非空的 Greenfield Candidate。
- 不接受跨 workspace/scope Artifact refs。
- 不允许 source/evidence role 为 FALCON_GOLD、EXPECTED、SEALED、HOLDOUT、TEST_CASE。
- SQL/Artifacts 不保存 raw benchmark question、Gold SQL、expected result 或 credential。
- 无 Provider、Falcon、导入、Billing/Pricing/Credit 路径。

## Recovery

Package/Validation/Preview 都是 immutable append-only。相同 ID/version/hash 重放返回原 Receipt；相同 ID/version 不同 hash
稳定冲突。Candidate 未 valid 时只保留诊断，不产生 Preview/Release binding。U5 失败时 U4 Authority 不删除。

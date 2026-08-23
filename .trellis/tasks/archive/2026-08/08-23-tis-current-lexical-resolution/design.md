# M1 当前发布词汇解析设计

## Contract

`SemanticLexicalEntry` 是 authority snapshot 中的可重建发布投影：

```text
release_ref + target_kind/id + term_id? + match_kind + phrase + evidence_hash
```

`match_kind = CANONICAL | PREFERRED | ALIAS | SYNONYM | ABBREVIATION`。Canonical/alias 直接来自
发布 metric/ontology；Glossary `DENOTES` 的 `TERM_LINK.lexical_role` 产生 preferred/synonym/
abbreviation。`RELATED` 不进入 lexicon。Glossary term 若用于 DENOTES，不以自身 canonical 身份抢占目标。

Route decision 携带 `lexical_evidence`。Clarification candidate 携带命中类型与 evidence hash；package
capacity 只加入最终选中证据，歧义只展示有界候选。

## Resolver

解析时规范化 NFKC、trim、Unicode lowercase 与非字母数字边界；规范化结果不写入权威载荷，避免 PostgreSQL
与 JavaScript 的 Unicode 实现漂移。只保留最低 tier 数字（最高语义强度）的命中，并按可移植的
`tier + evidence_hash` 排序后按 target 去重。同一个 target 多词命中保留
最强且 key 最小的 evidence；多 target 一律澄清。

## PostgreSQL

10705 新增 `resolved_context_published_lexicon`，并原位替换稳定的
`load_resolved_context_authority_snapshot` / `commit_resolved_context_package`。Load 从 exact active release
的 graph/executable projection 生成 lexicon；commit 重载同一个当前 snapshot 后闭合 hash。不会同时存在
V1/V2 两组 RPC。现有 receipt 表继续作为 append-only current authority，不复制旧行；绿地环境无数据迁移。

`verify_resolved_context_text2sql_binding` 的 shape 不变，只要求其 package/receipt 指向当前 authority。

## Safety

- Release identity 重复绑定到每条 lexicon entry，并由 snapshot refine 精确比较。
- Candidate/草稿不参与 projection；只有 active Published Release 表与 sealed projection 可读。
- canonical arrays 使用 `match tier + evidence_hash` 排序，不依赖 locale 或跨运行时 Unicode collation。
- 任何 DB substitution/hash mismatch 映射为现有安全错误，不返回原始 SQL/载荷。

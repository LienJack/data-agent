# Graph v2 核心设计

## Architecture

- 在 `packages/contracts` 新增 additive Graph v2 artifacts，不改变 Graph v1 bytes。
- 在 `packages/semantic` 实现 canonicalizer、registry validator、Formula resolver、compiler 和 reducer。
- PostgreSQL 继续保存完整 source revision；规范化 Node/Edge projection 为查询加速和审阅服务。
- release 增加可选 Graph projection ref：旧 release 可为空，Graph v2 release 发布时强制存在且 digest
  必须与 source/compiler receipt 匹配。

## Contracts

- Node：严格 discriminated union；`PhysicalColumn` 是支撑 identity。
- Edge：稳定 ID、registry type、family、source/target、lifecycle、typed attributes、evidence refs。
- Formula：安全 AST 子集；slot 通过 `REFERENCES`/`DEPENDS_ON` Edge 的 slot attribute 解析。
- Patch：ADD/UPDATE/RETIRE Node/Edge，带 from/to revision、before/after digest 和 patch digest。

## Persistence

- 复用 `semantic_source_revision`、`semantic_candidate_revision`、`semantic_source_release`。
- 新增 graph projection/node/edge 结构及必要 release ref；所有结构按 workspace/tenant/environment/
  domain 隔离，具备 RLS、唯一性和重建 metadata。
- Graph reducer 是纯函数；发布 source/candidate revision 只在 materialize checkpoint 生成。Agent
  每步 mutation 的 append-only patch/receipt/overlay 由 runtime 子任务接入，避免复制完整图。

## Compatibility

- Graph v2 → Graph v1 runtime projection 是单向、确定性的 compatibility compiler。
- Graph v1 read adapter 不创建新 release；批量 converter 留给 rollout 子任务。
- migration 使用下一个可用编号并通过 order/checksum 测试，不破坏性 down migrate。

## Validation Order

schema/digest → identity/scope/endpoints → lifecycle/completeness → Formula/slots → cycles → join/fanout →
authorization → runtime compile。

## Rollback

关闭 Graph v2 feature flag，继续读取旧/最后 active release；删除或重建 projection 均不影响 source
authority。保留 additive tables 和 revisions，不执行数据删除。

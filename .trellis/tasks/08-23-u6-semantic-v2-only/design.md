# U6 设计

- Contract map 按 Authoring、Candidate/Governance、Published Read、Runtime Context、Relationship Projection 分区。
- Lifecycle-neutral V2 content 是 compiler/lowering/hash 的唯一输入；Preview/Published envelope 不可互换。
- Ports 位于 Contracts；Semantic application/kernel 只依赖 Ports；Platform Adapter 在 U7 接线。
- Graph V2 必须显式携带分析元数据，validator 返回对象/字段定位 issue。
- `10701` 以 greenfield marker/app/environment preflight 后 DROP V1-only catalog 和 rows；不转换或归档。
- Package 只导出受控 subpaths；root 不导出 V1/内部 compiler helper。

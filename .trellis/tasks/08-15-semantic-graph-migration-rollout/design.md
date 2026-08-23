# Graph v1 迁移与上线设计

## Converter

Converter 读取 immutable Graph v1 source/schema snapshot，按稳定 ID 创建 Graph v2 candidate：entity
→ BusinessSubject，dimension → Dimension + binding/hierarchy Edge，metric → Metric + Formula + dependency
Edges，physical catalog → Table/Column/structure Edge，relationship → business/physical/join family Edge。

无法唯一映射的项带 source path、候选 options 和 reason 进入 unresolved report，不以显示名猜测。
已有业务主体、维度和指标沿用 v1 stable ID；v1 独占 Formula 使用 `metric_id + defined-formula`
命名空间生成稳定 ID，Edge 使用 `edge_type + source + target + stable source discriminator` 生成稳定
ID；PhysicalTable/Column 只从 datasource/schema snapshot identity 派生，不单独使用易漂移名称。

## Governance

Graph v2 candidate 复用现有 review/publish 状态机。Validation/review receipt 绑定 source digest、base
release、candidate revision、compiler/policy。Query Runtime 只读 active release。

## Rollout

五级 feature flag：read adapter → dual compile → allowlisted authoring → publish → full graph。每级都有
指标、对比和 rollback gate；community/Neo4j/full graph 可独立关闭。

## Rollback

关闭 authoring/publish/full graph，恢复 last active release；保留所有 candidate/revision/receipt。投影
损坏从 release source 重建，不执行 destructive down migration。

## Observability

监控 conversion unresolved、compile mismatch、validation failures、tool retry、SSE replay、projection lag、
community rebuild、stale candidate/publish 和 RLS denial；日志脱敏且可关联 receipt/digest。

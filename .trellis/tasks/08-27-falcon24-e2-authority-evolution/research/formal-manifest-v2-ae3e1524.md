# Falcon24 formal manifest v2 implementation proof

## Boundary

- implementation baseline: `ae3e152402cc497eaf400ad50c71885b8d7bb3af`
- current schema: `falcon24-four-layer-gate-manifest@2.0.0`
- historical schema retained: `falcon24-four-layer-gate-manifest@1.0.0`
- v2 turns hash: `sha256:4ecf4742d2f8a201b3abe9609177441a0672a629becb4f58a23c18b7c7251142`
- v1 turns hash: `sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9`

v2 保持15回合和5/2/2/6分层，只把已验证的语义定义、结果形状和单Analysis交接写入题面与rubric。Semantic必须签发当前Run
SemanticQueryContext，Text2SQL必须消费该Context并产生当前Run QueryEvidence；没有注入SQL、内部ID、结果值、Host答案或关键词路由。

## Migration proof

- migration: `20260725010817_app_data_agent_falcon24_four_layer_manifest_v2.sql`
- renderer checksum: `sha256:92054489f6fd488d4e587679865c3ec6c7f17ded4992b81a8f37cf1b6e5f4fb6`
- audit receipt: `/Users/lienli/.codex/audit/falcon24-e1-authority-reset/manifest-v2-postgres-ae3e1524.json`

一次性NAS PostgreSQL E17物理副本先证明10817前序、owner/ACL与函数body基线，再执行迁移。迁移后受保护历史零漂移；v1与v2各自
begin、exact replay及supersede到READY均通过；跨版本turns/hash混配以`FALCON24_FOUR_LAYER_MANIFEST_INVALID`失败关闭。live authority
写入为0；一次性container、volume与55530 forward均已删除，原e5 checkpoint保留。

## Validation

- focused: Contracts 7/7，Evals 3/3，Web 46/46，Platform 24/24；root migration/render/inventory 12/12。
- package gates: Contracts/Platform/Web typecheck PASS；Contracts/Evals/Platform build PASS。
- repository gates: Supabase static check PASS；workspace single-concurrent unit 15/15 tasks PASS；force build 9/9、0 cache PASS。
- hygiene: owned TypeScript Biome、migration renderer verify、inventory、Trellis validate及`git diff --check`在提交前复验。

这只是manifest实现与migration兼容性证明，不是正式四层PASS。实现必须先独立提交；正式验收只能从新commit创建clean build、fresh专用物理
scratch、fresh E17 activation、fresh manifest和唯一attempt，不能复用六题预检或本次migration副本。

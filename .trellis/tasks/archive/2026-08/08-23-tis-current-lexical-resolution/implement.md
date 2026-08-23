# 执行计划

1. [x] 补 contracts 与 lexical resolver 测试，固定 schema、priority、ambiguity、hash 和排序。
2. [x] 新增 `semantic-retrieval.ts`，只升级 shape 变化的 Snapshot/Route/Package 并切换 consumer。
3. [x] 用 `lexical-resolver.ts` 取代独立 metric resolver，router/resolver 统一消费 typed evidence。
4. [x] 新增 10705 source/renderer/rendered migration，原位替换唯一 current RPC 与 postconditions。
5. [x] 保持 Platform 稳定 RPC adapter，更新 PG assertion、Trellis 规范和计划路径。
6. [x] 运行 contracts/semantic/platform/text2sql/web 定向测试、相关 typecheck、renderer/static、PostgreSQL 17 定向 smoke 与旧路径扫描。
7. [x] scoped commit 前质量门已通过；提交后归档与 journal，随后用固定回放结果决定 M2 go/no-go。

回滚点是整个 M1 scoped commit；运行时不保留旧 contract/RPC 分支。

# a58533a4 A2：重复条件 Analysis 叶节点导致终态 HOLD

## 结论

`a58533a4` clean build、fresh E17 NAS scratch 的 A2 Run
`89e2cd42-d58f-88bf-acdb-09ab13246368` 保留不可变 FAILED。Semantic、Text2SQL与48行
QueryEvidence均正确；失败点是 Analysis Program 把同一发布方法和同一执行合同编译成两个关键节点，其中第二个只是
`MATERIAL_CHANGE`条件下对第一个的精确重复。第一个节点的 FULL Oracle 返回 PASS且`material_change=false`，第二个节点因此未激活，
现有Executor却以`ANALYSIS_NODE_DEPENDENCY_FAILED`标记关键失败，最终产生`FALCON24_ANALYSIS_PUBLICATION_TERMINAL_HOLD`。

这不是余额、Semantic、SQL、Sandbox、Publisher、Oracle、Explanation、stage TTL或Root预算问题。旧Run不重提，已产生stage不提交权威。

## 不可变证据

- Run：`89e2cd42-d58f-88bf-acdb-09ab13246368`。
- SemanticQueryContext：`e9f07537-29d1-8d1a-a57f-20a95dbd7706`。
- SqlArtifact：`76c92796-bc3d-870c-abda-20b5d0c64fa1`。
- QueryEvidence：`5d3596d9-9fc5-8abf-9b7a-38d82ff2f5fd`；48行，字段为month/category/current_value/comparison_value/growth。
- Analysis task：`f9fe0c65-f123-4720-ab56-0503729b5ba4`。
- Stage：`c54f6609-3ad5-53f3-81be-b23543722f26`；journal依次到
  `MODEL_CELL_COMMITTED -> PUBLISH_STAGE_CREATED -> CONTEXT_FROZEN -> ORACLE_VERIFIED -> EXPLANATION_BOUND`，没有authority commit。
- 首节点`node_rank_decline`使用`published-monthly-group-panel@2`，FULL Oracle为PASS，48行样本，coverage为2/3，
  `material_change=false`，限制为`RELATIVE_DELTA_UNDEFINED`。
- 次节点`node_decompose_top3`与首节点的method registry IDs、Metric/Dimension IDs、时间窗、参数、operator obligations、criticality完全一致，
  仅依赖首节点并以首节点为activation source，且没有后继。

## 前向修复边界

Host compiler只折叠“精确重复的直接条件叶”：非ALWAYS、唯一依赖等于activation source、source为ALWAYS、同criticality、完整执行身份
canonical JSON相同、无人依赖该条件节点。budget按保留节点数重算。

以下情况一律保留：不同method/metric/dimension/window/parameters/operator obligations、不同criticality、非直接依赖、source不是ALWAYS，
或该节点仍有后继。Executor的SKIPPED/FAILED语义、critical terminal HOLD、Publisher/Oracle/Explanation/Authority链均不修改。

## 验证与下一步

聚焦TDD先得到新用例1 FAIL / 原10 PASS；实现后精确折叠、不同method保留、非叶重复保留共12/12 PASS。受影响Analysis回归49/49、
Worker official unit 101/101、typecheck/build、owned Biome、Trellis validate与`git diff --check`均通过；workspace单并发unit gate
15/15通过（14 cache）。scoped commit后必须停止本轮现场并核对live E16零漂移。随后从新clean build/fresh物理scratch
的A1重跑六题；不得把本轮A1 PASS或A2正确前缀拼入下一epoch。

# U1 实施

1. 盘点 Semantic/Billing route、export、runtime、SQL、UI 及消费者，生成 ledger。
2. 为依赖方向、禁止兼容/计费 surface 补失败测试。
3. 实现 migration inventory verifier 和坏例 fixture。
4. 更新 Workspace Semantic/Model Provider/legacy route characterization。
5. 运行 focused tests、`git diff --check`，提交 `test(architecture): guard semantic and billing retirement`。

验证：计划 U1 的五个 Test scenarios 全部有直接测试或 ledger 证据。

# U5 实施

1. 盘点计费表、mutation function/trigger/grant 和现有 renderer 模式。
2. 先写 SQL static/PG assertion，证明历史 digest、零写权和旧 RPC 不存在。
3. 实现/render `10700`，更新 manifest 与 smoke harness。
4. 运行 migration inventory、static check、filtered PG17 smoke，再运行完整 PG smoke。
5. 更新 `workspace-identity-billing` 当前规范并提交 scoped commit。

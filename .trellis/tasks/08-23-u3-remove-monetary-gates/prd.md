# U3 移除金额运行时门禁

## Goal

删除模型与语义运行时的金额 readiness 门禁，使有效服务端模型配置在无价格/汇率/余额时仍可调用。

## Requirements

- 覆盖 R10–R12；保留 context/token/output/provider/tool/timeout 技术预算。
- 删除 `operational_constraints.pricing`、`UNBILLABLE`、cost budget reason 和 VERIFIED price/fx 要求。
- Provider 直连、Usage 事实、Scope/Run/Attempt 和凭据失败关闭保持不变。

## Acceptance Criteria

- [ ] 无 price/fx/credit fixture 时 Q&A、Test Center、Semantic Candidate 和 Worker Provider 正向场景通过。
- [ ] 缺凭据、部署 disabled 或技术预算超限仍在网络前拒绝。
- [ ] Provider 未报告 token 时保持 `UNAVAILABLE/null`，不计算成本。
- [ ] 当前 schema、数据库约束和生产代码不接受/产生 `UNBILLABLE`。

## Notes

- 依赖：U2。

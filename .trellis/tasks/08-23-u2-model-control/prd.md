# U2 提取非商业 Model Control

## Goal

把 Provider/Model/SecretRef/technical readiness 从 Billing/Pricing 原子迁入独立 Model Control bounded surface。

## Requirements

- 覆盖 R10、R11、R16；保持 Workspace RBAC、SecretRef 和服务端配置边界。
- 新合同和 repository 不携带 price/currency/fx/credit/bill 字段。
- 同一 scoped commit 切换全部生产/测试消费者并删除旧 import/export/getter；不保留 re-export。

## Acceptance Criteria

- [ ] 管理员可创建 provider connection、绑定 SecretRef、登记模型；普通目录不暴露商业字段。
- [ ] Model Provider、Q&A resource resolution、bootstrap 只依赖 Model Control repository。
- [ ] 旧 Billing/Pricing 模型控制符号无法解析，forbidden scan 防止回归。
- [ ] RBAC、workspace/environment scope 与 SecretRef 测试保持通过。

## Notes

- 依赖：U1。

# 模型认证控制面与前端入口实施清单

## Implementation

- [x] 现有模型目录增加认证版本、时间、响应条目数、幂等键和操作者字段。
- [x] 新增两个窄 SQL 函数：记录状态、读取状态。
- [x] 新增同步 SUPER_ADMIN API，复用现有受限模型目录请求。
- [x] 设置页增加“认证 / 重新认证”按钮和两态展示。
- [x] Q&A 根据当前 profile/config 的 `PASS` 状态设为可选择。
- [x] 删除 deployment claims/hash/repository、Worker 和 Provider Invocation 扩展。

## Verification

- [x] Contracts、Platform、Web、Worker typecheck。
- [x] Fresh migration 与 PostgreSQL 回滚探针。
- [x] Route、repository、Q&A catalog 聚焦测试。
- [x] Browser 设置页与 Q&A 验收。
- [ ] Scoped commit。

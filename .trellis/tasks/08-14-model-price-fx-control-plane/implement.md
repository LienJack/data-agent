# 实施计划

- [x] 扩展 strict contracts：模型目录、配置版本、同步 operation、审批/拒绝 DTO 和价格维度。
- [x] 新增 10629 renderer/migration、app-global tables、super-admin authority、RLS/grant、
  immutable trigger 和审批函数。
- [x] 实现 PostgreSQL model/pricing/FX repository 与跨实例、幂等、权限、区间测试。
- [x] 实现七类官方价格 source adapter、CFETS/PBOC FX adapter、raw evidence 限额和 fixture。
- [x] 实现 Worker 周期同步组合根；失败保留 active，未支持来源保持不可计费。
- [x] 迁移 Web model Map 到 repository，新增超级管理员 API/UI 和审批流程。
- [x] 通过 contracts/platform/worker/web/static/PostgreSQL 门禁。

# 实施计划

- [ ] 固化 `ResolutionTraceDetail`、公共 section/reason code、exact identity 与 API response 合同；先写严格解析、脱敏和历史绑定测试。
- [ ] 在 platform 层实现按 `run_id + node_id` 的只读详情 projector，覆盖 Run/Event、Config、Agent/Team、Tool、SQL/Schema、Context/Receipt、Artifact target，并保证同一权威读取边界。
- [ ] 新增 owner 详情 API；为管理员跨 owner 读取增加独立 audited route，覆盖授权拒绝和审计回执测试。
- [ ] 扩充 Resolution Trace 节点投影中已存在但被丢弃的公开 Tool/Agent 字段，同时保持索引响应轻量且向后兼容。
- [ ] 实现无 React/DOM 依赖的 workbench model：四泳道、统计、真实时间/sequence domain、搜索、edge hierarchy、稳定 identity 和增量合并。
- [ ] 重构 `ResolutionTraceView`：运行摘要工具栏、时间轴、区间拖选/缩放/平移/重置、搜索、阶段/调用折叠与虚拟化记录列表。
- [ ] 实现统一 Inspector：Summary/Payload/Result/Schema/Timing、懒详情、复制、reason code、引用导航、请求取消与焦点恢复。
- [ ] 把 Artifact exact preview 内联到 Result，支持单引用直显、多引用切换、TABLE/CHART 有界分页和局部错误状态。
- [ ] 将 Overview/Team/SQL/工件页签中可解析的裸 ID/hash 入口接入同一 Inspector；无法解析时显示稳定 unavailable 状态。
- [ ] 补齐 contract/platform/API/Web/component 测试，以及 10,000 节点虚拟化和 REST/SSE 重放一致性 fixture。
- [ ] 完成 1440px 与 390px 浏览器验证：双向定位、拖选/缩放、搜索、详情内容、Artifact、权限/错误、刷新/重连、焦点与 overflow。
- [ ] 更新受影响 Trellis specs；若实质复制 Harness 源码，更新 reuse ledger/MIT；运行 workspace-scoped test/typecheck/lint 与 `git diff --cached --check`。
- [ ] 分层审查数据正确性、安全、可访问性、性能和历史权威边界，修复发现后只提交本任务拥有的文件。

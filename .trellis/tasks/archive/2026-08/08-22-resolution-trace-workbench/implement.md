# 实施计划

- [x] 固化 `ResolutionTraceDetail`、公共 section/reason code、exact identity 与 API response 合同，并覆盖严格解析、未知字段和私有内容拒绝测试。
- [x] 在 platform 层实现按 `run_id + node_id` 的只读详情 projector：同事务覆盖 Run/Event、冻结 Config、Agent、Tool 与 exact Artifact target；SQL/Schema/Context/Receipt 继续通过 exact Artifact reference 进入既有安全预览，权威存储没有公共正文时诚实返回 unavailable，不旁路读取 raw context。
- [x] 新增 owner 详情 API。管理员跨 owner 继续复用既有 audited public-event 与 exact Artifact route，避免新增一条没有审计回执的平行详情通道；既有管理员拒绝/审计测试已复跑。
- [x] 将公开 Tool/Agent START 与 terminal 按 exact call/task identity 聚合到详情，补齐 input/output/error/duration/source events，同时保持 `ResolutionTrace` 索引响应轻量兼容。
- [x] 实现无 React/DOM 依赖的 workbench model：四泳道、统计、真实时间/sequence domain、搜索、edge hierarchy、稳定 identity、10,000 节点完整模型与每泳道有界时间轴投影；实时更新继续消费既有持久化 trace refetch/SSE cursor。
- [x] 重构 `ResolutionTraceView`：运行摘要工具栏、时间轴、区间拖选/缩放/平移/重置、搜索、阶段/调用折叠与虚拟化记录列表。
- [x] 实现统一 Inspector：Summary/Payload/Result/Schema/Timing、懒详情、复制、稳定 reason code、关系展示、真实请求取消、trace hash 缓存失效与焦点恢复。
- [x] 把 Artifact exact preview 内联到 Result，支持单引用直显、多引用切换，并复用既有 TABLE/CHART 有界分页和局部错误状态。
- [x] 将 Team、SQL、工件页签改为内容优先：Profile/Task/Handoff/Epoch/Verifier 展示名称、任务关系、状态、时间与产出类型；SQL 可切换 SqlArtifact/Receipt/Evidence/Result/SchemaSnapshot 内容；工件直接预览。ID/hash 统一降为“身份与来源”，历史名称缺失时明确不可用。
- [x] 补齐 contract/platform/API/Web/component 测试，增加 10,000 节点完整搜索、虚拟列表与有界时间轴 fixture；复跑既有 durable event assembler、Artifact Workspace 与管理员审计用例。
- [x] 完成 1440px 与 390px 浏览器验证：搜索命中内容、时间轴拖选/滚轮缩放/平移/重置、Inspector 内容/宽度/关闭焦点、窄屏布局、页面 overflow 与零控制台错误。
- [x] 更新 backend/frontend Trellis specs。本实现只参考 Harness 信息架构，未复制其实质源码，因此无需新增 reuse ledger/MIT 文件；workspace-scoped test/typecheck/build/Biome 与 diff check 均通过。
- [x] 完成数据正确性、安全、可访问性、性能和历史权威边界审查；修复异常状态误着色、时间提示缺字段、详情缓存漂移、请求未真实取消和万级时间轴无上限问题，并只提交本任务拥有的文件。

## 权威边界说明

- `resolved_context_receipts` 的正文读取受现有 authority RPC 约束。本任务没有为 UI 绕过权限直接 SELECT；有 exact Artifact 时走 Preview，没有公共投影时显示稳定 unavailable。若未来要把完整 Resolved Context material 暴露给普通 owner，需要单独设计、迁移并审计新的公共 RPC。
- 管理员审计界面已经通过 audited event route 展示完整公共 Event JSON，并通过 audited Artifact route 展示 exact 内容。本任务复用该边界，不增加无审计的 `/admin/.../resolution-trace/details` 重复通道。

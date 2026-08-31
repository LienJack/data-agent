# Complex L4 scratch — 816d6a0e Root protocol diagnostics

## Observed evidence

- Clean `816d6a0ea967c7597baa58734d3e4a3e07b98faf` force build8/8、full unit15/15、attestation PASS。
- Fresh NAS scratch `data-agent-falcon24-e17-816d6a0e` /55487，clone前348表与live一致；10816只迁移scratch，数据集9表/70列/121445行/1902NULL不变。
  certification `2344bf2a-9313-5dcc-8afe-809b72ed5a60` PASS；scratch Finalizer ACTIVE，baseline
  `91756d8b-254c-5a07-bcea-9e23ed7b0f79` / `sha256:92359c649223b1752db8af8c6ce44a6dd780fefc79a5d68a33013190fc1b0ca3`。
- A1一次composer，Conversation `dbc4754d-7b82-45c1-a15b-3fcd1133ab1c`，Run `b3a41b03-3e4f-8290-b9a6-e42dd19d677a`：
  SUCCEEDED/57events，Semantic→Text2SQL→Analysis；1次Python、0repair。独立源Oracle、12月表图、6个月有效同比/覆盖外NULL与结论数值通过；
  QA、全部73Trace节点、5个accepted artifacts、Team/SQL、刷新/返回通过。保留内部英文任务段、相对变化措辞及formal Report profile差异警告。
- A2同Conversation一次composer，Run `8e8c0d1e-58e8-8b66-9515-0d5a7d8fbccf` FAILED/5events。
  冻结Task v2含3条历史，尚无Semantic receipt、specialist或SQL；Root首模型调用返回 `MODEL_STREAM_PROTOCOL_VIOLATION`，
  `retryable=false`、`DISPATCHED_OUTCOME_UNKNOWN`；公开Run为 `PROVIDER_INVOCATION_OUTCOME_UNKNOWN`。
- 原始协议阶段未保存，无法判定 JSON、Schema 或 Tool 格式的具体原因；本轮不能证明多轮检索修复的真实端到端效果。
  未重放Run、未提交A3/B、未对失败Run做UI验收；不拼接旧A1/核心四题PASS，不生成formal PASS。
- live348表before/after完全一致、仍E16/10815。Web/Worker/OpenSandbox与唯一browser/auth关闭，55487转发取消、capability删除；scratch停机保留。

## Bug analysis

### Root cause category

**E — Observability / implicit assumption**：多种不同协议拒绝被归并为单一reason，私有日志也丢失stage；这证明诊断缺口，不证明模型具体错误。
已有Analysis planner诊断仅覆盖其专用调用，未覆盖Root首调用的原始adapter。

### Prevention

- 在原Mastra adapter补固定阶段与结构issue的私有日志；JSON值、正文、参数、未知键与error message都不输出。
- 不改变失败关闭、unknown delivery、schema、重试预算或发布权限；log sink失败也不得打断唯一终态。
- 离线回归覆盖AUTO JSON/Schema分类、非法chunk、未知字段、结构上限、伪造stage和日志异常。新构建再采样，不追认旧原因。

### Validation checkpoint

- 新测试先观察缺模块RED，后focused adapter/bridge/diagnostic 48/48及Agent Runtime typecheck通过。
- 最终Agent Runtime unit28文件180/180、integration26/26；Worker provider/root15文件88/88。
  Agent Runtime/Worker typecheck、Agent Runtime build、7文件Biome、Trellis validate与diff check通过。
  既有artifact/plan超32KiB注入警告未新增；当前不是四层验收完成。

证据：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-816d6a0e/`；运行清理与live审计在同audit父目录。

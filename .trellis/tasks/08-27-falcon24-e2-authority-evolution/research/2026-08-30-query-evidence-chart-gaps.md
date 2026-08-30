# F6：保留图表中的缺失同期

- 现场：357a891e canary Run `f757fd64-704c-88a2-93b1-df4620ff1e1f` 的 QueryEvidence 为 12 行，图表却只有 6 行。已发布同期覆盖之外的 NULL 导致整行被 chart builder 过滤。该 Run 仅数据 oracle PASS，QA FAIL；没有进入 Trace 或正式门禁。
- 修复：既有 chart document V2 支持 LINE/BAR 的 nullable series；派生器标记 `query-evidence-chart@1.1.0`，保留时期与 NULL，旧变换版本继续可读。PIE 缺失类别拒绝生成，至少两个时期含观测值。
- 展示：本地已安装 VChart 的 `IInvalidType`/invalid-travel/line-mixin 实现支持 `break`，显式选用该值；禁止零填充或跨缺口连线。
- 证据：新增缺失时期测试先失败（3 行被投影为 2 行）；修复后 Contracts/Platform 20/20，Web mapper 11/11，通过跨 package typecheck。表格/preview 相关 Web 回归另行运行。
- 边界：不修改 QueryEvidence、SQL、语义发布、live authority 或历史 receipt。本次是确定性修复证据，不是新 canary 或正式四层 PASS；日期、数值与 Root 正文仍待修复。

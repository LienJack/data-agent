# F6：QueryEvidence 可读呈现

## 最小复现

357a891e canary `f757fd64-704c-88a2-93b1-df4620ff1e1f` 数据 oracle PASS，但答案页把上海月初显示为上一天的 UTC 串，直接暴露浮点尾数，Root 正文仍是 `total_rows/columns/rows` 内部 JSON。图表丢失同期的独立修复已在 de76206e 提交。

## 决策与边界

1. 可选 TABLE column display 是呈现元数据，不是新的语义权威。只从已验证 QueryEvidence binding 取逻辑类型、粒度与匹配维度的 time-window timezone。
2. Preview、Root 正文、chart companion 共用同一纯投影/格式化入口；普通 STRING 不猜日期，DATETIME 缺 timezone 不猜本机时区，DATE 不做跨日偏移。
3. 原始 QueryEvidence rows/hash 不变；新的 chart display 进入该 chart 的 dataset/document hash。表格展示数值不带浮点尾数，并在 cell title 保留原值，CSV/XLSX 仍使用原始值。未取得 typed ratio/currency 元数据时不猜百分比或币种。
4. Root 仍先核验 current Run exact accepted Artifact，再将所选 table facts 排为 Markdown 表与行数/NULL/时区说明，最长前 100 行。没有追加模型调用、业务硬编码或跳过事实验证。

## 验证

- 时区月份、数值和 Root raw-dump 三组测试均先观察到失败，再修复。
- Contracts/Platform/Worker 聚焦 8 文件 80/80；Web preview、table、chart、store 4 文件 23/23。
- 边界覆盖夏令时、DATE 闰日、非法日期、无 offset 时间、invalid/missing/mismatched timezone、极小数、整数精度、NULL/0 和 Markdown/HTML 转义。旧 Artifact/hash 与 chart 缺值测试保持通过。
- 未运行新 canary，未写 live authority，也未产生正式 gate PASS。后续须 scoped commit、clean build/full gate、fresh canary，再进入同 Run QA/Trace。

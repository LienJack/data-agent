# `82aed231` B3 Semantic canonical ID 顺序复盘

## 结论

`82aed231` 已把 Semantic 零工具响应推进到合法 JSON 和正确嵌套结构。A1/A2/A3/B1/B2 在同一 clean build、同一 fresh scratch 上
完成了独立业务复核与同 Run QA/Trace；B3 的唯一 Run 仍在 Semantic selection strict schema 停止，未进入 Text2SQL 或 Analysis。

## 不可变失败证据

- build：`82aed2314e6801557445bd5d9b78ea49e40ccbe6`
- Run：`aa8c1da4-00ae-8fc8-9007-57cf3e7ec0c4`
- 四个 provider 调用均为完整、known response，统一 `RESPONSE_SCHEMA_MISMATCH`
- raw-free diagnostic：`issues=[{code:"custom",path:["$field",1]}]`
- 当前 response schema 中，只有 `canonicalIdsSchema` 会在 set-like ID 数组的后续元素上产生该形状的 custom issue；它要求严格升序且唯一
- 终态：FAILED；actual agents、SemanticQueryContext、SqlArtifact、QueryEvidence、Analysis均为0

同一 Run 不重提，不读取/修补受保护原文，不把前五题 PASS 拼入下一 build。

## 根因边界

exact canonical JSON Schema 能描述数组元素类型和数量，但不能表达完整 ID 字符串的 canonical order。Semantic prompt 原来只写
“unique and sorted”；B3 同时选择时间、渠道、人群等多个维度时，模型稳定按题目/语义顺序排列，而 strict refinement 需要完整 ID
字符串升序。四次同形失败说明继续重跑没有信息增益。

这不是净 ROI 定义、两完整月、父渠道筛选、目标人群保留、SQL、数据库或 Analysis 的错误；这些层在本 Run 中尚未获得执行权。

## 前向修复

在 server-owned Semantic system instructions 中明确：所有 `selected_*_ids` 和 `candidate_ids` 先完成选择，再按完整 ID 字符串的
JavaScript 默认顺序升序排列；不能按问题提及顺序、语义角色或重要性排序，并给出维度 ID 顺序示例。

Host 继续对模型原文执行原 `JSON.parse -> strict Zod -> canonicalize`，不调用排序、不删除重复项、不默认填字段、不增加请求或重试。
focused test 先以缺少该可执行定义 RED，再在实现后 17/17 GREEN。真实有效性只由下一 clean build/fresh scratch 从 A1 开始的六题证明。

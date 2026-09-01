# 5d7a80dd A3 Analysis Side Effect deadline 复盘

## 同一构建的证据

- commit：`5d7a80dd7a24326359167fad604a35c96f515a61`
- scratch：`falcon24-e17-5d7a80dd`，本地只经 `55520` 访问
- A1：`3a1e6807-169f-8877-82f5-b85feebe3a66`，业务/QA/Trace PASS，73 节点
- A2：`6d06e45d-aeea-83d0-9f64-284588482f50`，业务/QA/Trace PASS，80 节点
- A3：`e5c84cff-6291-85ce-969e-27bc9b1057e5`，FAILED，未重提

A3 当前 Run 重新完成 Semantic 与 Text2SQL，形成 48 行月份×客户类型 QueryEvidence。第一次 Analysis 调用输入只有受支持的 QueryEvidence，
Profile、输出类型和 `FINAL_ANSWER_EVIDENCE` 均正确；其 requested/task timeout 为 600,000ms，但 Worker 的通用
`executeSideEffectOnce` deployment default 仍为 60,000ms。该调用在边界到达时返回 `RUN_SIDE_EFFECT_TIMEOUT`，Root observation 为 FAILED、
`output_ref=null`。第二次正常 Analysis 委派返回 `GOVERNED_ANALYSIS_ORCHESTRATION_FAILED`，四个 Root 回合耗尽。

数据库中能看到第一次执行过程中产生的 AnalysisReport/Chart，但它们没有对应 accepted child observation，业务投影的 actual agents 不含 Analysis，
最终答案为空。这些对象不构成 receipt、当前答案证据或 PASS；旧 Run 保持不可变。

## 前向修复

Worker 默认总执行时限保持 300,000ms；daemon 的 Side Effect 默认值与 programmatic runner fallback 同步调整为 180,000ms。
显式 `WORKER_SIDE_EFFECT_TIMEOUT_MS` 仍按原 10–900,000ms 合同解析，测试用 90,000ms 证明覆盖没有被默认值吞掉。

该调整不改变 Profile/task 的 600,000ms 上限，不增加 Root/Provider/Analysis/tool/repair 次数，也不接受超时对象。总 Run abort、显式部署值、
capability/fence/cancel 继续生效；真正超时仍无 receipt、失败关闭。

## 下一证明

focused/official unit、typecheck/build、Biome、Trellis validate 与 scoped commit 后，必须用新 clean force build 和 fresh 物理 scratch 从 A1 重跑
六题；`5d7a80dd` A1/A2 不能拼入。A3 只有在同一次 Analysis 委派返回 output ref、child acceptance、独立 Oracle 与同 Run QA/Trace 全部通过时
才算前向修复有效。

# `abb1e38c` B1 分类排名失败与前向修复

## 不可变运行事实

- source commit：`abb1e38cff4021f0e36f6cc3c166ecdb3ada9ae1`
- scratch：`falcon24-e17-abb1e38c`，NAS 本地端口 `55513`，live authority 仍为 E16。
- A1/A2/A3 在同一 build/scratch 中各一次 composer，独立 Oracle、业务复核、QA/Trace 与刷新均 PASS。
- B1 唯一 Run `1b7b5940-38be-839a-9ed7-fc50eb64de56` 为 `FAILED`，未重提。Semantic、Text2SQL、
  QueryEvidence 和渠道柱图均已形成；Analysis stage 被 FULL Oracle 以
  `CATEGORY_COMPARISON_ORACLE_RESULT_MISMATCH` 拒绝，因此没有 AnalysisReport 或最终答案。

## 精确差异

QueryEvidence 的四个渠道及投入、收入、ROAS 数值正确。模型发布的三个 `highest` 集合成员也正确，但其中两个数组没有按合同降序：

- 投入应为 `App, Social Media, SMS`，模型发布为 `App, SMS, Social Media`；
- 收入应为 `Email, App, Social Media`，模型发布为 `App, Email, Social Media`。

Oracle 按原 QueryEvidence 行独立重算，故拒绝是正确行为；不能放宽为集合相等、修改旧 Run 或重提同一 Run。

## 前向修复边界

`published-category-multi-measure-comparison@1` 增加无数据 `preparation_reference`。它只编码：

1. 原列、原行序和完整分类 tuple；
2. NULL 与 JSON-native 有限数值转换；
3. 每个 measure 的观测/缺失计数、极值；
4. `lowest` 按值升序、`highest` 按值降序，同值按原零基行号。

Agent 仍复制参考函数到实际 `python_cell` 并提交真实源码；Host 不执行参考、不替换输出、不修补成员或数值，Sandbox、Publisher、
FULL Oracle 与原单次修复预算均不变。配置只携带来源列名、分类列名和 measure 字段映射，不含任何行、渠道名或预计算答案。

## 组件验证与下一证明

- category planner/oracle focused：55/55 PASS；
- Worker typecheck/build、owned Biome、`git diff --check` PASS；
- bundled Python+pandas 以本次四渠道数值执行参考函数，两个 `highest` 序列与独立期望完全一致，原 observations 不变。

上述只是组件证明。提交后必须重新 clean force build、fresh 物理 scratch，并从 A1 重跑 A1-A3/B1-B3；不得拼接本 build 的 A 组三题。

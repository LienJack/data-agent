# Bug Analysis: 自动SQL图丢失分组身份

## 1. Root Cause Category

B/C/D：正确的完整分群 QueryEvidence 被原自动V2图投影成只有月份和数值的表，分类列丢失。
d9c3c7e3 A2 Run da603c94-3b9a-8ff7-abd7-83de7f8cc586 SUCCEEDED/61events：
Semantic→Text2SQL→Analysis均产出，48行独立来源Oracle通过，原Stage13d7399e-55fe-5a73-826f-3620b258b7f5
的结果/表/图bytes和hash已验；全部结构化Python结果与原算法重算0差异。
正确Analysis图1422cc2a-7ce6-5605-ab07-2bb7eac0dd57保留series_key=category和48行，
但额外SQL图8881b8a7-7327-8651-8773-1cfa51141724的48行只有12个x、无series且丢category。
该Run整体业务FAIL，未进入UI验收/A3，不能拿数值通过掩盖错误图。

## 2. Why Fixes Failed

- 先验假设模型改动TABLE/LINE，但源码证明即使presentation为TABLE/NONE，Host也会自动选图。
- 原V2投影无category/series身份却未检查重复x；因此模型提示完整面板和正确V3分析图都未覆盖附加路径。
- 本次不改Semantic/SQL候选/方法/Oracle，也不继续加模型提示；直接保护共用确定性投影。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Shape guard | 三种intent的V2自动图遇重复x返回null，保留完整QueryEvidence | DONE |
| P0 | No fake aggregation | 不去重、填零、聚合、复合列或更改旧图，Analysis仍用原series合同 | DONE |
| P0 | Regression | 月×分类三个intent先RED，唯一x/多measure/NULL兼容 | DONE |
| P0 | Real acceptance | 新build/scratch重新证明A/B；旧通过项不可拼接 | PENDING |

## 4. Systematic Expansion

该边界对任何重复横轴都适用，不按题目、指标或数据集分支；需要分群时交已有V3能力，不新增渲染权威。
调用者原已处理null并保留QueryEvidence；null不能声称完成用户图表要求。旧唯一x图仍生成原字节和hash。
本次源348表无漂移、临时服务和浏览器已关闭，专用容器停机但卷与证据保留，未写live authority。

## 5. Knowledge Capture

更新governed-analysis-charts和implement；本仓库无src/templates/markdown/spec，不另建模板树。
原证据：complex-d9c3c7e3/turn-02的terminal-observation、oracle-grouped-yoy、stage-evidence、business-review。
运行SUCCEEDED不等于所有附加图正确；验收需检查每个可见图的来源维度身份而不只检查数字相等。
三个intent回归先RED后GREEN；真实48行原QueryEvidence的离线投影均返回null，原证据未改、无模型/DB写入。
Platform类型检查、Worker生产Team Tools 90项、Biome/Trellis/diff通过；离线收据d9c3c7e3-group-chart-probe.json。

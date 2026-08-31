# E17 复杂能力前置审计

日期：2026-08-31。观察构建 `cc9ff33eff80f35792e84cddef2c832d4768847a`。

## 已有证据与边界

五项基础scratch回归均通过，详见 implement 的对应 Run/审计目录。生产live仍为E16 FAILED，未激活E17。
成功只覆盖语义、10行明细、12月同比、全量渠道ROAS/净ROI；没有正式评分、复杂Analysis或跨Run通过证据。
本轮服务/browser/vault关闭，物理副本和完整证据保留；不消费额外模型调用来复现已知代码限制。

## 代码确认的限制

1. `apps/worker/src/analysis/production-governed-analysis-runtime.ts`：唯一生产composition的 methodRegistry
   无条件调用 compileSingleSeriesAnalysisPlan，只返回 published-single-series-trend；oracle固定createSingleSeriesAnalysisOracle。
2. `single-series-analysis-planning.ts`：输入要求12行/2列、一个MONTH Dimension、一个NUMBER Metric；Context必须恰好1 Metric。
   因而渠道×人群、多指标与同比4列不能直接进入该方法。现有模型编排、Sandbox、原子publisher是可复用执行链，不是缺失服务。
3. `postgresql-query-evidence-semantic-binding.ts` 与 `postgresql-request-derivation.ts`：ratio拒绝任何current window/WHERE/
   时间Dimension；当前全量净ROI的成功不覆盖按月比较。后续只允许 exact accepted current window，不能放开任意过滤。

## 实施顺序与可验证切片

1. 复用原请求比例证明，补同物理时间列/双指标coverage、精确上下界、MONTH bucket与已有分类维度；不新增解释算子或发布对象。
2. 按真实输入形态及原发布analysis capabilities补方法注册/ResultContract/独立oracle。禁止按case ID、关键词或答案挑选路径，
   禁止把request-derived结果当成新的Published Metric授予方法权限。已有单序列方法不能退化为无校验兜底。
3. 核查复杂多表输入、分群比较、跨Run指代和报告图表组合。当前只标记待验证，不把可能可执行的路径认定为已通过。
4. 聚焦验证和分项commit后，再做最终同构建fresh scratch/正式15题。任何旧PASS不拼入新build。

## 第一个小项的预定反例

缺少/删掉时间窗；声明与WHERE参数错位；改变边界、时区或一侧coverage；未选/未发布时间Dimension；错物理时间列；
月桶变day、text time未经timestamp cast；额外WHERE/OR/HAVING/隐藏group；整数截断；原指标/Formula重标派生结果。

本记录是能力审计与实施依据，不是新业务PASS或正式epoch激活授权。

## 第一个小项验证结果

- 共享resolver复用原接受Context/receipt与精确发布对象，比例输入允许其完整月份窗口；两指标都必须有非空min/max并覆盖窗口、
  同时区/时间列和Dimension权限。WHERE参数与声明逐一对应；仅原时间列月桶和分类键分组。旧全量hash/数值证明未改。
- Platform五个focused文件308/308；Worker四个focused文件136/136；双方typecheck、Platform build、9个TS文件Biome通过。
  初始新增纯SQL正例与诊断14失败、Context正例3失败；修复后通过。额外null coverage负例先失败，再以显式非空边界检查闭合。
  未发布/未选择/未请求时间Dimension均以明确binding错误拒绝；未扩大预算、候选修复次数或publisher。
- 真实只读SQL探针使用 `falcon24-e17-cc9ff33e` / 55475、事务只读，读取原全量净ROI Run
  `279c33d8-5ef4-83f8-a6e7-52de360f46c1` 的来源信息，**不修改其Context**。原Context没有时间Dimension，因此探针明确不运行完整
  Workercompile/接受链，不签发新receipt，不把原全量Run改造成带窗Run；仅以纯SQL证明和独立源数据oracle检查计算。
  得到12个月×4渠道共48行，date/text/float OID一致，窗口内源SUM、净ROI及零分母NULL规则核对PASS。
  记录：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/e17-net-roi-canary-cc9ff33e/monthly-sql-readonly-probe.json`。
  `provider_calls=0 / authority_writes=0 / artifact_commits=0 / formal_gate_pass=false`。
- 后续新Run仍必须正常取得已接受且含时间Dimension的Context；再证明全部生产路径和真实模型问答。当前不激活live E17，
  下一小项仍为生产Analysis的形状/能力驱动方法和独立oracle，旧五项canary仅保留历史证据。

## 第二个小项：重复Metric的精确直接投影

`buildGovernedResultProjections` 原先仅按role/object_id定位输入：本期与同期共享Metric时必然二义，不能靠“第一列”修复。
在原ResultContract@2的column mapping加入可选显式source，进入相同hash并受DIRECT physical lineage校验；Worker额外精确匹配
input/output而不删除role/ID证明。真实Arrow fixture证明12个月、本期/同期不同值和NULL保留；错输入/列/身份/角色/类型/NULL，
重复输入、跨输入拼表、Arrow篡改及无source二义性均拒绝。Contracts41/41、Worker71/71、两包typecheck/build通过。

本小项没有生产方法注册、候选预算或发布器变更。后续仍须解决FORMULA/REQUEST_DERIVED输出角色闭包、通用有界方法与独立oracle；
全量Analysis的非空Brief时间窗约束和跨Run组合仍未完成。当前只读工程审计不能记为这些业务能力通过。

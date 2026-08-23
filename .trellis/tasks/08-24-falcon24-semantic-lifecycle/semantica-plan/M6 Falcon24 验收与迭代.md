# M6 Falcon24 验收、反馈迭代与旧路径删除

## 目标

用五个真实综合问题证明生成、召回、推理、Python 分析和反馈闭环，并以删除旧路径完成唯一切换。

---

## 实现步骤

1. 发布 Falcon24 语义 Release：订单金额权威、库存双源边界、客户时序异常、公式、Join、时间窗口和分析适用性。
2. 建立五个 public/sealed Test Center cases 与独立 Oracle，固定 workspace/release/schema/model/runtime。
3. 逐题跑完整 Web Agent E2E；保存 semantic retrieval、inference、SQL、Python、Oracle 和 report artifacts。
4. 将 miss、wrong binding、closure overflow、Oracle failure 和 schema/lineage drift 转成新的 Candidate，不在线改写 Release。
5. shadow 验证候选对五题与反例集的提升，人审后发布下一 Release，验证旧 Run 仍可按旧快照重放。
6. 删除旧上下文/分析合同与全部消费者，执行架构扫描、冷暖回归和 merge-tree 预检。

---

## 代码分析

### 结构职责

- Falcon24 是端到端商业验收，不是只测 Text2SQL；每题都要求语义闭包、SQL 证据、DeepSeek Python 和确定性 Oracle。
- Feedback 只生成 Candidate，避免 Agent 用一次失败直接污染语义权威。

### 关键实现

- Q1：18 个完整月；月收入/订单量/AOV，最差 MoM；buyer × frequency × AOV 对称 Shapley 闭合，再按客户类型/品类/支付解释。
- Q2：12 个完整月，前后 6 个月；配送时效、p50/p90、低评分；控制金额/品类/客户类型/月的二项 GLM，只声明关联。
- Q3：raw inventory 主分析、inventoryNew 敏感性；高销量门槛、Theil–Sen 恶化趋势、最近 3 月对前 9 月、BH-FDR；允许“无命中+观察名单”。
- Q4：渠道/人群周粒度漏斗与投入回报；0–4 周 distributed lag、趋势/季节、HAC、FDR；只声明关联。
- Q5：最近 12 个可完整观察 M0–M6 的注册 cohort；先披露注册/订单/客户关系异常；总体结论 HOLD，并做排除异常客户但保留无订单客户的敏感性分析。

### 风险与坑点

- Falcon24 5000 笔订单几乎一单一商品，不能夸大购物篮/品类组合结论。
- 订单 total 与 item amount 大量不一致，收入需使用发布语义指定的唯一权威字段。
- Q5 的注册前订单异常会实质影响 cohort 结论，正确降级是通过条件，不是失败。

---

## 验收标准

- 五题 Oracle 5/5；每题 generated Python=1；关联问题没有升级为因果结论。
- 固定完整月窗口、统计方法、异常披露和敏感性分析均由 Oracle 逐项核验。
- 冷启动 3 次、暖启动 3 次，flake=0；权限、投影陈旧、模型失败和 sandbox 失败均有正确错误类别。
- 旧 `ResolvedContextPackage`/V3、旧 resolver、旧 `AnalysisPlan`、兼容 adapter、dead fixtures/tests 和第二入口引用为 0。
- 删除 Neo4j/向量/稀疏投影后可重建；历史 Run 仍通过冻结的 release/schema/context hashes 重放。

---

## 备注

- 最终切换提交不保留双轨 feature flag。失败时整体 revert，不回退到旧 runtime path。


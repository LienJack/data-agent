# Bug Analysis: E16 请求内同比结果绑定

## 1. Root Cause Category

- **B / D / E**：跨层契约缺口、测试缺少消费侧闭包、隐含“所有数值输出都是发布对象”的假设。
- 观察：E16 L1 五题 PASS，L2-01 六次 compile membership 拒绝；唯一 accepted SQC 明确含 PERIOD_COMPARISON_RATE。
  wire 却只有 METRIC/FORMULA/DIMENSION/PHYSICAL_COLUMN。没有发布同比对象，普通请求算子无法获得准确结果身份。
- 证据置信度：结构缺口已由代码与合成端到端只读探针证实；历史六条 SQL 未保存，具体候选是否捏造 ID 仍未知。
  PostgreSQL 结果类型与本次首因不符（尚未执行）；不能沿用 E15 的诊断。

## 2. Why Fixes Failed

1. E15 类型反馈修复仍有效，E16 最近订单已经 PASS；它不负责请求算子的输出身份。
2. 只增加 enum 会留下重标 Metric 的旁路：负例实际 RED（resolver 返回空数组），修复为 request 存在时必须 exact 派生输出。
3. 新检查最初误拒已选 Metric 的依赖 TimeDomain；真实冻结 SQC 只读探针定位后，按既有 allowed-requested closure 规则修正。
4. 探针的 UTC 月份和浮点逐位相等断言不符合既有业务 oracle：统一显式 Asia/Shanghai 月份与既定 numeric tolerance，
   未修改正式 oracle。刷新依赖构建后再复核，避免旧 dist 造成源码/运行不一致。

## 3. Prevention Mechanisms

| 优先级 | 机制 | 实施 |
| --- | --- | --- |
| P0 | 身份 | REQUEST_DERIVED + exact Context hash/interpretation；历史字段缺省时不改 hash 材料 |
| P0 | 证明 | compile/admission/acceptance 共用 bounded AST 证明，不自动生成/替换 SQL |
| P0 | 反例 | 重标 Metric、错聚合/来源/分组/窗口/偏移/分母/补零、错原始值、Context 与 OID 漂移 |
| P1 | 下游 | Analysis materialization 保留派生 role/id/source_binding_hash，不增方法权限 |
| P1 | 现场 | 零模型只读原 Context + 专用 scratch 实际12个月；随后仍需 fresh canary 与正式15题 |

## 4. Systematic Expansion

- 同类：AGGREGATE_RATIO、净 ROI 与多表派生也需要明确的消费侧表达能力，不能借用 Published Metric。
  本修复只交付单表双 CTE 月度 SUM 同比证明，其他形态保持失败关闭，未冒称全业务已闭环。
- 过程：出现新请求算子，测试必须贯穿输出 Candidate、SQL 证明、Evidence、Analysis；只测试 Semantic 选择/窗口不足。
- 运行：首次 formal FAIL 后 seal/stop，再离线修复；不通过 repeated formal runs 摸索边界，不拼接 PASS。

## 5. Knowledge Capture

- [x] 更新 backend/text2sql-resolved-context、artifact-authority 与 design §25.14。
- [x] E16 FAILED/version29，QA/Trace=null，后九题未提交；失败 receipt 与 source 保留。
- [x] 只读探针：12行、6个同期缺失、真实 OID 1114/701/701/701、独立源汇总一致、模型/权威写入/Artifact commit 均0。
- [ ] clean build/fresh scratch 月度同比、回归三题与 E17 正式四层门禁，完成后单独记录。

无 `src/templates/markdown/spec/` 模板目录可同步。本次未使用 Compound Engineering 或子代理。

# 35190953 纯定义同比遗漏

## 1. 根因分类

- **E / 隐含假设**：定义模式只选择基础发布对象也能回答完整计算问题。实际请求问同比，但已接受上下文只含收入 SUM、月份与时间域。
- Root 的持久委派 objective 明确包含 year-over-year comparison formula；不是 Root 丢失任务。
- 原 Provider schema 保留 request_scoped_operations，原生产投影有操作时会构造 REQUEST_ONLY/NONE 解释；本次上下文无该字段且无歧义。
- 未保存 Semantic 原响应正文，不能描述模型内部理由；证据只能将缺项定位到 Semantic 选择/解释边界。

## 2. 为什么已有约束不足

- 既有提示要求 derived term 使用操作，但没有纯定义模式下的完整操作格式示例；窗口说明主要面向结果查询。
- 不能通过把 Run SUCCEEDED 当作 PASS、删除同比检查或补写解释解决。原四项 rubric 中同比项真实 FAIL，attempt 已封存。
- 新例只表达已有 schema 与公式，不是新增定义、结果数据或确定性语义选择；真实模型遵循程度仍须重验。

## 3. 预防机制

| 优先级 | 机制 | 状态 |
| --- | --- | --- |
| P0 | 明确 SEMANTIC_FACTS_ONLY 不等于 primitive-only；基础 SUM 不是同比 | 已加入原 Semantic prompt |
| P0 | 原年度比较算子的无数据 JSON 示例、exact-ID 替换和不造窗口说明 | 已加入原 prompt |
| P0 | 从实际提示解析示例，通过原 Provider schema 并验证操作、模式、无窗口 | 先红后绿 |
| P0 | 原业务验证独立拒绝缺失同比；不把装配测试称为模型 PASS | 已执行 |

## 4. 扩展边界

- 不改 v9 题面、发布目录、Authority、Schema、预算、Provider retry、窗口证明、SQL 或 Oracle。
- 定义时无需实际窗口；DATA_RESULT_REQUIRED 比较仍必须使用已证明的完整窗口，不受本例豁免。
- 示例 IDs 不是可选对象，不能进入 frozen closure；未消歧的 primitive 仍返回原 ambiguity。

## 5. 记录

- 已更新 `.trellis/spec/backend/semantic-conversation-intent.md`；本仓库无对应 `src/templates/markdown/spec/`。
- 本批审计：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/formal-e17-35190953-bf6038e9/`。
- 原 Run：`0f6a960c-7613-8ac9-951d-e761e6f2dd15`；原 Semantic Artifact：`70267383-0d6d-876e-b9b7-99f559eb5d25`。
- `rubric/L1-01.json` 为真实业务 FAIL；`runtime/control-advance-1788582433805.json` 为 FAILED 回执。
- 接续必须新 clean commit/build/scratch，不修改此 Run；Node24 保持固定，HTTP/2 断流与此业务缺项是两个不同问题。

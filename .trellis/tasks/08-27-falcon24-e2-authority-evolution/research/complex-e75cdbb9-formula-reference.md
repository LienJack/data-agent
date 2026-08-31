# Bug Analysis: 发布 Formula 到 Text2SQL 的无数据语法参考

## 1. Root Cause Category

**B/D — 跨层翻译边界与覆盖缺口**。B1 Run `2ca38e98-6f77-8f1f-ba90-8de1befb2b76` 已正确选择渠道、
投入、收入和发布ROAS，Root没有再加入coverage过滤，但3个SQL task各2次候选均表达式证明失败，0查询。
原候选未持久化，不能断言具体是NULLIF、cast或别的形态；同task两候选hash相同，说明已有修复未改变候选。
实际发布AST和double precision物理列的独立无模型探针证明原CASE可通过，不需要降低校验器。

## 2. Why Fixes Failed

已有prompt包含完整AST及零值修复说明，仍未可靠完成语法翻译。继续重试或改成另一个比率口径不能闭环。
按用户允许降低重复失败题的翻译难度，这次只把已有发布AST编译成语法参考，不新增Formula或替换数据证据。
这是对交接输入的改善，尚不能宣称已解释每条历史候选的具体缺陷或已通过新业务Run。

## 3. Prevention Mechanisms

- 仅当前已接受Context明确requested的numeric/integer Formula适用；原Worker完成完整冻结权威校验后生成。
- 复用原Metric依赖物理列解析，与当前Context Metric及更窄依赖列表取交集。单表/唯一slot、引用转义、literal参数化，
  AST保留CASE/零NULL/聚合/DISTINCT/FILTER/运算顺序；过深、过大、跨表或不支持语法不猜测。
- 原发布Formula AST/物理类型/粒度证明先验证内部样例；样例不执行、不成为全查询、不输出数据。发送给模型的只有
  formula_id、物理关系/alias、表达式及有序参数。失败校验与错误码不放宽。
- 模型仍返回完整候选；必须保留其他指标、维度、分组、合法窗口和图表意图，合并参数号；原compile/execute/Oracle不变。
- Platform三套223 tests、Worker三套55 tests通过，共278项；两包typecheck及Platform build通过。
  覆盖原参数化round trip、零值漂移拒绝、字段引用/歧义/缺失/跨表、cast/粒度与目录漂移、字节预算、零target I/O，
  真实dispatcher离线初次/修复消息保留同一参考、task hash及原预算。没有真实provider调用。

## 4. Systematic Expansion

这是通用发布AST的语法投影，不按Falcon问题关键词选择SQL，不把查询规划替换为固定答案。
DATE_BUCKET/GROUP_COUNT及不唯一slot不在参考子集中；没有参考时原要求和原校验仍存在。
内部单表达式证明没有WHERE不意味着用户查询应删除时间要求。请求净ROI仍是REQUEST_DERIVED，不能借用发布ROAS身份。
现场ROAS参考通过原proof的独立探针只有syntax PASS，不计B1/B2/B3或十五题PASS。

## 5. Knowledge Capture

- 已更新Text2SQL冻结上下文规范与本任务implement；模板目录不存在。
- `complex-e75cdbb9/turn-04/{delegation-inspection,published-roas-syntax-probe,formula-reference-probe}.json`
  记录原失败、原口径有效和新无数据参考的不同证据边界。原Run不改写、不重放。
- 当前live E16仍FAILED，348表无漂移；旧scratch停机保留。下一步新clean build/fresh scratch，
  B组先验证真实公式交接，再继续独立A组和完整四层，不拼接历史PASS。

# M2 Cell 协议与 DeepSeek 工具循环

## 目标

用版本化 Cell 程序替代一次性 `main(context)`，让 DeepSeek 能按观察结果继续变换、作图和解释；失败时只修复失败 Cell，不重新生成整段统计程序。

## 实现步骤

1. 删除 `SandboxProgram@2` 的 entrypoint/source 模型，引入唯一 `AnalysisCellProgram`：cell id、依赖、代码、上下文、输入/输出声明、预算。
2. 为 DeepSeek 暴露两个受控工具：`python_cell` 和 `statistical_operator`，设置 allowlist、最大调用数和总预算。
3. 每次工具结果只返回结构化 observation：状态、stdout/stderr 摘要、变量/文件 manifest、图表候选、错误位置和恢复建议。
4. 成功 Cell 产生 checkpoint manifest；失败后从最近 sealed checkpoint 重建 context，只重放依赖闭包。
5. 将代码、工具参数、observation、重放关系和最终解释绑定到同一 run/analysis node。

## 代码分析

### 结构与职责

- DeepSeek 负责选择操作、补充普通 pandas/numpy 变换和解释，不掌管运行时或底层统计定义。
- `python_cell` 只在 agent context 运行普通 Python；`statistical_operator` 在 operator context 调用固定入口。
- Worker tool loop 负责消息续轮、工具上限、取消、去重和状态机；provider adapter 只负责模型协议。

### 关键实现

每个 Cell 必须显式引用上游 artifact 或 checkpoint，禁止依赖不可观测的宿主全局状态。状态复用是优化，不是正确性前提；给定输入 hashes、Cell DAG 和 image digest，应可在新 context 确定性重放。

机器 JSON 保留完整数值精度。DeepSeek 可以在解释和图表标签中格式化，但不能把四舍五入后的 KPI 写回 Oracle 输入；这直接避免当前 `revenue = buyers × frequency × AOV` 因展示舍入而误判。

### 风险与坑点

- 无限工具循环、重复 Cell 和大 stdout 会耗尽时间；必须有 call/cell/byte/global deadline 四重预算。
- notebook 隐式状态会导致重放漂移；checkpoint manifest 必须列出产物而不是序列化任意 Python 内存。
- 模型可能手写统计公式；静态/运行时策略应拒绝受治理算子同名实现和危险导入，而不是相信 prompt。
- repair 不能篡改已成功 operator receipt。

## 验收标准

- 至少一个多 Cell 分析在同一 context 复用状态并产出表/图。
- 注入 Cell 失败后只重做失败节点及后继，前序 sealed artifacts hash 不变。
- 达到调用/时间/输出预算时可中断并返回稳定错误码。
- DeepSeek 实际调用两类工具；统计算子结果来自 operator receipt，而不是生成代码中的公式。

## 备注

Cell 源码是可审计执行计划的一部分，但不得把模型隐藏推理或完整 provider payload 当作审计证据。


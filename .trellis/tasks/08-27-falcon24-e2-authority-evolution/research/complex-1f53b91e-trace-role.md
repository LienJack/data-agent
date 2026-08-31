# Complex L4 scratch — 1f53b91e Trace role propagation

## Observed evidence

- Clean `1f53b91eb01dc2e4998c3032b11f681ef5ce2d84`：force build8/8、full unit15/15 task、attestation PASS。
- NAS dedicated scratch `data-agent-falcon24-e17-1f53b91e` /55483，物理备份验证、348表克隆一致、9表/70列/121445行数据证明通过。
- 原认证Run `52094af9-b490-5328-9ab6-f1428825edb0` PASS，仅scratch Finalizer ACTIVE；baseline `e9cb45f0-155d-513e-8685-f28263244596`，
  hash `sha256:5fc07f5118391cda6c723ac80a5f15eb47edcbd0c5b1af8e2d0620c34d53facb`。production isolation仍HOLD。
- L4A1一次composer：Conversation `913d94d0-f1c1-464c-8267-c306c0ecd50b`，Run `d12695c0-c7cf-8146-bc96-0542768a11fd` SUCCEEDED，57 events，无错误/修复。
  Semantic r6→Text2SQL r5→Analysis r4。AnalysisCompletionReceipt READY，1次sandbox execution/3 model calls（该分析任务内，非Run总用量）。
- QueryEvidence `fa50face-fa0b-8f76-a7d7-69becce95e70` / `sha256:c50fb2bc14221889741b41ad30d3e862cf78055a924ed43ca4438283473fafcc`。
  Independent read-only source Oracle核对2023-11到2024-10共12个月、本期收入、6个有效同比；2023-05发布覆盖前的物理数据不用于同比。
  两图所有原始行/NULL、报告主要数值、缺失和币种披露均通过，无因果性或统计显著性扩张。
- QA表图和refresh PASS；英文内部任务标题/列别名仍是展示不足，未声称经营文案已打磨。
- Trace API HTTP400 `RESOLUTION_TRACE_ARTIFACT_CORRUPT`，故此完整scratch回合仍未PASS，未提交A2。
  canonical TABLE `f9c6df0f-f5d5-553a-8f4f-c9cc29113d48` 与 CHART `20996655-8876-5db9-a60e-139c96fc4cc7` 均保留真实 `yoy_rate/REQUEST_DERIVED`。
- Live348表after与before完全相等、E16 FAILED未改；本轮Web/Worker/OpenSandbox/browser/auth停止，数据库与audit保留。

## Bug Analysis: published role missing in Trace reader

### 1. Root Cause Category
- **C / B — Change Propagation Failure / Cross-Layer Contract**：Worker/Contracts的table role已包含FORMULA和REQUEST_DERIVED，
  Trace的重复枚举仍只有METRIC/DIMENSION/DERIVED/QUALITY；新合法产物在读端strict parse失败。

### 2. Why Fixes Failed
- 之前图表facet接线回归只使用METRIC列，没有跨到请求同比率列。业务/QA成功不能代表Trace可读。
- 这不是Artifact损坏或来源不合法，不能通过重新生成结果、改role、跳过hash或删除旧证据处理。

### 3. Prevention Mechanisms
| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Shared contract | Reader直接复用现有analysisResultTableSemanticRoleSchema，无新发布/写权威 | DONE |
| P0 | Regression | TABLE+CHART的REQUEST_DERIVED/FORMULA先RED后GREEN；旧METRIC和未知role拒绝 | DONE |
| P0 | Security | 原strict/schema/canonical bytes/hash/唯一Store/source校验不变，公共DTO不暴露数据 | UNCHANGED |
| P1 | Actual source | 真实READ capability +默认read-only连接，旧Run只读重建73节点与73详情 | DONE |
| P1 | Acceptance | 新冻结构建fresh链路再执行完整QA/Trace，不拼旧PASS | ACTIVE |

### 4. Systematic Expansion
- 该共享role也覆盖published FORMULA及后续净ROI REQUEST_DERIVED；禁止在reader复制子集enum。
- 只读修复诊断明确dirty source/旧Run，不等于同构建业务或UI acceptance，不能回写历史失败。

### 5. Knowledge Capture
- [x] resolution-trace.md与implement checkpoint同步。模板目录不存在，不另建重复文档。
- [x] focused Platform Trace和Worker月度/Oracle/Runtime4文件127/127；Platform typecheck/build、2文件Biome通过。
- [x] Web/Worker typecheck通过；Web测试须从包配置运行（仓库根首次误包含standalone副本且缺@别名，不是产品失败），改为包级运行后Web17/17、Contracts14/14。Trellis validate与diff检查通过。
- 真实只读修复诊断：trace hash `sha256:6bcf77281414b0f52906503ed8491e08ce3449cd92e95d3a49f69ecd2f21cbb8`，nodes/details73/73，provider calls0，authority writes0。

完整证据：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-1f53b91e/turn-01/`，
包括original UI failure、business-review、oracle-yoy、qa与trace-code-fix-readback；全部未覆盖原记录。

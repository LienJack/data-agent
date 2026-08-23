# M2 受治理召回门禁证据

## 结论

**NO-GO：继续保持 M2 暂缓，不实现 governed retrieval。**

这不是对受治理检索价值的否定，而是当前没有一份 M1 之后、可归因的固定回放能证明显式词汇解析仍存在显著且只能由知识/关系检索解决的缺口。此时加入新的召回链路会扩大运行时、端口与验收面，却无法证明准确性收益。

## 已审计证据

### M1 确定性测试

`packages/semantic/test/context-router.spec.ts` 已覆盖 Published Release 上的首选词、同义词、缩写、冲突消歧与 exact negative。它证明 M1 的确定性规则按设计工作，但不是生产问题分布，不能提供 unresolved 或 clarification 的总体发生率。

### Falcon release gate

审计对象：`artifacts/falcon-agent-gate/falcon-agent-release-gate.json` 及同目录 16 份 JSON。

- artifact source commit：`8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5`
- dataset version：`falcon-fixed-8ff29caa-postgres-v1`
- completed at：`2026-08-17T23:31:14.524Z`
- overall result：`GO`
- stability：54/54，0 flake
- holdout：4/5
- semantic usage：500/500
- taint/infrastructure failure：0/0

M1 的提交是 `c7d71f28321c43b0e1fa946d8c4d6f4dd42f7b3c`，时间为 `2026-08-23T13:51:28+08:00`。因此这份 Falcon artifact 早于 M1，不能作为 M1 后基线。

对 16 份 JSON 的标量字段路径扫描没有发现 `route`、`lexical`、`clarification`、`unresolved` 或 `reason_code` 字段。现有聚合结果能证明当时的整体执行稳定性和安全计数，不能回答：

- 有多少问题在 M1 后仍未解析；
- 有多少澄清来自真正歧义，而不是缺词；
- 失败中有多少可通过补充 Published Lexicon 修复；
- 有多少只能由受治理知识/关系检索修复；
- 新召回是否会损害精确命中、消歧或 release 隔离。

## 门禁判定

当前关键量均不可计算：

| 指标 | 当前值 | 判定影响 |
| --- | --- | --- |
| M1 后固定回放总数 | 不可得 | 缺少比较分母 |
| unresolved 数量/比例 | 不可得 | 无法证明缺口显著 |
| clarification 数量/比例 | 不可得 | 无法区分正确消歧与召回失败 |
| retrieval-resolvable 数量/比例 | 不可得 | 无法证明新增检索的因果收益 |
| exact/ambiguity 非回归 | 不可得 | 无法证明不会降低准确性 |

所以不创建 `governed-retrieval.ts`，不扩展 application port，不引入 vector/knowledge provider，也不改变当前 `KNOWLEDGE_RETRIEVAL_DEFERRED` 与 `GRAPH_TRAVERSAL_DEFERRED` 行为。

## 重新进入 M2 的条件

只有同时具备以下证据，才允许重新评审 GO：

1. 固定、版本化且人工标注的 replay corpus，绑定 M1 之后的 exact source commit、workspace 与 Published Release digest。
2. 每个 case 记录 `case_id`、question hash、安全的 expected/actual route、词法证据类别、clarification reason 和人工根因标签；不得保存 raw rows、SQL、DSN、prompt 或 provider payload。
3. 同一 corpus 上的 lexical-only baseline 与 retrieval candidate 对照，报告 READY、NEEDS_CLARIFICATION、PARTIAL、REJECTED 的转移矩阵。
4. 根因标签至少区分 `LEXICON_FIXABLE`、`TRUE_AMBIGUITY`、`RETRIEVAL_NEEDED`、`OUT_OF_SCOPE` 和 `POLICY_BLOCKED`，且经过人工抽样复核。
5. 评审者先批准“显著缺口”和“可接受提升”的量化阈值；本次不虚构未经批准的百分比。
6. candidate 必须证明 exact hit、真实歧义、ACL/egress、跨 workspace/release 隔离、容量上限、超时与 digest mismatch 全部非回归。
7. 非确定性候选仍不能独立把 REJECTED/NEEDS_CLARIFICATION 提升为 READY，图读取必须绑定 exact release/checkpoint/digest。

满足这些条件后，M2 仍应从最小的 bounded relationship read 开始；只有证据证明需要时才扩大到 knowledge/vector retrieval。

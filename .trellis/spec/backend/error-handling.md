# 后端错误与终态

> 错误必须可序列化、可重放、可归因，不能用异常文本替代公开契约。
>
> U6 Research Stop/Readiness/Revocation 条款状态：
> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED`；当前公开 Terminal 枚举已存在，但非
> READY 终态的领域 Receipt Owner 与 current-ready 仍待 U6 实现。

## 场景：边界调用失败或 Run 进入公开终态

### 1. 范围 / 触发条件

- API、Worker、Port、Compiler、Sandbox、Eval 返回失败时适用。
- 公开 Run Terminal 与 Release Decision 必须使用稳定 Reason Code。

### 2. 签名

```ts
type ContractError = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: ContractError };
```

### 3. 契约

- Public Terminal 固定为 `READY | PARTIAL | NEEDS_CLARIFICATION | NEEDS_MORE_RESEARCH | INCONCLUSIVE | POLICY_BLOCKED | FAILED | CANCELLED | STALE | REPLAY_UNAVAILABLE`。
- Release Decision 固定为 `GO | HOLD | NO_GO | ROLLBACK`。
- 边界层先把 `unknown` 解析为 Zod Schema，再进入领域函数。
- 内部异常可保留 Cause，但 API、Event 与 Receipt 只暴露白名单字段。
- `GO` 必须引用完整 Evidence；缺失证据只能是 `HOLD`。
- U6 的终态不能由一个通用 Release/Research Gate 包办。`READY` 只能由
  `consumeCurrentReady` 在原子核验 current Certificate 后提交；
  `PARTIAL/NEEDS_MORE_RESEARCH/INCONCLUSIVE` 只能消费对应
  `ResearchStopDecision`；`STALE` 只能消费 `ReadinessRevocationReceipt`。
  `NEEDS_CLARIFICATION/POLICY_BLOCKED/FAILED/CANCELLED/REPLAY_UNAVAILABLE` 继续由
  Brief/Semantic、Policy、Runtime 或 Sandbox 的既有 Authority 提交。
- `STOP_READY` 不是 Public Terminal；`STOP_FAILED` 与 `STOP_STALE` 不存在。报告投影
  绕过或运行故障归 Runtime `FAILED`，Version Frontier 漂移归 Revocation `STALE`。
- Stop 输入含 `STALE` Obligation 或 Frontier 已漂移时固定返回
  `RESEARCH_STOP_INPUT_STALE`，不创建 StopDecision/Public Terminal；不得借
  PARTIAL/INCONCLUSIVE 抢占 Revocation Owner。
- `STOP_PARTIAL` 只能表示“硬预算封顶且存在可披露的受支持子集”；存在恢复路径但等待
  新预算/权限时使用 `NEEDS_MORE_RESEARCH`，不存在 admissible distinguishing test
  时使用 `INCONCLUSIVE`。无法命中互斥分支时返回
  `RESEARCH_STOP_INPUT_INCONSISTENT`，不能静默降级为 Partial。

### 4. 校验与错误矩阵

`RunTerminal.reason_code` 继续使用现有固定一一映射，例如
`PARTIAL=EVIDENCE_PARTIAL`、`STALE=RUN_STALE`、`FAILED=INTERNAL_EXECUTION_FAILED`。
下表中的细粒度 U6 Reason Code 保存在 `ResearchStopDecision`、
`EvidenceGateReceipt`、Projection/Revocation Receipt 或 Authority Error 中，不直接
替换公共 Terminal Reason Code。

| 条件 | 稳定结果 |
| --- | --- |
| 未知 Terminal/Reason Code | Schema Parse 失败 |
| 语义歧义 | `NEEDS_CLARIFICATION` |
| 证据不足 | `PARTIAL` 或 `NEEDS_MORE_RESEARCH` |
| SQL 成功但 Obligation 语义漂移 | `OBLIGATION_QUERY_SEMANTICS_MISMATCH`，不能 Ready |
| 未解决 material conflict | 对应 Coverage `FAILED`，不能 `STOP_READY` |
| Citation 仅相关或上下文 | `EVIDENCE_SUPPORT_INSUFFICIENT` |
| 硬预算封顶且存在可交付子集 | `PARTIAL / BUDGET_EXHAUSTED_WITH_OPEN_CRITICAL_OBLIGATION` |
| 存在合法恢复路径但等待预算/权限 | `NEEDS_MORE_RESEARCH / EVIDENCE_COVERAGE_INSUFFICIENT` |
| 无 admissible distinguishing test | `INCONCLUSIVE / ANALYSIS_INCONCLUSIVE` |
| Writer 新增无支持事实或因果措辞 | `FAILED / REPORT_PROJECTION_AUTHORITY_INVALID` |
| Certificate/领域 Hash 篡改 | 无 Public Terminal；`REPORT_READY_CERTIFICATE_TAMPERED` 或 `CERTIFICATE_SEMANTIC_HASH_MISMATCH` |
| current-ready 序列化点前撤权胜出 | `STALE / READINESS_REVOKED_DURING_CONSUMPTION` |
| Stop 输入含 STALE 或 Frontier 已漂移 | `RESEARCH_STOP_INPUT_STALE`，无 StopDecision/Public Terminal |
| V1 Certificate 尝试授权 current-ready | `READINESS_PROTOCOL_VERSION_UNSUPPORTED` |
| 通用 Terminal 入口收到 PARTIAL/NEEDS_MORE_RESEARCH/INCONCLUSIVE | `RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED` |
| 通用 Terminal 入口收到 READY/STALE | `CURRENT_READY_CONSUMPTION_REQUIRED` |
| GO 缺同 Certificate 的 READY/RUN_READY Terminal | `RESEARCH_READY_TERMINAL_REQUIRED` |
| Research 结构、Token、Cost 或并发超限 | `RESEARCH_RESOURCE_LIMIT_EXCEEDED` |
| 权限/隔离不确定 | `POLICY_BLOCKED` |
| 快照不可重放 | `REPLAY_UNAVAILABLE` |
| 发布证据缺失 | `HOLD` |
| 安全门禁失败 | `NO_GO` |

### 5. Good / Base / Bad

- Good：保存 Reason Code、Artifact Reference、Attempt 与可重试标记。
- Base：叶子纯函数返回 `Result<T>`，编排层决定重试。
- Bad：捕获所有异常后返回 HTTP 200 和 `"success": false`。

### 6. 必需测试

- 每个公开 Terminal 与 Decision 做 JSON Round-Trip。
- 未知字段、未知状态、Reason Code/Terminal 错配必须失败关闭。
- Retry Test 证明重试不会重复提交权威 Revision。
- Secret Redaction Test 证明 Cause 不进入公开载荷。

### 7. Wrong vs Correct

#### Wrong

```ts
try {
  await execute();
} catch {
  return { status: "FAILED", reason: "something went wrong" };
}
```

#### Correct

```ts
return {
  ok: false,
  error: {
    code: "REPLAY_SNAPSHOT_UNAVAILABLE",
    message: "数据源没有可重放快照。",
    retryable: false,
  },
};
```

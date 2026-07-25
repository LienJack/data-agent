# 后端错误与终态

> 错误必须可序列化、可重放、可归因，不能用异常文本替代公开契约。

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

### 4. 校验与错误矩阵

| 条件 | 稳定结果 |
| --- | --- |
| 未知 Terminal/Reason Code | Schema Parse 失败 |
| 语义歧义 | `NEEDS_CLARIFICATION` |
| 证据不足 | `PARTIAL` 或 `NEEDS_MORE_RESEARCH` |
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

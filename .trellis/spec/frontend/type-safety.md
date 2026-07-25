# 前端类型安全

> Web 使用与 Worker/API 相同的 Run Projection 和 Artifact Contract，不在组件中重新解释状态。

## 场景：读取 Run、Artifact、Evidence 或 Eval 数据

### 1. 范围 / 触发条件

- Server Action、Route Handler、SSE、React Component 接收跨边界数据时适用。
- U1 只建立 Contract；U8 才实现页面和交互。

### 2. 签名

```ts
type ProjectionDecoder<T> = {
  parse(input: unknown): T;
};

type ViewState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; code: string }
  | { kind: "partial"; projection: RunProjection }
  | { kind: "stale"; projection: RunProjection }
  | { kind: "permission-denied" }
  | { kind: "success"; projection: RunProjection };
```

### 3. 契约

- Public DTO 与 Decoder 来自 `@data-agent/contracts`。
- 组件只接收已解析对象，不读取原始 JSON。
- Terminal、Release Decision、View State 使用判别联合并穷尽处理。
- SSE 恢复游标来自 PostgreSQL Projection Version，不自造客户端序号。
- L3–L5 统一显示“未交付”，不能映射为 Loading 或 Coming Soon Success。

### 4. 校验与错误矩阵

| 输入 | UI 结果 |
| --- | --- |
| DTO Schema 不匹配 | Error Boundary + 稳定错误码 |
| `PARTIAL` | Partial，不使用成功样式 |
| `HOLD` | 展示缺失证据，不显示发布成功 |
| `STALE` | Stale + 可执行恢复动作 |
| 无对象级权限 | Permission Denied，不泄露对象存在性 |
| L3–L5 Descriptor | “未交付”，无执行按钮 |

### 5. Good / Base / Bad

- Good：Server 边界解析后把判别联合传给组件。
- Base：组件通过 `switch` 穷尽所有状态。
- Bad：组件对 `(payload as any).status` 做本地字符串比较。

### 6. 必需测试

- DTO Parse 与未知字段失败测试。
- 所有 Public Terminal 和 View State 渲染测试。
- SSE 断线、缺口恢复和重复事件测试。
- L3–L5 无 Route、无按钮、无成功文案测试。

### 7. Wrong vs Correct

#### Wrong

```tsx
return payload.status === "READY" ? <Success /> : <Success />;
```

#### Correct

```tsx
switch (state.kind) {
  case "success":
    return <Success projection={state.projection} />;
  case "partial":
    return <Partial projection={state.projection} />;
  default:
    return <NonSuccessState state={state} />;
}
```

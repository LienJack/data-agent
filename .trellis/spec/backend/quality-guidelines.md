# 后端质量规范

> 质量门禁优先证明契约和失败关闭行为，而不是只证明代码可以运行。

## 场景：新增或修改行为承载代码

### 1. 范围 / 触发条件

- 修改 Public Contract、领域状态、Port、Adapter、Worker 或安全边界时适用。
- 纯格式与生成文件可不做 Test-First，但必须记录替代验证。

### 2. 签名与工具

```text
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
```

- TypeScript 开启 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`。
- 运行时边界使用 Zod 4 `strictObject`，拒绝未知字段。
- 测试使用 Vitest；测试文件命名 `*.spec.ts`。

### 3. 契约

- 行为变更默认先写失败测试或 Characterization。
- 禁止 `any`、无依据的类型断言和跨层复制 Schema。
- Agent/Model 输出始终作为 `unknown` 解析，不能直接提交权威状态。
- ID、Hash、Version、Scope 都是强校验值，不用普通非空字符串代替。
- L3–L5 只能导出 Contract-Only Descriptor。

### 4. 校验与错误矩阵

| 违规 | 门禁 |
| --- | --- |
| 格式、Lint 或未使用代码 | `pnpm lint` 失败 |
| 隐式 `any`、不完整分支、可空值误用 | `pnpm typecheck` 失败 |
| Contract 未覆盖 Happy/Edge/Error | Unit/Contract Review 失败 |
| Adapter 行为漂移 | Port Conformance 失败 |
| 框架依赖进入领域 Package | Architecture Test 失败 |

### 5. Good / Base / Bad

- Good：测试先观察预期失败，再实现最小行为。
- Base：新增叶子 Schema 同时包含 Parse 成功和失败关闭测试。
- Bad：用 `as SomeType` 把外部 JSON 直接交给领域逻辑。

### 6. 必需测试

- Happy Path、边界值、错误路径；跨层行为再加真实对象 Integration。
- 状态机、Terminal、Decision 使用 Exhaustive Test。
- 持久化 Side Effect 测试失败清理、幂等和 Fence。
- 安全相关输入必须有恶意 Fixture。

### 7. Wrong vs Correct

#### Wrong

```ts
const event = JSON.parse(raw) as RunEvent;
```

#### Correct

```ts
const parsed = runEventSchema.safeParse(JSON.parse(raw));
if (!parsed.success) {
  return contractFailure("INVALID_RUN_EVENT", parsed.error);
}
```

### 新增 Eval 包（`packages/evals`）

**模式**：Eval 评测系统使用 Adapter 接口 + Runner 组合模式：

```typescript
// Adapter 负责运行单个 EvalCase
interface EvalAdapter {
  readonly suite: BenchmarkSuite;       // insightbench | dab | rcaeval | controlled-attribution
  readonly suite_version: string;
  readonly oracle_type: string;
  run(evalCase: AuthoritativeEvalCase, context: EvalAdapterContext): Promise<EvalAdapterResult>;
  oracle(evalRun: AuthoritativeEvalRun, context: EvalAdapterContext): Promise<AuthoritativeOracleVerdictReceipt>;
}

// Runner 组合 Adapter + Oracle + ManifestReplay + PairedComparison + Safety
class EvalRunner {
  async runSingle(evalCase): Promise<EvalRunResult>;
  async runPaired(baseline, candidate): Promise<{ baseline, candidate, comparison }>;
}
```

**新增 Eval 门禁脚本**：在 `scripts/` 下创建独立脚本，不使用 `pending-gate.ts` 占位符。
脚本应输出结构化 JSON（含 `gate`, `release_decision`, `implemented_units`, `missing_units`），
`HOLD` 时以非零退出码退出。

**新增 Eval 合约类型**：在 `packages/contracts/src/evals/` 下定义 schema/hash/reference/authority，
并注册到 `packages/contracts/src/artifacts/types.ts` 的 `SYSTEM_ARTIFACT_TYPES`。

**关键规则**：
- `EvalReleaseDecision` 使用 `scoreCardReference()` 函数获取 `ScoreCard` 的 `ArtifactReference`，不直接访问 `scorecard_ref` 属性（该属性属于 `EvalReleaseDecision` 本身，不属于 `ScoreCard`）。
- `BenchmarkManifest` 使用 `artifactReferenceFor("EvalCase")` 引用其所属 Case。
- 所有新类型必须先通过 `pnpm --filter @data-agent/contracts build` 生成 `dist/*.d.ts`，依赖包才能引用。
- `eval:smoke` 脚本在 `package.json` 中指向 `scripts/eval-smoke.ts`。

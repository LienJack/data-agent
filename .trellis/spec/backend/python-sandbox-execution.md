# Python Sandbox 执行规范

> 状态：`IMPLEMENTED / HOLD`。独立 CPython runtime、严格 IPC、锁定依赖和真实 hardened-container smoke 已落地；取消协议、完整资源/恶意容器回归、Worker server-owned tool 与端到端 Artifact/Oracle 链完成前不得标记为 `READY`。

## 场景：执行模型生成的 Python 数据分析源码

### 1. 范围 / 触发条件

- 当 Agent 需要在 SQL 结果 Artifact 上执行 Python 数据处理、统计、可视化或报告生成时适用。
- Node.js 继续拥有 Web、Worker、Run 调度和 Effect Authority；任意 Python 源码只能进入独立 `python-sandbox` 服务，不能在 Web、Worker、迁移、SQL Executor 或宿主进程中执行。
- `python-sandbox` 是执行基础设施，不是数据库服务；不得持有 PostgreSQL、平台、对象存储或云凭证，也不得直接查询数据源。

### 2. 签名

```ts
type PythonExecutionFailureCode =
  | "PYTHON_POLICY_REJECTED"
  | "PYTHON_TIMEOUT"
  | "PYTHON_RESOURCE_LIMIT"
  | "PYTHON_CANCELLED"
  | "PYTHON_ERROR"
  | "PYTHON_OUTPUT_INVALID"
  | "PYTHON_SANDBOX_UNAVAILABLE";

interface PythonExecutionRequestV1 {
  schema_version: "1.0.0";
  workspace_id: string;
  run_id: string;
  attempt: 0 | 1;
  fence_token: string;
  idempotency_key: string;
  source_ref: ArtifactReference;
  source_sha256: string;
  entrypoint: "main";
  input_refs: readonly ArtifactReference[];
  output_contract: PythonOutputContractV1;
  runtime_digest: string;
  dependency_lock_digest: string;
  policy_version: string;
  budgets: PythonExecutionBudgetsV1;
}

interface PythonSandboxReceiptV1 {
  schema_version: "1.0.0";
  request_hash: string;
  sandbox_image_digest: string;
  python_version: string;
  sdk_version: string;
  dependency_lock_digest: string;
  policy_version: string;
  started_at: string;
  finished_at: string;
  elapsed_ms: number;
  observed_resources: PythonObservedResourcesV1;
  hard_controls: {
    network_isolated: boolean;
    filesystem_isolated: boolean;
    memory_limit_enforced: boolean;
    cpu_limit_enforced: boolean;
    pid_limit_enforced: boolean;
  };
  status: "SUCCEEDED" | "FAILED" | "CANCELLED";
  failure_code: PythonExecutionFailureCode | null;
  output_refs: readonly ArtifactReference[];
  stdout_ref: ArtifactReference | null;
  stderr_ref: ArtifactReference | null;
}

executePython(
  request: PythonExecutionRequestV1,
  authority: PythonSandboxAuthorityContext,
): Promise<PythonSandboxReceiptV1>;
```

### 3. 契约

- Runtime 固定 CPython 3.12；首版镜像只包含锁版本的 `pandas`、`numpy`、`scipy`、`matplotlib`、`pyarrow` 和 `data_agent_sandbox_sdk`。新增库必须更新 lock digest、镜像 digest、Policy 与安全回归。
- Worker 只提交已授权、内容寻址的 Python source 与 Arrow/CSV/JSON 输入 Artifact。Sandbox 不接受 SQL、DSN、SecretRef、宿主路径或任意 URL。
- 入口固定为 `def main(context): ...`；`context` 只暴露只读输入与声明式输出方法，不暴露文件描述符、数据库连接、网络、进程、包安装或动态模块加载能力。
- 每个请求启动新的 `python -I` 子进程和新的 job tmpfs；`/input` 只读，`/output` 仅允许声明的文件名和类型。结束后销毁进程、目录、import/global/module 状态。
- 输入禁止 `pickle`、`marshal`、可执行 Notebook 和任意对象反序列化。输出只允许 canonical Arrow/CSV/JSON、净化 Markdown、Vega-Lite JSON 与 PNG；禁止可执行 HTML/SVG、Python object、archive 和未声明文件。
- AST/import allowlist 是纵深防御，不是安全边界。主边界是独立 OS 身份、无网络 namespace、只读根文件系统、无宿主项目/数据/Secret 挂载、executor 无权访问的专用 IPC socket、capability drop、`no-new-privileges`、seccomp/AppArmor、cgroup 与 `rlimit`。
- v1 每个 Sandbox replica 同时只执行一个请求；因此 replica cgroup 必须等于单次执行硬上限。超时、取消、超限或崩溃必须 kill 完整进程组并丢弃部分输出。
- stdout/stderr 必须分别脱敏和截断，不得混入成功 Artifact。只有 `SUCCEEDED`、全部 hard controls 为 true、输出契约通过且 Fence 仍有效时，Artifact Authority 才能提交 `output_refs`。
- 相同 request hash 的重放只能复用已授权的不可变 Effect Receipt；同 idempotency key 不同 request hash 必须失败关闭。
- 环境键由服务端配置，Agent/浏览器不得覆盖：
  - `PYTHON_SANDBOX_ENABLED`
  - `PYTHON_SANDBOX_SOCKET_PATH`
  - `PYTHON_SANDBOX_IMAGE_DIGEST`
  - `PYTHON_SANDBOX_POLICY_VERSION`
  - `PYTHON_SANDBOX_MAX_WALL_MS`
  - `PYTHON_SANDBOX_MAX_CPU_SECONDS`
  - `PYTHON_SANDBOX_MAX_MEMORY_BYTES`
  - `PYTHON_SANDBOX_MAX_INPUT_BYTES`
  - `PYTHON_SANDBOX_MAX_OUTPUT_BYTES`
  - `PYTHON_SANDBOX_MAX_PIDS`
  - `PYTHON_SANDBOX_MAX_OPEN_FILES`

### 4. 校验与错误矩阵

| 条件 | 稳定结果 |
| --- | --- |
| Source/Input 未提交、跨 Workspace/Run 或 Hash 不符 | `PYTHON_POLICY_REJECTED`，不启动进程 |
| Runtime/依赖锁/Policy 与服务端配置不匹配 | `PYTHON_POLICY_REJECTED` |
| import 越权、动态代码、`pickle`/`marshal`、路径逃逸 | `PYTHON_POLICY_REJECTED` |
| wall/CPU 超时 | `PYTHON_TIMEOUT`，kill 进程组，零输出提交 |
| 内存/PID/文件/输入输出预算超限 | `PYTHON_RESOURCE_LIMIT`，零输出提交 |
| Fence 失效或用户取消 | `PYTHON_CANCELLED`，零输出提交 |
| Python 非零退出或未捕获异常 | `PYTHON_ERROR`，stderr 受限回执 |
| 输出类型、路径、schema 或摘要不符合声明 | `PYTHON_OUTPUT_INVALID` |
| IPC/服务/硬隔离证据不可用 | `PYTHON_SANDBOX_UNAVAILABLE`，Readiness=`HOLD` |
| 同幂等键携带不同 Request Hash | 冲突失败，不执行第二个 Effect |

### 5. Good / Base / Bad Cases

- Good：Worker 先用只读 SQL 产生 Arrow Artifact，再提交只引用该 Artifact 的 pandas 分析源码；Sandbox 返回绑定 Runtime/Policy/资源证据的成功 Receipt。
- Base：题目只需 SQL 时不调用 Python；题目需要简单后处理时仍走同一 Python 协议，不增加内存旁路。
- Bad：把 DSN 注入 Python、允许模型执行 `pip install`、在 Worker 里 `spawn("python")`，或只靠 AST/import 白名单宣称安全。

### 6. 必需测试

- Contract：unknown 字段、跨 Scope Reference、Hash/Runtime/Policy/依赖锁漂移、同键异载荷全部在启动进程前失败。
- Unit：AST/import allowlist、输入输出 manifest、规范化摘要、错误码和 stdout/stderr 截断。
- Container security：真实无网络、只读 root、无 Secret/env/host path、executor 无法访问 IPC、无 subprocess/socket/native load、PID/CPU/memory/file 限制。
- Malicious fixtures：`os.environ`、`/etc/passwd`/宿主路径、socket、subprocess、multiprocessing、`ctypes`、动态 import、`eval/exec/compile`、path traversal、`pickle`/`marshal`、fork bomb 和 IPC 探测。
- Lifecycle：timeout/cancel/crash 后无部分 Artifact；下一次运行没有文件、module/global/random 状态残留。
- Authority：成功 Receipt 必须绑定 Workspace/Run/Attempt/Fence、source/input/output、Runtime、Policy 与真实资源证据；任一换绑不能提交 Artifact/ScoreCard。
- E2E：真实 PostgreSQL → Worker → Python Sandbox → Artifact → deterministic Oracle → ScoreCard，并单独报告 Python Sandbox health。

### 7. Wrong vs Correct

#### Wrong

```ts
// Worker 直接执行模型源码，同时继承数据库和应用环境。
await spawn("python", [sourcePath], { env: process.env });
```

#### Correct

```ts
const receipt = await pythonSandboxAuthority.execute({
  ...request,
  source_ref: committedSourceRef,
  input_refs: committedSqlResultRefs,
  runtime_digest: configuredRuntimeDigest,
  dependency_lock_digest: configuredDependencyLockDigest,
  policy_version: configuredPolicyVersion,
});

await artifactAuthority.commitSandboxOutputs(receipt);
```

`commitSandboxOutputs` 必须重新授权 Receipt、Fence、全部输入输出 Reference 与 hard-control evidence，不能信任普通 JSON 或 Sandbox 自报成功字符串。

# M1 OpenSandbox Runtime Adapter

## 目标

在 Worker 内建立唯一的 OpenSandbox 分析运行端口，承接 sandbox 生命周期、文件传输、context 管理和取消；保持 `AnalysisProgram`、Oracle 与持久化权威不变。

## 实现步骤

1. 新增 `AnalysisSandboxRuntime` port 和 OpenSandbox adapter；依赖固定官方 JS SDK 版本。
2. 用显式配置提供 server URL、API key secret reference、镜像 digest、startup/cell/operator timeout、容器资源上限。
3. 创建 sandbox 后生成 agent/operator context，上传输入 Parquet 与只读 manifests。
4. 所有 API 调用传播 run cancellation；终态总是删除 context 和 sandbox。
5. 以 Artifact/Receipt 记录 sandbox image digest、SDK/server version、resource profile 和 file hashes，隐藏 endpoint/token。

## 代码分析

### 结构与职责

- Worker adapter 只做控制面和字节传输，不解释业务公式。
- `AnalysisProgram` 继续决定 SQL evidence、分析节点、依赖与 Oracle；OpenSandbox 只是某个 analysis node 的执行器。
- OpenSandbox SDK 的 `Sandbox.files` 负责 multipart upload/download；Code Interpreter 的 `codes` 负责 context/Cell。

### 关键实现

Adapter 必须拥有 `createRunSandbox`、`uploadInput`、`createContext`、`runCell`、`interruptCell`、`downloadOutput`、`deleteContext`、`destroySandbox`。每个返回值映射为 Data Agent 自己的窄合同，禁止业务层泄漏第三方 SDK 对象。

资源合同拆成两层：平台容器预算（至少满足科学库线程启动）和单 Cell 预算（wall time、输出字节、文件数、内存观测）。不再把旧 `max_pids=16` 当作新平台容器 PID。

### 风险与坑点

- endpoint/API key 不能进入公开 trace、错误、artifact 或模型 prompt。
- sandbox create 成功但 context create 失败仍必须清理 sandbox。
- SDK/server 版本漂移可能改变 API；lockfile、image digest、startup probe 必须同时约束。
- 不允许在 OpenSandbox 不可用时调用旧 UDS runtime。

## 验收标准

- adapter contract test 覆盖正常、create/context/upload/run/download/cleanup 各阶段失败与取消。
- 每个终态都能证明 context/sandbox 被清理，或产生可重试的 cleanup debt 事件。
- 配置缺失、SDK/server 不兼容和镜像 digest 不匹配在启动前失败。
- 仓库内只有该 adapter 能直接引用 OpenSandbox SDK。

## 备注

本阶段不改变 SQL Sandbox，也不允许 adapter 直接查询 PostgreSQL。数据必须先由受治理 SQL 节点生成证据文件。


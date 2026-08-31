# NAS OpenSandbox 控制面与端口预检

## Scope

OpenSandbox 的 Docker 后端、SSH 转发、NAS 运行位置改变时适用。
这是运行环境约束，不创建另一套分析、发布或数据库权威。

## Contract

- 使用 `allocate_host_port` 的控制服务必须与 Docker daemon 处于同一主机网络命名空间。
  Mac 上探测空闲端口不能证明 NAS 上空闲；SSH 转发的 Docker Unix socket 也不能证明二者同机。
- NAS 模式下控制服务使用 NAS 的 `/var/run/docker.sock`；独立 venv 只运行管理服务，
  Agent/Operator Python 仍只在两个原 OpenSandbox 容器中执行，不允许宿主执行模型源码。
- 控制 API 绑定 NAS loopback，经显式 SSH 转发访问。数据端口与 API 端口分别检查，
  不能以 `/health` 成功代替真实 Agent/Operator 双沙箱启动。
- 迁移控制服务时保留版本及源码文件 hash，记录新环境 dependency freeze、配置 hash、存储目录；
  API key 不打印、不提交，控制服务不得获得数据库、Datasource 或 Provider 凭据。
- 不为“避免端口碰撞”增大随机端口范围、忽略 Docker 500、关闭网络策略或重放失败 Run。
  端口位置错误先纠正拓扑；原失败记录和已经发生的 Provider outcome 保留。
- 验证后端仍为原 SDK、固定 Agent/Operator/execd/egress 镜像及原 Operator Registry。
  控制服务迁移不是 production isolation 认证，不能把既有 HOLD 改成 GO。

## Required validation

1. 在 NAS 控制服务的 venv、源码 overlay、Docker 环境中运行
   `scripts/verify-opensandbox-host-ports.py`：占用端口必须拒绝，随后空闲端口可选，耗尽必须失败关闭。
   该探针只验证当前主机；部署位置还须通过 NAS 进程、socket 和启动配置证明。
2. 从 Worker 所在主机运行原 `scripts/verify-opensandbox-analysis-runtime.ts`，证明 direct endpoint：
   两个不同 Sandbox、Agent 不包含 Operator 包、Cell policy 正/反例、状态符号、算子输出及回执闭合。
3. 前后按管理标签列举 Sandbox，均须为零；审计 API/端口、进程归属和无模型调用。
4. 改动运行环境后的下一次问答使用新冻结执行记录。业务来源 Oracle、同 Run UI/Trace、完整四层门禁另验，
   无模型探针 PASS 不计为业务题 PASS。

## Observed failure

`8cc4d933` scratch A1 的 SQL 12 行通过来源 Oracle，但 Operator egress 创建返回
`Bind for 0.0.0.0:51022 failed: port is already allocated`，继而 `ANALYSIS_SANDBOX_STARTUP_FAILED`。
控制服务当时在 Mac，容器在 NAS。迁移相同 117 文件至 NAS 后，上述端口探针及原双沙箱 runtime probe 通过，
前后 Sandbox 数为零。原 A1 仍为 FAILED；不把同次后续 Root 格式错误解释成基础设施修复后已解决。

相关：[Python 执行权威](./python-sandbox-execution.md)、[本地运行模式](./local-runtime-modes.md)。

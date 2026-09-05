# cb73d087 Provider 断流与运行时偏移

## 1. 根因分类

- **E / 隐含假设**：PATH 中 Node 26 被默认当作仓库声明的 Node 24；实际 Worker 日志出现 Undici HTTP/2 栈。
- 已确认直接故障：首个模型请求发送后约21秒发生 `TypeError: terminated`，cause 为 `UND_ERR_SOCKET / other side closed`。
- 不能确认远端关闭的唯一原因；可能是上游/网络瞬态或 HTTP/2 交互。切换声明运行时是消除已证实的环境偏移，不是声称修复远端。

## 2. 为什么不重复运行

- Run `f7f9069b-dfc8-83b9-a169-65cc4056e498` 已持久 FAILED，调用为 OUTCOME_UNKNOWN；只有5个事件，无 Specialist/SQL/Analysis。
- Attempt `f9fce866-1cde-4b69-bd40-e8aa560e4a0e` 已由原 controller 封存 FAILED。L1 的5个 PASS 保持历史，不供下一批计分。
- L1-05 的 rubric identity 错误是观察命令漏传 `--accepted-input-artifact-refs`。补传原验证文件后同一 Run 通过，无模型重放。

## 3. 预防机制

| 优先级 | 机制 | 状态 |
| --- | --- | --- |
| P0 | 正式 build/CLI/consumer 使用 `.node-version` 主版本并记录实际 Node/Undici/路径 | 已加入运行规范 §9；下一批执行 |
| P0 | dispatch 后断流保留 unknown，不通过协议切换重派 | 原有边界已执行 |
| P1 | 目录/余额/ALPN 只读探针与 SSE/业务证明分离 | 已执行 |
| P1 | 失败后关闭本批 Chrome/Web/Worker，保留 scratch 证据及数据卷 | 已核验进程和应用端口退出 |

## 4. 扩展检查

- `.node-version` 与 Worker OCI 默认值均为24，engines允许24至26不等于正式部署选择26。
- 本机源代码检查：Node26.3.0内置Undici8.3.0的 `allowH2` 默认true，Node24.18.0/Undici7.28.0默认false。
- 2026-09-05的真实无模型探针：两版本 `/models` 与 `/user/balance` 均200，目录3项且账户可用；ALPN分别h2和http/1.1。
- 不修改 Provider schema、模型、题目、超时、预算、Oracle、权限或 retry policy，不改变系统全局 Node 默认值。

## 5. 证据与知识记录

- 已更新 `.trellis/spec/backend/local-runtime-modes.md` §9。
- 审计目录：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/`。
- `formal-e17-cb73d087-f9fce866/runtime/control-advance-1788581223803.json`：正式失败回执。
- `formal-e17-cb73d087-f9fce866/runtime/service-worker-1788580528338.log`：原始私有错误栈。
- `provider-protocol-v26.3.0-1788581364515.json`、`provider-protocol-v24.18.0-1788581364875.json`：脱敏只读协议证据。
- 当前 Node 源码与真实探针是本地证据；[Node 26 发布说明](https://github.com/nodejs/node/releases/tag/v26.0.0)仅用于核对其升级Undici8的背景。
- 仓库不存在 `src/templates/markdown/spec/`，无对应模板需同步。

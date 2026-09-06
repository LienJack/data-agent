# Bug Analysis: 资源清理命令与实际进程状态

## 1. Root Cause Category

- E（隐式假设）及B（工具返回合同）：把 auth 元数据操作视为完全无后台副作用，把 close 返回视为 PID 已退出。
- 实测 agent-browser0.32.3 的 auth list/show/delete 可启动轻量 daemon，但 browserLaunched=false、pageCount=0；不是 Chrome 泄漏。
- Docker stop 的退出码为0、容器已 exited0，但弃用 --time 的 stdout 警告使精确文本断言失败；不能重放整个清理流程。
- PostgreSQL bigint 在原生 pg 返回字符串；独立读回审计应显式有界整数转换，不能误判 Profile 数据漂移。

## 2. Why Fixes Failed

1. 只放宽首次 session 检查，遗漏后续 auth 命令也会启动 daemon。
2. close 后立刻读 session list，仍与后台退出存在竞争。
3. 更可靠证据是同一个 daemon PID 消失、session归零、Chrome主/子进程仍为0；最终修复显式等待该PID退出。
4. 所有失败发生在只读审计或资源封装层；原15题、认证与激活均未重放。恢复先检查 durable现场再只完成剩余操作。

## 3. Prevention Mechanisms

| 优先级 | 机制 | 行动 | 状态 |
| --- | --- | --- | --- |
| P0 | 生命周期检查 | 区分daemon/session、Chrome、页面；close后等待精确PID退出 | 已实测通过 |
| P0 | 定向恢复 | inspect真实状态优先于stdout文案；不重放整批清理或发布 | 已实测通过 |
| P1 | 资源计数 | 角色+sidecar都计数；0→4→0，而非只报2角色 | 1159样本通过 |
| P1 | 类型边界 | pg bigint显式::integer，有界失败，不改变业务值 | live原端口读回通过 |

## 4. Systematic Expansion

- CLI元数据命令、后台服务关闭、SSH、Docker均适用“命令结果不是终态证据”。
- 测试重跑、恢复、收尾只读核验也要纳入资源盘点；不能用全局pkill/prune消除观察误差。
- 不为一次诊断新建资源管理平台或生产业务抽象；修正本任务执行封装与操作规范即可。

## 5. Knowledge Capture

- [x] backend/local-runtime-modes §8已加入daemon与Chrome区分、PID退出等待、Docker warning恢复和sidecar计数。
- [x] AGENTS.md和backend/index.md同步入口；保留独立题换页、同组L4不换页及数据卷保护规则。
- [x] 当前仓库无src/templates/markdown/spec，不创建第二份模板权威。
- [x] 定向移除9个旧停止容器、当前auth与瞬态capability；全部卷/backup/history保留；运行资源归零，普通NAS服务未变。

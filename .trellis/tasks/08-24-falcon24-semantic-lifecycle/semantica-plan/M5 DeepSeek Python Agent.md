# M5 DeepSeek Python Agent

## 目标

让 Agent 必须通过 DeepSeek 编写 Python 并使用数据分析库完成复杂统计，同时不放弃权限、复现和 Oracle 控制。

---

## 实现步骤

1. `SemanticContextPackage` 编译为唯一 `AnalysisProgram` DAG，包含 SQL evidence、Python、Oracle 和 report nodes。
2. 固定模型 `deepseek-v4-flash`；模型只接收 schema/语义/受控统计证据，不接收数据库凭据或隐藏 Gold。
3. Python 输入使用内容寻址的 Arrow/Parquet artifacts；允许 pandas、numpy、scipy、statsmodels、sklearn 和受控绘图库。
4. AST admission 禁止网络、子进程、任意文件、动态安装、反射逃逸和未声明输入；限定 CPU、内存、时间和输出。
5. 保留 Attempt 0；仅允许一次基于 Oracle 公开错误证据的非扩权修复，Attempt 1 单独计分。
6. 输出数据表、图、统计量、程序 hash、runtime/lock、receipt 和限制声明；UI 不重新计算。

---

## 代码分析

### 结构职责

- Host 决定依赖、权限、网络和执行器；DeepSeek 负责生成候选 Python，不拥有运行环境。
- SQL 负责可审计取数；Python 负责统计建模、分解、稳健性检验和图表。

### 关键实现

- Program 必须绑定 context hash、query evidence hashes 和固定 model profile。
- Oracle 从独立实现读取输出 artifact，不复用模型代码计算 Gold。

### 风险与坑点

- 允许模型自由 pip install 会破坏复现和供应链边界；依赖由固定镜像预装。
- 仅检查源码字符串无法阻止逃逸；需 AST、系统调用隔离和恶意程序回归共同验证。

---

## 验收标准

- 五题均存在真实 provider receipt、生成源码、sandbox receipt 和独立 Oracle receipt。
- 无网络、无数据库凭据、超时、OOM、恶意 import 和输出泄漏测试全部 fail closed。
- 同一 Program/inputs/runtime 重放输出 hash 一致。
- Attempt 0/1、成本、延迟和失败类型独立记录，LLM Judge 不能覆盖确定性 FAIL。

---

## 备注

- Provider 不可用属于 infrastructure HOLD，不能用手写 fixture 冒充真实 DeepSeek 通过。

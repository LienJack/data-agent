# 外部开源项目源码阅读指南

> **目的**：用知识图谱快速定位相关源码，再用固定提交下的源码、测试和运行证据核验结论。

---

## 何时使用

当工作涉及以下任一情况时，先阅读本指南：

- 参考其他开源项目的架构、交互、数据合同或工程模式；
- 比较 Data Agent 与外部项目的能力边界；
- 准备复用、改造或拒绝某个外部实现；
- 用外部源码支撑 PRD、设计、研究或评审结论；
- 用户明确要求阅读某个外部项目源码。

单个已知文件、明确符号或很小的补丁问题，可以直接窄范围阅读源码。不要为了形式完整而先生成一份新图谱。

---

## 核心原则

1. **图谱用于导航，不是实现证明**：知识图谱的节点摘要、边和分层帮助找到代码，但不能证明功能可运行、行为正确或当前版本兼容。
2. **先固定快照，再下结论**：所有源码结论都要绑定目标仓库和可解析的 Git commit；只写分支名不够。
3. **当前源码优先**：README、文章、图谱和历史研究都是线索；源码、测试、配置和运行结果才是能力结论的直接证据。
4. **区分借鉴与照搬**：外部项目的模式必须经过 Data Agent 的 authority、租户、权限、持久化和可观测性边界再判断。
5. **默认只读**：未经任务范围明确授权，不修改外部 checkout，不安装依赖，不运行迁移，不生成或刷新图谱。

---

## 第一步：固定目标项目状态

进入目标项目根目录，至少记录：

```bash
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
```

如果仓库已有用户或其他任务的改动：

- 保留并报告它们，不回退、不覆盖、不暂存；
- 判断这些改动是否与当前阅读主题重叠；
- 重叠时，把相关结论标记为“工作区状态下的观察”，不能冒充固定 HEAD 的行为；
- 需要执行可能写入文件的命令时，先获得单独授权。

还要查看目标项目的 `LICENSE`、`NOTICE` 或等价文件。架构思想可以比较，但复制代码、测试、文档或资源前必须确认许可证和署名要求。

---

## 第二步：优先使用已有知识图谱

如果目标项目已有 Understand Anything 图谱，优先使用 `understand-anything:understand-chat` 回答架构与源码定位问题。

### 定位图谱目录

```bash
UA_DIR=$([ -d .understand-anything ] && echo .understand-anything || echo .ua)
test -f "$UA_DIR/knowledge-graph.json"
```

旧项目已有 `.understand-anything/` 时沿用旧目录；否则使用 `.ua/`。不要同时读取两份图谱后混合结论。

### 检查图谱新鲜度

从 `knowledge-graph.json` 的 `project.gitCommitHash` 读取 `GRAPH_COMMIT_RAW`，先确认它能解析为 commit，再比较当前项目范围内的变化：

```bash
GRAPH_COMMIT_RAW=$(jq -r '.project.gitCommitHash // empty' "$UA_DIR/knowledge-graph.json")
GRAPH_COMMIT=$(git rev-parse --verify --end-of-options "${GRAPH_COMMIT_RAW}^{commit}" 2>/dev/null)
git rev-parse HEAD
git diff --name-only "$GRAPH_COMMIT" HEAD -- .
git diff --cached --name-only -- .
git diff --name-only -- .
git ls-files --others --exclude-standard -- .
```

检查输出时忽略当前图谱目录 `.ua/` 或 `.understand-anything/`；它们是生成物，不是目标项目源码漂移。

判定规则：

| 状态 | 处理方式 |
|------|----------|
| 图谱存在、commit 可解析、相关源码无漂移 | 使用 `understand-chat` 定位相关节点、边和层，再读源码核验 |
| 图谱 commit 与 HEAD 不同，但项目范围 diff 为空 | 不因 hash 不同单独判定陈旧；记录原因后继续使用 |
| 图谱存在，但相关 committed 或工作区源码有漂移 | 明确警告图谱可能遗漏变化；对相关路径直接读当前源码，或经授权后刷新图谱 |
| 图谱缺失 | 报告缺失；直接进行窄范围源码搜索，或建议另行运行 `understand` |
| commit 缺失、无效或 Git 元数据不可用 | 给出 best-effort 警告；图谱只作线索，所有关键结论回到源码核验 |

刷新图谱会写入目标 checkout，必须属于已批准的任务范围；不能因为图谱陈旧就擅自执行。

### 只读取相关子图

使用 `understand-chat` 时：

1. 先读 `project` 元数据，确认项目、语言、框架、分析时间和 commit；
2. 用问题关键词搜索节点的 `name`、`summary` 和 `tags`；
3. 记录匹配节点 ID，跟随一跳 `imports`、`calls`、`depends_on` 等边；
4. 查看节点所在 layer，确定需要直接阅读的文件；
5. 不把整个 `knowledge-graph.json` 倾倒进上下文。

---

## 第三步：回到源码建立证据链

对图谱找到的每个关键结论，至少完成以下核验：

1. **入口**：请求、命令、事件或 UI 行为从哪里进入；
2. **执行链**：调用、状态转换、持久化和错误处理如何连接；
3. **权威来源**：哪个数据库、日志、事件流或文件决定最终状态；
4. **测试**：是否有针对该行为的测试，断言的是结果还是仅断言实现细节；
5. **运行边界**：能否在当前环境执行；若未运行，明确写“源码证明”而不是“运行证明”；
6. **失败路径**：权限、空状态、重试、中断、并发和恢复如何处理。

证据强度通常按以下顺序递减：

```text
当前固定提交的运行结果
  > 当前固定提交的行为测试
  > 当前固定提交的源码与配置
  > 同一提交的维护者文档
  > README / 发布说明
  > 知识图谱摘要 / 二手文章
```

不同证据解决不同问题，不能机械用一个等级覆盖另一个。例如，测试证明某个输入得到某个输出，不一定证明生产部署已经启用该能力。

---

## 第四步：决定如何借鉴

每个参考模式都要给出以下三种结论之一：

| 结论 | 含义 | 必须说明 |
|------|------|----------|
| 采用 | 可在现有边界内直接复用该思想或实现 | 对应模块、许可证、验证方式 |
| 改造 | 思想可用，但需适配 Data Agent 边界 | authority、租户、权限、数据合同或运行时差异 |
| 拒绝 | 不适合当前目标 | 冲突的需求、风险或更简单的替代方案 |

“某知名项目这样做”不是采用理由。结论必须回到本任务的用户目标、约束和验收标准。

---

## 研究记录的最小格式

```markdown
## 参考项目核验

- 目标仓库：<absolute path or URL>
- 分支：<branch or detached>
- 固定提交：<full commit hash>
- 工作区：<clean / relevant drift / unrelated drift>
- 图谱：<path, analyzedAt, graph commit, fresh/stale/missing>
- 核验方式：<source / tests / runtime>

### 已证明

- <claim> — <file, symbol, test or command evidence>

### 未证明或边界

- <what was not run, unavailable, or inferred>

### 对 Data Agent 的取舍

- <采用 / 改造 / 拒绝>：<reason and affected boundary>
```

引用源码时优先记录文件路径、符号名和固定提交。只有在行号稳定且确实有帮助时才记录行号。

---

## 安全与操作边界

- 不输出或记录 `.env` 值、令牌、Cookie、私有数据、内部地址或未脱敏日志；只报告变量名和脱敏状态。
- 不执行会写数据库、触发外部 API、发送消息或改变远端状态的示例命令。
- 不用 `git reset --hard`、`git checkout --` 等命令清理外部项目；现有改动属于用户或其他任务。
- 未经授权不安装依赖、运行构建、迁移或生成器；这些命令可能改变 lockfile、缓存或生成物。
- 如获准运行测试或构建，执行前后都检查 `git status --short`，并报告新增变化，不擅自删除。
- 不把外部项目 README 中的能力名称等同于 Data Agent 已实现能力。

---

## 完成前检查清单

- [ ] 记录了目标仓库、分支、完整 commit 和工作区状态
- [ ] 检查了图谱是否存在及其新鲜度
- [ ] 图谱只用于定位，没有作为运行或实现证明
- [ ] 关键结论已回到源码、测试、配置或运行结果核验
- [ ] 明确区分已证明、推断和未验证内容
- [ ] 给出了采用、改造或拒绝结论及理由
- [ ] 检查了许可证和敏感信息边界
- [ ] 未修改、回退或暂存外部项目中的现有文件

---

**核心原则**：先用图谱找到该读什么，再用当前源码证明你读懂了什么。

# 运行轨迹工作台技术设计

## 1. 设计结论

本任务升级当前唯一生效的 `ResolutionTraceView`。整体采用“轻量轨迹索引 + 选中后懒加载公共详情”的读模型：

```text
PostgreSQL authority
  -> ResolutionTrace index (nodes / edges / timing / refs)
  -> ResolutionTraceDetail projector (exact run + node + sequence/ref)
  -> owner detail API / existing admin audited event + artifact APIs
  -> timeline model + virtual list + inspector
  -> exact Artifact Preview / typed renderer
```

时间轴和列表只依赖现有 `ResolutionTrace`，因此首次加载规模仍有界。Inspector 详情由独立严格合同返回，避免把 10,000 条记录的正文一次性传到浏览器，也避免客户端拿 ID 去当前 Catalog 拼接历史内容。

## 2. 合同与身份

新增版本化 `ResolutionTraceDetail` 公共合同，公共 envelope 至少包含：

```ts
type ResolutionTraceDetail = {
  schema_version: "resolution-trace-detail@1.0.0";
  workspace_id: string;
  run_id: string;
  node_id: string;
  sequence: number | null;
  kind: ResolutionTraceNodeKind;
  hierarchy: PublicHierarchy;
  status: string;
  identity: PublicIdentity[];
  payload: PublicSection;
  result: PublicSection;
  schema: PublicSchemaSection;
  timing: PublicTimingSection;
  relations: PublicRelation[];
};
```

`PublicSection` 区分 `available / unavailable / forbidden / unsupported / stale`，并携带稳定 reason code。内容使用已脱敏 JSON、文本、Markdown 摘要或 exact Artifact Reference；禁止携带 SecretRef、系统 Prompt、私有 reasoning、数据库凭据、Authorization、raw context 或 Provider 原始载荷。

详情请求使用 `node_id`，服务端再用同一 trace 中的 `source_event_id + sequence + artifact_refs` 解析权威事实；请求中的 ID 不能单独决定读取对象。Tool start/complete/failed 可按 exact `call_id` 聚合，但返回时保留全部来源 sequence。Artifact 仍要求 `artifact_id + revision + content_hash + scope/run` 全匹配。

## 3. 服务端聚合

平台层新增只读 projector，沿用 Resolution Trace 的 READ 事务和 Workspace/RLS 边界，按节点类型解析：

| 类型 | 权威来源 | 内容投影 |
| --- | --- | --- |
| Run / Lifecycle / Terminal | run authority、public run events | 问题、状态变化、终态原因、attempt/fence、时间 |
| Config / Model / Datasource | effective config receipt、冻结 resource binding | Provider/model id、数据源引用、policy/release/snapshot；不回查当前 Catalog 覆盖历史 |
| Agent / Task / Handoff / Epoch / Verifier | team trace、profile registry revision、public events | 公开名称、任务摘要、阶段、关系、结论、耗时、产物 |
| Tool | public tool events | tool/call/profile/task、公开 input/output/error/duration、产物引用 |
| SQL / Schema / Receipt | exact SqlArtifact/ExecutionReceipt/QueryEvidence/SandboxResult/SchemaSnapshot refs | 授权 SQL、参数摘要、状态、行数、错误、schema 摘要、结果引用 |
| Context | resolved context package/receipt | 路由、语义域、容量、included/cropped 摘要、证据与 policy |
| Artifact | verified artifact reference | 只返回 preview target 和公共摘要，正文由 Artifact Preview API 懒加载 |

历史事实缺少显示名时返回 `HISTORICAL_DISPLAY_NAME_UNAVAILABLE`。不允许将当前 QA Resource Catalog 的名称当作历史事实。解析失败保留 exact identity，并返回稳定 reason code。

Owner API：

```text
GET /api/workspaces/:workspaceId/runs/:runId/resolution-trace/details?node_id=:nodeId
```

管理员跨 owner 读取复用现有 audited public-event 与 exact Artifact routes，它们已经生成 immutable audit
receipt；不新增一条语义重叠且可能漏审计的 admin detail route，也不能由 owner route 接受伪造 owner 参数。

## 4. 客户端投影模型

新增纯函数 `buildResolutionTraceWorkbenchModel(trace)`，不依赖 React、DOM、`EventSource`：

- 按 sequence 建立稳定 record identity；派生节点使用合同稳定次序。
- 映射 `RUN / AGENT / TOOL / EVIDENCE` 四泳道。
- 同时计算真实时间 domain 与 sequence domain；缺 duration 使用最小命中宽度，不伪造耗时。
- 只从公共 title/summary/kind/status/error/name 构建搜索索引。
- 只从真实 edges 构建一层 hierarchy；循环、重复边和孤儿边安全降级。
- 计算节点数、Tool/SQL 数、失败/等待数和总耗时。

选择状态只保存 `selectedNodeId`；时间轴、列表和 Inspector 都由它派生。详情请求按 `runId + nodeId` 缓存，并使用 generation/AbortController 防止快速切换后旧响应覆盖新选择。

## 5. 交互与布局

桌面端结构为：

```text
[运行摘要 | Duration | 折叠 | 搜索]
[RUN       =====  |]
[AGENT   ==  ===  |]  <- 点击、拖选、缩放、平移
[TOOL      = = == |]
[EVIDENCE    =  = |]
[虚拟化记录列表                 ][Inspector]
```

- 工具栏提供真实耗时/sequence、阶段与调用折叠、搜索、区间重置。
- 时间轴与列表双向定位，鼠标、触控板和键盘使用同一选择 reducer。
- 记录列表达到阈值后使用项目已有虚拟化依赖，只渲染窗口与 overscan。
- Inspector 桌面端可收起和限宽拖动；窄屏使用内容抽屉，关闭后焦点返回触发行。
- Inspector `Summary` 汇总 Hierarchy、Status、Identity、Payload、Result、Schema、Timing；其余页签直达对应内容。
- Artifact 单引用直接内联预览，多引用提供内容摘要切换器；切换 Artifact 不改变当前 node selection。
- 表格/图表继续按现有 Preview offset/limit 读取，默认最多 100 行。

## 6. 状态与恢复

- REST baseline 和 SSE 增量以 `(run_id, sequence)` 幂等合并；`Last-Event-ID` 重连不改变 record identity。
- 用户在末尾且未查看历史时才自动跟随；否则只显示“有新记录”。
- detail 与 Artifact preview 的 loading/error 仅影响 Inspector 对应区块，不清空 trace。
- 覆盖 empty、running、waiting、failed、cancelled、completed、reconnecting、forbidden、stale、hash mismatch、unsupported、schema unavailable。

## 7. 安全与审计

- `ResolutionTraceDetail` 是 allowlist 公共投影，不是 raw event passthrough。
- 搜索、复制、DOM 与客户端缓存只含公开字段。
- Artifact preview 与 export 分开授权；预览成功不产生导出权限。
- 管理员跨 owner 打开 public event 与 Artifact 内容沿用既有不可变审计回执；owner detail route 不承担
  管理员跨 owner 读取。
- Markdown 沿用安全 renderer，禁止 raw HTML、javascript/data URL 和未授权外部内容。

## 8. 参考实现边界

DeepSeek Harness 固定参考 commit `47f943859bef60e4160492346772ded9b24f765a`。本任务复用其 Duration/Turns/Calls、时间轴区间交互、联动选择、虚拟列表和详情信息架构的语义；实现优先适配 Data Agent 现有组件与设计令牌。若复制实质性源码，必须补 source reuse ledger、MIT notice 与 modified-source 记录；仅行为参考则记录为原创实现。

## 9. 验证矩阵

- 合同：严格解析、reason code、脱敏、exact identity、历史不漂移。
- 平台：每类 detail projector、权限、事务一致性、错误映射、admin audit。
- 纯 UI 模型：泳道、统计、搜索、edge hierarchy、duration/sequence、乱序/重复增量。
- 组件：选择联动、Inspector tabs、Artifact 多引用、虚拟化、焦点、窄屏、错误局部化。
- 浏览器：1440px 与 390px，时间轴拖选/缩放/重置、搜索、详情内容、刷新/SSE 恢复、无横向溢出。

## 10. 迁移策略

现有 `resolution-trace@1.0.0` 和 `/resolution-trace` API 保持兼容；新 detail 合同和 endpoint 为加法变更。先接入新工作台并保留现有一级页签，再逐步将 Team/SQL/Artifact 中的裸 ID 链接统一指向相同 Inspector。无需数据迁移；历史数据缺少公共内容时诚实显示 unavailable reason code。

完整 Resolved Context material 若没有 exact Artifact preview target，则保持 unavailable。本任务不绕过已撤销的
直接表读取权限；新增普通 owner 可读的 Context 公共 RPC 属于后续独立 authority/migration 变更。

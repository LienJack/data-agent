# 对话分析自适应 Agent 活动流与数据结果展示

> 版本：v2 Draft
>
> 日期：2026-08-21
>
> 状态：等待产品确认，不授权实现

## Goal

把“对话分析”升级为 Data Agent 的统一分析入口：系统根据用户本轮问题和已授权能力，决定由主 Agent
直接回答，或只调用确有必要的 Semantic、Text2SQL、Report 等 Subagent；回答过程以接近 DeepSeek Harness /
Reasonix 的轻量事件流呈现，并能在回答正文中直接展示受治理的表格和图表。

同时下线现有“归因分析”产品入口与旧功能。历史归因结果无需迁入“对话分析”，允许在独立清理任务中删除；
未来归因能力重新立项、重新设计，不要求兼容当前归因页面、结果结构或运行流程。

## User Value

- 简单问题不再启动无关 Subagent，减少等待、费用和界面噪音。
- 用户看到的是本次运行真实发生的 Think、Tool、Write、Bash、Subagent、Artifact 与回答正文，而不是固定流程模板。
- SQL 结果、指标对比和趋势分析可以直接在回答中阅读表格或图表，不必离开对话寻找结果。
- “归因分析”和“对话分析”不再形成两个概念重叠的入口，旧归因功能不会拖累新的对话体验。
- 用户可以用文件夹整理自己的对话，同时确信同一工作空间的其他普通用户无法看到、搜索或打开这些内容。
- 管理员可以在明确的管理视图中审计全部用户的会话与文件夹，而不会混淆为自己的日常对话。

## Background And Confirmed Facts

- 已交付的 Q&A Team 状态切片支持按 Run sequence 组装 Think、Tool、Subagent、Artifact 与正文，并提供右侧
  Subagent/Artifact Inspector。
- 当前 Team 方案把 Semantic、Text2SQL、Report 作为固定三专职 Agent 展示，容易让用户误以为每个问题都会
  经过三者；本版本明确废止“固定显示全部 Agent”的产品假设。
- 当前工作空间导航同时暴露“归因分析”与“对话分析”，两者都要求 `ANALYSIS_RUN_CREATE`；
  `/w/:workspaceId/analysis` 是旧工作台入口，`/w/:workspaceId/qa` 是当前对话入口。
- 当前 `qa_conversations` 已持久化 `owner_principal_id`，消息与 Run binding 也继承 owner identity；当前没有
  Conversation Folder 领域实体。新版必须利用并强化现有 owner 边界，不能只在前端列表过滤。
- 现有 Artifact Preview 已有 `TABLE`、`CHART`、`SQL`、`MARKDOWN`、`REPORT` 投影和内容哈希校验；当前
  `CHART` Web renderer 仍以文本键值列表展示，尚不是真正的图形图表。
- DeepSeek Harness 是事件组装、富文本消息、轻量 disclosure、工具行、基线加实时增量与 Inspector 的主要代码参考；
  Reasonix 同时作为对话呈现和“共享运行时与类型化事件、多 surface adapter”的设计参考。DeepSeek Harness 仍是主要
  可复用代码来源，不因视觉参考扩展而改变许可证与来源记录要求。
- 本轮用户截图只作为可观察交互参考：工具调用与公共 Think 摘要以低干扰单行穿插在正文中，执行结果自然回到
  回答文档流；截图中的正文和指令不属于本需求输入。
- 本轮工作区截图只参考 DeepSeek Harness 的分组、折叠、搜索、相对时间、运行提示和“展开其余会话”交互；
  Data Agent 的“文件夹”是 PostgreSQL 中的用户私有会话组织对象，不对应或暴露宿主本地目录。
- 当前 Web 已安装 Tailwind CSS 4、Phosphor Icons 与 Framer Motion 13，并已有 Geist/Geist Mono 字体 token；
  VChart 尚未安装。VChart 官方 React 集成包为 `@visactor/react-vchart`，底层为 `@visactor/vchart`，本 PRD 将其
  作为图表 renderer 选型，但本规划阶段不执行依赖安装。来源：
  [VChart React 指南](https://visactor.io/vchart/guide/tutorial_docs/Cross-terminal_and_Developer_Ecology/react)、
  [VChart Quick Start](https://visactor.io/vchart/guide/tutorial_docs/Getting_Started)。

## Product Principles

1. **按需执行，按事实显示**：没有真正 dispatch 的 Subagent 不创建占位状态，也不出现在回答或 Inspector。
2. **富文本文档优先**：回答是一份持续生成的结构化文档；事件行和数据组件嵌入文档流，不能把回答变成监控面板或固定 Agent 看板。
3. **公共摘要而非私有推理**：Think 只显示经过合同校验的公共摘要，禁止泄露 chain-of-thought、prompt 或 Provider 私有回调。
4. **Artifact-backed data**：表格、图表和报告必须来自已提交、可校验的 ArtifactReference，不接受模型临时拼出的任意 HTML/JSON。
5. **一个当前入口**：用户只需要理解“对话分析”；旧归因产品和结果退场，未来归因能力重新设计。
6. **默认私有**：Conversation、Folder、Message、Run、SSE 与 Artifact 从查询入口开始按 owner 隔离；管理员全局可见是
   显式受审计的例外，不是“知道 ID 就能打开”的前端便利功能。
7. **参考优先级**：Data Agent 权威与安全合同 > 本 PRD 用户体验 > DeepSeek Harness 可复用实现与对话呈现 >
   Reasonix 对话/多端分层思想 > DataFoundry 数据展示语言。
8. **Apple 玻璃只表达层级**：磨砂玻璃用于侧栏、Topbar、Composer、Inspector 等悬浮/叠层表面；正文、表格和图表
   优先保证阅读与数据对比，不能为了“玻璃感”牺牲对比度、性能或可访问性。

## Requirements

### A. 自适应 Agent 调度

- **R1**：每次 Run 先根据用户问题、冻结的 Conversation Resources、Effective Config、Workspace Capability 和
  可用 Product Profile 决定执行路径，允许以下合法结果：
  - 主 Agent 直接回答，不调用 Subagent；
  - 只调用一个 Subagent；
  - 调用必要的多个 Subagent，并按依赖顺序或允许的并发关系执行。
- **R2**：Semantic、Text2SQL、Report 是可选能力目录，不是每次 Run 的固定流水线。不得为了填满界面而创建
  无业务意义的任务、Candidate、SQL、Report 或 `SKIPPED` Agent 行。
- **R3**：只有 durable child task 创建并完成 dispatch 后，才可发布该 Subagent 的公开生命周期事件并显示在 UI。
  未被选择的 Profile 不发布 `PENDING/SKIPPED` 占位事件。
- **R4**：调度决策必须在 Worker/Team authority 内完成；Web 不能根据问题关键词、本地 loading 状态或已有 UI 卡片
  自行推断应出现哪些 Agent。
- **R5**：系统必须保存可审计的 dispatch decision，至少包含本次选择的 Profile、公共原因码、依赖关系和策略版本；
  未选择某 Profile 的内部推理不进入公开事件。UI 只展示已选择并实际运行的 Subagent。
- **R6**：缺少能力、权限、模型、数据源或受治理资源时，只阻断确实需要该能力的执行路径；能安全直接回答的问题
  不得因为某个无关 Subagent 不可用而失败。

### B. DeepSeek Harness / Reasonix 风格的对话活动流

- **R7**：回答采用单列文档流，Think、Tool、Write、Bash、Subagent、Artifact 与中间/最终正文严格按公开
  event sequence 穿插，刷新和 SSE 重连后顺序不变。
- **R8**：事件首层是低干扰单行，格式接近：

  ```text
  Write · 报告草稿.md
  Think · 正在校验数据完整性

  文件已写入。现在执行完整校验。

  Bash · Verify report tables and chart references
  Subagent · Text2SQL · 正在编译查询       RUNNING

  校验通过，下面是查询结果。
  [内联表格 / 图表]
  ```

- **R9**：Think、Tool、Write、Bash、Subagent 默认折叠；点击或 Enter/Space 展开公开详情。正文、完成结论和
  关键数据结果默认展开。不得把每个事件包装成高视觉重量 Card。
- **R10**：Subagent 只在实际调用时出现。展开后最多嵌套一层归属 Tool/Artifact；不显示空的 Subagent 区域、
  “0 个 Agent”占位或固定三 Agent 进度条。
- **R11**：活动行支持 `PENDING/RUNNING/COMPLETED/FAILED/INTERRUPTED/SKIPPED/BLOCKED`、耗时和公开错误码；
  连接状态与 Agent authority 分离，SSE 断开不能推进或伪造终态。
- **R12**：连续 answer delta 合并为稳定正文块；相同 Tool/Subagent 生命周期按稳定 identity 就地更新，不能在状态
  变化时新增重复行或把已经阅读的正文整体跳动重排。
- **R13**：点击实际 Subagent 名称继续在右侧 Inspector 查看该任务从 durable replay 加 SSE 派生的公开活动；
  点击 Artifact/file link 查看安全预览。未调用 Subagent 时 Inspector 不提供虚构入口。
- **R14**：桌面和移动端均保留回答文档的阅读优先级；右栏空间不足时收起但保留 selection，移动端详情不得覆盖 Composer。

### C. 富文本回答

- **R15**：Assistant 正文必须使用统一、安全的富文本 renderer，至少支持语义化 `H1–H4` 标题层级、段落、粗体、
  斜体、有序/无序列表、任务列表、引用、分隔线、链接、行内代码、带语言标签的代码块和受治理的 Artifact 链接。
  标题必须有可感知的字号、字重和段前/段后间距差异，不能把 Markdown 标记直接作为纯文本显示，也不能让所有层级同字号。
- **R16**：流式回答期间富文本块应增量稳定更新；未闭合 Markdown、代码 fence、CJK 邻接强调和长链接不得造成整条消息
  闪烁、重复节点或布局跳变。完成后必须得到语义正确、可复制且可访问的文档结构。
- **R17**：富文本输入按不可信内容处理：过滤 raw HTML、脚本、事件属性、危险 URL 与任意本地路径；允许的外链使用明确
  安全策略，文件/Artifact 链接只能来自本轮已授权的稳定 reference，不从正文字符串猜测权限。
- **R18**：Think、Tool、Subagent 等执行行与富文本正文共享同一 sequence 文档流，但使用不同渲染语义；执行摘要不得
  被 Markdown 解析成标题或可执行内容，正文也不得被错误包进 Tool disclosure。

### D. 回答内表格与图表

- **R19**：当回答引用结构化结果时，可以在对应正文位置直接插入 `TABLE` 或 `CHART` Artifact block；
  Artifact 仍可点击进入右侧 Inspector 查看完整预览、来源与导出操作。
- **R20**：是否展示数据组件由结果形态和用户问题决定，而不是每次回答强制生成图表：
  - 少量标量优先使用正文或紧凑指标；
  - 明细、排名和多列比较优先表格；
  - 趋势、分组比较、构成或相关关系具备合法 encoding 时才使用图表。
- **R21**：表格至少支持列标题、类型一致的单元格、空值、总行数/当前窗口、横向滚动和大结果分页或虚拟化；
  已授权时保留 CSV/XLSX 导出。不得把全量大结果直接塞入 DOM。
- **R22**：图表 renderer 选用 VChart 的 React 集成，不再使用当前的键值文本列表。实施阶段先执行并锁定兼容版本：

  ```bash
  pnpm --filter @data-agent/web add @visactor/vchart @visactor/react-vchart
  ```

  当前仓库未安装这两个依赖，本 PRD 提交不得假装已经可 import。首批至少支持折线图、柱状图和饼/环图；
  数据合同允许时可扩展面积图和散点图。图表必须具备标题、图例或序列标签、坐标/单位、tooltip 和空状态。
- **R23**：每个图表必须提供等价的可访问数据表或摘要，支持键盘与屏幕阅读器；移动端不横向撑破回答列，
  `prefers-reduced-motion` 下禁用非必要动画。
- **R24**：内联表格/图表只读取 strict `ArtifactPreviewResult`，展示 source identity、revision、content hash、
  数据范围/截断状态和可用的来源引用。unsupported、denied、stale、hash mismatch 必须显示明确错误，不能回退到 raw Tool output。
- **R25**：模型可建议合适的图表形式，但不能直接批准数据、伪造行、改写 Artifact content hash 或绕过
  PostgreSQL/Artifact authority。图表和表格刷新后必须与同一 ArtifactReference 的右栏预览一致。
- **R26**：Web 不直接执行模型输出的任意 VChart spec。服务端/纯 projection 将 strict `CHART` Artifact 的允许字段
  映射为受控 VChart config，并限制 chart type、field binding、formatter、tooltip、theme 和 interaction；禁止函数、脚本、
  外部数据 URL 与任意 DOM handler。VChart 只作为 isolated Client leaf 消费该安全 projection，并按需加载避免扩大首屏 bundle。

### E. 旧“归因分析”退场与未来重做

- **R27**：工作空间桌面侧栏、移动导航、首页模块、Topbar 和中英文文案只保留“对话分析 / Conversation Analysis”；
  移除并列的“归因分析 / Attribution Analysis”产品入口。
- **R28**：规范入口固定为 `/w/:workspaceId/qa`。旧 `/w/:workspaceId/analysis` 及可识别的旧 deep link 必须在
  Workspace 授权校验后重定向到对话分析首页；不要求恢复旧归因结果详情，也不能落到全局页面或丢失 workspace identity。
- **R29**：历史归因 Run、结果 projection、页面专用 Artifact 和用户可见索引允许删除，不迁入统一会话列表，也不提供
  “历史归因结果”二级页。旧数据删除是已确认的产品决策，不再作为开放问题。
- **R30**：真正删除前必须由独立 destructive migration/retention 计划解析准确目标，区分“旧归因产品结果”与仍被其他能力引用的
  通用 Run/Artifact/审计/计费记录；输出影响清单、引用检查、备份或不可恢复声明、删除数量、校验查询、公开 receipt 和回滚边界。
  本 PRD 只授权需求方向，不在规划阶段执行 SQL、删除文件或清理 Artifact。
- **R31**：当前 Attribution contracts、F9/feasibility/governance runtime 与旧页面不接入新版“对话分析”。未来归因能力作为新任务
  重新做产品、合同、数据模型、Agent 工具与验收，不要求保持旧结果 payload、UI、URL 或运行流程兼容。
- **R32**：未来归因能力交付前，对话问题若明确需要正式归因结论，系统必须返回稳定的 capability-not-available / deferred 状态，
  可以提供非正式描述性分析但必须标注边界；不得调用半退场旧 runtime、伪造正式归因结论或把普通相关性图表称为归因。

### F. 事件权威、重放与多 Surface 边界

- **R33**：所有活动与内联数据 block 都由 surface-neutral、版本化的 Public Run/Artifact projection 生成；
  React、EventSource、Web route 或桌面宿主不是生命周期 authority。
- **R34**：同一 `workspace/conversation/run/sequence` identity、replay cursor、terminal closure、Agent/Tool/Artifact
  identity 可被当前 Web 和未来 Desktop/TUI adapter 消费；本版本只要求交付 Web。
- **R35**：首次加载、SSE 增量、断线重放、页面刷新和 Run terminal closure 必须通过同一个纯 assembler 得到
  等价的活动流与内联 Artifact block。

### G. 会话文件夹与多用户隔离

- **R36**：工作空间侧栏提供 DeepSeek Harness 风格的会话目录：文件夹分组、折叠/展开、会话标题、相对更新时间、
  当前选择、运行/等待提示、搜索、新建会话和新建文件夹。默认只加载当前用户自己的文件夹与对话。
- **R37**：Conversation Folder 是 workspace + owner scoped 的持久领域实体，至少包含稳定 `folder_id`、
  `workspace_id`、`owner_principal_id`、名称、排序位置、创建/更新时间和归档状态；不得使用本地文件路径作为 identity。
- **R38**：首批只支持一层文件夹，不支持递归嵌套。没有 `folder_id` 的对话进入系统“未分组”区；未分组不是可删除的
  普通文件夹，也不要求为每个用户预建数据库行。
- **R39**：用户可以创建、重命名、排序和归档自己的文件夹，把自己的对话移动到文件夹、移回未分组、重命名、排序、归档、
  恢复和删除。删除/归档文件夹不得删除其中对话，所属对话原子移动到未分组；任何目录操作都不得改变 `owner_principal_id`。
- **R40**：文件夹内默认显示最近 5 条对话并可“展开其余 N 个会话”；折叠状态、显示数量和用户选择可作为个人视图偏好，
  但 Folder membership、标题和排序必须服务端持久化并跨浏览器一致。
- **R41**：搜索同时覆盖当前可见范围内的会话标题、文件夹名称和授权的消息内容，支持取消过期请求、结果上限、失败降级与
  owner/admin scope；普通用户的搜索响应和计数不能泄露其他用户是否存在匹配内容。
- **R42**：会话行的运行、等待审批、等待回答、失败和未读完成提示必须来自真实 Run/interaction projection；隐藏的
  Subagent child conversation 不作为普通顶级对话重复列出，只通过父对话活动流和 Inspector 进入。
- **R43**：普通 `WORKSPACE_ANALYST/WORKSPACE_VIEWER` 只能列出、搜索、读取、订阅、预览、导出和管理自己拥有的 Folder、
  Conversation、Message、Run 与 Artifact。用户 A 与用户 B 即使属于同一 Workspace，也不能共享或互相发现这些资源。
- **R44**：`WORKSPACE_ADMIN` 可在当前 Workspace 的显式“全部用户”管理视图查看所有用户的文件夹和对话；
  `SUPER_ADMIN` 可在管理控制面按 Workspace/用户查看全局范围。普通日常侧栏仍默认显示管理员自己的对话，避免把管理视图
  与个人工作区混合。
- **R45**：管理员查看全部只授予读取与审计能力，不自动获得代表其他用户继续对话、修改 Folder、移动/归档/删除会话或重新
  执行 Run 的权限；任何后续管理动作必须有单独 capability、明确确认和审计事件。
- **R46**：管理员管理视图必须显示 owner、Workspace、更新时间、状态和只读标识，支持按 owner/Workspace/Folder/状态过滤；
  每次跨 owner 读取、消息/轨迹打开、Artifact 预览或导出都记录 actor、target owner、scope、reason code 和时间。
- **R47**：所有 API/RPC、PostgreSQL policy/function、列表计数、内容搜索、URL 恢复、SSE replay、trajectory、Subagent Inspector、
  Artifact Preview/Export 均执行同一 owner-or-admin 规则。无权访问统一返回不可枚举的 not-found-or-denied，
  不能通过状态码、耗时、计数或错误文案确认资源存在。
- **R48**：用户被停用、移出 Workspace 或权限撤销后，其历史 Folder/Conversation/Run/Artifact 按保留策略留在 authority，
  本人立即失去访问；Workspace Admin/Super Admin 仍可在只读管理视图审计，不得把资源静默转移给另一普通用户。
- **R49**：桌面侧栏和移动抽屉使用同一服务端目录 projection；移动端支持搜索、折叠、创建与菜单操作，拖拽排序必须有
  键盘/菜单替代操作，不能把拖拽作为唯一方式。
- **R50**：会话菜单明确提供“重命名、归档、删除”：
  - 重命名只修改当前对话标题与更新时间，不改变 conversation/message/run/artifact identity；
  - 归档是可恢复状态，默认从活跃目录和搜索隐藏，并可在“已归档”视图恢复；
  - 删除默认采用可恢复的软删除/回收站状态，需要二次确认，并从活跃、归档、搜索、URL restore 与 SSE attach 中退出；
  - Running、等待审批或等待用户回答的对话不能被无声删除，必须先取消/终止对应交互并得到 durable terminal receipt；
  - 回收站最终清除必须遵守 Artifact、审计、计费和法定保留边界，不能由 Web 直接级联物理删除。
- **R51**：会话列表动作必须具有 optimistic-free 的服务端结果：rename/archive/delete/restore 只有在 authority 提交成功后
  才更新目录；冲突或拒绝时保留当前选择和原行，展示公开错误码，刷新后不得出现幽灵行或复活已删除行。

### H. Apple 磨砂玻璃视觉与交互系统

- **R52**：本界面使用 `design-taste-frontend` 基线作为视觉验收参数：`DESIGN_VARIANCE=8`、`MOTION_INTENSITY=6`、
  `VISUAL_DENSITY=4`。桌面允许非对称三栏与留白层级；小于 `768px` 必须回落为稳定单列/抽屉，不保留造成横向滚动的非对称布局。
- **R53**：建立三层材质：底层为低饱和冷中性画布，中层为可滚动的富文本/数据文档，顶层为 Sidebar、Topbar、Composer、
  Inspector、Popover、Dialog 等玻璃表面。玻璃只用于需要空间分离或悬浮关系的层，不把每段正文和每个事件包装成玻璃 Card。
- **R54**：主要玻璃表面使用真实折射边界：半透明背景、`backdrop-filter: blur(20–32px) saturate(120–140%)`、1px 内高光边、
  微弱 inset highlight 与染色扩散阴影；禁止只加 blur、霓虹外发光、纯黑、紫蓝 AI 渐变和高饱和装饰。大容器 radius 控制在
  18–24px，小控件 10–14px，不能把所有元素统一做成夸张胶囊。
- **R55**：全局只使用一个低饱和 accent，延续 Data Agent 深墨绿；状态色仅用于语义化 running/success/warning/error，不能成为
  第二套品牌渐变。正文使用 Zinc/Slate off-black，玻璃边界和阴影按背景色调校准，亮/暗模式不混用冷暖灰。
- **R56**：界面字体沿用现有 `Geist` / `Geist Mono` token，并保留 `SF Pro Text`、`PingFang SC` 回退；软件界面禁止 Serif。
  富文本 H1–H4、正文、caption、代码和数字建立确定性 scale，首标题不能依靠超大字号制造层级，正文行宽约 65ch。
- **R57**：所有交互必须包含与最终几何一致的 skeleton loading、可操作 empty state、就地 error/retry、disabled、hover、focus-visible
  和 active feedback。按钮 active 使用不超过 1px 位移或约 0.98 scale；禁止只实现成功静态截图。
- **R58**：Motion 只动画 `transform` 与 `opacity`，布局调整优先 spring/layout transition；不得动画 `top/left/width/height`。
  持续动画仅用于真实 running 状态点与 skeleton shimmer，必须隔离在 memoized Client leaf，不能让整条会话或 VChart 持续重渲染。
- **R59**：`prefers-reduced-motion` 下停用 pulse、shimmer、stagger 和非必要 layout motion；`prefers-reduced-transparency`、
  不支持 `backdrop-filter`、低性能设备或打印场景使用高不透明实体表面，仍保持同等对比度、边界和信息层级。
- **R60**：玻璃、拖拽、VChart、Inspector resize 等交互组件必须作为最小化的 `'use client'` leaf；静态页面结构优先 RSC。
  已安装 Framer Motion 可用于必要的 spring/layout 交互，但不得为装饰引入 GSAP/ThreeJS，也不得用 React state 驱动鼠标连续位置。
- **R61**：图标统一使用已安装的 `@phosphor-icons/react` 并固定 stroke weight；代码、文案、状态和 alt text 禁止 Emoji。
  磨砂层、富文本、VChart、表格和数据 tooltip 在 1440x1000、1024x768、390x844 下均不得重叠 Composer 或产生页面级横向溢出。

## Acceptance Criteria

### Adaptive Routing

- [ ] **AC1 / Direct**：简单元数据或说明性问题由主 Agent 直接回答；运行记录没有 child task/agent event，UI 也没有
  Subagent 行、固定三 Agent 占位或空 Inspector 入口。
- [ ] **AC2 / Single**：只需要查询时仅调用 Text2SQL；Semantic、Report 不产生占位事件，刷新后仍只显示 Text2SQL。
- [ ] **AC3 / Multiple**：需要查询并形成正式报告时只显示实际 dispatch 的 Text2SQL 与 Report，sequence、依赖、状态、
  耗时和 Artifact 归属正确。
- [ ] **AC4 / Capability failure**：未被使用的 Agent 不可用不影响 Run；被选择的 Agent 不可用时返回对应公开
  `BLOCKED/FAILED`，不能自动把其他 Agent 标为完成。
- [ ] **AC5 / Audit**：每次 dispatch decision 的策略版本、selected profiles、公共 reason code 与 child task identity 可审计；
  UI 不读取或展示未选择原因的私有推理。

### Activity Stream

- [ ] **AC6**：Think、Tool/Write/Bash、Subagent、Artifact 与正文按 sequence 穿插；首次加载、两次 SSE 重连和刷新后的
  block identity/order 一致。
- [ ] **AC7**：事件行默认折叠，Enter/Space、focus-visible、屏幕阅读器状态和 focus return 完整；首层视觉密度与用户提供的
  DeepSeek Harness 截图同类，不退回卡片堆或固定流程看板。
- [ ] **AC8**：Subagent 展开只包含一层 owned Tool/Artifact；未真实调用的 Subagent 在 DOM、可访问树和 Inspector target
  中均不存在。
- [ ] **AC9**：运行、完成、失败、跳过、阻断、耗时和公开错误码均可见；SSE 连接变化不会改变权威终态。

### Rich Text And Inline Data

- [ ] **AC10 / Rich text**：同一条真实流式回答包含至少两级标题、段落、列表、引用、行内代码、代码块和安全链接；
  完成后 DOM 标题层级、字号/间距、复制文本、CJK 强调、键盘访问和窄屏换行均正确，raw HTML/危险 URL 不执行。
- [ ] **AC11 / Streaming stability**：富文本增量到达时，未闭合标题、强调和代码 fence 不产生重复正文、错误 Tool 行、
  全消息闪烁或已读区域大幅跳动；刷新 replay 后结构与完成态一致。
- [ ] **AC12 / Table**：真实 SQL 结果在回答中显示受治理表格，支持大结果窗口、横向滚动、空值、总行数、来源身份及授权导出；
  右栏预览与内联表格引用同一 ArtifactReference。
- [ ] **AC13 / Chart**：趋势或比较问题由受控 Artifact-to-VChart projection 显示真实折线/柱状/饼图之一，具有标题、单位、
  tooltip、图例/序列标签、空状态和等价可访问表格，不再只显示键值文本列表；任意模型 VChart spec、函数和外部数据 URL 被拒绝。
- [ ] **AC14 / Safety**：denied、stale、unsupported、hash mismatch 和截断均有确定性状态；任何情况都不渲染 raw HTML、
  raw Tool output 或未提交的模型数据。
- [ ] **AC15 / Responsive**：1440x1000 与 390x844 下富文本、活动流、表格、图表、Inspector、Composer 无重叠、裁切或页面级横向溢出。

### Legacy Attribution Retirement

- [ ] **AC16**：桌面/移动导航与中英文文案仅有“对话分析 / Conversation Analysis”，不存在并列“归因分析”入口。
- [ ] **AC17**：旧 `/w/:workspaceId/analysis` 在授权校验后进入相同工作空间的 `/qa` 首页；旧结果 deep link 不恢复旧详情，
  非法 workspace/deep link 不越权回退。
- [ ] **AC18**：固定旧归因 fixture 的 Run/result projection/页面专用 Artifact/索引经独立清理计划后不可再从用户 API、搜索或页面发现；
  删除 receipt、目标数量、引用校验和保留的通用审计/计费边界可复核，未误删普通 Q&A 数据。
- [ ] **AC19**：未来重做上线前，正式归因问题返回稳定 deferred/capability-not-available；系统不调用旧 runtime，普通相关性分析与图表
  不标记为正式归因结论。

### Conversation Directory And Privacy

- [ ] **AC20 / Folder operations**：用户可创建/重命名/排序/归档自己的文件夹，把自己的对话移动到文件夹或未分组；
  文件夹归档后对话仍存在且 owner 不变，刷新和另一浏览器登录后 membership/order 一致。
- [ ] **AC21 / Conversation actions**：会话菜单可重命名、归档、恢复和删除；重命名不改 identity，归档可恢复，删除需确认并
  进入回收站，Running/等待交互对话没有 durable terminal receipt 时删除失败关闭。
- [ ] **AC22 / User isolation**：同一 Workspace 的用户 A 与用户 B 各创建文件夹、对话、Run 和 Artifact 后，双方的列表、计数、
  搜索、直接 URL、messages、trajectory、SSE、Inspector、Preview 和 Export 均只能命中自己的资源。
- [ ] **AC23 / Workspace admin**：`WORKSPACE_ADMIN` 在显式“全部用户”管理视图看到当前 Workspace 所有 owner 的文件夹和对话，
  可按 owner/Folder/状态过滤并打开只读详情；返回个人侧栏后只显示管理员自己的目录。
- [ ] **AC24 / Super admin**：`SUPER_ADMIN` 可在管理控制面跨 Workspace 查询并审计，但每次跨 owner 打开/预览/导出都有完整
  actor、target owner、scope、reason code、timestamp 记录；管理员不能因只读权限代替用户发送消息或修改目录。
- [ ] **AC25 / Non-enumeration**：普通用户猜测另一用户的 folder/conversation/run/artifact ID 时统一得到 not-found-or-denied；
  HTTP 状态、响应体、计数、搜索提示和 SSE timing 不泄露资源存在性。
- [ ] **AC26 / Search and live state**：搜索覆盖当前授权范围的 Folder 名、Conversation 标题和消息内容，能取消过期请求并限制结果；
  Running、等待审批/回答和未读完成提示来自真实 projection，隐藏 Subagent 不重复出现在顶级列表。
- [ ] **AC27 / Revocation and retention**：普通用户被停用、移出 Workspace 或权限撤销后立即无法访问；历史内容仍可由管理员只读审计，
  不会静默转移给其他用户。回收站清除遵守配置的保留与 Artifact/审计约束。
- [ ] **AC28 / Responsive and accessible**：桌面侧栏与移动抽屉支持分组、展开其余会话、搜索、相对时间和全部菜单动作；
  tree/treeitem 语义、键盘操作、focus return 和拖拽替代菜单完整。

### Apple Glass Visual System

- [ ] **AC29 / Material**：Sidebar、Topbar、Composer、Inspector 与 Overlay 呈现可测的半透明、20–32px blur、内高光边与染色阴影；
  正文/表格/VChart 保持更高不透明度和足够对比度，没有紫蓝 AI 渐变、霓虹 glow、纯黑或全页面玻璃 Card 堆叠。
- [ ] **AC30 / Typography and iconography**：Geist/Geist Mono 与中文回退生效，H1–H4、正文、caption、代码和数字层级明确；
  只使用 Phosphor 图标且 stroke weight 一致，产品代码、可见文案与 alt text 无 Emoji。
- [ ] **AC31 / States and motion**：Sidebar/Conversation/Inspector/VChart 的 loading、empty、error、retry、disabled、focus 和 active 状态完整；
  动画只修改 transform/opacity，真实 running pulse 与 skeleton 隔离，不触发父级会话持续渲染。
- [ ] **AC32 / Accessibility fallback**：reduced-motion、reduced-transparency、无 backdrop-filter、打印和键盘模式均有稳定 fallback；
  玻璃关闭后信息层级、对比度、focus ring、VChart 等价表格和操作可达性不下降。
- [ ] **AC33 / Responsive proof**：1440x1000、1024x768、390x844 的真实浏览器截图与几何断言证明三栏让步、移动抽屉、Composer、
  富文本、表格和 VChart 无覆盖、裁切或页面级横向溢出。
- [ ] **AC34 / Dependency and bundle**：实施提交显式新增并锁定 `@visactor/vchart`、`@visactor/react-vchart`；VChart isolated Client leaf
  按需加载，首屏不为未显示图表下载全部交互代码，依赖缺失时构建失败而不是静默退回伪图表。

### Quality Gates

- [ ] **AC35**：contracts、Worker、Web assembler/store/components、富文本/Artifact/VChart renderer、Conversation Folder/owner policy、
  admin audit、legacy route 与 i18n focused tests 通过。
- [ ] **AC36**：Web/Worker/contracts typecheck、Biome、PostgreSQL migration/validator/static renderer 和真实浏览器纵向验收通过。
- [ ] **AC37**：DeepSeek Harness 复用台账更新到新增活动流/富文本/Conversation browser/renderer 目标；实质性复制保留 MIT notice。
  Reasonix 与 DataFoundry
  仅记录实际采用的设计边界，不虚构源码复用。

## Out Of Scope

- 展示 private chain-of-thought、Provider reasoning content、prompt、raw context、凭据或 SecretRef。
- 为每次问题固定启动 Semantic、Text2SQL、Report，或为了 UI 完整而创建无意义的 `SKIPPED` Agent。
- 在本任务重新实现归因产品、正式归因结论、F9/feasibility/governance runtime 或迁移旧归因结果；这些以后重新立项。
- 允许浏览器通过任意本地路径打开文件，或从 Tool output 猜测 ArtifactReference。
- 接受模型生成的任意 HTML/JavaScript、未校验 VChart spec、函数 formatter、外部数据 URL 或未提交的数据行。
- 在本版本交付 Desktop、TUI、ACP server、通用 Dashboard Builder、高级图表编辑器或无限层级 Agent lineage。
- 复制 DeepSeek Harness、Reasonix、DataFoundry、Codex 或 Apple 的品牌资产、私有协议或完整产品外观；Apple 只定义材质语言。
- 在普通用户之间共享/转让 Folder、Conversation、Run 或 Artifact，或提供公开链接/匿名访问。
- 首批实现递归文件夹、多选批量删除、由管理员默认代替用户操作，或绕过保留策略的即时物理清除。

## Migration And Compatibility Constraints

- 旧归因产品执行退场而非兼容迁移：入口删除、旧 URL 回到 `/qa` 首页、历史结果允许清理，未来重做不继承旧 payload/UI。
- “允许删除”不等于使用宽泛 SQL 或文件 glob。实施计划必须先解析被旧功能独占的表/行/Artifact/index、外键和引用者，
  分批删除并给出精确 before/after 计数；通用 Q&A Run、计费、身份、安全审计和其他领域共享 Artifact 不在默认删除范围。
- 若法规、审计或不可变 Ledger 阻止物理删除，实施必须明确列为保留例外并从所有用户投影移除；不得伪称物理删除成功。
- 新对话公开事件/投影继续版本化并严格失败关闭，不能用前端字符串解析修复 identity。
- 现有 `qa_conversations.owner_principal_id` 是会话所有权基础；Folder、搜索、SSE、Artifact 与 admin-read projection
  必须补齐同一 principal identity 与 owner-or-admin 验证，不能用仅 Workspace scope 的列表查询代替。
- 既有会话在 Folder 功能上线时默认进入其 owner 的“未分组”，不创建共享文件夹，也不改变历史 owner。

## Open Product Question

- **OQ1 — 对话删除保留策略**：推荐会话先进入可恢复回收站，默认保留 30 天，之后由后台保留任务按审计/Artifact/计费约束清除；
  另一种方案是永久软删除、只允许管理员执行最终清除。无论选择哪种，Web 都不直接级联物理删除权威记录。

## Relationship To Previous Delivery

- 本 PRD 是 `08-18-qa-team-agent-status` 的后续产品版本，不回写或伪装已归档任务的验收结果。
- 后续若批准实现，应重新拆分为：自适应 Team 调度合同/runtime、活动流与富文本修订、Apple 玻璃视觉系统、
  VChart Artifact renderer、私有会话文件夹与管理员审计、旧归因入口/结果退场与 destructive migration 验收。
- 本文获批前不得运行 `task.py start` 或修改产品代码。

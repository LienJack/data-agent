# Apple OpenAI 蓝色全站前端重构

## Goal

将 Data Agent 全站升级为 Apple 式空间层级与物理反馈、OpenAI 式内容优先工作台，并采用兼顾飞书清晰度与 DeepSeek 沉稳感的 Data Agent Blue 主题。保留现有业务组件、数据流、RBAC、审计、语义权威和公开 Agent 事件边界。

## Background

- 当前前端已有高密度运营工作台基线、Q&A 玻璃材质和 390px 响应式约束。
- `globals.css` 与 `design-system.css` 存在重叠 token，组件中仍有大量直接色值与不一致圆角。
- 已安装并允许使用 Tailwind CSS 4、Framer Motion 13 与 Phosphor Icons。
- 用户已经评审并批准页面级改造方案与 `#3f63e8` 主蓝方案。

## Requirements

- R1：主色使用 `#3f63e8`，hover `#315bd8`，pressed `#2647a8`；成功、警告、失败保留独立语义色。
- R2：蓝色只用于主操作、选中、焦点、链接和进行中状态，禁止大面积品牌蓝、蓝紫渐变、外发光与纯黑。
- R3：全站收敛为 Canvas、Reading Surface、Floating Chrome 三层材质；玻璃仅用于导航、Composer、Inspector、Sheet 和 Popover。
- R4：建立字号级 tracking、统一圆角、阴影、焦点、press、spring、reduced motion/transparency/contrast 合同。
- R5：全局导航与页面上下文导航分离；Q&A 会话目录不污染非 Q&A 页面。
- R6：覆盖登录、Workspace、QA/Analysis、Semantic、Knowledge、Data Sources、Tests、Jobs、Members、Settings 和 Admin 页面族。
- R7：所有页面保留真实 Loading、Empty、Error、Permission 状态，不伪造业务状态或 authority。
- R8：业务组件和服务端合同保持兼容；视觉重构不得改变 Provider、RBAC、审计、发布与确定性 Oracle 边界。
- R9：桌面与移动端无页面级横向溢出；动画只使用 transform/opacity 并可被 reduced-motion 替代。

## Acceptance Criteria

- [ ] 1440、1024、768、390px 关键页面视觉验收通过，`scrollWidth === clientWidth`。
- [ ] 蓝色 token、材质、字体、圆角、阴影和 motion contract 由统一设计系统提供。
- [ ] 全局 Shell、五个页面族子任务全部完成并各自验证、提交、归档。
- [ ] Q&A 公开 Think/Tool/Subagent 默认折叠且不暴露私有推理、凭据或 Provider 原始载荷。
- [ ] Web unit、typecheck、production build 通过；相关 accessibility 与 CSS contract 测试通过。
- [ ] 每个子任务只暂存 owned paths，不包含当前 resolution-trace、生成物或其他并行修改。

## Out Of Scope

- 不修改数据库、API、Provider、Agent Runtime、语义元模型或权限合同。
- 不复制飞书或 DeepSeek 的 Logo、商标与完整品牌识别。
- 不引入新的 UI、图标或动画依赖。
- 不在首轮加入装饰性磁吸按钮、视差或全屏持续动画。

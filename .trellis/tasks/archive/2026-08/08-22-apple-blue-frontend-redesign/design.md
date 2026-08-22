# Technical Design

## Architecture

重构沿用现有 Next.js App Router 和 Workspace route shell。视觉权威集中在 `apps/web/src/app/design-system.css`；`globals.css` 只保留 Tailwind 引入、兼容 token 与少量基础层。基础组件通过语义 class 消费 token，页面不得重新定义蓝色、玻璃和阴影数值。

页面结构分为：全局 Shell、入口/Workspace、QA/Analysis、Semantic/Knowledge、Operations/Admin 五个独立交付单元。服务端组件继续负责身份和初始数据，交互叶节点才使用 `use client` 与 Framer Motion。

## Visual Contracts

- Palette：冷中性灰 + 单一 Data Agent Blue；状态色不计入品牌 accent。
- Material：Canvas -> Reading Surface -> Floating Chrome，不叠加半透明浅层。
- Motion：press 90-120ms；常规切换 160-180ms；Sheet/Inspector 使用无弹跳 spring 0.3-0.4s；动量手势才允许轻微 overshoot。
- Typography：系统字体优先，中文 PingFang SC；ID/时间/SQL/数值使用 mono；tracking 随字号变化。
- Accessibility：所有 icon button 有 accessible name；支持 reduced motion、transparency、contrast；焦点环不依赖颜色之外的状态。

## Compatibility

- 保留现有 class 名兼容层，先迁移 primitives 与 Shell，再逐页消除直接色值。
- 不改变 route、DTO、store、API 调用和 RBAC 判断。
- Framer Motion 与 Phosphor 已存在，不增加依赖。
- 深色主题 token 在设计系统中预留，完整 dark visual acceptance 放在最后一个子任务。

## Rollback

每个子任务独立 commit。发现视觉或行为回归时仅回退对应子任务 commit；不重写历史，不影响其他并行工作。

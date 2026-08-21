# 规范外部开源项目源码阅读流程

## Goal

为 Data Agent 的设计、实现和研究工作建立一份跨包源码阅读规范：当任务涉及其他开源项目时，优先利用 Understand Anything 知识图谱缩小阅读范围，再回到固定提交的当前源码、测试与运行证据完成核验，避免把图谱摘要或 README 当成实现证明。

## Background

- 仓库已有多次使用 `.ua/knowledge-graph.json` 或旧版 `.understand-anything/knowledge-graph.json` 阅读参考项目的实践，但尚未形成统一指南。
- `understand-anything:understand-chat` 要求先检查图谱提交与目标项目当前 HEAD、已提交差异、暂存/未暂存/未跟踪文件，并把图谱仅作为相关子图导航。
- `.trellis/spec/guides/` 是跨包思考与工作方法指南的现有归属。

## Requirements

- R1：新增一份中文跨包指南，覆盖适用场景、开始前检查、推荐阅读流程、证据等级、产出要求与提交前清单。
- R2：明确 `understand-anything:understand-chat` 是已有且足够新鲜的知识图谱存在时的优先入口，不把它规定为所有外部源码问题的硬性前置步骤。
- R3：明确图谱目录解析与新鲜度检查，包括固定提交、项目范围差异以及排除 `.ua/` / `.understand-anything/` 生成物。
- R4：明确图谱只用于定位节点、依赖边和架构层；能力、行为、兼容性和可运行性结论必须由目标项目当前源码、测试、配置或运行结果支撑。
- R5：要求研究记录包含目标仓库、分支或固定提交、工作区状态、图谱状态、关键源码证据、未验证边界，以及对 Data Agent 的“采用/改造/拒绝”判断。
- R6：补充许可证、密钥与私有数据、目标仓库只读、禁止回退他人改动等安全边界。
- R7：在 `.trellis/spec/guides/index.md` 中登记新指南并增加可扫描的触发清单。

## Out of Scope

- 不生成或刷新任何外部项目的知识图谱。
- 不修改任何外部开源项目 checkout。
- 不规定具体参考项目，也不对某个开源项目做新的能力审计。
- 不改变产品代码、测试或运行配置。

## Acceptance Criteria

- [x] `.trellis/spec/guides/` 下存在可独立阅读的外部开源项目源码阅读指南。
- [x] 指南清楚区分“图谱导航证据”和“源码/测试/运行证明”。
- [x] 指南给出图谱存在、新鲜、陈旧、缺失四种情况的处理方式。
- [x] 指南要求按固定提交记录证据，并包含目标仓库只读、许可证和敏感信息边界。
- [x] `guides/index.md` 能从目录和触发清单发现该指南。
- [x] Markdown 链接与格式通过人工检查，且提交只包含本任务拥有的 Trellis 任务文件和指南文件。

## Technical Notes

- 本任务为轻量文档任务，PRD-only；不需要 `design.md` 或 `implement.md`。
- 指南应使用能力名 `understand-anything:understand-chat`，避免依赖单台机器上的绝对安装路径。
- 若图谱缺失或明显陈旧，规范允许直接做窄范围源码阅读；刷新图谱需由用户或任务范围另行授权。

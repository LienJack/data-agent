# TIS 本体实践定向语义重构

## Goal

在 V2-only、无兼容层、无旧数据迁移前提下，吸收 TIS 的确定性词汇解析、绑定影响候选与可解释治理门禁。

## Requirements

- PostgreSQL Published Semantic Release 继续作为唯一运行时语义权威；不得复制 TIS 的 ObjectType、
  Property、XML/file authority、通用 LINKED_TO 或 ChatBI SQL 执行链。
- 发生结构变化的语义契约只有一个当前版本，并直接删除被替代的 schema、export、consumer、fixture
  和 runtime path；结构未变化的独立协议不做机械版本号翻新。不提供 dual read/write、adapter、
  alias、旧实现 fallback 或旧数据迁移。
- 先交付 exact-release lexical evidence 与显式消歧；知识/向量召回只有经过量化门禁后才实施，且
  只能产生候选证据。
- Schema drift 只能生成 append-only binding impact receipt/Candidate；禁止自动重绑和自动发布。
- Studio/Explorer 必须复用唯一 Workspace 路径与现有 Candidate 治理流程；只读证据与写入权限分离。
- 每个子任务先验证、一个 scoped commit、归档并记录 journal；不得纳入并行脏文件或 Falcon 产物。

## Acceptance Criteria

- [x] TIS 主方案及阶段文档与 V2-only 决策一致，不再出现兼容层、双读、V1 fallback 或数据迁移要求。
- [x] 发布词汇证据、优先级、歧义、hash、release scope 与 fallback reason 均有 strict typed contract。
- [x] 当前 resolver 只从精确 Published Release 解析，未发布、跨 workspace/release 与陈旧投影 fail closed。
- [ ] Drift 能产生确定性、幂等、不可自动发布的 binding impact artifact 与 Candidate 引用。
- [ ] Studio 展示安全证据和治理状态；Explorer 对只读角色可用，API/DOM 不暴露敏感载荷。
- [ ] Contracts、Semantic、Platform、Web、Falcon/Test Center 与浏览器验收通过，被替代的旧语义路径引用归零。

## Notes

- 参考：`docs/plans/2026-08-23-001-refactor-tis-ontology-adoption-plan.md` 与
  `docs/plans/tis-ontology-adoption/*.md`。
- 已提交施工基线：`858446e`。
- 顺序：M0 → M1；M3 可在 M1 后独立推进；M2 必须由 M1 的缺口数据批准；M4 只实现已交付能力。

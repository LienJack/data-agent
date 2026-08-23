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
- [x] Drift 能产生确定性、幂等、不可自动发布的 binding impact artifact 与 Candidate 引用。
- [x] Studio 展示安全证据和治理状态；Explorer 对只读角色可用，API/DOM 不暴露敏感载荷。
- [x] Contracts、Semantic、Platform、Web、Falcon/Test Center 与浏览器验收通过，被替代的旧语义路径引用归零。

## Notes

- 参考：`docs/plans/2026-08-23-001-refactor-tis-ontology-adoption-plan.md` 与
  `docs/plans/tis-ontology-adoption/*.md`。
- 已提交施工基线：`858446e`。
- 顺序：M0 → M1；M3 可在 M1 后独立推进；M2 必须由 M1 的缺口数据批准；M4 只实现已交付能力。

## Verification Evidence

- 子任务均按 scoped commit → archive → journal 收口；核心工作提交包括 M1 `c7d71f2`、M2
  `963c06d`、M3 `a11475e` 与 M4 `7361284`。M2 因缺少 M1 后同源词法缺口数据维持
  `NO-GO`，没有预建兼容路径、provider、向量库或空 UI。
- Contracts 全量 82 files / 862 tests、Semantic 全量 22 files / 144 tests、Platform M3 PostgreSQL
  3 tests、Web 全量 112 passed + 1 skipped files / 428 passed + 1 skipped tests 均通过；Web production
  build 通过，仅保留 6 条既有 filesystem tracing warning。
- 父级 `pnpm typecheck` 通过 16/16 workspace tasks；`pnpm verify:release` 强制重建 Web、Worker、
  Relationship Indexer 与 Semantic Authoring 后返回 `GO / RELEASE_READY`。
- Falcon/Test Center 固定 oracle、dataset、tuning、team runner、Web boundary 与 V2 migration/ontology
  测试共 9 files / 37 tests 通过；V2-only architecture 与 Falcon semantic accuracy summary 另有
  2 files / 7 tests 通过。B2 明确保持 `DEFERRED / M2_GATE_NO_GO`。
- 真实登录浏览器验证只读 Context Preview：返回 `NEEDS_CLARIFICATION`、3 条 lexical evidence、
  3 个无默认候选；键盘选择只改变本地 radio，未产生 Candidate/Revision/Publish/Resolve 写请求；
  desktop 与 390px 均无横向溢出。旧本地数据未迁移，Binding Impact 无 receipt、旧投影不一致时按设计
  fail closed；其 API/DOM/deep-link 由 route、strict decoder、SSR 与纯状态测试覆盖，不伪造运行证据。
- 生产源码扫描未发现 `semantic-source-bundle@1`、V2→V1 bridge、V1 fallback、dual read/write 或
  legacy semantic runtime；唯一文字命中是退役扫描器自身的 forbidden-pattern 正则。
- 仓库级 `pnpm lint` 仍报告 16 errors / 49 warnings，命中 attribution 等本任务未触碰的既存文件；
  本任务全部 owned files 的定向 Biome、`git diff --check` 与 cached diff check 均通过。

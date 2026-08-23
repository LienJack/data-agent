# M1 当前发布词汇解析

## Goal

以唯一当前契约实现 Published Release lexical evidence 与 exact-first resolver，删除被替代的 resolved-context schema/RPC/consumer。

## Requirements

- 只升级结构发生变化的 authority snapshot、route decision 与 package；request、receipt、commit、
  capacity 与 Text2SQL binding 的 shape 未变化，保留其现有版本。升级的 contract 不保留旧 parser。
- Authority Snapshot 从精确 Published Semantic Release 投影 canonical、alias、preferred、synonym、
  abbreviation lexical entries；`RELATED` 不产生等价命中。
- 解析优先级固定为 canonical → preferred → alias/synonym → abbreviation；只比较最高命中层，同层
  多对象必须 `NEEDS_CLARIFICATION`，不得保持旧的 metric-first 静默选择。
- 每条 selected/clarification lexical evidence 绑定 release identity、target、term、match kind、规范
  phrase 与可验证 hash，并按稳定 key 排序。
- PostgreSQL 10705 原位替换稳定 load/commit RPC 的当前实现；不新增 `_v2` 双 RPC，不搬运、回填或
  双写历史 receipt。
- Knowledge/Graph 仍是当前 typed degradation；本任务不实现向量召回或无界图遍历。

## Acceptance Criteria

- [x] strict contract 拒绝重复/乱序 lexicon、hash 篡改、release mismatch、RELATED runtime entry 与未知字段。
- [x] resolver 覆盖中英文规范化、canonical/preferred/alias/synonym/abbreviation、同层歧义、不可查询对象、
  无 mapping、未命中与输入顺序稳定。
- [x] Resolved Context package evidence 包含 selected lexical evidence，capacity/hash/receipt closure 保持确定性。
- [x] Platform 继续只调用一组稳定 RPC；数据库实现只接受当前 Snapshot/Route/Package，未创建双 RPC。
- [x] Contracts/Semantic/Platform/Web/Text2SQL 定向测试、相关 typecheck、migration renderer/static 与 PostgreSQL 17 定向 smoke 通过。
- [x] `rg` 证明运行时代码与测试中不存在被替代的 Snapshot/Route/Package 旧 schema；结构未变协议除外。

## Notes

- 父任务：`08-23-tis-directed-semantic-refactor`；基线 `858446e`，M0 `760f35b`。
- 不修改 10663/10664 历史 migration；10705 是 forward-only current schema replacement。
- Text2SQL binding 结构不变，不做无价值的版本号变更；它只能引用当前 package/receipt authority。
- 全量 PostgreSQL smoke 的本次 migration 与 postcondition 已通过；后续既有 `19z-workspace-data-isolation`
  夹具因 `CONVERSATION_RESOURCES_REQUIRED` 停止，与本任务无关。过滤到 41 的完整安装与断言通过。

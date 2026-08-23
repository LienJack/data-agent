# Graph v2 合同、编译器与持久化 PRD

## Goal

建立一套可发布、可版本化的 `SemanticGraphSource@2`，使业务主体、维度、指标、公式、物理表
和支撑物理列拥有独立 Node identity，所有跨对象含义由独立 Edge 表达，同时保持现有查询运行时
和历史 release 可兼容读取。

## Scope

- Graph v2 Node/Edge/registry/Formula AST/diff/patch 合同。
- PostgreSQL source、candidate、release-bound graph projection 与窄写入服务。
- Graph v2 canonicalization、校验和到现有 runtime projection 的确定性 compiler。
- 旧 Graph v1 合同只读兼容；本子任务不执行批量 v1→v2 上线迁移。

## Requirements

- Node payload 只能包含固有属性；Metric/Dimension/BusinessSubject/Formula 不得内嵌跨 Node ID、
  表列 binding 或关系数组。
- Formula AST 以本地 slot 表达引用，稳定依赖身份只由 Edge 绑定。
- Edge type 使用 release-bound registry，不使用每个业务关系一个数据库 enum/column。
- Source revision 与 candidate revision append-only；Node/Edge version 单调增加，mutation 使用
  expected working revision + entry digest/CAS。
- Graph v2 必须确定性生成现有 `SemanticSourceBundle@1` 和原生 graph projection。
- PhysicalTable/Column 与物理结构 Edge 是 schema snapshot 管理的只读事实；Agent-authored graph
  操作不能伪造它们。
- PostgreSQL 是 Authority；规范化 Node/Edge 表为 release/candidate-bound 的可重建投影。
- 旧 release bytes/digest 和现有 Query Run 不得被就地修改。

## Out of Scope

- Agent 多轮工具循环、前端图渲染、community 计算、批量发布迁移。
- 任意 SQL/Python Formula、通用 OWL/SHACL reasoner、硬删除。

## Acceptance Criteria

- [x] 严格合同覆盖六种 Node identity、Edge registry、Formula AST slot 与 graph patch。
- [x] intrinsic-only linter 拒绝 Metric 内嵌 formula/table/column/dependency，拒绝悬空或非法 Edge。
- [x] Formula slot 未绑定、重复绑定、类型/unit/grain/cycle/fanout 冲突失败关闭。
- [x] 同一 Graph v2 fixture 多次编译得到相同 canonical digest 和 runtime projection。
- [x] Graph v2 正例可被现有 Query Runtime 消费，Graph v1 fixtures 保持兼容。
- [x] 超出现有 runtime compatibility profile 的多义关系失败关闭，不静默挑选一条 Edge。
- [x] 新增业务 Node/Edge 不需要新业务列或数据库 enum migration。
- [x] migration/RLS/RPC 测试证明只有服务端候选路径可以写 projection/revision。

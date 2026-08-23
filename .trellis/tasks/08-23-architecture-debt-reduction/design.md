# 两阶段架构债治理设计

## 边界

- 权威边界不变：PostgreSQL 是持久化和语义权威；Neo4j/索引是可重建投影；AI 不能审批、发布、回滚或改变授权。
- 这是结构和演进机制重构，不改变对外业务语义、Run/Event/Artifact 合同或数据库历史。
- 采用增量收缩：先建立可执行门禁，再迁移消费者；不以一次性全仓重写换取表面整洁。

## 交付拓扑

1. `architecture-retirement-ledger` 建立所有后续删除/保留判断的机器权威。
2. `generic-migration-renderer` 收敛迁移工具重复，冻结历史例外。
3. `contracts-subpath-exports` 将内核公共面从单一根 barrel 转为领域子路径，并阻止新增根耦合。
4. `qa-application-boundaries` 在 Web 内建立明确的 application/use-case 与流式状态边界。
5. `unified-runtime-config` 统一 dotenv、规范变量和旧别名归一化。
6. `demo-benchmark-isolation` 将电商专用能力从通用运行时移到显式 Demo/Eval adapter。
7. `platform-subpath-exports` 用基础设施子路径和门禁收缩 Platform 根公共面。

## 兼容与回滚

- 已发布合同保持兼容；本轮收缩的是源码导入面，不改变运行时 schema identity。
- 已执行迁移保持字节不变；通用渲染器必须用 `--verify` 证明等价。
- 每个子任务独立 commit，可按提交逆序回滚；禁止 squash/amend 既有提交。
- 合并前使用 `git merge-tree --write-tree` 或等价只读预检检查与主工作树真实重叠。

## 验证层级

- 单元：解析器、门禁、配置归一化、状态机、adapter。
- 合同/架构：包出口、依赖方向、迁移 inventory、退役 surface。
- 包级：受影响 package build/typecheck/test。
- 集成：Q&A Run 创建与 Worker 执行链、迁移全量 verify。
- 合并后：强制重建受影响 workspace package，避免 stale `dist` 误判。

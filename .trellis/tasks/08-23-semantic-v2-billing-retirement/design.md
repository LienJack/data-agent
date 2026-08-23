# 语义 V2-only 与计费退役设计

## 边界

```text
Web / Worker composition
  -> Semantic application use cases
     -> Semantic deterministic kernel
     -> versioned Contracts Ports
  -> Platform PostgreSQL / Neo4j adapters
  -> non-commercial Model Control / Provider gateway
```

- PostgreSQL 保存 Source、Revision、Candidate、Release、Job、Receipt 与授权事实。
- Neo4j/Relationship Index 是可删除投影；不可用时显式回到 PostgreSQL Authority。
- Preview/Published 使用同一份 V2 runtime content，由不同 Authority envelope 表达生命周期。
- Model Control 只保存 provider/model/credential reference/technical readiness；不保存价格或账务字段。
- 历史账务表只读冻结，生产代码、RPC、Route、Worker 和 UI 不再产生或消费商业状态。

## 单一当前代规则

- `REPLACE_WITH_CURRENT`：V1/V2 双代合同在消费者全部切换后删除 V1。
- `DELETE`：legacy equivalence/closure、Billing、旧 route 直接删除，不改名保留。
- `KEEP_CURRENT`：单代且语义正确的合同保留当前 wire version，但只有一个受控 export。
- `MOVE_AS_CURRENT`：Model Control 从 Billing/Pricing 原子移出，旧 import/export 同提交删除。
- 合入态不得包含兼容 adapter、re-export、dual read/write、redirect、410 tombstone 或隐式 composition fallback。

## 数据与发布顺序

1. U1 建立 consumer/surface/migration inventory 和 architecture guards。
2. U2–U4 切换 Model Control，移除金额门禁和 Billing 代码。
3. U5 应用 `10700`，撤销/删除计费 mutation，冻结历史表。
4. U6 应用 V2-only 合同与 `10701`，直接删除 V1-only objects/rows。
5. U7–U8 统一用例/runtime，拆分 UI 并删除旧入口。

每个单元内部可按依赖顺序编辑，但只有旧 surface 已删除、目标测试通过后才创建 scoped commit。

## 安全与失败关闭

- Route 必须从服务端 Workspace capability 解析 scope；请求声明不能自证 Authority。
- Candidate/Model 输出作为 `unknown` strict parse，不能直接提交 Release。
- Migration 使用明确 app/environment/greenfield preflight、`ON_ERROR_STOP`、窄 grant 与完整 catalog postcondition。
- Credential、Provider raw payload、SQL result 和商业敏感数据不进入日志或公共 receipt。

## 回滚

- 未部署单元通过完整 commit 回退，不恢复兼容入口。
- `10700` 不提供自动 reverse；旧写路径因撤权继续失败关闭。
- `10701` 不恢复 V1；失败环境以干净 V2 数据库重建。

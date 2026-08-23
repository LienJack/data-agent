# U6 落地 V2-only 语义合同与编译链

## Goal

建立唯一 V2 语义 runtime content、compiler、Ports 和数据库最终状态，删除全部 V1 与 legacy governance surface。

## Requirements

- 覆盖 R1–R3、R6、R7、R16；业务对象/维度/指标/公式/关系/物理绑定不得丢失。
- Graph V2、U5/compiler lowerers、Analysis Context 全部直接消费 V2，不调用 V2→V1 projection。
- Preview/Published 使用同一 V2 content，不同 Authority envelope；Candidate 不能直接 publish。
- 删除 V1 schema/type/helper/export/fixture/test/data object 及 legacy equivalence/mirror/closure 字段。
- `10701` 直接删除 V1-only objects/rows，不 backfill/migrate V1 数据。

## Acceptance Criteria

- [ ] 干净 V2 fixture 完成 Authoring→Candidate→Preview→Review→Release→Explorer/Context/Index 全链。
- [ ] V2 invariants 原生验证，缺分析元数据 fail closed 且不生成默认或 V1 投影。
- [ ] V1/legacy symbol、V2→V1、root compatibility export 和生产 V1 data dependency 为 0。
- [ ] `10701` fresh/fixture/scope mismatch 测试与 PostgreSQL smoke 通过。
- [ ] 单代正确 `@1` 合同保持 wire identity，只有破坏性重设计合同升版。

## Notes

- 依赖：U1、U5。

# U7 统一语义用例与生产运行时

## Goal

把语义应用用例移入 Semantic package，拆分 Platform Adapter，并让 Web/Worker 只使用显式 Workspace/job composition。

## Requirements

- 覆盖 R2、R4、R5、R8、R16。
- Candidate compile/save、Governance、Studio、Explorer 用例通过 Contracts Ports 运行，不依赖 Next/Postgres client。
- Platform 每个 Adapter 对应一个 Port/aggregate，不持有跨步骤 workflow。
- 删除 global runtime getter、mock backend env switch、缺省 runtime 参数和重复 endpoint。

## Acceptance Criteria

- [x] Memory fake 与 PostgreSQL adapters 通过相同 use-case conformance fixture。
- [x] Route 在 SQL/use case 前验证 workspace/capability，缺配置 fail closed。
- [x] AI Candidate 无法绕过 Review Publish；publish/rollback/explorer/search 跨层集成通过。
- [x] 所有生产 Semantic route/job 使用唯一 Workspace/job composition，旧 endpoint 默认 404。
- [x] Web semantic service 仅剩 transport mapping 或被删除。

## Notes

- 依赖：U6。

# U7 实施

1. [x] 为 Web 现有 use cases 补 characterization 和 Port conformance fixture。
2. [x] 逐用例迁入 Semantic application，拆分对应 Platform adapters。
3. [x] 切换 Workspace/Worker composition 和 routes，移除 default/global/mock runtime。
4. [x] 合并 candidates/inbox 等价 endpoint，同单元切 Studio 后删除旧 route。
5. [x] 运行 semantic/platform/Web integration、RBAC/404/forbidden tests，提交 scoped commit。

## Verification

- Contracts build 与 Contracts/Platform/Semantic/Worker/Web typecheck 通过。
- Web 15 files / 65 tests、Worker 3 files / 8 tests、Semantic 4 files / 17 tests 通过。
- Architecture scans 证明无 Mock backend、default/global semantic runtime、旧 getter 或 App 内 use-case import。
- 全量 Semantic 历史 fixture 中仍有 V1 preview/sidecar 断言，归 U8 遗留 UI/入口清理任务处理。

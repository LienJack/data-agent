# 两阶段架构债治理实施顺序

## 前置

- [ ] 记录当前 `dev` commit、dirty paths、任务树和架构基线。
- [ ] 提交本任务规划文件；创建 `refactor/architecture-debt-reduction` 隔离 worktree。
- [ ] 每个子任务开始前读取其 PRD、design、implement 和适用 Trellis specs。

## 第一阶段

- [ ] 完成 `08-23-architecture-retirement-ledger`，运行目标测试并提交。
- [ ] 完成 `08-23-generic-migration-renderer`，验证所有迁移输出字节等价并提交。
- [ ] 完成 `08-23-contracts-subpath-exports`，运行 contracts/architecture/typecheck 并提交。
- [ ] 第一阶段集成检查通过后才能进入第二阶段。

## 第二阶段

- [ ] 完成 `08-23-qa-application-boundaries`，验证 Route/Store/流式恢复并提交。
- [ ] 完成 `08-23-unified-runtime-config`，验证 Web/Worker/CLI 配置等价并提交。
- [ ] 完成 `08-23-demo-benchmark-isolation`，验证电商 Demo 和通用 Run 路径并提交。
- [ ] 完成 `08-23-platform-subpath-exports`，运行 platform/architecture/typecheck 并提交。

## 收尾

- [ ] 运行全范围架构、类型、单元、合同和迁移验证。
- [ ] 执行 Trellis check/update-spec/finish-work；确认每个子任务 commit。
- [ ] 预检并合并隔离分支回 `dev`，恢复并比对原 dirty paths。
- [ ] 合并后强制重建受影响包并复跑关键门禁。

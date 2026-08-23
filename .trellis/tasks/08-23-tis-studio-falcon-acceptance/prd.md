# M4 Studio 与 Falcon 验收

## Goal

将 M1 词汇证据与 M3 绑定影响接入现有 Studio/Explorer 安全投影，并建立不夸大 M2 能力的 Falcon 语义准确性摘要，完成合同、Web 与浏览器非回归验收。

## Requirements

- Context Preview 展示规范名、首选词、别名/同义词、缩写的 match kind、matched phrase、target 和 exact Published Release reference；不得展示 raw prompt、SQL、rows、DSN、SecretRef 或 provider payload。
- 同名歧义不静默选择。候选使用原生键盘可达选择控件，选择只改变本地检查状态，不创建 Run、Candidate 或语义写入；Preview 本身只要求 Workspace READ capability。
- 新增唯一 Workspace-scoped Binding Impact GET route，复用 `authorizeWorkspaceRequest`、现有 Semantic application service 与 PostgreSQL safe projection；Route 不直连 RPC，不返回完整 plan、drift payload、Candidate diff/source 或 package JSON。
- Explorer 从 `impactId + domain` 深链读取影响摘要，显示风险、直接/传递影响数、建议动作、人工原因、exact release 和 Candidate review 状态；有 Candidate ref 时复用现有 Candidate comparison，不建立第二套编辑/审批/发布入口。
- 新增当前语义路径的 Falcon 评估摘要合同：B0 exact、B1 lexical 是可比较 lane；B2 governed retrieval 因 M2 NO-GO 明确 DEFERRED。合同必须绑定同一 corpus/source/release，报告路由 outcome、exact regression、安全计数和 hash，不允许把未评估 lane 记为通过。
- 保持固定白蓝界面、bounded DOM、390px 无横向溢出、loading/empty/error/stale/permission/a11y 状态；不加入深色主题类或无关动画。
- 不修改 M2 运行时，不增加兼容层、版本切换、dual route、旧数据迁移或自动发布能力。

## Acceptance Criteria

- [x] Context Preview 的 lexical evidence、exact release、澄清候选和五种服务端状态都有测试，澄清候选无默认选择且键盘可达。
- [x] Preview Route 只使用 READ capability，strict body 未知字段失败关闭，关闭/查看页面无语义写入。
- [x] Binding Impact Workspace route 对 READ 角色可用，显式校验 domain/impact ID，跨 workspace/domain 与未知/敏感字段失败关闭。
- [x] Explorer 能从 impact deep link 展示 safe summary，并复用 Candidate comparison 显示 DRAFT/stale/验证前状态。
- [x] API、DOM 与测试 fixture 不包含 raw prompt、raw SQL、parameters、rows、DSN、SecretRef 或 provider payload。
- [x] Falcon 语义摘要拒绝 corpus/release 换绑、B1 exact 回退、静默歧义、跨 release/未授权命中、非零安全计数及伪造 hash；B2 保持 `M2_GATE_NO_GO`。
- [x] Contracts、Semantic/Platform 既有 M1/M3 回归、Web unit/typecheck/build 与浏览器桌面/390px 验收通过。
- [x] 变更使用单个 scoped commit，可独立回退且不纳入并行脏文件或 Falcon 临时产物。

## Notes

- M4 只接入已经交付的 M1/M3 能力；M2 结论见已归档任务 `08-23-tis-governed-retrieval-gate`。

## Verification Evidence

- Contracts：82 files / 862 tests；Semantic：22 files / 144 tests；Platform Binding Impact adapter：1 file / 3 tests；全部 typecheck 通过。
- Web：112 passed + 1 skipped files，428 passed + 1 skipped tests；production build 通过并包含唯一 Workspace Binding Impact route。6 条 Turbopack filesystem tracing warning 均来自既有 bootstrap/root-env/Test Center installer。
- 浏览器真实登录会话通过只读 Preview API 获得 `NEEDS_CLARIFICATION`、3 条 lexical evidence、3 个无默认候选；方向键只选择 1 个本地 radio，资源记录中无 Candidate/Revision/Publish/Resolve 写请求。
- 1280px 与 390px light/reduced-motion 验收均无横向溢出；390px `scrollWidth === innerWidth === 390`，词汇证据与 exact release 可见。
- 本地 Binding Impact receipt 表为空，旧开发 Explorer projection 在 v2-only 后按 Authority 失败关闭；未伪造生产 receipt。Deep link 域绑定、strict GET route、safe summary 和 Candidate comparison 复用由纯函数、route、API 与 SSR 组件测试覆盖。

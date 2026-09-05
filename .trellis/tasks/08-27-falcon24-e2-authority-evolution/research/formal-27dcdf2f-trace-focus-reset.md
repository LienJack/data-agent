# 27dcdf2f Trace 选择被等价刷新覆盖

## 1. 根因分类

- **E / 隐含假设 + D / 覆盖缺口**：URL focus 对应的派生 record 引用被当成稳定身份。`traces` 换成等价数组后，
  Workbench model 重建，`useEffect([focused])` 再次把手动选择覆盖成 URL 中的终态事件。
- 工作假设最初为 UI 重置 60%、点击传输 35%、详情身份漂移 5%（诊断权重，非统计结论）。原页面节点存在，
  手动点击可加载 exact detail；独立真实 React 组件复现把判断收敛到对象引用依赖，而非 Provider 或业务问题。
- 原浏览器 RED：初始节点 7 → 点击节点 6 → 等价 props 刷新后回到节点 7。修复后保留节点 6。
  原 API、模型、SQL、Authority、Oracle、v9 题面、观察器等待预算均未修改。

## 2. 为什么此前恢复不足

- L1-02 的轨迹命令中断时，持久状态为 QA_PASSED；原 Run 已成功，未生成 Trace FAIL。现场点击证明内容可读，
  从相同检查点恢复后通过，未重提模型或替换既有收据。
- L1-03 在同样的第一 Artifact 节点处再次停留于默认事件。继续重复观察会掩盖 UI 竞态，故保存截图并通过原
  `recordTraceUi` + controller 封存真实 FAIL。业务与 QA 的 PASS 保留，Trace 不伪造为 PASS。
- CLI 的稳定错误脱敏返回 CONTROL_FAILED，辅助日志解析又被 pnpm 尾部文本干扰；两者均不是 Run 失败依据。
  本次以数据库 turn 状态、实际 DOM 和组件 RED 作为判断依据，未为修复辅助输出而扩大产品改动。

## 3. 预防机制

| 优先级 | 机制 | 结果 |
| --- | --- | --- |
| P0 | 焦点 effect 依赖稳定 node ID | 原组件最小修改 |
| P0 | 真实 React/Workbench 的浏览器回归 | RED → GREEN；同引用内容刷新不抢选择 |
| P0 | 显式改焦点、清除焦点、关闭详情、切换 Run | GREEN；不冻结正常导航 |
| P0 | 同一任务浏览器；无数据库/模型调用 | 原会话复用，无新增测试 Chrome |
| P0 | 真实同批正式 UI/Trace 证明 | 待新 clean build/scratch/attempt；不拼接旧 PASS |

## 4. 扩展与证据边界

- 原 `resolveResolutionTraceRefresh` 对真实 Run/hash 变化的行为保持不变；detail 的 AbortController、缓存键和 strict
  hash 校验不变。修复仅消除等价对象更新造成的额外 URL focus 同步。
- 可重复的聚焦脚本位于 `apps/web/test-support/resolution-trace-focus-browser.mjs`，fixture 为同目录 TSX。
  它使用真实 React 和被测组件，只隔离与选择无关的 API、Store adapter、Team/Artifact leaf；意外网络访问直接抛错。
  不把这个组件测试称为 live API、语义答案或四层正式 PASS。
- 运行结束精确停止 Web PGID 4845、Worker PGID 4819、OpenSandbox PID 661122、fixture server 3311 和本任务
  Chrome；当前 scratch 停机，source/live 仍 E16，所有数据卷及原 audit 保留，普通 NAS 数据库 healthy。

## 5. 知识固化与审计定位

- 已更新 `frontend/agent-public-events.md`。仓库没有 `src/templates/markdown/spec/`，不创建第二份规范模板。
- 本批 audit：`formal-e17-27dcdf2f-e012d065`；attempt `e012d065-5cd4-47f9-95c1-03fc1e85aa85`。
- L1-01 Run `7c30b69f-2d27-830e-a0e4-3457b2d8df38`：完整 PASS，包含此前缺失的请求同比操作。
- L1-02 Run `4545d8c6-7574-8e94-b417-905dc4911bb4`：完整 PASS，首次轨迹观察中断及恢复日志均保留。
- L1-03 Run `daedd7b6-1f74-8fdf-b257-8f74884a120f`：业务/QA PASS、Trace FAIL；attempt FAILED/version 16。
- 失败截图 `runtime/L1-03-trace-interrupted.png`，终态 `runtime/control-advance-1788584453837.json`。
- 初次修复组件证据 `trace-focus-browser-green-27dcdf2f.json`；维护版真实浏览器复验
  `trace-focus-browser-maintained-green-27dcdf2f.json` 七项状态通过，Web focused 42/42、typecheck/build、Biome、Trellis/diff 通过。
  Build 保留既有两条动态 filesystem tracing warning，未将其误报为零警告。正式 15 题仍未闭合。

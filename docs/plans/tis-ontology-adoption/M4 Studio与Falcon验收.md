# M4：Studio 与 Falcon 验收

## 目标

把词汇/关系证据和绑定影响以安全、可解释的方式接入 Semantic Studio，并通过现有 Falcon/Test Center 证明新增能力不降低确定性、准确性、治理与故障恢复基线。

## 实现步骤

1. 在 `apps/web/src/components/semantic/studio/context-preview-workbench.tsx` 和 `apps/web/src/components/semantic/explorer/candidate-comparison-band.tsx` 增加匹配类型、发布版本、关系路径和绑定影响摘要，不新建旁路编辑器。
2. 修改现有 context preview route，并新增 `apps/web/src/lib/semantic-binding-impact-route.ts` 与 `apps/web/src/app/api/workspaces/[workspaceId]/semantic/binding-impacts/[impactId]/route.ts`；只投影安全字段与 artifact reference，所有未知/敏感字段 fail closed。
3. 为消歧、投影回退、影响未知、Candidate 待审、验证失败和可发布补齐 loading/empty/error/keyboard/a11y 状态。
4. 扩展 `packages/contracts/src/evals/falcon-semantic-release-set.ts` 的安全评估摘要，保留既有 oracle、bundle、receipt 与发布门禁。
5. 在固定 fixture/Falcon artifact 中建立 B0 exact、B1 lexical、B2 lexical + governed retrieval/graph 三组评测标签；它们不是三套运行时代码。交付时只有通过门禁的当前路径存在。
6. 做合同、语义、平台、浏览器、冷重启和投影故障验证；达到门禁后才扩大启用范围。

用户从 Context Preview 查看命中证据；遇到歧义先选择候选再预览。绑定影响从 schema drift/通知进入现有 Candidate comparison，按风险、直接影响、传递影响逐层展开，最终只能拒绝、返回编辑或进入现有验证/发布流程。查看证据复用 workspace READ capability；创建和提交 Candidate 复用 WRITE capability；关闭页面不产生语义写入。

## 代码分析

TIS 的 Falcon 计划值得借鉴其检索与 SQL 等价验证的分层意识，但部分现有测试只检查非空，真实数据库 EXPLAIN 用例也可能被忽略。Data Agent 已有 `falcon-semantic-release-set`、usage receipt、agent release gate 和浏览器边界测试，应强化确定性 oracle 与证据链，而不是复制上游脚本。

现有可复用测试入口：

- `packages/contracts/test/falcon-semantic-release-set.spec.ts`
- `packages/semantic/test/context-router.spec.ts`
- `packages/semantic/test/semantic-relationship-index.spec.ts`
- `apps/web/test/semantic-context-preview.spec.tsx`
- `apps/web/test/semantic-candidate-route.spec.ts`
- `apps/web/test/falcon-agent-gate-boundary.spec.ts`

新增建议：`packages/semantic/test/semantic-retrieval-falcon.spec.ts` 与 `apps/web/test/semantic-binding-impact.spec.tsx`。

## 验收标准

- UI 可见规范名/同义词/缩写等 match kind、精确 release ref、bounded relationship path；
- 同名歧义可通过键盘完成选择，不允许默认静默选中；
- 绑定影响能从 drift operation 导航到受影响对象和 Candidate 差异；
- API/DOM/trace 不含 raw prompt、raw SQL、parameters、rows、DSN 或 provider payload；
- 新增 workspace route 复用 `authorizeWorkspaceRequest`，只读与写入能力分离，跨 workspace/release 引用被拒绝；
- B1 对 exact 基线零回退，B2 不降低批准的 Falcon first/final pass；
- 歧义误选、跨 release 污染、未授权召回均为零；
- 冷重启结果 hash 稳定，Neo4j/知识索引故障自动回退且 reason 可见；
- 单个 scoped commit 可独立回退；运行时不保留 M2/M3 旧路径或兼容开关，Published Release 与历史 artifact 无需回写。

## 备注

发布按离线门禁 → lexical 原子切换 → 可选 governed retrieval 独立任务 → binding impact preview → 完整验收进行。任何阶段出现权威不一致、敏感投影、静默歧义或 Falcon 回退，停止交付并回退对应 scoped commit；不恢复旧运行路径。

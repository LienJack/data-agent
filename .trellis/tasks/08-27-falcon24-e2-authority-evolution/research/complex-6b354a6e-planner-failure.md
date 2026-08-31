# Complex L4 scratch — 6b354a6e

## Observed checkpoint

- Clean source `6b354a6e4a7834b0d66eed968d1485b635f7dede`: force build8/8、full unit15/15 task；独立 Analysis/Teams 等54文件643/643。build attestation PASS。
- NAS 专用 scratch `data-agent-falcon24-e17-6b354a6e` / loopback55481，物理 backup 验证通过；普通 NAS data_agent 未作 authority，OrbStack未启动。
- Scratch baseline `6bcad299-711f-5ad0-819a-6d13ec0d875c`，hash `sha256:d256f6e8d307ede414f06487c8bb027ae770dead45710b41537f7eb2fec4047f`。
  原 certification `48e13fca-2144-5c6d-9904-c75db65663e6` PASS，原 Finalizer 仅激活 scratch；production isolation仍HOLD。
- Source9表/70列/121445行完整。live before/clone/after348表 canonical audit完全一致；live仍E16 FAILED，没有E17正式attempt。
- 非计分 L4A1 只提交一次：`最近12个完整月的订单收入同比表现如何？请给出月度趋势图。`
  Conversation `fabd2219-b5c8-42e3-8005-10cf98fc13d7`，Run `a914eb61-40fc-813b-9904-4b1dd05a05cc`，FAILED，64 events。
- Semantic r6 ACCEPTED → Text2SQL r5 ACCEPTED（一次 alias 候选修复保留）→ Analysis r4 FAILED 两次 → Root budget exhausted。
  QueryEvidence `2c793265-b816-8f78-a8ec-7ecd6b6aa6ac` / `sha256:3704cf59f7365f6610528fd14d9b4ac0109caa4374ee5c659bf15d8ba7922de0`。
- seq46/59 的 ANALYSIS_PROGRAM 都报 `MODEL_STREAM_PROTOCOL_VIOLATION`，约3.8/3.3秒，发生在 Program/Python/Sandbox执行前。
  原 dispatcher 丢弃失败输出，因此无法区分 invalid JSON、schema、adapter等原因；不能宣称已证明模型失败根因。
- 业务FAILED后未继续A2或浏览器Trace E2E。当前轮 Web/Worker/OpenSandbox已停止，browser/auth已关闭删除，失败数据库和audit保留。

## Bug Analysis: planner failure diagnostic loss

### 1. Root Cause Category
- **B / D — Cross-Layer Contract / Test Coverage Gap**：bridge有TEXT_DELTA，dispatcher失败时只传通用码，display output恒null；缺安全的结构诊断及端到端回归。
- 这是已验证的诊断缺口，不等同于原模型输出失败原因。JSON结构、schema细节、适配层均仍是待分辨假设。

### 2. Why Fixes Failed
- 此轮此前没有针对 planner 的修复。月度面板及 Report离线闭合不证明当前 provider→planner真实通过，也不能被当成失败根因已修复。
- 不重复提交旧Run，不以泛化prompt/扩大预算/放松schema猜测修复。

### 3. Prevention Mechanisms
| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Runtime | 64KiB私有buffer，闭合分类/至多8条代码+白名单路径；不输出原文/值 | DONE |
| P0 | Consumer | stage+error双重限定，严格解析details；原失败与预算不变 | DONE |
| P0 | Test | pinned Mastra invalid-output stream、dispatcher→display、refinement/截断/伪造/非目标拒绝 | DONE |
| P1 | Real evidence | 新clean build/scratch取诊断，再对实际原因做最小修复 | ACTIVE |

### 4. Systematic Expansion
- 类似入口不得直接透传Zod.message/cause或provider response；公开诊断应使用闭合类型而非任意字符串。
- 保持已有Text2SQL安全诊断机制；此变更仅Analysis planner，不扩大到Root/其他Specialist。
- 离线producer-consumer测试是缺口修复证据，真实15回合与同Run UI验收仍未完成。

### 5. Knowledge Capture
- [x] backend/agent-team-runtime.md新增该边界和回归要求。
- [x] 本记录及implement checkpoint保留原失败身份。
- [x] focused17文件137/137，Worker typecheck/build，6文件Biome及Trellis validate/diff check通过；既有两份超长上下文告警未新增。
- 模板目录 `src/templates/markdown/spec/` 不存在，无对应模板可同步；不新建第二套spec。

完整只读证据：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-6b354a6e/turn-01/`
及同audit根的 `complex-6b354a6e-{before,clone,after}.json`。敏感capability不纳入Git。

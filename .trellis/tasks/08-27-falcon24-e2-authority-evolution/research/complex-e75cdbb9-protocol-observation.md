# Bug Analysis: JSON mode 后仍失败，需要区分实际响应形态

## 1. Root Cause Category

**D/E — 观测缺口与隐含假设**。`e75cdbb9` A2 在已有48行 QueryEvidence 后，Root 调用
`fc0ed004-5f91-4c00-9357-a08d88f8b029` 4,011ms 后为 OUTCOME_UNKNOWN；私有日志680行为
AUTO_RESPONSE_INVALID_JSON。只知道 JSON.parse 失败，不知道原文为空、空白、截断还是其他文本。
实际失败原因未定，不能把本次诊断增强表述为已修复模型行为。

当前构建 `e75cdbb9993079cd98c126adb1a3c792c88a17f8`，scratch baseline
`1f6342fa-b3f0-52a5-9d4b-73846870f068`。四题历史 PASS 不拼接于此。

| 回合 | Run | 真实边界 |
| --- | --- | --- |
| B1 | `2ca38e98-6f77-8f1f-ba90-8de1befb2b76` | Semantic接受；3个SQL task各2候选均发布公式表达式不一致，74事件/0查询，FAIL |
| A1 | `24762b1c-441a-83f8-9820-e03b29c5a5ae` | 12行来源/同比、原Python结果0差异；业务与同Run QA/75 Trace节点/5产物 PASS |
| A2 | `4631aed0-cefe-89d4-85ad-cd7d0e2ce02b` | 48行/两期分组/整体重组独立Oracle PASS；37事件，Root格式失败，未创建Analysis，整体FAIL |

A1 Stage `60a025df-9bfe-5d78-ab86-2e9ff53760bd`，第一次Python Cell的TABLE_MISMATCH在原修复预算内纠正，
原结果/Explanation/三个输出bytes/hash重验；真实NAS双沙箱无端口冲突。B1原Root calls不再加入coverage过滤。
A3/B2/B3没有提交，完整15回合没有开始；不是复杂四层PASS或production isolation PASS。

## 2. Why Fixes Failed

提示强化没有形成可靠语法约束；JSON mode 已由真实固定SDK离线wire证明发送，但它不能保证实际响应永远有效。
旧日志把多种失败形态归入同一stage，无法为下一修复提供有区分度的证据。先补观测，不猜测原文、不提高重试预算。
B1是独立的Formula交接失败，不归因于Root格式。实际发布AST与物理double precision列的无模型语法探针证明
原CASE表达式可通过原证明器，改NULLIF或加数值cast被拒绝；这不是对6个历史SQL候选的复原。
Specialist原候选未持久化，不能确定它们具体使用了哪种错误写法。

## 3. Prevention Mechanisms

| 优先级 | 机制 | 状态 |
| --- | --- | --- |
| P0 | 原JSON.parse/schema/OUTCOME_UNKNOWN/一次网络调用不变，失败不重放 | 保留 |
| P1 | 私有日志只增加finish枚举、文本形态和有限计数，区分空/截断/非法内容 | 实施 |
| P1 | 原DeepSeek SDK+Mastra mock网络测试，6项RED后通过；不替换解析器 | 通过 |
| P1 | 额外未知字段、任意原文、异常getter及非法数值均不泄漏 | 通过 |

Agent Runtime三套58 tests、typecheck/build通过；Worker audited provider 15 tests与typecheck通过，共73项focused。
测量不包含SQL/答案/提示/token正文/headers/URL，日志失败不能替代原失败终态。

## 4. Systematic Expansion

- 先比较streamed字节和fullOutput字节，再区分Provider length与完整但非法内容；计数不是语义证据。
- 已发布ROAS表达式已有权威，后续可在原冻结上下文提供无数据语法参考以降低重复翻译难度，
  但原AST/零值/绑定/查询/业务Oracle均不能削弱。尚未实施或证明此项。
- 新建对话曾显示默认资源但GET绑定为null；reload后真实UI选择资源成功落库，提交前拒绝没有发送问题。
  此页面/持久化投影差异记为独立待定位项，不能把默认显示视为已绑定。
- 两个独立组均已检查，依赖失败前缀的后续题不盲目提交。新构建需新scratch，不借用本次A1 PASS。

## 5. Knowledge Capture

- 已更新Provider私有诊断契约；`src/templates/markdown/spec`不存在，未另建模板权威。
- live E16 348表before/after完全相等；关闭Web49792、Worker50254、两浏览器及临时auth，取消55501转发。
- scratch容器停机，卷/历史保留。NAS OpenSandbox控制面1310950/API18080与共享SSH保留供继续执行，
  无运行中的Analysis sandbox；普通NAS数据库healthy，OrbStack关闭。清理未删旧容器或卷。
- 本机证据：`complex-e75cdbb9/turn-01,02,04/`、`complex-e75cdbb9-after.json`、
  `complex-e75cdbb9-runtime-cleanup.json`。任务保持ACTIVE，下一步继续修复与新构建验证。

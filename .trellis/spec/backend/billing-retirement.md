# 商业计费退役记录

> 历史决策：2026-08-23 起，本绿地项目不提供商业计费能力。本文件只记录边界，不定义可恢复实现。

## 当前边界

- 生产合同、Route、Repository、Worker、UI 和环境配置不得包含价格、汇率、积分、余额、预留、结算、
  发票或账单能力。
- Provider 调用只记录技术诊断：provider reported token、latency、tool calls、outcome 与 availability；
  不计算或推断金额。
- Model Control 独立管理 provider/model/SecretRef metadata、capability 与 technical readiness；它不是
  商业控制面，也不得读取历史商业表。
- Q&A、Test Center、Semantic Authoring 与 Provider 直连不得以价格或余额作为 readiness/authorization
  前置条件。

## 数据库历史

- Migration `10700` 将旧商业表冻结为只读历史记录并撤销 mutation surface；应用运行时不得访问。
- 本项目不迁移、回填或兼容旧商业数据。新环境从当前 schema 建立，不创建双写或 fallback。
- 物理销毁历史表属于独立、显式的数据保留决策，不得由功能开发隐式执行。

## 禁止恢复

- 不得新增 compatibility export、空实现 adapter、feature flag 或 redirect 来伪装旧能力仍存在。
- 若未来商业化，应作为全新有界上下文重新设计合同、账务 authority、审计与数据保留策略；不得复活
  已退役代码。

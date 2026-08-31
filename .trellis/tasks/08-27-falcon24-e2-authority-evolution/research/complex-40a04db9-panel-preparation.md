# Bug Analysis: 固定月度分群公式的Python准备边界

## 1. Root Cause Category

B/D/E：原方法按完整源列输出observations，但生成的Cell依赖未存在的month_str。
40a04db9 A2 Run1ac1185e-569e-856c-a7df-7220ee17df50已取得正确48行QueryEvidence，
第一次计划被拒绝；第二次原Run内Analysis程序133da44e-2892-5913-b345-3472154b8b7e编译后，
两个python_cell均为KeyError month_str，成功Cell=0、无Stage/Oracle，终止于修复预算耗尽。
原代码内容未作为可读取source持久化，不能声称重放了原Cell；日志仅证明相同派生列错误重复。

## 2. Why Fixes Failed

- 既有字段/schema与文字规则未阻止模型在原时间列、临时列与observations之间混用名称。
- 一次模型修复仍返回同类KeyError，不能继续靠同Run重试；已保留FAILED且未提交A3/UI。
- c683622e只修规划元数据/误报码，不声称修复Python。当前变更专门提供固定描述性计算参考，未改来源或发布权威。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Explicit preparation | 原time_column直接转业务日历；完整源列/分类/measure映射，无临时来源列 | DONE |
| P0 | Bounded difficulty | 无数据参考Python实现原月度、反向端点对及整体同比贡献，非自由算法合成 | DONE |
| P0 | Independent verification | 原Host Oracle独立实现不导入Python参考，结果合同/值/表/图/预算不改 | DONE |
| P0 | Real runtime tests | NAS原Agent镜像12场景、原operator镜像Cell策略均PASS，零Oracle差异且输入不变 | DONE |
| P0 | Real acceptance | 新clean build/fresh scratch完整A/B与后续四层，不能复用历史PASS | PENDING |

## 4. Systematic Expansion

按用户授权降低固定难题的实现难度；只对已验证原monthly panel方法附参考，既有ResultContract和黄金hash不变。
execution_contract随原method registry hash/新构建绑定；模型仍须返回实际代码，不后台替换，仍经原Cell/Publisher/Oracle。
参考只读绑定DataFrame，对副本显式按已批准timezone处理DATETIME，DATE保留日历日；数值只转JSON-native float/None、不取整。
每组原12月，保留每个原始tuple与NULL，整体两期按源顺序相加；负/零基数不列同比下降排名。
参考不由Host执行，不装成statistical_operator，不把代码辅助执行等同任意自然语言/算法生成通过。

## 5. Knowledge Capture

- 更新governed-monthly-panels规范及implement；无src/templates/markdown/spec目录，不新建模板权威。
- NAS独立检查12场景：base、two-categories、datetime、period、period-datetime、aliases、reverse-order、null-current、
  zero-prior、negative-prior、no-decline、floating；网络none/read-only容器一次执行后删除，未触碰任何数据库或模型。
- 参考hash sha256:2805aa4ceae58a2d6f54e06452babcd23b261331ee9c96f40bd296ee89ac5542；
  收据 `/Users/lienli/.codex/audit/falcon24-e1-authority-reset/monthly-panel-reference-probe.json`，原Oracle逐字段0差异。
- Worker Analysis目录36文件431项PASS，typecheck、Biome、Trellis和diff检查通过；元数据单测不冒充上述NAS执行。
  本次focused和最终真实A/B结果分别记录，尚未签formal15 PASS。

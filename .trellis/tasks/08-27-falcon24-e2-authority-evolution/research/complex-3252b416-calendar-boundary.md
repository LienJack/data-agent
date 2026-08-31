# Bug Analysis: Arrow 时间戳与业务日历表示不一致

## 1. Root Cause Category

Category B/D/E：QueryEvidence 封存 Asia/Shanghai 业务窗口，Arrow TIMESTAMP_MS 是绝对时刻，
但转 pandas 后为 naive UTC；分析输入未明确赋予已批准的业务时区，模型输出的月份标签偏早一个月。
不是改 SQL 数值、修改 Oracle 容差或增加历史答案就能解决的问题。

3252b416 clean build 8/8、full unit 15/15、attestation PASS。NAS 专用 55491 物理克隆校验通过，
source 348 表一致；仅 scratch 迁移10816，347业务表不变；9表70列121445行1902NULL 数据快照一致。
认证 Run 06af4280-a3a4-50b9-acf2-97f5c3f92839 PASS，baseline 8ba90831-ac09-5a41-94cc-89858bd0abf4，production HOLD。

一次 composer A1：Conversation 59ae19a4-48b9-4eb9-8992-b6ebf637a407，
Run 6775d2ee-bf0d-8c08-bff7-4a75f418fd8f FAILED/65events。
当前 Semantic、Text2SQL、QueryEvidence 接受；没有 SQL 候选拒绝。原比较证明器和独立来源校验通过，
12本期月、覆盖内6同期月；覆盖外同期不可补入。Analysis 首个 Python cell SUCCEEDED，进入 PUBLISH_STAGED，
原 Oracle 拒绝 MONTHLY_COMPARISON_ORACLE_RESULT_MISMATCH，后续同一失败发布身份恢复也被拒绝。
没有接受的 AnalysisReport/最终答案，不记业务通过；未提交 A2/B、未做本失败Run的页面验收。

## 2. Why Fixes Failed

前一修复解决 SQL 形态生成，此次有真实证据证明到达了原来未到达的分析发布边界；不能反推此前失败 SQL 的具体原因。
本次先以只读方式保留 stage 7a2b4f83-6576-5482-b8b8-0c8ebebd50e2、原 command 与 RESULT/TABLE/CHART，
逐项验证原字节/hash/大小及原 verifyAnalysisResultStageCommand。用原独立算法对照得到38项差异，全部是月份字段；
极值、端点、相邻变化的月份偏早，而数值与已归一的 observations 一致。
例：接受的 2023-10-31T16:00:00Z 是上海2023-11-01，stage first_period 却为2023-10-01。
没有绕过失败Run fence 解密/重放源代码，不能据此宣称发现模型具体哪一行代码。

最初不足以量化各假设，按 break-loop 先找区分证据，未事后虚构先验比例：

| 假设 | 区分证据 | 更新 |
|---|---|---|
| 数值/来源计算错误 | SQL/独立来源一致；stage数值一致 | 显著下降 |
| 输出包装/类型错误 | 原stage字节闭合；具体38差异均日历标签 | 下降 |
| UTC与业务时区表示混淆 | 原Arrow/pandas可复现；仅转换表示后月份正确 | 高置信，实施边界修复 |

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Input boundary | 从原 verified QueryEvidence 的 exact DATETIME Dimension/time_window 投影时区；保留Arrow字节 | DONE |
| P0 | Identity/recovery | 绑定身份含时区；同名漂移拒绝；context恢复重放同一Host绑定source | DONE |
| P0 | Prompt | 明确先UTC解码再转批准时区，所有日历字段一致；DATE不按instant转换 | DONE |
| P0 | Independent Oracle | 原数值、来源、月份和完整结果校验均不放宽 | UNCHANGED |
| P0 | Test | 上海跨月/闰年/年界、纽约DST、NULL/DATE/数值/instant/Arrow不变 | PASS，NAS Python无模型探针 |
| P0 | Real acceptance | 新构建/新scratch/新Run再验A1，之后A2/B与formal15 | PENDING |

## 4. Systematic Expansion

适用于月度/分群结果的极值、端点、相邻变化及日期标签。只允许封存窗口指定的 DATETIME 维度转换表示，
不得给普通字符串/DATE/任意另一时间字段猜时区；没有明确时区时不凭本机时区补全。
空projection保持旧绑定身份兼容，非空projection纳入request/prompt与runtime identity，恢复不能混用旧表示。
Python实际探针使用同一agent镜像的独立无网络只读容器，原输入哈希先校验，测试容器 --rm 已回收；
无模型调用、无Falcon authority写入。不是实际失败cell重放、业务通过或production隔离证据。

## 5. Knowledge Capture

- 更新 backend/python-sandbox-execution.md 和当前 implement checkpoint；模板目录不存在，不创建第二套无消费者模板。
- 原始audit：/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-3252b416/turn-01；
  stage-evidence.json、oracle-yoy.json、business-review.json(FAIL) 保留原始失败。
- 独立probe：timezone-bound-input-python-probe.json，8项PASS，model_calls=0/authority_writes=0。
- 源348表 after/before一致；本轮Web/Worker/OpenSandbox、browser/auth、55491转发与临时capability精确清理。
  scratch容器停止，volume/历史保留；共享SSH、普通NAS数据库保留，OrbStack关闭。

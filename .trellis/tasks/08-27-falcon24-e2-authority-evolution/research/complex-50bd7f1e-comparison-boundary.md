# 50bd7f1e：运行成功不等于同比拆解正确

## 固定现场

clean `50bd7f1e93962efc1826ddd458df16a1e02e778d` force build8/8、full unit15/15、attestation通过。
NAS专用scratch55489与源348表指纹一致，仅scratch迁移10816；9表/70列/121445行来源一致。
认证初次启动早于迁移/转发就绪，保留原HOLD日志。恢复前独立证明确定性Run/Stage/events/provider outcomes均0、347业务表无漂移，
再执行唯一实际认证（replayed=false）及原Finalizer；不是重放失败模型Run。零副作用preflight与ready日志均留档。
scratch baseline `bb54b9f8-3d29-5ff7-ab4f-408c59b632d5`，production readiness仍HOLD。

## 业务观察

- A1 Run `ea1f8112-7c40-8dba-94ac-0e661b7866bd`：Semantic→Text2SQL→Analysis、60events、1次Python/0repair；
  源12月/有效6同比、两图数值和来源通过，同Run QA/Trace76节点全部打开及刷新通过。非正式profile验收，保留旧Report要求差异与措辞警告。
- A2 Run `70dbe6b4-46ac-8174-a787-db6d77b63073`：Text2SQL→Analysis、46events、Run SUCCEEDED，**独立business FAIL**。
  一次SQL别名修复保留；冻结历史3条、先前用户问题/检索hash正确，但Root未创建本Run SemanticQueryContext。
  48行QueryEvidence的本期与同期都声明为同一Metric，没有REQUEST_DERIVED比较列；同期扫描纳入未发布的2023年3/4月，8条分组值不应出现。
  答案把个别客户类型的相邻月降幅称为整体同比，选2/3/9月；独立源聚合同比排名为8/9/10月。
  月度面板Oracle只证明逐组逐序列描述性算术，不能据此授权总体同比或分解；自然语言超出了该证明范围。

没有提交A3/B，没有为失败A2做UI验收。原Run、答案与Artifact不修改，不重放。

## 恢复与剩余项

首个修复在原resolver关闭同Metric多别名缺比较解释的旁路；Root提示明确历史assistant不等于本轮Tool Result，
跨轮比较/窗口须重新得到Semantic解释。先看到3项RED（无context/空context/仅window均误放行），再补边界与正反例。
它不自动选择Semantic、不禁普通单Metric直查，不改变SQL修复预算。

下一小任务仍须补受治理同比/总体分群统计的结构化事实与叙述范围；不能靠提示改写旧答案，也不能把本修复记为A2 PASS。
原L4/15题继续ACTIVE，formal manifest profile差异及B3未定义比较期间仍待单独明确，不能静默放宽旧manifest。

Live after348表与before完全相同，仍E16 FAILED/10815。Web/Worker/OpenSandbox、一个browser/auth与55489转发已关闭，
临时capability文件删除；scratch容器停机且volume保留。共享SSH与普通NAS数据库保留healthy，OrbStack关闭。

原始审计目录：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-50bd7f1e/`；
`complex-50bd7f1e-after.json`、`complex-50bd7f1e-runtime-cleanup.json`及认证ready-preflight同级/构建目录保留。

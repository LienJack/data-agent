# 8cc4d933：NAS 沙箱控制面同机约束

## 1. 根因分类

E 隐含假设 / B 跨层契约 / D 测试覆盖。OpenSandbox `allocate_host_port` 在控制服务主机调用
`socket.bind`；Mac 控制面连接 NAS Docker 时，它探测的不是实际容器发布端口所在主机。

scratch A1 `c50b248c-6d67-8c99-97d5-5b2b9fee3b25` 仅一次 composer，50 events，最终 FAILED。
Semantic 与 Text2SQL 已接受；12 行窗口、数值、有效覆盖同期/同比均通过原来源 Oracle。
Analysis 尚未执行 Python：Operator egress `c0f48216-7bf2-4200-a5c7-d99645aca6e1`
启动报 NAS 51022 端口已占用，Worker 记录 `ANALYSIS_SANDBOX_STARTUP_FAILED`。
已创建 Agent sandbox `3f3a9f32-45c2-46eb-a82a-b9110b2394d3` 随后清理。

后续 Root request `5998fe5f-5495-41fa-9b31-0544853671c3` 为
`AUTO_RESPONSE_INVALID_JSON`→OUTCOME_UNKNOWN，call count 1；该独立协议缺陷未因迁移而证明修复。
不能重放、拼接或把原 A1 改成 PASS。A2/A3/B1/B2/B3 均未提交，formal15 未开始。

## 2. 为什么之前修复不能覆盖

此前 Root 语义范围和响应提醒不涉及沙箱主机网络。单个 health、前几次成功的随机端口以及
模拟 SDK 单测不能证明下次两个容器的端口不会冲突。增大随机范围也只是降低概率。

## 3. 防复发机制

| 优先级 | 机制 | 状态 |
| --- | --- | --- |
| P0 | 控制服务与 Docker 同在 NAS 主机网络，使用真实本机 Docker socket | 已执行 |
| P0 | 同版本 0.2.3，117 源码文件 hash 完全相同，保留固定 Agent/Operator 镜像 | 已核验 |
| P0 | 强制占用端口拒绝/下一空闲端口/耗尽失败的无模型探针 | 已通过 |
| P0 | 原 SDK 双沙箱、Cell 正反例、状态符号、Operator receipt、前后零残留 | 已通过 |
| P1 | 每次拓扑变化在模型题之前运行双沙箱预检 | 已纳入叶子规范 |

服务目录 `/vol1/1000/work/data-agent/runtime/falcon24-opensandbox-023-nas1`；API 绑定
`127.0.0.1:18080`，原 SSH master 转发；只改配置 store.path，Secret 不入库。
源码 bundle `sha256:18ef5471a407ad8e3a99e8ce7031c97c78b0e892bd8dd241fe62914371bba21b`。
依赖 freeze（56 项）与配置 hash 保存在 `nas-opensandbox-colocation.json`。

真实双沙箱 `54ed4ff7-58a0-4ec0-8b68-ec9f560ddf08` /
`ad3a40be-f0be-4a4c-a886-7a8561ea63a1`，原 probe 全部 PASSED，session_closed=true，
API before/after items 均空。证据 `nas-opensandbox-runtime-probe.json`。模型调用和 live authority 写入均零。

## 4. 系统性扩展

- 任何远程 Docker、转发 Unix socket、容器内控制服务都必须证明 allocator 所在网络命名空间，
  不以 URL 或 socket 路径推断同机。
- 管理服务在宿主 Python 中运行不等于允许宿主执行模型 Python；数据仍在原隔离容器。
- 此处恢复的是 scratch 可运行性，production isolation 仍 HOLD，正式四层仍未通过。

## 5. 知识与 checkpoint

- 已新增 NAS OpenSandbox 叶子规范、索引及本地 runtime 引用；模板目录不存在，不新建第二套权威。
- `8cc4d933` 源348表 before/after相同；Web/Worker/Mac控制服务 PID 3609/4520/97178 停止，
  3300/9090/18080/55500 当次端口清空，两个浏览器与auth关闭，scratch卷保留。
  后续 NAS 控制服务重新占用的是18080 SSH转发，不是原Mac Python进程。
- 原失败 audit、Provider outcome、Oracle 和清理回执保留；新 clean build 与 fresh scratch 再验证复杂链路。

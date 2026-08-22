# 问答与分析工作台重构

## Goal

将 Q&A 和分析结果收敛为 OpenAI 式文档流、Apple 式可打断 Inspector 与统一蓝色 Composer。

## Requirements

- Assistant 使用窄阅读列，用户消息保持紧凑；公开 Activity 默认折叠。
- ConversationDirectory 仅在 Q&A 上下文出现。
- Artifact、Resolution Trace、Team Trace 继续使用真实公开事件和 authority。
- Composer、Inspector、移动 Sheet 使用统一材质和 reduced-motion fallback。

## Acceptance Criteria

- [ ] 公开事件不暴露 CoT、prompt、credential、SecretRef 或 raw Provider payload。
- [ ] 1440、1024、768、390px Composer/Inspector 无交叠。
- [ ] 键盘 disclosure、focused tests、typecheck、build 与 scoped commit 通过。

## Out Of Scope

- 不修改 SSE、event assembler、Provider 或 Agent Runtime。

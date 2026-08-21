# DeepSeek Harness Source Reuse Ledger — Activity And Rich Text

## Authority

- Upstream：`/Users/lienli/Documents/GitHub/deepseek-harness`
- Fixed commit：`47f943859bef60e4160492346772ded9b24f765a`
- License：MIT；notice：`apps/web/src/components/qa/DEEPSEEK_HARNESS_MIT_NOTICE.md`

## Planned / Implemented Mapping

| Upstream source | Data Agent target | Mode | Material differences | Validation |
| --- | --- | --- | --- | --- |
| `packages/client/runtime/src/client/cowork/conversation-assembler.ts` | `apps/web/src/lib/qa-event-assembler.ts` | ADAPTED | strict PublicRunEvent, PostgreSQL sequence, exact Agent identity, one-level ownership, prior Artifact refs | `qa-event-assembler.spec.ts` |
| `packages/client/ui-conversation/src/client/chat/AssistantMarkdown.tsx` | `apps/web/src/components/qa/safe-assistant-markdown.tsx` | ADAPTED | public answer text only; react-markdown + sanitize; no image/gallery/private reasoning | `safe-assistant-markdown.spec.tsx`; Web typecheck |
| `ui-conversation/.../ReasoningRow.tsx` | `components/qa/process-disclosure.tsx` | ADAPTED | bounded public summary, Data Agent status/error/i18n, no reasoning body beyond public fields | component/keyboard tests |
| `ui-tool/.../ToolRow.tsx` + `tool-call-model.ts` | `process-disclosure.tsx` + assembler projection | ADAPTED | ArtifactReference Inspector replaces host file path; payload already redacted | component/replay tests |
| `ui-conversation/.../DetailsPanel.tsx` | existing `qa-inspector.tsx`/store target | ADAPTED | exact Subagent/Artifact target, replay/Preview authority, focus return | Inspector tests/browser proof |
| `packages/client/e2e-tests/tests/web-chat-cjk-typography.spec.ts` and link fixtures | `apps/web/test/safe-assistant-markdown.spec.tsx` plus browser proof | ADAPTED | raw image forbidden; dangerous and unapproved Artifact URLs inert | focused Vitest, desktop/mobile screenshots |

No Codex or Reasonix source is copied. Reasonix commit `668cdee703680530901c67ff3908a95b720ad0d2`
informs only the shared event-core / surface-adapter boundary.

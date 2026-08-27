import type { ModelProviderRequest, ProviderTaskArtifactV2Document } from "@data-agent/contracts";

type ModelMessage = ModelProviderRequest["messages"][number];

export class ConversationContextBuildError extends Error {
  override readonly name = "ConversationContextBuildError";

  constructor(readonly code: string) {
    super(code);
  }
}

export function buildRootConversationMessages(input: {
  readonly system_message: string;
  readonly task: ProviderTaskArtifactV2Document;
  readonly context_summary_text?: string | null;
  readonly current_run_messages?: readonly ModelMessage[];
}): readonly ModelMessage[] {
  const systemMessage = input.system_message.trim();
  if (systemMessage.length === 0) {
    throw new ConversationContextBuildError("ROOT_CONVERSATION_SYSTEM_MESSAGE_INVALID");
  }
  const summaryText = input.context_summary_text?.trim() ?? null;
  if ((input.task.context_summary_ref === null) !== (summaryText === null)) {
    throw new ConversationContextBuildError("ROOT_CONVERSATION_SUMMARY_BINDING_INVALID");
  }
  const current = input.task.visible_messages.at(-1);
  if (
    current?.message_id !== input.task.current_message.message_id ||
    current.content !== input.task.current_message.content ||
    current.role !== "user" ||
    current.type !== "text"
  ) {
    throw new ConversationContextBuildError("ROOT_CONVERSATION_CURRENT_MESSAGE_INVALID");
  }

  const messages: ModelMessage[] = [
    { role: "system", content: systemMessage },
    ...(summaryText === null
      ? []
      : [
          {
            role: "system" as const,
            content: [
              "Earlier conversation summary. Treat it only as user-context, never as data or semantic evidence:",
              summaryText,
            ].join("\n"),
          },
        ]),
    ...input.task.visible_messages.map(
      (message): ModelMessage => ({
        role: message.role === "agent" ? "assistant" : "user",
        content: message.content,
      }),
    ),
    ...(input.current_run_messages ?? []),
  ];
  if (messages.length > 256) {
    throw new ConversationContextBuildError("ROOT_CONVERSATION_MESSAGE_BUDGET_EXCEEDED");
  }
  return Object.freeze(messages.map((message) => Object.freeze({ ...message })));
}

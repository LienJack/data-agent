import { createQaRun } from "./api-client";
import type { Conversation } from "./qa-types";
import type { RunProjection } from "./run-projection";

export async function submitBoundAnalysisRun(
  input: {
    question: string;
    workspace_id: string;
    conversation: Conversation | undefined;
  },
  submit: typeof createQaRun = createQaRun,
): Promise<RunProjection> {
  if (
    !input.question.trim() ||
    !input.workspace_id ||
    !input.conversation?.dataSourceId ||
    !input.conversation.modelProfileId
  ) {
    throw new TypeError("ANALYSIS_CONVERSATION_BINDING_REQUIRED");
  }
  return submit(input.question, input.conversation.id, input.workspace_id);
}

import { qaConversationHref } from "./qa-inspector-target";

interface PendingRef {
  current: boolean;
}

interface CreateAndOpenNewQuestionOptions {
  readonly qaHref: string;
  readonly title: string;
  readonly pending: PendingRef;
  readonly createConversation: (input: { title: string }) => Promise<{ id: string } | null>;
  readonly navigate: (href: string) => void;
  readonly onPendingChange: (pending: boolean) => void;
}

export async function createAndOpenNewQuestion(
  options: CreateAndOpenNewQuestionOptions,
): Promise<boolean> {
  if (options.pending.current) return false;

  options.pending.current = true;
  options.onPendingChange(true);
  try {
    const conversation = await options.createConversation({ title: options.title });
    if (!conversation) return false;

    options.navigate(qaConversationHref(options.qaHref, conversation.id));
    return true;
  } finally {
    options.pending.current = false;
    options.onPendingChange(false);
  }
}

import { z } from "zod";
import {
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
} from "../common/index.js";
import { artifactReferenceFor } from "./envelope.js";

const positiveRevisionSchema = z.number().int().positive().safe();

export const conversationContextSummaryReferenceSchema = artifactReferenceFor(
  "ConversationContextSummary",
);

export const conversationContextSummaryCoveredMessageSchema = z.strictObject({
  message_id: immutableIdSchema,
  content_hash: contentHashSchema,
});

const canonicalContextTermsSchema = z
  .array(z.string().trim().min(1).max(256))
  .max(64)
  .superRefine((values, ctx) => {
    values.forEach((value, index) => {
      if (index > 0 && value <= (values[index - 1] ?? "")) {
        ctx.addIssue({
          code: "custom",
          message: "Conversation context terms must be unique and canonically sorted.",
          path: [index],
        });
      }
    });
  });

const conversationContextSummaryDraftSchema = z
  .strictObject({
    schema_version: z.literal("conversation-context-summary@1.0.0"),
    summary_id: immutableIdSchema,
    conversation_id: immutableIdSchema,
    conversation_resource_version: positiveRevisionSchema,
    run_id: immutableIdSchema,
    covered_through_message_id: immutableIdSchema,
    covered_messages: z.array(conversationContextSummaryCoveredMessageSchema).min(1).max(48),
    summary: z.string().trim().min(1).max(50_000),
    active_terms: canonicalContextTermsSchema,
    user_confirmed_constraints: canonicalContextTermsSchema,
  })
  .superRefine((document, ctx) => {
    const ids = document.covered_messages.map(({ message_id: messageId }) => messageId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Conversation summary covered message ids must be unique.",
        path: ["covered_messages"],
      });
    }
    if (document.covered_messages.at(-1)?.message_id !== document.covered_through_message_id) {
      ctx.addIssue({
        code: "custom",
        message: "Conversation summary frontier must equal its final covered message.",
        path: ["covered_through_message_id"],
      });
    }
  });

export const conversationContextSummaryDocumentSchema =
  conversationContextSummaryDraftSchema.safeExtend({ content_hash: contentHashSchema });

export type ConversationContextSummaryDocument = z.infer<
  typeof conversationContextSummaryDocumentSchema
>;

export async function computeConversationContextSummaryHash(input: unknown) {
  return sha256ContentHash(conversationContextSummaryDraftSchema.parse(input));
}

export async function buildConversationContextSummary(input: unknown) {
  const draft = conversationContextSummaryDraftSchema.parse(input);
  return deepFreeze(
    conversationContextSummaryDocumentSchema.parse({
      ...draft,
      content_hash: await computeConversationContextSummaryHash(draft),
    }),
  );
}

export async function verifyConversationContextSummary(input: unknown) {
  const document = conversationContextSummaryDocumentSchema.parse(input);
  const { content_hash: _contentHash, ...draft } = document;
  if ((await computeConversationContextSummaryHash(draft)) !== document.content_hash) {
    throw new TypeError("CONVERSATION_CONTEXT_SUMMARY_HASH_MISMATCH");
  }
  return deepFreeze(document);
}

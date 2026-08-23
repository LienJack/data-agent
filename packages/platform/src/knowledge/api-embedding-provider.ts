import {
  type EmbeddingProfileRevision,
  type EmbeddingProviderPort,
  type EmbeddingRequest,
  type EmbeddingResult,
  embeddingRequestSchema,
  embeddingResultSchema,
  type PortResult,
} from "@data-agent/contracts";
import { z } from "zod";

type EmbeddingTransportResult = Readonly<{
  provider: string;
  model_id: string;
  vector: readonly number[];
}>;

function normalize(vector: readonly number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? [...vector] : vector.map((value) => value / norm);
}

export function createApiEmbeddingProvider(
  options: Readonly<{
    profile: EmbeddingProfileRevision;
    transport: (input: {
      readonly provider: string;
      readonly model_id: string;
      readonly projected_text: string;
      readonly signal: AbortSignal;
    }) => Promise<EmbeddingTransportResult>;
  }>,
): EmbeddingProviderPort {
  const provider: EmbeddingProviderPort = {
    async embed(
      input: EmbeddingRequest,
      signal: AbortSignal,
    ): Promise<PortResult<EmbeddingResult>> {
      const parsed = embeddingRequestSchema.safeParse(input);
      if (!parsed.success || signal.aborted) {
        return {
          ok: false,
          error: {
            code: "EMBEDDING_REQUEST_INVALID",
            message: "Embedding request is invalid.",
            retryable: false,
          },
        };
      }
      const request = parsed.data;
      const profile = options.profile;
      if (
        profile.status !== "READY" ||
        request.profile_ref.profile_id !== profile.profile_id ||
        request.profile_ref.revision !== profile.revision ||
        request.profile_ref.profile_hash !== profile.profile_hash ||
        request.provider !== profile.provider ||
        request.model_id !== profile.model_id ||
        request.dimensions !== profile.dimensions ||
        request.projection_receipt.decision !== "ALLOW" ||
        request.projection_receipt.provider !== profile.provider ||
        request.projection_receipt.projection_policy_version !== profile.projection_policy_version
      ) {
        return {
          ok: false,
          error: {
            code: "EMBEDDING_PROFILE_MISMATCH",
            message: "Embedding profile is not authoritative.",
            retryable: false,
          },
        };
      }
      try {
        const response = await options.transport({
          provider: request.provider,
          model_id: request.model_id,
          projected_text: request.projected_text,
          signal,
        });
        if (
          response.provider !== request.provider ||
          response.model_id !== request.model_id ||
          response.vector.length !== request.dimensions ||
          response.vector.some((value) => !Number.isFinite(value))
        ) {
          return {
            ok: false,
            error: {
              code: "EMBEDDING_DIMENSION_MISMATCH",
              message: "Embedding response is invalid.",
              retryable: false,
            },
          };
        }
        return {
          ok: true,
          value: embeddingResultSchema.parse({
            schema_version: "embedding-result@1.0.0",
            provider: response.provider,
            model_id: response.model_id,
            dimensions: response.vector.length,
            vector: profile.normalization === "L2" ? normalize(response.vector) : response.vector,
          }),
        };
      } catch {
        return {
          ok: false,
          error: {
            code: "EMBEDDING_PROVIDER_UNAVAILABLE",
            message: "Embedding provider is unavailable.",
            retryable: true,
          },
        };
      }
    },
  };
  return Object.freeze(provider);
}

const configuredEnvironmentSchema = z.strictObject({
  provider: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  model_id: z.string().min(1).max(128),
  base_url: z
    .url()
    .refine((value) => new URL(value).protocol === "https:", "Embedding API must use HTTPS."),
  api_key: z.string().min(1),
});

const openAiCompatibleResponseSchema = z.object({
  data: z
    .array(
      z.object({
        embedding: z.array(z.number().finite()).min(2).max(16_384),
      }),
    )
    .length(1),
});

export function createOpenAiCompatibleEmbeddingProviderFactory(
  environment: NodeJS.ProcessEnv,
  fetchImplementation: typeof fetch = fetch,
) {
  const configured = configuredEnvironmentSchema.safeParse({
    provider: environment.DATA_AGENT_KNOWLEDGE_EMBEDDING_PROVIDER,
    model_id: environment.DATA_AGENT_KNOWLEDGE_EMBEDDING_MODEL_ID,
    base_url: environment.DATA_AGENT_KNOWLEDGE_EMBEDDING_BASE_URL,
    api_key: environment.DATA_AGENT_KNOWLEDGE_EMBEDDING_API_KEY,
  });

  return (profile: EmbeddingProfileRevision) =>
    createApiEmbeddingProvider({
      profile,
      transport: async ({ provider, model_id: modelId, projected_text: projectedText, signal }) => {
        if (
          !configured.success ||
          provider !== configured.data.provider ||
          modelId !== configured.data.model_id
        ) {
          throw new TypeError("KNOWLEDGE_EMBEDDING_NOT_CONFIGURED");
        }
        const endpoint = new URL("embeddings", `${configured.data.base_url.replace(/\/$/, "")}/`);
        const response = await fetchImplementation(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${configured.data.api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: modelId, input: projectedText, encoding_format: "float" }),
          signal,
        });
        if (!response.ok) throw new TypeError("KNOWLEDGE_EMBEDDING_PROVIDER_UNAVAILABLE");
        const parsed = openAiCompatibleResponseSchema.parse(await response.json());
        return { provider, model_id: modelId, vector: parsed.data[0]?.embedding ?? [] };
      },
    });
}

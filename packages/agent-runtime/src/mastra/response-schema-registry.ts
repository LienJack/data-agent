import { versionIdentifierSchema } from "@data-agent/contracts";
import type { z } from "zod";

export type ServerModelStructuredOutput = Record<string, unknown>;

export interface ServerModelResponseSchemaDescriptor {
  readonly response_schema_version: string;
  readonly schema: z.ZodType<ServerModelStructuredOutput>;
}

export interface RegisteredServerModelResponseSchema {
  readonly response_schema_version: string;
  readonly schema: z.ZodType<ServerModelStructuredOutput>;
}

function parseDescriptor(
  input: ServerModelResponseSchemaDescriptor,
): RegisteredServerModelResponseSchema {
  if (
    typeof input.schema !== "object" ||
    input.schema === null ||
    typeof Reflect.get(input.schema, "safeParse") !== "function"
  ) {
    throw new TypeError("Server Response Schema Descriptor 必须提供可执行的 Zod Schema。");
  }

  return Object.freeze({
    response_schema_version: versionIdentifierSchema.parse(input.response_schema_version),
    schema: input.schema,
  });
}

/**
 * Server-owned response schema authority.
 *
 * Requests may select an exact registered version only. They cannot supply or
 * override the schema that is passed to Mastra and revalidated by the bridge.
 */
export class ServerModelResponseSchemaRegistry {
  readonly #schemas: ReadonlyMap<string, RegisteredServerModelResponseSchema>;

  constructor(descriptors: readonly ServerModelResponseSchemaDescriptor[]) {
    const registered = new Map<string, RegisteredServerModelResponseSchema>();
    for (const descriptorInput of descriptors) {
      const descriptor = parseDescriptor(descriptorInput);
      if (registered.has(descriptor.response_schema_version)) {
        throw new TypeError("Server Response Schema Registry 不允许重复 Schema Version。");
      }
      registered.set(descriptor.response_schema_version, descriptor);
    }
    this.#schemas = registered;
  }

  resolve(responseSchemaVersionInput: string): RegisteredServerModelResponseSchema | null {
    const responseSchemaVersion = versionIdentifierSchema.parse(responseSchemaVersionInput);
    return this.#schemas.get(responseSchemaVersion) ?? null;
  }
}

export const EMPTY_SERVER_MODEL_RESPONSE_SCHEMA_REGISTRY = new ServerModelResponseSchemaRegistry(
  [],
);

import { deepFreeze } from "@data-agent/contracts";
import { z } from "zod";

const strippedKeywords = new Set(["$schema", "minLength", "maxLength", "minItems", "maxItems"]);
const supportedKeywords = new Set([
  "$defs",
  "$ref",
  "additionalProperties",
  "anyOf",
  "const",
  "default",
  "description",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "items",
  "maximum",
  "minimum",
  "multipleOf",
  "pattern",
  "properties",
  "required",
  "title",
  "type",
]);
const supportedTypes = new Set(["object", "string", "number", "integer", "boolean", "array"]);

export class DeepSeekStrictSchemaError extends Error {
  override readonly name = "DeepSeekStrictSchemaError";
  readonly code = "MODEL_TOOL_STRICT_SCHEMA_UNSUPPORTED" as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectSchemaMap(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new DeepSeekStrictSchemaError(`DeepSeek Strict schema map is invalid at ${path}`);
  }
  const projected: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [name, schema] of Object.entries(value)) {
    projected[name] = projectNode(schema, `${path}.${name}`);
  }
  return projected;
}

function projectNode(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new DeepSeekStrictSchemaError(`DeepSeek Strict schema node is invalid at ${path}`);
  }
  const projected: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, child] of Object.entries(value)) {
    if (strippedKeywords.has(key)) continue;
    if (!supportedKeywords.has(key)) {
      throw new DeepSeekStrictSchemaError(`Unsupported DeepSeek Strict keyword at ${path}.${key}`);
    }
    if (key === "properties" || key === "$defs") {
      projected[key] = projectSchemaMap(child, `${path}.${key}`);
      continue;
    }
    if (key === "items") {
      projected[key] = projectNode(child, `${path}.${key}`);
      continue;
    }
    if (key === "anyOf") {
      if (!Array.isArray(child) || child.length === 0) {
        throw new DeepSeekStrictSchemaError(`DeepSeek Strict anyOf is invalid at ${path}.${key}`);
      }
      projected[key] = child.map((item, index) => projectNode(item, `${path}.${key}[${index}]`));
      continue;
    }
    projected[key] = child;
  }

  if (typeof projected.type === "string" && !supportedTypes.has(projected.type)) {
    throw new DeepSeekStrictSchemaError(`Unsupported DeepSeek Strict type at ${path}`);
  }
  if (projected.type === "object") {
    if (!isRecord(projected.properties) || projected.additionalProperties !== false) {
      throw new DeepSeekStrictSchemaError(`DeepSeek Strict object is open at ${path}`);
    }
    const propertyNames = Object.keys(projected.properties).sort();
    const required = Array.isArray(projected.required)
      ? projected.required.filter((item): item is string => typeof item === "string").sort()
      : [];
    if (
      required.length !== propertyNames.length ||
      required.some((item, index) => item !== propertyNames[index])
    ) {
      throw new DeepSeekStrictSchemaError(`DeepSeek Strict object has optional fields at ${path}`);
    }
  }
  if (projected.additionalProperties !== undefined && projected.additionalProperties !== false) {
    throw new DeepSeekStrictSchemaError(`DeepSeek Strict dynamic object is forbidden at ${path}`);
  }
  return projected;
}

/**
 * Generates the sole DeepSeek Strict provider projection from the authoritative
 * server Zod schema. Provider-unsupported size hints are removed here while the
 * original Zod schema remains the complete server validation authority.
 */
export function projectDeepSeekStrictToolInputSchema(
  inputSchema: z.ZodType,
): Readonly<Record<string, unknown>> {
  const projected = projectNode(z.toJSONSchema(inputSchema), "$");
  if (projected.type !== "object") {
    throw new DeepSeekStrictSchemaError("DeepSeek Strict tool input must be a root object");
  }
  return deepFreeze(projected);
}

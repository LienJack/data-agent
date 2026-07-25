import { z } from "zod";

export const immutableIdSchema = z.uuid();

export const contentHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "必须使用 sha256:<64-hex> 内容哈希");

export const versionIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/, "版本只能包含稳定的字母、数字和 ._:@/+~-");

export const timestampSchema = z.iso.datetime({ offset: true });

export const environmentSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const appScopeSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
});

export const contractErrorSchema = z.strictObject({
  code: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  message: z.string().min(1).max(500),
  retryable: z.boolean(),
  details: z.record(z.string(), z.json()).optional(),
});

export type AppScope = z.infer<typeof appScopeSchema>;
export type ContractError = z.infer<typeof contractErrorSchema>;

export type PortResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly error: ContractError;
    };

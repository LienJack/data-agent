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

/**
 * PostgreSQL 最终输出列名与跨进程 Sandbox/Oracle 共用的可移植 Alias。
 *
 * 仅允许单字节 ASCII，并限制为 PostgreSQL `NAMEDATALEN - 1` 的 63 bytes，
 * 防止数据库静默截断后与冻结 QueryContract 产生不同列名。
 */
export const postgresqlOutputAliasSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_.:-]*$/,
    "PostgreSQL 输出 Alias 必须以字母或下划线开头，且只能包含稳定 ASCII 标识符字符。",
  );

/**
 * 从 QueryContract 到 PostgreSQL SandboxResult 的单一可执行结果上限。
 *
 * 预算、Permit 与回执只能收紧到此范围内，不能声明 Sandbox 无法实际返回的结果。
 */
export const EXECUTABLE_QUERY_LIMITS = Object.freeze({
  max_columns: 256,
  max_rows: 10_000,
  max_bytes: 64 * 1024 * 1024,
  max_memory_mb: 512,
} as const);

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

/**
 * Data Sources 类型定义。
 *
 * 数据源连接管理的数据类型，采用注册表驱动设计。
 * 新增数据库类型只需扩展 DatabaseType 和 DATABASE_TYPE_CONFIGS。
 */

import {
  type DataSourceCredentialRef,
  type DatasourceAdapterId,
  dataSourceCredentialRefSchema,
  datasourceAdapterIdSchema,
  MANDATORY_DATASOURCE_ADAPTER_DEFINITIONS,
} from "@data-agent/contracts";
import { z } from "zod";

/** 数据库类型 */
export type DatabaseType = DatasourceAdapterId;

/** SSL 选项 */
export type SSLOption = "disable" | "require" | "verify-ca" | "verify-full";

/** 连接表单字段 */
export type ConnectionField =
  | "host"
  | "port"
  | "database"
  | "username"
  | "ssl"
  | "path"
  | "credentialRef";

/** 数据库大类 */
export type DatabaseCategory = "relational" | "analytics" | "file";

/** 数据库类型配置（注册表项） */
export interface DatabaseTypeConfig {
  type: DatabaseType;
  label: string;
  description: string;
  defaultPort?: number;
  /** 表单需要渲染的字段 */
  fields: ConnectionField[];
  /** 必填字段 */
  requiredFields: ConnectionField[];
  supportsSsl: boolean;
  /** 是否必须通过 Secret Provider 引用凭据 */
  requiresCredential: boolean;
  category: DatabaseCategory;
  /** 字段 placeholder 提示 */
  placeholders?: Partial<Record<ConnectionField, string>>;
}

/** 数据源连接 */
export interface DataSourceConnection {
  id: string;
  /** PostgreSQL Authority 拥有的当前资源版本，用于 Run expected revision。 */
  resourceVersion: number;
  name: string;
  type: DatabaseType;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  /** 仅包含 provider-neutral metadata，不包含 Secret 值或 provider locator。 */
  credentialRef?: DataSourceCredentialRef;
  ssl?: SSLOption;
  /** SQLite 文件路径 */
  path?: string;
  /** Trino 目录 */
  catalog?: string;
  /** Trino Schema */
  schema?: string;
  status: "active" | "error" | "unknown";
  lastTestedAt?: string;
  createdAt: string;
  updatedAt: string;
}

const dataSourceRequestShape = {
  type: datasourceAdapterIdSchema,
  host: z.string().trim().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  database: z.string().trim().min(1).max(255).optional(),
  username: z.string().trim().min(1).max(255).optional(),
  credentialRef: dataSourceCredentialRefSchema.optional(),
  ssl: z.enum(["disable", "require", "verify-ca", "verify-full"]).optional(),
  path: z.string().trim().min(1).max(4096).optional(),
} as const;
const dataSourceFieldsSchema = z.strictObject(dataSourceRequestShape);

function validateAdapterFields(
  input: z.infer<typeof dataSourceFieldsSchema> & { readonly name?: string },
  ctx: z.RefinementCtx,
) {
  const descriptor = MANDATORY_DATASOURCE_ADAPTER_DEFINITIONS.find(
    ({ adapter_id }) => adapter_id === input.type,
  );
  if (!descriptor) return;
  const allowed = new Set(descriptor.fields.map(({ field_id }) => field_id));
  for (const definition of descriptor.fields) {
    if (
      definition.required &&
      definition.field_id !== "ssl" &&
      definition.default_value === null &&
      input[definition.field_id] == null
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Missing required Adapter field ${definition.field_id}.`,
        path: [definition.field_id],
      });
    }
  }
  for (const fieldId of [
    "host",
    "port",
    "database",
    "username",
    "credentialRef",
    "ssl",
    "path",
  ] as const) {
    if (!allowed.has(fieldId) && input[fieldId] != null) {
      ctx.addIssue({
        code: "custom",
        message: `Field ${fieldId} is not valid for Adapter ${input.type}.`,
        path: [fieldId],
      });
    }
  }
}

/** 创建数据源请求；strict schema 会拒绝原始 Secret 与 provider locator。 */
export const createDataSourceInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(255),
    ...dataSourceRequestShape,
  })
  .superRefine(validateAdapterFields);

/** 测试连接请求；凭据只允许以 strict credential reference 传递。 */
export const testConnectionInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(255).optional(),
    ...dataSourceRequestShape,
  })
  .superRefine(validateAdapterFields);

export type CreateDataSourceInput = z.infer<typeof createDataSourceInputSchema>;
export type TestConnectionInput = z.infer<typeof testConnectionInputSchema>;

/** 测试连接结果 */
export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

/** 数据库类型注册表 */
const categories = {
  RELATIONAL: "relational",
  ANALYTICS: "analytics",
  FILE: "file",
} as const;

export const DATABASE_TYPE_CONFIGS = Object.fromEntries(
  MANDATORY_DATASOURCE_ADAPTER_DEFINITIONS.map((descriptor) => {
    const port = descriptor.fields.find(({ field_id }) => field_id === "port");
    return [
      descriptor.adapter_id,
      {
        type: descriptor.adapter_id,
        label: descriptor.display_name,
        description: `${descriptor.dialect} · ${descriptor.topology}`,
        ...(typeof port?.default_value === "number" ? { defaultPort: port.default_value } : {}),
        fields: descriptor.fields.map(({ field_id }) => field_id),
        requiredFields: descriptor.fields
          .filter(({ required }) => required)
          .map(({ field_id }) => field_id),
        supportsSsl: descriptor.fields.some(({ field_id }) => field_id === "ssl"),
        requiresCredential: descriptor.fields.some(({ field_id }) => field_id === "credentialRef"),
        category: categories[descriptor.category],
        placeholders: Object.fromEntries(
          descriptor.fields.flatMap(({ field_id, placeholder }) =>
            placeholder === null ? [] : [[field_id, placeholder]],
          ),
        ),
      } satisfies DatabaseTypeConfig,
    ];
  }),
) as Record<DatabaseType, DatabaseTypeConfig>;

/** 按类型获取配置 */
export function getDatabaseTypeConfig(type: DatabaseType): DatabaseTypeConfig {
  return DATABASE_TYPE_CONFIGS[type];
}

/** 所有数据库类型（按注册表顺序） */
export const DATABASE_TYPES: DatabaseType[] = MANDATORY_DATASOURCE_ADAPTER_DEFINITIONS.map(
  ({ adapter_id }) => adapter_id,
);

/** SSL 选项配置 */
export const SSL_OPTIONS: { value: SSLOption; label: string }[] = [
  { value: "disable", label: "禁用" },
  { value: "require", label: "要求" },
  { value: "verify-ca", label: "验证 CA" },
  { value: "verify-full", label: "完全验证" },
];

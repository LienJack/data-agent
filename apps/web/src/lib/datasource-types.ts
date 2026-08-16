/**
 * Data Sources 类型定义。
 *
 * 数据源连接管理的数据类型，采用注册表驱动设计。
 * 新增数据库类型只需扩展 DatabaseType 和 DATABASE_TYPE_CONFIGS。
 */

import { type DataSourceCredentialRef, dataSourceCredentialRefSchema } from "@data-agent/contracts";
import { z } from "zod";

/** 数据库类型 */
export type DatabaseType = "postgresql" | "mysql" | "clickhouse" | "sqlite" | "trino";

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
  | "catalog"
  | "schema";

/** 数据库大类 */
export type DatabaseCategory = "relational" | "analytics" | "file" | "query-engine";

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
  type: z.enum(["postgresql", "mysql", "clickhouse", "sqlite", "trino"]),
  host: z.string().trim().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  database: z.string().trim().min(1).max(255).optional(),
  username: z.string().trim().min(1).max(255).optional(),
  credentialRef: dataSourceCredentialRefSchema.optional(),
  ssl: z.enum(["disable", "require", "verify-ca", "verify-full"]).optional(),
  path: z.string().trim().min(1).max(4096).optional(),
  catalog: z.string().trim().min(1).max(255).optional(),
  schema: z.string().trim().min(1).max(255).optional(),
} as const;

/** 创建数据源请求；strict schema 会拒绝原始 Secret 与 provider locator。 */
export const createDataSourceInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  ...dataSourceRequestShape,
});

/** 测试连接请求；凭据只允许以 strict credential reference 传递。 */
export const testConnectionInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(255).optional(),
  ...dataSourceRequestShape,
});

export type CreateDataSourceInput = z.infer<typeof createDataSourceInputSchema>;
export type TestConnectionInput = z.infer<typeof testConnectionInputSchema>;

/** 测试连接结果 */
export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

/** 数据库类型注册表 */
export const DATABASE_TYPE_CONFIGS: Record<DatabaseType, DatabaseTypeConfig> = {
  postgresql: {
    type: "postgresql",
    label: "PostgreSQL",
    description: "关系型数据库，支持 SSL 连接",
    defaultPort: 5432,
    fields: ["host", "port", "database", "username", "ssl"],
    requiredFields: ["host", "database", "username"],
    supportsSsl: true,
    requiresCredential: true,
    category: "relational",
    placeholders: {
      host: "localhost",
      database: "analytics",
      username: "admin",
    },
  },
  mysql: {
    type: "mysql",
    label: "MySQL",
    description: "关系型数据库，支持 SSL 连接",
    defaultPort: 3306,
    fields: ["host", "port", "database", "username", "ssl"],
    requiredFields: ["host", "database", "username"],
    supportsSsl: true,
    requiresCredential: true,
    category: "relational",
    placeholders: {
      host: "localhost",
      database: "analytics",
      username: "admin",
    },
  },
  clickhouse: {
    type: "clickhouse",
    label: "ClickHouse",
    description: "列式分析数据库，走 HTTP 接口",
    defaultPort: 8123,
    fields: ["host", "port", "database", "username", "ssl"],
    requiredFields: ["host", "database", "username"],
    supportsSsl: true,
    requiresCredential: true,
    category: "analytics",
    placeholders: {
      host: "localhost",
      database: "default",
      username: "default",
    },
  },
  sqlite: {
    type: "sqlite",
    label: "SQLite",
    description: "嵌入式文件数据库，无需服务器",
    fields: ["path"],
    requiredFields: ["path"],
    supportsSsl: false,
    requiresCredential: false,
    category: "file",
    placeholders: {
      path: "/path/to/analytics.db",
    },
  },
  trino: {
    type: "trino",
    label: "Trino",
    description: "分布式 SQL 查询引擎",
    defaultPort: 8080,
    fields: ["host", "port", "catalog", "schema", "username", "ssl"],
    requiredFields: ["host", "username"],
    supportsSsl: true,
    requiresCredential: true,
    category: "query-engine",
    placeholders: {
      host: "localhost",
      catalog: "tpch",
      schema: "tiny",
      username: "default",
    },
  },
};

/** 按类型获取配置 */
export function getDatabaseTypeConfig(type: DatabaseType): DatabaseTypeConfig {
  return DATABASE_TYPE_CONFIGS[type];
}

/** 所有数据库类型（按注册表顺序） */
export const DATABASE_TYPES: DatabaseType[] = Object.keys(DATABASE_TYPE_CONFIGS) as DatabaseType[];

/** SSL 选项配置 */
export const SSL_OPTIONS: { value: SSLOption; label: string }[] = [
  { value: "disable", label: "禁用" },
  { value: "require", label: "要求" },
  { value: "verify-ca", label: "验证 CA" },
  { value: "verify-full", label: "完全验证" },
];

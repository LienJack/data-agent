"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDataSourceStore } from "@/lib/datasource-store";
import type {
  ConnectionField,
  CreateDataSourceInput,
  DatabaseType,
  SSLOption,
  TestConnectionInput,
} from "@/lib/datasource-types";
import { DATABASE_TYPE_CONFIGS, DATABASE_TYPES, SSL_OPTIONS } from "@/lib/datasource-types";

const FIELD_LABELS: Record<ConnectionField, string> = {
  host: "主机",
  port: "端口",
  database: "数据库名",
  username: "用户名",
  ssl: "SSL",
  path: "文件路径",
  catalog: "Catalog",
  schema: "Schema",
};

const FIELD_INPUT_TYPE: Record<Exclude<ConnectionField, "ssl">, "text" | "number"> = {
  host: "text",
  port: "number",
  database: "text",
  username: "text",
  path: "text",
  catalog: "text",
  schema: "text",
};

/**
 * 数据源连接表单。
 *
 * 对话框形式，支持选择数据库类型并填写连接配置。
 * 包含测试连接按钮，验证配置是否正确。
 */
export function ConnectionForm() {
  const addConnection = useDataSourceStore((s) => s.addConnection);
  const testConnection = useDataSourceStore((s) => s.testConnection);
  const setShowForm = useDataSourceStore((s) => s.setShowForm);
  const testResult = useDataSourceStore((s) => s.testResult);

  const [name, setName] = useState("");
  const [type, setType] = useState<DatabaseType>("postgresql");
  const [values, setValues] = useState<Record<string, string>>({
    host: "",
    port: DATABASE_TYPE_CONFIGS.postgresql.defaultPort?.toString() ?? "",
    database: "",
    username: "",
    ssl: "disable",
    path: "",
    catalog: "",
    schema: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const config = DATABASE_TYPE_CONFIGS[type];
  const fields = config.fields;
  const requiredFields = config.requiredFields;
  const supportsSsl = config.supportsSsl;

  const setFieldValue = useCallback((field: ConnectionField, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  }, []);
  const readValue = useCallback((field: ConnectionField) => values[field] ?? "", [values]);

  const handleTypeChange = useCallback((newType: DatabaseType) => {
    setType(newType);
    const nextConfig = DATABASE_TYPE_CONFIGS[newType];
    setValues((prev) => ({
      ...prev,
      port: nextConfig.defaultPort?.toString() ?? "",
      ssl: "disable",
    }));
    setError(undefined);
  }, []);

  const handleTest = useCallback(async () => {
    if (config.requiresCredential) {
      setError("Secret Provider 尚未配置，当前不能测试需要凭据的连接");
      return;
    }
    const missing = requiredFields.find((field) => !values[field]?.trim());
    if (missing) {
      setError(`请填写必填字段: ${FIELD_LABELS[missing]}`);
      return;
    }
    setError(undefined);

    const input: TestConnectionInput = {
      name: name.trim() || `${config.label} 数据源`,
      type,
      ssl: supportsSsl ? (values.ssl as SSLOption) : undefined,
    };
    if (fields.includes("host")) input.host = readValue("host").trim();
    if (fields.includes("port")) input.port = parseInt(readValue("port"), 10) || config.defaultPort;
    if (fields.includes("database")) input.database = readValue("database").trim();
    if (fields.includes("username")) input.username = readValue("username").trim();
    if (fields.includes("path")) input.path = readValue("path").trim();
    if (fields.includes("catalog")) input.catalog = readValue("catalog").trim();
    if (fields.includes("schema")) input.schema = readValue("schema").trim();

    await testConnection(input);
  }, [type, values, name, requiredFields, fields, supportsSsl, config, readValue, testConnection]);

  const handleSubmit = useCallback(async () => {
    if (config.requiresCredential) {
      setError("Secret Provider 尚未配置，当前不能保存需要凭据的连接");
      return;
    }
    if (!name.trim()) {
      setError("请填写连接名称");
      return;
    }
    const missing = requiredFields.find((field) => !values[field]?.trim());
    if (missing) {
      setError(`请填写必填字段: ${FIELD_LABELS[missing]}`);
      return;
    }

    setSubmitting(true);
    setError(undefined);

    try {
      const input: CreateDataSourceInput = {
        name: name.trim(),
        type,
        ssl: supportsSsl ? (values.ssl as SSLOption) : undefined,
      };
      if (fields.includes("host")) input.host = readValue("host").trim();
      if (fields.includes("port"))
        input.port = parseInt(readValue("port"), 10) || config.defaultPort;
      if (fields.includes("database")) input.database = readValue("database").trim();
      if (fields.includes("username")) input.username = readValue("username").trim();
      if (fields.includes("path")) input.path = readValue("path").trim();
      if (fields.includes("catalog")) input.catalog = readValue("catalog").trim();
      if (fields.includes("schema")) input.schema = readValue("schema").trim();

      await addConnection(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  }, [name, type, values, requiredFields, fields, supportsSsl, config, readValue, addConnection]);

  return (
    <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">添加数据源连接</h3>
        <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
          取消
        </Button>
      </div>

      <div className="space-y-3">
        {config.requiresCredential && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            该连接必须绑定 Secret Provider 凭据引用；M0 在 Provider 接入前保持失败关闭。
          </div>
        )}
        {/* 数据库类型选择 */}
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
            数据库类型
          </span>
          <div className="flex flex-wrap gap-2">
            {DATABASE_TYPES.map((dbType) => (
              <button
                key={dbType}
                type="button"
                onClick={() => handleTypeChange(dbType)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  type === dbType
                    ? "bg-[var(--color-accent)] text-white"
                    : "border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
                }`}
              >
                {DATABASE_TYPE_CONFIGS[dbType].label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{config.description}</p>
        </div>

        {/* 连接名称 */}
        <div>
          <label
            htmlFor="connection-name"
            className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]"
          >
            连接名称
          </label>
          <input
            id="connection-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${config.label} 数据源`}
            className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focused)] focus:outline-none"
          />
        </div>

        {/* 动态字段 */}
        {fields.map((field) => {
          if (field === "ssl") {
            if (!supportsSsl) return null;
            return (
              <div key={field}>
                <label
                  htmlFor={`connection-${field}`}
                  className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]"
                >
                  {FIELD_LABELS[field]}
                </label>
                <select
                  id={`connection-${field}`}
                  value={values[field] ?? "disable"}
                  onChange={(e) => setFieldValue(field, e.target.value)}
                  className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-border-focused)] focus:outline-none"
                >
                  {SSL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          return (
            <div key={field}>
              <label
                htmlFor={`connection-${field}`}
                className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]"
              >
                {FIELD_LABELS[field]}
                {requiredFields.includes(field) ? " *" : ""}
              </label>
              <input
                id={`connection-${field}`}
                type={FIELD_INPUT_TYPE[field]}
                value={values[field] ?? ""}
                onChange={(e) => setFieldValue(field, e.target.value)}
                placeholder={config.placeholders?.[field] ?? FIELD_LABELS[field]}
                className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-focused)] focus:outline-none"
              />
            </div>
          );
        })}

        {/* 测试结果 */}
        {testResult && (
          <div
            className={`rounded-md px-3 py-2 text-xs ${
              testResult.success ? "bg-green-900/20 text-green-400" : "bg-red-900/20 text-red-400"
            }`}
          >
            {testResult.success
              ? `连接成功 (${testResult.latencyMs}ms)`
              : `连接失败: ${testResult.message}`}
          </div>
        )}

        {/* 错误信息 */}
        {error && (
          <div className="rounded-md bg-red-900/20 px-3 py-2 text-xs text-red-400">{error}</div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 pt-1">
          <Button variant="secondary" size="md" onClick={handleTest}>
            测试连接
          </Button>
          <Button variant="primary" size="md" loading={submitting} onClick={handleSubmit}>
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}

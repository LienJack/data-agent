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
import { cn } from "@/lib/utils";
import { DataSourceMark } from "./data-source-mark";

const FIELD_LABELS: Record<ConnectionField, string> = {
  host: "主机",
  port: "端口",
  database: "数据库名",
  username: "用户名",
  credentialRef: "凭据引用",
  ssl: "SSL",
  path: "文件路径",
};

const FIELD_INPUT_TYPE: Record<
  Exclude<ConnectionField, "ssl" | "credentialRef">,
  "text" | "number"
> = {
  host: "text",
  port: "number",
  database: "text",
  username: "text",
  path: "text",
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

      await addConnection(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  }, [name, type, values, requiredFields, fields, supportsSsl, config, readValue, addConnection]);

  return (
    <div className="surface-reading rounded-[var(--radius-panel)] border border-[var(--color-border-default)] p-4 sm:p-5">
      <div className="mb-5 flex items-start justify-between gap-4 border-b border-[var(--color-border-default)] pb-4">
        <div>
          <p className="page-eyebrow">New connection</p>
          <h2 className="mt-2 text-lg font-semibold tracking-[-0.025em] text-[var(--color-text-primary)]">
            添加数据源连接
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            凭据通过服务端引用管理，表单不接收明文密码。
          </p>
        </div>
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
        {/* 数据库类型卡片 */}
        <div>
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <span className="block text-xs font-medium text-[var(--color-text-secondary)]">
                选择数据源类型
              </span>
              <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                选择后将显示该类型需要的连接字段
              </p>
            </div>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {DATABASE_TYPES.length} 种连接器
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {DATABASE_TYPES.map((dbType) => {
              const item = DATABASE_TYPE_CONFIGS[dbType];
              const selected = type === dbType;
              return (
                <button
                  key={dbType}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => handleTypeChange(dbType)}
                  className={cn(
                    "relative min-h-28 rounded-[var(--radius-item)] border p-3 text-left transition-colors",
                    selected
                      ? "border-[var(--color-border-focused)] bg-[var(--color-selection-selected-bg)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_10%,transparent)]"
                      : "border-[var(--color-border-default)] bg-[var(--color-bg-primary)] hover:border-[var(--color-border-focused)]",
                  )}
                >
                  <span className="flex items-start gap-2.5">
                    <DataSourceMark type={dbType} size="md" />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-[var(--color-text-primary)]">
                        {item.label}
                      </span>
                      <span className="mt-1 block text-[10px] leading-4 text-[var(--color-text-muted)]">
                        {item.description}
                      </span>
                    </span>
                  </span>
                  <span className="mt-2 flex items-center gap-2 text-[9px] uppercase tracking-[0.06em] text-[var(--color-text-muted)]">
                    <span>{item.category}</span>
                    {item.defaultPort && <span>端口 {item.defaultPort}</span>}
                  </span>
                  {selected && (
                    <span className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-accent)] text-[9px] text-white">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
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
          if (field === "credentialRef") {
            return (
              <div
                key={field}
                className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-canvas)] px-3 py-2 text-xs text-[var(--color-text-secondary)]"
              >
                凭据由服务端 SecretRef 选择器绑定，连接表单不接收明文密码。
              </div>
            );
          }
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
            className={`rounded-[var(--radius-control)] border px-3 py-2 text-xs ${
              testResult.success
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {testResult.success
              ? `连接成功 (${testResult.latencyMs}ms)`
              : `连接失败: ${testResult.message}`}
          </div>
        )}

        {/* 错误信息 */}
        {error && (
          <div className="rounded-[var(--radius-control)] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
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

"use client";

import {
  type McpServerRegistryItem,
  type McpServerRevision,
  mcpServerRegistryItemSchema,
  type SkillRegistryItem,
  type SkillRevision,
  skillRegistryItemSchema,
  type WorkspaceAccessProjection,
} from "@data-agent/contracts";
import {
  ArrowClockwise,
  CheckCircle,
  Package,
  Pause,
  Play,
  PlugsConnected,
  Plus,
  ShieldCheck,
} from "@phosphor-icons/react";
import { cloneElement, type ReactElement, useCallback, useEffect, useId, useState } from "react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { workspaceRequestHeaders } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type ExtensionKind = "mcp" | "skill";
type McpRevisionInput = Omit<McpServerRevision, "scope" | "revision_hash">;
type SkillRevisionInput = Omit<SkillRevision, "scope" | "revision_hash">;

interface ExtensionsPanelProps {
  readonly workspaces: readonly WorkspaceAccessProjection[];
}

interface ApiEnvelope {
  readonly data?: unknown;
  readonly error?: { readonly message?: string };
}

const hashPlaceholder = `sha256:${"0".repeat(64)}`;
const mcpListSchema = z.array(mcpServerRegistryItemSchema);
const skillListSchema = z.array(skillRegistryItemSchema);

function extensionUrl(workspaceId: string, kind: ExtensionKind): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/${kind === "mcp" ? "mcp-servers" : "skills"}`;
}

async function requestData<T>(
  workspaceId: string,
  kind: ExtensionKind,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(extensionUrl(workspaceId, kind), {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...workspaceRequestHeaders(workspaceId),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as ApiEnvelope;
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error?.message ?? `请求失败 (${response.status})`);
  }
  return schema.parse(body.data);
}

function shortHash(value: string): string {
  return `${value.slice(0, 14)}…${value.slice(-8)}`;
}

function lifecycleVariant(lifecycle: string) {
  if (lifecycle === "ENABLED") return "success" as const;
  if (lifecycle === "DISABLED" || lifecycle === "QUARANTINED") return "warning" as const;
  return "danger" as const;
}

function inputClassName() {
  return "min-h-10 w-full rounded border border-[var(--color-border-default)] bg-[var(--color-bg-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]";
}

function Field({
  label,
  children,
  wide = false,
}: {
  readonly label: string;
  readonly children: ReactElement<{ readonly "aria-labelledby"?: string }>;
  readonly wide?: boolean;
}) {
  const labelId = useId();
  return (
    <div className={cn("grid gap-1.5", wide && "md:col-span-2")}>
      <span id={labelId} className="text-[11px] font-medium text-[var(--color-text-secondary)]">
        {label}
      </span>
      {cloneElement(children, { "aria-labelledby": labelId })}
    </div>
  );
}

function EmptyInventory({ kind }: { readonly kind: ExtensionKind }) {
  const Icon = kind === "mcp" ? PlugsConnected : Package;
  return (
    <div className="flex min-h-44 flex-col items-center justify-center border border-dashed border-[var(--color-border-default)] px-5 text-center">
      <Icon size={26} className="text-[var(--color-text-muted)]" />
      <p className="mt-3 text-sm font-medium">尚无{kind === "mcp" ? " MCP Server" : " Skill"}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--color-text-muted)]">
        注册后，每个 Run 仍只会使用 Effective Config 冻结的已批准 Revision。
      </p>
    </div>
  );
}

export function ExtensionInventory({
  kind,
  mcpItems,
  skillItems,
  canManage,
  busy,
  onLifecycle,
  onRevise,
}: {
  readonly kind: ExtensionKind;
  readonly mcpItems: readonly McpServerRegistryItem[];
  readonly skillItems: readonly SkillRegistryItem[];
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onLifecycle?: (
    item: McpServerRegistryItem | SkillRegistryItem,
    enabled: boolean,
  ) => void;
  readonly onRevise?: (item: McpServerRegistryItem | SkillRegistryItem) => void;
}) {
  const items = kind === "mcp" ? mcpItems : skillItems;
  if (items.length === 0) return <EmptyInventory kind={kind} />;

  return (
    <div className="divide-y divide-[var(--color-border-default)] border-y border-[var(--color-border-default)]">
      {items.map((item) => {
        const revision = item.revision;
        const objectId = "server_id" in revision ? revision.server_id : revision.skill_id;
        const title = "server_id" in revision ? revision.manifest_version : revision.name;
        const description =
          "server_id" in revision
            ? `${revision.endpoint} · ${revision.tools.length} tools`
            : revision.source_url;
        const enabled = item.head.lifecycle === "ENABLED";
        return (
          <article key={objectId} className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold">{title}</h3>
                <Badge variant={lifecycleVariant(item.head.lifecycle)}>{item.head.lifecycle}</Badge>
                <Badge variant={revision.approval_status === "APPROVED" ? "success" : "warning"}>
                  {revision.approval_status}
                </Badge>
              </div>
              <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">
                {description}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] text-[var(--color-text-muted)]">
                <span>REV {revision.revision}</span>
                <span>HEAD {item.head.version}</span>
                <span title={revision.revision_hash}>{shortHash(revision.revision_hash)}</span>
                {"signer_id" in revision && <span>SIGNER {revision.signer_id.slice(0, 8)}</span>}
              </div>
              <details className="mt-3 text-xs text-[var(--color-text-secondary)]">
                <summary className="cursor-pointer select-none font-medium">Revision 约束</summary>
                <div className="mt-2 grid gap-1.5 border-l-2 border-[var(--color-border-default)] pl-3 font-mono text-[10px] leading-5">
                  {"server_id" in revision ? (
                    <>
                      <span>
                        trust={revision.trust_class} · audience={revision.audience}
                      </span>
                      <span>policy_revision={revision.policy_revision}</span>
                      <span>
                        {revision.tools
                          .map((tool) => `${tool.tool_id}:${tool.effect_semantics}`)
                          .join(" · ")}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>publisher={revision.publisher_trust}</span>
                      <span>package={shortHash(revision.package_hash)}</span>
                      <span>capabilities={revision.capabilities.join(", ")}</span>
                    </>
                  )}
                </div>
              </details>
            </div>
            {canManage && item.head.lifecycle !== "REVOKED" && (
              <div className="flex items-start gap-2 lg:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onRevise?.(item)}
                >
                  <ArrowClockwise size={14} />新 Revision
                </Button>
                <Button
                  type="button"
                  variant={enabled ? "secondary" : "primary"}
                  disabled={busy || revision.approval_status !== "APPROVED"}
                  onClick={() => onLifecycle?.(item, !enabled)}
                >
                  {enabled ? <Pause size={14} /> : <Play size={14} weight="fill" />}
                  {enabled ? "停用" : "启用"}
                </Button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

interface McpFormState {
  readonly serverId: string;
  readonly revision: string;
  readonly endpoint: string;
  readonly secretRefId: string;
  readonly manifestVersion: string;
  readonly trustClass: McpServerRevision["trust_class"];
  readonly approvalStatus: McpServerRevision["approval_status"];
  readonly audience: McpServerRevision["audience"];
  readonly lifecycle: "ENABLED" | "DISABLED";
  readonly policyRevision: string;
  readonly toolId: string;
  readonly toolName: string;
  readonly toolDescription: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly effectSemantics: McpServerRevision["tools"][number]["effect_semantics"];
  readonly remoteIdempotencyField: string;
  readonly outcomeStatusToolId: string;
  readonly capabilities: string;
  readonly maxTimeoutMs: string;
  readonly maxResponseBytes: string;
  readonly expectedHeadVersion: number | null;
}

function emptyMcpForm(): McpFormState {
  return {
    serverId: crypto.randomUUID(),
    revision: "1",
    endpoint: "",
    secretRefId: "",
    manifestVersion: "",
    trustClass: "EXTERNAL_REVIEWED",
    approvalStatus: "QUARANTINED",
    audience: "PRIVATE",
    lifecycle: "DISABLED",
    policyRevision: "1",
    toolId: "",
    toolName: "",
    toolDescription: "",
    inputHash: "",
    outputHash: "",
    effectSemantics: "READ_ONLY",
    remoteIdempotencyField: "",
    outcomeStatusToolId: "",
    capabilities: "semantic.read",
    maxTimeoutMs: "10000",
    maxResponseBytes: "1000000",
    expectedHeadVersion: null,
  };
}

function mcpFormFor(item: McpServerRegistryItem): McpFormState {
  const revision = item.revision;
  const tool = revision.tools[0];
  return {
    serverId: revision.server_id,
    revision: String(revision.revision + 1),
    endpoint: revision.endpoint,
    secretRefId: revision.secret_ref_id ?? "",
    manifestVersion: revision.manifest_version,
    trustClass: revision.trust_class,
    approvalStatus: revision.approval_status,
    audience: revision.audience,
    lifecycle: item.head.lifecycle === "ENABLED" ? "ENABLED" : "DISABLED",
    policyRevision: String(revision.policy_revision),
    toolId: tool?.tool_id ?? "",
    toolName: tool?.name ?? "",
    toolDescription: tool?.description ?? "",
    inputHash: tool?.input_schema_hash ?? "",
    outputHash: tool?.output_schema_hash ?? "",
    effectSemantics: tool?.effect_semantics ?? "READ_ONLY",
    remoteIdempotencyField: tool?.remote_idempotency_key_field ?? "",
    outcomeStatusToolId: tool?.outcome_status_tool_id ?? "",
    capabilities: tool?.required_capabilities.join(", ") ?? "",
    maxTimeoutMs: String(tool?.max_timeout_ms ?? 10000),
    maxResponseBytes: String(tool?.max_response_bytes ?? 1000000),
    expectedHeadVersion: item.head.version,
  };
}

function McpRevisionForm({
  value,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  readonly value: McpFormState;
  readonly busy: boolean;
  readonly onChange: (value: McpFormState) => void;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
}) {
  const set = <K extends keyof McpFormState>(key: K, next: McpFormState[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <form
      className="border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">MCP Server Revision</h3>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            服务端生成 canonical hash；Endpoint 不接收内嵌凭据。
          </p>
        </div>
        <Badge variant="outline">HEAD {value.expectedHeadVersion ?? "NEW"}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Server ID">
          <input
            className={inputClassName()}
            value={value.serverId}
            onChange={(e) => set("serverId", e.target.value)}
            required
          />
        </Field>
        <Field label="Revision">
          <input
            className={inputClassName()}
            type="number"
            min="1"
            value={value.revision}
            onChange={(e) => set("revision", e.target.value)}
            required
          />
        </Field>
        <Field label="HTTPS Endpoint" wide>
          <input
            className={inputClassName()}
            type="url"
            placeholder="https://mcp.example.com/v1"
            value={value.endpoint}
            onChange={(e) => set("endpoint", e.target.value)}
            required
          />
        </Field>
        <Field label="Secret Ref ID (optional)">
          <input
            className={inputClassName()}
            value={value.secretRefId}
            onChange={(e) => set("secretRefId", e.target.value)}
          />
        </Field>
        <Field label="Manifest Version">
          <input
            className={inputClassName()}
            placeholder="semantic-mcp@1"
            value={value.manifestVersion}
            onChange={(e) => set("manifestVersion", e.target.value)}
            required
          />
        </Field>
        <Field label="Trust Class">
          <select
            className={inputClassName()}
            value={value.trustClass}
            onChange={(e) => set("trustClass", e.target.value as McpFormState["trustClass"])}
          >
            <option value="INTERNAL">Internal</option>
            <option value="TRUSTED_PUBLISHER">Trusted publisher</option>
            <option value="EXTERNAL_REVIEWED">External reviewed</option>
          </select>
        </Field>
        <Field label="Audience">
          <select
            className={inputClassName()}
            value={value.audience}
            onChange={(e) => set("audience", e.target.value as McpFormState["audience"])}
          >
            <option value="PRIVATE">Private</option>
            <option value="WORKSPACE">Workspace</option>
          </select>
        </Field>
        <Field label="Approval">
          <select
            className={inputClassName()}
            value={value.approvalStatus}
            onChange={(e) =>
              set("approvalStatus", e.target.value as McpFormState["approvalStatus"])
            }
          >
            <option value="QUARANTINED">Quarantined</option>
            <option value="APPROVED">Approved</option>
          </select>
        </Field>
        <Field label="Target Lifecycle">
          <select
            className={inputClassName()}
            value={value.lifecycle}
            onChange={(e) => set("lifecycle", e.target.value as McpFormState["lifecycle"])}
          >
            <option value="DISABLED">Disabled</option>
            <option value="ENABLED">Enabled</option>
          </select>
        </Field>
        <Field label="Policy Revision">
          <input
            className={inputClassName()}
            type="number"
            min="1"
            value={value.policyRevision}
            onChange={(e) => set("policyRevision", e.target.value)}
            required
          />
        </Field>
      </div>
      <div className="my-4 border-t border-[var(--color-border-default)] pt-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
          Primary tool manifest
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Tool ID">
            <input
              className={inputClassName()}
              placeholder="list_metrics"
              value={value.toolId}
              onChange={(e) => set("toolId", e.target.value)}
              required
            />
          </Field>
          <Field label="Tool Name">
            <input
              className={inputClassName()}
              value={value.toolName}
              onChange={(e) => set("toolName", e.target.value)}
              required
            />
          </Field>
          <Field label="Description" wide>
            <input
              className={inputClassName()}
              value={value.toolDescription}
              onChange={(e) => set("toolDescription", e.target.value)}
              required
            />
          </Field>
          <Field label="Input Schema Hash">
            <input
              className={inputClassName()}
              placeholder={hashPlaceholder}
              value={value.inputHash}
              onChange={(e) => set("inputHash", e.target.value)}
              required
            />
          </Field>
          <Field label="Output Schema Hash">
            <input
              className={inputClassName()}
              placeholder={hashPlaceholder}
              value={value.outputHash}
              onChange={(e) => set("outputHash", e.target.value)}
              required
            />
          </Field>
          <Field label="Effect Semantics">
            <select
              className={inputClassName()}
              value={value.effectSemantics}
              onChange={(e) =>
                set("effectSemantics", e.target.value as McpFormState["effectSemantics"])
              }
            >
              <option value="READ_ONLY">Read only</option>
              <option value="IDEMPOTENT_REQUEST">Idempotent request</option>
              <option value="OUTCOME_STATUS_QUERY">Outcome status query</option>
            </select>
          </Field>
          {value.effectSemantics === "IDEMPOTENT_REQUEST" && (
            <Field label="Remote Idempotency Field">
              <input
                className={inputClassName()}
                value={value.remoteIdempotencyField}
                onChange={(e) => set("remoteIdempotencyField", e.target.value)}
                required
              />
            </Field>
          )}
          {value.effectSemantics === "OUTCOME_STATUS_QUERY" && (
            <Field label="Outcome Status Tool ID">
              <input
                className={inputClassName()}
                value={value.outcomeStatusToolId}
                onChange={(e) => set("outcomeStatusToolId", e.target.value)}
                required
              />
            </Field>
          )}
          <Field label="Required Capabilities">
            <input
              className={inputClassName()}
              value={value.capabilities}
              onChange={(e) => set("capabilities", e.target.value)}
              required
            />
          </Field>
          <Field label="Timeout (ms)">
            <input
              className={inputClassName()}
              type="number"
              min="1"
              max="120000"
              value={value.maxTimeoutMs}
              onChange={(e) => set("maxTimeoutMs", e.target.value)}
              required
            />
          </Field>
          <Field label="Response Limit (bytes)">
            <input
              className={inputClassName()}
              type="number"
              min="1"
              value={value.maxResponseBytes}
              onChange={(e) => set("maxResponseBytes", e.target.value)}
              required
            />
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" loading={busy}>
          <CheckCircle size={15} weight="fill" />
          提交 Revision
        </Button>
      </div>
    </form>
  );
}

interface SkillFormState {
  readonly skillId: string;
  readonly revision: string;
  readonly name: string;
  readonly sourceUrl: string;
  readonly packageHash: string;
  readonly dependencyLockHash: string;
  readonly signerId: string;
  readonly signatureHash: string;
  readonly publisherTrust: SkillRevision["publisher_trust"];
  readonly approvalStatus: SkillRevision["approval_status"];
  readonly lifecycle: "ENABLED" | "DISABLED" | "QUARANTINED";
  readonly capabilities: string;
  readonly expectedHeadVersion: number | null;
}

function emptySkillForm(): SkillFormState {
  return {
    skillId: crypto.randomUUID(),
    revision: "1",
    name: "",
    sourceUrl: "",
    packageHash: "",
    dependencyLockHash: "",
    signerId: crypto.randomUUID(),
    signatureHash: "",
    publisherTrust: "WORKSPACE_SIGNER",
    approvalStatus: "QUARANTINED",
    lifecycle: "QUARANTINED",
    capabilities: "semantic.read",
    expectedHeadVersion: null,
  };
}

function skillFormFor(item: SkillRegistryItem): SkillFormState {
  const revision = item.revision;
  return {
    skillId: revision.skill_id,
    revision: String(revision.revision + 1),
    name: revision.name,
    sourceUrl: revision.source_url,
    packageHash: revision.package_hash,
    dependencyLockHash: revision.dependency_lock_hash,
    signerId: revision.signer_id,
    signatureHash: revision.signature_hash,
    publisherTrust: revision.publisher_trust,
    approvalStatus: revision.approval_status,
    lifecycle:
      item.head.lifecycle === "ENABLED"
        ? "ENABLED"
        : item.head.lifecycle === "QUARANTINED"
          ? "QUARANTINED"
          : "DISABLED",
    capabilities: revision.capabilities.join(", "),
    expectedHeadVersion: item.head.version,
  };
}

function SkillRevisionForm({
  value,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  readonly value: SkillFormState;
  readonly busy: boolean;
  readonly onChange: (value: SkillFormState) => void;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
}) {
  const set = <K extends keyof SkillFormState>(key: K, next: SkillFormState[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <form
      className="border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Skill Revision</h3>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            仅登记签名且内容寻址的 package；安装脚本固定为空。
          </p>
        </div>
        <Badge variant="outline">HEAD {value.expectedHeadVersion ?? "NEW"}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Skill ID">
          <input
            className={inputClassName()}
            value={value.skillId}
            onChange={(e) => set("skillId", e.target.value)}
            required
          />
        </Field>
        <Field label="Revision">
          <input
            className={inputClassName()}
            type="number"
            min="1"
            value={value.revision}
            onChange={(e) => set("revision", e.target.value)}
            required
          />
        </Field>
        <Field label="Name">
          <input
            className={inputClassName()}
            value={value.name}
            onChange={(e) => set("name", e.target.value)}
            required
          />
        </Field>
        <Field label="HTTPS Source URL">
          <input
            className={inputClassName()}
            type="url"
            value={value.sourceUrl}
            onChange={(e) => set("sourceUrl", e.target.value)}
            required
          />
        </Field>
        <Field label="Package Hash">
          <input
            className={inputClassName()}
            placeholder={hashPlaceholder}
            value={value.packageHash}
            onChange={(e) => set("packageHash", e.target.value)}
            required
          />
        </Field>
        <Field label="Dependency Lock Hash">
          <input
            className={inputClassName()}
            placeholder={hashPlaceholder}
            value={value.dependencyLockHash}
            onChange={(e) => set("dependencyLockHash", e.target.value)}
            required
          />
        </Field>
        <Field label="Signer ID">
          <input
            className={inputClassName()}
            value={value.signerId}
            onChange={(e) => set("signerId", e.target.value)}
            required
          />
        </Field>
        <Field label="Signature Hash">
          <input
            className={inputClassName()}
            placeholder={hashPlaceholder}
            value={value.signatureHash}
            onChange={(e) => set("signatureHash", e.target.value)}
            required
          />
        </Field>
        <Field label="Publisher Trust">
          <select
            className={inputClassName()}
            value={value.publisherTrust}
            onChange={(e) =>
              set("publisherTrust", e.target.value as SkillFormState["publisherTrust"])
            }
          >
            <option value="WORKSPACE_SIGNER">Workspace signer</option>
            <option value="TRUSTED_PUBLISHER">Trusted publisher</option>
          </select>
        </Field>
        <Field label="Approval">
          <select
            className={inputClassName()}
            value={value.approvalStatus}
            onChange={(e) =>
              set("approvalStatus", e.target.value as SkillFormState["approvalStatus"])
            }
          >
            <option value="QUARANTINED">Quarantined</option>
            <option value="APPROVED">Approved</option>
          </select>
        </Field>
        <Field label="Target Lifecycle">
          <select
            className={inputClassName()}
            value={value.lifecycle}
            onChange={(e) => set("lifecycle", e.target.value as SkillFormState["lifecycle"])}
          >
            <option value="QUARANTINED">Quarantined</option>
            <option value="DISABLED">Disabled</option>
            <option value="ENABLED">Enabled</option>
          </select>
        </Field>
        <Field label="Capabilities">
          <input
            className={inputClassName()}
            value={value.capabilities}
            onChange={(e) => set("capabilities", e.target.value)}
            required
          />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" loading={busy}>
          <ShieldCheck size={15} weight="fill" />
          提交 Revision
        </Button>
      </div>
    </form>
  );
}

function commaList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}

export function ExtensionsPanel({ workspaces }: ExtensionsPanelProps) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.workspace.workspace_id ?? "");
  const [kind, setKind] = useState<ExtensionKind>("mcp");
  const [mcpItems, setMcpItems] = useState<readonly McpServerRegistryItem[]>([]);
  const [skillItems, setSkillItems] = useState<readonly SkillRegistryItem[]>([]);
  const [mcpForm, setMcpForm] = useState<McpFormState | null>(null);
  const [skillForm, setSkillForm] = useState<SkillFormState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [servers, skills] = await Promise.all([
        requestData(workspaceId, "mcp", mcpListSchema),
        requestData(workspaceId, "skill", skillListSchema),
      ]);
      setMcpItems(servers);
      setSkillItems(skills);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Extensions 加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => void load(), [load]);

  const access = workspaces.find((item) => item.workspace.workspace_id === workspaceId);
  const canManage = access?.allowed_actions.includes("EXTENSION_MANAGE") ?? false;

  async function commit(
    kindToCommit: ExtensionKind,
    revision: McpRevisionInput | SkillRevisionInput,
    expectedHeadVersion: number | null,
    targetLifecycle: string,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestData(workspaceId, kindToCommit, z.unknown(), {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
          expected_head_version: expectedHeadVersion,
          target_lifecycle: targetLifecycle,
          revision,
        }),
      });
      setNotice(
        `${kindToCommit === "mcp" ? "MCP Server" : "Skill"} Revision 已提交并生成权威 Head。`,
      );
      setMcpForm(null);
      setSkillForm(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Extension 提交失败。");
    } finally {
      setBusy(false);
    }
  }

  function changeLifecycle(item: McpServerRegistryItem | SkillRegistryItem, enabled: boolean) {
    const { scope: _scope, revision_hash: _hash, ...revision } = item.revision;
    void commit(
      "server_id" in revision ? "mcp" : "skill",
      revision,
      item.head.version,
      enabled ? "ENABLED" : "DISABLED",
    );
  }

  function revise(item: McpServerRegistryItem | SkillRegistryItem) {
    if ("server_id" in item.revision) {
      setKind("mcp");
      setMcpForm(mcpFormFor(item as McpServerRegistryItem));
    } else {
      setKind("skill");
      setSkillForm(skillFormFor(item as SkillRegistryItem));
    }
  }

  function submitMcp() {
    if (!mcpForm) return;
    void commit(
      "mcp",
      {
        schema_version: "mcp-server-revision@1.0.0",
        server_id: mcpForm.serverId,
        revision: Number(mcpForm.revision),
        endpoint: mcpForm.endpoint,
        secret_ref_id: mcpForm.secretRefId || null,
        trust_class: mcpForm.trustClass,
        approval_status: mcpForm.approvalStatus,
        audience: mcpForm.audience,
        manifest_version: mcpForm.manifestVersion,
        tools: [
          {
            tool_id: mcpForm.toolId,
            name: mcpForm.toolName,
            description: mcpForm.toolDescription,
            input_schema_hash: mcpForm.inputHash,
            output_schema_hash: mcpForm.outputHash,
            effect_semantics: mcpForm.effectSemantics,
            remote_idempotency_key_field:
              mcpForm.effectSemantics === "IDEMPOTENT_REQUEST"
                ? mcpForm.remoteIdempotencyField
                : null,
            outcome_status_tool_id:
              mcpForm.effectSemantics === "OUTCOME_STATUS_QUERY"
                ? mcpForm.outcomeStatusToolId
                : null,
            required_capabilities: commaList(mcpForm.capabilities),
            max_timeout_ms: Number(mcpForm.maxTimeoutMs),
            max_response_bytes: Number(mcpForm.maxResponseBytes),
          },
        ],
        policy_revision: Number(mcpForm.policyRevision),
      },
      mcpForm.expectedHeadVersion,
      mcpForm.lifecycle,
    );
  }

  function submitSkill() {
    if (!skillForm) return;
    void commit(
      "skill",
      {
        schema_version: "skill-revision@1.0.0",
        skill_id: skillForm.skillId,
        revision: Number(skillForm.revision),
        name: skillForm.name,
        source_url: skillForm.sourceUrl,
        package_hash: skillForm.packageHash,
        dependency_lock_hash: skillForm.dependencyLockHash,
        signer_id: skillForm.signerId,
        signature_hash: skillForm.signatureHash,
        publisher_trust: skillForm.publisherTrust,
        approval_status: skillForm.approvalStatus,
        capabilities: commaList(skillForm.capabilities),
        default_resources: [],
        install_scripts: [],
      },
      skillForm.expectedHeadVersion,
      skillForm.lifecycle,
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Extension authority
          </p>
          <h2 className="mt-1 text-lg font-semibold">MCP 与 Skills</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">
            内容寻址的不可变 Revision。启停只推进 Head，历史 Run 仍保留原始指纹。
          </p>
        </div>
        <select
          aria-label="Extensions Workspace"
          value={workspaceId}
          onChange={(event) => {
            setWorkspaceId(event.target.value);
            setMcpForm(null);
            setSkillForm(null);
          }}
          className={cn(inputClassName(), "w-full lg:w-64")}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.workspace.workspace_id} value={workspace.workspace.workspace_id}>
              {workspace.workspace.display_name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col justify-between gap-3 border-b border-[var(--color-border-default)] pb-3 sm:flex-row sm:items-center">
        <div
          className="inline-flex w-fit rounded border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-0.5"
          role="tablist"
          aria-label="Extension 类型"
        >
          {(
            [
              ["mcp", "MCP Servers", PlugsConnected],
              ["skill", "Skills", Package],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={kind === id}
              onClick={() => setKind(id)}
              className={cn(
                "inline-flex min-h-9 items-center gap-2 rounded px-3 text-xs font-medium transition-colors",
                kind === id
                  ? "bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] shadow-sm"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]",
              )}
            >
              <Icon size={15} weight={kind === id ? "fill" : "regular"} />
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={loading || !workspaceId}
            onClick={() => void load()}
            title="刷新 Extensions"
          >
            <ArrowClockwise size={15} />
            刷新
          </Button>
          {canManage && (
            <Button
              type="button"
              onClick={() =>
                kind === "mcp" ? setMcpForm(emptyMcpForm()) : setSkillForm(emptySkillForm())
              }
            >
              <Plus size={15} weight="bold" />
              注册 {kind === "mcp" ? "MCP" : "Skill"}
            </Button>
          )}
        </div>
      </div>

      {!canManage && workspaceId && (
        <div className="flex items-center gap-2 border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          <ShieldCheck size={15} />
          当前角色可查看已批准 Revision，但不能修改 Registry Head。
        </div>
      )}
      {error && (
        <div role="alert" className="border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="border border-emerald-700/30 bg-emerald-950/20 p-3 text-sm text-emerald-300"
        >
          {notice}
        </div>
      )}

      {kind === "mcp" && mcpForm && (
        <McpRevisionForm
          value={mcpForm}
          busy={busy}
          onChange={setMcpForm}
          onCancel={() => setMcpForm(null)}
          onSubmit={submitMcp}
        />
      )}
      {kind === "skill" && skillForm && (
        <SkillRevisionForm
          value={skillForm}
          busy={busy}
          onChange={setSkillForm}
          onCancel={() => setSkillForm(null)}
          onSubmit={submitSkill}
        />
      )}
      {loading ? (
        <div className="flex min-h-44 items-center justify-center text-sm text-[var(--color-text-muted)]">
          正在读取 Registry…
        </div>
      ) : (
        <ExtensionInventory
          kind={kind}
          mcpItems={mcpItems}
          skillItems={skillItems}
          canManage={canManage}
          busy={busy}
          onLifecycle={changeLifecycle}
          onRevise={revise}
        />
      )}
    </section>
  );
}

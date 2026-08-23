"use client";

/**
 * Modified from DeepSeek Harness AssistantMarkdown block composition.
 * Fixed upstream commit and MIT notice: components/qa/DEEPSEEK_HARNESS_MIT_NOTICE.md
 */
import type { ArtifactReference, QaInspectorTarget } from "@data-agent/contracts";
import { FileCode, ImageBroken } from "@phosphor-icons/react";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components, type UrlTransform } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { useQAStore } from "@/lib/qa-store";

const ARTIFACT_PROTOCOL = "artifact:";

const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "hr",
    "img",
    "input",
    "li",
    "ol",
    "p",
    "pre",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: ["href"],
    code: ["className"],
    input: ["type", "checked", "disabled"],
    img: ["src", "alt", "title"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto", "artifact"],
  },
};

export function artifactMarkdownHref(reference: ArtifactReference): string {
  const parameters = new URLSearchParams({
    revision: String(reference.revision),
    hash: reference.content_hash,
  });
  return `artifact://${reference.artifact_id}?${parameters.toString()}`;
}

function sameArtifactHref(reference: ArtifactReference, href: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.protocol === ARTIFACT_PROTOCOL &&
      url.hostname === reference.artifact_id &&
      url.searchParams.get("revision") === String(reference.revision) &&
      url.searchParams.get("hash") === reference.content_hash
    );
  } catch {
    return false;
  }
}

export function resolveAuthorizedMarkdownArtifact(
  href: string,
  references: readonly ArtifactReference[],
  runId: string,
): ArtifactReference | null {
  return (
    references.find(
      (reference) => reference.run_id === runId && sameArtifactHref(reference, href),
    ) ?? null
  );
}

export const safeMarkdownUrlTransform: UrlTransform = (url, key) => {
  const value = url.trim();
  if (key === "src") return "";
  if (value.startsWith("#") && /^#[A-Za-z0-9_.:-]{1,128}$/u.test(value)) return value;
  if (/^https?:\/\/[^\s]+$/iu.test(value) || /^mailto:[^\s@]+@[^\s@]+$/iu.test(value)) {
    return value;
  }
  if (
    /^artifact:\/\/[0-9a-f-]{36}\?revision=[1-9][0-9]*&hash=sha256%3A[0-9a-f]{64}$/iu.test(value)
  ) {
    return value;
  }
  return "";
};

export interface SafeAssistantMarkdownProps {
  content: string;
  runId?: string;
  sequence?: number;
  artifactReferences?: readonly ArtifactReference[];
  streaming?: boolean;
}

export function SafeAssistantMarkdown({
  content,
  runId,
  sequence = 0,
  artifactReferences = [],
  streaming = false,
}: SafeAssistantMarkdownProps) {
  const selectInspector = useQAStore((state) => state.selectInspector);
  const components: Components = {
    h1: ({ children }) => (
      <h2 className="mt-8 mb-3 text-2xl leading-tight font-semibold tracking-tight first:mt-0">
        {children}
      </h2>
    ),
    h2: ({ children }) => (
      <h3 className="mt-7 mb-2.5 text-xl leading-snug font-semibold tracking-tight first:mt-0">
        {children}
      </h3>
    ),
    h3: ({ children }) => (
      <h4 className="mt-6 mb-2 text-[17px] leading-snug font-semibold first:mt-0">{children}</h4>
    ),
    h4: ({ children }) => (
      <h5 className="mt-5 mb-2 text-[15px] leading-snug font-semibold first:mt-0">{children}</h5>
    ),
    p: ({ children }) => (
      <p className="my-3 max-w-[65ch] text-[15px] leading-7 text-[var(--color-text-primary)] first:mt-0 last:mb-0">
        {children}
      </p>
    ),
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="text-[var(--color-text-muted)]">{children}</del>,
    ul: ({ children, className }) => (
      <ul
        className={`my-3 max-w-[65ch] space-y-1.5 pl-5 text-[15px] leading-7 ${className?.includes("contains-task-list") ? "list-none pl-0" : "list-disc"}`}
      >
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-3 max-w-[65ch] list-decimal space-y-1.5 pl-5 text-[15px] leading-7">
        {children}
      </ol>
    ),
    li: ({ children, className }) => (
      <li className={className?.includes("task-list-item") ? "flex items-start gap-2" : "pl-1"}>
        {children}
      </li>
    ),
    input: ({ checked }) => (
      <input
        aria-label={checked ? "已完成" : "未完成"}
        type="checkbox"
        checked={Boolean(checked)}
        disabled
        readOnly
        className="mt-1.5 size-3.5 shrink-0 accent-[var(--color-accent)]"
      />
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-4 max-w-[65ch] border-l-2 border-[var(--color-border-strong)] pl-4 text-[var(--color-text-secondary)]">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-7 border-0 border-t border-[var(--color-border-default)]" />,
    pre: ({ children }) => (
      <pre className="my-4 max-w-full overflow-x-auto rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-overlay)] p-4 font-mono text-[12px] leading-5 text-[var(--color-text-primary)]">
        {children}
      </pre>
    ),
    code: ({ children, className }) => {
      const language = className?.match(/language-([A-Za-z0-9_+-]+)/u)?.[1];
      const block = Boolean(className);
      return (
        <code
          className={
            block
              ? `font-mono ${language ? `language-${language}` : ""}`
              : "rounded bg-[var(--color-bg-overlay)] px-1.5 py-0.5 font-mono text-[0.86em] break-words"
          }
          data-language={language}
        >
          {children}
        </code>
      );
    },
    table: ({ children }) => (
      <section aria-label="Markdown 表格" className="my-4 max-w-full overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-[13px]">{children}</table>
      </section>
    ),
    thead: ({ children }) => (
      <thead className="border-b border-[var(--color-border-strong)]">{children}</thead>
    ),
    th: ({ children }) => (
      <th className="whitespace-nowrap px-3 py-2 font-semibold text-[var(--color-text-primary)]">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-b border-[var(--color-border-default)] px-3 py-2 align-top text-[var(--color-text-secondary)]">
        {children}
      </td>
    ),
    a: ({ href, children }) => {
      const value = href ?? "";
      const reference =
        runId && value.startsWith("artifact:")
          ? resolveAuthorizedMarkdownArtifact(value, artifactReferences, runId)
          : null;
      if (reference && runId) {
        const triggerId = `qa-markdown-artifact-${runId}-${reference.artifact_id}-${reference.revision}`;
        const target: QaInspectorTarget = {
          kind: "artifact",
          run_id: runId,
          reference,
          anchor_sequence: sequence,
        };
        return (
          <button
            id={triggerId}
            type="button"
            onClick={() => selectInspector(target, triggerId)}
            className="inline-flex items-baseline gap-1 rounded text-[var(--color-accent)] underline decoration-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] underline-offset-2 hover:decoration-current active:translate-y-px focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            <FileCode aria-hidden="true" size={13} />
            {children}
          </button>
        );
      }
      if (!value || value.startsWith("artifact:")) {
        return (
          <span data-blocked-link="true" className="text-[var(--color-text-muted)]">
            {children}
          </span>
        );
      }
      const external = /^https?:/iu.test(value);
      return (
        <a
          href={value}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
          className="text-[var(--color-accent)] underline decoration-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] underline-offset-2 hover:decoration-current focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          {children}
        </a>
      );
    },
    img: ({ alt }: ComponentPropsWithoutRef<"img">) => (
      <span
        role="note"
        data-blocked-image="true"
        className="my-3 inline-flex items-center gap-2 rounded border border-[var(--color-border-default)] px-2.5 py-1.5 text-[12px] text-[var(--color-text-muted)]"
      >
        <ImageBroken aria-hidden="true" size={14} />
        图片已阻止{alt ? `：${alt}` : ""}
      </span>
    ),
  };

  return (
    <div
      className="agent-rich-text min-w-0 max-w-full [overflow-wrap:anywhere]"
      data-streaming={streaming || undefined}
      aria-busy={streaming || undefined}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema]]}
        skipHtml
        urlTransform={safeMarkdownUrlTransform}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

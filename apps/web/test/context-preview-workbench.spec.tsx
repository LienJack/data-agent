import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextPreviewWorkbench } from "@/components/semantic/studio/context-preview-workbench";
import { WorkspaceI18nProvider } from "@/i18n";

describe("Context Preview workbench", () => {
  it("exposes a bilingual, server-backed preview form with an idle projection", () => {
    const html = renderToStaticMarkup(
      <WorkspaceI18nProvider initialLocale="en-US">
        <ContextPreviewWorkbench workspaceId="10000000-0000-4000-8000-000000000001" />
      </WorkspaceI18nProvider>,
    );
    expect(html).toContain("Resolve context");
    expect(html).toContain("Context has not been resolved");
    expect(html).toContain("<form");
  });

  it("posts only the question to the governed workspace preview route", () => {
    const source = readFileSync(
      new URL("../src/components/semantic/studio/context-preview-workbench.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("/context/preview");
    expect(source).toContain("JSON.stringify({ question: normalizedQuestion })");
    expect(source).toContain("resolvedContextPreviewResultSchema.parse(payload.data)");
    expect(source).not.toMatch(/raw_prompt|reasoning_content|secret_ref/i);
  });
});

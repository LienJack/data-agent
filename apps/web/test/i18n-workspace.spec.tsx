import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProcessDisclosure } from "@/components/qa/process-disclosure";
import { ContextPreview } from "@/components/semantic/studio/context-preview";
import { GreenfieldJourneyPanel } from "@/components/workspaces/greenfield-journey-panel";
import { enUSMessages, WorkspaceI18nProvider, zhCNMessages } from "@/i18n";

describe("Workspace i18n", () => {
  it("keeps Chinese and English dictionaries in exact key parity", () => {
    expect(Object.keys(enUSMessages)).toEqual(Object.keys(zhCNMessages));
  });

  it.each([
    ["zh-CN", "上下文预览", "思考", "Greenfield 启动路径"],
    ["en-US", "Context Preview", "Thinking", "Greenfield activation path"],
  ] as const)("renders governed workspace surfaces in %s", (locale, context, thinking, journey) => {
    const html = renderToStaticMarkup(
      <WorkspaceI18nProvider initialLocale={locale}>
        <ContextPreview state={{ kind: "IDLE" }} />
        <ProcessDisclosure
          row={{
            id: "run:reasoning:1",
            runId: "10000000-0000-4000-8000-000000000001",
            sequence: 1,
            kind: "reasoning",
            title: "Plan",
            summary: "Public reasoning summary",
            status: "RUNNING",
            input: null,
            output: null,
            durationMs: null,
            toolName: null,
            errorCode: null,
            profileId: null,
            taskId: null,
            artifactRefs: [],
          }}
        />
        <GreenfieldJourneyPanel currentStage="SCHEMA_READY" />
      </WorkspaceI18nProvider>,
    );
    expect(html).toContain(context);
    expect(html).toContain(thinking);
    expect(html).toContain(journey);
    expect(html).toContain('aria-expanded="false"');
  });

  it("switches only display locale without routing or workspace-store mutation", () => {
    const source = readFileSync(new URL("../src/i18n/workspace-i18n.tsx", import.meta.url), "utf8");
    expect(source).toContain("data-agent.interface-locale");
    expect(source).not.toMatch(/useRouter|router\.|resetWorkspaceClientState/);
  });
});

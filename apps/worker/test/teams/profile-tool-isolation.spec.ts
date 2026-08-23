import { describe, expect, it, vi } from "vitest";
import { createReportWritingTools } from "../../src/teams/tools/report-writing-tools.js";
import { createSemanticManagementTools } from "../../src/teams/tools/semantic-management-tools.js";
import { createText2SqlTools } from "../../src/teams/tools/text2sql-tools.js";

const input = (profileId: string, toolId: string) =>
  ({
    task: { profile_id: profileId },
    profile: { revision: { profile_id: profileId } },
    tool_id: toolId,
  }) as never;

describe("specialist Tool isolation", () => {
  it("Semantic rejects SQL and Report tools before domain ports", async () => {
    const readCatalog = vi.fn();
    const writeCandidate = vi.fn();
    const tools = createSemanticManagementTools({ readCatalog, writeCandidate });
    await expect(
      tools.invoke(input("semantic-management-agent", "sql.sandbox.execute")),
    ).rejects.toThrow("SEMANTIC_AGENT_TOOL_DENIED");
    expect(readCatalog).not.toHaveBeenCalled();
    expect(writeCandidate).not.toHaveBeenCalled();
  });

  it("Text2SQL rejects semantic mutation and report projection", async () => {
    const readRelease = vi.fn();
    const compile = vi.fn();
    const execute = vi.fn();
    const tools = createText2SqlTools({ readRelease, compile, execute });
    await expect(
      tools.invoke(input("governed-text2sql-agent", "semantic.candidate.write")),
    ).rejects.toThrow("TEXT2SQL_AGENT_TOOL_DENIED");
    expect(readRelease).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("Report rejects datasource, SQL and semantic mutation tools", async () => {
    const readEvidence = vi.fn();
    const projectReport = vi.fn();
    const tools = createReportWritingTools({ readEvidence, projectReport });
    await expect(
      tools.invoke(input("report-writing-agent", "semantic.catalog.read")),
    ).rejects.toThrow("REPORT_AGENT_TOOL_DENIED");
    expect(readEvidence).not.toHaveBeenCalled();
    expect(projectReport).not.toHaveBeenCalled();
  });

  it("rejects a shared Worker identity using the wrong Profile", async () => {
    const tools = createReportWritingTools({ readEvidence: vi.fn(), projectReport: vi.fn() });
    await expect(tools.invoke(input("governed-text2sql-agent", "report.project"))).rejects.toThrow(
      "REPORT_AGENT_PROFILE_DENIED",
    );
  });
});

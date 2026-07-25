import { z } from "zod";

export const L2_TEAM_ROLES = [
  "research-supervisor",
  "semantic-sql-worker",
  "evidence-worker",
  "report-projector",
] as const;

export const l2TeamRoleSchema = z.enum(L2_TEAM_ROLES);
export type L2TeamRole = z.infer<typeof l2TeamRoleSchema>;

export const L2_TEAM_ROLE_DEFINITIONS = Object.freeze([
  Object.freeze({
    role: "research-supervisor",
    display_name: "Research Supervisor",
    responsibility: "维护研究问题、竞争假设、证据义务与委派预算。",
  }),
  Object.freeze({
    role: "semantic-sql-worker",
    display_name: "Semantic/SQL Worker",
    responsibility: "把受治理语义编译为候选 LogicalPlan 与 SqlArtifact。",
  }),
  Object.freeze({
    role: "evidence-worker",
    display_name: "Evidence Worker",
    responsibility: "核验查询证据、不变量与 Claim 支持关系。",
  }),
  Object.freeze({
    role: "report-projector",
    display_name: "Report Projector",
    responsibility: "只从受引用约束的 Claim 与 Evidence 投影报告候选。",
  }),
] as const);

const allowedHandoffs: Readonly<Record<L2TeamRole, readonly L2TeamRole[]>> = Object.freeze({
  "research-supervisor": Object.freeze([
    "semantic-sql-worker",
    "evidence-worker",
    "report-projector",
  ] as const),
  "semantic-sql-worker": Object.freeze(["research-supervisor", "evidence-worker"] as const),
  "evidence-worker": Object.freeze(["research-supervisor", "report-projector"] as const),
  "report-projector": Object.freeze([] as const),
});

export function isL2TeamHandoffAllowed(from: L2TeamRole, to: L2TeamRole): boolean {
  return allowedHandoffs[from].includes(to);
}

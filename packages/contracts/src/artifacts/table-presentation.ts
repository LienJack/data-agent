import type { ArtifactWorkspaceTableProjection } from "./export-receipt.js";
import type { QueryEvidenceSemanticBinding } from "./product-team-artifact.js";

const decimalFormat = new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 12 });
const integerFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

/** Presentation only: callers supply the binding from an already verified QueryEvidence. */
export function projectQueryEvidenceTablePresentation(
  table: ArtifactWorkspaceTableProjection,
  binding: Pick<QueryEvidenceSemanticBinding, "columns" | "time_window">,
): ArtifactWorkspaceTableProjection {
  if (binding.columns.length !== table.columns.length)
    throw new TypeError("QUERY_EVIDENCE_PRESENTATION_BINDING_INVALID");
  return {
    ...table,
    columns: table.columns.map(({ display: _display, ...column }, index) => {
      const source = binding.columns[index];
      if (!source || source.output_name !== column.key)
        throw new TypeError("QUERY_EVIDENCE_PRESENTATION_BINDING_INVALID");
      const timezone =
        binding.time_window?.dimension_id === source.semantic_object_id
          ? binding.time_window.timezone
          : null;
      if (source.logical_type !== "DATE" && (source.logical_type !== "DATETIME" || !timezone))
        return column;
      return {
        ...column,
        display: {
          kind: "TEMPORAL" as const,
          logical_type: source.logical_type,
          granularity: source.grain.granularity,
          timezone,
        },
      };
    }),
  };
}

export function formatArtifactTableCell(
  value: string | number | boolean | null,
  column: ArtifactWorkspaceTableProjection["columns"][number],
): string {
  if (value === null) return "—";
  if (typeof value === "number" && Number.isFinite(value)) {
    return (Number.isInteger(value) ? integerFormat : decimalFormat).format(value);
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value !== "string" || !column.display) return String(value);
  const display = column.display;
  if (display.logical_type === "DATETIME" && !display.timezone) return value;
  if (display.logical_type === "DATE" && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
  if (display.logical_type === "DATETIME" && !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return value;
  const date = new Date(display.logical_type === "DATE" ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(date.valueOf())) return value;
  if (display.logical_type === "DATE" && date.toISOString().slice(0, 10) !== value) return value;
  try {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone: display.logical_type === "DATE" ? "UTC" : (display.timezone ?? "UTC"),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value ?? "";
    const year = part("year");
    const month = part("month");
    if (display.granularity === "year") return year;
    if (display.granularity === "quarter") return `${year}-Q${Math.ceil(Number(month) / 3)}`;
    if (display.granularity === "month") return `${year}-${month}`;
    const calendarDate = `${year}-${month}-${part("day")}`;
    if (display.logical_type === "DATE" || ["day", "week"].includes(display.granularity))
      return calendarDate;
    if (display.granularity === "hour") return `${calendarDate} ${part("hour")}:00`;
    return `${calendarDate} ${part("hour")}:${part("minute")}:${part("second")}`;
  } catch {
    return value;
  }
}

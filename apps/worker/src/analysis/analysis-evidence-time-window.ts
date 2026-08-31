import type {
  QueryEvidenceSemanticBinding,
  ResearchBriefV3Payload,
} from "@data-agent/contracts/artifacts";
import type { AnalysisContext } from "@data-agent/contracts/context";

function fixedOffsetForDate(timezone: string, value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
      throw new TypeError("GOVERNED_ANALYSIS_TIME_WINDOW_INVALID");
    }
    return value;
  }
  const midday = new Date(`${value}T12:00:00.000Z`);
  let name: string | undefined;
  try {
    name = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    })
      .formatToParts(midday)
      .find(({ type }) => type === "timeZoneName")?.value;
  } catch {
    throw new TypeError("GOVERNED_ANALYSIS_TIMEZONE_INVALID");
  }
  const match = /^(?:GMT|UTC)([+-])(\d{2}):?(\d{2})$/u.exec(name ?? "");
  if (!match) {
    if (name === "GMT" || name === "UTC") return `${value}T00:00:00.000Z`;
    throw new TypeError("GOVERNED_ANALYSIS_TIMEZONE_OFFSET_INVALID");
  }
  return `${value}T00:00:00.000${match[1]}${match[2]}:${match[3]}`;
}

export function resolveAnalysisEvidenceTimeWindow(
  binding: QueryEvidenceSemanticBinding,
  context: AnalysisContext,
): ResearchBriefV3Payload["requested_time_window"] {
  const window = binding.time_window;
  // Explicit null means all rows of this accepted evidence, never a guessed coverage window.
  if (window === null) return null;
  if (!window) throw new TypeError("GOVERNED_ANALYSIS_TIME_WINDOW_REQUIRED");
  const metricTimezones = new Set(
    context.metrics
      .filter(
        ({ time_dimension_ref: dimensionId, time_domain: timeDomain }) =>
          dimensionId === window.dimension_id && timeDomain !== null,
      )
      .flatMap(({ time_domain: timeDomain }) => (timeDomain ? [timeDomain.timezone] : [])),
  );
  const timezone = window.timezone ?? (metricTimezones.size === 1 ? [...metricTimezones][0] : null);
  if (!timezone || (metricTimezones.size > 0 && !metricTimezones.has(timezone))) {
    throw new TypeError("GOVERNED_ANALYSIS_TIMEZONE_INVALID");
  }
  return {
    start: fixedOffsetForDate(timezone, window.start),
    end: fixedOffsetForDate(timezone, window.end),
    timezone,
    semantics: "HALF_OPEN",
  };
}

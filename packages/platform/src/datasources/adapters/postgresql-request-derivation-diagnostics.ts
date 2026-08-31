import { POSTGRESQL_PERIOD_COMPARISON_REPAIR_HINTS } from "./postgresql-period-comparison-diagnostics.js";

export const POSTGRESQL_AGGREGATE_RATIO_REPAIR_HINTS = Object.freeze({
  TEXT2SQL_RATIO_QUERY_SHAPE_REJECTED:
    "Use one direct aliased physical SELECT without CTEs, joins, filters, windows, HAVING, DISTINCT or LIMIT for this bounded unbounded-total ratio proof.",
  TEXT2SQL_RATIO_SOURCE_REJECTED:
    "Use the exact shared physical source of both selected SUM metrics and a non-integer-truncating division.",
  TEXT2SQL_RATIO_PROJECTION_REJECTED:
    "Bind the ratio only to the accepted REQUEST_DERIVED interpretation, raw SUM values to their exact original METRICs, and direct grouping columns to selected DIMENSIONs.",
  TEXT2SQL_RATIO_RATE_REJECTED:
    "Aggregate both sources before division. For SUBTRACT_DENOMINATOR use (SUM(numerator)-SUM(denominator))/NULLIF(SUM(denominator),0); for NONE omit the subtraction. CASE with denominator=0 THEN NULL is also supported. Do not use the published ROAS zero=0 rule for this request-only NULL rule.",
  TEXT2SQL_RATIO_GROUP_REJECTED:
    "GROUP BY exactly the projected direct dimension expressions or their output aliases, once each; no hidden grouping key.",
  TEXT2SQL_RATIO_ORDERING_REJECTED:
    "Order only by declared output aliases; direction and NULLS FIRST/LAST may be explicit.",
});

export const POSTGRESQL_REQUEST_DERIVATION_REPAIR_HINTS = Object.freeze({
  ...POSTGRESQL_PERIOD_COMPARISON_REPAIR_HINTS,
  ...POSTGRESQL_AGGREGATE_RATIO_REPAIR_HINTS,
});

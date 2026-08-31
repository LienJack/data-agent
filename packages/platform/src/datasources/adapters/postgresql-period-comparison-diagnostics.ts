/** Closed, value-free proof failures shared by validation, public diagnostics and repair. */
export const POSTGRESQL_PERIOD_COMPARISON_REPAIR_HINTS = Object.freeze({
  TEXT2SQL_COMPARISON_QUERY_SHAPE_REJECTED:
    "Use exactly two non-recursive aggregation CTEs and one outer LEFT JOIN; no extra SELECT clauses.",
  TEXT2SQL_COMPARISON_SOURCE_TYPE_REJECTED:
    "The published SUM source must support non-truncating division; do not change frozen types.",
  TEXT2SQL_COMPARISON_CURRENT_SOURCE_REJECTED:
    "The current CTE must directly scan the exact qualified published table with an explicit alias.",
  TEXT2SQL_COMPARISON_PRIOR_SOURCE_REJECTED:
    "The prior CTE must directly scan the same exact qualified published table with an explicit alias.",
  TEXT2SQL_COMPARISON_CURRENT_PROJECTION_REJECTED:
    "The current CTE must project exactly two uniquely aliased expressions: unshifted date_trunc month (optionally displayed as date) and raw SUM. No other wrappers, result casts or projections are supported.",
  TEXT2SQL_COMPARISON_PRIOR_PROJECTION_REJECTED:
    "The prior CTE must project exactly two uniquely aliased expressions: unshifted date_trunc month (optionally displayed as date) and raw SUM. No other wrappers, result casts or projections are supported.",
  TEXT2SQL_COMPARISON_CURRENT_MONTH_UNIT_REJECTED:
    "The current month bucket needs two date_trunc arguments: a direct positional parameter whose value is exactly month, then the qualified time input. Do not cast, concatenate or compute the unit parameter.",
  TEXT2SQL_COMPARISON_PRIOR_MONTH_UNIT_REJECTED:
    "The prior month bucket needs two date_trunc arguments: a direct positional parameter whose value is exactly month, then the qualified time input. Do not cast, concatenate or compute the unit parameter.",
  TEXT2SQL_COMPARISON_CURRENT_TIME_INPUT_REJECTED:
    "The current date_trunc input must be the exact qualified published time column. A text source must be cast directly to pg_catalog.timestamp, not date, timestamptz, a formatting function or an arithmetic expression.",
  TEXT2SQL_COMPARISON_PRIOR_TIME_INPUT_REJECTED:
    "The prior date_trunc input must be the exact qualified published time column. A text source must be cast directly to pg_catalog.timestamp, not date, timestamptz, a formatting function or an arithmetic expression.",
  TEXT2SQL_COMPARISON_CURRENT_SUM_INPUT_REJECTED:
    "The current amount must be raw SUM of exactly one qualified published value column. Do not change the aggregate, source, argument or add DISTINCT, FILTER, casts or COALESCE.",
  TEXT2SQL_COMPARISON_PRIOR_SUM_INPUT_REJECTED:
    "The prior amount must be raw SUM of exactly one qualified published value column. Do not change the aggregate, source, argument or add DISTINCT, FILTER, casts or COALESCE.",
  TEXT2SQL_COMPARISON_CURRENT_GROUP_REJECTED:
    "Group the current CTE by its exact projected month expression or that output alias, not a positional ordinal.",
  TEXT2SQL_COMPARISON_PRIOR_GROUP_REJECTED:
    "Group the prior CTE by its exact projected month expression or that output alias, not a positional ordinal.",
  TEXT2SQL_COMPARISON_CURRENT_WINDOW_REJECTED:
    "Use only the current CTE's direct >= and < predicates with the exact Host current bounds and required temporal casts.",
  TEXT2SQL_COMPARISON_PRIOR_WINDOW_REJECTED:
    "Use only the prior CTE's direct >= and < predicates with the exact Host clipped comparison bounds and required temporal casts.",
  TEXT2SQL_COMPARISON_ALIGNMENT_REJECTED:
    "Use current.month = prior.month + $year::pg_catalog.interval with the parameter exactly '1 year'; shift only in the LEFT JOIN.",
  TEXT2SQL_COMPARISON_RATE_REJECTED:
    "Return exactly (current.value-prior.value)/NULLIF(prior.value,0), without casts, COALESCE or percentage scaling.",
  TEXT2SQL_COMPARISON_OUTPUT_BINDING_REJECTED:
    "Return only the current month DIMENSION, both unchanged raw values bound to the source METRIC, and the exact REQUEST_DERIVED rate.",
  TEXT2SQL_COMPARISON_ORDERING_REJECTED:
    "Omit ORDER BY or use only the current-month output alias ascending without NULLS modifiers.",
});

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
    "The current CTE must project only an aliased unshifted date_trunc month and an aliased SUM of the exact source value.",
  TEXT2SQL_COMPARISON_PRIOR_PROJECTION_REJECTED:
    "The prior CTE must project only an aliased unshifted date_trunc month and an aliased SUM of the exact source value.",
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

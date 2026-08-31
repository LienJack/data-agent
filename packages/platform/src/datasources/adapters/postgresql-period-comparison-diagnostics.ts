/** Closed, value-free proof failures shared by validation, public diagnostics and repair. */
export const POSTGRESQL_PERIOD_COMPARISON_REPAIR_HINTS = Object.freeze({
  TEXT2SQL_COMPARISON_QUERY_SHAPE_REJECTED:
    "Use exactly two non-recursive aggregation CTEs and one outer period join: LEFT for ungrouped comparison; FULL with the proved merged month/category identities for a complete grouped comparison. No extra SELECT clauses.",
  TEXT2SQL_COMPARISON_SELECT_SHAPE_REJECTED:
    "The outer SELECT may contain only its result projections, one FROM period join, the two-CTE WITH clause and optional ORDER BY. Remove outer WHERE, GROUP BY, HAVING, DISTINCT, LIMIT/OFFSET, locking and set operations; preserve the exact bounds inside both source CTEs.",
  TEXT2SQL_COMPARISON_CTE_SHAPE_REJECTED:
    "Use exactly two uniquely named non-recursive aggregation CTEs. Do not use MATERIALIZED, NOT MATERIALIZED, CTE column-name lists or an extra CTE. Each CTE contains its own exact governed aggregate and source bounds.",
  TEXT2SQL_COMPARISON_PERIOD_JOIN_REJECTED:
    "The outer FROM must join the two distinct unqualified CTE names, each with a distinct explicit alias. Use LEFT JOIN for an ungrouped comparison, or FULL JOIN with merged identities for a complete grouped comparison. No INNER/RIGHT/CROSS/NATURAL/USING join or extra FROM item. A WITH declaration does not alias a FROM reference.",
  TEXT2SQL_COMPARISON_SOURCE_TYPE_REJECTED:
    "The published SUM source must support non-truncating division; do not change frozen types.",
  TEXT2SQL_COMPARISON_CURRENT_SOURCE_REJECTED:
    "The current CTE must scan the exact qualified published fact table with an explicit alias; a selected atomic category may use one exact certified non-fanout LEFT JOIN on its published key pair.",
  TEXT2SQL_COMPARISON_PRIOR_SOURCE_REJECTED:
    "The prior CTE must scan the same exact qualified published fact table with an explicit alias and the identical selected category/optional certified LEFT JOIN.",
  TEXT2SQL_COMPARISON_CURRENT_PROJECTION_REJECTED:
    "The current CTE must project unshifted date_trunc month (optionally displayed as date), raw SUM, and only when selected one raw atomic text category. Give each expression a unique alias; no extra wrappers or projections.",
  TEXT2SQL_COMPARISON_PRIOR_PROJECTION_REJECTED:
    "The prior CTE must project unshifted date_trunc month (optionally displayed as date), raw SUM, and the identical selected raw category when present. Give each expression a unique alias; no extra wrappers or projections.",
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
    "Group the current CTE by all and only the projected month and selected category expressions or output aliases, each once, not positional ordinals.",
  TEXT2SQL_COMPARISON_PRIOR_GROUP_REJECTED:
    "Group the prior CTE by all and only the projected month and selected category expressions or output aliases, each once, not positional ordinals.",
  TEXT2SQL_COMPARISON_CURRENT_WINDOW_REJECTED:
    "Use only the current CTE's direct >= and < predicates with the exact Host current bounds and required temporal casts.",
  TEXT2SQL_COMPARISON_PRIOR_WINDOW_REJECTED:
    "Use only the prior CTE's direct >= and < predicates with the exact Host clipped comparison bounds and required temporal casts.",
  TEXT2SQL_COMPARISON_ALIGNMENT_REJECTED:
    "Use current.month = prior.month + $year::pg_catalog.interval with the parameter exactly '1 year'; never shift CTE buckets. For a selected category append AND (current.category = prior.category OR (current.category IS NULL AND prior.category IS NULL)), in this order. A complete grouped FULL JOIN uses the same shifted prior month as its fallback output identity, preserving prior-only and NULL groups.",
  TEXT2SQL_COMPARISON_RATE_REJECTED:
    "Return exactly (current.value-prior.value)/NULLIF(prior.value,0), without casts, COALESCE or percentage scaling.",
  TEXT2SQL_COMPARISON_OUTPUT_BINDING_REJECTED:
    "Return only the month DIMENSION, category DIMENSION when selected, both unchanged raw values bound to the source METRIC, and the exact REQUEST_DERIVED rate. For a complete grouped FULL JOIN, month is COALESCE(current.month, prior.month + $year::pg_catalog.interval) and category is COALESCE(current.category, prior.category); never fill raw values or rates with zero.",
  TEXT2SQL_COMPARISON_ORDERING_REJECTED:
    "Omit ORDER BY or use the current-month output alias ascending, optionally followed by the selected category output alias ascending, without NULLS modifiers.",
});

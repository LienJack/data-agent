def main(context):
    document = context.read("source_rows")
    by_period = {}
    for row in document.get("rows", []):
        period = row["period_start"]
        value = row.get("value")
        if value is not None:
            by_period[period] = by_period.get(period, 0.0) + float(value)
    points = []
    previous = None
    for period in sorted(by_period):
        value = by_period[period]
        absolute_delta = None if previous is None else value - previous
        relative_delta = None if previous in (None, 0) else absolute_delta / previous
        points.append(
            {
                "period_start": period,
                "value": value,
                "absolute_delta": absolute_delta,
                "relative_delta": relative_delta,
            }
        )
        previous = value
    context.write_json(
        "result",
        {
            "result_kind": "TREND_CHANGE",
            "points": points,
            "first_value": points[0]["value"] if points else None,
            "last_value": points[-1]["value"] if points else None,
        },
    )

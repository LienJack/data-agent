def main(context):
    document = context.read("source_rows")
    rows = document.get("rows", [])
    column_names = sorted({key for row in rows for key in row})
    columns = []
    for name in column_names:
        values = [row.get(name) for row in rows]
        non_null = [value for value in values if value is not None]
        physical_types = sorted(
            {
                "boolean"
                if isinstance(value, bool)
                else "integer"
                if isinstance(value, int)
                else "number"
                if isinstance(value, float)
                else "string"
                if isinstance(value, str)
                else "object"
                for value in non_null
            }
        )
        columns.append(
            {
                "name": name,
                "physical_type": physical_types[0] if len(physical_types) == 1 else "mixed",
                "null_count": len(values) - len(non_null),
                "distinct_estimate": len({str(value) for value in non_null}),
            }
        )
    context.write_json(
        "result",
        {
            "row_count": len(rows),
            "columns": columns,
            "candidate_grain": document.get("candidate_grain", []),
        },
    )

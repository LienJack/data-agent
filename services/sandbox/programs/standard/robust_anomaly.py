import statistics


def main(context):
    document = context.read("source_rows")
    rows = sorted(document.get("rows", []), key=lambda item: item["period_start"])
    values = [float(row["value"]) for row in rows if row.get("value") is not None]
    anomalies = []
    if len(values) >= int(document.get("minimum_samples", 5)):
        center = statistics.median(values)
        mad = statistics.median([abs(value - center) for value in values])
        scale = 1.4826 * mad
        threshold = float(document.get("threshold", 3.5))
        if scale > 0:
            for row in rows:
                if row.get("value") is None:
                    continue
                observed = float(row["value"])
                score = (observed - center) / scale
                if abs(score) >= threshold:
                    anomalies.append(
                        {
                            "period_start": row["period_start"],
                            "observed": observed,
                            "expected": center,
                            "robust_score": score,
                            "direction": "HIGH" if score > 0 else "LOW",
                        }
                    )
    context.write_json(
        "result",
        {
            "result_kind": "ROBUST_ANOMALY",
            "anomalies": anomalies,
            "sample_size": len(values),
        },
    )

def main(context):
    document = context.read("source_rows")
    values = [
        float(row["value"]) for row in document.get("rows", []) if row.get("value") is not None
    ]
    minimum_train = int(document.get("minimum_train", 3))
    errors = []
    naive_errors = []
    backtest_rows = []
    for index in range(minimum_train, len(values)):
        history = values[:index]
        prediction = sum(history) / len(history)
        actual = values[index]
        errors.append(abs(actual - prediction))
        naive_errors.append(abs(actual - values[index - 1]))
        backtest_rows.append({"index": index, "actual": actual, "prediction": prediction})
    mae = None if not errors else sum(errors) / len(errors)
    naive_mae = None if not naive_errors else sum(naive_errors) / len(naive_errors)
    mase = None if mae is None or naive_mae in (None, 0) else mae / naive_mae
    useful = bool(mase is not None and mase < 1.0)
    context.write_json(
        "result",
        {
            "result_kind": "BASELINE_FORECAST_BACKTEST",
            "selected_model": "expanding-mean@1.0.0" if useful else None,
            "baseline_model": "last-value@1.0.0",
            "horizon": int(document.get("horizon", 1)),
            "mae": mae,
            "mase": mase,
            "useful": useful,
            "forecast_rows_ref": None,
            "backtest_hash": document["backtest_hash"],
        },
    )
    context.write_json("backtest_rows", backtest_rows)

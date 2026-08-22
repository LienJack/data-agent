import math


def _pearson(pairs):
    if len(pairs) < 2:
        return None
    xs = [pair[0] for pair in pairs]
    ys = [pair[1] for pair in pairs]
    x_mean = sum(xs) / len(xs)
    y_mean = sum(ys) / len(ys)
    numerator = sum((x - x_mean) * (y - y_mean) for x, y in pairs)
    x_scale = sum((x - x_mean) ** 2 for x in xs)
    y_scale = sum((y - y_mean) ** 2 for y in ys)
    denominator = math.sqrt(x_scale * y_scale)
    return None if denominator == 0 else numerator / denominator


def _ranks(values):
    ordered = sorted((value, index) for index, value in enumerate(values))
    ranks = [0.0] * len(values)
    start = 0
    while start < len(ordered):
        end = start + 1
        while end < len(ordered) and ordered[end][0] == ordered[start][0]:
            end += 1
        rank = (start + end - 1) / 2 + 1
        for offset in range(start, end):
            ranks[ordered[offset][1]] = rank
        start = end
    return ranks


def main(context):
    rows = context.read("source_rows").get("rows", [])
    pairs = []
    missing = 0
    for row in rows:
        if row.get("x") is None or row.get("y") is None:
            missing += 1
        else:
            pairs.append((float(row["x"]), float(row["y"])))
    pearson = _pearson(pairs)
    rank_x = _ranks([pair[0] for pair in pairs])
    rank_y = _ranks([pair[1] for pair in pairs])
    spearman = _pearson(list(zip(rank_x, rank_y, strict=True)))
    context.write_json(
        "result",
        {
            "result_kind": "ASSOCIATION_OUTLIER_COMPLETENESS",
            "pearson_r": pearson,
            "spearman_rho": spearman,
            "q_value": None,
            "paired_sample_size": len(pairs),
            "missing_pair_count": missing,
            "outlier_count": int(context.read("source_rows").get("outlier_count", 0)),
            "completeness_ratio": 0.0 if not rows else len(pairs) / len(rows),
        },
    )

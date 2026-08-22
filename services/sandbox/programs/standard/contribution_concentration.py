def main(context):
    document = context.read("source_rows")
    groups = []
    total_delta = 0.0
    for row in document.get("rows", []):
        baseline = float(row.get("baseline", 0.0))
        current = float(row.get("current", 0.0))
        signed_delta = current - baseline
        total_delta += signed_delta
        groups.append(
            {
                "group_key_hash": row["group_key_hash"],
                "baseline": baseline,
                "current": current,
                "signed_delta": signed_delta,
                "change_share": None,
            }
        )
    for group in groups:
        group["change_share"] = None if total_delta == 0 else group["signed_delta"] / total_delta
    groups = sorted(groups, key=lambda item: (-abs(item["signed_delta"]), item["group_key_hash"]))
    shares = [abs(group["signed_delta"]) for group in groups]
    share_total = sum(shares)
    hhi = None if share_total == 0 else sum((value / share_total) ** 2 for value in shares)
    context.write_json(
        "result",
        {
            "result_kind": "CONTRIBUTION_CONCENTRATION",
            "groups": groups,
            "residual": float(document.get("observed_total_delta", total_delta)) - total_delta,
            "closure_tolerance": float(document.get("closure_tolerance", 1e-9)),
            "hhi": hhi,
        },
    )

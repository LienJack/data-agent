from __future__ import annotations

from data_agent_stats.cell_policy import CellPolicyError, validate_cell_source


def test_cell_policy_allows_stateful_dataframe_and_declared_files() -> None:
    validate_cell_source(
        "\n".join(
            [
                "import pandas as pd",
                "frame = pd.read_parquet('/workspace/inputs/orders.parquet')",
                "summary = frame.groupby('month', as_index=False).sum()",
                "summary.to_parquet('/workspace/outputs/monthly.parquet', index=False)",
            ]
        ),
        "CORE_ANALYSIS",
        "OPEN_ANALYSIS",
    )


def test_cell_policy_denies_operator_package_system_imports_and_path_escape() -> None:
    for source in (
        "import data_agent_stats",
        "import subprocess",
        "import pandas as pd\npd.read_csv('/etc/passwd')",
        "open('/workspace/outputs/../secret.txt', 'w').write('x')",
    ):
        try:
            validate_cell_source(source, "CORE_ANALYSIS", "OPEN_ANALYSIS")
        except CellPolicyError:
            continue
        raise AssertionError(f"source should be rejected: {source}")


def test_governed_orchestration_denies_scipy_formula_surface() -> None:
    try:
        validate_cell_source(
            "from scipy import stats",
            "ML_DIAGNOSTIC",
            "GOVERNED_OPERATOR_ORCHESTRATION",
        )
    except CellPolicyError as error:
        assert any(item.code == "IMPORT_DENIED" for item in error.violations)
    else:
        raise AssertionError("governed orchestration must use statistical_operator")

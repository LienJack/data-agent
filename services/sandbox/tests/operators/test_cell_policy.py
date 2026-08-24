from __future__ import annotations

from data_agent_stats.cell_policy import CellPolicyError, validate_cell_source


def test_cell_policy_allows_stateful_dataframe_in_memory() -> None:
    validate_cell_source(
        "\n".join(
            [
                "import pandas as pd",
                "frame = pd.read_parquet('/workspace/inputs/orders.parquet')",
                "summary = frame.groupby('month', as_index=False).sum()",
                "result_document = summary.to_dict(orient='records')",
            ]
        ),
        "CORE_ANALYSIS",
        "OPEN_ANALYSIS",
    )


def test_cell_policy_denies_all_model_file_writes_and_pathlib() -> None:
    for source in (
        "open('/workspace/intermediate/result.json', 'w').write('{}')",
        "import pandas as pd\npd.DataFrame({'x': [1]}).to_parquet('/workspace/intermediate/x.parquet')",
    ):
        try:
            validate_cell_source(source, "CORE_ANALYSIS", "GOVERNED_OPERATOR_ORCHESTRATION")
        except CellPolicyError as error:
            assert any(item.code in {"FILE_PATH_DENIED", "FILE_WRITE_DENIED"} for item in error.violations)
        else:
            raise AssertionError("model file writes must remain denied")
    try:
        validate_cell_source(
            "from pathlib import Path\nPath('/workspace/intermediate/result.json').write_text('{}')",
            "CORE_ANALYSIS",
            "GOVERNED_OPERATOR_ORCHESTRATION",
        )
    except CellPolicyError as error:
        assert any(item.code == "IMPORT_DENIED" for item in error.violations)
    else:
        raise AssertionError("pathlib must remain denied")


def test_cell_policy_denies_operator_package_system_imports_and_path_escape() -> None:
    for source in (
        "import data_agent_stats",
        "import subprocess",
        "import pandas as pd\npd.read_csv('/etc/passwd')",
        "open('/workspace/intermediate/../secret.txt', 'w').write('x')",
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


def test_cell_policy_denies_protected_governed_result_mutation() -> None:
    for source in (
        "__da_gov_aaaaaaaaaaaaaaaaaaaaaaaa = {}",
        "del __da_gov_aaaaaaaaaaaaaaaaaaaaaaaa",
        "for __da_gov_aaaaaaaaaaaaaaaaaaaaaaaa in []:\n    pass",
        "(__da_gov_aaaaaaaaaaaaaaaaaaaaaaaa := {})",
        "import pandas as __da_gov_aaaaaaaaaaaaaaaaaaaaaaaa",
        "try:\n    raise ValueError()\nexcept ValueError as __da_gov_aaaaaaaaaaaaaaaaaaaaaaaa:\n    pass",
        "globals()['__da_gov_aaaaaaaaaaaaaaaaaaaaaaaa'] = {}",
    ):
        try:
            validate_cell_source(source, "CORE_ANALYSIS", "GOVERNED_OPERATOR_ORCHESTRATION")
        except CellPolicyError as error:
            assert any(
                item.code in {"PROTECTED_RESULT_MUTATION", "NAME_DENIED", "CALL_DENIED"}
                for item in error.violations
            )
        else:
            raise AssertionError(f"protected result mutation must be rejected: {source}")

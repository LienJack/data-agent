from __future__ import annotations

import pytest
from pydantic import ValidationError

from data_agent_stats.attestation import OPERATOR_REGISTRY_DIGEST
from data_agent_stats.dispatcher import (
    StatisticalOperatorFinalizationRequest,
    StatisticalOperatorToolCall,
    execute_call,
    finalize_calls,
    main,
)


def request() -> StatisticalOperatorToolCall:
    return StatisticalOperatorToolCall.model_validate(
        {
            "schema_version": "statistical-operator-tool-call@1.0.0",
            "call_id": "q3_bh_all_products",
            "operator_id": "multiple-testing.bh-fdr@1",
            "operator_registry_digest": OPERATOR_REGISTRY_DIGEST,
            "runtime_profile": "CORE_ANALYSIS",
            "obligation": {
                "call_id": "q3_bh_all_products",
                "operator_id": "multiple-testing.bh-fdr@1",
                "result_binding": {
                    "result_output_name": "result",
                    "result_collection_path": "/tests",
                    "operator_collection_path": "/tests",
                    "label_fields": ["label"],
                    "value_bindings": [
                        {
                            "result_field": "adjusted_p_value",
                            "operator_field": "adjusted_p_value",
                            "comparison": "EXACT",
                            "absolute_tolerance": 0,
                            "relative_tolerance": 0,
                        }
                    ],
                    "require_exact_label_set": True,
                },
            },
            "inputs": {
                "tests": [
                    {"label": "a", "p_value": 0.01},
                    {"label": "b", "p_value": 0.04},
                    {"label": "c", "p_value": 0.2},
                ]
            },
            "parameters": {"alpha": 0.05, "method": "bh"},
        }
    )


def test_execute_call_returns_governed_output_and_pre_binding_evidence() -> None:
    result = execute_call(request())

    assert result["schema_version"] == "statistical-operator-tool-result@1.0.0"
    assert result["operator_registry_digest"] == OPERATOR_REGISTRY_DIGEST
    assert [row["label"] for row in result["output"]["tests"]] == ["a", "b", "c"]
    assert result["execution_evidence"]["input_hash"].startswith("sha256:")
    assert result["execution_evidence"]["output_hash"].startswith("sha256:")
    assert result["execution_evidence"]["implementation_digest"].startswith("sha256:")


def test_tool_call_must_bind_exact_obligation_and_registry() -> None:
    document = request().model_dump(mode="json")
    document["call_id"] = "different-call"

    with pytest.raises(ValidationError):
        StatisticalOperatorToolCall.model_validate(document)


def test_operator_input_contract_fails_closed() -> None:
    document = request().model_dump(mode="json")
    document["inputs"] = {"tests": [{"label": "a", "p_value": 2.0}]}

    with pytest.raises(ValueError, match="PYTHON_OPERATOR_INPUT_INVALID"):
        execute_call(StatisticalOperatorToolCall.model_validate(document))


def test_finalization_reexecutes_and_binds_exact_final_json() -> None:
    call = request()
    output = execute_call(call)["output"]
    finalized = finalize_calls(
        StatisticalOperatorFinalizationRequest.model_validate(
            {
                "schema_version": "statistical-operator-finalization@1.0.0",
                "operator_registry_digest": OPERATOR_REGISTRY_DIGEST,
                "runtime_profile": "CORE_ANALYSIS",
                "calls": [call.model_dump(mode="json")],
                "json_outputs": {"result": output},
            }
        )
    )

    assert finalized["schema_version"] == "statistical-operator-finalization-result@1.0.0"
    assert len(finalized["operator_receipts"]) == 1
    assert finalized["operator_receipts"][0]["call_id"] == "q3_bh_all_products"
    assert finalized["operator_receipt_closure_hash"].startswith("sha256:")


def test_finalization_rejects_result_that_does_not_match_operator_output() -> None:
    call = request()
    output = execute_call(call)["output"]
    output["tests"][0]["adjusted_p_value"] = 0.99
    finalization = StatisticalOperatorFinalizationRequest.model_validate(
        {
            "schema_version": "statistical-operator-finalization@1.0.0",
            "operator_registry_digest": OPERATOR_REGISTRY_DIGEST,
            "runtime_profile": "CORE_ANALYSIS",
            "calls": [call.model_dump(mode="json")],
            "json_outputs": {"result": output},
        }
    )

    with pytest.raises(ValueError, match="PYTHON_OPERATOR_RESULT_BINDING_MISMATCH"):
        finalize_calls(finalization)


def test_cli_rejects_unknown_operations_before_touching_files() -> None:
    with pytest.raises(SystemExit):
        main(
            [
                "arbitrary-python",
                "/workspace/operator-inputs/a.json",
                "/workspace/operator-outputs/a.json",
            ]
        )

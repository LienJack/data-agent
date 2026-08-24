from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
from test_python_runtime import configuration, envelope_for

from data_agent_sandbox.python_runtime.models import (
    StatisticalOperatorObligation,
    StatisticalOperatorResultBinding,
    StatisticalOperatorValueBinding,
)
from data_agent_sandbox.python_runtime.operators.manifest import (
    OPERATOR_IDS,
    OPERATOR_MANIFEST,
    OPERATOR_MANIFEST_DIGEST,
)
from data_agent_sandbox.python_runtime.operators.registry import (
    OperatorExecutionResult,
    OperatorImplementationBinding,
    StatisticalOperatorError,
    StatisticalOperatorRegistry,
)
from data_agent_sandbox.python_runtime.policy import PythonPolicyError, validate_python_source
from data_agent_sandbox.python_runtime.supervisor import PythonSandboxSupervisor

IMPLEMENTATION_DIGEST = "sha256:" + "d" * 64


def obligation(call_id: str = "bh_family") -> StatisticalOperatorObligation:
    return StatisticalOperatorObligation(
        call_id=call_id,
        operator_id="multiple-testing.bh-fdr@1",
        result_binding=StatisticalOperatorResultBinding(
            result_output_name="result",
            result_collection_path="/method_evidence/bh",
            operator_collection_path="/tests",
            label_fields=("label",),
            value_bindings=(
                StatisticalOperatorValueBinding(
                    result_field="adjusted_p_value",
                    operator_field="adjusted_p_value",
                    comparison="NUMERIC_TOLERANCE",
                    absolute_tolerance=1e-12,
                    relative_tolerance=1e-12,
                ),
            ),
            require_exact_label_set=True,
        ),
    )


def second_obligation(call_id: str = "bh_family_2") -> StatisticalOperatorObligation:
    return obligation(call_id)


def fake_bh(inputs: dict[str, object], parameters: dict[str, object]) -> OperatorExecutionResult:
    assert parameters == {"alpha": 0.05, "method": "bh"}
    tests = inputs["tests"]
    assert isinstance(tests, list)
    return OperatorExecutionResult(
        output={
            "tests": [
                {"label": row["label"], "adjusted_p_value": float(row["p_value"]) * 2}
                for row in tests
            ]
        },
        sample_size=len(tests),
        family_size=len(tests),
    )


def loader(_: object) -> OperatorImplementationBinding:
    return OperatorImplementationBinding(fake_bh, IMPLEMENTATION_DIGEST)


def registry(*obligations: StatisticalOperatorObligation) -> StatisticalOperatorRegistry:
    return StatisticalOperatorRegistry(
        expected_registry_digest=OPERATOR_MANIFEST_DIGEST,
        obligations=obligations,
        runtime_profile="CORE_ANALYSIS",
        implementation_loader=loader,
    )


def call_bh(operator_registry: StatisticalOperatorRegistry) -> dict[str, object]:
    return operator_registry.call(
        "multiple-testing.bh-fdr@1",
        call_id="bh_family",
        inputs={"tests": [{"label": "a", "p_value": 0.01}]},
    )


def failure_code(error: pytest.ExceptionInfo[StatisticalOperatorError]) -> str:
    return error.value.failure_code


def test_runtime_manifest_is_closed_unique_and_matches_typescript_source_digest() -> None:
    assert len(OPERATOR_IDS) == len(set(OPERATOR_IDS)) == 7
    assert OPERATOR_MANIFEST_DIGEST.startswith("sha256:")
    serialized = json.dumps(OPERATOR_MANIFEST, default=dict)
    assert all(
        forbidden not in serialized
        for forbidden in ('"aliases"', '"overwrite"', '"fallback"', '"legacy_id"')
    )


def test_registry_emits_bounded_receipt_only_after_exact_result_binding() -> None:
    operator_registry = registry(obligation())
    result = call_bh(operator_registry)
    receipts, closure_hash = operator_registry.finalize(
        {"result": {"method_evidence": {"bh": result["tests"]}}}
    )

    assert len(receipts) == 1
    assert receipts[0].call_id == "bh_family"
    assert receipts[0].resolved_parameters == {"alpha": 0.05, "method": "bh"}
    assert receipts[0].family_size == 1
    assert closure_hash.startswith("sha256:")
    receipt_json = receipts[0].model_dump_json()
    assert "p_value" not in receipt_json
    assert '"label":"a"' not in receipt_json


@pytest.mark.parametrize(
    ("mutation", "expected"),
    [
        ("wrong_registry", "PYTHON_OPERATOR_REGISTRY_DIGEST_MISMATCH"),
        ("missing_call", "PYTHON_OPERATOR_REQUIRED_CALL_MISSING"),
        ("extra_call", "PYTHON_OPERATOR_UNDECLARED_CALL"),
        ("wrong_call", "PYTHON_OPERATOR_NOT_AUTHORIZED"),
        ("duplicate_call", "PYTHON_OPERATOR_DUPLICATE_CALL_ID"),
        ("invalid_input", "PYTHON_OPERATOR_INPUT_INVALID"),
        ("invalid_parameter", "PYTHON_OPERATOR_PARAMETER_INVALID"),
        ("ignored_result", "PYTHON_OPERATOR_RESULT_BINDING_MISMATCH"),
    ],
)
def test_registry_fails_closed_on_authority_and_binding_mutations(
    mutation: str, expected: str
) -> None:
    if mutation == "wrong_registry":
        with pytest.raises(StatisticalOperatorError) as captured:
            StatisticalOperatorRegistry(
                expected_registry_digest="sha256:" + "0" * 64,
                obligations=(obligation(),),
                runtime_profile="CORE_ANALYSIS",
                implementation_loader=loader,
            )
        assert failure_code(captured) == expected
        return

    operator_registry = registry(obligation())
    with pytest.raises(StatisticalOperatorError) as captured:
        if mutation == "missing_call":
            operator_registry.finalize({"result": {"method_evidence": {"bh": []}}})
        elif mutation == "extra_call":
            empty_registry = registry()
            call_bh(empty_registry)
        elif mutation == "wrong_call":
            operator_registry.call(
                "multiple-testing.bh-fdr@1",
                call_id="other",
                inputs={"tests": [{"label": "a", "p_value": 0.01}]},
            )
        elif mutation == "duplicate_call":
            call_bh(operator_registry)
            call_bh(operator_registry)
        elif mutation == "invalid_input":
            operator_registry.call(
                "multiple-testing.bh-fdr@1",
                call_id="bh_family",
                inputs={"tests": [object()]},
            )
        elif mutation == "invalid_parameter":
            operator_registry.call(
                "multiple-testing.bh-fdr@1",
                call_id="bh_family",
                inputs={"tests": [{"label": "a", "p_value": 0.01}]},
                parameters={"alpha": 2},
            )
        elif mutation == "ignored_result":
            call_bh(operator_registry)
            operator_registry.finalize(
                {"result": {"method_evidence": {"bh": [{"label": "a", "adjusted_p_value": 0.5}]}}}
            )
        else:
            raise AssertionError("unknown mutation")
    assert failure_code(captured) == expected


def test_policy_requires_literal_exact_calls_and_dataframe_only_imports() -> None:
    required = (obligation(),)
    valid = (
        "def main(context):\n"
        "    result = context.operators.call(\n"
        "        'multiple-testing.bh-fdr@1',\n"
        "        call_id='bh_family',\n"
        "        inputs={'tests': [{'label': 'a', 'p_value': 0.01}]},\n"
        "    )\n"
        "    context.write_json('result', {'method_evidence': {'bh': result['tests']}})\n"
    )
    validate_python_source(
        valid,
        "CORE_ANALYSIS",
        generated_source_policy="GOVERNED_OPERATOR_ORCHESTRATION",
        operator_obligations=required,
    )

    invalid_sources = [
        valid.replace("'multiple-testing.bh-fdr@1'", "operator_id"),
        valid.replace("call_id='bh_family'", "call_id=call_id"),
        valid.replace(
            "inputs={'tests': [{'label': 'a', 'p_value': 0.01}]},",
            "unexpected=True,",
        ),
        valid.replace("context.operators.call", "ops.call").replace(
            "def main(context):\n", "def main(context):\n    ops = context.operators\n"
        ),
        valid.replace("def main(context):\n", "import scipy\ndef main(context):\n"),
        valid.replace(
            "def main(context):\n",
            "from data_agent_sandbox.python_runtime.operators import registry\n"
            "def main(context):\n",
        ),
        valid.replace(
            "context.write_json('result', {'method_evidence': {'bh': result['tests']}})",
            "return result",
        ),
    ]
    for source in invalid_sources:
        with pytest.raises(PythonPolicyError):
            validate_python_source(
                source,
                "ML_DIAGNOSTIC",
                generated_source_policy="GOVERNED_OPERATOR_ORCHESTRATION",
                operator_obligations=required,
            )


def test_policy_denies_operator_capability_outside_governed_source_policy() -> None:
    source = (
        "def main(context):\n"
        "    context.operators.call(\n"
        "        'multiple-testing.bh-fdr@1',\n"
        "        call_id='bh_family',\n"
        "        inputs={'tests': [{'label': 'a', 'p_value': 0.01}]},\n"
        "    )\n"
    )

    with pytest.raises(PythonPolicyError) as captured:
        validate_python_source(
            source,
            "CORE_ANALYSIS",
            generated_source_policy="OPEN_ANALYSIS",
            operator_obligations=(),
        )

    assert "OPERATOR_NOT_AUTHORIZED" in {
        violation.code for violation in captured.value.violations
    }


def test_policy_and_registry_reject_reordered_governed_calls() -> None:
    first = obligation("first")
    second = second_obligation("second")
    source = (
        "def main(context):\n"
        "    context.operators.call(\n"
        "        'multiple-testing.bh-fdr@1',\n"
        "        call_id='second',\n"
        "        inputs={'tests': [{'label': 'b', 'p_value': 0.02}]},\n"
        "    )\n"
        "    context.operators.call(\n"
        "        'multiple-testing.bh-fdr@1',\n"
        "        call_id='first',\n"
        "        inputs={'tests': [{'label': 'a', 'p_value': 0.01}]},\n"
        "    )\n"
    )

    with pytest.raises(PythonPolicyError) as policy_error:
        validate_python_source(
            source,
            "CORE_ANALYSIS",
            generated_source_policy="GOVERNED_OPERATOR_ORCHESTRATION",
            operator_obligations=(first, second),
        )
    assert "OPERATOR_NOT_AUTHORIZED" in {
        violation.code for violation in policy_error.value.violations
    }

    with pytest.raises(StatisticalOperatorError) as registry_error:
        registry(first, second).call(
            "multiple-testing.bh-fdr@1",
            call_id="second",
            inputs={"tests": [{"label": "b", "p_value": 0.02}]},
        )
    assert failure_code(registry_error) == "PYTHON_OPERATOR_NOT_AUTHORIZED"


def test_supervisor_operator_failure_commits_no_output_or_partial_receipt(tmp_path: Path) -> None:
    source = (
        "def main(context):\n"
        "    result = context.operators.call(\n"
        "        'multiple-testing.bh-fdr@1',\n"
        "        call_id='bh_family',\n"
        "        inputs={'tests': [{'label': 'a', 'p_value': 0.01}]},\n"
        "    )\n"
        "    context.write_json('result', {'method_evidence': {'bh': result['tests']}})\n"
    )
    request = envelope_for(source, b"{}\n", identifier="operator-not-yet-implemented")
    request = request.model_copy(
        update={
            "request": request.request.model_copy(
                update={
                    "generated_source_policy": "GOVERNED_OPERATOR_ORCHESTRATION",
                    "operator_obligations": (obligation(),),
                }
            ),
            "source_code_base64": base64.b64encode(source.encode()).decode(),
        }
    )
    outcome = PythonSandboxSupervisor(configuration(tmp_path)).execute(request)

    assert outcome.receipt.failure_code == "PYTHON_OPERATOR_NOT_REGISTERED"
    assert outcome.receipt.operator_receipts == ()
    assert outcome.receipt.operator_receipt_closure_hash is None
    assert outcome.outputs == ()
    assert not any(tmp_path.iterdir())

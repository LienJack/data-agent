from __future__ import annotations

import math
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from data_agent_stats.manifest import OPERATOR_IDS

Sha256 = Annotated[str, Field(pattern=r"^sha256:[0-9a-f]{64}$")]
StableIdentifier = Annotated[
    str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")
]
OperatorId = Annotated[
    str,
    Field(pattern=r"^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+@[1-9][0-9]*$"),
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class StatisticalOperatorValueBinding(StrictModel):
    result_field: StableIdentifier
    operator_field: StableIdentifier
    comparison: Literal["EXACT", "NUMERIC_TOLERANCE"]
    absolute_tolerance: Annotated[float, Field(ge=0, le=1)]
    relative_tolerance: Annotated[float, Field(ge=0, le=1)]

    @model_validator(mode="after")
    def exact_has_zero_tolerance(self) -> StatisticalOperatorValueBinding:
        if not math.isfinite(self.absolute_tolerance) or not math.isfinite(
            self.relative_tolerance
        ):
            raise ValueError("operator value binding tolerance must be finite")
        if self.comparison == "EXACT" and (
            self.absolute_tolerance != 0 or self.relative_tolerance != 0
        ):
            raise ValueError("exact operator value binding requires zero tolerance")
        return self


class StatisticalOperatorResultBinding(StrictModel):
    result_output_name: Annotated[
        str, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_.-]{0,62}$")
    ]
    result_collection_path: Annotated[
        str, Field(min_length=1, max_length=512, pattern=r"^(?:/(?:[^~/]|~0|~1)*)+$")
    ]
    operator_collection_path: Annotated[
        str, Field(min_length=1, max_length=512, pattern=r"^(?:/(?:[^~/]|~0|~1)*)+$")
    ]
    label_fields: Annotated[tuple[StableIdentifier, ...], Field(min_length=1, max_length=8)]
    value_bindings: Annotated[
        tuple[StatisticalOperatorValueBinding, ...], Field(min_length=1, max_length=32)
    ]
    require_exact_label_set: Literal[True]

    @model_validator(mode="after")
    def unique_fields(self) -> StatisticalOperatorResultBinding:
        for values in (
            self.label_fields,
            tuple(binding.result_field for binding in self.value_bindings),
            tuple(binding.operator_field for binding in self.value_bindings),
        ):
            if len(set(values)) != len(values):
                raise ValueError("operator result binding fields must be unique")
        return self


class StatisticalOperatorObligation(StrictModel):
    call_id: StableIdentifier
    operator_id: OperatorId
    result_binding: StatisticalOperatorResultBinding

    @model_validator(mode="after")
    def registered_operator(self) -> StatisticalOperatorObligation:
        if self.operator_id not in OPERATOR_IDS:
            raise ValueError("operator_id is not registered")
        return self


ResolvedParameterValue = str | int | float | bool | None


class StatisticalOperatorCallReceipt(StrictModel):
    schema_version: Literal["statistical-operator-call-receipt@1.0.0"]
    call_id: StableIdentifier
    operator_id: OperatorId
    operator_registry_digest: Sha256
    implementation_digest: Sha256
    resolved_parameters: dict[StableIdentifier, ResolvedParameterValue]
    resolved_parameters_hash: Sha256
    input_hash: Sha256
    output_hash: Sha256
    result_binding_hash: Sha256
    sample_size: Annotated[int, Field(ge=0)] | None
    group_count: Annotated[int, Field(ge=0)] | None
    family_size: Annotated[int, Field(ge=0)] | None
    rank: Annotated[int, Field(ge=0)] | None
    applicability: Literal["PASS", "ASSUMPTION_BOUND", "HOLD"]
    limitation_codes: Annotated[
        tuple[Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9_]*$")], ...],
        Field(max_length=16),
    ]

    @model_validator(mode="after")
    def validate_bounded_receipt(self) -> StatisticalOperatorCallReceipt:
        if self.operator_id not in OPERATOR_IDS:
            raise ValueError("operator_id is not registered")
        if len(self.resolved_parameters) > 32:
            raise ValueError("resolved_parameters exceed the receipt limit")
        if len(set(self.limitation_codes)) != len(self.limitation_codes):
            raise ValueError("limitation codes must be unique")
        for value in self.resolved_parameters.values():
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError("resolved parameters must be finite")
            if not isinstance(value, (str, int, float, bool, type(None))):
                raise ValueError("resolved parameters must be canonical scalars")
        return self


__all__ = [
    "OperatorId",
    "ResolvedParameterValue",
    "Sha256",
    "StableIdentifier",
    "StatisticalOperatorCallReceipt",
    "StatisticalOperatorObligation",
    "StatisticalOperatorResultBinding",
    "StatisticalOperatorValueBinding",
]

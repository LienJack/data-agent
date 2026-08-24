from __future__ import annotations

import csv
import html
import json
import re
from pathlib import Path
from typing import Any

from data_agent_sandbox.python_runtime.models import StatisticalOperatorCallReceipt
from data_agent_stats.registry import StatisticalOperatorRegistry

SDK_VERSION = "data-agent-sandbox-sdk@1.0.0"
_TAG = re.compile(r"<[^>]*>")
_SCRIPT_PROTOCOL = re.compile(r"(?i)javascript\s*:")


def _json_scalar(value: Any) -> Any:
    import numpy as np

    if isinstance(value, np.generic):
        return value.item()
    raise TypeError("PYTHON_OUTPUT_VALUE_INVALID")


def sanitize_markdown(value: str) -> str:
    return _SCRIPT_PROTOCOL.sub("", _TAG.sub("", value)).replace("\x00", "")


class StatisticalOperatorCapability:
    """Only public generated-source surface for governed statistical methods."""

    __slots__ = ("_registry",)

    def __init__(self, registry: StatisticalOperatorRegistry) -> None:
        self._registry = registry

    def call(
        self,
        operator_id: str,
        *,
        call_id: str,
        inputs: dict[str, Any],
        parameters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._registry.call(
            operator_id,
            call_id=call_id,
            inputs=inputs,
            parameters=parameters,
        )


class AnalysisContext:
    """Capability-shaped analysis API. Paths never cross this boundary."""

    __slots__ = ("_inputs", "_json_outputs", "_operators", "_outputs", "_written")

    def __init__(
        self,
        inputs: dict[str, tuple[str, Path]],
        outputs: dict[str, tuple[str, Path]],
        operator_registry: StatisticalOperatorRegistry,
    ) -> None:
        self._inputs = inputs
        self._outputs = outputs
        self._written: set[str] = set()
        self._json_outputs: dict[str, Any] = {}
        self._operators = StatisticalOperatorCapability(operator_registry)

    @property
    def operators(self) -> StatisticalOperatorCapability:
        return self._operators

    def read(self, name: str) -> Any:
        format_name, path = self._input(name)
        if format_name == "JSON":
            with path.open("r", encoding="utf-8") as handle:
                return json.load(handle)
        if format_name == "CSV":
            import pandas as pd

            return pd.read_csv(path)
        if format_name == "ARROW":
            import pyarrow.ipc as ipc

            with path.open("rb") as handle:
                return ipc.open_file(handle).read_all().to_pandas()
        raise ValueError("PYTHON_INPUT_FORMAT_INVALID")

    def rows(self, name: str) -> list[dict[str, str]]:
        format_name, path = self._input(name)
        if format_name != "CSV":
            raise ValueError("PYTHON_INPUT_FORMAT_INVALID")
        with path.open("r", encoding="utf-8", newline="") as handle:
            return list(csv.DictReader(handle))

    def write_csv(self, name: str, value: Any) -> None:
        expected, path = self._output(name, "CSV")
        del expected
        if hasattr(value, "to_csv"):
            value.to_csv(path, index=False, lineterminator="\n")
        elif isinstance(value, list):
            keys = sorted({key for row in value if isinstance(row, dict) for key in row})
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=keys, lineterminator="\n")
                writer.writeheader()
                writer.writerows(value)
        else:
            raise TypeError("PYTHON_OUTPUT_VALUE_INVALID")
        self._written.add(name)

    def write_json(self, name: str, value: Any) -> None:
        _, path = self._output(name, "JSON")
        serialized = (
            json.dumps(
                value,
                ensure_ascii=False,
                allow_nan=False,
                sort_keys=True,
                separators=(",", ":"),
                default=_json_scalar,
            )
            + "\n"
        )
        path.write_text(serialized, encoding="utf-8")
        self._json_outputs[name] = json.loads(serialized)
        self._written.add(name)

    def write_markdown(self, name: str, value: str) -> None:
        _, path = self._output(name, "MARKDOWN")
        path.write_text(sanitize_markdown(str(value)), encoding="utf-8")
        self._written.add(name)

    def write_vega_lite(self, name: str, value: dict[str, Any]) -> None:
        _, path = self._output(name, "VEGA_LITE")
        if not isinstance(value, dict) or not isinstance(value.get("mark"), (str, dict)):
            raise ValueError("PYTHON_VEGA_LITE_INVALID")
        path.write_text(
            json.dumps(
                value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
            )
            + "\n",
            encoding="utf-8",
        )
        self._written.add(name)

    def write_arrow(self, name: str, value: Any) -> None:
        _, path = self._output(name, "ARROW")
        import pyarrow as pa
        import pyarrow.ipc as ipc

        table = (
            value
            if isinstance(value, pa.Table)
            else pa.Table.from_pandas(value, preserve_index=False)
        )
        with path.open("wb") as handle, ipc.new_file(handle, table.schema) as writer:
            writer.write_table(table)
        self._written.add(name)

    def write_png(self, name: str, figure: Any) -> None:
        _, path = self._output(name, "PNG")
        if not hasattr(figure, "savefig"):
            raise TypeError("PYTHON_PNG_VALUE_INVALID")
        figure.savefig(path, format="png", dpi=144, metadata={"Software": "data-agent-sandbox"})
        self._written.add(name)

    def written_outputs(self) -> frozenset[str]:
        return frozenset(self._written)

    def finalize_operator_receipts(
        self,
    ) -> tuple[tuple[StatisticalOperatorCallReceipt, ...], str]:
        return self._operators._registry.finalize(self._json_outputs)

    def _input(self, name: str) -> tuple[str, Path]:
        try:
            return self._inputs[name]
        except KeyError as error:
            raise KeyError("PYTHON_INPUT_NOT_DECLARED") from error

    def _output(self, name: str, expected_type: str) -> tuple[str, Path]:
        try:
            output_type, path = self._outputs[name]
        except KeyError as error:
            raise KeyError("PYTHON_OUTPUT_NOT_DECLARED") from error
        if output_type != expected_type:
            raise ValueError("PYTHON_OUTPUT_TYPE_MISMATCH")
        return output_type, path


def html_escape_text(value: str) -> str:
    """Kept as a deterministic helper for report authors; it never emits executable HTML."""

    return html.escape(value, quote=True)

from __future__ import annotations

import importlib
import inspect

from data_agent_stats.manifest import OPERATOR_BY_ID, OPERATOR_IDS


def test_manifest_resolves_exactly_one_public_implementation_per_operator() -> None:
    resolved: set[tuple[str, str]] = set()
    for operator_id in OPERATOR_IDS:
        implementation = OPERATOR_BY_ID[operator_id]["implementation"]
        module_name = implementation["module"]
        symbol = implementation["symbol"]
        module = importlib.import_module(module_name)
        function = getattr(module, symbol)

        assert callable(function)
        assert tuple(inspect.signature(function).parameters) == ("inputs", "parameters")
        assert symbol in module.__all__
        resolved.add((module_name, symbol))

    assert len(resolved) == len(OPERATOR_IDS) == 12

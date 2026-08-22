from __future__ import annotations

import builtins
import json
import sys
import traceback
from pathlib import Path
from types import MappingProxyType
from typing import Any

from data_agent_sandbox.python_runtime.policy import allowed_import_roots
from data_agent_sandbox.python_runtime.sdk import AnalysisContext

_SAFE_BUILTINS = {
    name: getattr(builtins, name)
    for name in (
        "abs",
        "all",
        "any",
        "bool",
        "dict",
        "enumerate",
        "filter",
        "float",
        "frozenset",
        "int",
        "isinstance",
        "issubclass",
        "len",
        "list",
        "map",
        "max",
        "min",
        "next",
        "object",
        "pow",
        "print",
        "range",
        "reversed",
        "round",
        "set",
        "slice",
        "sorted",
        "str",
        "sum",
        "tuple",
        "zip",
        "Exception",
        "ValueError",
        "TypeError",
        "KeyError",
    )
}


def _controlled_import(
    name: str,
    globals: dict[str, Any] | None = None,
    locals: dict[str, Any] | None = None,
    fromlist: tuple[str, ...] = (),
    level: int = 0,
    *,
    allowed_roots: frozenset[str],
) -> Any:
    del globals, locals
    if level != 0 or name.split(".", 1)[0] not in allowed_roots:
        raise ImportError("PYTHON_IMPORT_DENIED")
    return builtins.__import__(name, {}, {}, fromlist, 0)


def run(control_path: Path) -> int:
    control = json.loads(control_path.read_text(encoding="utf-8"))
    job_root = control_path.parent
    inputs = {
        item["name"]: (item["format"], job_root / "input" / item["file_name"])
        for item in control["inputs"]
    }
    outputs = {
        item["name"]: (item["type"], job_root / "output" / item["file_name"])
        for item in control["outputs"]
    }
    allowed_roots = allowed_import_roots(control["import_profile"])
    context = AnalysisContext(inputs, outputs)
    source = (job_root / "program.py").read_text(encoding="utf-8")
    namespace: dict[str, Any] = {
        "__builtins__": MappingProxyType(
            {
                **_SAFE_BUILTINS,
                "__import__": lambda name, globals=None, locals=None, fromlist=(), level=0: (
                    _controlled_import(
                        name,
                        globals,
                        locals,
                        fromlist,
                        level,
                        allowed_roots=allowed_roots,
                    )
                ),
            }
        ),
        "__name__": "sandbox_program",
    }
    try:
        exec(
            compile(source, "<sandbox-program>", "exec", dont_inherit=True, optimize=2),
            namespace,
            namespace,
        )
        main = namespace.get("main")
        if not callable(main):
            raise ValueError("PYTHON_ENTRYPOINT_MISSING")
        result = main(context)
        if result is not None:
            raise ValueError("PYTHON_ENTRYPOINT_RETURN_MUST_BE_NONE")
        (job_root / "output" / ".worker-result.json").write_text(
            json.dumps({"status": "SUCCEEDED", "written": sorted(context.written_outputs())}),
            encoding="utf-8",
        )
        return 0
    except BaseException as error:
        traceback.print_exception(
            type(error), error, error.__traceback__, limit=20, file=sys.stderr
        )
        (job_root / "output" / ".worker-result.json").write_text(
            json.dumps({"status": "FAILED", "error_type": type(error).__name__}),
            encoding="utf-8",
        )
        return 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(64)
    raise SystemExit(run(Path(sys.argv[1]).resolve()))

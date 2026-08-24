from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import Literal

AnalysisImportProfile = Literal["CORE_ANALYSIS", "ML_DIAGNOSTIC", "CAUSAL_L5"]
GeneratedSourcePolicy = Literal["OPEN_ANALYSIS", "GOVERNED_OPERATOR_ORCHESTRATION"]

CORE_IMPORT_ROOTS = frozenset(
    {
        "collections",
        "datetime",
        "decimal",
        "itertools",
        "json",
        "math",
        "matplotlib",
        "numpy",
        "pandas",
        "pyarrow",
        "scipy",
        "statistics",
    }
)
PROFILE_IMPORT_ROOTS: dict[AnalysisImportProfile, frozenset[str]] = {
    "CORE_ANALYSIS": CORE_IMPORT_ROOTS,
    "ML_DIAGNOSTIC": CORE_IMPORT_ROOTS | frozenset({"sklearn", "statsmodels"}),
    "CAUSAL_L5": CORE_IMPORT_ROOTS
    | frozenset({"dowhy", "econml", "networkx", "sklearn", "statsmodels"}),
}
GOVERNED_IMPORT_ROOTS = CORE_IMPORT_ROOTS - frozenset({"scipy"})
MAX_SOURCE_BYTES = 100_000
MAX_AST_NODES = 25_000
BANNED_NAMES = frozenset(
    {
        "__builtins__",
        "__import__",
        "breakpoint",
        "compile",
        "delattr",
        "dir",
        "eval",
        "exec",
        "getattr",
        "globals",
        "hasattr",
        "help",
        "input",
        "locals",
        "setattr",
        "vars",
    }
)
BANNED_ROOTS = frozenset(
    {
        "builtins",
        "ctypes",
        "data_agent_stats",
        "importlib",
        "marshal",
        "multiprocessing",
        "os",
        "pathlib",
        "pickle",
        "resource",
        "shutil",
        "signal",
        "socket",
        "subprocess",
        "sys",
    }
)
READ_CALLS = frozenset(
    {
        "read_csv",
        "read_feather",
        "read_json",
        "read_orc",
        "read_parquet",
        "read_table",
    }
)
WRITE_CALLS = frozenset(
    {
        "savefig",
        "to_csv",
        "to_feather",
        "to_json",
        "to_orc",
        "to_parquet",
    }
)
READ_PREFIXES = (
    "/workspace/inputs/",
)
WRITE_PREFIXES: tuple[str, ...] = ()
PROTECTED_BINDING_PREFIXES = ("__da_gov_", "__da_input_")


def _protected_binding(name: str) -> bool:
    return name.startswith(PROTECTED_BINDING_PREFIXES)


@dataclass(frozen=True)
class CellPolicyViolation:
    code: str
    line: int
    detail: str


class CellPolicyError(ValueError):
    def __init__(self, violations: tuple[CellPolicyViolation, ...]):
        self.violations = violations
        super().__init__("; ".join(f"{item.code}@{item.line}" for item in violations))


def _literal_path(call: ast.Call) -> str | None:
    if not call.args:
        return None
    value = call.args[0]
    return value.value if isinstance(value, ast.Constant) and isinstance(value.value, str) else None


def _allowed_path(path: str | None, prefixes: tuple[str, ...]) -> bool:
    return path is not None and ".." not in path and path.startswith(prefixes)


def validate_cell_source(
    source: str,
    profile: AnalysisImportProfile,
    generated_source_policy: GeneratedSourcePolicy,
) -> ast.Module:
    if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise CellPolicyError((CellPolicyViolation("SOURCE_TOO_LARGE", 1, "source too large"),))
    if "\x00" in source:
        raise CellPolicyError((CellPolicyViolation("SOURCE_NUL", 1, "NUL is forbidden"),))
    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError as error:
        raise CellPolicyError(
            (CellPolicyViolation("SOURCE_SYNTAX", error.lineno or 1, "invalid syntax"),)
        ) from error
    nodes = tuple(ast.walk(tree))
    if len(nodes) > MAX_AST_NODES:
        raise CellPolicyError((CellPolicyViolation("AST_TOO_LARGE", 1, "AST too large"),))
    import_roots = PROFILE_IMPORT_ROOTS[profile]
    if generated_source_policy == "GOVERNED_OPERATOR_ORCHESTRATION":
        import_roots = import_roots & GOVERNED_IMPORT_ROOTS
    violations: list[CellPolicyViolation] = []
    for node in nodes:
        line = getattr(node, "lineno", 1)
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = (
                [alias.name for alias in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""]
            )
            if any(name.split(".", 1)[0] not in import_roots for name in names):
                violations.append(CellPolicyViolation("IMPORT_DENIED", line, ",".join(names)))
            if any(
                _protected_binding(alias.asname or alias.name)
                for alias in node.names
            ):
                violations.append(
                    CellPolicyViolation("PROTECTED_BINDING_MUTATION", line, "import alias")
                )
        elif isinstance(node, ast.Name) and node.id in BANNED_NAMES | BANNED_ROOTS:
            violations.append(CellPolicyViolation("NAME_DENIED", line, node.id))
        elif (
            isinstance(node, ast.Name)
            and _protected_binding(node.id)
            and isinstance(node.ctx, (ast.Store, ast.Del))
        ):
            violations.append(CellPolicyViolation("PROTECTED_BINDING_MUTATION", line, node.id))
        elif isinstance(node, (ast.FunctionDef, ast.ClassDef)) and _protected_binding(node.name):
            violations.append(CellPolicyViolation("PROTECTED_BINDING_MUTATION", line, node.name))
        elif (
            isinstance(node, ast.ExceptHandler)
            and isinstance(node.name, str)
            and _protected_binding(node.name)
        ):
            violations.append(CellPolicyViolation("PROTECTED_BINDING_MUTATION", line, node.name))
        elif isinstance(node, ast.Attribute):
            root = node
            while isinstance(root, ast.Attribute):
                if root.attr.startswith("_"):
                    violations.append(
                        CellPolicyViolation("PRIVATE_ATTRIBUTE_DENIED", line, root.attr)
                    )
                root = root.value
            if isinstance(root, ast.Name) and root.id in BANNED_ROOTS:
                violations.append(CellPolicyViolation("ATTRIBUTE_ROOT_DENIED", line, root.id))
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            violations.append(CellPolicyViolation("GLOBAL_STATE_DENIED", line, type(node).__name__))
        elif isinstance(node, (ast.AsyncFunctionDef, ast.Await, ast.Yield, ast.YieldFrom)):
            violations.append(
                CellPolicyViolation("ASYNC_GENERATOR_DENIED", line, type(node).__name__)
            )
        if not isinstance(node, ast.Call):
            continue
        if isinstance(node.func, ast.Name) and node.func.id == "open":
            path = _literal_path(node)
            mode_node = node.args[1] if len(node.args) > 1 else None
            mode = (
                mode_node.value
                if isinstance(mode_node, ast.Constant) and isinstance(mode_node.value, str)
                else "r"
            )
            prefixes = WRITE_PREFIXES if any(flag in mode for flag in "wax+") else READ_PREFIXES
            if not _allowed_path(path, prefixes):
                violations.append(CellPolicyViolation("FILE_PATH_DENIED", line, path or "dynamic"))
        if isinstance(node.func, ast.Name) and node.func.id in BANNED_NAMES:
            violations.append(CellPolicyViolation("CALL_DENIED", line, node.func.id))
        if isinstance(node.func, ast.Attribute) and node.func.attr in READ_CALLS | WRITE_CALLS:
            path = _literal_path(node)
            prefixes = WRITE_PREFIXES if node.func.attr in WRITE_CALLS else READ_PREFIXES
            if node.func.attr in WRITE_CALLS:
                violations.append(CellPolicyViolation("FILE_WRITE_DENIED", line, node.func.attr))
            if path is not None and not _allowed_path(path, prefixes):
                violations.append(CellPolicyViolation("FILE_PATH_DENIED", line, path))
            if path is None and node.func.attr in READ_CALLS:
                violations.append(CellPolicyViolation("FILE_PATH_DENIED", line, "dynamic"))
    if violations:
        raise CellPolicyError(tuple(dict.fromkeys(violations)))
    return tree


__all__ = ["CellPolicyError", "CellPolicyViolation", "validate_cell_source"]

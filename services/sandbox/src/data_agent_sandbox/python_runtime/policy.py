from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import Literal

AnalysisImportProfile = Literal["CORE_ANALYSIS", "ML_DIAGNOSTIC", "CAUSAL_L5"]

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
MAX_SOURCE_BYTES = 262_144
MAX_AST_NODES = 25_000
BANNED_NAMES = frozenset(
    {
        "__import__",
        "breakpoint",
        "compile",
        "delattr",
        "dir",
        "eval",
        "exec",
        "getattr",
        "globals",
        "help",
        "input",
        "locals",
        "open",
        "setattr",
        "vars",
    }
)
BANNED_ROOTS = frozenset(
    {
        "builtins",
        "ctypes",
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
BANNED_IO_ATTRIBUTES = frozenset(
    {
        "load",
        "loads",
        "load_library",
        "loadmat",
        "memory_map",
        "memmap",
        "read_csv",
        "read_excel",
        "read_feather",
        "read_fwf",
        "read_html",
        "read_json",
        "read_orc",
        "read_parquet",
        "read_pickle",
        "read_sas",
        "read_sql",
        "read_stata",
        "read_table",
        "read_xml",
        "save",
        "savefig",
        "savetxt",
        "to_clipboard",
        "to_excel",
        "to_feather",
        "to_html",
        "to_json",
        "to_orc",
        "to_parquet",
        "to_pickle",
        "to_sql",
    }
)


@dataclass(frozen=True)
class PolicyViolation:
    code: str
    line: int
    detail: str


class PythonPolicyError(ValueError):
    def __init__(self, violations: tuple[PolicyViolation, ...]):
        self.violations = violations
        super().__init__("; ".join(f"{item.code}@{item.line}" for item in violations))


def allowed_import_roots(profile: AnalysisImportProfile) -> frozenset[str]:
    try:
        return PROFILE_IMPORT_ROOTS[profile]
    except KeyError as error:
        raise PythonPolicyError(
            (PolicyViolation("IMPORT_PROFILE_DENIED", 1, "unknown import profile"),)
        ) from error


def validate_python_source(
    source: str, profile: AnalysisImportProfile = "CORE_ANALYSIS"
) -> ast.Module:
    if len(source.encode("utf-8")) > MAX_SOURCE_BYTES:
        raise PythonPolicyError(
            (PolicyViolation("SOURCE_TOO_LARGE", 1, "source exceeds policy byte limit"),)
        )
    if "\x00" in source:
        raise PythonPolicyError((PolicyViolation("SOURCE_NUL", 1, "NUL is forbidden"),))
    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError as error:
        raise PythonPolicyError(
            (PolicyViolation("SOURCE_SYNTAX", error.lineno or 1, "invalid Python syntax"),)
        ) from error
    nodes = tuple(ast.walk(tree))
    if len(nodes) > MAX_AST_NODES:
        raise PythonPolicyError(
            (PolicyViolation("AST_TOO_LARGE", 1, "AST exceeds policy node limit"),)
        )
    import_roots = allowed_import_roots(profile)
    violations: list[PolicyViolation] = []
    main_functions = [
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "main"
    ]
    if len(main_functions) != 1 or isinstance(main_functions[0], ast.AsyncFunctionDef):
        violations.append(PolicyViolation("ENTRYPOINT_INVALID", 1, "define def main(context)"))
    else:
        arguments = main_functions[0].args
        if (
            len(arguments.args) != 1
            or arguments.args[0].arg != "context"
            or arguments.vararg
            or arguments.kwarg
            or arguments.kwonlyargs
        ):
            violations.append(
                PolicyViolation(
                    "ENTRYPOINT_SIGNATURE_INVALID", main_functions[0].lineno, "main(context)"
                )
            )

    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef)):
            continue
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            value = node.value
            if isinstance(value, (ast.Constant, ast.List, ast.Tuple, ast.Set, ast.Dict)):
                continue
        violations.append(
            PolicyViolation(
                "TOP_LEVEL_EFFECT_DENIED", getattr(node, "lineno", 1), type(node).__name__
            )
        )

    for node in nodes:
        line = getattr(node, "lineno", 1)
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = (
                [alias.name for alias in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""]
            )
            if any(name.split(".", 1)[0] not in import_roots for name in names):
                violations.append(PolicyViolation("IMPORT_DENIED", line, ",".join(names)))
        elif isinstance(node, ast.Name) and node.id in BANNED_NAMES | BANNED_ROOTS:
            violations.append(PolicyViolation("NAME_DENIED", line, node.id))
        elif isinstance(node, ast.Attribute):
            root = node
            while isinstance(root, ast.Attribute):
                if root.attr.startswith("_"):
                    violations.append(PolicyViolation("PRIVATE_ATTRIBUTE_DENIED", line, root.attr))
                if root.attr in BANNED_ROOTS or root.attr in BANNED_IO_ATTRIBUTES:
                    violations.append(PolicyViolation("ATTRIBUTE_DENIED", line, root.attr))
                root = root.value
            if isinstance(root, ast.Name) and root.id in BANNED_ROOTS:
                violations.append(PolicyViolation("ATTRIBUTE_ROOT_DENIED", line, root.id))
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            violations.append(PolicyViolation("GLOBAL_STATE_DENIED", line, type(node).__name__))
        elif isinstance(node, (ast.AsyncFunctionDef, ast.Await, ast.Yield, ast.YieldFrom)):
            violations.append(PolicyViolation("ASYNC_GENERATOR_DENIED", line, type(node).__name__))
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in BANNED_NAMES
        ):
            violations.append(PolicyViolation("CALL_DENIED", line, node.func.id))
    if violations:
        unique = tuple(dict.fromkeys(violations))
        raise PythonPolicyError(unique)
    return tree

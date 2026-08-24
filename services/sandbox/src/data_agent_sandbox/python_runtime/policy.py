from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import Literal

from data_agent_sandbox.python_runtime.models import (
    GeneratedSourcePolicy,
    StatisticalOperatorObligation,
)

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
GOVERNED_ORCHESTRATION_IMPORT_ROOTS = frozenset(
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
        "statistics",
    }
)
MAX_SOURCE_BYTES = 262_144
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
    source: str,
    profile: AnalysisImportProfile,
    *,
    generated_source_policy: GeneratedSourcePolicy,
    operator_obligations: tuple[StatisticalOperatorObligation, ...],
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
    parents = {child: parent for parent in nodes for child in ast.iter_child_nodes(parent)}
    if len(nodes) > MAX_AST_NODES:
        raise PythonPolicyError(
            (PolicyViolation("AST_TOO_LARGE", 1, "AST exceeds policy node limit"),)
        )
    import_roots = allowed_import_roots(profile)
    if generated_source_policy == "GOVERNED_OPERATOR_ORCHESTRATION":
        import_roots = import_roots & GOVERNED_ORCHESTRATION_IMPORT_ROOTS
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

        class MainReturnVisitor(ast.NodeVisitor):
            def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
                if node is main_functions[0]:
                    for statement in node.body:
                        self.visit(statement)

            def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
                del node

            def visit_Lambda(self, node: ast.Lambda) -> None:
                del node

            def visit_Return(self, node: ast.Return) -> None:
                if node.value is not None and not (
                    isinstance(node.value, ast.Constant) and node.value.value is None
                ):
                    violations.append(
                        PolicyViolation(
                            "ENTRYPOINT_RETURN_MUST_BE_NONE",
                            node.lineno,
                            "main must return None",
                        )
                    )

        MainReturnVisitor().visit(main_functions[0])

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
    operator_calls: list[tuple[str, str, int]] = []
    for node in nodes:
        if (
            isinstance(node, ast.Attribute)
            and node.attr == "operators"
            and isinstance(node.value, ast.Name)
            and node.value.id == "context"
        ):
            parent = parents.get(node)
            grandparent = parents.get(parent) if parent is not None else None
            if not (
                isinstance(parent, ast.Attribute)
                and parent.attr == "call"
                and isinstance(grandparent, ast.Call)
                and grandparent.func is parent
            ):
                violations.append(
                    PolicyViolation(
                        "OPERATOR_NOT_AUTHORIZED",
                        getattr(node, "lineno", 1),
                        "operator capability cannot be aliased or inspected",
                    )
                )
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        owner = node.func.value
        exact_operator_call = (
            node.func.attr == "call"
            and isinstance(owner, ast.Attribute)
            and owner.attr == "operators"
            and isinstance(owner.value, ast.Name)
            and owner.value.id == "context"
        )
        references_operator_capability = exact_operator_call or (
            isinstance(owner, ast.Attribute) and owner.attr == "operators"
        )
        if not references_operator_capability:
            continue
        line = getattr(node, "lineno", 1)
        keyword_names = tuple(keyword.arg for keyword in node.keywords)
        keyword_name_set = set(keyword_names)
        valid_keyword_shape = (
            len(keyword_names) == len(keyword_name_set)
            and "call_id" in keyword_name_set
            and "inputs" in keyword_name_set
            and keyword_name_set <= {"call_id", "inputs", "parameters"}
        )
        if not exact_operator_call or len(node.args) != 1 or not valid_keyword_shape:
            violations.append(
                PolicyViolation("OPERATOR_NOT_AUTHORIZED", line, "invalid operator call shape")
            )
            continue
        operator_argument = node.args[0]
        call_keyword = next(
            (keyword.value for keyword in node.keywords if keyword.arg == "call_id"), None
        )
        if (
            not isinstance(operator_argument, ast.Constant)
            or not isinstance(operator_argument.value, str)
            or not isinstance(call_keyword, ast.Constant)
            or not isinstance(call_keyword.value, str)
        ):
            violations.append(
                PolicyViolation(
                    "OPERATOR_NOT_AUTHORIZED", line, "operator and call ids must be literals"
                )
            )
            continue
        operator_calls.append((call_keyword.value, operator_argument.value, line))
    expected_calls = tuple(
        (obligation.call_id, obligation.operator_id) for obligation in operator_obligations
    )
    observed_calls = tuple((call_id, operator_id) for call_id, operator_id, _ in operator_calls)
    if generated_source_policy != "GOVERNED_OPERATOR_ORCHESTRATION":
        if operator_calls:
            violations.append(
                PolicyViolation(
                    "OPERATOR_NOT_AUTHORIZED",
                    operator_calls[0][2],
                    "source policy does not authorize operators",
                )
            )
    elif len({call_id for call_id, _, _ in operator_calls}) != len(operator_calls):
        violations.append(
            PolicyViolation("OPERATOR_DUPLICATE_CALL_ID", 1, "operator call_id is duplicated")
        )
    elif len(observed_calls) < len(expected_calls):
        violations.append(
            PolicyViolation("OPERATOR_REQUIRED_CALL_MISSING", 1, "required operator call missing")
        )
    elif len(observed_calls) > len(expected_calls):
        violations.append(
            PolicyViolation("OPERATOR_UNDECLARED_CALL", 1, "undeclared operator call")
        )
    elif observed_calls != expected_calls:
        violations.append(
            PolicyViolation("OPERATOR_NOT_AUTHORIZED", 1, "operator call order or identity drift")
        )
    if violations:
        unique = tuple(dict.fromkeys(violations))
        raise PythonPolicyError(unique)
    return tree

"""Persistent extraction server for the Python pipeline.

Started once by PythonServer (see server.ts) and kept running for the
lifetime of an analysis session instead of spawning a fresh interpreter per
file. Reads newline-delimited JSON requests from stdin and writes
newline-delimited JSON responses to stdout, one line per request:

    request:  {"id": <int>, "method": <str>, "params": <object>}
    response: {"id": <int>, "result": <any>}
           or {"id": <int>, "error": {"message": <str>}}

stdout is reserved for protocol responses only; anything the extraction code
wants to log goes to stderr so it never corrupts the line protocol.
"""

import ast
import json
import os
import sys


def _line_range(node):
    return {
        "startLine": node.lineno,
        "startColumn": node.col_offset + 1,
        "endLine": getattr(node, "end_lineno", node.lineno),
        "endColumn": getattr(node, "end_col_offset", node.col_offset) + 1,
    }


def _find_dunder_all(module_body):
    """Returns the set of names listed in a module-level `__all__ = [...]`, or None if absent."""
    for stmt in module_body:
        if not isinstance(stmt, ast.Assign):
            continue
        if len(stmt.targets) != 1 or not isinstance(stmt.targets[0], ast.Name):
            continue
        if stmt.targets[0].id != "__all__":
            continue
        if not isinstance(stmt.value, (ast.List, ast.Tuple, ast.Set)):
            continue
        names = [
            elt.value
            for elt in stmt.value.elts
            if isinstance(elt, ast.Constant) and isinstance(elt.value, str)
        ]
        return set(names)
    return None


def _is_exported(name, dunder_all):
    if dunder_all is not None:
        return name in dunder_all
    return not name.startswith("_")


def _extract_class_members(class_node, class_name, class_exported):
    members = []
    for stmt in class_node.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            members.append(
                {
                    "kind": "method",
                    "name": stmt.name,
                    "exported": class_exported,
                    "range": _line_range(stmt),
                    "parentName": class_name,
                }
            )
        elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            members.append(
                {
                    "kind": "property",
                    "name": stmt.target.id,
                    "exported": class_exported,
                    "range": _line_range(stmt),
                    "parentName": class_name,
                }
            )
        elif isinstance(stmt, ast.Assign):
            for target in stmt.targets:
                if isinstance(target, ast.Name):
                    members.append(
                        {
                            "kind": "property",
                            "name": target.id,
                            "exported": class_exported,
                            "range": _line_range(stmt),
                            "parentName": class_name,
                        }
                    )
    return members


def _extract_import(stmt):
    imports = []
    for alias in stmt.names:
        imports.append(
            {
                "moduleSpecifier": alias.name,
                "importedNames": ["*"],
                "isRelative": False,
                "relativeLevel": 0,
                "range": _line_range(stmt),
            }
        )
    return imports


def _extract_import_from(stmt):
    names = [alias.name for alias in stmt.names]
    return [
        {
            "moduleSpecifier": stmt.module or "",
            "importedNames": names,
            "isRelative": stmt.level > 0,
            "relativeLevel": stmt.level,
            "range": _line_range(stmt),
        }
    ]


def extract_file(file_path):
    with open(file_path, "r", encoding="utf-8") as handle:
        source = handle.read()

    tree = ast.parse(source, filename=file_path)
    dunder_all = _find_dunder_all(tree.body)

    symbols = []
    imports = []

    for stmt in tree.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            symbols.append(
                {
                    "kind": "function",
                    "name": stmt.name,
                    "exported": _is_exported(stmt.name, dunder_all),
                    "range": _line_range(stmt),
                }
            )
        elif isinstance(stmt, ast.ClassDef):
            exported = _is_exported(stmt.name, dunder_all)
            symbols.append(
                {
                    "kind": "class",
                    "name": stmt.name,
                    "exported": exported,
                    "range": _line_range(stmt),
                }
            )
            symbols.extend(_extract_class_members(stmt, stmt.name, exported))
        elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            symbols.append(
                {
                    "kind": "variable",
                    "name": stmt.target.id,
                    "exported": _is_exported(stmt.target.id, dunder_all),
                    "range": _line_range(stmt),
                }
            )
        elif isinstance(stmt, ast.Assign):
            for target in stmt.targets:
                if isinstance(target, ast.Name) and target.id != "__all__":
                    symbols.append(
                        {
                            "kind": "variable",
                            "name": target.id,
                            "exported": _is_exported(target.id, dunder_all),
                            "range": _line_range(stmt),
                        }
                    )
        elif isinstance(stmt, ast.Import):
            imports.extend(_extract_import(stmt))
        elif isinstance(stmt, ast.ImportFrom):
            imports.extend(_extract_import_from(stmt))

    return {
        "filePath": file_path,
        "language": "python",
        "symbols": symbols,
        "imports": imports,
    }


def handle_ping(_params):
    return {"status": "ok", "pid": os.getpid()}


def handle_extract(params):
    files = params.get("files", [])
    extracted = []
    errors = []

    for file_path in files:
        try:
            extracted.append(extract_file(file_path))
        except (SyntaxError, OSError, UnicodeDecodeError) as exc:
            errors.append({"filePath": file_path, "message": str(exc)})

    return {"files": extracted, "errors": errors}


HANDLERS = {
    "ping": handle_ping,
    "extract": handle_extract,
}


def main():
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            print(f"agent-graph python server: malformed request: {exc}", file=sys.stderr)
            continue

        request_id = request.get("id")
        method = request.get("method")
        params = request.get("params") or {}

        try:
            handler = HANDLERS.get(method)
            if handler is None:
                raise ValueError(f"Unknown method: {method}")
            response = {"id": request_id, "result": handler(params)}
        except Exception as exc:  # noqa: BLE001 - any failure must become an error response, not a crash
            response = {"id": request_id, "error": {"message": str(exc)}}

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()

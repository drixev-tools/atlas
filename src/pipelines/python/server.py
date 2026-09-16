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


def _build_import_table(module_body):
    """Maps each name an import statement binds in this module's top-level scope to
    where it came from, so a call/base reference to that name can be resolved to a
    module specifier without re-parsing the target file. `importedName` is None for
    a whole-module bind (`import x` / `import x as y`), letting `_resolve_attribute`
    tell it apart from a `from x import y` bind of a single name.
    """
    table = {}
    for stmt in module_body:
        if isinstance(stmt, ast.Import):
            for alias in stmt.names:
                if alias.asname:
                    bound_name = alias.asname
                    module_specifier = alias.name
                else:
                    bound_name = alias.name.split(".")[0]
                    module_specifier = bound_name
                table[bound_name] = {
                    "moduleSpecifier": module_specifier,
                    "importedName": None,
                    "isRelative": False,
                    "relativeLevel": 0,
                }
        elif isinstance(stmt, ast.ImportFrom):
            for alias in stmt.names:
                if alias.name == "*":
                    continue
                table[alias.asname or alias.name] = {
                    "moduleSpecifier": stmt.module or "",
                    "importedName": alias.name,
                    "isRelative": stmt.level > 0,
                    "relativeLevel": stmt.level,
                }
    return table


def _build_local_scope(module_body):
    """Maps module-level function/class names to their own range, plus each class's
    method names to their range, so calls/bases referencing them can be resolved
    to an exact symbol without a type checker.
    """
    top_level = {}
    methods_by_class = {}
    for stmt in module_body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            top_level[stmt.name] = _line_range(stmt)
        elif isinstance(stmt, ast.ClassDef):
            top_level[stmt.name] = _line_range(stmt)
            methods_by_class[stmt.name] = {
                member.name: _line_range(member)
                for member in stmt.body
                if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef))
            }
    return top_level, methods_by_class


def _resolve_name(name, scope):
    if name in scope["top_level"]:
        return {"type": "local", "name": name, "range": scope["top_level"][name]}
    imp = scope["import_table"].get(name)
    if imp and imp["importedName"] is not None:
        return {
            "type": "import",
            "name": imp["importedName"],
            "moduleSpecifier": imp["moduleSpecifier"],
            "isRelative": imp["isRelative"],
            "relativeLevel": imp["relativeLevel"],
        }
    return None


def _resolve_attribute(base_name, attr_name, scope):
    imp = scope["import_table"].get(base_name)
    if not imp or imp["importedName"] is not None:
        return None
    return {
        "type": "import",
        "name": attr_name,
        "moduleSpecifier": imp["moduleSpecifier"],
        "isRelative": imp["isRelative"],
        "relativeLevel": imp["relativeLevel"],
    }


def _resolve_self_method(attr_name, class_name, scope):
    if class_name is None:
        return None
    method_range = scope["methods_by_class"].get(class_name, {}).get(attr_name)
    return {"type": "local", "name": attr_name, "range": method_range} if method_range else None


def _resolve_reference(node, class_name, scope):
    if isinstance(node, ast.Name):
        return _resolve_name(node.id, scope)
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
        if node.value.id == "self" and class_name is not None:
            return _resolve_self_method(node.attr, class_name, scope)
        return _resolve_attribute(node.value.id, node.attr, scope)
    return None


def _describe_reference(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _describe_reference(node.value) if isinstance(node.value, (ast.Name, ast.Attribute)) else "<expr>"
        return f"{base}.{node.attr}"
    return "<expr>"


def _collect_call_relations(body, from_ref, class_name, scope, unresolved):
    relations = []
    order = 0
    for stmt in body:
        for node in ast.walk(stmt):
            if not isinstance(node, ast.Call):
                continue
            target = _resolve_reference(node.func, class_name, scope)
            if target is None:
                unresolved.append(
                    {
                        "kind": "calls",
                        "enclosingName": from_ref["name"],
                        "name": _describe_reference(node.func),
                        "range": _line_range(node),
                    }
                )
                continue
            relations.append(
                {
                    "kind": "calls",
                    "from": from_ref,
                    "target": target,
                    "metadata": {"line": node.lineno, "order": order},
                }
            )
            order += 1
    return relations


def _collect_extends_relations(class_node, from_ref, scope, unresolved):
    relations = []
    for base in class_node.bases:
        target = _resolve_reference(base, None, scope)
        if target is None:
            unresolved.append(
                {
                    "kind": "extends",
                    "enclosingName": from_ref["name"],
                    "name": _describe_reference(base) if isinstance(base, (ast.Name, ast.Attribute)) else "<expr>",
                    "range": _line_range(base),
                }
            )
            continue
        relations.append({"kind": "extends", "from": from_ref, "target": target})
    return relations


def extract_file(file_path):
    with open(file_path, "r", encoding="utf-8") as handle:
        source = handle.read()

    tree = ast.parse(source, filename=file_path)
    dunder_all = _find_dunder_all(tree.body)

    top_level, methods_by_class = _build_local_scope(tree.body)
    scope = {
        "top_level": top_level,
        "methods_by_class": methods_by_class,
        "import_table": _build_import_table(tree.body),
    }

    symbols = []
    imports = []
    relations = []
    unresolved = []

    for stmt in tree.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            range_ = _line_range(stmt)
            symbols.append(
                {
                    "kind": "function",
                    "name": stmt.name,
                    "exported": _is_exported(stmt.name, dunder_all),
                    "range": range_,
                }
            )
            relations.extend(
                _collect_call_relations(stmt.body, {"name": stmt.name, "range": range_}, None, scope, unresolved)
            )
        elif isinstance(stmt, ast.ClassDef):
            exported = _is_exported(stmt.name, dunder_all)
            range_ = _line_range(stmt)
            symbols.append(
                {
                    "kind": "class",
                    "name": stmt.name,
                    "exported": exported,
                    "range": range_,
                }
            )
            symbols.extend(_extract_class_members(stmt, stmt.name, exported))
            relations.extend(_collect_extends_relations(stmt, {"name": stmt.name, "range": range_}, scope, unresolved))
            for member in stmt.body:
                if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    member_ref = {"name": member.name, "range": _line_range(member)}
                    relations.extend(_collect_call_relations(member.body, member_ref, stmt.name, scope, unresolved))
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
        "relations": relations,
        "unresolved": unresolved,
    }


def handle_ping(_params):
    return {"status": "ok", "pid": os.getpid()}


def handle_extract(params):
    files = params.get("files", [])
    extracted = []
    errors = []

    for file_path in files:
        try:
            result = extract_file(file_path)
        except (SyntaxError, OSError, UnicodeDecodeError) as exc:
            errors.append({"filePath": file_path, "message": str(exc)})
            continue

        extracted.append(result)
        for item in result["unresolved"]:
            print(
                "agent-graph python server: unresolved {kind} '{name}' in {file}:{line} (from {enclosing})".format(
                    kind=item["kind"],
                    name=item["name"],
                    file=file_path,
                    line=item["range"]["startLine"],
                    enclosing=item["enclosingName"],
                ),
                file=sys.stderr,
            )

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

import * as ts from 'typescript';
import { isJavaScriptFile } from './files';

export type ExtractedSymbolKind =
	| 'function'
	| 'class'
	| 'interface'
	| 'method'
	| 'property'
	| 'variable'
	| 'enum'
	| 'typeAlias';

export interface ExtractedRange {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

export interface ExtractedSymbol {
	kind: ExtractedSymbolKind;
	name: string;
	exported: boolean;
	range: ExtractedRange;
	/** Name of the enclosing class/interface, for members. */
	parentName?: string;
}

/** A declaration the type checker resolved a reference to: enough to rebuild the same symbol id normalize.ts assigns the declaring file's own `ExtractedSymbol`. */
export interface ExtractedDeclarationRef {
	filePath: string;
	range: ExtractedRange;
	name: string;
}

export interface ExtractedImport {
	moduleSpecifier: string;
	/** Names pulled in by this import: identifier names, 'default', or '*' for a namespace import. */
	importedNames: string[];
	/** Declarations the type checker resolved each named/default binding to, following aliases (`import { x as y }`) to the original export. Empty for namespace imports and anything the checker couldn't resolve. */
	resolvedSymbols: ExtractedDeclarationRef[];
	isTypeOnly: boolean;
	/** True for CommonJS `require(...)` rather than an ES `import` statement. */
	isRequire: boolean;
	range: ExtractedRange;
}

export interface ExtractedExport {
	name: string;
	/** Set when this is a re-export (`export { x } from './y'` or `export * from './y'`). */
	fromModule?: string;
}

export type ExtractedRelationKind = 'calls' | 'extends' | 'implements' | 'instantiates';

export interface ExtractedRelation {
	kind: ExtractedRelationKind;
	/** The enclosing function/method (for calls/instantiates) or class/interface (for extends/implements) this relation originates from, in the same file being extracted. */
	from: { name: string; range: ExtractedRange };
	target: ExtractedDeclarationRef;
	metadata?: Record<string, unknown>;
}

export interface ExtractedFile {
	filePath: string;
	language: 'typescript' | 'javascript';
	symbols: ExtractedSymbol[];
	imports: ExtractedImport[];
	exports: ExtractedExport[];
	relations: ExtractedRelation[];
}

function toRange(sourceFile: ts.SourceFile, node: ts.Node): ExtractedRange {
	const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
	const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
	return {
		startLine: start.line + 1,
		startColumn: start.character + 1,
		endLine: end.line + 1,
		endColumn: end.character + 1
	};
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
	if (!ts.canHaveModifiers(node)) {
		return false;
	}
	return ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false;
}

function isExportedDeclaration(node: ts.Node): boolean {
	return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

/**
 * Resolves the set of names a module exports using the type checker, which
 * catches `export { x }` lists and re-exports in addition to declarations
 * marked with the `export` keyword directly.
 */
function getCheckedExportedNames(checker: ts.TypeChecker, sourceFile: ts.SourceFile): Set<string> {
	const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
	if (!moduleSymbol) {
		return new Set();
	}
	return new Set(checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.name));
}

function getDeclarationNameIdentifier(declaration: ts.Declaration): ts.Identifier | undefined {
	const named = declaration as ts.Declaration & { name?: ts.Node };
	return named.name && ts.isIdentifier(named.name) ? named.name : undefined;
}

/**
 * Resolves a reference node (call callee, `new` target, heritage clause type,
 * import binding) to the declaration the type checker says it points to, in
 * the same `{filePath, range, name}` shape `toRange` gives an `ExtractedSymbol`
 * so normalize.ts can rebuild that declaration's exact symbol id. Returns
 * undefined for anything the checker can't resolve to a named declaration:
 * external modules with no usable source, dynamic/computed references, and
 * declarations without a simple identifier name (e.g. anonymous default
 * exports) are all left for the caller to discard rather than guess at.
 */
function resolveDeclarationTarget(checker: ts.TypeChecker, node: ts.Node): ExtractedDeclarationRef | undefined {
	let symbol = checker.getSymbolAtLocation(node);
	if (!symbol) {
		return undefined;
	}
	if (symbol.flags & ts.SymbolFlags.Alias) {
		symbol = checker.getAliasedSymbol(symbol);
	}

	const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
	if (!declaration) {
		return undefined;
	}

	const nameIdentifier = getDeclarationNameIdentifier(declaration);
	if (!nameIdentifier) {
		return undefined;
	}

	const declarationSourceFile = declaration.getSourceFile();
	return {
		filePath: declarationSourceFile.fileName,
		range: toRange(declarationSourceFile, declaration),
		name: nameIdentifier.text
	};
}

function resolveReferenceTarget(checker: ts.TypeChecker, expression: ts.Expression): ExtractedDeclarationRef | undefined {
	if (ts.isIdentifier(expression)) {
		return resolveDeclarationTarget(checker, expression);
	}
	if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
		return resolveDeclarationTarget(checker, expression.name);
	}
	return undefined;
}

/**
 * Walks a function/method body for `calls` and `instantiates` relations,
 * sharing a single traversal-order counter across both kinds so their
 * relative order within the body is preserved in edge metadata for later
 * sequence-diagram use.
 */
function collectBodyRelations(
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	body: ts.Node,
	from: { name: string; range: ExtractedRange }
): ExtractedRelation[] {
	const relations: ExtractedRelation[] = [];
	let order = 0;

	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			const target = resolveReferenceTarget(checker, node.expression);
			if (target) {
				relations.push({
					kind: 'calls',
					from,
					target,
					metadata: { line: toRange(sourceFile, node).startLine, order: order++ }
				});
			}
		} else if (ts.isNewExpression(node)) {
			const target = resolveReferenceTarget(checker, node.expression);
			if (target) {
				relations.push({
					kind: 'instantiates',
					from,
					target,
					metadata: { line: toRange(sourceFile, node).startLine, order: order++ }
				});
			}
		}
		ts.forEachChild(node, visit);
	};

	// `visit` itself (not just its children) must run against `body`: an arrow
	// function's concise body (`() => doWork()`) *is* the call expression, with
	// no enclosing statement for a plain forEachChild(body, ...) to recurse
	// through.
	visit(body);
	return relations;
}

function functionValueOf(node: ts.Node | undefined): ts.ArrowFunction | ts.FunctionExpression | undefined {
	if (node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))) {
		return node;
	}
	return undefined;
}

function collectHeritageRelations(
	checker: ts.TypeChecker,
	declaration: ts.ClassDeclaration | ts.InterfaceDeclaration,
	from: { name: string; range: ExtractedRange }
): ExtractedRelation[] {
	const relations: ExtractedRelation[] = [];
	for (const clause of declaration.heritageClauses ?? []) {
		const kind: ExtractedRelationKind = clause.token === ts.SyntaxKind.ImplementsKeyword ? 'implements' : 'extends';
		for (const type of clause.types) {
			const target = resolveReferenceTarget(checker, type.expression);
			if (target) {
				relations.push({ kind, from, target });
			}
		}
	}
	return relations;
}

function collectClassMembers(
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	classNode: ts.ClassDeclaration,
	className: string,
	classExported: boolean
): { members: ExtractedSymbol[]; relations: ExtractedRelation[] } {
	const members: ExtractedSymbol[] = [];
	const relations: ExtractedRelation[] = [];

	for (const member of classNode.members) {
		if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
			const range = toRange(sourceFile, member);
			members.push({
				kind: 'method',
				name: member.name.text,
				exported: classExported,
				range,
				parentName: className
			});
			if (member.body) {
				relations.push(...collectBodyRelations(sourceFile, checker, member.body, { name: member.name.text, range }));
			}
		} else if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
			const range = toRange(sourceFile, member);
			const functionValue = functionValueOf(member.initializer);
			if (functionValue) {
				members.push({ kind: 'method', name: member.name.text, exported: classExported, range, parentName: className });
				if (functionValue.body) {
					relations.push(...collectBodyRelations(sourceFile, checker, functionValue.body, { name: member.name.text, range }));
				}
				continue;
			}
			members.push({ kind: 'property', name: member.name.text, exported: classExported, range, parentName: className });
		}
	}

	return { members, relations };
}

function resolveImportedSymbols(checker: ts.TypeChecker, clause: ts.ImportClause | undefined): ExtractedDeclarationRef[] {
	if (!clause) {
		return [];
	}
	const resolved: ExtractedDeclarationRef[] = [];

	if (clause.name) {
		const target = resolveDeclarationTarget(checker, clause.name);
		if (target) {
			resolved.push(target);
		}
	}
	if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
		for (const element of clause.namedBindings.elements) {
			const target = resolveDeclarationTarget(checker, element.name);
			if (target) {
				resolved.push(target);
			}
		}
	}

	return resolved;
}

function extractImportClause(
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
	statement: ts.ImportDeclaration
): ExtractedImport | undefined {
	if (!ts.isStringLiteral(statement.moduleSpecifier)) {
		return undefined;
	}

	const importedNames: string[] = [];
	const clause = statement.importClause;

	if (clause) {
		if (clause.name) {
			importedNames.push('default');
		}
		if (clause.namedBindings) {
			if (ts.isNamespaceImport(clause.namedBindings)) {
				importedNames.push('*');
			} else if (ts.isNamedImports(clause.namedBindings)) {
				for (const element of clause.namedBindings.elements) {
					importedNames.push(element.name.text);
				}
			}
		}
	}

	return {
		moduleSpecifier: statement.moduleSpecifier.text,
		importedNames,
		resolvedSymbols: resolveImportedSymbols(checker, clause),
		isTypeOnly: clause?.isTypeOnly ?? false,
		isRequire: false,
		range: toRange(sourceFile, statement)
	};
}

interface ExportDeclarationResult {
	exports: ExtractedExport[];
	reExportModuleSpecifier?: string;
	resolvedSymbols: ExtractedDeclarationRef[];
}

function extractExportDeclaration(checker: ts.TypeChecker, statement: ts.ExportDeclaration): ExportDeclarationResult {
	const exports: ExtractedExport[] = [];
	const resolvedSymbols: ExtractedDeclarationRef[] = [];
	const moduleSpecifier =
		statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
			? statement.moduleSpecifier.text
			: undefined;

	if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
		for (const element of statement.exportClause.elements) {
			exports.push({ name: element.name.text, fromModule: moduleSpecifier });
			const target = resolveDeclarationTarget(checker, element.name);
			if (target) {
				resolvedSymbols.push(target);
			}
		}
	} else if (!statement.exportClause && moduleSpecifier) {
		exports.push({ name: '*', fromModule: moduleSpecifier });
	}

	return { exports, reExportModuleSpecifier: moduleSpecifier, resolvedSymbols };
}

function findRequireCalls(sourceFile: ts.SourceFile): ExtractedImport[] {
	const imports: ExtractedImport[] = [];

	const visit = (node: ts.Node): void => {
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === 'require' &&
			node.arguments.length === 1 &&
			ts.isStringLiteral(node.arguments[0])
		) {
			imports.push({
				moduleSpecifier: node.arguments[0].text,
				importedNames: [],
				resolvedSymbols: [],
				isTypeOnly: false,
				isRequire: true,
				range: toRange(sourceFile, node)
			});
		}
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return imports;
}

export function extractFile(program: ts.Program, sourceFile: ts.SourceFile): ExtractedFile {
	const checker = program.getTypeChecker();
	const exportedNames = getCheckedExportedNames(checker, sourceFile);
	const symbols: ExtractedSymbol[] = [];
	const imports: ExtractedImport[] = [];
	const exports: ExtractedExport[] = [];
	const relations: ExtractedRelation[] = [];

	for (const statement of sourceFile.statements) {
		if (ts.isFunctionDeclaration(statement) && statement.name) {
			const range = toRange(sourceFile, statement);
			symbols.push({
				kind: 'function',
				name: statement.name.text,
				exported: exportedNames.has(statement.name.text) || isExportedDeclaration(statement),
				range
			});
			if (statement.body) {
				relations.push(...collectBodyRelations(sourceFile, checker, statement.body, { name: statement.name.text, range }));
			}
		} else if (ts.isClassDeclaration(statement) && statement.name) {
			const exported = exportedNames.has(statement.name.text) || isExportedDeclaration(statement);
			const range = toRange(sourceFile, statement);
			symbols.push({
				kind: 'class',
				name: statement.name.text,
				exported,
				range
			});
			const { members, relations: memberRelations } = collectClassMembers(
				sourceFile,
				checker,
				statement,
				statement.name.text,
				exported
			);
			symbols.push(...members);
			relations.push(...memberRelations);
			relations.push(...collectHeritageRelations(checker, statement, { name: statement.name.text, range }));
		} else if (ts.isInterfaceDeclaration(statement)) {
			const range = toRange(sourceFile, statement);
			symbols.push({
				kind: 'interface',
				name: statement.name.text,
				exported: exportedNames.has(statement.name.text) || isExportedDeclaration(statement),
				range
			});
			relations.push(...collectHeritageRelations(checker, statement, { name: statement.name.text, range }));
		} else if (ts.isEnumDeclaration(statement)) {
			symbols.push({
				kind: 'enum',
				name: statement.name.text,
				exported: exportedNames.has(statement.name.text) || isExportedDeclaration(statement),
				range: toRange(sourceFile, statement)
			});
		} else if (ts.isTypeAliasDeclaration(statement)) {
			symbols.push({
				kind: 'typeAlias',
				name: statement.name.text,
				exported: exportedNames.has(statement.name.text) || isExportedDeclaration(statement),
				range: toRange(sourceFile, statement)
			});
		} else if (ts.isVariableStatement(statement)) {
			const exportedByModifier = isExportedDeclaration(statement);
			for (const declaration of statement.declarationList.declarations) {
				if (!ts.isIdentifier(declaration.name)) {
					continue;
				}
				const name = declaration.name.text;
				const exported = exportedNames.has(name) || exportedByModifier;
				const range = toRange(sourceFile, declaration);
				const functionValue = functionValueOf(declaration.initializer);
				if (functionValue) {
					symbols.push({ kind: 'function', name, exported, range });
					if (functionValue.body) {
						relations.push(...collectBodyRelations(sourceFile, checker, functionValue.body, { name, range }));
					}
					continue;
				}
				symbols.push({ kind: 'variable', name, exported, range });
			}
		} else if (ts.isImportDeclaration(statement)) {
			const imp = extractImportClause(sourceFile, checker, statement);
			if (imp) {
				imports.push(imp);
			}
		} else if (ts.isExportDeclaration(statement)) {
			const { exports: reExports, reExportModuleSpecifier, resolvedSymbols } = extractExportDeclaration(checker, statement);
			exports.push(...reExports);
			if (reExportModuleSpecifier) {
				imports.push({
					moduleSpecifier: reExportModuleSpecifier,
					importedNames: reExports.map((e) => e.name),
					resolvedSymbols,
					isTypeOnly: statement.isTypeOnly,
					isRequire: false,
					range: toRange(sourceFile, statement)
				});
			}
		} else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
			exports.push({ name: 'default' });
		}
	}

	imports.push(...findRequireCalls(sourceFile));

	return {
		filePath: sourceFile.fileName,
		language: isJavaScriptFile(sourceFile.fileName) ? 'javascript' : 'typescript',
		symbols,
		imports,
		exports,
		relations
	};
}

export function extractProgram(program: ts.Program, sourceFiles: ts.SourceFile[]): ExtractedFile[] {
	return sourceFiles.map((sourceFile) => extractFile(program, sourceFile));
}

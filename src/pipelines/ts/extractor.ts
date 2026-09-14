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

export interface ExtractedImport {
	moduleSpecifier: string;
	/** Names pulled in by this import: identifier names, 'default', or '*' for a namespace import. */
	importedNames: string[];
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

export interface ExtractedFile {
	filePath: string;
	language: 'typescript' | 'javascript';
	symbols: ExtractedSymbol[];
	imports: ExtractedImport[];
	exports: ExtractedExport[];
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
function getCheckedExportedNames(program: ts.Program, sourceFile: ts.SourceFile): Set<string> {
	const checker = program.getTypeChecker();
	const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
	if (!moduleSymbol) {
		return new Set();
	}
	return new Set(checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.name));
}

function collectClassMembers(
	sourceFile: ts.SourceFile,
	classNode: ts.ClassDeclaration,
	className: string,
	classExported: boolean
): ExtractedSymbol[] {
	const members: ExtractedSymbol[] = [];

	for (const member of classNode.members) {
		if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
			members.push({
				kind: 'method',
				name: member.name.text,
				exported: classExported,
				range: toRange(sourceFile, member),
				parentName: className
			});
		} else if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
			members.push({
				kind: 'property',
				name: member.name.text,
				exported: classExported,
				range: toRange(sourceFile, member),
				parentName: className
			});
		}
	}

	return members;
}

function extractImportClause(
	sourceFile: ts.SourceFile,
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
		isTypeOnly: clause?.isTypeOnly ?? false,
		isRequire: false,
		range: toRange(sourceFile, statement)
	};
}

interface ExportDeclarationResult {
	exports: ExtractedExport[];
	reExportModuleSpecifier?: string;
}

function extractExportDeclaration(statement: ts.ExportDeclaration): ExportDeclarationResult {
	const exports: ExtractedExport[] = [];
	const moduleSpecifier =
		statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
			? statement.moduleSpecifier.text
			: undefined;

	if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
		for (const element of statement.exportClause.elements) {
			exports.push({ name: element.name.text, fromModule: moduleSpecifier });
		}
	} else if (!statement.exportClause && moduleSpecifier) {
		exports.push({ name: '*', fromModule: moduleSpecifier });
	}

	return { exports, reExportModuleSpecifier: moduleSpecifier };
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
	const exportedNames = getCheckedExportedNames(program, sourceFile);
	const symbols: ExtractedSymbol[] = [];
	const imports: ExtractedImport[] = [];
	const exports: ExtractedExport[] = [];

	for (const statement of sourceFile.statements) {
		if (ts.isFunctionDeclaration(statement) && statement.name) {
			symbols.push({
				kind: 'function',
				name: statement.name.text,
				exported: exportedNames.has(statement.name.text) || isExportedDeclaration(statement),
				range: toRange(sourceFile, statement)
			});
		} else if (ts.isClassDeclaration(statement) && statement.name) {
			const exported = exportedNames.has(statement.name.text) || isExportedDeclaration(statement);
			symbols.push({
				kind: 'class',
				name: statement.name.text,
				exported,
				range: toRange(sourceFile, statement)
			});
			symbols.push(...collectClassMembers(sourceFile, statement, statement.name.text, exported));
		} else if (ts.isInterfaceDeclaration(statement)) {
			symbols.push({
				kind: 'interface',
				name: statement.name.text,
				exported: exportedNames.has(statement.name.text) || isExportedDeclaration(statement),
				range: toRange(sourceFile, statement)
			});
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
				if (ts.isIdentifier(declaration.name)) {
					symbols.push({
						kind: 'variable',
						name: declaration.name.text,
						exported: exportedNames.has(declaration.name.text) || exportedByModifier,
						range: toRange(sourceFile, declaration)
					});
				}
			}
		} else if (ts.isImportDeclaration(statement)) {
			const imp = extractImportClause(sourceFile, statement);
			if (imp) {
				imports.push(imp);
			}
		} else if (ts.isExportDeclaration(statement)) {
			const { exports: reExports, reExportModuleSpecifier } = extractExportDeclaration(statement);
			exports.push(...reExports);
			if (reExportModuleSpecifier) {
				imports.push({
					moduleSpecifier: reExportModuleSpecifier,
					importedNames: reExports.map((e) => e.name),
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
		exports
	};
}

export function extractProgram(program: ts.Program, sourceFiles: ts.SourceFile[]): ExtractedFile[] {
	return sourceFiles.map((sourceFile) => extractFile(program, sourceFile));
}

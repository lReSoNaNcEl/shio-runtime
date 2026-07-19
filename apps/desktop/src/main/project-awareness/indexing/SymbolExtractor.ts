import type { SyntaxNode } from '@lezer/common'
import { parser as pythonParser } from '@lezer/python'
import ts from 'typescript'

import type { ProjectLanguage } from '../../../shared/project-awareness'
import type { ExtractedChunk, ExtractedSource, ExtractedSymbol } from '../contracts'

const MAX_CHUNK_LINES = 220
const TARGET_CHUNK_LINES = 140
const MAX_CHUNK_CHARACTERS = 8_000

function scriptKind(language: ProjectLanguage): ts.ScriptKind {
  switch (language) {
    case 'typescriptreact':
      return ts.ScriptKind.TSX
    case 'javascriptreact':
      return ts.ScriptKind.JSX
    case 'javascript':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some(
          (modifier) =>
            modifier.kind === ts.SyntaxKind.ExportKeyword ||
            modifier.kind === ts.SyntaxKind.DefaultKeyword,
        ),
  )
}

function lineRange(source: ts.SourceFile, node: ts.Node): { startLine: number; endLine: number } {
  return {
    startLine: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
  }
}

function compactSignature(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 500)
}

function declarationSignature(source: ts.SourceFile, node: ts.Node): string | null {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node)
  ) {
    const bodyStart =
      'body' in node && node.body && ts.isBlock(node.body)
        ? node.body.getStart(source)
        : node.getEnd()
    return compactSignature(source.text.slice(node.getStart(source), bodyStart))
  }
  if (ts.isVariableDeclaration(node)) {
    return compactSignature(source.text.slice(node.getStart(source), node.getEnd()))
  }
  return null
}

function extractTypeScript(
  path: string,
  content: string,
  language: ProjectLanguage,
): ExtractedSource {
  const source = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(language),
  )
  const symbols: ExtractedSymbol[] = []
  const imports: string[] = []

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text)
      continue
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      symbols.push({
        name: statement.name.text,
        kind: 'function',
        exported: hasExportModifier(statement),
        ...lineRange(source, statement),
        signature: declarationSignature(source, statement),
      })
      continue
    }

    if (ts.isClassDeclaration(statement) && statement.name) {
      symbols.push({
        name: statement.name.text,
        kind: 'class',
        exported: hasExportModifier(statement),
        ...lineRange(source, statement),
        signature: declarationSignature(source, statement),
      })
      for (const member of statement.members) {
        if (!ts.isMethodDeclaration(member) || !member.name) continue
        const name = member.name.getText(source)
        symbols.push({
          name: `${statement.name.text}.${name}`,
          kind: 'method',
          exported: hasExportModifier(statement),
          ...lineRange(source, member),
          signature: declarationSignature(source, member),
        })
      }
      continue
    }

    if (ts.isInterfaceDeclaration(statement)) {
      symbols.push({
        name: statement.name.text,
        kind: 'interface',
        exported: hasExportModifier(statement),
        ...lineRange(source, statement),
        signature: declarationSignature(source, statement),
      })
      continue
    }

    if (ts.isTypeAliasDeclaration(statement)) {
      symbols.push({
        name: statement.name.text,
        kind: 'type',
        exported: hasExportModifier(statement),
        ...lineRange(source, statement),
        signature: declarationSignature(source, statement),
      })
      continue
    }

    if (ts.isVariableStatement(statement)) {
      const exported = hasExportModifier(statement)
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        const important = exported || /^[A-Z][A-Z0-9_]+$/.test(declaration.name.text)
        if (!important) continue
        symbols.push({
          name: declaration.name.text,
          kind: 'const',
          exported,
          ...lineRange(source, statement),
          signature: declarationSignature(source, declaration),
        })
      }
    }
  }

  return { symbols, imports, chunks: buildChunks(content, symbols) }
}

function directChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(child)
  return children
}

function pythonLineStarts(content: string): number[] {
  const starts = [0]
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) starts.push(index + 1)
  }
  return starts
}

function pythonLineAt(lineStarts: number[], offset: number): number {
  let low = 0
  let high = lineStarts.length
  while (low + 1 < high) {
    const middle = (low + high) >> 1
    if (lineStarts[middle] <= offset) low = middle
    else high = middle
  }
  return low + 1
}

function pythonDefinitionNode(statement: SyntaxNode): SyntaxNode | null {
  if (statement.name === 'ClassDefinition' || statement.name === 'FunctionDefinition') {
    return statement
  }
  if (statement.name === 'DecoratedStatement') {
    return statement.getChild('ClassDefinition') ?? statement.getChild('FunctionDefinition') ?? null
  }
  return null
}

function pythonDefinitionSymbol(
  definition: SyntaxNode,
  content: string,
  lineStarts: number[],
  owner?: string,
  startOffset = definition.from,
): ExtractedSymbol | null {
  const nameNode = definition.getChild('VariableName')
  if (!nameNode) return null
  const localName = content.slice(nameNode.from, nameNode.to)
  const body = definition.getChild('Body')
  const kind = definition.name === 'ClassDefinition' ? 'class' : owner ? 'method' : 'function'
  return {
    name: owner ? `${owner}.${localName}` : localName,
    kind,
    exported: !localName.startsWith('_'),
    startLine: pythonLineAt(lineStarts, startOffset),
    endLine: pythonLineAt(lineStarts, Math.max(definition.from, definition.to - 1)),
    signature: compactSignature(
      content.slice(definition.from, body?.from ?? definition.to).replace(/:\s*$/, ''),
    ),
  }
}

function pythonImportModules(statement: SyntaxNode, content: string): string[] {
  const children = directChildren(statement)
  const fromIndex = children.findIndex((child) => child.name === 'from')
  const importIndex = children.findIndex((child) => child.name === 'import')
  if (importIndex < 0) return []

  if (fromIndex >= 0 && fromIndex < importIndex) {
    const module = content
      .slice(children[fromIndex].to, children[importIndex].from)
      .replace(/\s+/g, '')
    return module ? [module] : []
  }

  const modules: string[] = []
  let module = ''
  let readingAlias = false
  for (const child of children.slice(importIndex + 1)) {
    if (child.name === ',') {
      if (module) modules.push(module)
      module = ''
      readingAlias = false
      continue
    }
    if (child.name === 'as') {
      readingAlias = true
      continue
    }
    if (!readingAlias && (child.name === 'VariableName' || child.name === '.')) {
      module += content.slice(child.from, child.to)
    }
  }
  if (module) modules.push(module)
  return modules
}

function pythonConstantSymbol(
  statement: SyntaxNode,
  content: string,
  lineStarts: number[],
): ExtractedSymbol | null {
  if (statement.name !== 'AssignStatement') return null
  const nameNode = statement.getChild('VariableName')
  if (!nameNode) return null
  const name = content.slice(nameNode.from, nameNode.to)
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return null
  return {
    name,
    kind: 'const',
    exported: true,
    startLine: pythonLineAt(lineStarts, statement.from),
    endLine: pythonLineAt(lineStarts, Math.max(statement.from, statement.to - 1)),
    signature: compactSignature(content.slice(statement.from, statement.to)),
  }
}

function extractPython(content: string): ExtractedSource {
  const tree = pythonParser.parse(content)
  const lineStarts = pythonLineStarts(content)
  const symbols: ExtractedSymbol[] = []
  const imports: string[] = []

  for (const statement of directChildren(tree.topNode)) {
    if (statement.type.isError) continue
    if (statement.name === 'ImportStatement') {
      imports.push(...pythonImportModules(statement, content))
      continue
    }

    const definition = pythonDefinitionNode(statement)
    if (definition) {
      const symbol = pythonDefinitionSymbol(
        definition,
        content,
        lineStarts,
        undefined,
        statement.from,
      )
      if (!symbol) continue
      symbols.push(symbol)
      if (symbol.kind !== 'class') continue
      const body = definition.getChild('Body')
      if (!body) continue
      for (const memberStatement of directChildren(body)) {
        const member = pythonDefinitionNode(memberStatement)
        if (member?.name !== 'FunctionDefinition') continue
        const method = pythonDefinitionSymbol(
          member,
          content,
          lineStarts,
          symbol.name,
          memberStatement.from,
        )
        if (method) symbols.push(method)
      }
      continue
    }

    const constant = pythonConstantSymbol(statement, content, lineStarts)
    if (constant) symbols.push(constant)
  }

  return { symbols, imports, chunks: buildChunks(content, symbols) }
}

function splitRangeIntoChunks(
  lines: string[],
  startLine: number,
  endLine: number,
  symbolName: string | null,
): ExtractedChunk[] {
  const chunks: ExtractedChunk[] = []
  let cursor = startLine
  while (cursor <= endLine) {
    let chunkEnd = Math.min(endLine, cursor + TARGET_CHUNK_LINES - 1)
    let text = lines.slice(cursor - 1, chunkEnd).join('\n')
    while (text.length > MAX_CHUNK_CHARACTERS && chunkEnd > cursor + 20) {
      chunkEnd -= 10
      text = lines.slice(cursor - 1, chunkEnd).join('\n')
    }
    chunks.push({ startLine: cursor, endLine: chunkEnd, symbolName, content: text })
    cursor = chunkEnd + 1
  }
  return chunks
}

function splitSymbolAtMethodBoundaries(
  lines: string[],
  symbol: ExtractedSymbol,
  methods: ExtractedSymbol[],
): ExtractedChunk[] {
  if (methods.length === 0) {
    return splitRangeIntoChunks(lines, symbol.startLine, symbol.endLine, symbol.name)
  }

  const starts = [
    symbol.startLine,
    ...methods
      .map((method) => method.startLine)
      .filter((startLine) => startLine > symbol.startLine && startLine <= symbol.endLine),
  ].sort((left, right) => left - right)
  const units = starts.map((startLine, index) => ({
    startLine,
    endLine: (starts[index + 1] ?? symbol.endLine + 1) - 1,
  }))
  const chunks: ExtractedChunk[] = []
  let pending: { startLine: number; endLine: number } | null = null

  const flush = (): void => {
    if (!pending) return
    chunks.push({
      ...pending,
      symbolName: symbol.name,
      content: lines.slice(pending.startLine - 1, pending.endLine).join('\n'),
    })
    pending = null
  }

  for (const unit of units) {
    const unitText = lines.slice(unit.startLine - 1, unit.endLine).join('\n')
    const unitLineCount = unit.endLine - unit.startLine + 1
    if (unitLineCount > MAX_CHUNK_LINES || unitText.length > MAX_CHUNK_CHARACTERS) {
      flush()
      chunks.push(...splitRangeIntoChunks(lines, unit.startLine, unit.endLine, symbol.name))
      continue
    }

    if (!pending) {
      pending = { ...unit }
      continue
    }
    const combinedText = lines.slice(pending.startLine - 1, unit.endLine).join('\n')
    const combinedLineCount = unit.endLine - pending.startLine + 1
    if (combinedLineCount <= MAX_CHUNK_LINES && combinedText.length <= MAX_CHUNK_CHARACTERS) {
      pending.endLine = unit.endLine
    } else {
      flush()
      pending = { ...unit }
    }
  }
  flush()
  return chunks
}

function buildChunks(content: string, symbols: ExtractedSymbol[]): ExtractedChunk[] {
  const lines = content.split(/\r?\n/)
  const chunks: ExtractedChunk[] = []
  const covered = new Uint8Array(lines.length + 1)
  const outerSymbols = symbols
    .filter((symbol) => symbol.kind !== 'method')
    .sort((left, right) => left.startLine - right.startLine)

  for (const symbol of outerSymbols) {
    const lineCount = symbol.endLine - symbol.startLine + 1
    const text = lines.slice(symbol.startLine - 1, symbol.endLine).join('\n')
    if (lineCount <= MAX_CHUNK_LINES && text.length <= MAX_CHUNK_CHARACTERS) {
      chunks.push({
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        symbolName: symbol.name,
        content: text,
      })
    } else {
      const methods = symbols.filter(
        (candidate) =>
          candidate.kind === 'method' &&
          candidate.startLine >= symbol.startLine &&
          candidate.endLine <= symbol.endLine,
      )
      chunks.push(...splitSymbolAtMethodBoundaries(lines, symbol, methods))
    }
    for (let line = symbol.startLine; line <= symbol.endLine; line += 1) covered[line] = 1
  }

  let cursor = 1
  while (cursor <= lines.length) {
    while (cursor <= lines.length && covered[cursor]) cursor += 1
    if (cursor > lines.length) break
    const start = cursor
    while (cursor <= lines.length && !covered[cursor]) cursor += 1
    chunks.push(...splitRangeIntoChunks(lines, start, cursor - 1, null))
  }

  return chunks
    .filter((chunk) => chunk.content.trim())
    .sort((left, right) => left.startLine - right.startLine)
}

export function extractSource(
  path: string,
  language: ProjectLanguage,
  content: string,
): ExtractedSource {
  if (
    language === 'typescript' ||
    language === 'typescriptreact' ||
    language === 'javascript' ||
    language === 'javascriptreact'
  ) {
    return extractTypeScript(path, content, language)
  }
  if (language === 'python') return extractPython(content)
  return { symbols: [], imports: [], chunks: buildChunks(content, []) }
}

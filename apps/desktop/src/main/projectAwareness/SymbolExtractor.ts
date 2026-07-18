import ts from 'typescript'

import type { ProjectLanguage } from '../../shared/projectAwareness'
import type { ExtractedChunk, ExtractedSource, ExtractedSymbol } from './contracts'

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

function pythonIndent(line: string): number {
  return line.match(/^\s*/)?.[0].replace(/\t/g, '    ').length ?? 0
}

function extractPython(content: string): ExtractedSource {
  const lines = content.split(/\r?\n/)
  const candidates: Array<
    Omit<ExtractedSymbol, 'endLine' | 'signature'> & { indent: number; signature: string }
  > = []
  const imports: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    const indent = pythonIndent(line)
    const importMatch = trimmed.match(/^(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([^#]+))/)
    if (importMatch) {
      imports.push(
        ...(importMatch[1] ? [importMatch[1]] : (importMatch[2] ?? '').split(','))
          .map((item) => item.trim().split(/\s+as\s+/)[0])
          .filter(Boolean),
      )
    }
    const classMatch = trimmed.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/)
    const functionMatch = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\b/)
    const constMatch = indent === 0 ? trimmed.match(/^([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=/) : null
    const name = classMatch?.[1] ?? functionMatch?.[1] ?? constMatch?.[1]
    if (!name) continue
    candidates.push({
      name,
      kind: classMatch ? 'class' : functionMatch ? (indent ? 'method' : 'function') : 'const',
      exported: !name.startsWith('_'),
      startLine: index + 1,
      indent,
      signature: compactSignature(trimmed.replace(/:\s*$/, '')),
    })
  }

  const symbols = candidates.map((candidate) => {
    let endLine = lines.length
    for (let index = candidate.startLine; index < lines.length; index += 1) {
      const line = lines[index]
      if (!line.trim() || line.trimStart().startsWith('#')) continue
      if (pythonIndent(line) <= candidate.indent) {
        endLine = index
        break
      }
    }
    const { indent: _indent, ...symbol } = candidate
    return { ...symbol, endLine }
  })

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
      chunks.push(...splitRangeIntoChunks(lines, symbol.startLine, symbol.endLine, symbol.name))
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

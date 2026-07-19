import { type ParserPlugin, parse } from '@babel/parser'

import type { ProjectLanguage } from '../../../shared/project-awareness'
import type { ExtractedSymbol } from '../contracts'

export interface ExtractedTypeScriptStructure {
  symbols: ExtractedSymbol[]
  imports: string[]
}

type BabelFile = ReturnType<typeof parse>
type BabelStatement = BabelFile['program']['body'][number]
type BabelNode = {
  start?: number | null
  end?: number | null
}

function parserPlugins(language: ProjectLanguage): ParserPlugin[] {
  const plugins: ParserPlugin[] = ['decorators-legacy']
  if (language === 'typescript' || language === 'typescriptreact') plugins.push('typescript')
  if (language === 'typescriptreact' || language === 'javascriptreact') plugins.push('jsx')
  return plugins
}

function parseProgram(language: ProjectLanguage, content: string): BabelFile | null {
  try {
    return parse(content, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      attachComment: false,
      createImportExpressions: true,
      plugins: parserPlugins(language),
    })
  } catch {
    return null
  }
}

function nodeStart(node: BabelNode): number {
  return node.start ?? 0
}

function nodeEnd(node: BabelNode): number {
  return node.end ?? nodeStart(node)
}

function lineStarts(content: string): number[] {
  const starts = [0]
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) starts.push(index + 1)
  }
  return starts
}

function lineAt(starts: number[], offset: number): number {
  let low = 0
  let high = starts.length
  while (low + 1 < high) {
    const middle = (low + high) >> 1
    if (starts[middle] <= offset) low = middle
    else high = middle
  }
  return low + 1
}

function lineRange(starts: number[], node: BabelNode): { startLine: number; endLine: number } {
  return {
    startLine: lineAt(starts, nodeStart(node)),
    endLine: lineAt(starts, nodeEnd(node)),
  }
}

function compactSignature(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 500)
}

function declarationOf(statement: BabelStatement): {
  declaration: BabelStatement | null
  exported: boolean
} {
  if (statement.type === 'ExportNamedDeclaration') {
    return {
      declaration: statement.declaration as BabelStatement | null,
      exported: true,
    }
  }
  if (statement.type === 'ExportDefaultDeclaration') {
    return {
      declaration: statement.declaration as BabelStatement,
      exported: true,
    }
  }
  return { declaration: statement, exported: false }
}

function methodName(
  content: string,
  method: BabelNode & {
    key: BabelNode
    computed?: boolean
  },
): string {
  const start = nodeStart(method.key)
  const end = nodeEnd(method.key)
  return method.computed
    ? content.slice(Math.max(0, start - 1), end + 1)
    : content.slice(start, end)
}

function classMethods(
  content: string,
  starts: number[],
  declaration: Extract<BabelStatement, { type: 'ClassDeclaration' }>,
  className: string,
  exported: boolean,
): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = []
  for (const member of declaration.body.body) {
    if (
      member.type !== 'ClassMethod' &&
      member.type !== 'ClassPrivateMethod' &&
      member.type !== 'TSDeclareMethod'
    ) {
      continue
    }
    if (member.kind === 'constructor' || member.kind === 'get' || member.kind === 'set') continue

    const body = 'body' in member ? member.body : null
    symbols.push({
      name: `${className}.${methodName(content, member)}`,
      kind: 'method',
      exported,
      ...lineRange(starts, member),
      signature: compactSignature(
        content.slice(nodeStart(member), body ? nodeStart(body) : nodeEnd(member)),
      ),
    })
  }
  return symbols
}

function declarationSymbols(
  content: string,
  starts: number[],
  statement: BabelStatement,
): ExtractedSymbol[] {
  const { declaration, exported } = declarationOf(statement)
  if (!declaration) return []
  const statementRange = lineRange(starts, statement)

  if (declaration.type === 'FunctionDeclaration' || declaration.type === 'TSDeclareFunction') {
    if (!declaration.id) return []
    const body = 'body' in declaration ? declaration.body : null
    return [
      {
        name: declaration.id.name,
        kind: 'function',
        exported,
        ...statementRange,
        signature: compactSignature(
          content.slice(nodeStart(statement), body ? nodeStart(body) : nodeEnd(statement)),
        ),
      },
    ]
  }

  if (declaration.type === 'ClassDeclaration') {
    if (!declaration.id) return []
    const className = declaration.id.name
    return [
      {
        name: className,
        kind: 'class',
        exported,
        ...statementRange,
        signature: compactSignature(content.slice(nodeStart(statement), nodeEnd(statement))),
      },
      ...classMethods(content, starts, declaration, className, exported),
    ]
  }

  if (declaration.type === 'TSInterfaceDeclaration') {
    return [
      {
        name: declaration.id.name,
        kind: 'interface',
        exported,
        ...statementRange,
        signature: compactSignature(content.slice(nodeStart(statement), nodeEnd(statement))),
      },
    ]
  }

  if (declaration.type === 'TSTypeAliasDeclaration') {
    return [
      {
        name: declaration.id.name,
        kind: 'type',
        exported,
        ...statementRange,
        signature: compactSignature(content.slice(nodeStart(statement), nodeEnd(statement))),
      },
    ]
  }

  if (declaration.type !== 'VariableDeclaration') return []
  const symbols: ExtractedSymbol[] = []
  for (const variable of declaration.declarations) {
    if (variable.id.type !== 'Identifier') continue
    if (!exported && !/^[A-Z][A-Z0-9_]+$/.test(variable.id.name)) continue
    symbols.push({
      name: variable.id.name,
      kind: 'const',
      exported,
      ...statementRange,
      signature: compactSignature(content.slice(nodeStart(variable), nodeEnd(variable))),
    })
  }
  return symbols
}

export function extractTypeScriptStructure(
  language: ProjectLanguage,
  content: string,
): ExtractedTypeScriptStructure {
  const file = parseProgram(language, content)
  if (!file) return { symbols: [], imports: [] }

  const starts = lineStarts(content)
  const symbols: ExtractedSymbol[] = []
  const imports: string[] = []
  for (const statement of file.program.body) {
    if (statement.type === 'ImportDeclaration') {
      imports.push(statement.source.value)
      continue
    }
    symbols.push(...declarationSymbols(content, starts, statement))
  }
  return { symbols, imports }
}

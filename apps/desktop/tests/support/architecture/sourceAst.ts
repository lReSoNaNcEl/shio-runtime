import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, normalize, relative, resolve } from 'node:path'

import { parse } from '@babel/parser'

export interface AstNode {
  type?: string
  source?: { value?: unknown }
  callee?: AstNode
  property?: AstNode
  name?: string
  value?: unknown
  [key: string]: unknown
}

export function sourceFilesBelow(root: string): string[] {
  const pending = [root]
  const files: string[] = []
  while (pending.length > 0) {
    const directory = pending.pop()
    if (!directory) throw new Error(`Missing pending directory below ${root}`)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (['.ts', '.tsx'].includes(extname(entry.name))) files.push(path)
    }
  }
  return files.sort()
}

export function parseFile(path: string): AstNode {
  return parse(readFileSync(path, 'utf8'), {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  }) as unknown as AstNode
}

export function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
    return
  }
  const astNode = node as AstNode
  if (typeof astNode.type === 'string') visit(astNode)
  for (const [key, child] of Object.entries(astNode)) {
    if (['loc', 'start', 'end', 'extra'].includes(key)) continue
    walk(child, visit)
  }
}

export function importedSource(node: AstNode): string | null {
  if (
    !['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(
      node.type ?? '',
    )
  ) {
    return null
  }
  return typeof node.source?.value === 'string' ? node.source.value : null
}

export function resolvedImport(fromFile: string, specifier: string): string | null {
  return specifier.startsWith('.') ? normalize(resolve(dirname(fromFile), specifier)) : null
}

export function isBelow(path: string, root: string): boolean {
  const pathFromRoot = relative(root, path)
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
}

export function memberName(node: AstNode | undefined): string | null {
  if (!node) return null
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return node.name ?? null
  if (node.type === 'StringLiteral') return typeof node.value === 'string' ? node.value : null
  return null
}

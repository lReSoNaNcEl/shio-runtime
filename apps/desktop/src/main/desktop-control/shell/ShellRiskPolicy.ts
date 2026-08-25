export const SHELL_RISK_CLASSES = ['read-only', 'mutating', 'destructive', 'unknown'] as const

export type ShellRiskClass = (typeof SHELL_RISK_CLASSES)[number]

export interface ShellRiskAssessment {
  classification: ShellRiskClass
  effectiveRisk: 'normal' | 'destructive'
  commands: readonly string[]
  reason: string
}

const READ_ONLY_COMMANDS = new Set([
  'compare-object',
  'convertfrom-json',
  'convertfrom-stringdata',
  'convertto-csv',
  'convertto-html',
  'convertto-json',
  'format-list',
  'format-table',
  'get-alias',
  'get-childitem',
  'get-command',
  'get-computerinfo',
  'get-content',
  'get-culture',
  'get-date',
  'get-item',
  'get-itemproperty',
  'get-location',
  'get-member',
  'get-process',
  'get-random',
  'get-service',
  'get-variable',
  'get-wmiobject',
  'measure-command',
  'measure-object',
  'resolve-path',
  'select-object',
  'sort-object',
  'split-path',
  'test-connection',
  'test-path',
  'where-object',
])

const MUTATING_COMMANDS = new Set([
  'add-content',
  'copy-item',
  'export-csv',
  'move-item',
  'new-item',
  'out-file',
  'rename-item',
  'set-acl',
  'set-content',
  'set-item',
  'set-itemproperty',
  'set-location',
  'start-process',
  'start-service',
])

const DESTRUCTIVE_COMMANDS = new Set([
  'clear-content',
  'clear-item',
  'clear-itemproperty',
  'disable-computerrestore',
  'format-volume',
  'remove-item',
  'remove-itemproperty',
  'restart-computer',
  'stop-computer',
  'stop-process',
  'stop-service',
])

const SAFE_EXTERNAL_COMMANDS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  git: new Set(['branch', 'diff', 'log', 'merge-base', 'rev-parse', 'show', 'status']),
  node: new Set(['--version', '-v']),
  npm: new Set(['--version', '-v', 'view']),
  pnpm: new Set(['--version', '-v']),
  pwsh: new Set(['--version', '-v']),
  rg: new Set<string>(),
  tsc: new Set(['--version', '-v']),
  yarn: new Set(['--version', '-v']),
})

interface ParsedInvocation {
  command: string
  arguments: readonly string[]
}

/**
 * Main-owned deterministic policy. It tokenizes PowerShell structure and classifies exact
 * command identities; it never infers risk from natural-language descriptions.
 */
export class ShellRiskPolicy {
  classify(command: string): ShellRiskAssessment {
    const parsed = parseInvocations(command)
    if (!parsed.ok) return assessment('unknown', [], parsed.reason)
    const commands = parsed.invocations.map((item) => item.command)
    let classification: ShellRiskClass = 'read-only'
    for (const invocation of parsed.invocations) {
      classification = maximumRisk(classification, classifyInvocation(invocation))
    }
    if (parsed.hasWriteRedirection) classification = maximumRisk(classification, 'mutating')
    return assessment(classification, commands, `parsed_${classification}`)
  }
}

function assessment(
  classification: ShellRiskClass,
  commands: readonly string[],
  reason: string,
): ShellRiskAssessment {
  return Object.freeze({
    classification,
    effectiveRisk:
      classification === 'destructive' || classification === 'unknown' ? 'destructive' : 'normal',
    commands: Object.freeze([...commands]),
    reason,
  })
}

function maximumRisk(left: ShellRiskClass, right: ShellRiskClass): ShellRiskClass {
  const order: Record<ShellRiskClass, number> = {
    'read-only': 0,
    mutating: 1,
    destructive: 2,
    unknown: 3,
  }
  return order[right] > order[left] ? right : left
}

function classifyInvocation(invocation: ParsedInvocation): ShellRiskClass {
  const command = invocation.command.toLocaleLowerCase()
  if (DESTRUCTIVE_COMMANDS.has(command)) return 'destructive'
  if (MUTATING_COMMANDS.has(command)) return 'mutating'
  if (READ_ONLY_COMMANDS.has(command)) return 'read-only'
  const safeArguments = SAFE_EXTERNAL_COMMANDS[command]
  if (!safeArguments) return 'unknown'
  if (safeArguments.size === 0) return 'read-only'
  const firstArgument = invocation.arguments[0]?.toLocaleLowerCase()
  return firstArgument && safeArguments.has(firstArgument) ? 'read-only' : 'unknown'
}

function parseInvocations(command: string):
  | {
      ok: true
      invocations: readonly ParsedInvocation[]
      hasWriteRedirection: boolean
    }
  | { ok: false; reason: string } {
  const source = command.trim()
  if (!source) return { ok: false, reason: 'empty_command' }
  const statements: string[][] = [[]]
  let token = ''
  let quote: 'single' | 'double' | null = null
  let escaped = false
  let hasWriteRedirection = false
  const pushToken = (): void => {
    if (!token) return
    statements.at(-1)?.push(token)
    token = ''
  }
  const pushStatement = (): void => {
    pushToken()
    if ((statements.at(-1)?.length ?? 0) > 0) statements.push([])
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (escaped) {
      token += character
      escaped = false
      continue
    }
    if (character === '`') {
      escaped = true
      continue
    }
    if (quote) {
      if ((quote === 'single' && character === "'") || (quote === 'double' && character === '"')) {
        quote = null
      } else {
        token += character
      }
      continue
    }
    if (character === "'") {
      quote = 'single'
      continue
    }
    if (character === '"') {
      quote = 'double'
      continue
    }
    if (character === '&' && source[index + 1] !== '&') {
      return { ok: false, reason: 'dynamic_invocation' }
    }
    if (character === '.' && !token && /\s/u.test(source[index + 1] ?? '')) {
      return { ok: false, reason: 'dot_sourcing' }
    }
    if (character === '>' || (/[1-6]/u.test(character) && source[index + 1] === '>')) {
      hasWriteRedirection = true
      pushToken()
      if (source[index + 1] === '>') index += 1
      continue
    }
    if (character === '|' || character === ';' || character === '\n' || character === '\r') {
      pushStatement()
      continue
    }
    if (/\s/u.test(character)) {
      pushToken()
      continue
    }
    if ('{}()$'.includes(character)) return { ok: false, reason: 'dynamic_expression' }
    token += character
  }
  if (quote || escaped) return { ok: false, reason: 'incomplete_syntax' }
  pushToken()
  const invocations = statements
    .filter((tokens) => tokens.length > 0)
    .map(([invoked, ...args]) => ({
      command: invoked.replace(/\.exe$/iu, ''),
      arguments: Object.freeze(args),
    }))
  if (invocations.length === 0) return { ok: false, reason: 'no_invocation' }
  return { ok: true, invocations: Object.freeze(invocations), hasWriteRedirection }
}

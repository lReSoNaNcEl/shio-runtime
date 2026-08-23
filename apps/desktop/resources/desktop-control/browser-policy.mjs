const DEFAULT_MAX_OUTPUT_CHARS = 20_000
const BLOCKED_COMMON_ARGUMENTS = [
  'extraArgs',
  'idleTimeout',
  'namespace',
  'restore',
  'restoreCheckFn',
  'restoreCheckText',
  'restoreCheckUrl',
  'restoreSave',
  'session',
]

function boundedText(text, limit) {
  if (text.length <= limit) return text
  const suffix = `\n[output truncated at ${limit} characters]`
  const end = Math.max(0, limit - suffix.length)
  let body = text.slice(0, end)
  const last = body.charCodeAt(body.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) body = body.slice(0, -1)
  return `${body}${suffix}`
}

function boundaryMetadata(value) {
  const structured = value?.structuredContent
  const response = structured?.response
  const boundary = response?._boundary
  if (!boundary || typeof boundary !== 'object') return undefined
  if (typeof boundary.nonce !== 'string' || !/^[a-f0-9]{32}$/i.test(boundary.nonce)) {
    return undefined
  }
  if (typeof boundary.origin !== 'string') return undefined
  return {
    nonce: boundary.nonce,
    origin: boundary.origin.replace(/[\r\n]/g, ' ').slice(0, 1_024),
  }
}

function boundedContent(content, limit) {
  let remaining = limit
  return content.map((block) => {
    if (block.type !== 'text') return block
    const text = boundedText(block.text, remaining)
    remaining = Math.max(0, remaining - text.length)
    return { ...block, text }
  })
}

function boundaryContent(content, boundary, limit) {
  const prefix = `--- AGENT_BROWSER_PAGE_CONTENT nonce=${boundary.nonce} origin=${boundary.origin} ---\n`
  const suffix = `\n--- END_AGENT_BROWSER_PAGE_CONTENT nonce=${boundary.nonce} ---`
  const text = content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  const wrapped = `${prefix}${boundedText(text, Math.max(0, limit - prefix.length - suffix.length))}${suffix}`
  const firstText = content.findIndex((block) => block.type === 'text')
  if (firstText < 0) return content
  return content.flatMap((block, index) => {
    if (block.type !== 'text') return [block]
    return index === firstText ? [{ ...block, text: wrapped }] : []
  })
}

export default function BrowserToolPolicy(ctx, config = {}) {
  const serverName = config.serverName ?? 'agent-browser'
  const toolPrefix = `mcp__${serverName}__`
  const maxOutputChars = config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS
  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars < 1_000 || maxOutputChars > 100_000) {
    throw new TypeError('browser policy maxOutputChars must be an integer from 1000 to 100000')
  }

  ctx.on(
    'tools/pre-execute',
    (exec, next) => {
      if (!exec.name.startsWith(toolPrefix)) return next()
      for (const name of BLOCKED_COMMON_ARGUMENTS) {
        if (Object.hasOwn(exec.arguments, name)) {
          return {
            kind: 'deny',
            reason: `browser tool argument ${name} is owned by Shio Main`,
          }
        }
      }
      return next()
    },
    { prepend: true },
  )

  ctx.on(
    'tools/post-execute',
    async (exec, result, next) => {
      const decision = await next()
      if (!exec.name.startsWith(toolPrefix) || decision.kind === 'block') return decision
      const content = decision.content ?? result.content
      if (result.isError) {
        return { ...decision, content: boundedContent(content, maxOutputChars) }
      }
      if (exec.name.endsWith('__agent_browser_tools_profiles')) {
        return { ...decision, content: boundedContent(content, maxOutputChars) }
      }
      const boundary = boundaryMetadata(result.value)
      if (!boundary) {
        return {
          kind: 'block',
          feedback: [
            {
              type: 'text',
              text: 'Browser output was blocked because trusted content-boundary metadata was missing.',
            },
          ],
        }
      }
      return {
        ...decision,
        content: boundaryContent(content, boundary, maxOutputChars),
      }
    },
    { prepend: true },
  )
}

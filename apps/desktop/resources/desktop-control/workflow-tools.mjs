import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import PwshLocal from '@deepseek-ai/dsh-pwsh-local'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import * as ToolPwsh from '@deepseek-ai/dsh-tool-pwsh'

import BrowserToolPolicy from './browser-policy.mjs'

function requiredEnvironment(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Desktop Control requires ${name}`)
  return value
}

/** Mount exactly one Main-authorized tool family for this DSH child process. */
async function WorkflowTools(ctx) {
  const capability = requiredEnvironment('SHIO_DSH_ALLOWED_CAPABILITY')
  if (capability === 'browser') {
    await ctx.plugin(BrowserToolPolicy, {
      serverName: 'agent-browser',
      maxOutputChars: 20_000,
    })
    await ctx.plugin(McpClient, {
      serverName: 'agent-browser',
      transport: 'stdio',
      command: requiredEnvironment('SHIO_AGENT_BROWSER_COMMAND'),
      args: ['mcp', '--tools', 'core'],
      cwd: requiredEnvironment('DSH_CWD'),
      env: {
        AGENT_BROWSER_PROFILE: requiredEnvironment('SHIO_AGENT_BROWSER_PROFILE'),
        AGENT_BROWSER_SOCKET_DIR: requiredEnvironment('SHIO_AGENT_BROWSER_SOCKET_DIR'),
        AGENT_BROWSER_NAMESPACE: requiredEnvironment('SHIO_AGENT_BROWSER_NAMESPACE'),
        AGENT_BROWSER_SESSION: requiredEnvironment('SHIO_AGENT_BROWSER_SESSION'),
        AGENT_BROWSER_CONTENT_BOUNDARIES: '1',
        AGENT_BROWSER_MAX_OUTPUT: '20000',
        AGENT_BROWSER_IDLE_TIMEOUT_MS: '60000',
        AGENT_BROWSER_HEADED: '1',
        ...(process.env.SHIO_AGENT_BROWSER_EXECUTABLE_PATH
          ? {
              AGENT_BROWSER_EXECUTABLE_PATH: process.env.SHIO_AGENT_BROWSER_EXECUTABLE_PATH,
            }
          : {}),
      },
      toolCallTimeoutMs: 45_000,
      failOnStartupError: true,
      reconnect: {
        enabled: true,
        initialDelayMs: 500,
        maxDelayMs: 5_000,
        maxAttempts: 3,
      },
    })
    return
  }

  if (capability === 'shell') {
    await ctx.plugin(LocalSubprocess)
    await ctx.plugin(PwshLocal, {
      cwd: requiredEnvironment('DSH_CWD'),
      pwshPath: requiredEnvironment('SHIO_PWSH_COMMAND'),
      timeoutMs: 60_000,
      maxTimeoutMs: 120_000,
      maxOutputBytes: 64_000,
      maxSpillBytes: 1_048_576,
      graceMs: 3_000,
    })
    await ctx.plugin(ShellEnv, { dshHome: requiredEnvironment('DSH_HOME') })
    await ctx.plugin(ToolPwsh, { enableRunInBackground: false })
    if (!ctx.tools.get('pwsh')) {
      throw new Error(
        `PowerShell tool did not register (shell=${Boolean(ctx.get('shell'))}, shellEnv=${Boolean(ctx.get('shellEnv'))})`,
      )
    }
    return
  }

  throw new Error(`Unsupported Desktop Control capability: ${capability}`)
}

WorkflowTools.inject = ['tools']

export default WorkflowTools

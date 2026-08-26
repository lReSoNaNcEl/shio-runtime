import PwshLocal from '@deepseek-ai/dsh-pwsh-local'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import * as ToolPwsh from '@deepseek-ai/dsh-tool-pwsh'

function requiredEnvironment(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Desktop Control requires ${name}`)
  return value
}

/** Mount exactly one Main-authorized tool family for this DSH child process. */
async function WorkflowTools(ctx) {
  const capability = requiredEnvironment('SHIO_DSH_ALLOWED_CAPABILITY')
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

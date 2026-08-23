import type { Context } from '@deepseek-ai/cordis'

export interface BrowserToolPolicyConfig {
  serverName?: string
  maxOutputChars?: number
}

export default function BrowserToolPolicy(context: Context, config?: BrowserToolPolicyConfig): void

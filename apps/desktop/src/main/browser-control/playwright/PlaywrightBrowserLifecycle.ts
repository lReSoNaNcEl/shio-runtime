import { mkdir } from 'node:fs/promises'

import { type BrowserContext, chromium } from 'playwright-core'

import { BrowserAutomationError } from '../errors'
import type { PlaywrightBrowserAdapterOptions } from './PlaywrightBrowserAdapter'

export async function launchOwnedBrowserContext(
  options: PlaywrightBrowserAdapterOptions,
): Promise<BrowserContext> {
  if (!options.executablePath) throw new BrowserAutomationError('BROWSER_UNAVAILABLE')
  await mkdir(options.profileDirectory, { recursive: true })
  const launch = options.launchPersistentContext ?? chromium.launchPersistentContext.bind(chromium)
  const context = await launch(options.profileDirectory, {
    executablePath: options.executablePath,
    headless: false,
    chromiumSandbox: true,
    acceptDownloads: false,
    viewport: null,
    args: ['--deny-permission-prompts'],
  })
  context.setDefaultTimeout(15_000)
  context.setDefaultNavigationTimeout(30_000)
  return context
}

export async function closeOwnedBrowserContext(context: BrowserContext | null): Promise<void> {
  if (context) await context.close()
}

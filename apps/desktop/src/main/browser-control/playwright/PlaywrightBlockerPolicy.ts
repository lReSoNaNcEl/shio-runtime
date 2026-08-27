import type { Page } from 'playwright-core'

import type { BrowserComputerUseBlocker } from '../../../shared/browser-computer-use'

export async function detectPlaywrightBlocker(
  page: Page,
): Promise<BrowserComputerUseBlocker | undefined> {
  const visible = async (selector: string): Promise<boolean> => {
    const locator = page.locator(selector)
    return (
      (await locator.count()) > 0 &&
      (await locator
        .first()
        .isVisible()
        .catch(() => false))
    )
  }
  if (
    await visible(
      'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],.g-recaptcha,.h-captcha,.cf-turnstile',
    )
  ) {
    return 'captcha'
  }
  if (await visible('input[autocomplete="one-time-code"]')) return 'two-factor'
  if (await visible('input[autocomplete="cc-number"],input[autocomplete="cc-csc"]')) {
    return 'payment-confirmation'
  }
  if (
    await visible(
      '[data-password-manager-dialog],[aria-label*="password manager" i],[aria-label*="менеджер паролей" i]',
    )
  ) {
    return 'password-manager'
  }
  if (await visible('[data-shio-secure-desktop-blocker]')) return 'secure-desktop'
  if (
    await visible(
      'input[type="password"],input[autocomplete="current-password"],input[autocomplete="new-password"]',
    )
  ) {
    return 'authentication'
  }
  return undefined
}

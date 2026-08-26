export type BrowserAutomationErrorCode =
  | 'NO_ACTIVE_SESSION'
  | 'SESSION_CLOSED'
  | 'OBSERVATION_FAILED'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_AMBIGUOUS'
  | 'TARGET_STALE'
  | 'CLICK_FAILED'
  | 'INPUT_FAILED'
  | 'NAVIGATION_FAILED'
  | 'VERIFICATION_FAILED'
  | 'BROWSER_UNAVAILABLE'
  | 'COMPUTER_USE_UNAVAILABLE'
  | 'COMPUTER_USE_LIMIT_REACHED'
  | 'COMPUTER_USE_BLOCKED'

const PUBLIC_MESSAGES: Record<BrowserAutomationErrorCode, string> = {
  NO_ACTIVE_SESSION: 'There is no active browser session',
  SESSION_CLOSED: 'The browser session is closed',
  OBSERVATION_FAILED: 'The current browser page could not be read',
  TARGET_NOT_FOUND: 'The requested element is not visible on the current page',
  TARGET_AMBIGUOUS: 'More than one matching element is visible on the current page',
  TARGET_STALE: 'The page changed before the requested element could be used',
  CLICK_FAILED: 'The browser element could not be clicked',
  INPUT_FAILED: 'The browser field could not be changed',
  NAVIGATION_FAILED: 'The browser could not open the requested page',
  VERIFICATION_FAILED: 'The browser action could not be verified',
  BROWSER_UNAVAILABLE: 'Browser Control is unavailable',
  COMPUTER_USE_UNAVAILABLE: 'Visual browser control is unavailable',
  COMPUTER_USE_LIMIT_REACHED: 'The bounded browser control session reached its limit',
  COMPUTER_USE_BLOCKED: 'Browser control requires user intervention',
}

export class BrowserAutomationError extends Error {
  constructor(
    readonly code: BrowserAutomationErrorCode,
    message = PUBLIC_MESSAGES[code],
    readonly recoverable = true,
  ) {
    super(message)
    this.name = 'BrowserAutomationError'
  }
}

export function browserAutomationMessage(code: BrowserAutomationErrorCode): string {
  return PUBLIC_MESSAGES[code]
}

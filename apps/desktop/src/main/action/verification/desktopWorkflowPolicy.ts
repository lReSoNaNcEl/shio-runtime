import type { DesktopWorkflowRequest } from '../../../shared/actions'
import type { ToolVerificationPolicy } from './contracts'

export function desktopWorkflowVerificationPolicy(
  request: DesktopWorkflowRequest,
): ToolVerificationPolicy {
  if (request.requestedCapabilities[0] === 'shell') {
    return {
      mode: 'execution-evidence',
      verifier: 'shell-execution',
      timeoutMs: 2_000,
      retrySafety: request.risk === 'destructive' ? 'never-auto' : 'safe',
    }
  }
  if (request.browserOperation?.operation === 'open' || request.browserUrl) {
    return {
      mode: 'post-state',
      verifier: 'browser-navigation',
      timeoutMs: 15_000,
      retrySafety: 'safe',
    }
  }
  if (request.browserOperation?.operation === 'switch-tab') {
    return {
      mode: 'post-state',
      verifier: 'browser-active-tab',
      timeoutMs: 15_000,
      retrySafety: 'safe',
    }
  }
  return {
    mode: 'post-state',
    verifier: 'browser-interaction',
    timeoutMs: 15_000,
    retrySafety: 'requires-replan',
  }
}

export function safeDesktopWorkflowRecovery(
  request: DesktopWorkflowRequest,
): { name: 'desktop.workflow'; payload: DesktopWorkflowRequest } | undefined {
  if (
    request.requestedCapabilities.length !== 1 ||
    request.requestedCapabilities[0] !== 'browser'
  ) {
    return undefined
  }
  if (request.browserOperation?.operation !== 'open' && !request.browserUrl) return undefined
  return { name: 'desktop.workflow', payload: request }
}

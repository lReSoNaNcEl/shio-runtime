import type { DesktopWorkflowRequest } from '../../../shared/actions'
import type {
  BrowserObservation,
  BrowserOperation,
  BrowserSemanticRiskClass,
  BrowserTarget,
} from '../../../shared/desktop-control'

const DESTRUCTIVE_TARGET =
  /(?:delete|destroy|erase|remove|wipe|unsubscribe|terminate|удал|стер|уничтож|отпис)/iu
const FINANCIAL_TARGET =
  /(?:buy|purchase|pay|checkout|order|bid|transfer|withdraw|deposit|оплат|куп|заказ|перевод|вывод|пополн)/iu
const ACCOUNT_TARGET =
  /(?:password|passcode|security|two.factor|2fa|account|profile|login|sign.in|sign.out|парол|безопасност|аккаунт|профил|войти|выйти)/iu
const SUBMISSION_TARGET =
  /(?:submit|send|confirm|publish|post|apply|register|sign.up|отправ|подтверд|опубликов|зарегистр)/iu

function targetName(target: BrowserTarget, observation: BrowserObservation | null): string {
  if (target.kind === 'accessible-name') return target.name
  return observation?.interactiveElements.find((element) => element.ref === target.ref)?.name ?? ''
}

function classifyNamedMutation(name: string): BrowserSemanticRiskClass {
  if (DESTRUCTIVE_TARGET.test(name)) return 'destructive'
  if (FINANCIAL_TARGET.test(name)) return 'financial'
  if (ACCOUNT_TARGET.test(name)) return 'account-change'
  if (SUBMISSION_TARGET.test(name)) return 'submission'
  return 'navigation'
}

/** Main-owned conservative risk classification. Page labels can only raise, never lower, risk. */
export function classifyBrowserOperationRisk(
  operation: BrowserOperation | undefined,
  observation: BrowserObservation | null,
): BrowserSemanticRiskClass {
  if (!operation) return 'submission'
  switch (operation.operation) {
    case 'observe':
    case 'tabs':
      return 'read'
    case 'open':
    case 'scroll':
    case 'back':
    case 'forward':
    case 'switch-tab':
      return 'navigation'
    case 'fill':
    case 'select': {
      const namedRisk = classifyNamedMutation(targetName(operation.target, observation))
      return namedRisk === 'navigation' ? 'input' : namedRisk
    }
    case 'click':
      return classifyNamedMutation(targetName(operation.target, observation))
  }
}

export function requiresExplicitBrowserConfirmation(risk: BrowserSemanticRiskClass): boolean {
  return ['submission', 'account-change', 'financial', 'destructive'].includes(risk)
}

export type EffectiveDesktopWorkflowRequest = DesktopWorkflowRequest & {
  browserRiskClass?: BrowserSemanticRiskClass
}

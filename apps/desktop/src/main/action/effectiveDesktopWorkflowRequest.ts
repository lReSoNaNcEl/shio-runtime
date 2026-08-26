import type { DesktopWorkflowRequest } from '../../shared/actions'
import type { BrowserSemanticRiskClass } from '../../shared/browser-control'
import type { ShellRiskAssessment } from '../desktop-control/shell'

/** Cross-domain request after Main-owned browser and shell risk classification. */
export type EffectiveDesktopWorkflowRequest = DesktopWorkflowRequest & {
  browserRiskClass?: BrowserSemanticRiskClass
  shellRisk?: ShellRiskAssessment
}

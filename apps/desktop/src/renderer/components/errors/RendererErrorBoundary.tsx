import { Button, Heading, Provider, Text } from '@react-spectrum/s2'
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { normalizeUiTheme } from '../../../shared/config'
import { normalizeUiLocale, toIntlLocale, translate } from '../../../shared/localization'
import { observeRendererPromise } from '../../reliability/observePromise'
import {
  createRendererFailureDetails,
  type RendererFailureDetails,
} from './rendererErrorDiagnostics'

interface RendererErrorBoundaryProps {
  children: ReactNode
}

type CopyStatus = 'idle' | 'copied' | 'failed'

interface RendererErrorBoundaryState {
  copyStatus: CopyStatus
  details: RendererFailureDetails | null
  failed: boolean
  restarting: boolean
}

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = {
    copyStatus: 'idle',
    details: null,
    failed: false,
    restarting: false,
  }

  private restartFallbackTimer: number | null = null

  static getDerivedStateFromError(error: Error): RendererErrorBoundaryState {
    return {
      copyStatus: 'idle',
      details: createRendererFailureDetails(error),
      failed: true,
      restarting: false,
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[RendererErrorBoundary] render failed', error, info.componentStack)
    const details = createRendererFailureDetails(
      error,
      info.componentStack,
      this.state.details?.errorId,
    )
    this.setState({ details })
    if (new URLSearchParams(window.location.search).get('overlay') === '1') return
    observeRendererPromise(
      window.api.system.reportRendererFailure({
        errorId: details.errorId,
        errorName: details.errorName,
        componentNames: details.componentNames,
      }),
      'report contained renderer failure',
    )
  }

  componentWillUnmount(): void {
    if (this.restartFallbackTimer !== null) window.clearTimeout(this.restartFallbackTimer)
  }

  private reloadRenderer = (): void => {
    if (this.restartFallbackTimer !== null) window.clearTimeout(this.restartFallbackTimer)
    window.location.reload()
  }

  private restartApplication = (): void => {
    if (this.state.restarting) return
    this.setState({ restarting: true })
    this.restartFallbackTimer = window.setTimeout(this.reloadRenderer, 7_000)
    try {
      void window.api.system.restartApplication().then(undefined, (error: unknown) => {
        console.error('[RendererErrorBoundary] application restart failed', error)
        this.reloadRenderer()
      })
    } catch (error) {
      console.error('[RendererErrorBoundary] application restart failed', error)
      this.reloadRenderer()
    }
  }

  private copyDiagnostics = (): void => {
    const details = this.state.details
    if (!details || !navigator.clipboard?.writeText) {
      this.setState({ copyStatus: 'failed' })
      return
    }
    const locale = normalizeUiLocale(document.documentElement.lang)
    const diagnostic = [
      'Shio renderer failure',
      `${translate(locale, 'rendererError.errorId')}: ${details.errorId}`,
      `${translate(locale, 'rendererError.errorType')}: ${details.errorName}`,
      `${translate(locale, 'rendererError.reason')}: ${details.message || translate(locale, 'rendererError.unknownReason')}`,
      `${translate(locale, 'rendererError.components')}: ${details.componentNames.join(' > ') || '—'}`,
    ].join('\n')
    void navigator.clipboard.writeText(diagnostic).then(
      () => this.setState({ copyStatus: 'copied' }),
      (error: unknown) => {
        console.error('[RendererErrorBoundary] diagnostic copy failed', error)
        this.setState({ copyStatus: 'failed' })
      },
    )
  }

  private openLogsFolder = (): void => {
    observeRendererPromise(window.api.system.openLogsFolder(), 'open renderer failure logs folder')
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children

    const locale = normalizeUiLocale(document.documentElement.lang)
    const uiTheme = normalizeUiTheme(document.documentElement.dataset.theme)
    const details = this.state.details
    const copyStatusText =
      this.state.copyStatus === 'copied'
        ? translate(locale, 'rendererError.copied')
        : this.state.copyStatus === 'failed'
          ? translate(locale, 'rendererError.copyFailed')
          : ''
    return (
      <Provider
        colorScheme={uiTheme}
        locale={toIntlLocale(locale)}
        UNSAFE_className="renderer-error-provider"
      >
        <main className="renderer-error-boundary">
          <section className="renderer-error-card" aria-live="assertive">
            <div className="renderer-error-summary">
              <Heading level={1}>{translate(locale, 'rendererError.title')}</Heading>
              <Text>{translate(locale, 'rendererError.description')}</Text>
            </div>

            <section className="renderer-error-details" aria-labelledby="renderer-error-details">
              <Heading id="renderer-error-details" level={2}>
                {translate(locale, 'rendererError.detailsTitle')}
              </Heading>
              <dl className="renderer-error-detail-grid">
                <dt>{translate(locale, 'rendererError.errorId')}</dt>
                <dd>
                  <code>{details?.errorId ?? '—'}</code>
                </dd>
                <dt>{translate(locale, 'rendererError.errorType')}</dt>
                <dd>
                  <code>{details?.errorName ?? 'Error'}</code>
                </dd>
                <dt>{translate(locale, 'rendererError.reason')}</dt>
                <dd className="renderer-error-reason">
                  {details?.message || translate(locale, 'rendererError.unknownReason')}
                </dd>
                {details?.componentNames.length ? (
                  <>
                    <dt>{translate(locale, 'rendererError.components')}</dt>
                    <dd>
                      <code>{details.componentNames.join(' > ')}</code>
                    </dd>
                  </>
                ) : null}
              </dl>
            </section>

            <div className="renderer-error-actions">
              <Button
                variant="accent"
                onPress={this.restartApplication}
                isPending={this.state.restarting}
                UNSAFE_className="shio-accent-button"
              >
                {this.state.restarting
                  ? translate(locale, 'rendererError.restarting')
                  : translate(locale, 'rendererError.restart')}
              </Button>
              <Button
                variant="secondary"
                onPress={this.copyDiagnostics}
                isDisabled={this.state.restarting}
              >
                {translate(locale, 'rendererError.copy')}
              </Button>
              <Button
                variant="secondary"
                onPress={this.openLogsFolder}
                isDisabled={this.state.restarting}
              >
                {translate(locale, 'rendererError.openLogs')}
              </Button>
            </div>
            <div className="renderer-error-footer">
              <Text>{translate(locale, 'rendererError.restartHint')}</Text>
              <span className="renderer-error-copy-status" role="status" aria-live="polite">
                {copyStatusText}
              </span>
            </div>
          </section>
        </main>
      </Provider>
    )
  }
}

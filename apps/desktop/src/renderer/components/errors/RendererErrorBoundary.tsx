import { Button, Heading, Provider, Text } from '@react-spectrum/s2'
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { normalizeUiTheme } from '../../../shared/config'
import { normalizeUiLocale, toIntlLocale, translate } from '../../../shared/localization'
import { observeRendererPromise } from '../../reliability/observePromise'

interface RendererErrorBoundaryProps {
  children: ReactNode
}

interface RendererErrorBoundaryState {
  failed: boolean
}

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): RendererErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[RendererErrorBoundary] render failed', error, info.componentStack)
    if (new URLSearchParams(window.location.search).get('overlay') === '1') return
    observeRendererPromise(
      window.api.system.reportRendererFailure(),
      'report contained renderer failure',
    )
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children

    const locale = normalizeUiLocale(document.documentElement.lang)
    const uiTheme = normalizeUiTheme(document.documentElement.dataset.theme)
    return (
      <Provider
        colorScheme={uiTheme}
        locale={toIntlLocale(locale)}
        UNSAFE_className="renderer-error-provider"
      >
        <main className="renderer-error-boundary">
          <section className="renderer-error-card" aria-live="assertive">
            <Heading>{translate(locale, 'rendererError.title')}</Heading>
            <Text>{translate(locale, 'rendererError.description')}</Text>
            <Button
              variant="accent"
              onPress={() => window.location.reload()}
              UNSAFE_className="shio-accent-button"
            >
              {translate(locale, 'rendererError.reload')}
            </Button>
          </section>
        </main>
      </Provider>
    )
  }
}

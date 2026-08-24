import { createRoot } from 'react-dom/client'

import { App } from './components/App'
import { RendererErrorBoundary } from './components/errors/RendererErrorBoundary'
import { LocalizationProvider } from './localization/LocalizationProvider'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/chat.css'
import './styles/capabilities.css'
import './styles/memory.css'
import './styles/actions.css'
import './styles/settings.css'
import './styles/setup-center.css'
import './styles/avatar-preview.css'
import './styles/health.css'
import './styles/plugins.css'
import './styles/overlay.css'
import './styles/diagnostics.css'

// No StrictMode: it double-invokes effects, which double-runs the imperative
// Three.js bootstrap (attachCanvas), undesirable for our singleton controller.
const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')
createRoot(rootElement).render(
  <RendererErrorBoundary>
    <LocalizationProvider>
      <App />
    </LocalizationProvider>
  </RendererErrorBoundary>,
)

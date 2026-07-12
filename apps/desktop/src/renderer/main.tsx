import { createRoot } from 'react-dom/client'

import { App } from './components/App'
import './styles.css'

// No StrictMode: it double-invokes effects, which double-runs the imperative
// Three.js bootstrap (attachCanvas), undesirable for our singleton controller.
const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')
createRoot(rootElement).render(<App />)

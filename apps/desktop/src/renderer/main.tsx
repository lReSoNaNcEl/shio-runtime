import { createRoot } from 'react-dom/client'
import { App } from './components/App'
import './styles.css'

// No StrictMode: it double-invokes effects, which double-runs the imperative
// Three.js bootstrap (attachCanvas), undesirable for our singleton controller.
createRoot(document.getElementById('root')!).render(<App />)

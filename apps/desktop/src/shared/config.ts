// Config defaults shared between the main process (owns config.json) and the
// renderer (Settings UI). Single source of truth for literals that would
// otherwise be duplicated across the Runtime boundary.

export const DEFAULT_SPEECH_URL = 'http://localhost:8000'

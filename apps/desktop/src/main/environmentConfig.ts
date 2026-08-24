export const DEFAULT_SPEECH_API_URL = 'http://127.0.0.1:8000'

export interface EnvironmentConfig {
  readonly speechApiUrl: string
}

function normalizeHttpEndpoint(value: string): string {
  const endpoint = new URL(value)
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('SHIO_SPEECH_API_URL must use http or https')
  }
  return endpoint.toString().replace(/\/$/, '')
}

export function resolveEnvironmentConfig(
  environment: NodeJS.ProcessEnv = process.env,
): EnvironmentConfig {
  const configuredEndpoint = environment.SHIO_SPEECH_API_URL?.trim()
  return Object.freeze({
    speechApiUrl: normalizeHttpEndpoint(configuredEndpoint || DEFAULT_SPEECH_API_URL),
  })
}

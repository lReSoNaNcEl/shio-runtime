import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { LLM_PROVIDER_IDS, type LlmCredentialStatus, type LlmProviderId } from '../../shared/llm'

export type LlmCredentialMap = Partial<Record<LlmProviderId, string>>

export interface LlmCredentialProtector {
  isAvailable(): Promise<boolean>
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

export interface ResolvedLlmCredential {
  apiKey: string
  status: LlmCredentialStatus
}

export class LlmCredentialStore {
  private credentials: LlmCredentialMap = {}
  private secureStorageAvailable = false
  private loadFailed = false
  private lastErrors: Partial<Record<LlmProviderId, string>> = {}

  constructor(
    private readonly filePath: string,
    private readonly protector: LlmCredentialProtector,
    private readonly getEnvironmentCredential: (provider: LlmProviderId) => string | undefined,
  ) {}

  async load(): Promise<void> {
    this.secureStorageAvailable = await this.protector.isAvailable()
    this.credentials = {}
    this.lastErrors = {}
    this.loadFailed = false
    if (!this.secureStorageAvailable) return

    try {
      const encrypted = await readFile(this.filePath)
      const decrypted = await this.protector.decrypt(encrypted)
      this.credentials = parseCredentialMap(decrypted.result)
      if (decrypted.shouldReEncrypt && Object.keys(this.credentials).length > 0) {
        await this.persist(this.credentials)
      }
    } catch (error) {
      if (!isMissingFile(error)) {
        this.loadFailed = true
        this.setErrors(LLM_PROVIDER_IDS, safeErrorMessage(error))
      }
    }
  }

  resolve(provider: LlmProviderId): ResolvedLlmCredential {
    const secureCredential = this.credentials[provider]
    if (secureCredential) {
      return {
        apiKey: secureCredential,
        status: this.status(provider, true, 'secure_store'),
      }
    }
    const environmentCredential = normalizeCredential(this.getEnvironmentCredential(provider) ?? '')
    if (environmentCredential) {
      return {
        apiKey: environmentCredential,
        status: this.status(provider, true, 'environment'),
      }
    }
    return {
      apiKey: '',
      status: this.status(provider, false, 'none'),
    }
  }

  getStatus(provider: LlmProviderId): LlmCredentialStatus {
    return this.resolve(provider).status
  }

  async save(provider: LlmProviderId, value: string): Promise<LlmCredentialStatus> {
    const credential = validateCredential(value)
    await this.requireSecureStorage()
    const next = { ...this.credentials, [provider]: credential }
    await this.persist(next)
    this.credentials = next
    delete this.lastErrors[provider]
    return this.getStatus(provider)
  }

  async forget(provider: LlmProviderId): Promise<LlmCredentialStatus> {
    if (this.loadFailed) {
      throw new Error('Existing secure credential storage could not be read')
    }
    const next = { ...this.credentials }
    delete next[provider]
    if (Object.keys(next).length === 0) {
      await rm(this.filePath, { force: true })
    } else {
      await this.requireSecureStorage()
      await this.persist(next)
    }
    this.credentials = next
    delete this.lastErrors[provider]
    return this.getStatus(provider)
  }

  async importMissing(credentials: LlmCredentialMap): Promise<void> {
    const next = { ...this.credentials }
    const affected: LlmProviderId[] = []
    for (const provider of LLM_PROVIDER_IDS) {
      const candidate = normalizeCredential(credentials[provider] ?? '')
      if (candidate && !next[provider]) {
        next[provider] = candidate
        affected.push(provider)
      }
    }
    if (affected.length === 0) return

    try {
      await this.requireSecureStorage()
      await this.persist(next)
      this.credentials = next
      for (const provider of affected) delete this.lastErrors[provider]
    } catch (error) {
      this.setErrors(affected, safeErrorMessage(error))
      throw error
    }
  }

  recordMigrationError(providers: readonly LlmProviderId[], message: string): void {
    this.setErrors(providers, message)
  }

  private async requireSecureStorage(): Promise<void> {
    this.secureStorageAvailable = await this.protector.isAvailable()
    if (!this.secureStorageAvailable) {
      throw new Error('Secure credential storage is unavailable')
    }
    if (this.loadFailed) {
      throw new Error('Existing secure credential storage could not be read')
    }
  }

  private async persist(credentials: LlmCredentialMap): Promise<void> {
    const encrypted = await this.protector.encrypt(JSON.stringify(credentials))
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    try {
      await writeFile(temporaryPath, encrypted, { mode: 0o600 })
      await rename(temporaryPath, this.filePath)
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }

  private status(
    provider: LlmProviderId,
    configured: boolean,
    source: LlmCredentialStatus['source'],
  ): LlmCredentialStatus {
    return {
      configured,
      source,
      secureStorageAvailable: this.secureStorageAvailable,
      lastError: this.lastErrors[provider],
    }
  }

  private setErrors(providers: readonly LlmProviderId[], message: string): void {
    for (const provider of providers) this.lastErrors[provider] = message
  }
}

function parseCredentialMap(value: string): LlmCredentialMap {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid encrypted LLM credential payload')
  }
  const record = parsed as Record<string, unknown>
  const credentials: LlmCredentialMap = {}
  for (const provider of LLM_PROVIDER_IDS) {
    if (typeof record[provider] === 'string') {
      const credential = normalizeCredential(record[provider])
      if (credential) credentials[provider] = credential
    }
  }
  return credentials
}

function validateCredential(value: string): string {
  const credential = normalizeCredential(value)
  if (!credential || credential.length > 2_000 || /\s/.test(credential)) {
    throw new Error('Invalid LLM credential')
  }
  return credential
}

function normalizeCredential(value: string): string {
  return value.trim()
}

function safeErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return `Secure credential storage error (${(error as { code: string }).code})`
  }
  return 'Secure credential storage error'
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}

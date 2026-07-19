import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { type Translator, translate } from '../../shared/localization/format'
import { DEFAULT_UI_LOCALE } from '../../shared/localization/locale'
import type { ProjectCredentialStatus } from '../../shared/project-awareness'

export interface ProjectCredentialProtector {
  isAvailable(): Promise<boolean>
  encrypt(value: string): Promise<Buffer>
  decrypt(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

export interface LoadedProjectCredential extends ProjectCredentialStatus {
  token: string
}

export class ProjectCredentialStore {
  constructor(
    private readonly filePath: string,
    private readonly protector: ProjectCredentialProtector,
    private readonly t: Translator = (key, params) => translate(DEFAULT_UI_LOCALE, key, params),
  ) {}

  async load(): Promise<LoadedProjectCredential> {
    const secureStorageAvailable = await this.protector.isAvailable()
    if (secureStorageAvailable) {
      try {
        const encrypted = await readFile(this.filePath)
        const decrypted = await this.protector.decrypt(encrypted)
        const token = normalizeToken(decrypted.result)
        if (decrypted.shouldReEncrypt && token) await this.persist(token)
        if (token) {
          return {
            token,
            configured: true,
            source: 'secure_store',
            secureStorageAvailable,
          }
        }
      } catch (error) {
        if (!isMissingFile(error)) {
          return this.emptyCredential(
            secureStorageAvailable,
            this.t('main.error.project.decryptFailed'),
          )
        }
      }
    }

    return this.emptyCredential(secureStorageAvailable)
  }

  async save(value: string): Promise<LoadedProjectCredential> {
    const token = normalizeToken(value)
    validateToken(token, this.t)
    if (!(await this.protector.isAvailable())) {
      throw new Error(this.t('main.error.project.secureStorageUnavailable'))
    }
    await this.persist(token)
    return {
      token,
      configured: true,
      source: 'secure_store',
      secureStorageAvailable: true,
    }
  }

  async clear(): Promise<LoadedProjectCredential> {
    await rm(this.filePath, { force: true })
    const secureStorageAvailable = await this.protector.isAvailable()
    return this.emptyCredential(secureStorageAvailable)
  }

  private async persist(token: string): Promise<void> {
    const encrypted = await this.protector.encrypt(token)
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, encrypted, { mode: 0o600 })
  }

  private emptyCredential(
    secureStorageAvailable: boolean,
    lastError?: string,
  ): LoadedProjectCredential {
    return {
      token: '',
      configured: false,
      source: 'none',
      secureStorageAvailable,
      lastError,
    }
  }
}

function normalizeToken(value: string): string {
  return value.trim()
}

function validateToken(token: string, t: Translator): void {
  if (token.length < 20 || token.length > 500 || /\s/.test(token)) {
    throw new Error(t('main.error.project.tokenInvalid'))
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}

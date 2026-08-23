import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, normalize } from 'node:path'

import { BUNDLED_DEFAULT_VRM_ASSET_HANDLE, type VrmAssetDescriptor } from '../../shared/avatarAsset'

const MAX_VRM_BYTES = 256 * 1024 * 1024

export class VrmAssetRegistry {
  private readonly pathByHandle = new Map<string, string>()
  private readonly handleByPath = new Map<string, string>()

  registerSelectedAsset(filePath: string): VrmAssetDescriptor {
    const normalizedPath = this.validateSelectedPath(filePath)
    const existing = this.handleByPath.get(normalizedPath)
    if (existing) return { assetHandle: existing, displayName: basename(normalizedPath) }

    const assetHandle = `vrm-asset:${randomUUID()}`
    this.handleByPath.set(normalizedPath, assetHandle)
    this.pathByHandle.set(assetHandle, normalizedPath)
    return { assetHandle, displayName: basename(normalizedPath) }
  }

  describeConfiguredAsset(filePath: string): VrmAssetDescriptor {
    if (!filePath.trim()) {
      return { assetHandle: BUNDLED_DEFAULT_VRM_ASSET_HANDLE, displayName: '' }
    }
    try {
      return this.registerSelectedAsset(filePath)
    } catch {
      return { assetHandle: BUNDLED_DEFAULT_VRM_ASSET_HANDLE, displayName: '' }
    }
  }

  readAsset(assetHandle: string): ArrayBuffer {
    const filePath = this.pathByHandle.get(assetHandle)
    if (!filePath) throw new Error('Unknown VRM asset handle')
    const stats = statSync(filePath)
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_VRM_BYTES) {
      throw new Error('Selected VRM asset is invalid')
    }
    const buffer = readFileSync(filePath)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  }

  private validateSelectedPath(filePath: string): string {
    if (!isAbsolute(filePath) || extname(filePath).toLowerCase() !== '.vrm') {
      throw new Error('Selected VRM asset path is invalid')
    }
    return normalize(filePath)
  }
}

export const vrmAssetRegistry = new VrmAssetRegistry()

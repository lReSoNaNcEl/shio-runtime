import { BUNDLED_DEFAULT_VRM_ASSET_HANDLE } from '../../shared/avatarAsset'
import bundledDefaultVrmUrl from '../assets/vrm/green_fox.vrm?url'

export function resolveVrmSource(assetHandle: string | undefined): string {
  return assetHandle?.trim() || BUNDLED_DEFAULT_VRM_ASSET_HANDLE
}

export async function readResolvedVrmSource(
  source: string,
): Promise<{ ok: boolean; buffer?: ArrayBuffer; error?: string }> {
  if (source !== BUNDLED_DEFAULT_VRM_ASSET_HANDLE) {
    const isOverlay = new URLSearchParams(window.location.search).get('overlay') === '1'
    return isOverlay ? window.overlayApi.vrm.read(source) : window.api.vrm.read(source)
  }
  try {
    const response = await fetch(bundledDefaultVrmUrl)
    if (!response.ok) return { ok: false, error: `Bundled VRM unavailable: ${response.status}` }
    return { ok: true, buffer: await response.arrayBuffer() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

import * as THREE from 'three'

export const AVATAR_MAX_DPR = 2
export const AVATAR_MAX_ANISOTROPY = 8

export interface AvatarTextureQualityState {
  materialCount: number
  textureCount: number
  anisotropy: number
}

export function resolveEffectiveDpr(
  devicePixelRatio: number,
  configuredMaxDpr = AVATAR_MAX_DPR,
): number {
  const safeDeviceDpr = Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1
  const safeMaxDpr = Number.isFinite(configuredMaxDpr) ? configuredMaxDpr : AVATAR_MAX_DPR
  return Math.max(1, Math.min(safeDeviceDpr, Math.max(1, safeMaxDpr)))
}

export function computeDrawingBufferSize(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(Math.max(1, cssWidth) * Math.max(1, dpr))),
    height: Math.max(1, Math.round(Math.max(1, cssHeight) * Math.max(1, dpr))),
  }
}

export class AvatarRendererQuality {
  private textureState: AvatarTextureQualityState = {
    materialCount: 0,
    textureCount: 0,
    anisotropy: 1,
  }

  configureRenderer(renderer: THREE.WebGLRenderer): void {
    // Explicitly preserve Three's linear-lighting + sRGB-output pipeline and
    // MToon-compatible no-tone-mapping look. This prevents defaults from
    // silently changing during a future Three upgrade.
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    renderer.toneMappingExposure = 1
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
  }

  configureModel(root: THREE.Object3D, renderer: THREE.WebGLRenderer): AvatarTextureQualityState {
    const maximum = Math.max(
      1,
      Math.min(AVATAR_MAX_ANISOTROPY, renderer.capabilities.getMaxAnisotropy()),
    )
    const textures = new Set<THREE.Texture>()
    const materials = new Set<THREE.Material>()

    root.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !mesh.material) return
      const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of meshMaterials) {
        materials.add(material)
        this.collectMaterialTextures(material, textures)
      }
    })

    for (const texture of textures) {
      // Keep sampler filtering, mipmap, wrapping, and color-space semantics from
      // GLTFLoader/MToon. Anisotropy is the only safe post-load quality change.
      if (texture.anisotropy !== maximum) {
        texture.anisotropy = maximum
        texture.needsUpdate = true
      }
    }

    this.textureState = {
      materialCount: materials.size,
      textureCount: textures.size,
      anisotropy: maximum,
    }
    return this.getTextureState()
  }

  getTextureState(): AvatarTextureQualityState {
    return { ...this.textureState }
  }

  private collectMaterialTextures(material: THREE.Material, textures: Set<THREE.Texture>): void {
    const collect = (value: unknown): void => {
      const texture = value as THREE.Texture | undefined
      if (texture?.isTexture) textures.add(texture)
    }

    for (const value of Object.values(material)) collect(value)

    // MToon is a ShaderMaterial whose texture accessors resolve through the
    // uniforms container rather than enumerable material properties.
    const shaderMaterial = material as THREE.ShaderMaterial
    if (!shaderMaterial.uniforms) return
    for (const uniform of Object.values(shaderMaterial.uniforms)) collect(uniform?.value)
  }
}

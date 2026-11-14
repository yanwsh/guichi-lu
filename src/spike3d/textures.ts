import * as THREE from 'three'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

/** Embedded street textures are webp. `?tex=ktx2` asks for the Basis files, which are not authored yet. */
export type TextureCodec = 'webp' | 'ktx2'

export function resolveTextureCodec(search: string): TextureCodec {
  return new URLSearchParams(search).get('tex') === 'ktx2' ? 'ktx2' : 'webp'
}

export function textureURL(name: string, codec: TextureCodec): string {
  const ext = codec === 'ktx2' ? 'ktx2' : 'webp'
  return `${import.meta.env.BASE_URL}assets/3d/textures/${name}.${ext}`
}

/**
 * Load an external trim sheet when one is published.
 * Returns null when the file is absent so the embedded webp stays in place.
 */
export async function loadExternalTexture(renderer: THREE.WebGLRenderer, name: string, codec: TextureCodec): Promise<THREE.Texture | null> {
  const url = textureURL(name, codec)
  const head = await fetch(url, { method: 'HEAD' })
  if (!head.ok) return null
  if (codec === 'webp') {
    const tex = await new THREE.TextureLoader().loadAsync(url)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.flipY = false
    return tex
  }
  const ktx2 = new KTX2Loader()
  ktx2.detectSupport(renderer)
  try {
    const tex = await ktx2.loadAsync(url)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  } finally {
    ktx2.dispose()
  }
}

import * as THREE from 'three'

export type MatMode = 'toon' | 'pbr'

/** Default is the hand-painted path. `?mat=pbr` keeps a Standard material with the same fog and lightmap hook. */
export function resolveMat(search: string): MatMode {
  const mat = new URLSearchParams(search).get('mat')
  return mat === 'pbr' ? 'pbr' : 'toon'
}

const white = (() => {
  const data = new Uint8Array([255, 255, 255, 255])
  const tex = new THREE.DataTexture(data, 1, 1)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
})()

/** Authored lightmaps stay at or under 1024. Tracked so ?perf=1 can flag anything larger. */
export const trackedTextures: THREE.Texture[] = [white]

export interface StyleOptions {
  color?: number
  map?: THREE.Texture | null
  lightMap?: THREE.Texture | null
  roughness?: number
  metalness?: number
  normalMap?: THREE.Texture | null
  /** Elongated wet-ground lantern streaks. 0 disables them. */
  streak?: number
  transparent?: boolean
  opacity?: number
}

export function createStyleMaterial(mode: MatMode, opts: StyleOptions = {}): THREE.MeshLambertMaterial | THREE.MeshStandardMaterial {
  const map = opts.map ?? null
  const lightMap = opts.lightMap ?? white
  trackedTextures.push(lightMap)
  if (map) trackedTextures.push(map)
  const mat = mode === 'pbr'
    ? new THREE.MeshStandardMaterial({
      color: opts.color ?? 0xffffff,
      map,
      roughness: opts.roughness ?? 0.72,
      metalness: opts.metalness ?? 0.02,
      normalMap: opts.normalMap ?? null,
    })
    : new THREE.MeshLambertMaterial({
      color: opts.color ?? 0xffffff,
      map,
    })
  if (opts.transparent) {
    mat.transparent = true
    mat.opacity = opts.opacity ?? 1
    mat.depthWrite = (opts.opacity ?? 1) > 0.9
  }
  mat.userData.streak = opts.streak ?? 0
  patchStyle(mat, lightMap)
  return mat
}

function patchStyle(mat: THREE.Material, lightMap: THREE.Texture) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uLightMap = { value: lightMap }
    shader.uniforms.uCam = { value: new THREE.Vector3() }
    shader.uniforms.uPlayer = { value: new THREE.Vector3() }
    shader.uniforms.uLamps = { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] }
    shader.uniforms.uLampColor = { value: [new THREE.Color(0xff890e), new THREE.Color(0xff890e), new THREE.Color(0xff890e), new THREE.Color(0xff890e)] }
    shader.uniforms.uStreak = { value: mat.userData.streak ?? 0 }
    mat.userData.shader = shader
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying vec2 vStyleUv;\nattribute vec2 styleUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n\tvStyleUv = styleUv;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldPos;
varying vec2 vStyleUv;
uniform sampler2D uLightMap;
uniform vec3 uCam;
uniform vec3 uPlayer;
uniform vec3 uLamps[4];
uniform vec3 uLampColor[4];
uniform float uStreak;
float hash21(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
	diffuseColor.rgb *= texture2D(uLightMap, vStyleUv).rgb;
	float insideShop = smoothstep(-0.15, 0.55, vWorldPos.z) * (1.0 - smoothstep(2.65, 3.15, abs(vWorldPos.x)));
	vec3 grade = mix(vec3(0.82, 0.88, 1.06), vec3(1.0, 0.96, 0.9), insideShop);
	diffuseColor.rgb *= grade;`)
      .replace('#include <opaque_fragment>', `vec3 streak = vec3(0.0);
	if (uStreak > 0.0) {
		for (int i = 0; i < 4; i++) {
			vec2 delta = vWorldPos.xz - uLamps[i].xz;
			vec2 toCam = uCam.xz - uLamps[i].xz;
			float span = length(toCam);
			vec2 axis = span > 0.001 ? toCam / span : vec2(0.0, -1.0);
			float along = dot(delta, axis);
			float side = abs(delta.x * axis.y - delta.y * axis.x);
			float band = exp(-(side * side) / 0.02);
			float farEnd = max(span - along, 0.0);
			float fall = exp(-max(farEnd - 0.55, 0.0) * 0.22);
			float ahead = smoothstep(0.3, 0.85, along);
			float stand = smoothstep(0.28, 1.2, length(uPlayer.xz - uLamps[i].xz));
			float nick = hash21(vec2(floor(along * 2.5), side * 6.0));
			float brk = mix(0.78, 1.0, nick);
			streak += uLampColor[i] * band * fall * ahead * mix(0.4, 1.0, stand) * brk;
		}
	}
	outgoingLight += streak * uStreak * 0.55;
	#include <opaque_fragment>`)
  }
  const previous = mat.customProgramCacheKey?.bind(mat)
  mat.customProgramCacheKey = () => `${previous ? previous() : ''}|style-v4|${mat.userData.streak ?? 0}|${lightMap.uuid}`
}

export function updateStyleLights(mats: THREE.Material[], camera: THREE.Vector3, player: THREE.Vector3, lamps: { position: THREE.Vector3, color: THREE.Color }[]) {
  for (const mat of mats) {
    const shader = mat.userData.shader as { uniforms: Record<string, { value: unknown }> } | undefined
    if (!shader) continue
    ;(shader.uniforms.uCam.value as THREE.Vector3).copy(camera)
    ;(shader.uniforms.uPlayer.value as THREE.Vector3).copy(player)
    const positions = shader.uniforms.uLamps.value as THREE.Vector3[]
    const colors = shader.uniforms.uLampColor.value as THREE.Color[]
    for (let i = 0; i < 4; i++) {
      const lamp = lamps[i]
      if (lamp) {
        positions[i].copy(lamp.position)
        colors[i].copy(lamp.color)
      } else {
        positions[i].set(0, -100, 0)
      }
    }
  }
}

export function ensureStyleUv(geo: THREE.BufferGeometry) {
  if (geo.getAttribute('styleUv')) return
  const src = geo.getAttribute('uv2') || geo.getAttribute('uv')
  if (src) geo.setAttribute('styleUv', src)
}

/** Replace a loaded glTF material with the active style, keeping its color and base map. */
export function restyleMesh(mesh: THREE.Mesh, mode: MatMode) {
  const old = mesh.material as THREE.MeshStandardMaterial
  if (!old || Array.isArray(old)) return
  ensureStyleUv(mesh.geometry)
  const baked = mesh.userData.lightMapTexture as THREE.Texture | undefined
  const next = createStyleMaterial(mode, {
    color: old.color?.getHex?.() ?? 0xffffff,
    map: old.map ?? null,
    lightMap: baked ?? null,
    normalMap: old.normalMap ?? null,
    roughness: old.roughness,
    metalness: old.metalness,
    streak: mesh.userData.streak ?? 0,
    transparent: old.transparent,
    opacity: old.opacity,
  })
  mesh.material = next
}

/** 512² shop floor. uv v = 1 is the door (z = 0). Warm pools under the lanterns, cool spill at the threshold. */
export function shopLightmap(): THREE.CanvasTexture {
  return canvasLight([
    { u: 0.5, v: 0.76, color: '#f2c49a', radius: 0.16, strength: 0.88 },
    { u: 0.28, v: 0.55, color: '#e8b48a', radius: 0.12, strength: 0.7 },
    { u: 0.5, v: 0.97, color: '#8aa0c4', radius: 0.13, strength: 0.48 },
  ], 0.78, 0.7, 0.58)
}

/** Street plane: u along +X, v = 0 at the shop wall (z ≈ -0.3), v = 1 toward the river. */
export function streetLightmap(): THREE.CanvasTexture {
  return canvasLight([
  ], 0.62, 0.64, 0.72)
}

function canvasLight(spots: { u: number, v: number, color: string, radius: number, strength: number }[], br = 0.92, bg = 0.86, bb = 0.78): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')!
  g.fillStyle = `rgb(${br * 255},${bg * 255},${bb * 255})`
  g.fillRect(0, 0, size, size)
  for (const spot of spots) {
    const x = spot.u * size
    const y = (1 - spot.v) * size
    const r = spot.radius * size
    const grd = g.createRadialGradient(x, y, r * 0.1, x, y, r)
    grd.addColorStop(0, spot.color)
    grd.addColorStop(1, `rgba(0,0,0,0)`)
    g.globalAlpha = spot.strength
    g.fillStyle = grd
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
    g.globalAlpha = 1
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  trackedTextures.push(tex)
  return tex
}

export function maxTextureSize(): number {
  let max = 0
  for (const tex of trackedTextures) {
    const image = tex.image as { width?: number, height?: number } | undefined
    if (!image) continue
    max = Math.max(max, image.width ?? 0, image.height ?? 0)
  }
  return max
}

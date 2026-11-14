import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/** Horizon warm orange, zenith blue-purple. The visible band is steep because the camera looks down. */
export const HORIZON = new THREE.Color(0xf2a06a)
export const ZENITH = new THREE.Color(0x34366e)
export const LANTERN = new THREE.Color(0xff890e)
export const FOG_DENSITY = 0.031

/** Tanner Helland approximation. 2000 K is the lantern practical. */
export function kelvinColor(kelvin: number): THREE.Color {
  const temp = kelvin / 100
  let r = 255
  let g = 255
  let b = 255
  if (temp <= 66) g = 99.4708025861 * Math.log(temp) - 161.1195681661
  else {
    r = 329.698727446 * ((temp - 60) ** -0.1332047592)
    g = 288.1221695283 * ((temp - 60) ** -0.0755148492)
  }
  if (temp >= 66) b = 255
  else if (temp <= 19) b = 0
  else b = 138.5177312231 * Math.log(temp - 10) - 305.0447927307
  const clamp = (v: number) => Math.min(255, Math.max(0, v)) / 255
  return new THREE.Color(clamp(r), clamp(g), clamp(b))
}

export function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(48, 48, 32)
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: HORIZON },
      uZenith: { value: ZENITH },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      void main() {
        vec3 dir = normalize(vDir);
        float t = smoothstep(-0.04, 0.10, dir.y);
        vec3 col = mix(uHorizon, uZenith, t);
        gl_FragColor = vec4(col * 0.82, 1.0);
      }
    `,
  })
  const sky = new THREE.Mesh(geo, mat)
  sky.name = 'SKY'
  sky.frustumCulled = false
  sky.renderOrder = -1
  return sky
}

/** Two shallow sheets over the river. Alpha falls off with distance so the exp fog can take the far water. */
export function createRiverMist(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'RIVER_MIST'
  const geo = new THREE.PlaneGeometry(26, 12)
  geo.rotateX(-Math.PI / 2)
  const low = sheet(geo, 0.34)
  low.position.set(4, 0.16, -12)
  const high = sheet(geo, 0.18)
  high.position.set(4, 0.52, -12)
  group.add(low, high)
  return group
}

function sheet(geo: THREE.BufferGeometry, alpha: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uAlpha: { value: alpha },
      uCam: { value: new THREE.Vector3() },
      uHorizon: { value: HORIZON },
      uCool: { value: new THREE.Color(0x8a94c4) },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying vec3 vWorld;
      uniform float uAlpha;
      uniform vec3 uCam;
      uniform vec3 uHorizon;
      uniform vec3 uCool;
      void main() {
        float n = sin(vWorld.x * 0.31) * sin(vWorld.z * 0.23);
        n += 0.55 * sin(vWorld.x * 0.73 + vWorld.z * 0.41);
        float wisp = smoothstep(-0.4, 1.15, n);
        float dist = distance(vWorld.xz, uCam.xz);
        float fade = exp(-0.0042 * dist * dist);
        vec3 col = mix(uHorizon, uCool, 0.55);
        gl_FragColor = vec4(col, uAlpha * (0.45 + 0.55 * wisp) * fade);
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.zone = 'street'
  mesh.renderOrder = 2
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    mat.uniforms.uCam.value.copy(camera.position)
  }
  return mesh
}

export function createHaloTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  if (!g) throw new Error('halo canvas')
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,0.85)')
  grd.addColorStop(0.22, 'rgba(255,255,255,0.38)')
  grd.addColorStop(0.55, 'rgba(255,255,255,0.08)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** Low tier: one additive billboard per lantern. Mid uses half-resolution bloom instead. */
export function createLanternHalos(positions: THREE.Vector3[], color: THREE.Color): THREE.Sprite[] {
  const map = createHaloTexture()
  return positions.map(position => {
    const mat = new THREE.SpriteMaterial({
      map,
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.9,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.position.copy(position)
    sprite.scale.set(1.55, 1.55, 1)
    sprite.renderOrder = 3
    return sprite
  })
}

/**
 * Mid tier bloom. UnrealBloomPass blurs at half the composer resolution.
 * Scene draw counts are read from the beauty pass, not the blur quads.
 */
export function createBloom(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.18, 0.35, 1.15)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
  return { composer, bloom }
}

export function sceneDraws(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, composer: EffectComposer | null): { draws: number, triangles: number } {
  if (!composer) {
    renderer.render(scene, camera)
    return { draws: renderer.info.render.calls, triangles: renderer.info.render.triangles }
  }
  let draws = 0
  let triangles = 0
  const render = renderer.render.bind(renderer)
  renderer.render = function (object, cam) {
    render(object, cam)
    if (object === scene) {
      draws = renderer.info.render.calls
      triangles = renderer.info.render.triangles
    }
  } as typeof renderer.render
  try {
    composer.render()
  } finally {
    renderer.render = render
  }
  return { draws, triangles }
}

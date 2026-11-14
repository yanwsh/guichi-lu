import './ui.css'
import * as THREE from 'three'
import { ANIM_GLB_PATH, boneCoverage, HERO_GLB_PATH, NPC_GLB_PATH } from './anim'
import { createBloom, createLanternHalos, createSky, DUSK, FOG_DENSITY, kelvinColor, LANTERN, sceneDraws } from './atmosphere'
import { CameraRig } from './cameraRig'
import { Collider } from './collision'
import { FIGURE_TOP, Figure } from './figure'
import { cloneSkinned, loadCharacterGlb, loadSceneGlb, measureShop, readHooks, tintMeshes, yawFromFacing } from './gltf'
import { loadExternalTexture, resolveTextureCodec } from './textures'
import { Stick } from './input'
import { maxTextureSize, resolveMat, updateStyleLights, type MatMode } from './materials'
import { THIRD_PARTY } from './notices'
import { FrameWindow, readGpuRenderer } from './perf'
import { Walker } from './player'
import { pixelRatioFor, resolveQuality } from './quality'
import { SpikeSession } from './session'
import { buildWorld } from './whitebox'

const BUDGET = { draws: 100, shop: 60000, street: 90000, texture: 1024 }

const app = document.getElementById('app')
if (!app) throw new Error('missing #app')

const params = new URLSearchParams(location.search)
const profile = resolveQuality(location.search)
const mode: MatMode = resolveMat(location.search)
const showPerf = params.get('perf') === '1'
const shopGlb = params.get('shop') === 'glb'
const streetGlb = params.get('street') !== 'box'
const texCodec = resolveTextureCodec(location.search)
/** Outdoor exposure locked by the v02h street sample. Override on device with ?exp= and ?amb=. */
const DEFAULT_EXP = 1.28
const DEFAULT_AMB = 1.2

function queryNumber(name: string, fallback: number): number {
  const raw = params.get(name)
  if (raw == null || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(4, Math.max(0, value))
}

const exposure = queryNumber('exp', DEFAULT_EXP)
const ambient = queryNumber('amb', DEFAULT_AMB)

const mount = document.createElement('div')
mount.id = 'spikeRoot'
const zoneEl = document.createElement('div')
zoneEl.id = 'spikeZone'
const perfEl = document.createElement('div')
perfEl.id = 'spikePerf'
if (!showPerf) perfEl.classList.add('hidden')
const perfRows = ['tier', 'fps', 'p95', 'draw', 'tri', 'shop', 'street', 'tex', 'px', 'gpu', 'exp'].map(id => {
  const row = document.createElement('div')
  row.dataset.key = id
  perfEl.append(row)
  return row
})
const stickEl = document.createElement('div')
stickEl.id = 'spikeStick'
const actEl = document.createElement('button')
actEl.id = 'spikeAct'
actEl.type = 'button'
actEl.classList.add('hidden')
const dlgEl = document.createElement('div')
dlgEl.id = 'spikeDlg'
dlgEl.classList.add('hidden')
mount.append(zoneEl, perfEl, stickEl, actEl, dlgEl)
app.append(mount)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = exposure
renderer.shadowMap.enabled = profile.shadows
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.setClearColor(DUSK, 1)
mount.prepend(renderer.domElement)
const gpu = readGpuRenderer(renderer.getContext())

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(DUSK, FOG_DENSITY)
scene.background = null
scene.add(createSky())
scene.add(new THREE.AmbientLight(0x8ea4c8, ambient))
scene.add(new THREE.HemisphereLight(0x93a6c8, 0x3a342e, ambient * 0.55))
const sun = new THREE.DirectionalLight(0xb7c6e4, 0.32)
sun.position.set(-6, 7, -12)
scene.add(sun, sun.target)
if (profile.shadows) {
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  const cam = sun.shadow.camera
  cam.near = 0.4
  cam.far = 28
  cam.left = -8
  cam.right = 8
  cam.top = 8
  cam.bottom = -8
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
}

let shop: THREE.Object3D | null = null
if (shopGlb) {
  const url = `${import.meta.env.BASE_URL}assets/3d/SCN_SHOP_Interior_Whitebox.glb`
  shop = await loadSceneGlb(renderer, url, mode)
}
let streetScene: THREE.Object3D | null = null
if (streetGlb) {
  try {
    streetScene = await loadSceneGlb(renderer, `${import.meta.env.BASE_URL}assets/3d/SCN_LightFog_Sample_v02h.glb`, mode, { lookdev: true, zone: 'street' })
    if (texCodec === 'ktx2') {
      const trim = await loadExternalTexture(renderer, 'T_Trim_Jiangnan_baseColor', 'ktx2')
      if (!trim) console.info('3d spike: ktx2 trim is not authored yet, embedded webp stays')
      else applyTrim(streetScene, trim)
    }
  } catch (err) {
    console.warn('street lookdev skipped', err)
    streetScene = null
  }
}
const world = buildWorld(mode, shop, streetScene == null)
scene.add(world.root)
if (streetScene) world.root.add(streetScene)
if (shopGlb) {
  try {
    const wall = await loadSceneGlb(renderer, `${import.meta.env.BASE_URL}assets/3d/SM_STREET_WallA.glb`, mode)
    wall.position.set(5.2, 0, 0)
    wall.traverse(obj => { obj.userData.zone = 'street' })
    world.root.add(wall)
  } catch (err) {
    console.warn('street module skipped', err)
  }
}

const hooks = readHooks(world.root)
const streetMark = streetScene?.getObjectByName('REF_Spawn')
if (streetMark) {
  streetMark.getWorldPosition(hooks.spawn)
  const facing = streetMark.userData?.dengdu?.facing
  if (typeof facing === 'string') hooks.facing = facing
}
const body = new Collider(world.root, 'body')
const walls = new Collider(world.root, 'camera')
const walker = new Walker(hooks.spawn)
walker.yaw = yawFromFacing(hooks.facing)
walker.figure.setYaw(walker.yaw)
const base = import.meta.env.BASE_URL
const heroPromise = loadCharacterGlb(renderer, `${base}${HERO_GLB_PATH}`)
const npcPromise = loadCharacterGlb(renderer, `${base}${NPC_GLB_PATH}`)
const animPromise = loadCharacterGlb(renderer, `${base}${ANIM_GLB_PATH}`)
const session = new SpikeSession()
const sessionPromise = session.start(dlgEl, hooks.interacts)
const [hero, npcBody, animFile] = await Promise.all([heroPromise, npcPromise, animPromise])
const externalClips = animFile?.clips ?? []
if (hero && !walker.figure.useHero(hero.scene, hero.clips)) {
  console.info('3d spike: hero file has no idle/walk/talk/run clips, blocky body stays')
}
const heroCover = hero ? boneCoverage(walker.figure.root, externalClips) : { tracks: 0, hit: 0, missing: [] as string[] }
walker.figure.root.traverse(obj => {
  const mesh = obj as THREE.Mesh
  if (mesh.isMesh) mesh.castShadow = profile.shadows
})
const spawnCheck = walker.pos.clone()
body.resolve(walker.pos)
if (spawnCheck.distanceTo(walker.pos) > 0.08) console.error('spawn starts inside collision', walker.pos.x, walker.pos.z)
walker.figure.setPosition(walker.pos.x, 0, walker.pos.z)
scene.add(walker.figure.root)

const blob = new THREE.Mesh(
  new THREE.CircleGeometry(0.34, 16),
  new THREE.MeshBasicMaterial({ color: 0x140e16, transparent: true, opacity: 0.38, depthWrite: false }),
)
blob.rotation.x = -Math.PI / 2
blob.position.y = 0.03
blob.visible = !profile.shadows
scene.add(blob)

const npcs: { fig: Figure, x: number, z: number }[] = []
const npcSpec = [
  { name: 'YanGui', color: 0xe7b498, fallback: new THREE.Vector3(0.85, 0, 2), facing: '-X' },
  { name: 'LiangSuniang', color: 0xb7c0e4, fallback: new THREE.Vector3(0.95, 0, 4.6), facing: '-Z' },
  { name: 'Cheng', color: 0xf0d2a4, fallback: new THREE.Vector3(1.15, 0, -1.35), facing: '+Z' },
  { name: 'He', color: 0xa9c4a4, fallback: new THREE.Vector3(7.45, 0, -1.15), facing: '-X' },
]
let npcCover = { tracks: 0, hit: 0, missing: [] as string[] }
for (const spec of npcSpec) {
  const found = hooks.npcs.find(npc => npc.name === spec.name)
  const fig = new Figure(spec.color)
  const pos = found?.position ?? spec.fallback
  if (npcBody && externalClips.length) {
    const body = cloneSkinned(npcBody.scene)
    tintMeshes(body, spec.color)
    if (!fig.useHero(body, externalClips)) console.info('3d spike: external clips did not bind', spec.name)
  }
  fig.setPosition(pos.x, 0, pos.z)
  fig.setYaw(yawFromFacing(found?.facing ?? spec.facing))
  fig.root.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) mesh.castShadow = false
  })
  scene.add(fig.root)
  npcs.push({ fig, x: pos.x, z: pos.z })
}
if (npcs[0]) npcCover = boneCoverage(npcs[0].fig.root, externalClips)
if (heroCover.missing.length) console.warn('3d spike: hero clip tracks did not bind', `${heroCover.hit}/${heroCover.tracks}`, heroCover.missing.slice(0, 6))
if (npcCover.missing.length) console.warn('3d spike: npc clip tracks did not bind', `${npcCover.hit}/${npcCover.tracks}`, npcCover.missing.slice(0, 6))

const LANTERN_BUDGET = Math.min(4, profile.pointLights)
const pointLights: { light: THREE.PointLight, color: THREE.Color, position: THREE.Vector3 }[] = []
for (let i = 0; i < LANTERN_BUDGET; i++) {
  const color = new THREE.Color(0xffb35c)
  const light = new THREE.PointLight(color, 0, 4.5, 2)
  light.castShadow = false
  scene.add(light)
  pointLights.push({ light, color, position: new THREE.Vector3() })
}
function aimLanterns() {
  const ranked = [...hooks.lights].sort((a, b) => {
    const da = (a.position.x - walker.pos.x) ** 2 + (a.position.z - walker.pos.z) ** 2
    const db = (b.position.x - walker.pos.x) ** 2 + (b.position.z - walker.pos.z) ** 2
    return da - db
  })
  for (let i = 0; i < pointLights.length; i++) {
    const lamp = ranked[i]
    const item = pointLights[i]
    if (!lamp) {
      item.light.intensity = 0
      continue
    }
    const color = lamp.kelvin ? kelvinColor(lamp.kelvin) : new THREE.Color(lamp.color)
    const shopLamp = lamp.name.startsWith('LIGHT_Shop')
    item.color.copy(color)
    item.position.copy(lamp.position)
    item.light.color.copy(color)
    item.light.position.copy(lamp.position)
    item.light.position.y -= 0.55
    item.light.distance = lamp.range || (shopLamp ? 3.3 : 4.5)
    item.light.intensity = lamp.intensity ?? (mode === 'toon' ? (shopLamp ? 8.5 : 6) : (shopLamp ? 12 : 8))
  }
}
aimLanterns()
const halos: THREE.Sprite[] = []
if (!profile.bloom) {
  halos.push(...createLanternHalos(hooks.lights.map(lamp => lamp.position), LANTERN))
  for (const sprite of halos) scene.add(sprite)
}

await sessionPromise
const targets = new Map<string, THREE.Object3D>([
  ['TR_C01_03_BOWL_WEAR', world.bowl],
  ['TR_C01_01_PRICE', world.lamp],
])
const rig = new CameraRig(walls)
rig.yaw = walker.yaw
scene.add(rig.camera)
const bloom = profile.bloom ? createBloom(renderer, scene, rig.camera) : null
const stick = new Stick(stickEl, () => { void usePrompt() })
actEl.addEventListener('click', event => {
  event.stopPropagation()
  void usePrompt()
})

let dragging = false
let lastX = 0
let lastY = 0
renderer.domElement.addEventListener('pointerdown', event => {
  if (!session.holding) return
  dragging = true
  lastX = event.clientX
  lastY = event.clientY
})
renderer.domElement.addEventListener('pointermove', event => {
  if (!dragging) return
  session.drag(event.clientX - lastX, event.clientY - lastY)
  lastX = event.clientX
  lastY = event.clientY
})
const endDrag = () => { dragging = false }
renderer.domElement.addEventListener('pointerup', endDrag)
renderer.domElement.addEventListener('pointercancel', endDrag)

function resize() {
  const width = mount.clientWidth || window.innerWidth
  const height = mount.clientHeight || window.innerHeight
  renderer.setPixelRatio(pixelRatioFor(profile))
  renderer.setSize(width, height, false)
  rig.resize(width, height)
  if (bloom) {
    bloom.composer.setPixelRatio(renderer.getPixelRatio())
    bloom.composer.setSize(width, height)
  }
}
addEventListener('resize', resize)
resize()

const shopTris = countZone(world.root, 'shop')
const streetTris = countZone(world.root, 'street')
const shopMeasure = shop ? measureShop(shop) : null
const frameWindow = new FrameWindow()

const api = {
  ready: false,
  quality: profile.tier,
  material: mode,
  shopGlb,
  pixelRatio: renderer.getPixelRatio(),
  position: { x: 0, y: 0, z: 0 },
  yaw: walker.yaw,
  zone: 'shop',
  dialogueOpen: false,
  dialogueText: '',
  prompt: null as string | null,
  promptId: null as string | null,
  fps: 0,
  avg10: 0,
  p95: 0,
  draws: 0,
  triangles: 0,
  shopTris,
  streetTris,
  texture: 0,
  gpu,
  anim: 'idle',
  animMode: walker.figure.animMode,
  slide: 0,
  fit: null as null | { minY: number, maxY: number, minX: number, maxX: number, minZ: number, maxZ: number },
  clips: {
    hero: hero ? 'embedded' : 'fallback',
    npc: externalClips.length ? 'external' : 'fallback',
    heroTracks: heroCover.tracks,
    heroHit: heroCover.hit,
    npcTracks: npcCover.tracks,
    npcHit: npcCover.hit,
    heroMissing: heroCover.missing.slice(0, 8),
    npcMissing: npcCover.missing.slice(0, 8),
  },
  frame: { pitch: 0, height: 0, feet: 0, head: 0 },
  exp: exposure,
  amb: ambient,
  hold: null as null | { x: number, y: number, z: number, parent: string },
  shopMeasure,
  licenses: THIRD_PARTY,
  setStick(x: number, y: number) { stick.setForced(x, y) },
  clearStick() { stick.clearForced() },
  moveToward(x: number, z: number) {
    const dx = x - walker.pos.x
    const dz = z - walker.pos.z
    const len = Math.hypot(dx, dz)
    if (len < 0.2) {
      stick.clearForced()
      return
    }
    const yaw = rig.yaw
    const wx = dx / len
    const wz = dz / len
    stick.setForced(wx * Math.cos(yaw) - wz * Math.sin(yaw), wx * Math.sin(yaw) + wz * Math.cos(yaw))
  },
  interact() { void usePrompt() },
  advance() { session.advance() },
  drag(dx: number, dy: number) { session.drag(dx, dy) },
}
window.__DENGDU_3D = api

function usePrompt() {
  const id = session.prompt?.id
  void session.interact(id ? targets.get(id) ?? null : null, rig.camera)
}

const clock = new THREE.Clock()
const holdPoint = new THREE.Vector3()
const sky = scene.getObjectByName('SKY')
renderer.setAnimationLoop(() => {
  const raw = clock.getDelta()
  const dt = Math.min(raw, 0.05)
  frameWindow.push(clock.elapsedTime, raw)
  if (session.dialogueOpen) stick.reset()
  const sample = session.dialogueOpen ? { x: 0, y: 0 } : stick.sample()
  const yaw = rig.yaw
  const wishX = Math.cos(yaw) * sample.x + Math.sin(yaw) * sample.y
  const wishZ = -Math.sin(yaw) * sample.x + Math.cos(yaw) * sample.y
  const talking = session.dialogueOpen
  const talkFocus = talking && session.activeKind === 'talk' ? { x: session.activeX, z: session.activeZ } : null
  walker.update(dt, wishX, wishZ, body, clock.elapsedTime, talking, talkFocus)
  rig.update(dt, walker.pos, walker.yaw, world.occluders, talkFocus)
  for (const sprite of halos) {
    const dist = sprite.position.distanceTo(rig.camera.position)
    const mat = sprite.material as THREE.SpriteMaterial
    const gate = dist < 1.2 ? 0 : THREE.MathUtils.smoothstep(dist, 1.2, 2.5)
    mat.opacity = gate * 0.32
    sprite.visible = mat.opacity > 0.03
  }
  rig.measure(walker.pos, walker.figure.fit?.maxY ?? FIGURE_TOP)
  const partner = talking && session.activeKind === 'talk'
  for (const npc of npcs) {
    const near = partner && Math.hypot(npc.x - session.activeX, npc.z - session.activeZ) < 0.85
    if (near) npc.fig.aimAt(walker.pos.x, walker.pos.z, dt)
    else npc.fig.relax(dt)
    npc.fig.update(0, dt, clock.elapsedTime, near)
  }
  session.update(walker.pos.x, walker.pos.z, walker.yaw)
  blob.position.x = walker.pos.x
  blob.position.z = walker.pos.z
  if (sky) sky.position.copy(rig.camera.position)
  if (profile.shadows) {
    sun.position.set(walker.pos.x - 5, 7.5, walker.pos.z - 8)
    sun.target.position.set(walker.pos.x, 0.8, walker.pos.z)
    sun.target.updateMatrixWorld()
  }
  aimLanterns()
  updateStyleLights(
    world.styled,
    rig.camera.position,
    walker.pos,
    pointLights.map(item => ({ position: item.position, color: item.color })),
  )
  const zone = walker.pos.z > 0.2 ? '青蒲灯铺' : walker.pos.x < 3.2 && walker.pos.z > -2.2 ? '檐下' : '镇街'
  zoneEl.textContent = zone
  actEl.classList.toggle('hidden', talking || !session.prompt)
  stickEl.classList.toggle('hidden', talking)
  if (session.prompt) {
    actEl.textContent = session.prompt.word
    actEl.dataset.trigger = session.prompt.id
  } else delete actEl.dataset.trigger
  const drawn = sceneDraws(renderer, scene, rig.camera, bloom?.composer ?? null)
  const summary = frameWindow.summary()
  const tex = maxTextureSize()
  if (showPerf) {
    const tier = profile.tier === 'low' ? '低档' : '中档'
    setRow(perfRows[0], `${tier} ${mode}`, false)
    setRow(perfRows[1], `fps ${summary.fps.toFixed(0)}  均10秒 ${summary.avg10.toFixed(0)}`, false)
    setRow(perfRows[2], `p95 ${summary.p95ms.toFixed(1)} ms`, false)
    setRow(perfRows[3], `draw ${drawn.draws} / ${BUDGET.draws}`, drawn.draws > BUDGET.draws)
    setRow(perfRows[4], `三角 ${drawn.triangles}`, false)
    setRow(perfRows[5], `铺内 ${Math.round(shopTris)} / ${BUDGET.shop}`, shopTris > BUDGET.shop)
    setRow(perfRows[6], `镇街 ${Math.round(streetTris)} / ${BUDGET.street}`, streetTris > BUDGET.street)
    setRow(perfRows[7], `贴图 ${tex} / ${BUDGET.texture}`, tex > BUDGET.texture)
    setRow(perfRows[8], `px ${renderer.getPixelRatio().toFixed(2)}`, false)
    setRow(perfRows[9], `GPU ${gpu || '不可用'}`, false)
    setRow(perfRows[10], `exp ${exposure.toFixed(2)}  amb ${ambient.toFixed(2)}`, false)
  }
  api.ready = true
  api.pixelRatio = renderer.getPixelRatio()
  api.position = { x: walker.pos.x, y: walker.pos.y, z: walker.pos.z }
  api.yaw = walker.yaw
  api.zone = zone === '青蒲灯铺' ? 'shop' : zone === '檐下' ? 'door' : 'street'
  api.dialogueOpen = talking
  api.dialogueText = session.dialogueText
  api.prompt = session.prompt?.word ?? null
  api.promptId = session.prompt?.id ?? null
  api.fps = summary.fps
  api.avg10 = summary.avg10
  api.p95 = summary.p95ms
  api.draws = drawn.draws
  api.triangles = drawn.triangles
  api.texture = tex
  api.anim = walker.figure.state
  api.animMode = walker.figure.animMode
  api.slide = walker.figure.slide
  api.fit = walker.figure.fit
  api.frame = { ...rig.framing }
  if (session.holding) {
    const held = session.holding.getWorldPosition(holdPoint)
    api.hold = { x: held.x, y: held.y, z: held.z, parent: session.holding.parent?.type ?? '' }
  } else api.hold = null
})

function setRow(row: HTMLElement, text: string, bad: boolean) {
  row.textContent = text
  row.classList.toggle('bad', bad)
}

function countZone(root: THREE.Object3D, zone: string): number {
  let total = 0
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible || mesh.userData.zone !== zone) return
    const geo = mesh.geometry
    total += geo.index ? geo.index.count / 3 : (geo.getAttribute('position')?.count ?? 0) / 3
  })
  return total
}

function applyTrim(root: THREE.Object3D, tex: THREE.Texture) {
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of list) {
      if (mat?.name !== 'M_Trim_Jiangnan') continue
      const std = mat as THREE.MeshStandardMaterial
      std.map = tex
      std.needsUpdate = true
    }
  })
}

declare global {
  interface Window { __DENGDU_3D?: typeof api }
}

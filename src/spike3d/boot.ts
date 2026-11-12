import './ui.css'
import * as THREE from 'three'
import { Figure } from './figure'
import { CameraRig } from './cameraRig'
import { Collider } from './collision'
import { loadSceneGlb, measureShop, readHooks, yawFromFacing } from './gltf'
import { Stick } from './input'
import { maxTextureSize, resolveMat, updateStyleLights, type MatMode } from './materials'
import { THIRD_PARTY } from './notices'
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

const mount = document.createElement('div')
mount.id = 'spikeRoot'
const zoneEl = document.createElement('div')
zoneEl.id = 'spikeZone'
const perfEl = document.createElement('div')
perfEl.id = 'spikePerf'
if (!showPerf) perfEl.classList.add('hidden')
const perfRows = ['tier', 'draw', 'shop', 'street', 'tex', 'fps'].map(id => {
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
renderer.toneMappingExposure = 1.05
renderer.shadowMap.enabled = profile.shadows
renderer.shadowMap.type = THREE.PCFShadowMap
mount.prepend(renderer.domElement)

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0x6a78a4, 0.028)
scene.background = new THREE.Color(0x6678aa)
scene.add(new THREE.HemisphereLight(0xb7c6e4, 0x3a3050, 1.15))
const sun = new THREE.DirectionalLight(0xffc4a0, 1.35)
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
const world = buildWorld(mode, shop)
scene.add(world.root)
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
const body = new Collider(world.root, 'body')
const walls = new Collider(world.root, 'camera')
const walker = new Walker(hooks.spawn)
walker.yaw = yawFromFacing(hooks.facing)
walker.figure.setYaw(walker.yaw)
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

const npcs: Figure[] = []
const npcSpec = [
  { name: 'YanGui', color: 0x6a5348, fallback: new THREE.Vector3(0.85, 0, 2), facing: '-X' },
  { name: 'LiangSuniang', color: 0x5c6a78, fallback: new THREE.Vector3(0.95, 0, 4.6), facing: '-Z' },
  { name: 'Cheng', color: 0x7a5a48, fallback: new THREE.Vector3(1.15, 0, -1.35), facing: '+Z' },
  { name: 'He', color: 0x4e5a48, fallback: new THREE.Vector3(7.45, 0, -1.15), facing: '-X' },
]
for (const spec of npcSpec) {
  const found = hooks.npcs.find(npc => npc.name === spec.name)
  const fig = new Figure(spec.color)
  const pos = found?.position ?? spec.fallback
  fig.setPosition(pos.x, 0, pos.z)
  fig.setYaw(yawFromFacing(found?.facing ?? spec.facing))
  fig.root.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) mesh.castShadow = false
  })
  scene.add(fig.root)
  npcs.push(fig)
}

const lampOrder = ['LIGHT_Shop_Lantern_01', 'LIGHT_Street_Eave', 'LIGHT_Shop_Lantern_02', 'LIGHT_Street_Pharmacy']
const sorted = [...hooks.lights].sort((a, b) => rank(a.name, lampOrder) - rank(b.name, lampOrder))
const active = sorted.slice(0, profile.pointLights)
const pointLights: { light: THREE.PointLight, color: THREE.Color, position: THREE.Vector3 }[] = []
for (const lamp of active) {
  const color = new THREE.Color(lamp.color)
  const light = new THREE.PointLight(color, mode === 'toon' ? 28 : 36, lamp.range, 2)
  light.position.copy(lamp.position)
  light.castShadow = false
  scene.add(light)
  pointLights.push({ light, color, position: lamp.position })
}

const session = new SpikeSession()
await session.start(dlgEl, hooks.interacts)
const targets = new Map<string, THREE.Object3D>([
  ['TR_C01_03_BOWL_WEAR', world.bowl],
  ['TR_C01_01_PRICE', world.lamp],
])
const rig = new CameraRig(walls)
rig.yaw = walker.yaw
scene.add(rig.camera)
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
}
addEventListener('resize', resize)
resize()

const shopTris = countZone(world.root, 'shop')
const streetTris = countZone(world.root, 'street')
const shopMeasure = shop ? measureShop(shop) : null

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
  draws: 0,
  triangles: 0,
  shopTris,
  streetTris,
  texture: 0,
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

let frames = 0
let fpsAcc = 0
let fps = 0
const clock = new THREE.Clock()
const holdPoint = new THREE.Vector3()
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05)
  rig.talking = session.dialogueOpen
  if (session.dialogueOpen) stick.reset()
  const sample = session.dialogueOpen ? { x: 0, y: 0 } : stick.sample()
  const yaw = rig.yaw
  const wishX = Math.cos(yaw) * sample.x + Math.sin(yaw) * sample.y
  const wishZ = -Math.sin(yaw) * sample.x + Math.cos(yaw) * sample.y
  walker.update(dt, wishX, wishZ, body, clock.elapsedTime)
  rig.update(dt, walker.pos, walker.yaw, world.occluders)
  for (const npc of npcs) npc.update(0, dt, clock.elapsedTime)
  session.update(walker.pos.x, walker.pos.z, walker.yaw)
  blob.position.x = walker.pos.x
  blob.position.z = walker.pos.z
  if (profile.shadows) {
    sun.position.set(walker.pos.x - 5, 7.5, walker.pos.z - 8)
    sun.target.position.set(walker.pos.x, 0.8, walker.pos.z)
    sun.target.updateMatrixWorld()
  }
  updateStyleLights(world.styled, rig.camera.position, pointLights.map(item => ({ position: item.position, color: item.color })))
  const zone = walker.pos.z > 0.2 ? '青蒲灯铺' : walker.pos.x < 3.2 && walker.pos.z > -2.2 ? '檐下' : '镇街'
  zoneEl.textContent = zone
  const talking = session.dialogueOpen
  actEl.classList.toggle('hidden', talking || !session.prompt)
  stickEl.classList.toggle('hidden', talking)
  if (session.prompt) {
    actEl.textContent = session.prompt.word
    actEl.dataset.trigger = session.prompt.id
  } else delete actEl.dataset.trigger
  renderer.render(scene, rig.camera)
  frames += 1
  fpsAcc += dt
  if (fpsAcc >= 0.4) {
    fps = frames / fpsAcc
    frames = 0
    fpsAcc = 0
  }
  const draws = renderer.info.render.calls
  const triangles = renderer.info.render.triangles
  const tex = maxTextureSize()
  if (showPerf) {
    setRow(perfRows[0], `档位 ${profile.tier}  ${mode}`, false)
    setRow(perfRows[1], `draw ${draws} / ${BUDGET.draws}`, draws > BUDGET.draws)
    setRow(perfRows[2], `铺内 ${shopTris} / ${BUDGET.shop}`, shopTris > BUDGET.shop)
    setRow(perfRows[3], `镇街 ${streetTris} / ${BUDGET.street}`, streetTris > BUDGET.street)
    setRow(perfRows[4], `贴图 ${tex} / ${BUDGET.texture}`, tex > BUDGET.texture)
    setRow(perfRows[5], `fps ${fps.toFixed(0)}  px ${renderer.getPixelRatio().toFixed(2)}`, false)
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
  api.fps = fps
  api.draws = draws
  api.triangles = triangles
  api.texture = tex
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

function rank(name: string, order: string[]): number {
  const index = order.indexOf(name)
  return index === -1 ? order.length : index
}

declare global {
  interface Window { __DENGDU_3D?: typeof api }
}

import * as THREE from 'three'
import { createStyleMaterial, ensureStyleUv, shopLightmap, streetLightmap, type MatMode } from './materials'

export interface Built {
  root: THREE.Group
  bowl: THREE.Object3D
  lamp: THREE.Object3D
  occluders: THREE.Mesh[]
  styled: THREE.Material[]
}

/**
 * Procedural shop matches SCN_SHOP_Interior_Whitebox:
 * origin at the threshold, +X toward the pharmacy, +Z into the shop, beam clearance 2.8 m.
 * The street is outside, negative Z, 22 m along X by 3.2 m wide.
 */
export function buildWorld(mode: MatMode, shop: THREE.Object3D | null): Built {
  const root = new THREE.Group()
  root.name = 'WORLD'
  const styled: THREE.Material[] = []
  const occluders: THREE.Mesh[] = []
  if (!shop) root.add(buildShop(mode, styled, occluders))
  else {
    shop.userData.zone = 'shop'
    root.add(shop)
  }
  root.add(buildStreet(mode, styled, occluders))
  const bowl = makeBowl(mode)
  bowl.position.set(0.55, 0.86, 4.45)
  bowl.userData.zone = 'shop'
  bowl.userData.hold = 'bowl'
  root.add(bowl)
  const lamp = makeLamp(mode)
  lamp.position.set(-1.7, 0.95, 2.1)
  lamp.userData.zone = 'shop'
  lamp.userData.hold = 'lamp'
  root.add(lamp)
  placeAnchors(root)
  return { root, bowl, lamp, occluders, styled }
}

function lit(mode: MatMode, color: number, lightMap: THREE.Texture | null, streak = 0, rough = 0.75) {
  const mat = createStyleMaterial(mode, { color, lightMap, streak, roughness: rough })
  return mat
}

function buildShop(mode: MatMode, styled: THREE.Material[], occluders: THREE.Mesh[]) {
  const shop = new THREE.Group()
  shop.name = 'SHOP'
  const floorMat = lit(mode, 0x8a6244, shopLightmap())
  const plaster = lit(mode, 0xd8d0c2, null)
  const wood = lit(mode, 0x4a3220, null)
  const warm = lit(mode, 0x6e4a2c, null)
  styled.push(floorMat, plaster, wood, warm)
  const floor = new THREE.Mesh(plane(5.5, 7.5, 0, 3.75), floorMat)
  floor.receiveShadow = true
  floor.userData.zone = 'shop'
  shop.add(floor)
  box(shop, 'plaster', plaster, 5.8, 3, 0.15, 0, 1.5, 7.575, 'COL_Wall_Back')
  box(shop, 'plaster', plaster, 0.15, 3, 7.5, -2.825, 1.5, 3.75, 'COL_Wall_Left')
  box(shop, 'plaster', plaster, 0.15, 3, 7.5, 2.825, 1.5, 3.75, 'COL_Wall_Right')
  box(shop, 'plaster', plaster, 1.85, 3, 0.15, -1.825, 1.5, 0.075, 'COL_Wall_FrontL')
  box(shop, 'plaster', plaster, 1.85, 3, 0.15, 1.825, 1.5, 0.075, 'COL_Wall_FrontR')
  box(shop, 'wood', wood, 1.8, 0.6, 0.15, 0, 2.7, 0.075, 'COL_Wall_FrontLint')
  box(shop, 'wood', warm, 0.6, 0.85, 2.4, 1.45, 0.425, 2, 'COL_Counter')
  box(shop, 'wood', warm, 0.7, 0.8, 2.8, -1.7, 0.4, 3.2, 'COL_Worktable')
  box(shop, 'wood', warm, 1.2, 0.75, 0.8, 0.15, 0.375, 4.6, 'COL_TableDining')
  box(shop, 'wood', wood, 0.9, 2.6, 4, -2.3, 1.3, 5.35, 'COL_Stairs')
  box(shop, 'plaster', plaster, 5.5, 0.12, 7.5, 0, 2.9, 3.75)
  box(shop, 'wood', wood, 2.4, 2.2, 0.34, 0.6, 1.2, 7.3, 'COL_Shelf')
  const beamMat = lit(mode, 0x3a2a22, null)
  styled.push(beamMat)
  for (const z of [1.6, 3.6, 5.6]) {
    const beam = box(shop, 'beam', beamMat, 5.2, 0.14, 0.16, 0, 2.78, z)
    beam.userData.occluder = true
    occluders.push(beam)
  }
  colOnly(shop, 'COL_LoftBlock', 5.5, 1.4, 7.5, 0, 3.5, 3.75)
  colOnly(shop, 'COL_CAM_Beams', 5.5, 0.2, 7.5, 0, 2.8, 3.75)
  const glass = lit(mode, 0x8ea4c4, null, 0, 0.2)
  glass.transparent = true
  glass.opacity = 0.35
  styled.push(glass)
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), glass)
  win.position.set(-2.74, 1.45, 2.2)
  win.rotation.y = Math.PI / 2
  win.userData.zone = 'shop'
  shop.add(win)
  hangLantern(shop, mode, styled, occluders, 'LIGHT_Shop_Lantern_01', 0, 2.35, 1.8)
  hangLantern(shop, mode, styled, occluders, 'LIGHT_Shop_Lantern_02', -1.2, 2.35, 3.4)
  anchor(shop, 'SPAWN_player', 0, 0, 1.5, { facing: '+Z' })
  anchor(shop, 'NPC_YanGui', 0.85, 0, 2, { facing: '-X' })
  anchor(shop, 'NPC_LiangSuniang', 0.95, 0, 4.6, { facing: '-Z', idle_only: true })
  anchor(shop, 'INT_TR_C01_02_YANGUI_IN', 0.85, 0, 2, { radius_m: 1.5, role: 'talk' })
  anchor(shop, 'INT_TR_C01_03_BOWL_WEAR', 0.55, 0.78, 4.45, { radius_m: 1, role: 'inspect' })
  anchor(shop, 'INT_TR_C01_01_PRICE', -1.7, 0.85, 2.1, { radius_m: 1, role: 'inspect' })
  return shop
}

function buildStreet(mode: MatMode, styled: THREE.Material[], occluders: THREE.Mesh[]) {
  const street = new THREE.Group()
  street.name = 'STREET'
  const stone = lit(mode, 0x8a8178, streetLightmap(), 1.55, 0.55)
  const plaster = lit(mode, 0xc9bfb4, null)
  const timber = lit(mode, 0x4a3428, null)
  const river = lit(mode, 0x3d5168, null, 0.85, 0.18)
  styled.push(stone, plaster, timber, river)
  const slab = new THREE.Mesh(plane(22, 3.2, 5, -1.9), stone)
  slab.receiveShadow = true
  slab.userData.zone = 'street'
  street.add(slab)
  const water = new THREE.Mesh(plane(28, 14, 4, -12), river)
  water.userData.zone = 'street'
  street.add(water)
  box(street, 'stone', plaster, 22, 0.9, 0.35, 5, 0.45, -3.55, 'COL_Bank')
  box(street, 'stone', plaster, 0.4, 2.2, 3.2, -6.2, 1.1, -1.9, 'COL_StreetWest')
  box(street, 'stone', plaster, 0.4, 2.2, 3.2, 16.2, 1.1, -1.9, 'COL_StreetEast')
  box(street, 'house', plaster, 8, 4.2, 3.2, 10.2, 2.1, 1.7, 'COL_ShopRow')
  const eave = box(street, 'eave', timber, 6.4, 0.12, 2.3, 0.2, 2.68, -1.05)
  eave.userData.occluder = true
  occluders.push(eave)
  colOnly(street, 'COL_CAM_Eave', 6.4, 0.16, 2.3, 0.2, 2.68, -1.05)
  for (const x of [-2.4, 2.6]) {
    box(street, 'post', timber, 0.14, 2.6, 0.14, x, 1.3, -1.7, `COL_Post_${x}`)
  }
  hangLantern(street, mode, styled, occluders, 'LIGHT_Street_Eave', 0.2, 2.42, -1.25)
  hangLantern(street, mode, styled, occluders, 'LIGHT_Street_Pharmacy', 7, 2.45, -1.35)
  box(street, 'stall', timber, 0.7, 0.72, 0.5, 7, 0.36, -1.45, 'COL_Pharmacy')
  anchor(street, 'INT_TR_C01_01_CHENG', 1.15, 0, -1.15, { radius_m: 1.5, role: 'talk' })
  anchor(street, 'INT_TR_C01_01_HE', 7, 0, -1.5, { radius_m: 1.5, role: 'talk' })
  anchor(street, 'NPC_Cheng', 1.15, 0, -1.35, { facing: '+Z' })
  anchor(street, 'NPC_He', 7.45, 0, -1.15, { facing: '-X' })
  farScenery(street, mode, styled)
  return street
}

function farScenery(street: THREE.Group, mode: MatMode, styled: THREE.Material[]) {
  const stone = lit(mode, 0x6e6a78, null)
  const hull = lit(mode, 0x2e3438, null)
  styled.push(stone, hull)
  for (const z of [-36.6, -37.5]) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.28, 5, 12, Math.PI), stone)
    arch.position.set(2.2, 0, z)
    arch.userData.zone = 'street'
    street.add(arch)
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(8, 0.28, 1.6), stone)
  deck.position.set(2.2, 3.15, -37)
  deck.userData.zone = 'street'
  street.add(deck)
  const boat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.45, 1.1), hull)
  boat.position.set(6.4, 0.28, -28)
  boat.userData.zone = 'street'
  street.add(boat)
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.8), hull)
  cabin.position.set(6.2, 0.75, -28)
  cabin.userData.zone = 'street'
  street.add(cabin)
}

function placeAnchors(root: THREE.Group) {
  // Anchors are parented inside shop/street groups already.
  void root
}

function hangLantern(parent: THREE.Object3D, mode: MatMode, styled: THREE.Material[], occluders: THREE.Mesh[], name: string, x: number, y: number, z: number) {
  const glow = lit(mode, 0xffc48a, null)
  const mat = glow as THREE.MeshLambertMaterial
  mat.emissive?.set?.(0xff6a1a)
  if ('emissive' in mat) {
    mat.emissive = new THREE.Color(0xff6a1a)
    mat.emissiveIntensity = mode === 'toon' ? 0.8 : 2.4
  }
  styled.push(glow)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.26), glow)
  mesh.position.set(x, y, z)
  mesh.userData.occluder = true
  mesh.userData.zone = name.startsWith('LIGHT_Shop') ? 'shop' : 'street'
  mesh.name = `${name}_mesh`
  parent.add(mesh)
  occluders.push(mesh)
  anchor(parent, name, x, y, z, { color: '#ffb35c', range_m: 4.5, kelvin: 2000 })
}

function makeBowl(mode: MatMode): THREE.Group {
  const clay = lit(mode, 0xc4a488, null, 0, 0.6)
  const wear = lit(mode, 0x3a2418, null, 0, 0.95)
  const group = new THREE.Group()
  group.name = 'PROP_BOWL'
  const side = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.065, 0.05, 12, 1, true), clay)
  side.position.y = 0.03
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.065, 12), clay)
  bottom.rotation.x = Math.PI / 2
  bottom.position.y = 0.006
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 16), wear)
  ring.userData.wear = true
  ring.rotation.x = Math.PI / 2
  ring.position.y = -0.002
  group.add(side, bottom, ring)
  group.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      ensureStyleUv(mesh.geometry)
      mesh.castShadow = false
      mesh.userData.zone = 'shop'
    }
  })
  return group
}

function makeLamp(mode: MatMode): THREE.Group {
  const paper = lit(mode, 0xf0d7b0, null, 0, 0.55)
  paper.side = THREE.DoubleSide
  paper.transparent = true
  paper.opacity = 0.92
  const rib = lit(mode, 0x6a4a30, null)
  const group = new THREE.Group()
  group.name = 'PROP_LAMP'
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.18, 8, 1, true), paper)
  group.add(shell)
  for (let i = 0; i < 4; i++) {
    const bone = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.012), rib)
    const a = (i / 4) * Math.PI * 2
    bone.position.set(Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07)
    group.add(bone)
  }
  group.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      ensureStyleUv(mesh.geometry)
      mesh.userData.zone = 'shop'
    }
  })
  return group
}

function plane(w: number, h: number, x: number, z: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, h, 1, 1)
  geo.rotateX(-Math.PI / 2)
  geo.translate(x, 0.01, z)
  ensureStyleUv(geo)
  return geo
}

function box(parent: THREE.Object3D, zone: string, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, colName?: string) {
  const geo = new THREE.BoxGeometry(w, h, d)
  ensureStyleUv(geo)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(x, y, z)
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.userData.zone = zone === 'beam' || zone === 'eave' || zone === 'post' || zone === 'stall' || zone === 'house' || zone === 'stone' ? (z < 0 ? 'street' : 'shop') : (z < 0.2 && zone !== 'plaster' && zone !== 'wood' ? 'street' : 'shop')
  if (zone === 'house' || zone === 'stone' || zone === 'eave' || zone === 'post' || zone === 'stall') mesh.userData.zone = 'street'
  if (zone === 'plaster' || zone === 'wood' || zone === 'beam') mesh.userData.zone = z < -0.2 ? 'street' : 'shop'
  parent.add(mesh)
  if (colName) colOnly(parent, colName, w, h, d, x, y, z)
  return mesh
}

function colOnly(parent: THREE.Object3D, name: string, w: number, h: number, d: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d))
  mesh.name = name
  mesh.position.set(x, y, z)
  mesh.visible = false
  parent.add(mesh)
}

function anchor(parent: THREE.Object3D, name: string, x: number, y: number, z: number, dengdu: Record<string, unknown>) {
  const obj = new THREE.Object3D()
  obj.name = name
  obj.position.set(x, y, z)
  obj.userData.dengdu = dengdu
  parent.add(obj)
}

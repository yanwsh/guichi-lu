import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { ensureStyleUv, type MatMode, restyleMesh } from './materials'

/**
 * glTF node contract for later art. Names are matched by prefix.
 *
 * - COL_*        character collision. Hidden. COL_CAM_* is not included here.
 * - COL_CAM_*    camera collision only (beams, lintel, hanging lanterns, eaves).
 * - INT_<id>     interaction anchor. Radius from extras.dengdu.radius_m, else extras.radius.
 *                INT_TODO_REPAIRED_LAMP is the whitebox alias of TR_C01_01_PRICE.
 * - INT_TODO_*   ignored, except the repaired-lamp alias above.
 * - LIGHT_<zone>_<name>  point-light anchor. Color, range and kelvin from extras.dengdu.
 * - LIGHT_TODO_* ignored.
 * - SPAWN_player or REF_Spawn  feet position. extras.dengdu.facing is +Z / -Z / +X / -X.
 * - NPC_<name>   stand-in position.
 * - extras.lightmap  texture index or embedded texture used as a UV2 (styleUv) light map.
 * - extras.dengdu.hide_on_load and role "scale_ref" are not rendered.
 */
export interface LightAnchor {
  name: string
  position: THREE.Vector3
  color: string
  range: number
}

export interface InteractAnchor {
  id: string
  position: THREE.Vector3
  radius: number
}

export interface NpcAnchor {
  name: string
  position: THREE.Vector3
  facing: string
}

export interface SceneHooks {
  spawn: THREE.Vector3
  facing: string
  interacts: InteractAnchor[]
  lights: LightAnchor[]
  npcs: NpcAnchor[]
}

const LAMP_ALIAS: Record<string, string> = {
  INT_TODO_REPAIRED_LAMP: 'TR_C01_01_PRICE',
}

export async function loadSceneGlb(renderer: THREE.WebGLRenderer, url: string, mode: MatMode): Promise<THREE.Group> {
  await MeshoptDecoder.ready
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  const ktx2 = new KTX2Loader()
  ktx2.detectSupport(renderer)
  loader.setKTX2Loader(ktx2)
  try {
    const gltf = await loader.loadAsync(url)
    await bindLightmapExtras(gltf)
    gltf.scene.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const role = mesh.userData?.dengdu?.role
      const hidden = mesh.userData?.dengdu?.hide_on_load || mesh.name.startsWith('COL_') || role === 'scale_ref'
      if (hidden) {
        mesh.visible = false
        return
      }
      ensureStyleUv(mesh.geometry)
      restyleMesh(mesh, mode)
      mesh.castShadow = false
      mesh.receiveShadow = true
      mesh.userData.zone = mesh.userData.zone || 'shop'
    })
    return gltf.scene
  } finally {
    ktx2.dispose()
  }
}

async function bindLightmapExtras(gltf: { parser: { json: { materials?: { name?: string, extras?: Record<string, unknown> }[] }, getDependency: (type: string, index: number) => Promise<THREE.Texture> }, scene: THREE.Object3D }) {
  const materials = gltf.parser.json.materials ?? []
  const byName = new Map<string, THREE.Texture>()
  for (const mat of materials) {
    const idx = mat.extras?.lightmap ?? (mat.extras?.dengdu as { lightmap?: number } | undefined)?.lightmap
    if (typeof idx !== 'number') continue
    const tex = await gltf.parser.getDependency('texture', idx)
    tex.channel = 2
    if (mat.name) byName.set(mat.name, tex)
  }
  if (byName.size === 0) return
  gltf.scene.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const name = (mesh.material as THREE.Material)?.name
    const tex = name ? byName.get(name) : undefined
    if (!tex) return
    const geo = mesh.geometry
    if (!geo.getAttribute('uv2') && geo.getAttribute('uv')) geo.setAttribute('uv2', geo.getAttribute('uv'))
    ensureStyleUv(geo)
    mesh.userData.lightMapTexture = tex
  })
}

export function readHooks(root: THREE.Object3D): SceneHooks {
  const hooks: SceneHooks = {
    spawn: new THREE.Vector3(0, 0, 1.5),
    facing: '+Z',
    interacts: [],
    lights: [],
    npcs: [],
  }
  root.updateMatrixWorld(true)
  root.traverse(obj => {
    const name = obj.name || ''
    const extra = (obj.userData?.dengdu ?? {}) as {
      radius_m?: number
      color?: string
      range_m?: number
      kelvin?: number
      facing?: string
      hide_on_load?: boolean
      role?: string
    }
    if (extra.hide_on_load || extra.role === 'scale_ref') obj.visible = false
    if (name.startsWith('LIGHT_TODO_')) return
    if (name.startsWith('INT_TODO_') && !LAMP_ALIAS[name]) return
    if (name.startsWith('INT_')) {
      const id = LAMP_ALIAS[name] ?? name.slice(4)
      hooks.interacts.push({
        id,
        position: obj.getWorldPosition(new THREE.Vector3()),
        radius: extra.radius_m ?? (obj.userData.radius as number | undefined) ?? (id === 'TR_C01_03_BOWL_WEAR' || id === 'TR_C01_01_PRICE' ? 1 : 1.5),
      })
    } else if (name.startsWith('LIGHT_')) {
      hooks.lights.push({
        name,
        position: obj.getWorldPosition(new THREE.Vector3()),
        color: extra.color ?? '#ffb35c',
        range: extra.range_m ?? 4.5,
      })
    } else if (name === 'SPAWN_player' || name === 'REF_Spawn') {
      hooks.spawn.copy(obj.getWorldPosition(new THREE.Vector3()))
      if (extra.facing) hooks.facing = extra.facing
    } else if (name.startsWith('NPC_')) {
      hooks.npcs.push({
        name: name.slice(4),
        position: obj.getWorldPosition(new THREE.Vector3()),
        facing: extra.facing ?? '+Z',
      })
    }
  })
  return hooks
}

/** +Z yaw is 0. Positive yaw turns toward +X. */
export function yawFromFacing(facing: string): number {
  if (facing === '+X') return Math.PI / 2
  if (facing === '-X') return -Math.PI / 2
  if (facing === '-Z') return Math.PI
  return 0
}

export function measureShop(root: THREE.Object3D): { width: number, depth: number, top: number, spawnZ: number } {
  const box = new THREE.Box3()
  root.updateMatrixWorld(true)
  root.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible) return
    if (mesh.userData.zone === 'street') return
    box.expandByObject(mesh)
  })
  return {
    width: box.max.x - box.min.x,
    depth: box.max.z - box.min.z,
    top: box.max.y,
    spawnZ: 1.5,
  }
}

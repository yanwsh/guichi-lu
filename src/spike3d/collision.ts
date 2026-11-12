import * as THREE from 'three'
import { MeshBVH, type HitPointInfo } from 'three-mesh-bvh'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const RADIUS = 0.22
const HEIGHT = 1.58

/** Static COL_* meshes baked into one BVH. The player is a vertical capsule; the camera raycasts the same tree. */
export class Collider {
  private bvh: MeshBVH
  private seg = new THREE.Line3()
  private triPoint = new THREE.Vector3()
  private capPoint = new THREE.Vector3()
  private dir = new THREE.Vector3()
  private segBox = new THREE.Box3()
  private ray = new THREE.Ray()
  private hitInfo: HitPointInfo = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }

  /** `body` ignores COL_CAM_* (camera-only). `camera` includes walls and COL_CAM_*. */
  constructor(root: THREE.Object3D, mode: 'body' | 'camera') {
    root.updateMatrixWorld(true)
    const geos: THREE.BufferGeometry[] = []
    root.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh || !mesh.name.startsWith('COL_')) return
      if (mode === 'body' && mesh.name.startsWith('COL_CAM_')) return
      geos.push(positionsOnly(mesh))
    })
    const merged = mergeGeometries(geos, false)
    for (const geo of geos) geo.dispose()
    if (!merged) throw new Error('3d spike: scene has no COL_ meshes')
    this.bvh = new MeshBVH(merged)
  }

  /** Keep the feet on y=0 and push the capsule out of walls in XZ. */
  resolve(pos: THREE.Vector3): void {
    this.seg.start.set(pos.x, RADIUS, pos.z)
    this.seg.end.set(pos.x, HEIGHT - RADIUS, pos.z)
    for (let iter = 0; iter < 4; iter++) {
      let hit = false
      this.bvh.shapecast({
        intersectsBounds: box => {
          this.segBox.min.set(
            Math.min(this.seg.start.x, this.seg.end.x) - RADIUS,
            Math.min(this.seg.start.y, this.seg.end.y) - RADIUS,
            Math.min(this.seg.start.z, this.seg.end.z) - RADIUS,
          )
          this.segBox.max.set(
            Math.max(this.seg.start.x, this.seg.end.x) + RADIUS,
            Math.max(this.seg.start.y, this.seg.end.y) + RADIUS,
            Math.max(this.seg.start.z, this.seg.end.z) + RADIUS,
          )
          return box.intersectsBox(this.segBox)
        },
        intersectsTriangle: tri => {
          const dist = tri.closestPointToSegment(this.seg, this.triPoint, this.capPoint)
          if (dist < RADIUS) {
            this.dir.subVectors(this.capPoint, this.triPoint)
            this.dir.y = 0
            if (this.dir.lengthSq() > 1e-8) {
              this.dir.normalize().multiplyScalar(RADIUS - dist + 0.002)
              this.seg.start.add(this.dir)
              this.seg.end.add(this.dir)
              hit = true
            }
          }
          return false
        },
      })
      if (!hit) break
    }
    pos.x = this.seg.start.x
    pos.y = 0
    pos.z = this.seg.start.z
  }

  /** Distance to the first surface along a normalized direction, or null. */
  rayDistance(origin: THREE.Vector3, direction: THREE.Vector3, far: number): number | null {
    this.ray.origin.copy(origin)
    this.ray.direction.copy(direction)
    const hit = this.bvh.raycastFirst(this.ray, THREE.DoubleSide, 0, far)
    return hit ? hit.distance : null
  }

  /** Move a camera sphere out of the collision mesh. */
  pushOut(pos: THREE.Vector3, radius: number, fallback: THREE.Vector3): void {
    const info = this.bvh.closestPointToPoint(pos, this.hitInfo)
    if (!info || info.distance >= radius) return
    this.dir.subVectors(pos, info.point)
    if (this.dir.lengthSq() < 1e-8) this.dir.subVectors(fallback, pos)
    if (this.dir.lengthSq() < 1e-8) this.dir.set(0, 1, 0)
    this.dir.normalize()
    pos.copy(info.point).addScaledVector(this.dir, radius + 0.03)
  }
}

function positionsOnly(mesh: THREE.Mesh): THREE.BufferGeometry {
  const pos = mesh.geometry.getAttribute('position')
  const index = mesh.geometry.getIndex()
  const count = index ? index.count : pos.count
  const arr = new Float32Array(count * 3)
  const vertex = new THREE.Vector3()
  for (let i = 0; i < count; i++) {
    vertex.fromBufferAttribute(pos, index ? index.getX(i) : i)
    arr[i * 3] = vertex.x
    arr[i * 3 + 1] = vertex.y
    arr[i * 3 + 2] = vertex.z
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  geo.applyMatrix4(mesh.matrixWorld)
  return geo
}

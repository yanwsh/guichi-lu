import * as THREE from 'three'
import { Collider } from './collision'

const PITCH = THREE.MathUtils.degToRad(20)
const OUTDOOR = 3.45
const INDOOR = 2.4
const MIN_DIST = 0.9
const SHOULDER = 0.26

/** Pitch stays near 20°. Indoors the spring arm shortens; dialogue shortens it a little more. */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(64, 9 / 16, 0.05, 140)
  yaw = 0
  talking = false
  private booted = false
  private look = new THREE.Vector3()
  private desired = new THREE.Vector3()
  private ahead = new THREE.Vector3()
  private right = new THREE.Vector3()
  private origin = new THREE.Vector3()
  private ray = new THREE.Raycaster()

  constructor(private walls: Collider) {}

  resize(width: number, height: number) {
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  update(dt: number, player: THREE.Vector3, playerYaw: number, occluders: THREE.Mesh[]) {
    const k = 1 - Math.exp(-5 * dt)
    this.yaw += Math.atan2(Math.sin(playerYaw - this.yaw), Math.cos(playerYaw - this.yaw)) * k
    const indoors = player.z > 0.25 && player.z < 7.2 && Math.abs(player.x) < 2.65
    let dist = indoors ? INDOOR : OUTDOOR
    if (this.talking) dist *= 0.74
    this.look.set(player.x, 1.05, player.z)
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    const backX = -sin
    const backZ = -cos
    this.right.set(cos, 0, -sin)
    const reach = this.clearance(dist, backX, backZ)
    const used = Math.max(MIN_DIST, Math.min(dist, reach))
    const shoulder = SHOULDER * Math.min(1, used / 2)
    this.desired.set(
      this.look.x + backX * used * Math.cos(PITCH) + this.right.x * shoulder,
      this.look.y + used * Math.sin(PITCH),
      this.look.z + backZ * used * Math.cos(PITCH) + this.right.z * shoulder,
    )
    if (!this.booted) {
      this.camera.position.copy(this.desired)
      this.booted = true
    } else {
      const pull = used < dist - 0.05 ? 16 : 5
      this.camera.position.lerp(this.desired, 1 - Math.exp(-pull * dt))
    }
    this.walls.pushOut(this.camera.position, 0.14, this.look)
    this.camera.lookAt(this.look)
    this.fade(occluders)
  }

  private clearance(dist: number, backX: number, backZ: number): number {
    this.origin.copy(this.look)
    this.ahead.set(backX * Math.cos(PITCH), Math.sin(PITCH), backZ * Math.cos(PITCH)).normalize()
    const hit = this.walls.rayDistance(this.origin, this.ahead, dist + 0.25)
    if (hit === null) return dist
    return Math.max(MIN_DIST, hit - 0.22)
  }

  private fade(occluders: THREE.Mesh[]) {
    for (const mesh of occluders) {
      const mat = mesh.material as THREE.MeshLambertMaterial
      if (!mat.userData.baseOpacity) mat.userData.baseOpacity = mat.opacity
      mat.opacity = mat.userData.baseOpacity
      mat.transparent = mat.userData.baseOpacity < 0.99
      mat.depthWrite = !mat.transparent
    }
    this.ray.set(this.camera.position, this.look.clone().sub(this.camera.position).normalize())
    this.ray.far = this.camera.position.distanceTo(this.look) - 0.15
    const hits = this.ray.intersectObjects(occluders, false)
    for (const hit of hits) {
      const mat = (hit.object as THREE.Mesh).material as THREE.MeshLambertMaterial
      mat.transparent = true
      mat.opacity = 0.22
      mat.depthWrite = false
    }
  }
}

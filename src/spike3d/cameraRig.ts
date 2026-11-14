import * as THREE from 'three'
import { Collider } from './collision'

const PITCH = THREE.MathUtils.degToRad(20)
const PITCH_MIN = THREE.MathUtils.degToRad(15)
const PITCH_MAX = THREE.MathUtils.degToRad(25)
const DIST = 4.6
const LOOK_Y = 0.88
const SHOULDER = 0.32
const MIN_DIST = 0.85
const FOV = 54

/**
 * Portrait third person, from behind and a little to the side.
 * Vertical fov 54°, pitch 20°, spring arm 4.6 m. At 390×844 the body is about
 * 31% of the screen height and the feet sit on the top edge of the lower third.
 * Indoors the arm stays long: the camera sits up under the beams instead of dollying in.
 * A wall shortens the arm only after pitch has ducked toward 15°.
 *
 * The open doorway lets this arm sit outside at the 1.5 m spawn. A camera that must
 * stay indoors behind that spawn needs about 4.4 m of clear depth behind the body
 * and a beam soffit at or above 2.70 m. With 1.5 m of room still in front of the
 * body, the hall wants about 6.3 m of depth. The 5.5 m width is enough.
 */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(FOV, 9 / 16, 0.08, 140)
  yaw = 0
  pitch = PITCH
  readonly framing = { pitch: 20, height: 0, feet: 0, head: 0 }
  private booted = false
  private look = new THREE.Vector3()
  private desired = new THREE.Vector3()
  private delta = new THREE.Vector3()
  private head = new THREE.Vector3()
  private feet = new THREE.Vector3()
  private ray = new THREE.Raycaster()

  constructor(private walls: Collider) {}

  resize(width: number, height: number) {
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  update(dt: number, player: THREE.Vector3, playerYaw: number, occluders: THREE.Mesh[]) {
    if (!this.booted) this.yaw = playerYaw
    else {
      const turn = Math.atan2(Math.sin(playerYaw - this.yaw), Math.cos(playerYaw - this.yaw))
      this.yaw += turn * (1 - Math.exp(-4.5 * dt))
    }
    this.look.set(player.x, LOOK_Y, player.z)
    this.place(this.desired, DIST, PITCH)
    this.resolve(this.desired)
    if (!this.booted) {
      this.camera.position.copy(this.desired)
      this.booted = true
    } else {
      this.camera.position.lerp(this.desired, 1 - Math.exp(-8 * dt))
      this.walls.pushOut(this.camera.position, 0.16, this.look)
      this.enforcePitch(this.camera.position)
    }
    this.camera.lookAt(this.look)
    this.fade(occluders)
  }

  /** Project the body. `height` is the top of the head in metres. */
  measure(player: THREE.Vector3, height: number) {
    this.camera.updateMatrixWorld()
    this.head.set(player.x, height, player.z).project(this.camera)
    this.feet.set(player.x, 0, player.z).project(this.camera)
    const headV = (1 - this.head.y) / 2
    const feetV = (1 - this.feet.y) / 2
    this.framing.head = headV
    this.framing.feet = feetV
    this.framing.height = Math.max(0, feetV - headV)
    this.framing.pitch = THREE.MathUtils.radToDeg(this.pitch)
  }

  private place(out: THREE.Vector3, dist: number, pitch: number) {
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    const backX = -sin
    const backZ = -cos
    const shoulder = SHOULDER * Math.min(1, dist / 2.2)
    out.set(
      this.look.x + backX * dist * Math.cos(pitch) + cos * shoulder,
      this.look.y + dist * Math.sin(pitch),
      this.look.z + backZ * dist * Math.cos(pitch) - sin * shoulder,
    )
  }

  /** Duck under a beam before giving up distance. Never pitch outside 15–25°. */
  private resolve(out: THREE.Vector3) {
    let pitch = PITCH
    let dist = DIST
    for (let i = 0; i < 5; i++) {
      this.place(out, dist, pitch)
      this.delta.subVectors(out, this.look)
      const len = this.delta.length()
      if (len < 0.05) break
      this.delta.multiplyScalar(1 / len)
      const hit = this.walls.rayDistance(this.look, this.delta, len + 0.08)
      if (hit === null || hit > len - 0.04) break
      if (pitch > PITCH_MIN + 0.02) {
        pitch = Math.max(PITCH_MIN, pitch - THREE.MathUtils.degToRad(1.5))
        continue
      }
      dist = Math.max(MIN_DIST, hit - 0.28)
    }
    this.place(out, dist, pitch)
    this.walls.pushOut(out, 0.16, this.look)
    this.enforcePitch(out)
  }

  private enforcePitch(pos: THREE.Vector3) {
    const horiz = Math.hypot(pos.x - this.look.x, pos.z - this.look.z)
    if (horiz < 0.08) {
      this.pitch = PITCH
      return
    }
    let pitch = Math.atan2(pos.y - this.look.y, horiz)
    const next = THREE.MathUtils.clamp(pitch, PITCH_MIN, PITCH_MAX)
    if (Math.abs(next - pitch) > 0.01) {
      pos.y = this.look.y + Math.tan(next) * horiz
      this.walls.pushOut(pos, 0.16, this.look)
      const horiz2 = Math.hypot(pos.x - this.look.x, pos.z - this.look.z)
      pitch = horiz2 < 0.08 ? next : Math.atan2(pos.y - this.look.y, horiz2)
    }
    this.pitch = pitch
  }

  private fade(occluders: THREE.Mesh[]) {
    for (const mesh of occluders) {
      const mat = mesh.material as THREE.MeshLambertMaterial
      if (Array.isArray(mat)) continue
      if (mat.userData.baseOpacity === undefined) mat.userData.baseOpacity = mat.opacity
      mat.opacity = mat.userData.baseOpacity as number
      mat.transparent = (mat.userData.baseOpacity as number) < 0.99
      mat.depthWrite = !mat.transparent
    }
    this.delta.subVectors(this.look, this.camera.position)
    const reach = this.delta.length()
    if (reach < 0.2) return
    this.ray.set(this.camera.position, this.delta.multiplyScalar(1 / reach))
    this.ray.far = reach - 0.15
    const hits = this.ray.intersectObjects(occluders, false)
    for (const hit of hits) {
      const mat = (hit.object as THREE.Mesh).material as THREE.MeshLambertMaterial
      if (Array.isArray(mat)) continue
      mat.transparent = true
      mat.opacity = 0.22
      mat.depthWrite = false
    }
  }
}

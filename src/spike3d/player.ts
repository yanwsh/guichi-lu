import * as THREE from 'three'
import { Collider } from './collision.ts'
import { Figure } from './figure.ts'

const WALK = 1.7

/** Capsule feet stay on the ground. `wish` is a camera-relative stick in world XZ, length at most 1. */
export class Walker {
  readonly pos = new THREE.Vector3()
  yaw = 0
  private vel = new THREE.Vector3()
  readonly figure: Figure

  constructor(spawn: THREE.Vector3) {
    this.pos.copy(spawn)
    this.pos.y = 0
    this.figure = new Figure()
    this.figure.setPosition(this.pos.x, 0, this.pos.z)
    this.figure.setYaw(this.yaw)
  }

  update(dt: number, wishX: number, wishZ: number, collider: Collider, time: number) {
    this.vel.x = THREE.MathUtils.damp(this.vel.x, wishX * WALK, 10, dt)
    this.vel.z = THREE.MathUtils.damp(this.vel.z, wishZ * WALK, 10, dt)
    const prevX = this.pos.x
    const prevZ = this.pos.z
    this.pos.x += this.vel.x * dt
    collider.resolve(this.pos)
    if (Math.abs(this.pos.x - prevX - this.vel.x * dt) > 0.001) this.vel.x *= 0.15
    this.pos.z = prevZ
    this.pos.z += this.vel.z * dt
    collider.resolve(this.pos)
    if (Math.abs(this.pos.z - prevZ - this.vel.z * dt) > 0.001) this.vel.z *= 0.15
    const speed = Math.hypot(this.vel.x, this.vel.z)
    if (speed > 0.2 && wishX * wishX + wishZ * wishZ > 0.04) {
      this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 12, dt)
    }
    this.figure.setPosition(this.pos.x, 0, this.pos.z)
    this.figure.setYaw(this.yaw)
    this.figure.update(speed, dt, time)
  }
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + delta * (1 - Math.exp(-lambda * dt))
}

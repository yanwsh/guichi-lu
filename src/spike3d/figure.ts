import * as THREE from 'three'
import { Locomotion, type PoseWeights } from './anim'

/** Top of the head after the 1.58 m scale. Feet stay at the local origin. */
export const FIGURE_TOP = 1.575

/** Blocky 1.6 m body. Feet at the local origin, chest facing +Z. */
export class Figure {
  readonly root = new THREE.Group()
  readonly locomotion = new Locomotion()
  private upper = new THREE.Group()
  private armL = new THREE.Group()
  private armR = new THREE.Group()
  private legL = new THREE.Group()
  private legR = new THREE.Group()
  private phase = 0
  private blocky: THREE.Mesh[] = []

  constructor(cloth = 0x5d7594) {
    const clothMat = new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.78 })
    const skin = new THREE.MeshStandardMaterial({ color: 0xd7aa8c, roughness: 0.62 })
    const hair = new THREE.MeshStandardMaterial({ color: 0x1c140f, roughness: 0.7 })
    const torso = box(0.32, 0.5, 0.18, clothMat)
    torso.position.y = 1.08
    this.upper.add(torso)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), skin)
    head.position.y = 1.48
    head.castShadow = true
    this.upper.add(head)
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.118, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hair)
    hairCap.position.y = 1.5
    hairCap.castShadow = true
    this.upper.add(hairCap)
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.055), skin)
    nose.position.set(0, 1.46, 0.12)
    this.upper.add(nose)
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), hair)
    bun.position.set(0, 1.46, -0.1)
    this.upper.add(bun)
    this.armL = hang(this.upper, -0.24, 1.32, clothMat)
    this.armR = hang(this.upper, 0.24, 1.32, clothMat)
    this.legL = hang(this.root, -0.09, 0.84, clothMat, 0.16, 0.8)
    this.legR = hang(this.root, 0.09, 0.84, clothMat, 0.16, 0.8)
    this.root.add(this.upper)
    this.root.scale.setScalar(1.58 / 1.6)
    this.root.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
        this.blocky.push(mesh)
      }
    })
  }

  fit: { minY: number, maxY: number, minX: number, maxX: number, minZ: number, maxZ: number } | null = null
  slide = 0
  private rigged: THREE.Object3D | null = null
  private slideSum = 0
  private slideN = 0
  private haveFeet = false
  private footL: THREE.Object3D | null = null
  private footR: THREE.Object3D | null = null
  private frames = 0
  private readonly footNowL = new THREE.Vector3()
  private readonly footNowR = new THREE.Vector3()
  private readonly prevL = new THREE.Vector3()
  private readonly prevR = new THREE.Vector3()

  /**
   * Swap in a rigged body. A file with no usable clips keeps the blocky body.
   * Heroes authored near 1.58 m are not rescaled; the root scale is cleared so the blocky 0.99 factor does not shrink them.
   */
  useHero(scene: THREE.Object3D, clips: THREE.AnimationClip[]): boolean {
    const bound = this.locomotion.bind(scene, clips)
    if (!bound) return false
    scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(scene)
    const h = box.max.y - box.min.y
    if (h < 1.2 || h > 2.05) {
      const scale = 1.58 / Math.max(0.01, h)
      scene.scale.multiplyScalar(scale)
      scene.position.y -= box.min.y * scale
    } else if (Math.abs(box.min.y) > 0.02) {
      scene.position.y -= box.min.y
    }
    this.root.scale.setScalar(1)
    scene.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      // Outline lives in _OUTLINE_NORMAL, not COLOR_0. Vertex colors would tint the cloth.
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of list) {
        const colored = mat as THREE.MeshStandardMaterial
        if (colored) colored.vertexColors = false
      }
    })
    for (const mesh of this.blocky) mesh.visible = false
    this.root.add(scene)
    this.rigged = scene
    this.footL = scene.getObjectByName('LeftFoot') ?? null
    this.footR = scene.getObjectByName('RightFoot') ?? null
    return true
  }

  setPosition(x: number, y: number, z: number) {
    this.root.position.set(x, y, z)
  }

  private yawNow = 0
  private homeYaw = 0

  setYaw(yaw: number) {
    this.yawNow = yaw
    this.homeYaw = yaw
    this.root.rotation.y = yaw
  }

  /** Face a world point. About 0.3 s to settle (lambda 8). */
  aimAt(x: number, z: number, dt: number) {
    const target = Math.atan2(x - this.root.position.x, z - this.root.position.z)
    this.yawNow = dampYaw(this.yawNow, target, 8, dt)
    this.root.rotation.y = this.yawNow
  }

  relax(dt: number) {
    this.yawNow = dampYaw(this.yawNow, this.homeYaw, 8, dt)
    this.root.rotation.y = this.yawNow
  }

  update(speed: number, dt: number, time: number, talking = false) {
    const pose = this.locomotion.update(speed, talking, dt)
    if (this.locomotion.mode === 'clip') {
      this.sampleSlide(dt, speed)
      this.frames += 1
      if (!this.fit && this.frames === 3) this.measureFit()
      return
    }
    this.applyPose(pose, speed, dt, time)
  }

  get state() { return this.locomotion.state }
  get animMode() { return this.locomotion.mode }

  /** Procedural stand-in. Weights already blend idle / walk / run, and talk wins while a line is open. */
  private applyPose(w: PoseWeights, speed: number, dt: number, time: number) {
    const loco = w.walk + w.run
    if (speed > 0.12 && loco > 0.04) this.phase += dt * (6.4 * w.walk + 10.2 * w.run) * (0.35 + speed / 1.55)
    const swing = Math.sin(this.phase) * (w.walk * 0.72 + w.run * 1.15)
    const talk = w.talk
    this.legL.rotation.x = swing * 0.9 * (1 - talk)
    this.legR.rotation.x = -swing * 0.9 * (1 - talk)
    this.armL.rotation.x = -swing * 0.62 * (1 - talk) + talk * (0.45 + Math.sin(time * 3.1) * 0.38)
    this.armR.rotation.x = swing * 0.62 * (1 - talk) + talk * (0.12 + Math.sin(time * 3.1 + 1.3) * 0.28)
    this.armL.rotation.z = talk * 0.28
    this.armR.rotation.z = talk * -0.22
    const bob = loco * Math.abs(Math.sin(this.phase)) * (0.028 + w.run * 0.03)
    const idle = w.idle * Math.sin(time * 1.6) * 0.012
    const chat = talk * Math.sin(time * 2.2) * 0.018
    this.upper.position.y = bob + idle + chat
    this.upper.rotation.y = talk * Math.sin(time * 1.6) * 0.14
  }

  /** Posed vertices in the figure's local space. +Z is the chest, Y is up from the feet. */
  private measureFit() {
    const min = new THREE.Vector3(Infinity, Infinity, Infinity)
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    const tmp = new THREE.Vector3()
    this.root.updateWorldMatrix(true, true)
    this.root.traverse(obj => {
      const mesh = obj as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      mesh.skeleton.update()
      const pos = mesh.geometry.getAttribute('position')
      const step = Math.max(1, Math.floor(pos.count / 2000))
      for (let i = 0; i < pos.count; i += step) {
        tmp.fromBufferAttribute(pos, i)
        mesh.applyBoneTransform(i, tmp)
        mesh.localToWorld(tmp)
        this.root.worldToLocal(tmp)
        min.min(tmp)
        max.max(tmp)
      }
    })
    if (!Number.isFinite(min.y)) return
    this.fit = { minY: min.y, maxY: max.y, minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z }
  }

  /** World speed of the lower foot while it is near the ground. Near zero means the plant is stuck. */
  private sampleSlide(dt: number, speed: number) {
    if (!this.footL || !this.footR || dt <= 0) return
    this.footL.getWorldPosition(this.footNowL)
    this.footR.getWorldPosition(this.footNowR)
    const useL = this.footNowL.y <= this.footNowR.y
    const now = useL ? this.footNowL : this.footNowR
    const prev = useL ? this.prevL : this.prevR
    if (this.haveFeet && now.y < 0.09 && speed > 0.7) {
      this.slideSum += Math.hypot(now.x - prev.x, now.z - prev.z) / dt
      this.slideN += 1
      this.slide = this.slideSum / this.slideN
    }
    this.prevL.copy(this.footNowL)
    this.prevR.copy(this.footNowR)
    this.haveFeet = true
  }
}

function dampYaw(current: number, target: number, lambda: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current))
  return current + delta * (1 - Math.exp(-lambda * dt))
}

function box(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
}

function hang(parent: THREE.Object3D, x: number, y: number, material: THREE.Material, w = 0.09, h = 0.46): THREE.Group {
  const pivot = new THREE.Group()
  pivot.position.set(x, y, 0)
  const mesh = box(w, h, w, material)
  mesh.position.y = -h / 2
  pivot.add(mesh)
  parent.add(pivot)
  return pivot
}

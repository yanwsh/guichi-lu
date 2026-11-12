import type { DialogueLine } from '../data/types'
import { loadC01Visual, loadGameDb } from '../data/loader'
import { DialogueBar } from './dialogueBar'
import type { InteractAnchor } from './gltf'
import * as THREE from 'three'

export interface Cue {
  id: string
  kind: 'talk' | 'inspect'
  radius: number
  x: number
  z: number
  lines: DialogueLine[]
  word: '交谈' | '查看'
}

const SPEC: { id: string, dialogue: string, kind: 'talk' | 'inspect', radius: number, x: number, z: number, clip?: 'ends' }[] = [
  { id: 'TR_C01_02_YANGUI_IN', dialogue: 'DLG_C01B_01', kind: 'talk', radius: 1.5, x: 0.85, z: 2 },
  { id: 'TR_C01_01_HE', dialogue: 'DLG_C01A_05', kind: 'talk', radius: 1.5, x: 7, z: -1.5 },
  { id: 'TR_C01_01_CHENG', dialogue: 'DLG_C01A_10', kind: 'talk', radius: 1.5, x: 1.15, z: -1.15 },
  { id: 'TR_C01_03_BOWL_WEAR', dialogue: 'DLG_C01C_03', kind: 'inspect', radius: 1, x: 0.55, z: 4.45, clip: 'ends' },
  { id: 'TR_C01_01_PRICE', dialogue: 'DLG_C01A_02', kind: 'inspect', radius: 1, x: -1.7, z: 2.1 },
]

/** Five sample beats. Lines come from the existing table and are not rewritten. No flags and no save. */
export class SpikeSession {
  cues: Cue[] = []
  prompt: Cue | null = null
  busy = false
  holding: THREE.Object3D | null = null
  private bar: DialogueBar | null = null
  private home: { parent: THREE.Object3D, position: THREE.Vector3, quaternion: THREE.Quaternion, scale: THREE.Vector3 } | null = null
  private pivot: THREE.Group | null = null

  async start(root: HTMLElement, anchors: InteractAnchor[]) {
    const [db, visual] = await Promise.all([loadGameDb(), loadC01Visual()])
    const portraits: Record<string, string> = {}
    for (const [name, def] of Object.entries(visual.portraits)) {
      if (def.src) portraits[name] = `${import.meta.env.BASE_URL}${def.src.replace(/^\//, '')}`
    }
    this.bar = new DialogueBar(root, portraits)
    const byId = new Map(anchors.map(anchor => [anchor.id, anchor]))
    this.cues = SPEC.map(spec => {
      const row = db.dialogues.get(spec.dialogue)
      const lines = row?.lines ?? []
      const found = byId.get(spec.id)
      return {
        id: spec.id,
        kind: spec.kind,
        radius: found?.radius ?? spec.radius,
        x: found?.position.x ?? spec.x,
        z: found?.position.z ?? spec.z,
        lines: spec.clip === 'ends' && lines.length >= 2 ? [lines[0], lines[lines.length - 1]] : lines,
        word: spec.kind === 'talk' ? '交谈' : '查看',
      }
    })
  }

  update(x: number, z: number, yaw: number) {
    if (this.busy) {
      this.prompt = null
      return
    }
    const fx = Math.sin(yaw)
    const fz = Math.cos(yaw)
    let best: Cue | null = null
    let bestDist = Infinity
    for (const cue of this.cues) {
      const dx = cue.x - x
      const dz = cue.z - z
      const dist = Math.hypot(dx, dz)
      if (dist > cue.radius || dist >= bestDist) continue
      const dot = dist < 0.05 ? 1 : (fx * dx + fz * dz) / dist
      if (dot < 0.34) continue
      best = cue
      bestDist = dist
    }
    this.prompt = best
  }

  get dialogueOpen() { return !!this.bar?.open }
  get dialogueText() { return this.bar?.text ?? '' }

  advance() { this.bar?.advance() }

  drag(dx: number, dy: number) {
    if (!this.pivot) return
    this.pivot.rotation.y += dx * 0.012
    this.pivot.rotation.x = THREE.MathUtils.clamp(this.pivot.rotation.x + dy * 0.008, 0.15, 2.4)
  }

  async interact(target: THREE.Object3D | null, camera: THREE.Camera) {
    if (!this.bar || this.busy || !this.prompt) return
    const cue = this.prompt
    this.busy = true
    this.prompt = null
    try {
      if (cue.kind === 'inspect' && target) this.lift(target, camera, cue.id)
      await this.bar.play({ dialogue_id: cue.id, lines: cue.lines, choices: [] })
    } finally {
      this.drop()
      this.busy = false
    }
  }

  private savedMats: { mesh: THREE.Mesh, material: THREE.Material }[] = []

  private lift(target: THREE.Object3D, camera: THREE.Camera, id: string) {
    this.home = {
      parent: target.parent!,
      position: target.position.clone(),
      quaternion: target.quaternion.clone(),
      scale: target.scale.clone(),
    }
    target.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      this.savedMats.push({ mesh, material: mesh.material as THREE.Material })
      mesh.material = new THREE.MeshBasicMaterial({
        color: mesh.userData.wear ? 0x4a2a18 : 0xf0c79a,
        side: THREE.DoubleSide,
      })
    })
    this.pivot = new THREE.Group()
    this.pivot.position.set(0, 0.08, -1.05)
    camera.add(this.pivot)
    this.pivot.attach(target)
    target.position.set(0, 0, 0)
    target.rotation.set(0, 0, 0)
    this.pivot.rotation.set(id === 'TR_C01_03_BOWL_WEAR' ? 0.85 : 0.7, 0.35, 0)
    target.scale.multiplyScalar(2.2)
    target.traverse(obj => { obj.frustumCulled = false })
    this.holding = target
  }

  private drop() {
    if (this.holding && this.home) {
      for (const saved of this.savedMats) saved.mesh.material = saved.material
      this.savedMats = []
      this.home.parent.attach(this.holding)
      this.holding.position.copy(this.home.position)
      this.holding.quaternion.copy(this.home.quaternion)
      this.holding.scale.copy(this.home.scale)
    }
    this.pivot?.removeFromParent()
    this.pivot = null
    this.holding = null
    this.home = null
  }
}

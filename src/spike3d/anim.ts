import * as THREE from 'three'

export type AnimState = 'idle' | 'walk' | 'run' | 'talk'

/** Art drops the CC0 license here with the retargeted clips. The spike does not download it. */
export const UAL_LICENSE_PATH = 'assets/3d/_third_party/quaternius_UAL/License.txt'

/** Rigged hero. Embedded clips are idle / walk / talk / run, in place, no mixamorig: prefix. */
export const HERO_GLB_PATH = 'assets/3d/characters/SK_XuZhaoning.glb'
export const NPC_GLB_PATH = 'assets/3d/characters/SK_NPC_BaseBody.glb'
/** Same bone names as the characters. NPCs play idle and talk from here. */
export const ANIM_GLB_PATH = 'assets/3d/characters/anims_humanoid.glb'

export const WALK_SPEED = 1.4
export const RUN_SPEED = 3.5
/** Authored in-place stride. Playback rate is actual speed divided by these. */
export const WALK_CLIP_SPEED = 1.4
export const RUN_CLIP_SPEED = 3.5

const STATES: AnimState[] = ['idle', 'walk', 'run', 'talk']

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1)))
  return t * t * (3 - 2 * t)
}

/** Stick magnitude 0–1 maps through a walk cruise into a run cruise. */
export function cruiseSpeed(mag: number): number {
  const m = Math.min(1, Math.max(0, mag))
  if (m <= 0.001) return 0
  if (m < 0.62) return (m / 0.62) * WALK_SPEED
  return WALK_SPEED + ((m - 0.62) / 0.38) * (RUN_SPEED - WALK_SPEED)
}

export function locomotionWeights(speed: number): { idle: number, walk: number, run: number } {
  const idle = 1 - smoothstep(0.12, 0.45, speed)
  const run = smoothstep(1.75, 2.45, speed)
  const walk = Math.max(0, (1 - idle) * (1 - run))
  const sum = idle + walk + run || 1
  return { idle: idle / sum, walk: walk / sum, run: run / sum }
}

/** Exact clip names after a lowercase trim. A leftover mixamorig prefix is ignored. */
export function clipKey(name: string): AnimState | null {
  const base = name.trim().toLowerCase().replace(/^mixamorig[:_]/, '')
  if (base === 'idle' || base === 'walk' || base === 'talk' || base === 'run') return base
  return null
}

export interface PoseWeights {
  idle: number
  walk: number
  run: number
  talk: number
}

/**
 * Crossfades idle / walk / run by speed, and talk while a line is up.
 * With no bound clips the pose stays procedural. A missing clip falls back to idle, or to procedural when nothing is bound.
 */
export class Locomotion {
  readonly blend: PoseWeights = { idle: 1, walk: 0, run: 0, talk: 0 }
  state: AnimState = 'idle'
  mode: 'clip' | 'procedural' = 'procedural'
  private mixer: THREE.AnimationMixer | null = null
  private actions = new Map<AnimState, THREE.AnimationAction>()

  /** Returns true when at least one clip targets a node in `root`. */
  bind(root: THREE.Object3D, clips: THREE.AnimationClip[]): boolean {
    const names = new Set<string>()
    root.traverse(obj => { if (obj.name) names.add(obj.name) })
    const found = new Map<AnimState, THREE.AnimationClip>()
    for (const clip of clips) {
      const key = clipKey(clip.name)
      if (!key || found.has(key)) continue
      const tracks = clip.tracks.filter(track => names.has(track.name.split('.')[0]))
      if (tracks.length === 0) continue
      found.set(key, new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode))
    }
    if (found.size === 0) return false
    this.mixer = new THREE.AnimationMixer(root)
    for (const [name, clip] of found) {
      const action = this.mixer.clipAction(clip)
      action.loop = THREE.LoopRepeat
      action.enabled = true
      action.weight = name === 'idle' ? 1 : 0
      action.play()
      this.actions.set(name, action)
    }
    this.mode = 'clip'
    return true
  }

  update(speed: number, talking: boolean, dt: number): PoseWeights {
    const moving = locomotionWeights(speed)
    const target: PoseWeights = talking
      ? { idle: 0, walk: 0, run: 0, talk: 1 }
      : { ...moving, talk: 0 }
    if (this.actions.size > 0) fallbackMissing(target, this.actions)
    for (const key of STATES) {
      this.blend[key] = THREE.MathUtils.damp(this.blend[key], target[key], 9, dt)
    }
    let sum = 0
    for (const key of STATES) sum += this.blend[key]
    if (sum > 1e-4) for (const key of STATES) this.blend[key] /= sum
    this.state = dominant(this.blend)
    if (this.mixer) {
      const walk = this.actions.get('walk')
      const run = this.actions.get('run')
      if (walk) walk.timeScale = speed > 0.05 ? speed / WALK_CLIP_SPEED : 1
      if (run) run.timeScale = speed > 0.05 ? speed / RUN_CLIP_SPEED : 1
      for (const [name, action] of this.actions) {
        action.weight = this.blend[name]
        action.enabled = action.weight > 0.001
      }
      this.mixer.update(dt)
    }
    return this.blend
  }
}

/** How many clip tracks name a node on this rig. External clips bind only by bone name. */
export function boneCoverage(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
  const names = new Set<string>()
  root.traverse(obj => { if (obj.name) names.add(obj.name) })
  const missing: string[] = []
  let tracks = 0
  let hit = 0
  for (const clip of clips) {
    for (const track of clip.tracks) {
      tracks += 1
      const node = track.name.split('.')[0]
      if (names.has(node)) hit += 1
      else missing.push(`${clip.name}:${node}`)
    }
  }
  return { tracks, hit, missing }
}

function dominant(blend: PoseWeights): AnimState {
  let best: AnimState = 'idle'
  let score = -1
  for (const key of STATES) {
    if (blend[key] > score) {
      best = key
      score = blend[key]
    }
  }
  return best
}

/** A missing state borrows idle so a half-delivered rig does not pop to bind pose. */
function fallbackMissing(target: PoseWeights, actions: Map<AnimState, THREE.AnimationAction>) {
  let leftover = 0
  for (const key of STATES) {
    if (target[key] > 0 && !actions.has(key)) {
      leftover += target[key]
      target[key] = 0
    }
  }
  if (leftover <= 0) return
  if (actions.has('idle')) target.idle += leftover
  else if (actions.has('walk')) target.walk += leftover
}

import * as THREE from 'three'
import type { GameState } from '../save/gameState'
import { containsShape, distToBox, inBox, shapeCenter, type Pt } from './geom'
import { applyGates, buildGrid, findPath, nearestOpen, cellOf, type GateBox, type Grid } from './pathfind'
import { sortKeyOf, type LayerManifest, type WalkMap, type WalkTrigger, type WalkZone } from './walkTypes'

export interface WalkBridge {
  readonly ready: boolean
  isActive(): boolean
  show(state: GameState): void
  hide(): void
  resize(w: number, h: number): void
  update(dt: number): void
  pointer(clientX: number, clientY: number, rect: DOMRect): void
  setStick(x: number, y: number, on: boolean): void
  activatePrompt(): void
  setBattle(on: boolean): void
  resumeAfterBattle(result: 'win' | 'lose' | 'retreat'): void
  refresh(): void
  commitPos(): void
  spawnZone(zoneId: string): Pt | null
  labels(): Record<string, string>
  safeUi(): WalkMap['safe_ui'] | null
  canvasSize(): { w: number; h: number } | null
  /** Re-read the walkable mask (or a replacement URL) and rebuild the grid. M1 does not ship extra masks. */
  reloadWalkable(maskUrl?: string): Promise<void>
}

export interface WalkHooks {
  flags(): Record<string, number>
  triggered(): string[]
  blocked(): boolean
  onTrigger(t: WalkTrigger): Promise<void>
  onToast(text: string): void
  onZone(label: string, objective: string): void
  onPrompt(label: string | null): void
  savePos(x: number, y: number): void
}

const noopHooks: WalkHooks = {
  flags: () => ({}),
  triggered: () => [],
  blocked: () => false,
  onTrigger: async () => {},
  onToast: () => {},
  onZone: () => {},
  onPrompt: () => {},
  savePos: () => {},
}

/** Feet at image y below an occluder's foot are drawn behind it. */
const SORT_BASE = 100

export class WalkScene implements WalkBridge {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.OrthographicCamera(-540, 540, 960, -960, 0.1, 100)
  ready = false
  private map: WalkMap | null = null
  private manifest: LayerManifest | null = null
  private hooks: WalkHooks = noopHooks
  private active = false
  private busy = false
  private battle = false
  private introChecked = false
  private x = 0
  private y = 0
  private boardW = 1080
  private boardH = 1920
  private viewW = 1080
  private viewH = 1920
  private viewScale = 1
  private speed = 240
  private pad = 20
  private threshold = 128
  private mask = new Uint8Array()
  private grid: Grid | null = null
  private lockedGates: GateBox[] = []
  private path: Pt[] = []
  private pathIndex = 0
  private stickX = 0
  private stickY = 0
  private stickOn = false
  private inside = new Set<string>()
  private prompt: WalkTrigger | null = null
  private promptLabel: string | null = null
  private zoneId = ''
  private saveAcc = 0
  private lastSaved = ''
  private player!: THREE.Mesh
  private enemy!: THREE.Mesh
  private pathLine!: THREE.Line
  private marker!: THREE.Mesh
  private pick!: THREE.Object3D
  private gateMeshes: { id: string; mesh: THREE.Object3D }[] = []
  private ysort: { mesh: THREE.Object3D; sortY: number }[] = []
  private raycaster = new THREE.Raycaster()
  private scrollWarned = false
  private artBase = ''

  setHooks(h: WalkHooks) { this.hooks = h }

  isActive() { return this.active }

  labels(): Record<string, string> { return this.map?.ui_map_labels ?? {} }

  safeUi() { return this.map?.safe_ui ?? null }

  canvasSize() { return this.map ? { w: this.boardW, h: this.boardH } : null }

  spawnZone(zoneId: string): Pt | null {
    const z = this.map?.zones.find(z => z.zone_id === zoneId)
    return z ? { ...z.spawn } : null
  }

  async load(map: WalkMap, artBase: string) {
    this.map = map
    this.artBase = artBase
    this.boardW = map.canvas.w
    this.boardH = map.canvas.h
    const manRes = await fetch(`${artBase}layers.json`)
    if (!manRes.ok) throw new Error('walk layers.json missing')
    this.manifest = await manRes.json() as LayerManifest
    const man = this.manifest
    this.viewScale = man.camera_view_scale
    this.speed = man.speed_px
    this.pad = man.interact_edge_pad
    this.threshold = man.walkable_threshold
    if (man.scroll?.enabled && !this.scrollWarned) {
      this.scrollWarned = true
      console.warn('SC_03 scroll camera is outside M1; staying on the single 1080×1920 board')
    }
    const mask = await readMask(`${artBase}${map.walkable_mask}`)
    this.mask = mask.data
    this.grid = buildGrid(this.boardW, this.boardH, man.cell, (x, y) => this.sample(x, y) >= this.threshold)
    this.scene.background = new THREE.Color('#1c2428')
    const loader = new THREE.TextureLoader()
    const texCache = new Map<string, THREE.Texture>()
    const loadTex = (file: string) => new Promise<THREE.Texture>((resolve, reject) => {
      const hit = texCache.get(file)
      if (hit) { resolve(hit); return }
      loader.load(artBase + file, t => {
        t.colorSpace = THREE.SRGBColorSpace
        t.magFilter = THREE.LinearFilter
        t.minFilter = THREE.LinearFilter
        texCache.set(file, t)
        resolve(t)
      }, undefined, () => reject(new Error(`walk layer missing: ${file}`)))
    })
    for (const slice of man.slices) {
      let tex: THREE.Texture
      try { tex = await loadTex(slice.file) } catch (err) {
        console.warn(err)
        continue
      }
      const crop = slice.crop
      const pw = crop?.w ?? this.boardW
      const ph = crop?.h ?? this.boardH
      const px = (crop?.x ?? 0) + pw / 2
      const py = (crop?.y ?? 0) + ph / 2
      const mapTex = crop ? cropTexture(tex, crop, this.boardW, this.boardH) : tex
      const mat = new THREE.MeshBasicMaterial({
        map: mapTex,
        transparent: slice.role === 'ysort',
        depthTest: false,
        depthWrite: false,
        alphaTest: slice.role === 'ysort' ? 0.04 : 0,
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat)
      mesh.position.set(px, this.boardH - py, 0)
      mesh.frustumCulled = false
      if (slice.role === 'far') mesh.renderOrder = 0
      else if (slice.role === 'ground') {
        mesh.renderOrder = 1
        this.pick = mesh
      } else {
        const row = map.occlusion_sort.find(o => o.id === slice.occlusion_id)
        const sortY = row ? sortKeyOf(row) : py
        mesh.renderOrder = SORT_BASE + sortY
        this.ysort.push({ mesh, sortY })
      }
      this.scene.add(mesh)
    }
    if (!this.pick) {
      const fallback = new THREE.Mesh(
        new THREE.PlaneGeometry(this.boardW, this.boardH),
        new THREE.MeshBasicMaterial({ color: 0x6d6248, depthTest: false, depthWrite: false }),
      )
      fallback.position.set(this.boardW / 2, this.boardH / 2, 0)
      fallback.renderOrder = 1
      this.scene.add(fallback)
      this.pick = fallback
    }
    this.player = this.makeActor('#3a5a6a', 72, 120)
    this.scene.add(this.player)
    this.enemy = this.makeActor('#6a3048', 150, 210)
    this.enemy.visible = false
    const enemyTex = await loadTexOptional(loader, `${import.meta.env.BASE_URL}enemies/EN_MOB_MELEE.png`)
    if (enemyTex) (this.enemy.material as THREE.MeshBasicMaterial).map = enemyTex
    this.scene.add(this.enemy)
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
    this.pathLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf6e7b2, depthTest: false, transparent: true, opacity: 0.9 }))
    this.pathLine.frustumCulled = false
    this.pathLine.renderOrder = 12
    this.pathLine.visible = false
    this.scene.add(this.pathLine)
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(10, 16, 28),
      new THREE.MeshBasicMaterial({ color: 0xf6e7b2, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }),
    )
    this.marker.renderOrder = 13
    this.marker.visible = false
    this.scene.add(this.marker)
    for (const t of map.triggers) {
      if (t.type !== 'interact' && t.id !== 'TR_N4_ENC') continue
      const c = shapeCenter(t.shape)
      const r = t.shape.kind === 'circle' ? Math.max(18, t.shape.r * 0.25) : 18
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r * 0.65, r, 24),
        new THREE.MeshBasicMaterial({
          color: t.type === 'interact' ? 0xe8c27a : 0xc45a4a,
          side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.8,
        }),
      )
      ring.position.set(c.x, this.boardH - c.y, 0)
      ring.renderOrder = 11
      ring.frustumCulled = false
      this.scene.add(ring)
    }
    const fogTex = labelTexture('妖气')
    for (const p of map.paths) {
      if (!p.gate) continue
      const g = p.gate
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(g.w, g.h),
        new THREE.MeshBasicMaterial({ color: 0x8ea4b8, transparent: true, opacity: 0.42, depthTest: false, depthWrite: false }),
      )
      mesh.position.set(g.x + g.w / 2, this.boardH - (g.y + g.h / 2), 0)
      mesh.renderOrder = 20
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: fogTex, depthTest: false, transparent: true }))
      tag.scale.set(120, 36, 1)
      tag.position.set(0, 0, 0)
      tag.renderOrder = 21
      mesh.add(tag)
      this.scene.add(mesh)
      this.gateMeshes.push({ id: p.id, mesh })
    }
    this.camera.position.set(this.boardW / 2, this.boardH / 2, 20)
    this.ready = true
    this.refresh()
  }

  /** Hot-swap hook. Replaces collision only; does not add routes or edit the painted mask. */
  async reloadWalkable(maskUrl?: string) {
    if (!this.map || !this.manifest) return
    const url = maskUrl ?? `${this.artBase}${this.map.walkable_mask}`
    const mask = await readMask(url)
    if (mask.w !== this.boardW || mask.h !== this.boardH) {
      console.warn(`walkable ${mask.w}×${mask.h} does not match board ${this.boardW}×${this.boardH}`)
      return
    }
    this.mask = mask.data
    this.grid = buildGrid(this.boardW, this.boardH, this.manifest.cell, (x, y) => this.sample(x, y) >= this.threshold)
    this.refresh()
  }

  show(state: GameState) {
    if (!this.map) return
    this.active = true
    this.battle = false
    this.introChecked = false
    this.path = []
    this.stickOn = false
    this.inside.clear()
    const saved = state.walk_pos
    if (saved && saved.scene_id === this.map.host_scene_id && this.canOccupy(saved.x, saved.y)) {
      this.x = saved.x
      this.y = saved.y
    } else {
      const spawn = this.map.zones.find(z => z.zone_id === 'N3')?.spawn ?? { x: this.boardW / 2, y: this.boardH - 80 }
      this.x = spawn.x
      this.y = spawn.y
      if (!this.canOccupy(this.x, this.y)) this.snapNearest(this.x, this.y)
    }
    this.syncVisuals()
    this.commitPos()
  }

  hide() {
    this.active = false
    this.stickOn = false
    this.path = []
    this.battle = false
    this.hooks.onPrompt(null)
  }

  resize(viewWpx: number, viewHpx: number) {
    const aspect = viewWpx / Math.max(1, viewHpx)
    let viewH = this.boardH * this.viewScale
    let viewW = viewH * aspect
    if (viewW > this.boardW) { viewW = this.boardW; viewH = viewW / aspect }
    if (viewH > this.boardH) { viewH = this.boardH; viewW = viewH * aspect }
    this.viewW = viewW
    this.viewH = viewH
    this.camera.left = -viewW / 2
    this.camera.right = viewW / 2
    this.camera.top = viewH / 2
    this.camera.bottom = -viewH / 2
    this.camera.updateProjectionMatrix()
    this.follow()
  }

  update(dt: number) {
    if (!this.active || !this.ready) return
    if (!this.introChecked) {
      this.introChecked = true
      if (!this.battle) this.pollEnters()
    }
    const locked = this.busy || this.battle || this.hooks.blocked()
    if (locked) {
      this.stickOn = false
      this.halt()
    } else if (this.stickOn) {
      this.path = []
      this.pathIndex = 0
      const stepX = this.stickX * this.speed * dt
      const stepY = this.stickY * this.speed * dt
      if (this.canOccupy(this.x + stepX, this.y + stepY)) { this.x += stepX; this.y += stepY }
      else if (this.canOccupy(this.x + stepX, this.y)) this.x += stepX
      else if (this.canOccupy(this.x, this.y + stepY)) this.y += stepY
      else this.toastGate(this.x + stepX, this.y + stepY)
    } else if (this.path.length) {
      let left = this.speed * dt
      while (left > 0 && this.pathIndex < this.path.length) {
        const p = this.path[this.pathIndex]
        const dx = p.x - this.x
        const dy = p.y - this.y
        const d = Math.hypot(dx, dy)
        if (d <= left || d < 0.4) {
          this.x = p.x
          this.y = p.y
          left -= d
          this.pathIndex++
        } else {
          this.x += (dx / d) * left
          this.y += (dy / d) * left
          left = 0
        }
      }
      if (this.pathIndex >= this.path.length) this.halt()
    }
    if (!locked) this.pollEnters()
    this.syncVisuals()
    this.saveAcc += dt
    if (this.saveAcc > 0.4) { this.saveAcc = 0; this.commitPos() }
  }

  pointer(clientX: number, clientY: number, rect: DOMRect) {
    if (!this.active || !this.ready || this.busy || this.battle || this.hooks.blocked() || this.stickOn || !this.grid) return
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hits = this.raycaster.intersectObject(this.pick, false)
    if (!hits.length) return
    this.clickTo(hits[0].point.x, this.boardH - hits[0].point.y)
  }

  setStick(x: number, y: number, on: boolean) {
    if (!this.active || this.busy || this.battle || this.hooks.blocked()) {
      this.stickOn = false
      return
    }
    this.stickX = x
    this.stickY = y
    this.stickOn = on
  }

  activatePrompt() {
    if (!this.prompt || this.busy || this.battle || this.hooks.blocked()) return
    void this.fire(this.prompt)
  }

  setBattle(on: boolean) {
    this.battle = on
    this.enemy.visible = on
    if (on) {
      this.halt()
      const enc = this.map?.triggers.find(t => t.encounter_id)
      if (enc) {
        const c = shapeCenter(enc.shape)
        this.enemy.position.set(c.x + 70, this.boardH - c.y, 0)
        this.enemy.renderOrder = SORT_BASE + c.y + 2
      }
      this.commitPos()
    }
  }

  resumeAfterBattle(result: 'win' | 'lose' | 'retreat') {
    void result
    const enc = this.map?.triggers.find(t => t.id === 'TR_N4_ENC')
    if (enc && enc.shape.kind === 'circle') {
      const y = enc.shape.y + enc.shape.r + (this.manifest?.cell ?? 16)
      const x = enc.shape.x
      if (this.canOccupy(x, y)) { this.x = x; this.y = y }
      else this.snapNearest(x, y)
    }
    this.seedInside()
    this.syncVisuals()
    this.commitPos()
  }

  refresh() {
    if (!this.map || !this.grid) return
    const flags = this.hooks.flags()
    this.lockedGates = []
    for (const p of this.map.paths) {
      const locked = p.locked_by_default && !flags[p.unlock_flag]
      const mesh = this.gateMeshes.find(g => g.id === p.id)
      if (mesh) mesh.mesh.visible = locked && !!p.gate
      if (locked && p.gate) this.lockedGates.push(p.gate)
    }
    applyGates(this.grid, this.lockedGates)
  }

  commitPos() {
    const key = `${this.x.toFixed(1)},${this.y.toFixed(1)}`
    if (key === this.lastSaved) return
    this.lastSaved = key
    this.hooks.savePos(this.x, this.y)
  }

  private clickTo(x: number, y: number) {
    if (!this.grid) return
    const goalMask = this.sample(x, y) >= this.threshold
    const result = findPath(this.grid, this.x, this.y, x, y)
    if (!result || result.points.length < 2) {
      if (goalMask) this.hooks.onToast('妖气太重，路还没开。')
      return
    }
    this.path = result.points
    this.pathIndex = 1
    const end = result.points[result.points.length - 1]
    this.marker.visible = true
    this.marker.position.set(end.x, this.boardH - end.y, 0)
    if (!result.reached && goalMask) this.hooks.onToast('妖气太重，路还没开。')
  }

  private toastGate(x: number, y: number) {
    if (this.lockedGates.some(g => inBox(x, y, g)) && this.sample(x, y) >= this.threshold) {
      this.hooks.onToast('妖气太重，路还没开。')
    }
  }

  private pollEnters() {
    if (!this.map || this.busy) return
    for (const t of this.map.triggers) {
      if (t.type !== 'enter') continue
      const now = containsShape(t.shape, this.x, this.y, 0)
      const was = this.inside.has(t.id)
      if (now) this.inside.add(t.id)
      else this.inside.delete(t.id)
      if (now && !was) {
        if (this.waitingOnFlags(t)) this.inside.delete(t.id)
        else this.tryFire(t)
      }
    }
  }

  private waitingOnFlags(t: WalkTrigger) {
    const flags = this.hooks.flags()
    return !!t.require_flags?.some(f => !flags[f])
  }

  private tryFire(t: WalkTrigger) {
    if (this.busy || this.battle) return
    if (t.once && this.hooks.triggered().includes(t.id)) return
    const flags = this.hooks.flags()
    if (t.require_flags && t.require_flags.some(f => !flags[f])) return
    if (t.encounter_id && flags['tutorial_won']) return
    void this.fire(t)
  }

  private async fire(t: WalkTrigger) {
    if (this.busy) return
    this.busy = true
    this.halt()
    try { await this.hooks.onTrigger(t) }
    finally {
      this.busy = false
      this.refresh()
    }
  }

  private seedInside() {
    this.inside.clear()
    if (!this.map) return
    for (const t of this.map.triggers) {
      if (t.type === 'enter' && containsShape(t.shape, this.x, this.y, 0)) this.inside.add(t.id)
    }
  }

  private syncVisuals() {
    const wy = this.boardH - this.y
    this.player.position.set(this.x, wy, 0)
    this.player.renderOrder = SORT_BASE + Math.round(this.y) + 1
    const moving = this.stickOn || this.pathIndex < this.path.length
    if (moving) {
      const face = this.stickOn ? this.stickX : (this.path[this.pathIndex]?.x ?? this.x) - this.x
      if (Math.abs(face) > 0.5) this.player.scale.x = face < 0 ? -1 : 1
    }
    this.follow()
    this.drawPath()
    this.updateZone()
    this.updatePrompt()
    if (this.marker.visible && this.path.length === 0) this.marker.visible = false
  }

  private updateZone() {
    if (!this.map) return
    let best: WalkZone | null = null
    let bestD = Infinity
    for (const z of this.map.zones) {
      const d = distToBox(this.x, this.y, z.bounds)
      if (d < bestD) { bestD = d; best = z }
    }
    if (!best || best.zone_id === this.zoneId) return
    this.zoneId = best.zone_id
    this.hooks.onZone(best.zone_label || best.zone_id, best.objective)
  }

  private updatePrompt() {
    if (!this.map) return
    const flags = this.hooks.flags()
    const fired = this.hooks.triggered()
    let best: WalkTrigger | null = null
    let bestD = Infinity
    for (const t of this.map.triggers) {
      if (t.type !== 'interact') continue
      if (t.once && fired.includes(t.id)) continue
      if (t.require_flags && t.require_flags.some(f => !flags[f])) continue
      if (!containsShape(t.shape, this.x, this.y, this.pad)) continue
      const c = shapeCenter(t.shape)
      const d = Math.hypot(c.x - this.x, c.y - this.y)
      if (d < bestD) { bestD = d; best = t }
    }
    this.prompt = best
    const label = best?.label ?? best?.hint ?? null
    if (label !== this.promptLabel) {
      this.promptLabel = label
      this.hooks.onPrompt(label)
    }
  }

  private drawPath() {
    const rest = this.path.slice(this.pathIndex)
    if (rest.length < 1) { this.pathLine.visible = false; return }
    const pts = [new THREE.Vector3(this.x, this.boardH - this.y, 0), ...rest.map(p => new THREE.Vector3(p.x, this.boardH - p.y, 0))]
    this.pathLine.geometry.dispose()
    this.pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts)
    this.pathLine.visible = true
  }

  private follow() {
    const halfW = this.viewW / 2
    const halfH = this.viewH / 2
    const cx = clamp(this.x, halfW, this.boardW - halfW)
    const cy = clamp(this.boardH - this.y, halfH, this.boardH - halfH)
    this.camera.position.set(cx, cy, 20)
    this.camera.lookAt(cx, cy, 0)
  }

  private halt() {
    this.path = []
    this.pathIndex = 0
    this.pathLine.visible = false
  }

  private canOccupy(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.boardW || y >= this.boardH) return false
    if (this.sample(x, y) < this.threshold) return false
    return !this.lockedGates.some(g => inBox(x, y, g))
  }

  private sample(x: number, y: number) {
    const ix = Math.max(0, Math.min(this.boardW - 1, Math.round(x)))
    const iy = Math.max(0, Math.min(this.boardH - 1, Math.round(y)))
    return this.mask[iy * this.boardW + ix] ?? 0
  }

  private snapNearest(x: number, y: number) {
    if (!this.grid) return
    const c = cellOf(this.grid, x, y)
    const n = nearestOpen(this.grid, c.cx, c.cy, 8)
    if (!n) return
    this.x = n.cx * this.grid.cell + this.grid.cell / 2
    this.y = n.cy * this.grid.cell + this.grid.cell / 2
  }

  private makeActor(color: string, w: number, h: number) {
    const cv = document.createElement('canvas')
    cv.width = 128
    cv.height = 192
    const g = cv.getContext('2d')!
    g.clearRect(0, 0, 128, 192)
    g.fillStyle = 'rgba(0,0,0,.35)'
    g.beginPath()
    g.ellipse(64, 176, 28, 8, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = color
    g.fillRect(46, 78, 36, 78)
    g.beginPath()
    g.arc(64, 58, 22, 0, Math.PI * 2)
    g.fill()
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    const geo = new THREE.PlaneGeometry(w, h)
    geo.translate(0, h / 2, 0)
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }))
    mesh.frustumCulled = false
    return mesh
  }
}

function clamp(v: number, a: number, b: number) {
  if (b < a) return (a + b) / 2
  return Math.max(a, Math.min(b, v))
}

function cropTexture(src: THREE.Texture, crop: { x: number; y: number; w: number; h: number }, boardW: number, boardH: number) {
  const tex = src.clone()
  tex.repeat.set(crop.w / boardW, crop.h / boardH)
  tex.offset.set(crop.x / boardW, (boardH - crop.y - crop.h) / boardH)
  tex.needsUpdate = true
  return tex
}

function labelTexture(text: string) {
  const cv = document.createElement('canvas')
  cv.width = 256
  cv.height = 64
  const g = cv.getContext('2d')!
  g.fillStyle = '#102028cc'
  g.fillRect(0, 0, 256, 64)
  g.fillStyle = '#d5e6f2'
  g.font = '36px serif'
  g.textAlign = 'center'
  g.fillText(text, 128, 44)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function loadTexOptional(loader: THREE.TextureLoader, url: string) {
  return new Promise<THREE.Texture | null>(resolve => {
    loader.load(url, t => {
      t.colorSpace = THREE.SRGBColorSpace
      resolve(t)
    }, undefined, () => resolve(null))
  })
}

async function readMask(url: string) {
  const img = await loadImage(url)
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const raw = ctx.getImageData(0, 0, img.width, img.height).data
  const data = new Uint8Array(img.width * img.height)
  for (let i = 0, p = 0; i < data.length; i++, p += 4) data[i] = raw[p]
  return { w: img.width, h: img.height, data }
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`image failed: ${url}`))
    img.src = url
  })
}

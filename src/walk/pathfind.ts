import type { Pt } from './geom'

export interface Grid {
  cell: number
  cols: number
  rows: number
  walk: Uint8Array
  gate: Uint8Array
}

export interface GateBox { x: number; y: number; w: number; h: number }

const ORTH = 10
const DIAG = 14

export function buildGrid(width: number, height: number, cell: number, walkableAt: (x: number, y: number) => boolean): Grid {
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const walk = new Uint8Array(cols * rows)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = Math.min(width - 1, cx * cell + (cell >> 1))
      const y = Math.min(height - 1, cy * cell + (cell >> 1))
      if (walkableAt(x, y)) walk[cy * cols + cx] = 1
    }
  }
  return { cell, cols, rows, walk, gate: new Uint8Array(cols * rows) }
}

export function applyGates(g: Grid, gates: GateBox[]) {
  g.gate.fill(0)
  for (let cy = 0; cy < g.rows; cy++) {
    for (let cx = 0; cx < g.cols; cx++) {
      const x = cx * g.cell + (g.cell >> 1)
      const y = cy * g.cell + (g.cell >> 1)
      for (const b of gates) {
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
          g.gate[cy * g.cols + cx] = 1
          break
        }
      }
    }
  }
}

const at = (g: Grid, cx: number, cy: number) => cy * g.cols + cx

export function isOpen(g: Grid, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return false
  const i = at(g, cx, cy)
  return g.walk[i] === 1 && g.gate[i] === 0
}

export function cellOf(g: Grid, x: number, y: number) {
  return { cx: Math.floor(x / g.cell), cy: Math.floor(y / g.cell) }
}

export function cellCenter(g: Grid, cx: number, cy: number): Pt {
  return { x: cx * g.cell + g.cell / 2, y: cy * g.cell + g.cell / 2 }
}

export function nearestOpen(g: Grid, cx: number, cy: number, maxR: number): { cx: number; cy: number } | null {
  if (isOpen(g, cx, cy)) return { cx, cy }
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        if (isOpen(g, cx + dx, cy + dy)) return { cx: cx + dx, cy: cy + dy }
      }
    }
  }
  return null
}

function lineOpen(g: Grid, a: Pt, b: Pt): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const n = Math.max(1, Math.ceil(dist / (g.cell * 0.5)))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = a.x + (b.x - a.x) * t
    const y = a.y + (b.y - a.y) * t
    if (!isOpen(g, Math.floor(x / g.cell), Math.floor(y / g.cell))) return false
  }
  return true
}

function smooth(g: Grid, pts: Pt[]): Pt[] {
  if (pts.length <= 2) return pts
  const out: Pt[] = [pts[0]]
  let i = 0
  while (i < pts.length - 1) {
    let j = pts.length - 1
    while (j > i + 1 && !lineOpen(g, pts[i], pts[j])) j--
    out.push(pts[j])
    i = j
  }
  return out
}

class Heap {
  private a: { i: number; f: number }[] = []
  get size() { return this.a.length }
  push(i: number, f: number) {
    const a = this.a
    a.push({ i, f })
    let n = a.length - 1
    while (n > 0) {
      const p = (n - 1) >> 1
      if (a[p].f <= a[n].f) break
      ;[a[p], a[n]] = [a[n], a[p]]
      n = p
    }
  }
  pop(): { i: number; f: number } | undefined {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (!top) return undefined
    if (!last || a.length === 0) return top
    a[0] = last
    let n = 0
    for (;;) {
      const l = n * 2 + 1
      const r = l + 1
      let s = n
      if (l < a.length && a[l].f < a[s].f) s = l
      if (r < a.length && a[r].f < a[s].f) s = r
      if (s === n) break
      ;[a[s], a[n]] = [a[n], a[s]]
      n = s
    }
    return top
  }
}

const NEI: { dx: number; dy: number; c: number }[] = [
  { dx: 1, dy: 0, c: ORTH }, { dx: -1, dy: 0, c: ORTH }, { dx: 0, dy: 1, c: ORTH }, { dx: 0, dy: -1, c: ORTH },
  { dx: 1, dy: 1, c: DIAG }, { dx: 1, dy: -1, c: DIAG }, { dx: -1, dy: 1, c: DIAG }, { dx: -1, dy: -1, c: DIAG },
]

function astar(g: Grid, sx: number, sy: number, gx: number, gy: number): { cx: number; cy: number }[] | null {
  const start = at(g, sx, sy)
  const goal = at(g, gx, gy)
  const gScore = new Float64Array(g.cols * g.rows)
  gScore.fill(Infinity)
  gScore[start] = 0
  const prev = new Int32Array(g.cols * g.rows)
  prev.fill(-1)
  const heap = new Heap()
  const h0 = (Math.abs(gx - sx) + Math.abs(gy - sy)) * ORTH - 6 * Math.min(Math.abs(gx - sx), Math.abs(gy - sy))
  heap.push(start, h0)
  const closed = new Uint8Array(g.cols * g.rows)
  while (heap.size) {
    const cur = heap.pop()!
    if (closed[cur.i]) continue
    if (cur.i === goal) {
      const cells: { cx: number; cy: number }[] = []
      let i = goal
      while (i !== -1) {
        cells.push({ cx: i % g.cols, cy: Math.floor(i / g.cols) })
        if (i === start) break
        i = prev[i]
      }
      cells.reverse()
      return cells
    }
    closed[cur.i] = 1
    const cx = cur.i % g.cols
    const cy = Math.floor(cur.i / g.cols)
    for (const n of NEI) {
      const nx = cx + n.dx
      const ny = cy + n.dy
      if (!isOpen(g, nx, ny)) continue
      if (n.dx !== 0 && n.dy !== 0 && (!isOpen(g, cx + n.dx, cy) || !isOpen(g, cx, cy + n.dy))) continue
      const ni = at(g, nx, ny)
      const ng = gScore[cur.i] + n.c
      if (ng >= gScore[ni]) continue
      gScore[ni] = ng
      prev[ni] = cur.i
      const dx = Math.abs(gx - nx)
      const dy = Math.abs(gy - ny)
      const h = (dx + dy) * ORTH - 6 * Math.min(dx, dy)
      heap.push(ni, ng + h)
    }
  }
  return null
}

function closestReachable(g: Grid, sx: number, sy: number, ex: number, ey: number): { cx: number; cy: number } | null {
  const q: { cx: number; cy: number }[] = [{ cx: sx, cy: sy }]
  const seen = new Uint8Array(g.cols * g.rows)
  seen[at(g, sx, sy)] = 1
  let best = { cx: sx, cy: sy }
  let bestD = Infinity
  for (let head = 0; head < q.length; head++) {
    const cur = q[head]
    const c = cellCenter(g, cur.cx, cur.cy)
    const d = (c.x - ex) * (c.x - ex) + (c.y - ey) * (c.y - ey)
    if (d < bestD) { bestD = d; best = cur }
    for (const n of NEI) {
      const nx = cur.cx + n.dx
      const ny = cur.cy + n.dy
      if (!isOpen(g, nx, ny)) continue
      if (n.dx !== 0 && n.dy !== 0 && (!isOpen(g, cur.cx + n.dx, cur.cy) || !isOpen(g, cur.cx, cur.cy + n.dy))) continue
      const ni = at(g, nx, ny)
      if (seen[ni]) continue
      seen[ni] = 1
      q.push({ cx: nx, cy: ny })
    }
  }
  return bestD < Infinity ? best : null
}

/** Continuous polyline. `reached` is false when a walkable click sat behind a gate or wall. */
export function findPath(g: Grid, sx: number, sy: number, ex: number, ey: number): { points: Pt[]; reached: boolean } | null {
  const startCell = cellOf(g, sx, sy)
  const start = nearestOpen(g, startCell.cx, startCell.cy, 4)
  if (!start) return null
  const goalCell = cellOf(g, ex, ey)
  const goalMask = goalCell.cx >= 0 && goalCell.cy >= 0 && goalCell.cx < g.cols && goalCell.cy < g.rows && g.walk[at(g, goalCell.cx, goalCell.cy)] === 1
  const goalOpen = isOpen(g, goalCell.cx, goalCell.cy)
  let target = goalOpen ? { cx: goalCell.cx, cy: goalCell.cy } : nearestOpen(g, goalCell.cx, goalCell.cy, 12)
  let reached = goalOpen
  if (!target) return null
  let cells = astar(g, start.cx, start.cy, target.cx, target.cy)
  if (!cells) {
    const near = closestReachable(g, start.cx, start.cy, ex, ey)
    if (!near) return null
    target = near
    reached = false
    cells = astar(g, start.cx, start.cy, target.cx, target.cy)
    if (!cells) return null
  } else if (!goalOpen && goalMask) {
    reached = false
  }
  const pts: Pt[] = [{ x: sx, y: sy }]
  for (const c of cells) pts.push(cellCenter(g, c.cx, c.cy))
  if (reached) pts.push({ x: ex, y: ey })
  else pts.push(cellCenter(g, target.cx, target.cy))
  const dedup: Pt[] = []
  for (const p of pts) {
    const prev = dedup[dedup.length - 1]
    if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > 0.5) dedup.push(p)
  }
  return { points: smooth(g, dedup), reached: reached && goalOpen }
}

/** Frame timings for `?perf=1`. The panel is part of the production bundle. */
export interface FrameSummary {
  fps: number
  avg10: number
  p95ms: number
}

export class FrameWindow {
  private times: Float64Array
  private dts: Float32Array
  private head = 0
  private count = 0

  constructor(private cap = 2048) {
    this.times = new Float64Array(cap)
    this.dts = new Float32Array(cap)
  }

  push(nowSec: number, dt: number) {
    this.times[this.head] = nowSec
    this.dts[this.head] = dt
    this.head = (this.head + 1) % this.cap
    if (this.count < this.cap) this.count++
  }

  summary(): FrameSummary {
    const dts: number[] = []
    const short: number[] = []
    let newest = 0
    let oldest = 0
    let shortOldest = 0
    for (let n = 0; n < this.count; n++) {
      const idx = (this.head - 1 - n + this.cap) % this.cap
      const t = this.times[idx]
      if (n === 0) newest = t
      if (newest - t > 10) break
      dts.push(this.dts[idx])
      oldest = t
      if (newest - t <= 0.5) {
        short.push(this.dts[idx])
        shortOldest = t
      }
    }
    if (dts.length === 0) return { fps: 0, avg10: 0, p95ms: 0 }
    const last = dts[0]
    const shortSpan = newest - shortOldest
    const fps = short.length > 1 && shortSpan > 0.05 ? (short.length - 1) / shortSpan : last > 1e-6 ? 1 / last : 0
    const span = newest - oldest
    const avg10 = dts.length > 1 && span > 0.05 ? (dts.length - 1) / span : fps
    const sorted = [...dts].sort((a, b) => a - b)
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1))
    return { fps, avg10, p95ms: sorted[idx] * 1000 }
  }
}

/** Empty string when the browser hides the renderer. */
export function readGpuRenderer(gl: WebGLRenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  if (!ext) return ''
  const value = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
  return typeof value === 'string' ? value : ''
}

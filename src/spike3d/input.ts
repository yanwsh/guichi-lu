/** Left stick plus WASD. `setForced` is how the headless check steers without synthesizing touches. */
export class Stick {
  private keys = { f: false, b: false, l: false, r: false }
  private pointer: { id: number; ox: number; oy: number; x: number; y: number } | null = null
  private forced: { x: number; y: number } | null = null
  private readonly knob: HTMLElement

  constructor(
    private root: HTMLElement,
    private onAction: () => void,
  ) {
    this.knob = document.createElement('div')
    this.knob.className = 'knob'
    root.append(this.knob)
    root.addEventListener('pointerdown', event => this.down(event))
    root.addEventListener('pointermove', event => this.move(event))
    root.addEventListener('pointerup', event => this.up(event))
    root.addEventListener('pointercancel', event => this.up(event))
    window.addEventListener('keydown', event => this.key(event, true))
    window.addEventListener('keyup', event => this.key(event, false))
  }

  setForced(x: number, y: number) {
    this.forced = { x, y }
  }

  clearForced() {
    this.forced = null
  }

  sample(): { x: number; y: number } {
    if (this.forced) return clamp(this.forced.x, this.forced.y)
    let x = (this.keys.r ? 1 : 0) - (this.keys.l ? 1 : 0)
    let y = (this.keys.f ? 1 : 0) - (this.keys.b ? 1 : 0)
    if (this.pointer) {
      x += this.pointer.x
      y += this.pointer.y
    }
    return clamp(x, y)
  }

  reset() {
    this.keys = { f: false, b: false, l: false, r: false }
    this.pointer = null
    this.place(0, 0)
  }

  private down(event: PointerEvent) {
    this.root.setPointerCapture(event.pointerId)
    const rect = this.root.getBoundingClientRect()
    this.pointer = { id: event.pointerId, ox: rect.left + rect.width / 2, oy: rect.top + rect.height / 2, x: 0, y: 0 }
    this.move(event)
  }

  private move(event: PointerEvent) {
    if (!this.pointer || this.pointer.id !== event.pointerId) return
    const rect = this.root.getBoundingClientRect()
    const dx = (event.clientX - this.pointer.ox) / (rect.width / 2)
    const dy = (event.clientY - this.pointer.oy) / (rect.height / 2)
    const next = clamp(dx, -dy)
    this.pointer.x = next.x
    this.pointer.y = next.y
    this.place(next.x, -next.y)
  }

  private up(event: PointerEvent) {
    if (this.pointer?.id !== event.pointerId) return
    this.pointer = null
    this.place(0, 0)
  }

  private place(x: number, y: number) {
    this.knob.style.left = `${50 + x * 28}%`
    this.knob.style.top = `${50 + y * 28}%`
  }

  private key(event: KeyboardEvent, down: boolean) {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.f = down
        break
      case 'KeyS':
      case 'ArrowDown':
        this.keys.b = down
        break
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.l = down
        break
      case 'KeyD':
      case 'ArrowRight':
        this.keys.r = down
        break
      case 'KeyE':
        if (down && !event.repeat) this.onAction()
        return
      default:
        return
    }
    event.preventDefault()
  }
}

function clamp(x: number, y: number): { x: number; y: number } {
  const mag = Math.hypot(x, y)
  if (mag > 1) return { x: x / mag, y: y / mag }
  return { x, y }
}

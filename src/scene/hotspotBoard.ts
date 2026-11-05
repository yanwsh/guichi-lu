import type { HotspotChip } from '../walk/c01Flow'
import type { HotspotMap, HotspotTrigger } from '../data/hotspotTypes'

/** 1080×1920 热点层。无底板时用色块，不走 SC_03 的寻路。 */
export class HotspotBoard {
  onClick: (trigger: HotspotTrigger) => void = () => {}
  private map: HotspotMap | null = null

  constructor(private layer: HTMLElement) {}

  setMap(map: HotspotMap | null) { this.map = map }

  setLocked(locked: boolean) { this.layer.classList.toggle('locked', locked) }

  render(chips: HotspotChip[]) {
    const canvas = this.map?.canvas ?? { w: 1080, h: 1920 }
    this.layer.innerHTML = ''
    const placed: { x: number; y: number; w: number; h: number }[] = []
    const chipH = 56
    for (const chip of chips) {
      const shape = chip.trigger.shape
      if (!shape) continue
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'hotspot'
      button.dataset.triggerId = chip.trigger.id
      button.textContent = chip.label
      const box = shape.kind === 'circle'
        ? { x: shape.x - shape.r, y: shape.y - shape.r, w: shape.r * 2, h: shape.r * 2 }
        : { x: shape.x, y: shape.y, w: shape.w, h: shape.h }
      const w = Math.max(box.w, 160)
      let y = box.y + chip.index * (chipH + 8)
      let guard = 0
      while (guard < 24 && placed.some(p => overlaps(box.x, y, w, chipH, p))) {
        y += chipH + 8
        guard++
      }
      if (y + chipH > canvas.h - 8) y = Math.max(8, canvas.h - chipH - 8)
      placed.push({ x: box.x, y, w, h: chipH })
      button.style.left = `${box.x / canvas.w * 100}%`
      button.style.top = `${y / canvas.h * 100}%`
      button.style.width = `${w / canvas.w * 100}%`
      button.style.height = `${chipH / canvas.h * 100}%`
      button.onclick = event => {
        event.stopPropagation()
        this.onClick(chip.trigger)
      }
      this.layer.append(button)
    }
  }

  clear() { this.layer.innerHTML = '' }
}

function overlaps(x: number, y: number, w: number, h: number, other: { x: number; y: number; w: number; h: number }) {
  return x < other.x + other.w && x + w > other.x && y < other.y + other.h && y + h > other.y
}

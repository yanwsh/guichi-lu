import type { HotspotChip } from '../walk/c01Flow'
import type { HotspotMap, HotspotShape, HotspotTrigger } from '../data/hotspotTypes'

/** Highlights sit on the walkmap shape, in the same 1080×1920 space as the background. */
export class HotspotBoard {
  onClick: (trigger: HotspotTrigger) => void = () => {}
  private map: HotspotMap | null = null

  constructor(private layer: HTMLElement) {}

  setMap(map: HotspotMap | null) { this.map = map }

  setLocked(locked: boolean) { this.layer.classList.toggle('locked', locked) }

  render(chips: HotspotChip[]) {
    const canvas = this.map?.canvas ?? { w: 1080, h: 1920 }
    this.layer.innerHTML = ''
    const groups = new Map<string, HotspotChip[]>()
    for (const chip of chips) {
      const shape = chip.trigger.shape
      if (!shape) continue
      const key = shapeKey(shape)
      const list = groups.get(key)
      if (list) list.push(chip)
      else groups.set(key, [chip])
    }
    for (const group of groups.values()) {
      const shape = group[0].trigger.shape
      if (!shape) continue
      const talk = group.find(chip => chip.trigger.type === 'talk')
      const choice = group.find(chip => chip.trigger.type === 'choice')
      const talkFirst = !!(talk && choice)
      const mark = document.createElement('div')
      mark.className = `hotspotMark${shape.kind === 'circle' ? ' circle' : ''}${group.length === 1 ? ' single' : ''}${talkFirst ? ' talk-first' : ''}`
      const box = bounds(shape)
      mark.style.left = `${box.x / canvas.w * 100}%`
      mark.style.top = `${box.y / canvas.h * 100}%`
      mark.style.width = `${box.w / canvas.w * 100}%`
      mark.style.height = `${box.h / canvas.h * 100}%`
      const press = (chip: HotspotChip) => this.onClick(chip.trigger)
      if (talkFirst && talk) {
        mark.append(chipButton(talk, 'hotspot fill', press))
      }
      const labels = document.createElement('div')
      labels.className = 'hotspotLabels'
      for (const chip of group) {
        if (talkFirst && chip.trigger.id === talk?.trigger.id) continue
        labels.append(chipButton(chip, 'hotspot', press))
      }
      mark.append(labels)
      this.layer.append(mark)
    }
  }

  clear() { this.layer.innerHTML = '' }
}

function chipButton(chip: HotspotChip, className: string, press: (chip: HotspotChip) => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.dataset.triggerId = chip.trigger.id
  button.textContent = chip.label
  button.onclick = event => {
    event.stopPropagation()
    press(chip)
  }
  return button
}

function bounds(shape: HotspotShape) {
  if (shape.kind === 'circle') return { x: shape.x - shape.r, y: shape.y - shape.r, w: shape.r * 2, h: shape.r * 2 }
  return { x: shape.x, y: shape.y, w: shape.w, h: shape.h }
}

function shapeKey(shape: HotspotShape) {
  if (shape.kind === 'circle') return `c:${shape.x}:${shape.y}:${shape.r}`
  return `b:${shape.x}:${shape.y}:${shape.w}:${shape.h}`
}

import { assetUrl, cutoutSlots, type C01Visual, type PortraitDef } from './c01Art'

const FADE_MS = 280

/** Standing portraits for the open dialogue. Hidden while the player is free to tap hotspots. */
export class PortraitStage {
  private visual: C01Visual | null = null
  private order: string[] = []
  private nodes = new Map<string, HTMLElement>()
  private frameW = 1080
  private urlBase = '/'

  constructor(private root: HTMLElement) {}

  setVisual(visual: C01Visual, urlBase: string) {
    this.visual = visual
    this.urlBase = urlBase
  }

  layout(frameW: number) {
    this.frameW = frameW
    this.place()
  }

  /** Highlight `speaker`. 旁白 and anyone without a portrait dim the people already on stage. */
  show(speaker: string) {
    const def = this.visual?.portraits[speaker]
    if (!def) {
      this.retint(null)
      return
    }
    if (!this.order.includes(speaker)) this.order.push(speaker)
    let node = this.nodes.get(speaker)
    if (!node) {
      node = this.create(speaker, def)
      this.nodes.set(speaker, node)
      this.root.append(node)
      const born = node
      requestAnimationFrame(() => born.classList.add('shown'))
    } else {
      node.classList.add('shown')
      node.classList.remove('leaving')
    }
    this.root.classList.remove('hidden', 'leaving')
    this.root.classList.add('live')
    this.retint(speaker)
    this.place()
  }

  clear() {
    const nodes = [...this.nodes.values()]
    this.nodes.clear()
    this.order = []
    this.root.classList.remove('live')
    this.root.classList.add('leaving')
    for (const node of nodes) {
      node.classList.remove('shown', 'active')
      node.classList.add('leaving')
    }
    window.setTimeout(() => {
      for (const node of nodes) node.remove()
      if (this.nodes.size === 0) {
        this.root.classList.add('hidden')
        this.root.classList.remove('leaving')
      }
    }, FADE_MS)
  }

  private create(speaker: string, def: PortraitDef) {
    const fig = document.createElement('figure')
    fig.className = `portrait ${def.mode === 'card' ? 'card' : 'cutout'}${def.generated ? ' glow' : ''}`
    fig.dataset.speaker = speaker
    fig.dataset.mode = def.mode
    const img = document.createElement('img')
    img.alt = ''
    img.draggable = false
    img.src = assetUrl(def.src, this.urlBase)
    fig.append(img)
    return fig
  }

  private retint(active: string | null) {
    for (const [speaker, node] of this.nodes) {
      node.classList.toggle('active', speaker === active)
      node.classList.toggle('dim', speaker !== active)
    }
  }

  private place() {
    const visual = this.visual
    if (!visual || this.order.length === 0) return
    const anchor = visual.portrait_anchor
    const slots = cutoutSlots(this.order.length, this.frameW, anchor.x, anchor.w, visual.body_half_frac)
    this.order.forEach((speaker, index) => {
      const node = this.nodes.get(speaker)
      const slot = slots[Math.min(index, slots.length - 1)]
      if (!node || !slot) return
      if (node.dataset.mode === 'card') {
        const width = this.frameW * 0.3
        node.style.width = `${width}px`
        node.style.left = `${slot.center - width / 2}px`
        node.style.bottom = 'auto'
        node.style.top = '12%'
        return
      }
      node.style.width = `${slot.width}px`
      node.style.left = `${slot.left}px`
      node.style.top = 'auto'
      node.style.bottom = '0px'
    })
  }
}

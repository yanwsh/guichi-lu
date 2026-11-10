import type { ChoiceRow, DialogueRow } from '../data/types'
import { assetUrl, stillAt } from '../scene/c01Art'
import type { PortraitStage } from '../scene/portraitStage'

export interface DialogRunOptions {
  /** Ordered stills. Line i shows still min(i, last). */
  stills?: string[]
  /** c01 uses the standing portraits and the foot-clear dialogue plate. */
  presentation?: 'c01' | 'legacy'
}

export class DialogRunner {
  private advance: () => void = () => {}
  private urlBase = '/'

  constructor(
    private root: HTMLElement,
    private portrait: HTMLImageElement | undefined,
    private dim: HTMLElement | undefined,
    private portraits: PortraitStage,
    private cutaway: { root: HTMLElement; img: HTMLImageElement },
  ) {}

  setAssetBase(base: string) { this.urlBase = base }

  /** Resolves with the chosen row, or null when the line run ends. */
  run(d: DialogueRow, opts?: DialogRunOptions): Promise<ChoiceRow | null> {
    return new Promise(done => {
      let i = 0
      const show = () => {
        const line = d.lines[i]
        const stills = opts?.stills
        const cutawayOn = !!stills?.length
        const c01 = opts?.presentation === 'c01'
        this.root.classList.remove('hidden')
        this.root.classList.toggle('c01', c01 && !cutawayOn)
        this.root.classList.toggle('as-subtitle', cutawayOn)
        this.root.dataset.speaker = line?.speaker ?? ''
        this.root.innerHTML = ''
        this.dim?.classList.remove('hidden')
        if (cutawayOn && stills) this.showStill(stills, i)
        else this.hideStill()
        if (c01 && !cutawayOn) this.portraits.show(line?.speaker ?? '')
        else if (cutawayOn) this.portraits.clear()
        else this.showLegacyPortrait(line?.portrait_key)
        const plate = document.createElement('div')
        plate.className = 'plate'
        const sp = document.createElement('div')
        sp.className = 'speaker'
        sp.textContent = line.speaker
        const tx = document.createElement('div')
        tx.className = 'text'
        tx.textContent = line.text
        plate.append(sp, tx)
        const host = c01 || cutawayOn ? plate : null
        if (host) this.root.append(host)
        const parent = host ?? this.root
        if (!host) parent.append(sp, tx)
        const last = i === d.lines.length - 1
        const go = () => { if (last) { this.hide(); done(null) } else { i++; show() } }
        this.advance = go
        if (last && d.choices.length) {
          for (const c of d.choices) {
            const b = document.createElement('button')
            b.type = 'button'
            b.textContent = c.text
            b.onclick = e => { e.stopPropagation(); this.hide(); done(c) }
            parent.append(b)
          }
          this.root.onclick = null
          this.cutaway.root.onclick = null
        } else {
          const hint = document.createElement('div')
          hint.className = 'hint'
          hint.textContent = last ? '▶ 点击结束' : '▶ 点击继续'
          parent.append(hint)
          this.root.onclick = e => { e.stopPropagation(); go() }
          this.cutaway.root.onclick = cutawayOn ? e => { e.stopPropagation(); go() } : null
        }
      }
      show()
    })
  }

  private showStill(stills: readonly string[], line: number) {
    const src = stillAt(stills, line)
    if (!src) return
    const url = assetUrl(src, this.urlBase)
    const img = this.cutaway.img
    this.cutaway.root.classList.remove('hidden')
    this.cutaway.root.dataset.stillIndex = String(Math.min(line, stills.length - 1))
    this.cutaway.root.dataset.still = src
    if (img.getAttribute('src') !== url) {
      img.style.opacity = '0'
      img.onload = () => { img.style.opacity = '1' }
      img.src = url
    }
  }

  private hideStill() {
    this.cutaway.root.classList.add('hidden')
    this.cutaway.root.onclick = null
    delete this.cutaway.root.dataset.stillIndex
    delete this.cutaway.root.dataset.still
  }

  private showLegacyPortrait(key?: string) {
    this.portraits.clear()
    if (!this.portrait) return
    if (!key) { this.portrait.classList.add('hidden'); return }
    const src = `${this.urlBase}portraits/anime-v3-${key}.jpg`
    if (this.portrait.getAttribute('src') !== src) this.portrait.src = src
    this.portrait.classList.remove('hidden')
  }

  hide() {
    this.root.classList.add('hidden')
    this.root.classList.remove('c01', 'as-subtitle')
    this.root.onclick = null
    this.root.innerHTML = ''
    delete this.root.dataset.speaker
    this.portrait?.classList.add('hidden')
    this.dim?.classList.add('hidden')
    this.portraits.clear()
    this.hideStill()
    this.advance = () => {}
  }
}
